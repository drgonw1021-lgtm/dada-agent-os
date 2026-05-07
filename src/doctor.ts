import { loadConfig } from "./config.js";
import { createModelManager } from "./model/model-manager.js";
import { getProviderDisplayName, getProviderNameForModel } from "./model/provider-utils.js";
import { totalmem, freemem, cpus, platform } from "node:os";
import { execSync } from "node:child_process";
import { detectLocale, t } from "./core/i18n.js";

// ─── Hardware detection ──────────────────────────────────────────────────────────

export interface HardwareInfo {
  ramTotalGB: number;
  ramFreeGB: number;
  cpuCores: number;
  platform: string;
  gpu: { detected: boolean; vendor: string; model?: string; vramMB?: number } | null;
}

export function detectHardware(): HardwareInfo {
  const ramTotal = totalmem();
  const ramFree = freemem();
  const cpuCount = cpus().length;

  let gpu: HardwareInfo["gpu"] = null;

  // Try NVIDIA detection
  try {
    const nvidiaBuf = execSync("nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits", {
      timeout: 5000, stdio: "pipe"
    } as any);
    const nvidia = nvidiaBuf.toString().trim();
    if (nvidia) {
      const [model, vram] = nvidia.split(",").map((s: string) => s.trim());
      gpu = { detected: true, vendor: "NVIDIA", model, vramMB: vram ? parseInt(vram) : undefined };
    }
  } catch { /* no NVIDIA GPU/tool */ }

  // Try Metal (macOS)
  if (!gpu && platform() === "darwin") {
    try {
      const metalBuf = execSync("system_profiler SPDisplaysDataType 2>/dev/null | grep Chip", {
        timeout: 5000, stdio: "pipe", shell: true
      } as any);
      const metal = metalBuf.toString().trim();
      if (metal) {
        gpu = { detected: true, vendor: "Apple", model: metal.split(":")[1]?.trim() || "Apple Silicon" };
      }
    } catch { /* no Metal info */ }
  }

  return {
    ramTotalGB: Math.round(ramTotal / (1024 ** 3)),
    ramFreeGB: Math.round(ramFree / (1024 ** 3)),
    cpuCores: cpuCount,
    platform: platform(),
    gpu,
  };
}

// ─── Model recommendations ──────────────────────────────────────────────────────

export interface ModelRecommendation {
  tier: string;
  ramNeeded: number;
  vramNeeded: number;
  models: Array<{ id: string; description: string; why: string }>;
}

export function getModelRecommendations(hw: HardwareInfo): { tier: string; recommendations: ModelRecommendation[] } {
  const vramGB = hw.gpu?.vramMB ? hw.gpu.vramMB / 1024 : 0;
  const ramGB = hw.ramTotalGB;

  const tiers: ModelRecommendation[] = [
    {
      tier: "minimal",
      ramNeeded: 4,
      vramNeeded: 0,
      models: [
        { id: "Qwen2.5-1.5B-Instruct-Q4_K_M.gguf", description: "Qwen2.5 1.5B (Q4_K_M)", why: "最小可用模型，适合 4GB RAM 设备" },
        { id: "Llama-3.2-1B-Instruct-Q4_K_M.gguf", description: "Llama 3.2 1B (Q4_K_M)", why: "Meta 最新小模型，支持 function calling" },
      ],
    },
    {
      tier: "entry",
      ramNeeded: 8,
      vramNeeded: 0,
      models: [
        { id: "Qwen2.5-7B-Instruct-Q4_K_M.gguf", description: "Qwen2.5 7B (Q4_K_M)", why: "中文优秀，7B 级别最佳性价比" },
        { id: "Llama-3.1-8B-Instruct-Q4_K_M.gguf", description: "Llama 3.1 8B (Q4_K_M)", why: "Meta 旗舰 8B，工具调用可靠" },
      ],
    },
    {
      tier: "balanced",
      ramNeeded: 16,
      vramNeeded: 6,
      models: [
        { id: "Qwen2.5-14B-Instruct-Q4_K_M.gguf", description: "Qwen2.5 14B (Q4_K_M)", why: "中文推理优秀，适合大部分任务" },
        { id: "Llama-3.3-12B-Instruct-Q4_K_M.gguf", description: "Llama 3.3 12B (Q4_K_M)", why: "Llama 3 系列最新，支持多语言" },
        { id: "Mistral-Small-22B-ArliAI-Q4_K_M.gguf", description: "Mistral Small 22B (Q4_K_M)", why: "Mistral 高效模型，代码能力强" },
      ],
    },
    {
      tier: "pro",
      ramNeeded: 32,
      vramNeeded: 12,
      models: [
        { id: "Qwen2.5-32B-Instruct-Q4_K_M.gguf", description: "Qwen2.5 32B (Q4_K_M)", why: "中文能力接近云端模型" },
        { id: "Llama-3.3-70B-Instruct-Q2_K.gguf", description: "Llama 3.3 70B (Q2_K)", why: "70B 量化版，推理能力极强" },
      ],
    },
    {
      tier: "extreme",
      ramNeeded: 64,
      vramNeeded: 24,
      models: [
        { id: "Qwen2.5-72B-Instruct-Q4_K_M.gguf", description: "Qwen2.5 72B (Q4_K_M)", why: "中文顶级理解，适合复杂推理" },
        { id: "DeepSeek-V3-0324-Q4_K_M.gguf", description: "DeepSeek V3 (Q4_K_M)", why: "顶级本地推理模型" },
      ],
    },
  ];

  // Find the best tier the hardware can support
  const usableTiers = tiers.filter((t) => {
    const ramOK = ramGB >= t.ramNeeded;
    const vramOK = vramGB > 0 ? vramGB >= t.vramNeeded : ramGB >= t.ramNeeded + 4; // GPU-less: need extra RAM
    return ramOK && vramOK;
  });

  const bestTier = usableTiers.length > 0 ? usableTiers[usableTiers.length - 1] : tiers[0];

  return { tier: bestTier.tier, recommendations: usableTiers };
}

