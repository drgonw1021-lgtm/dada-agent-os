import { readFile } from "node:fs/promises";
import type { ToolDefinition } from "../../core/types.js";
import { SandboxPolicy } from "../../governance/sandbox-policy.js";
import type { ModelManager } from "../../model/model-manager.js";

interface FileReadInput {
  path: string;
}

interface FileReadOutput {
  path: string;
  content: string;
  vision?: string;
  visionModel?: string;
}

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"]);

function isImageFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.has(ext);
}

const MULTIMODAL_PATTERNS = [
  "llava", "bakllava", "llama-v", "gemma-3", "cogvlm",
  "minicpm-v", "phi-3-vision", "fuyu", "qwen-vl",
  "paligemma", "florence", "internvl"
];

function findMultimodalModel(modelManager: ModelManager): string | null {
  const models = modelManager.listModels();
  for (const m of models) {
    const lower = m.id.toLowerCase();
    if (MULTIMODAL_PATTERNS.some(p => lower.includes(p))) return m.id;
  }
  return null;
}

async function analyzeImageWithLocal(
  modelManager: ModelManager,
  imagePath: string,
  _ext: string
): Promise<string | null> {
  const modelId = findMultimodalModel(modelManager);
  if (!modelId) return null;

  try {
    const data = await readFile(imagePath);
    const base64 = data.toString("base64");
    const ext = imagePath.split(".").pop()?.toLowerCase() || "png";
    const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    const imageUri = `data:${contentType};base64,${base64}`;
    const prompt = `[image]${imageUri}[/image]\n\n请用中文描述这张图片中的内容。`;

    // Load multimodal model if needed
    if (!modelManager.isModelLoaded() || modelManager.getCurrentModelId() !== modelId) {
      await modelManager.loadModel(modelId);
    }
    const response = await modelManager.complete(prompt, { maxTokens: 500, temperature: 0.7 });
    return response || null;
  } catch {
    return null;
  }
}

async function analyzeImageWithCloud(
  imagePath: string,
  _ext: string
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY || process.env.CLOUD_API_KEY;
  if (!apiKey) return null;

  try {
    const data = await readFile(imagePath);
    const base64 = data.toString("base64");
    const ext = imagePath.split(".").pop()?.toLowerCase() || "png";
    const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

    const endpoint = process.env.CLOUD_MODEL_ENDPOINT || "https://api.openai.com/v1/chat/completions";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "请用中文描述这张图片中的内容。" },
            { type: "image_url", image_url: { url: `data:${contentType};base64,${base64}` } }
          ]
        }],
        max_tokens: 500
      })
    });

    const json = await response.json() as any;
    if (json.error) return null;
    return json.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

export function createFileReadTool(
  sandboxPolicy: SandboxPolicy,
  modelManager?: ModelManager
): ToolDefinition<FileReadInput, FileReadOutput> {
  return {
    id: "fs.read_file",
    description: "Read a file from local disk. For text/code files returns content. For images (png/jpg/gif/webp) auto-analyzes with vision model and includes description.",
    requiredScopes: ["filesystem.read"],
    riskLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute or relative path of the file to read" }
      },
      required: ["path"]
    },
    async execute(input) {
      sandboxPolicy.assertReadPath(input.path);
      const content = await readFile(input.path, "utf8");

      const result: FileReadOutput = { path: input.path, content };

      // Auto-analyze images with vision model
      if (isImageFile(input.path) && modelManager) {
        const ext = input.path.split(".").pop()?.toLowerCase() || "";

        // Try local multimodal model first
        const localDesc = await analyzeImageWithLocal(modelManager, input.path, ext);
        if (localDesc) {
          result.vision = localDesc;
          result.visionModel = "local:multimodal";
          return result;
        }

        // Fall back to cloud
        const cloudDesc = await analyzeImageWithCloud(input.path, ext);
        if (cloudDesc) {
          result.vision = cloudDesc;
          result.visionModel = "cloud:gpt-4o";
        }
      }

      return result;
    }
  };
}
