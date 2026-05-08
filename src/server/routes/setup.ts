import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { get } from "node:http";
import type { ServerResponse } from "node:http";
import { readJsonBody, json, type ServerContext } from "../util.js";
import { detectHardware, getModelRecommendations } from "../../doctor.js";

const SETUP_MARKER = ".agent/.setup-complete";

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
    } catch { /* ignore parse errors */ }
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

async function detectComfyUI(): Promise<{ installed: boolean; running: boolean; path: string | null }> {
  // Check common ComfyUI install locations
  const candidates = [
    join(process.cwd(), "ComfyUI"),
    join(process.cwd(), "..", "ComfyUI"),
    "C:\\ComfyUI",
    join(process.env.USERPROFILE || "C:\\Users", "ComfyUI"),
    join(process.env.HOME || "/home", "ComfyUI"),
  ];

  let comfyPath: string | null = null;
  for (const c of candidates) {
    if (existsSync(join(c, "main.py"))) {
      comfyPath = c;
      break;
    }
  }

  // Check if running by pinging the endpoint
  let running = false;
  try {
    const req = get("http://127.0.0.1:8188/object_info", { timeout: 2000 }, (res) => {
      running = res.statusCode === 200;
      res.resume();
    });
    req.on("error", () => {});
    req.end();
    // Small delay to let the callback fire
    await new Promise(r => setTimeout(r, 500));
  } catch { /* not running */ }

  return {
    installed: comfyPath !== null,
    running,
    path: comfyPath,
  };
}

/** Model recommendations for the setup wizard, unified view */
interface SetupModelEntry {
  id: string;
  name: string;
  size: string;
  sizeBytes: number;
  category: "dada" | "comfyui";
  subcategory: string; // "checkpoint", "vae", "clip", "upscale", "facedetection", "motion"
  description: string;
  downloadUrl: string;
  targetDir: string; // relative to install
}

const COMFYUI_MODELS: SetupModelEntry[] = [
  {
    id: "sd_xl_base_1.0",
    name: "SDXL Base 1.0",
    size: "6.9 GB",
    sizeBytes: 6900000000,
    category: "comfyui",
    subcategory: "checkpoint",
    description: "Stable Diffusion XL — 通用图像生成（txt2img、img2img）",
    downloadUrl: "https://huggingface.co/stabilityai/stable-diffusion-xl-base-1.0/resolve/main/sd_xl_base_1.0.safetensors",
    targetDir: "models/checkpoints",
  },
  {
    id: "sdxl_vae",
    name: "SDXL VAE",
    size: "335 MB",
    sizeBytes: 335000000,
    category: "comfyui",
    subcategory: "vae",
    description: "图像编解码器，配合 SDXL 使用",
    downloadUrl: "https://huggingface.co/stabilityai/sdxl-vae/resolve/main/diffusion_pytorch_model.safetensors",
    targetDir: "models/vae",
  },
  {
    id: "z_image_turbo",
    name: "Z-Image Turbo",
    size: "6.0 GB",
    sizeBytes: 6000000000,
    category: "comfyui",
    subcategory: "checkpoint",
    description: "阿里通义 Z-Image — 4-8步快速中文生图",
    downloadUrl: "https://huggingface.co/Tongyi-MAI/Z-Image-Turbo/resolve/main/z-image-turbo.safetensors",
    targetDir: "models/checkpoints",
  },
  {
    id: "t5xxl_fp16",
    name: "T5 XXL FP16",
    size: "4.9 GB",
    sizeBytes: 4900000000,
    category: "comfyui",
    subcategory: "clip",
    description: "Z-Image 文本编码器",
    downloadUrl: "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/t5xxl_fp16.safetensors",
    targetDir: "models/clip",
  },
  {
    id: "clip_l",
    name: "CLIP-L",
    size: "246 MB",
    sizeBytes: 246000000,
    category: "comfyui",
    subcategory: "clip",
    description: "Z-Image 图像编码器",
    downloadUrl: "https://huggingface.co/comfyanonymous/flux_text_encoders/resolve/main/clip_l.safetensors",
    targetDir: "models/clip",
  },
  {
    id: "ae_vae",
    name: "AE VAE",
    size: "335 MB",
    sizeBytes: 335000000,
    category: "comfyui",
    subcategory: "vae",
    description: "Z-Image VAE 编解码器",
    downloadUrl: "https://huggingface.co/stabilityai/sd-vae-ft-mse-original/resolve/main/vae-ft-mse-840000-ema-pruned.safetensors",
    targetDir: "models/vae",
  },
  {
    id: "realesrgan_x4",
    name: "RealESRGAN x4",
    size: "67 MB",
    sizeBytes: 67000000,
    category: "comfyui",
    subcategory: "upscale",
    description: "图像超分辨率 4x 放大",
    downloadUrl: "https://huggingface.co/ai-forever/Real-ESRGAN/resolve/main/RealESRGAN_x4.pth",
    targetDir: "models/upscale_models",
  },
  {
    id: "codeformer",
    name: "CodeFormer",
    size: "377 MB",
    sizeBytes: 377000000,
    category: "comfyui",
    subcategory: "facedetection",
    description: "AI 面部修复与增强",
    downloadUrl: "https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/codeformer.pth",
    targetDir: "models/facedetection",
  },
];

