import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, json, error, type ServerContext } from "../util.js";

/** Merge key=value entries into .env.local, preserving unmentioned keys */
async function mergeEnvLocal(updates: Record<string, string>): Promise<void> {
  const envPath = join(process.cwd(), ".env.local");
  const existing: Map<string, string> = new Map();
  if (existsSync(envPath)) {
    try {
      const raw = await readFile(envPath, "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          existing.set(trimmed.slice(0, eqIdx), trimmed.slice(eqIdx + 1));
        }
      }
    } catch { /* ignore parse errors, will overwrite */ }
  }
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined || value === "") {
      existing.delete(key);
    } else {
      existing.set(key, value);
    }
  }
  const lines = Array.from(existing.entries()).map(([k, v]) => `${k}=${v}`);
  await writeFile(envPath, `${lines.join("\n")}\n`, "utf8");
}
import {
  getProviderDisplayName,
  getProviderMode,
  getProviderNameForModel,
  joinEndpoint,
  type RegisteredProviderName
} from "../../model/provider-utils.js";
import { buildModelProfiles } from "../../model/model-profiles.js";
import { buildProductCapabilities } from "../../product/capabilities.js";
import { buildCapabilityRoutePlan } from "../../capabilities/capability-router.js";
import { resolveTaskIntent } from "../../tasks/task-intent.js";

export async function handleGetConfig(ctx: ServerContext) {
  const { app } = ctx;
  return {
    plannerModel: app.config.plannerModel,
    executorModel: app.config.executorModel,
    criticModel: app.config.criticModel,
    cloudModelEndpoint: app.config.cloudModelEndpoint,
    comfyuiEndpoint: app.config.comfyuiEndpoint,
    openaiImageModel: app.config.openaiImageModel,
    openaiTtsModel: app.config.openaiTtsModel,
    openaiTtsVoice: app.config.openaiTtsVoice,
    localModelEndpoint: app.config.localModelEndpoint,
    lmstudioEndpoint: app.config.lmstudioEndpoint,
    vllmEndpoint: app.config.vllmEndpoint,
    llamaCppEndpoint: app.config.llamaCppEndpoint,
    cloudApiKey: app.config.cloudApiKey,
    envFiles: app.config.envFiles,
    modelsDir: app.config.modelsDir,
    taskStorePath: app.config.taskStorePath,
    mediaJobStorePath: app.config.mediaJobStorePath,
    approvalStorePath: app.config.approvalStorePath,
    uploadsDir: app.config.uploadsDir,
    artifactsDir: app.config.artifactsDir,
    generatedMediaDir: app.config.generatedMediaDir,
    maxPlanningCycles: app.config.maxPlanningCycles,
    maxConcurrentTasks: app.config.maxConcurrentTasks,
    maxTaskRetries: app.config.maxTaskRetries,
    failureReplayLimit: app.config.failureReplayLimit,
    allowHighRiskTools: app.config.allowHighRiskTools,
    requireApprovalForHighRisk: app.config.requireApprovalForHighRisk,
    approvalPolicyPreset: app.config.approvalPolicyPreset,
    approvalAutoAllowCommands: app.config.approvalAutoAllowCommands,
    readRoots: app.config.readRoots,
    writeRoots: app.config.writeRoots,
    shellAllowlist: app.config.shellAllowlist,
    webAllowlist: app.config.webAllowlist,
    locale: app.config.locale
  };
}

export async function handleGetModels(ctx: ServerContext) {
  return {
    status: ctx.app.modelManager.getStatus(),
    models: ctx.app.modelManager.listModels()
  };
}

export async function handlePostModelLoad(ctx: ServerContext, req: IncomingMessage) {
  const body = (await readJsonBody(req)) as { modelId?: string };
  if (!body.modelId) {
    return { status: 400, data: { error: "modelId is required" } };
  }
  const loaded = await ctx.app.modelManager.loadModel(body.modelId);
  if (!loaded) {
    return { status: 400, data: { error: `Failed to load model: ${body.modelId}` } };
  }
  return { status: 200, data: { loaded: true, modelId: body.modelId } };
}

