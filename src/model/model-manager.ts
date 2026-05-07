import { readdir, stat, readFile, writeFile, mkdir, unlink, open, rename } from "node:fs/promises";
import { join, dirname, basename } from "node:path";
import { existsSync } from "node:fs";
import type { FileHandle } from "node:fs/promises";

export interface ModelInfo {
  id: string;
  name: string;
  path: string;
  size: number;
  format: string;
  contextSize: number;
  quantization: string;
  lastUsed?: string;
}

export interface ModelConfig {
  modelId: string;
  temperature: number;
  maxTokens: number;
  threads?: number;
  gpuLayers?: number;
  contextSize?: number;
}

export interface ModelRuntimeStatus {
  modelsDir: string;
  modelCount: number;
  availableModels: string[];
  currentModelId: string | null;
  loaded: boolean;
  llamaCppAvailable: boolean;
  builtinReady: boolean;
  builtinGpu: false | "auto" | "metal" | "cuda" | "vulkan";
  detectedLocalEndpoints: string[];
}

export interface ModelManagerOptions {
  modelsDir?: string;
  builtinGpu?: false | "auto" | "metal" | "cuda" | "vulkan";
}

const DEFAULT_MODELS_DIR = "./models";
const MODEL_CONFIG_FILE = "./.agent/models.json";

export class ModelManager {
  private modelsDir: string;
  private builtinGpu: false | "auto" | "metal" | "cuda" | "vulkan";
  private models: Map<string, ModelInfo> = new Map();
  private currentModelId: string | null = null;
  private llama: unknown = null;
  private loadedModel: unknown = null;
  private loadedContext: unknown = null;
  private llamaCppAvailable = false;

  constructor(options: ModelManagerOptions = {}) {
    this.modelsDir = options.modelsDir ?? DEFAULT_MODELS_DIR;
    this.builtinGpu = options.builtinGpu ?? "auto";
  }

  async initialize(): Promise<void> {
    await mkdir(this.modelsDir, { recursive: true });
    await mkdir(dirname(MODEL_CONFIG_FILE), { recursive: true });
    await this.tryLoadLlamaCpp();
    await this.scanModels();
  }

