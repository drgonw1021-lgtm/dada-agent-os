import {
  getProviderDisplayName,
  getProviderMode,
  getProviderNameForModel,
  joinEndpoint,
  type RegisteredProviderName
} from "../../model/provider-utils.js";
import type { ModelRuntimeStatus } from "../../model/model-manager.js";
import type { ServerContext } from "../util.js";
import { readJsonBody } from "../util.js";
import { translateDescription } from "../../core/i18n.js";
import { detectHardware, getModelRecommendations, type HardwareInfo, type ModelRecommendation } from "../../doctor.js";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";

interface PlannerHealth {
  ok: boolean;
  plannerModel: string;
  providerName: RegisteredProviderName;
  providerLabel: string;
  mode: "builtin" | "local-api" | "cloud-api";
  endpoint?: string;
  detail: string;
  apiKeyConfigured?: boolean;
  modelRuntime: ModelRuntimeStatus;
}

async function pingEndpoint(
  app: ServerContext["app"],
  providerName: RegisteredProviderName,
  endpoint: string,
  path: string,
  headers?: Record<string, string>
): Promise<PlannerHealth> {
  const requestUrl = joinEndpoint(endpoint, path);
  try {
    const response = await fetch(requestUrl, { headers });
    return {
      ok: response.ok,
      plannerModel: app.config.plannerModel,
      providerName,
      providerLabel: getProviderDisplayName(providerName),
      mode: getProviderMode(providerName),
      endpoint,
      detail: response.ok ? "endpoint reachable" : `${response.status} ${response.statusText}`,
      apiKeyConfigured: providerName === "openai-compatible" ? Boolean(app.config.cloudApiKey) : undefined,
      modelRuntime: app.modelManager.getStatus()
    };
  } catch (err) {
    return {
      ok: false,
      plannerModel: app.config.plannerModel,
      providerName,
      providerLabel: getProviderDisplayName(providerName),
      mode: getProviderMode(providerName),
      endpoint,
      detail: err instanceof Error ? err.message : String(err),
      apiKeyConfigured: providerName === "openai-compatible" ? Boolean(app.config.cloudApiKey) : undefined,
      modelRuntime: app.modelManager.getStatus()
    };
  }
}

export async function plannerHealthCheck(ctx: ServerContext): Promise<PlannerHealth> {
  const { app } = ctx;
  const modelRuntime = app.modelManager.getStatus();
  const providerName = getProviderNameForModel(app.config.plannerModel, {
    builtinAvailable: modelRuntime.builtinReady,
    cloudAvailable: Boolean(app.config.cloudApiKey)
  });

  if (providerName === "builtin") {
    if (!modelRuntime.llamaCppAvailable) {
      return {
        ok: false,
        plannerModel: app.config.plannerModel,
        providerName,
        providerLabel: getProviderDisplayName(providerName),
        mode: getProviderMode(providerName),
        detail: "Built-in runtime unavailable. Install node-llama-cpp or switch to a cloud/openai-compatible model.",
        modelRuntime
      };
    }

    if (modelRuntime.modelCount === 0) {
      return {
        ok: false,
        plannerModel: app.config.plannerModel,
        providerName,
        providerLabel: getProviderDisplayName(providerName),
        mode: getProviderMode(providerName),
        detail: `No local GGUF model found in ${modelRuntime.modelsDir}`,
        modelRuntime
      };
    }

    const activeModel = modelRuntime.currentModelId ?? modelRuntime.availableModels[0];
    return {
      ok: true,
      plannerModel: app.config.plannerModel,
      providerName,
      providerLabel: getProviderDisplayName(providerName),
      mode: getProviderMode(providerName),
      detail: modelRuntime.loaded
        ? `Built-in runtime ready with ${activeModel}`
        : `Built-in runtime ready. ${activeModel} will auto-load on first request.`,
      modelRuntime
    };
  }

  if (providerName === "ollama-compatible") {
    return pingEndpoint(app, providerName, app.config.localModelEndpoint, "/api/tags");
  }

  if (providerName === "lmstudio") {
    return pingEndpoint(app, providerName, app.config.lmstudioEndpoint, "/models");
  }

  if (providerName === "vllm") {
    return pingEndpoint(app, providerName, app.config.vllmEndpoint, "/models");
  }

  if (providerName === "llama-cpp") {
    return pingEndpoint(app, providerName, app.config.llamaCppEndpoint, "/models");
  }

  if (!app.config.cloudApiKey) {
    return {
      ok: false,
      plannerModel: app.config.plannerModel,
      providerName,
      providerLabel: getProviderDisplayName(providerName),
      mode: getProviderMode(providerName),
      endpoint: app.config.cloudModelEndpoint,
      detail: "Cloud provider selected but CLOUD_API_KEY is missing.",
      apiKeyConfigured: false,
      modelRuntime
    };
  }

  return pingEndpoint(
    app,
    providerName,
    app.config.cloudModelEndpoint,
    "/models",
    { authorization: `Bearer ${app.config.cloudApiKey}` }
  );
}

