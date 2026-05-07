import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { ModelManager } from "../../model/model-manager.js";

export interface VisionInput {
  imagePath?: string;
  imageUrl?: string;
  prompt?: string;
  mode?: "describe" | "analyze" | "detect" | "ocr";
}

export interface VisionOutput {
  success: boolean;
  description?: string;
  error?: string;
  model?: string;
}

// Model name patterns that indicate multimodal/vision capability
const MULTIMODAL_PATTERNS = [
  "llava", "bakllava", "llama-v", "gemma-3", "cogvlm",
  "minicpm-v", "phi-3-vision", "fuyu", "qwen-vl",
  "paligemma", "florence", "internvl"
];

function isMultimodalModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return MULTIMODAL_PATTERNS.some(p => lower.includes(p));
}

function getVisionTool(modelManager?: ModelManager): ToolDefinition<VisionInput, VisionOutput> {
  const hasLocalMultimodal = modelManager
    ? modelManager.listModels().some(m => isMultimodalModel(m.id))
    : false;
  const hasCloudApi = Boolean(process.env.OPENAI_API_KEY || process.env.CLOUD_API_KEY);

  const available = hasLocalMultimodal || hasCloudApi;
  const unavailableReason = available ? undefined
    : "No local multimodal model found and no cloud API key configured. Add a multimodal GGUF (llava, gemma-3, etc.) to models/ or set OPENAI_API_KEY.";

  return {
    id: "vision",
    description: "图像/视频分析：图像描述、目标检测、视觉问答。优先使用本地多模态模型，无本地模型时回退云端 API。",
    requiredScopes: ["web.fetch"] as PermissionScope[],
    inputSchema: {
      type: "object" as const,
      properties: {
        imagePath: { type: "string" as const, description: "Local path to image file" },
        imageUrl: { type: "string" as const, description: "URL of image to analyze" },
        prompt: { type: "string" as const, description: "Prompt for image analysis (default: '描述这张图片中的内容')" },
        mode: { type: "string" as const, enum: ["describe", "analyze", "detect", "ocr"], description: "Vision mode" }
      },
      required: []
    },
    async execute(input: VisionInput, _context: ToolContext): Promise<VisionOutput> {
      try {
        const imageSource = input.imagePath || input.imageUrl;
        if (!imageSource) {
          return { success: false, error: "imagePath or imageUrl is required" };
        }

        if (input.imagePath && !existsSync(input.imagePath)) {
          return { success: false, error: `File not found: ${input.imagePath}` };
        }

        // Build mode-specific prompt
        const modePrompt = buildModePrompt(input.mode || "describe", input.prompt);

        // Try local multimodal model first
        if (modelManager) {
          const localResult = await analyzeWithLocalModel(modelManager, imageSource, modePrompt);
          if (localResult) return localResult;
        }

        // Fall back to cloud API
        if (hasCloudApi) {
          return await analyzeWithCloudApi(imageSource, modePrompt);
        }

        return { success: false, error: "No vision model available. Add a multimodal GGUF to models/ or set OPENAI_API_KEY." };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }
  };
}

async function getImageBase64(imageSource: string): Promise<{ base64: string; contentType: string }> {
  let imageData: string;
  let contentType: string;

  if (imageSource.startsWith("http://") || imageSource.startsWith("https://")) {
    const response = await fetch(imageSource);
    if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    imageData = buffer.toString("base64");
    const ct = response.headers.get("content-type") || "image/jpeg";
    contentType = ct.includes("png") ? "image/png" : "image/jpeg";
  } else {
    const data = await readFile(imageSource);
    imageData = data.toString("base64");
    const ext = imageSource.split(".").pop()?.toLowerCase();
    contentType = ext === "png" ? "image/png" : "image/jpeg";
  }

  return { base64: imageData, contentType };
}

async function analyzeWithLocalModel(
  modelManager: ModelManager,
  imageSource: string,
  prompt?: string
): Promise<VisionOutput | null> {
  const multimodalModels = modelManager.listModels().filter(m => isMultimodalModel(m.id));
  if (multimodalModels.length === 0) return null;

  const currentModelId = modelManager.getCurrentModelId();
  const targetModel = currentModelId && isMultimodalModel(currentModelId)
    ? multimodalModels.find(m => m.id === currentModelId) || multimodalModels[0]
    : multimodalModels[0];

  try {
    const { base64, contentType } = await getImageBase64(imageSource);
    const visionPrompt = prompt || "描述这张图片中的内容";

    // Load the multimodal model if not already loaded
    if (!modelManager.isModelLoaded() || modelManager.getCurrentModelId() !== targetModel.id) {
      const loaded = await modelManager.loadModel(targetModel.id);
      if (!loaded) {
        return null; // fall back to cloud
      }
    }

    // Build llava-style prompt: image as data URI + text
    const imageUri = `data:${contentType};base64,${base64}`;
    const userPrompt = `[image]${imageUri}[/image]\n\n${visionPrompt}`;

    const response = await modelManager.complete(userPrompt, { maxTokens: 500, temperature: 0.7 });

    return {
      success: true,
      description: response,
      model: `local:${targetModel.id}`
    };
  } catch (e: any) {
    console.log(`[Vision] Local model inference failed: ${e.message}, falling back to cloud`);
    return null;
  }
}

async function analyzeWithCloudApi(
  imageSource: string,
  prompt?: string
): Promise<VisionOutput> {
  const visionPrompt = prompt || "描述这张图片中的内容";
  const apiKey = process.env.OPENAI_API_KEY || process.env.CLOUD_API_KEY;
  if (!apiKey) {
    return { success: false, error: "No API key configured. Set OPENAI_API_KEY" };
  }

  const { base64, contentType } = await getImageBase64(imageSource);
  const imageData = `data:${contentType};base64,${base64}`;

  const messages = [
    {
      role: "user",
      content: [
        { type: "text", text: visionPrompt },
        { type: "image_url", image_url: { url: imageData } }
      ]
    }
  ];

  const endpoint = process.env.CLOUD_MODEL_ENDPOINT || "https://api.openai.com/v1/chat/completions";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o",
      messages,
      max_tokens: 1000
    })
  });

  const data = await response.json();

  if (data.error) {
    return { success: false, error: data.error.message };
  }

  return {
    success: true,
    description: data.choices[0]?.message?.content || "",
    model: "cloud:gpt-4o"
  };
}