export async function handleGetSetupStatus(ctx: ServerContext) {
  const setupComplete = existsSync(join(process.cwd(), SETUP_MARKER));
  const modelStatus = ctx.app.modelManager.getStatus();
  const hardware = detectHardware();
  const { tier, recommendations } = getModelRecommendations(hardware);
  const comfyui = await detectComfyUI();

  return {
    firstRun: !setupComplete && modelStatus.modelCount === 0,
    setupComplete,
    modelCount: modelStatus.modelCount,
    modelsDir: modelStatus.modelsDir,
    hardware,
    tier,
    recommendations,
    comfyuiEndpoint: ctx.app.config.comfyuiEndpoint,
    comfyui,
    comfyuiModels: COMFYUI_MODELS.map(m => ({
      ...m,
      // Check if already downloaded
      downloaded: existsSync(join(comfyui.path || "", m.targetDir, m.id + ".safetensors")) ||
                 existsSync(join(comfyui.path || "", m.targetDir, m.id + ".pth")),
    })),
  };
}

export async function handlePostSetupComplete(ctx: ServerContext, req: { comfyuiEndpoint?: string }) {
  const markerDir = join(process.cwd(), ".agent");
  if (!existsSync(markerDir)) {
    await mkdir(markerDir, { recursive: true });
  }
  await writeFile(join(process.cwd(), SETUP_MARKER), new Date().toISOString(), "utf8");

  if (req?.comfyuiEndpoint?.trim()) {
    await mergeEnvLocal({ COMFYUI_ENDPOINT: req.comfyuiEndpoint.trim() });
    ctx.app.config.comfyuiEndpoint = req.comfyuiEndpoint.trim();
  }

  return { status: 200, data: { setupComplete: true } };
}

export async function handlePostComfyUIInstall(ctx: ServerContext, req: unknown, res: ServerResponse) {
  const body = (req as { installDir?: string }) || {};
  const installDir = body.installDir || join(process.cwd(), "ComfyUI");

  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    "connection": "keep-alive",
    "x-accel-buffering": "no",
  });

  const sendSSE = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Check if git is available
    let gitOk = false;
    try {
      execSync("git --version", { timeout: 5000, stdio: "pipe" });
      gitOk = true;
    } catch { /* git not found */ }

    if (!gitOk) {
      sendSSE("error", { message: "Git is not installed. Please install Git first: https://git-scm.com/downloads" });
      res.end();
      return;
    }

    // Clone ComfyUI
    if (!existsSync(installDir)) {
      sendSSE("progress", { stage: "clone", message: "Cloning ComfyUI..." });
      execSync(`git clone https://github.com/comfyanonymous/ComfyUI.git "${installDir}"`, {
        timeout: 60000,
        stdio: "pipe",
      });
      sendSSE("progress", { stage: "clone_done", message: "ComfyUI cloned successfully" });
    } else {
      sendSSE("progress", { stage: "clone_skip", message: "ComfyUI directory already exists" });
    }

    // Check if Python is available
    let pythonCmd = "python";
    try {
      execSync("python --version", { timeout: 5000, stdio: "pipe" });
    } catch {
      try {
        execSync("python3 --version", { timeout: 5000, stdio: "pipe" });
        pythonCmd = "python3";
      } catch {
        sendSSE("error", { message: "Python is not installed. Please install Python 3.10+: https://python.org/downloads" });
        res.end();
        return;
      }
    }

    // Install requirements
    sendSSE("progress", { stage: "pip", message: "Installing ComfyUI dependencies (pip install)..." });
    execSync(`${pythonCmd} -m pip install -r "${installDir}/requirements.txt"`, {
      timeout: 300000,
      stdio: "pipe",
      cwd: installDir,
    });
    sendSSE("progress", { stage: "pip_done", message: "Dependencies installed" });

    // Update .env.local with the endpoint
    await mergeEnvLocal({ COMFYUI_ENDPOINT: "http://127.0.0.1:8188" });
    ctx.app.config.comfyuiEndpoint = "http://127.0.0.1:8188";

    sendSSE("complete", {
      message: "ComfyUI installed successfully. Start it with: python main.py --cpu",
      installDir,
    });
  } catch (e: any) {
    sendSSE("error", { message: e.message || String(e) });
  } finally {
    res.end();
  }
}
