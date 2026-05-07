import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import type { PermissionScope, ToolContext, ToolDefinition } from "../../core/types.js";

export interface GenerativeMediaOptions {
  comfyuiEndpoint: string;
  cloudModelEndpoint?: string;
  openaiApiKey?: string;
  openaiImageModel: string;
  openaiTtsModel: string;
  openaiTtsVoice: string;
  outputDir?: string;
}

export interface GenerativeMediaInput {
  action: "image" | "video" | "speech" | "comfy_workflow";
  prompt?: string;
  text?: string;
  outputPath?: string;
  workflow?: Record<string, unknown>;
  wait?: boolean;
  options?: Record<string, unknown>;
}

export interface GenerativeMediaOutput {
  success: boolean;
  provider?: string;
  action: GenerativeMediaInput["action"];
  file?: string;
  files?: string[];
  url?: string;
  promptId?: string;
  nextStep?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

export interface ComfyUiFileRef {
  filename: string;
  subfolder?: string;
  type?: string;
}

export interface ComfyUiDownloadedFile {
  source: ComfyUiFileRef;
  path: string;
}

function defaultExtension(action: GenerativeMediaInput["action"]): string {
  if (action === "speech") return "mp3";
  if (action === "video") return "mp4";
  return "png";
}

function resolveOutputPath(rootDir: string, action: GenerativeMediaInput["action"], outputPath?: string): string {
  if (outputPath?.trim()) {
    return resolve(outputPath);
  }
  return resolve(rootDir, `${action}-${Date.now()}-${randomUUID()}.${defaultExtension(action)}`);
}

async function writeBase64File(filePath: string, base64: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, Buffer.from(base64, "base64"));
}