export async function handlePostModelUnload(ctx: ServerContext) {
  ctx.app.modelManager.unloadModel();
  return { status: 200, data: { unloaded: true } };
}

export async function handlePostModelDownload(ctx: ServerContext, req: IncomingMessage) {
  const body = (await readJsonBody(req)) as { url?: string; filename?: string };
  if (!body.url) {
    return { status: 400, data: { error: "url is required" } };
  }
  try {
    const filename = await ctx.app.modelManager.addModelFromUrl(body.url, body.filename);
    if (filename) {
      return { status: 200, data: { downloaded: true, filename } };
    }
    return { status: 400, data: { error: "Download failed" } };
  } catch (e: any) {
    return { status: 500, data: { error: e.message } };
  }
}

export async function handlePostModelDownloadStream(ctx: ServerContext, req: IncomingMessage, res: ServerResponse) {
  const body = (await readJsonBody(req)) as { url?: string; filename?: string };
  if (!body.url) {
    json(res, 400, { error: "url is required" });
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "x-accel-buffering": "no"
  });

  const sendSSE = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await ctx.app.modelManager.addModelFromUrlStream(
      body.url,
      body.filename || undefined,
      (progress) => {
        sendSSE("progress", progress);
      }
    );
    sendSSE("complete", { filename: result.filename, resumed: result.resumed });
  } catch (e: any) {
    sendSSE("error", { message: e.message || String(e) });
  } finally {
    res.end();
  }
}

export async function handlePostModelDelete(ctx: ServerContext, req: IncomingMessage) {
  const body = (await readJsonBody(req)) as { modelId?: string };
  if (!body.modelId) {
    return { status: 400, data: { error: "modelId is required" } };
  }
  try {
    const deleted = await ctx.app.modelManager.removeModel(body.modelId);
    if (deleted) {
      return { status: 200, data: { deleted: true, modelId: body.modelId } };
    }
    return { status: 400, data: { error: `Failed to delete model: ${body.modelId}` } };
  } catch (e: any) {
    return { status: 500, data: { error: e.message } };
  }
}

export async function handleGetModelProfiles(ctx: ServerContext) {
  const profiles = buildModelProfiles({
    config: ctx.app.config,
    modelRuntime: ctx.app.modelManager.getStatus()
  });
  return { profiles };
}

export async function handleGetModelOptions(ctx: ServerContext) {
  const { app } = ctx;
  const modelRuntime = app.modelManager.getStatus();
  const builtinModels = app.modelManager.listModels().map((model) => ({
    label: `builtin:${model.id}`,
    value: `builtin:${model.id}`,
    provider: "builtin",
    source: "local-gguf"
  }));

  // Cloud provider models — derive from known providers based on configured endpoint
  const knownCloudModels: Record<string, string[]> = {
    "api.deepseek.com": ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"],
    "api.openai.com": ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3-mini", "o4-mini"],
    "api.anthropic.com": ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"],
    "generativelanguage.googleapis.com": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
    "dashscope.aliyuncs.com": ["qwen-plus", "qwen-max", "qwen-turbo"],
    "open.bigmodel.cn": ["glm-4-plus", "glm-4-flash", "glm-4"],
    "api.moonshot.cn": ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"]
  };

  let cloudModels: { label: string; value: string; provider: string; source: string }[] = [];
  if (app.config.cloudApiKey && app.config.cloudModelEndpoint) {
    try {
      const hostname = new URL(app.config.cloudModelEndpoint).hostname;
      const models = knownCloudModels[hostname] || [];
      cloudModels = models.map(m => ({
        label: `cloud:${m}`,
        value: `cloud:${m}`,
        provider: "Cloud API",
        source: "cloud"
      }));
    } catch { /* ignore invalid endpoint */ }
  }

  const profileModels = buildModelProfiles({ config: app.config, modelRuntime })
    .flatMap((profile) => [profile.env.PLANNER_MODEL, profile.env.EXECUTOR_MODEL, profile.env.CRITIC_MODEL])
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index)
    .map((value) => ({
      label: value,
      value,
      provider: getProviderDisplayName(
        getProviderNameForModel(value, {
          builtinAvailable: modelRuntime.builtinReady,
          cloudAvailable: Boolean(app.config.cloudApiKey)
        })
      ),
      source: "profile"
    }));

  const recommended = [
    { label: "builtin:default", value: "builtin:default", provider: "Built-in llama.cpp", source: "recommended" }
  ];

  const options = [...recommended, ...builtinModels, ...cloudModels, ...profileModels]
    .filter((item, index, all) => all.findIndex((entry) => entry.value === item.value) === index);

  return { options };
}