// Cached hardware info — computed once on first request
let _hwCache: { hardware: HardwareInfo; tier: string; recommendations: ModelRecommendation[] } | null = null;

export async function handleGetHardware(_ctx: ServerContext) {
  if (!_hwCache) {
    const hardware = detectHardware();
    const { tier, recommendations } = getModelRecommendations(hardware);
    _hwCache = { hardware, tier, recommendations };
  }
  return _hwCache;
}

export async function handleGetHealth(ctx: ServerContext) {
  const health = await plannerHealthCheck(ctx);
  return { health };
}

export async function handleGetSystem(ctx: ServerContext) {
  const { app } = ctx;
  const [health, experienceStats] = await Promise.all([
    plannerHealthCheck(ctx),
    app.experiences.getStats()
  ]);
  return {
    plannerModel: app.config.plannerModel,
    executorModel: app.config.executorModel,
    criticModel: app.config.criticModel,
    health,
    models: app.modelManager.getStatus(),
    experienceStats,
    tools: app.availableTools,
    toolsDetailed: app.availableToolsDetailed,
    capabilityReport: app.capabilityReport
  };
}

export async function handleGetTools(ctx: ServerContext) {
  const tools = ctx.app.availableToolsDetailed;
  return {
    tools: tools.map(t => ({
      ...t,
      description: translateDescription(t.description, ctx.locale),
      unavailableReason: t.unavailableReason
        ? translateDescription(t.unavailableReason, ctx.locale)
        : undefined
    }))
  };
}

export async function handleGetExperiences(ctx: ServerContext) {
  const experiences = await ctx.app.experiences.list();
  return { experiences };
}

export async function handleGetAudit(ctx: ServerContext, taskId?: string) {
  if (taskId) {
    const stats = ctx.app.audit.getTaskStats(taskId);
    return { records: ctx.app.audit.list(taskId), stats };
  }
  return {
    records: ctx.app.audit.list(),
    taskIds: ctx.app.audit.listTaskIds(),
    totalRecords: ctx.app.audit.size,
  };
}

// ─── Voice transcription (STT) ──────────────────────────────────────────────────

export async function handlePostVoiceTranscribe(ctx: ServerContext, req: IncomingMessage) {
  const { app } = ctx;
  const body = (await readJsonBody(req)) as {
    dataBase64?: string;
    mimeType?: string;
    language?: string;
  };

  if (!body.dataBase64) {
    return { status: 400, data: { error: "dataBase64 is required" } };
  }

  // Determine file extension from MIME type
  const mimeToExt: Record<string, string> = {
    "audio/webm": "webm", "audio/wav": "wav", "audio/wave": "wav",
    "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a",
    "audio/ogg": "ogg", "audio/flac": "flac"
  };
  const ext = mimeToExt[body.mimeType || ""] || "webm";
  const tmpFile = join(tmpdir(), `voice_${Date.now()}.${ext}`);

  try {
    // Decode base64 and write temp file
    const audioBuf = Buffer.from(body.dataBase64, "base64");
    await writeFile(tmpFile, audioBuf);

    // Try OpenAI Whisper API first (fastest, no local setup needed)
    const apiKey = process.env.OPENAI_API_KEY || process.env.CLOUD_API_KEY || app.config.cloudApiKey;
    if (apiKey) {
      const transcription = await transcribeWithOpenAI(tmpFile, ext, body.language, apiKey);
      if (transcription !== null) {
        await unlink(tmpFile).catch(() => {});
        return { status: 200, data: { text: transcription, engine: "openai-whisper" } };
      }
    }

    // Try local whisper.cpp
    const whisperBin = findLocalWhisper();
    const whisperModel = whisperBin ? findLocalWhisperModel() : null;
    if (whisperBin && whisperModel) {
      const transcription = await transcribeWithWhisperCpp(tmpFile, whisperBin, whisperModel, body.language);
      if (transcription !== null) {
        await unlink(tmpFile).catch(() => {});
        return { status: 200, data: { text: transcription, engine: "whisper-cpp" } };
      }
    }

    await unlink(tmpFile).catch(() => {});
    return {
      status: 400,
      data: {
        error: "No STT engine available. Set OPENAI_API_KEY or install whisper.cpp.",
        tip: "whisper.cpp: git clone https://github.com/ggerganov/whisper.cpp && cd whisper.cpp && make"
      }
    };
  } catch (e: any) {
    await unlink(tmpFile).catch(() => {});
    return { status: 500, data: { error: e.message } };
  }
}