function safeFileName(value: string): string {
  return value.replace(/[^\w.\-()\u4e00-\u9fa5]/g, "_");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export class ComfyUiClient {
  private readonly endpoint: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint.replace(/\/+$/, "");
  }

  async submitWorkflow(workflow: Record<string, unknown>): Promise<string> {
    const response = await fetch(`${this.endpoint}/prompt`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow })
    });

    const data = (await response.json()) as { prompt_id?: string; error?: string };
    if (!response.ok || data.error || !data.prompt_id) {
      throw new Error(data.error ?? `${response.status} ${response.statusText}`);
    }

    return data.prompt_id;
  }

  async getHistory(promptId: string): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.endpoint}/history/${encodeURIComponent(promptId)}`);
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return data;
  }

  extractOutputFiles(history: Record<string, unknown>, promptId: string): ComfyUiFileRef[] {
    const promptHistory = history[promptId] as { outputs?: Record<string, unknown> } | undefined;
    const outputs = promptHistory?.outputs ?? {};
    const files: ComfyUiFileRef[] = [];

    for (const output of Object.values(outputs)) {
      const outputRecord = output as Record<string, unknown>;
      for (const key of ["images", "gifs", "videos", "audio"]) {
        const values = outputRecord[key];
        if (!Array.isArray(values)) {
          continue;
        }
        for (const value of values) {
          const item = value as Partial<ComfyUiFileRef>;
          if (typeof item.filename === "string" && item.filename.trim()) {
            files.push({
              filename: item.filename,
              subfolder: item.subfolder,
              type: item.type
            });
          }
        }
      }
    }

    return files;
  }

  async waitForOutputs(
    promptId: string,
    params: { timeoutMs?: number; pollMs?: number } = {}
  ): Promise<{ history: Record<string, unknown>; files: ComfyUiFileRef[] }> {
    const timeoutMs = Math.max(500, params.timeoutMs ?? 60_000);
    const pollMs = Math.max(250, params.pollMs ?? 1_000);
    const startedAt = Date.now();

    while (Date.now() - startedAt <= timeoutMs) {
      const history = await this.getHistory(promptId);
      const files = this.extractOutputFiles(history, promptId);
      if (files.length > 0) {
        return { history, files };
      }
      await delay(pollMs);
    }

    throw new Error(`Timed out waiting for ComfyUI outputs for prompt ${promptId}`);
  }

  async downloadOutputs(
    files: ComfyUiFileRef[],
    outputDir: string
  ): Promise<ComfyUiDownloadedFile[]> {
    const downloaded: ComfyUiDownloadedFile[] = [];
    await mkdir(outputDir, { recursive: true });

    for (const file of files) {
      const query = new URLSearchParams({
        filename: file.filename,
        subfolder: file.subfolder ?? "",
        type: file.type ?? "output"
      });
      const response = await fetch(`${this.endpoint}/view?${query.toString()}`);
      if (!response.ok) {
        throw new Error(`Failed to download ${file.filename}: ${response.status} ${response.statusText}`);
      }

      const extension = extname(file.filename);
      const fileName = `${Date.now()}-${randomUUID()}-${safeFileName(basename(file.filename, extension))}${extension || ".bin"}`;
      const filePath = resolve(outputDir, fileName);
      await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
      downloaded.push({ source: file, path: filePath });
    }

    return downloaded;
  }
}

async function generateOpenAiImage(
  input: GenerativeMediaInput,
  options: GenerativeMediaOptions
): Promise<GenerativeMediaOutput> {
  if (!options.openaiApiKey) {
    return {
      success: false,
      action: "image",
      error: "CLOUD_API_KEY is required for cloud image generation",
      nextStep: "Set CLOUD_API_KEY with an image-capable provider (e.g. OpenAI) or set COMFYUI_ENDPOINT for local image generation via ComfyUI."
    };
  }

  const apiBase = getImageApiEndpoint(options.cloudModelEndpoint);

  try {
    const response = await fetch(`${apiBase}/images/generations`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.openaiApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: options.openaiImageModel,
        prompt: input.prompt,
        size: input.options?.size ?? "1024x1024"
      })
    });

    const data = (await response.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      error?: { message?: string; code?: string };
    };

    if (!response.ok || data.error) {
      const status = response.status;
      const errMsg = data.error?.message ?? `${status} ${response.statusText}`;

      // Detect known failure modes and provide actionable guidance
      let nextStep: string;
      if (status === 404) {
        nextStep = `Image generation endpoint not found at ${apiBase}. This cloud provider likely does not support image generation. Alternatives: (1) Set COMFYUI_ENDPOINT for local ComfyUI image generation, (2) Use gen.media with action="comfy_workflow", (3) Use the chart tool to generate charts/diagrams, (4) Write HTML/SVG to create visual content, (5) Configure CLOUD_MODEL_ENDPOINT to an image-capable provider like OpenAI.`;
      } else if (status === 401 || status === 403) {
        nextStep = `Authentication failed. The CLOUD_API_KEY may not have access to image generation on this provider. Check that the API key supports image generation, or set COMFYUI_ENDPOINT for local image generation.`;
      } else if (status === 429) {
        nextStep = "Rate limited. Wait and retry, or use a local ComfyUI workflow via gen.media with action=comfy_workflow.";
      } else {
        nextStep = "Image generation failed. Consider using a ComfyUI workflow (action=comfy_workflow), the chart tool for data visualizations, or creating SVG/HTML visuals instead.";
      }

      return { success: false, provider: "openai", action: "image", error: errMsg, nextStep };
    }

    const item = data.data?.[0];
    if (!item) {
      return {
        success: false, provider: "openai", action: "image",
        error: "No image returned from API",
        nextStep: "The API returned no image data. Try a different prompt, or use ComfyUI via gen.media with action=comfy_workflow for local generation."
      };
    }

    if (item.b64_json) {
      const filePath = resolveOutputPath(options.outputDir ?? "./.agent/generated", "image", input.outputPath);
      await writeBase64File(filePath, item.b64_json);
      return { success: true, provider: "openai", action: "image", file: filePath };
    }

    return { success: true, provider: "openai", action: "image", url: item.url };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      provider: "openai",
      action: "image",
      error: `Image generation request failed: ${errMsg}`,
      nextStep: `Network error contacting ${apiBase}. The configured cloud provider may not support image generation. Alternatives: (1) Set COMFYUI_ENDPOINT and use action="comfy_workflow" for local image generation, (2) Use the chart tool to generate charts, (3) Write HTML/CSS/SVG to create visual output, (4) Check that CLOUD_MODEL_ENDPOINT points to an image-capable provider.`
    };
  }
}

async function generateOpenAiSpeech(
  input: GenerativeMediaInput,
  options: GenerativeMediaOptions
): Promise<GenerativeMediaOutput> {
  if (!options.openaiApiKey) {
    return {
      success: false,
      action: "speech",
      error: "CLOUD_API_KEY is required for cloud speech generation",
      nextStep: "Set CLOUD_API_KEY with a TTS-capable provider or use the system voice tool for local TTS."
    };
  }

  const apiBase = getImageApiEndpoint(options.cloudModelEndpoint);
  const filePath = resolveOutputPath(options.outputDir ?? "./.agent/generated", "speech", input.outputPath);
  await mkdir(dirname(filePath), { recursive: true });

  try {
    const response = await fetch(`${apiBase}/audio/speech`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.openaiApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: options.openaiTtsModel,
        voice: String(input.options?.voice ?? options.openaiTtsVoice),
        input: input.text ?? input.prompt ?? ""
      })
    });

    if (!response.ok) {
      return {
        success: false,
        provider: "openai",
        action: "speech",
        error: `${response.status} ${response.statusText}`,
        nextStep: response.status === 404
          ? `Speech endpoint not found at ${apiBase}. This provider may not support TTS. Use the voice tool for local system TTS instead.`
          : "Speech generation failed. Try the voice tool for local system TTS."
      };
    }

    await writeFile(filePath, Buffer.from(await response.arrayBuffer()));
    return { success: true, provider: "openai", action: "speech", file: filePath };
  } catch (err) {
    return {
      success: false,
      provider: "openai",
      action: "speech",
      error: err instanceof Error ? err.message : String(err),
      nextStep: "Network error during speech generation. Use the voice tool for local system TTS."
    };
  }
}

async function submitComfyWorkflow(
  input: GenerativeMediaInput,
  options: GenerativeMediaOptions
): Promise<GenerativeMediaOutput> {
  if (!input.workflow) {
    return {
      success: false,
      provider: "comfyui",
      action: input.action,
      error: "workflow is required for ComfyUI submission",
      nextStep: "Provide a ComfyUI workflow JSON, or use action=image with OpenAI image generation."
    };
  }

  const client = new ComfyUiClient(options.comfyuiEndpoint);
  try {
    const promptId = await client.submitWorkflow(input.workflow);
    if (input.wait) {
      const outputDir = resolve(options.outputDir ?? "./.agent/generated");
      const waitResult = await client.waitForOutputs(promptId, {
        timeoutMs: Number(input.options?.timeoutMs ?? 60_000),
        pollMs: Number(input.options?.pollMs ?? 1_000)
      });
      const downloaded = await client.downloadOutputs(waitResult.files, outputDir);
      return {
        success: true,
        provider: "comfyui",
        action: input.action,
        promptId,
        file: downloaded[0]?.path,
        files: downloaded.map((item) => item.path),
        nextStep: "ComfyUI workflow completed and output files were saved locally.",
        metadata: {
          outputCount: downloaded.length,
          sources: downloaded.map((item) => item.source)
        }
      };
    }

    return {
      success: true,
      provider: "comfyui",
      action: input.action,
      promptId,
      nextStep: "Open ComfyUI or use the media job polling endpoint to monitor the queued workflow."
    };
  } catch (error) {
    return {
      success: false,
      provider: "comfyui",
      action: input.action,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export function createGenerativeMediaTool(
  options: GenerativeMediaOptions
): ToolDefinition<GenerativeMediaInput, GenerativeMediaOutput> {
  return {
    id: "gen.media",
    description: "Generate images, speech, video jobs, or submit ComfyUI workflows for creative media tasks",
    requiredScopes: ["web.fetch", "filesystem.write"] as PermissionScope[],
    riskLevel: "medium",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string" as const, enum: ["image", "video", "speech", "comfy_workflow"], description: "Media generation action" },
        prompt: { type: "string" as const, description: "Text prompt for image/video generation" },
        text: { type: "string" as const, description: "Text content for speech synthesis" },
        outputPath: { type: "string" as const, description: "Output file path for generated media" },
        workflow: { type: "object" as const, description: "ComfyUI workflow JSON for custom workflows", additionalProperties: true },
        wait: { type: "boolean" as const, description: "Wait for ComfyUI job to complete (default: false)" },
        options: { type: "object" as const, description: "Additional options (size, voice, timeoutMs, etc.)", additionalProperties: true }
      },
      required: ["action"]
    },
    async execute(input: GenerativeMediaInput, _context: ToolContext): Promise<GenerativeMediaOutput> {
      if (input.action === "image" && input.workflow) {
        return submitComfyWorkflow(input, options);
      }
      if (input.action === "comfy_workflow" || input.action === "video") {
        return submitComfyWorkflow(input, options);
      }
      if (input.action === "image") {
        return generateOpenAiImage(input, options);
      }
      if (input.action === "speech") {
        return generateOpenAiSpeech(input, options);
      }
      return { success: false, action: input.action, error: "Unsupported generative media action" };
    }
  };
}

function isTextOnlyCloudProvider(endpoint: string): boolean {
  try {
    const host = new URL(endpoint).hostname.toLowerCase();
    // Known text-only providers that don't support image generation
    const textOnly = ["deepseek.com", "api.deepseek.com", "deepseek.ai"];
    return textOnly.some(d => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

function getImageApiEndpoint(cloudModelEndpoint?: string): string {
  if (!cloudModelEndpoint) return "https://api.openai.com/v1";
  try {
    const url = new URL(cloudModelEndpoint);
    // Use the same base as the chat endpoint, but note: images API may not exist there
    return `${url.protocol}//${url.host}`;
  } catch {
    return "https://api.openai.com/v1";
  }
}

export async function checkGenerativeMediaCapability(options: GenerativeMediaOptions): Promise<{ available: boolean; reason?: string }> {
  const hasComfy = Boolean(options.comfyuiEndpoint);
  const hasCloudKey = Boolean(options.openaiApiKey);

  if (!hasComfy && !hasCloudKey) {
    return { available: false, reason: "No generative media backend available. Set COMFYUI_ENDPOINT or CLOUD_API_KEY." };
  }

  // If only cloud key is available, check that the provider isn't text-only
  if (!hasComfy && hasCloudKey && options.cloudModelEndpoint) {
    if (isTextOnlyCloudProvider(options.cloudModelEndpoint)) {
      return {
        available: false,
        reason: `Cloud provider (${new URL(options.cloudModelEndpoint).hostname}) is text-only and does not support image/audio generation. Set COMFYUI_ENDPOINT for image/video generation or configure an image-capable provider (OpenAI, NVIDIA).`
      };
    }
  }

  return { available: true };
}