export async function handlePostModelSettings(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const { app } = ctx;
  const body = (await readJsonBody(req)) as {
    plannerModel?: string;
    executorModel?: string;
    criticModel?: string;
    cloudModelEndpoint?: string;
    cloudApiKey?: string;
    localModelEndpoint?: string;
    lmstudioEndpoint?: string;
    vllmEndpoint?: string;
    llamaCppEndpoint?: string;
    comfyuiEndpoint?: string;
    openaiImageModel?: string;
    openaiTtsModel?: string;
    openaiTtsVoice?: string;
  };
  const plannerModel = body.plannerModel?.trim();
  const executorModel = body.executorModel?.trim();
  const criticModel = body.criticModel?.trim();
  if (!plannerModel || !executorModel || !criticModel) {
    return { status: 400, data: { error: "plannerModel, executorModel and criticModel are required" } };
  }

  const envLocalPath = join(process.cwd(), ".env.local");
  const updates: Record<string, string> = {
    PLANNER_MODEL: plannerModel,
    EXECUTOR_MODEL: executorModel,
    CRITIC_MODEL: criticModel,
  };
  if (body.cloudModelEndpoint?.trim()) updates.CLOUD_MODEL_ENDPOINT = body.cloudModelEndpoint.trim();
  if (typeof body.cloudApiKey === "string") updates.CLOUD_API_KEY = body.cloudApiKey;
  if (body.localModelEndpoint?.trim()) updates.LOCAL_MODEL_ENDPOINT = body.localModelEndpoint.trim();
  if (body.lmstudioEndpoint?.trim()) updates.LMSTUDIO_ENDPOINT = body.lmstudioEndpoint.trim();
  if (body.vllmEndpoint?.trim()) updates.VLLM_ENDPOINT = body.vllmEndpoint.trim();
  if (body.llamaCppEndpoint?.trim()) updates.LLAMA_CPP_ENDPOINT = body.llamaCppEndpoint.trim();
  if (body.comfyuiEndpoint?.trim()) updates.COMFYUI_ENDPOINT = body.comfyuiEndpoint.trim();
  if (body.openaiImageModel?.trim()) updates.OPENAI_IMAGE_MODEL = body.openaiImageModel.trim();
  if (body.openaiTtsModel?.trim()) updates.OPENAI_TTS_MODEL = body.openaiTtsModel.trim();
  if (body.openaiTtsVoice?.trim()) updates.OPENAI_TTS_VOICE = body.openaiTtsVoice.trim();
  await mergeEnvLocal(updates);

  app.reconfigureModels({
    plannerModel,
    executorModel,
    criticModel,
    cloudModelEndpoint: body.cloudModelEndpoint?.trim(),
    cloudApiKey: body.cloudApiKey,
    localModelEndpoint: body.localModelEndpoint?.trim(),
    lmstudioEndpoint: body.lmstudioEndpoint?.trim(),
    vllmEndpoint: body.vllmEndpoint?.trim(),
    llamaCppEndpoint: body.llamaCppEndpoint?.trim(),
    comfyuiEndpoint: body.comfyuiEndpoint?.trim()
  });
  if (body.comfyuiEndpoint?.trim()) {
    app.config.comfyuiEndpoint = body.comfyuiEndpoint.trim();
  }
  if (body.openaiImageModel?.trim()) {
    app.config.openaiImageModel = body.openaiImageModel.trim();
  }
  if (body.openaiTtsModel?.trim()) {
    app.config.openaiTtsModel = body.openaiTtsModel.trim();
  }
  if (body.openaiTtsVoice?.trim()) {
    app.config.openaiTtsVoice = body.openaiTtsVoice.trim();
  }

  return {
    status: 200,
    data: {
      saved: true,
      applied: true,
      restartRequired: false,
      path: envLocalPath
    }
  };
}