function findLocalWhisper(): string | null {
  const isWin = process.platform === "win32";
  const paths = [
    join(process.cwd(), "whisper.cpp", "build", "bin", isWin ? "whisper-cli.exe" : "whisper-cli"),
    join(process.cwd(), "whisper.cpp", isWin ? "main.exe" : "main"),
    isWin ? "whisper-cli.exe" : "whisper-cli",
    "whisper",
  ];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

function findLocalWhisperModel(): string | null {
  const modelPaths = [
    join(process.cwd(), "whisper.cpp", "models", "ggml-base.bin"),
    join(process.cwd(), "whisper.cpp", "models", "ggml-small.bin"),
    join(process.cwd(), "whisper.cpp", "models", "ggml-tiny.bin"),
    join(process.cwd(), "whisper.cpp", "models", "ggml-medium.bin"),
  ];
  for (const p of modelPaths) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function transcribeWithWhisperCpp(
  inputFile: string, whisperBin: string, modelPath: string, language?: string
): Promise<string | null> {
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const args = ["-m", modelPath, "-f", inputFile, "-otxt", "-of", inputFile.replace(/\.[^.]+$/, "")];
    if (language) args.push("-l", language);
    const proc = spawn(whisperBin, args, { stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", async (code) => {
      if (code === 0) {
        const outPath = inputFile.replace(/\.[^.]+$/, ".txt");
        if (existsSync(outPath)) {
          try {
            const text = await readFile(outPath, "utf-8");
            await unlink(outPath).catch(() => {});
            resolve(text.trim());
            return;
          } catch {}
        }
      }
      resolve(null);
    });
    proc.on("error", () => resolve(null));
  });
}

async function transcribeWithOpenAI(
  inputFile: string, ext: string, language: string | undefined, apiKey: string
): Promise<string | null> {
  try {
    const audioBuffer = await readFile(inputFile);
    const mimeMap: Record<string, string> = {
      webm: "audio/webm", wav: "audio/wav", mp3: "audio/mpeg",
      m4a: "audio/mp4", ogg: "audio/ogg", flac: "audio/flac"
    };
    const mimeType = mimeMap[ext] || "audio/webm";

    const boundary = `----Voice${Date.now()}`;
    const parts: Buffer[] = [];
    const addPart = (name: string, value: string) => {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
    };
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`));
    parts.push(audioBuffer);
    parts.push(Buffer.from(`\r\n`));
    addPart("model", "whisper-1");
    if (language) addPart("language", language);
    parts.push(Buffer.from(`--${boundary}--\r\n`));

    const baseUrl = process.env.OPENAI_BASE_URL || process.env.CLOUD_MODEL_ENDPOINT || "https://api.openai.com/v1";
    const endpoint = baseUrl.replace(/\/+$/, "") + "/audio/transcriptions";

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`
      },
      body: Buffer.concat(parts)
    });

    if (!response.ok) return null;
    const data = await response.json() as { text?: string };
    return data.text?.trim() || null;
  } catch {
    return null;
  }
}