export const createVisionTool = getVisionTool;
export default getVisionTool;

function buildModePrompt(mode: string, userPrompt?: string): string {
  const base = userPrompt || "";
  switch (mode) {
    case "describe":
      return base || "请详细描述这张图片中的内容，包括场景、物体、人物、颜色和布局。";
    case "analyze":
      return base || "请分析这张图片，包含：1) 主要内容 2) 关键细节 3) 可能的问题或异常。";
    case "detect":
      return base || "请列出这张图片中所有可见的物体、文字和人物。对每个元素给出位置和描述。";
    case "ocr":
      return base
        ? `请提取图片中的所有文字内容。${base}`
        : "请提取这张图片中的所有文字内容，保持原有格式和排版。逐行输出文字。";
    default:
      return base || "请描述这张图片中的内容。";
  }
}

export async function checkVisionCapability(modelManager?: ModelManager): Promise<{ available: boolean; reason?: string }> {
  const hasLocalMultimodal = modelManager
    ? modelManager.listModels().some(m => MULTIMODAL_PATTERNS.some(p => m.id.toLowerCase().includes(p)))
    : false;
  const hasCloudApi = Boolean(process.env.OPENAI_API_KEY || process.env.CLOUD_API_KEY);
  if (hasLocalMultimodal) return { available: true };
  if (hasCloudApi) return { available: true };
  return { available: false, reason: "No multimodal model (llava/gemma-3 etc.) in models/ and no OPENAI_API_KEY set" };
}
