import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";
import { existsSync } from "node:fs";

export interface OcrInput {
  imagePath: string;
  language?: string;
  mode?: "default" | "accurate" | "fast";
}

export interface OcrOutput {
  success: boolean;
  text?: string;
  confidence?: number;
  error?: string;
}

function getOcrTool(): ToolDefinition<OcrInput, OcrOutput> {
  return {
    id: "ocr",
    description: "图像文字识别 (OCR)：从图片中提取文字。使用内置 tesseract.js WASM 引擎，首次使用自动下载语言包。",
    requiredScopes: ["shell.exec"] as PermissionScope[],
    inputSchema: {
      type: "object" as const,
      properties: {
        imagePath: { type: "string" as const, description: "Path to image file for OCR" },
        language: { type: "string" as const, description: "Tesseract language code, e.g. 'eng', 'chi_sim', 'eng+chi_sim' (default: eng+chi_sim)" },
        mode: { type: "string" as const, enum: ["default", "accurate", "fast"], description: "OCR mode (default: default)" }
      },
      required: ["imagePath"]
    },
    async execute(input: OcrInput, _context: ToolContext): Promise<OcrOutput> {
      try {
        if (!input.imagePath) {
          return { success: false, error: "imagePath is required" };
        }

        if (!existsSync(input.imagePath)) {
          return { success: false, error: `File not found: ${input.imagePath}` };
        }

        const langs = input.language || "eng+chi_sim";

        // tesseract.js WASM engine — auto-downloads language data on first use
        const { recognize } = await import("tesseract.js");
        const result = await recognize(input.imagePath, langs, {
          errorHandler: (msg: string) => {
            if (msg.includes("Downloading") || msg.includes("Loading")) {
              // Progress — tesseract.js is downloading language data, silently retry
              return;
            }
          },
        });

        return {
          success: true,
          text: result.data.text?.trim() || "",
          confidence: result.data.confidence,
        };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  };
}

export const createOcrTool = getOcrTool;
export default getOcrTool;

// ── Capability check (always available via tesseract.js WASM) ─────────────────

export async function checkOcrCapability(): Promise<{ available: boolean; reason?: string }> {
  try {
    // Just check that the module can be loaded (language data downloads on first use)
    await import("tesseract.js");
    return { available: true };
  } catch {
    return { available: false, reason: "tesseract.js WASM engine failed to load" };
  }
}