export async function handlePostCapabilitiesRoute(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const { app } = ctx;
  const body = (await readJsonBody(req)) as {
    goal?: string;
    taskType?: import("../../core/types.js").TaskType;
    outputFormat?: import("../../core/types.js").OutputFormat;
    attachments?: import("../../core/types.js").TaskAttachment[];
  };
  const goal = body.goal?.trim();
  if (!goal) {
    return { status: 400, data: { error: "goal is required" } };
  }
  const intent = resolveTaskIntent({
    goal,
    taskType: body.taskType,
    outputFormat: body.outputFormat,
    attachments: body.attachments
  });
  const capabilityPlan = buildCapabilityRoutePlan({
    goal,
    intent,
    availableTools: app.availableTools,
    skills: app.skills.list()
  });
  return { status: 200, data: { intent, capabilityPlan } };
}

export async function handlePostConfig(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const { app } = ctx;
  const body = (await readJsonBody(req)) as {
    allowHighRiskTools?: boolean;
    requireApprovalForHighRisk?: boolean;
    approvalPolicyPreset?: string;
  };

  const updates: Record<string, string> = {};

  if (typeof body.allowHighRiskTools === "boolean") {
    app.config.allowHighRiskTools = body.allowHighRiskTools;
    app.riskPolicy.update({ allowHighRisk: body.allowHighRiskTools });
    updates.ALLOW_HIGH_RISK_TOOLS = String(body.allowHighRiskTools);
  }

  if (typeof body.requireApprovalForHighRisk === "boolean") {
    app.config.requireApprovalForHighRisk = body.requireApprovalForHighRisk;
    app.riskPolicy.update({ requireApprovalForHighRisk: body.requireApprovalForHighRisk });
    updates.REQUIRE_APPROVAL_FOR_HIGH_RISK = String(body.requireApprovalForHighRisk);
  }

  if (typeof body.approvalPolicyPreset === "string" && body.approvalPolicyPreset.trim()) {
    const preset = body.approvalPolicyPreset.trim() as "strict" | "balanced" | "permissive";
    app.config.approvalPolicyPreset = preset;
    app.riskPolicy.update({ approvalPolicyPreset: preset });
    updates.APPROVAL_POLICY_PRESET = preset;
  }

  if (Object.keys(updates).length > 0) {
    await mergeEnvLocal(updates);
  }

  return {
    status: 200,
    data: {
      saved: true,
      allowHighRiskTools: app.config.allowHighRiskTools,
      requireApprovalForHighRisk: app.config.requireApprovalForHighRisk,
      approvalPolicyPreset: app.config.approvalPolicyPreset
    }
  };
}

export async function handlePostLocale(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const { app } = ctx;
  const body = (await readJsonBody(req)) as { locale?: string };

  if (body.locale && (body.locale === "zh" || body.locale === "en")) {
    app.config.locale = body.locale;
    await mergeEnvLocal({ LOCALE: body.locale });
    return { status: 200, data: { locale: body.locale, saved: true } };
  }

  return { status: 200, data: { locale: app.config.locale } };
}

export async function handleGetProductCapabilities(ctx: ServerContext) {
  const { app } = ctx;
  const capabilities = await buildProductCapabilities({
    config: app.config,
    availableTools: app.availableTools,
    automationRegistry: app.automationRegistry,
    taskStore: ctx.taskStore,
    approvalStore: app.approvalStore
  });
  return { capabilities };
}