// ─── Main ────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const config = loadConfig(process.env);
  const locale = detectLocale(process.env);
  const modelManager = createModelManager({
    modelsDir: config.modelsDir,
    builtinGpu: config.builtinGpu
  });

  await modelManager.initialize();
  const modelStatus = modelManager.getStatus();
  const providerName = getProviderNameForModel(config.plannerModel, {
    builtinAvailable: modelStatus.builtinReady,
    cloudAvailable: Boolean(config.cloudApiKey)
  });

  const hw = detectHardware();
  const { tier, recommendations } = getModelRecommendations(hw);

  const issues: string[] = [];

  if (config.envFiles.length === 0) {
    issues.push(locale === "zh"
      ? "未检测到 .env 或 .env.local，当前仅使用系统环境变量与默认值。"
      : "No .env or .env.local detected, using system env vars and defaults only.");
  }

  if (providerName === "builtin" && modelStatus.modelCount === 0) {
    issues.push(locale === "zh"
      ? `内置模型模式已启用，但 ${config.modelsDir} 下没有可用的 GGUF 模型。`
      : `Built-in model mode is enabled, but no GGUF models found in ${config.modelsDir}.`);
  }

  if (providerName === "openai-compatible" && !config.cloudApiKey) {
    issues.push(locale === "zh"
      ? "当前配置使用云端模型，但缺少 CLOUD_API_KEY。"
      : "Cloud model provider is configured, but CLOUD_API_KEY is missing.");
  }

  if (config.readRoots.length === 0 || config.writeRoots.length === 0) {
    issues.push(locale === "zh"
      ? "READ_ROOTS / WRITE_ROOTS 为空，文件工具可能无法正常工作。"
      : "READ_ROOTS / WRITE_ROOTS is empty; file tools may not work properly.");
  }

  const report = {
    envFiles: config.envFiles,
    plannerModel: config.plannerModel,
    resolvedProvider: {
      name: providerName,
      label: getProviderDisplayName(providerName)
    },
    hardware: {
      ramTotalGB: hw.ramTotalGB,
      ramFreeGB: hw.ramFreeGB,
      cpuCores: hw.cpuCores,
      platform: hw.platform,
      gpu: hw.gpu,
    },
    recommendationTier: tier,
    recommendedModels: recommendations.flatMap((r) =>
      r.models.map((m) => ({ ...m, tier: r.tier }))
    ),
    models: modelStatus,
    sandbox: {
      readRoots: config.readRoots,
      writeRoots: config.writeRoots,
      shellAllowlist: config.shellAllowlist,
      webAllowlist: config.webAllowlist
    },
    issues
  };

  console.log(JSON.stringify(report, null, 2));

  // Recommendations
  if (modelStatus.modelCount === 0 && providerName === "builtin") {
    console.log(locale === "zh" ? "\n📥 推荐下载的模型:" : "\n📥 Recommended models to download:");
    const bestRecs = recommendations[recommendations.length - 1];
    if (bestRecs) {
      for (const m of bestRecs.models) {
        console.log(`  - ${m.id}`);
        console.log(`    ${m.description}`);
        console.log(`    ${m.why}`);
        console.log();
      }
    }
    console.log(locale === "zh"
      ? "下载命令: npm run download-model -- <model-id>"
      : "Download: npm run download-model -- <model-id>");
  }

  if (issues.length > 0) {
    console.log(locale === "zh" ? "\n建议：" : "\nSuggestions:");
    for (const issue of issues) {
      console.log(`- ${issue}`);
    }
  } else {
    console.log(locale === "zh" ? "\n✅ 状态良好：当前配置可直接运行。" : "\n✅ All good: configuration is ready to run.");
  }

  // Hardware summary
  const gpuStr = hw.gpu
    ? `${hw.gpu.vendor} ${hw.gpu.model || ""}${hw.gpu.vramMB ? ` (${hw.gpu.vramMB}MB VRAM)` : ""}`
    : (locale === "zh" ? "未检测到" : "Not detected");
  console.log(locale === "zh" ? `\n🖥 硬件: ${hw.ramTotalGB}GB RAM, ${hw.cpuCores} 核, GPU: ${gpuStr}` : `\n🖥 Hardware: ${hw.ramTotalGB}GB RAM, ${hw.cpuCores} cores, GPU: ${gpuStr}`);
  console.log(locale === "zh" ? `📊 推荐配置档位: ${tier}` : `📊 Recommended tier: ${tier}`);

  process.exit(0);
}

// Only run when executed directly (not imported by other modules)
const isMain = process.argv[1] && (process.argv[1].endsWith("doctor.js") || process.argv[1].endsWith("doctor.ts") || process.argv[1].endsWith("doctor"));
if (isMain) {
  main().catch((error) => {
    console.error("Doctor failed:", error);
    process.exit(1);
  });
}