  private async tryLoadLlamaCpp(): Promise<void> {
    try {
      // Dynamic import - will fail gracefully if not installed
      const llamaModule = await import("node-llama-cpp");
      this.llama = await (
        llamaModule as {
          getLlama: (options?: {
            gpu?: false | "auto" | "metal" | "cuda" | "vulkan";
            progressLogs?: boolean;
          }) => Promise<unknown>;
        }
      ).getLlama({
        gpu: this.builtinGpu,
        progressLogs: false
      });
      // Store LlamaChatSession class for later use in chat session creation
      const mod = llamaModule as any;
      (this.llama as any).LlamaChatSession = mod.LlamaChatSession || mod.get?.LlamaChatSession;
      this.llamaCppAvailable = true;
      console.log("[ModelManager] llama.cpp loaded successfully");
    } catch (error) {
      console.log(
        `[ModelManager] node-llama-cpp unavailable for builtin runtime: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.llamaCppAvailable = false;
    }
  }

  async scanModels(): Promise<ModelInfo[]> {
    const models: ModelInfo[] = [];
    this.models.clear();

    if (!existsSync(this.modelsDir)) {
      return models;
    }

    try {
      const files = await readdir(this.modelsDir);

      for (const file of files) {
        if (!file.endsWith(".gguf") && !file.endsWith(".bin")) {
          continue;
        }
        // Skip multimodal projection files (loaded alongside vision models)
        if (file.toLowerCase().includes("mmproj")) {
          continue;
        }

        const filePath = join(this.modelsDir, file);
        const stats = await stat(filePath);

        const modelInfo: ModelInfo = {
          id: basename(file, ".gguf").replace(/\.bin$/, ""),
          name: file,
          path: filePath,
          size: stats.size,
          format: file.endsWith(".gguf") ? "gguf" : "bin",
          contextSize: 4096,
          quantization: this.detectQuantization(file)
        };

        models.push(modelInfo);
        this.models.set(modelInfo.id, modelInfo);
      }
    } catch (error) {
      console.log(`[ModelManager] Error scanning models: ${error}`);
    }

    return models;
  }

  private detectQuantization(filename: string): string {
    const lower = filename.toLowerCase();
    if (lower.includes("q2_k")) return "Q2_K";
    if (lower.includes("q3_k")) return "Q3_K";
    if (lower.includes("q4_0")) return "Q4_0";
    if (lower.includes("q4_1")) return "Q4_1";
    if (lower.includes("q4_k")) return "Q4_K";
    if (lower.includes("q5_0")) return "Q5_0";
    if (lower.includes("q5_1")) return "Q5_1";
    if (lower.includes("q5_k")) return "Q5_K";
    if (lower.includes("q6_k")) return "Q6_K";
    if (lower.includes("q8_0")) return "Q8_0";
    if (lower.includes("f16")) return "F16";
    if (lower.includes("f32")) return "F32";
    return "Unknown";
  }

  isLlamaCppAvailable(): boolean {
    return this.llamaCppAvailable;
  }

  async loadModel(modelId: string, config?: Partial<ModelConfig>): Promise<boolean> {
    const model = this.models.get(modelId);
    if (!model) {
      console.log(`[ModelManager] Model not found: ${modelId}`);
      return false;
    }

    if (!this.llamaCppAvailable) {
      console.log("[ModelManager] llama.cpp not available, cannot load model");
      return false;
    }

    try {
      const llama = this.llama as {
        loadModel: (options: { modelPath: string }) => Promise<unknown>;
      };

      console.log(`[ModelManager] Loading model: ${model.name}`);
      this.loadedModel = await llama.loadModel({ modelPath: model.path });

      const contextOptions: Record<string, unknown> = {
        contextWindow: config?.contextSize || model.contextSize
      };

      if (config?.threads) {
        contextOptions.threads = config.threads;
      }

      if (config?.gpuLayers) {
        contextOptions.gpuLayers = config.gpuLayers;
      }

      const modelObj = this.loadedModel as {
        createContext: (options?: Record<string, unknown>) => Promise<{ getSequence: () => unknown }>;
      };
      this.loadedContext = await modelObj.createContext(contextOptions);

      // Get LlamaChatSession class for creating chat session
      const LlamaChatSession = (this.llama as any).LlamaChatSession;
      // node-llama-cpp v3 requires a context SEQUENCE (via .getSequence()), not the context itself
      const contextSeq = (this.loadedContext as any).getSequence?.() ?? this.loadedContext;
      this.chatSession = new LlamaChatSession({
        contextSequence: contextSeq
      });

      this.currentModelId = modelId;
      await this.updateLastUsed(modelId);

      console.log(`[ModelManager] Model loaded: ${model.name}`);
      return true;
    } catch (error) {
      console.log(`[ModelManager] Error loading model: ${error}`);
      return false;
    }
  }

  private chatSession: any = null;

  async complete(prompt: string, options?: {
    temperature?: number;
    maxTokens?: number;
    functions?: Record<string, { description: string; params: Record<string, unknown> }>;
    onToken?: (token: string) => void;
  }): Promise<string> {
    if (!this.llamaCppAvailable) {
      throw new Error("llama.cpp not available. Install with: npm install node-llama-cpp");
    }

    if (!this.loadedModel || !this.chatSession) {
      throw new Error("No model loaded");
    }

    try {
      const promptOpts: Record<string, unknown> = {
        maxTokens: options?.maxTokens || 1024
      };
      if (options?.temperature != null) promptOpts.temperature = options.temperature;
      if (options?.functions && Object.keys(options.functions).length > 0) {
        promptOpts.functions = options.functions;
      }
      if (options?.onToken) {
        promptOpts.onToken = options.onToken;
      }
      const response = await this.chatSession.prompt(prompt, promptOpts);
      // node-llama-cpp may return { response, functionCalls } or just a string
      if (typeof response === "string") return response;
      if (response && typeof response === "object") {
        const r = response as any;
        if (r.functionCalls && r.functionCalls.length > 0) {
          return JSON.stringify({ functionCalls: r.functionCalls });
        }
        return r.response ?? String(response);
      }
      return String(response ?? "");
    } catch (error: any) {
      console.log(`[ModelManager] Completion error: ${error.message}`);
      try {
        this.unloadModel();
        if (this.currentModelId) {
          await this.loadModel(this.currentModelId);
        }
        console.log("[ModelManager] Chat session reset after error, retrying...");
        const retryResponse = await this.chatSession?.prompt(prompt, {
          maxTokens: options?.maxTokens || 1024
        });
        if (typeof retryResponse === "string") return retryResponse;
        return (retryResponse as any)?.response ?? String(retryResponse ?? "");
      } catch (retryError: any) {
        console.log(`[ModelManager] Retry also failed: ${retryError.message}`);
        throw error;
      }
    }
  }

  unloadModel(): void {
    this.loadedContext = null;
    this.loadedModel = null;
    this.chatSession = null;
    this.currentModelId = null;
    console.log("[ModelManager] Model unloaded");
  }

  resolveModelId(modelId?: string): string | null {
    if (!modelId || modelId === "default") {
      return this.currentModelId ?? this.listModels()[0]?.id ?? null;
    }

    return this.models.has(modelId) ? modelId : null;
  }

  async addModelFromUrl(url: string, filename?: string): Promise<string | null> {
    try {
      const name = filename || url.split("/").pop() || "model.gguf";
      const outputPath = join(this.modelsDir, name);

      console.log(`[ModelManager] Downloading model to ${outputPath}...`);

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }

      const chunks: Uint8Array[] = [];
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("Cannot read response body");
      }

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      await writeFile(outputPath, Buffer.from(result));
      await this.scanModels();
      return name;
    } catch (error) {
      console.log(`[ModelManager] Download error: ${error}`);
      return null;
    }
  }

  async addModelFromUrlStream(
    url: string,
    filename?: string,
    onProgress?: (progress: { loaded: number; total: number; percent: number; speed: number }) => void
  ): Promise<{ filename: string; resumed: boolean }> {
    const name = filename || url.split("/").pop() || "model.gguf";
    const outputPath = join(this.modelsDir, name);
    const tmpPath = outputPath + ".part";

    let existingSize = 0;
    let resumed = false;

    // Check for partial download to resume
    if (existsSync(tmpPath)) {
      try {
        const st = await stat(tmpPath);
        existingSize = st.size;
        resumed = existingSize > 0;
      } catch { /* will start fresh */ }
    }

    const headers: Record<string, string> = {};
    if (existingSize > 0) {
      headers["Range"] = `bytes=${existingSize}-`;
    }

    console.log(`[ModelManager] Streaming download to ${outputPath}${resumed ? ` (resuming from ${existingSize} bytes)` : ""}...`);

    const response = await fetch(url, { headers });
    if (!response.ok && response.status !== 206) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const contentLength = response.headers.get("content-length");
    const total = (contentLength ? Number(contentLength) : 0) + existingSize;

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error("Cannot read response body");
    }

    let fh: FileHandle | null = null;
    try {
      // Use append mode for resume, write mode for fresh
      const flag = resumed ? "a" : "w";
      fh = await open(tmpPath, flag);

      const startTime = Date.now();
      let loaded = existingSize;
      let lastReportTime = startTime;
      let lastReportLoaded = loaded;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        await fh.write(value);
        loaded += value.length;

        // Throttle progress reports to ~4/s
        const now = Date.now();
        if (now - lastReportTime >= 250) {
          const elapsed = (now - startTime) / 1000;
          const speed = elapsed > 0 ? (loaded - existingSize) / elapsed : 0;
          lastReportTime = now;
          onProgress?.({
            loaded,
            total: total > 0 ? total : loaded * 2,
            percent: total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0,
            speed
          });
        }
      }

      // Rename .part → final
      await fh.close();
      fh = null;
      await rename(tmpPath, outputPath);

      onProgress?.({ loaded, total: loaded, percent: 100, speed: 0 });
      await this.scanModels();
      console.log(`[ModelManager] Download complete: ${name} (${loaded} bytes)`);
      return { filename: name, resumed };
    } catch (err) {
      if (fh) {
        try { await fh.close(); } catch { /* best-effort */ }
      }
      throw err;
    } finally {
      reader.releaseLock();
    }
  }

  async removeModel(modelId: string): Promise<boolean> {
    const model = this.models.get(modelId);
    if (!model) return false;

    if (this.currentModelId === modelId) {
      this.unloadModel();
    }

    try {
      await unlink(model.path);
      this.models.delete(modelId);
      return true;
    } catch {
      return false;
    }
  }

  listModels(): ModelInfo[] {
    return Array.from(this.models.values());
  }

  getModel(modelId: string): ModelInfo | undefined {
    return this.models.get(modelId);
  }

  getCurrentModelId(): string | null {
    return this.currentModelId;
  }

  isModelLoaded(): boolean {
    return this.loadedModel !== null;
  }

  getModelsDir(): string {
    return this.modelsDir;
  }

  private detectedEndpoints: string[] = [];

  setDetectedEndpoints(endpoints: string[]): void {
    this.detectedEndpoints = endpoints;
  }

  getStatus(): ModelRuntimeStatus {
    const availableModels = this.listModels().map((model) => model.id);
    return {
      modelsDir: this.modelsDir,
      modelCount: availableModels.length,
      availableModels,
      currentModelId: this.currentModelId,
      loaded: this.isModelLoaded(),
      llamaCppAvailable: this.llamaCppAvailable,
      builtinReady: this.llamaCppAvailable && availableModels.length > 0,
      builtinGpu: this.builtinGpu,
      detectedLocalEndpoints: this.detectedEndpoints,
    };
  }

  private async updateLastUsed(modelId: string): Promise<void> {
    const configs = await this.loadConfigs();
    if (!configs[modelId]) {
      configs[modelId] = {};
    }
    configs[modelId].lastUsed = new Date().toISOString();
    await this.saveConfigs(configs);
  }

  private async loadConfigs(): Promise<Record<string, { lastUsed?: string }>> {
    try {
      const content = await readFile(MODEL_CONFIG_FILE, "utf8");
      return JSON.parse(content);
    } catch {
      return {};
    }
  }

  private async saveConfigs(configs: Record<string, { lastUsed?: string }>): Promise<void> {
    await writeFile(MODEL_CONFIG_FILE, JSON.stringify(configs, null, 2), "utf8");
  }
}

export function createModelManager(options?: string | ModelManagerOptions): ModelManager {
  if (typeof options === "string" || options == null) {
    return new ModelManager({ modelsDir: options });
  }

  return new ModelManager(options);
}
