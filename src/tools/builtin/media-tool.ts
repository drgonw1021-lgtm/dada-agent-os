import { spawn, exec } from "node:child_process";
import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface MediaInput {
  action: "generate_image" | "generate_video" | "create_pdf" | "extract_audio" | "convert_media";
  prompt?: string;
  text?: string;
  inputPath?: string;
  outputPath?: string;
  options?: Record<string, any>;
}

export interface MediaOutput {
  success: boolean;
  result?: string;
  file?: string;
  error?: string;
}

export function createMediaTool(): ToolDefinition<MediaInput, MediaOutput> {
  return {
    id: "media",
    description: "媒体工具：图像生成、视频处理、PDF创建、音频提取。支持 DALL-E、FFmpeg、wkhtmltopdf。",
    requiredScopes: ["shell.exec", "filesystem.write"] as PermissionScope[],
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string" as const, enum: ["generate_image", "generate_video", "create_pdf", "extract_audio", "convert_media"], description: "Media action" },
        prompt: { type: "string" as const, description: "Prompt for image/video generation" },
        text: { type: "string" as const, description: "Text content for PDF or other operations" },
        inputPath: { type: "string" as const, description: "Input file path" },
        outputPath: { type: "string" as const, description: "Output file path" },
        options: { type: "object" as const, description: "Additional options", additionalProperties: true }
      },
      required: ["action"]
    },
    async execute(input: MediaInput, _context: ToolContext): Promise<MediaOutput> {
      try {
        switch (input.action) {
          case "generate_image":
            return await generateImage(input.prompt || "", input.outputPath || "");
          case "generate_video":
            return await generateVideo(input.inputPath || "", input.outputPath || "");
          case "create_pdf":
            return await createPdf(input.text || "", input.outputPath || "");
          case "extract_audio":
            return await extractAudio(input.inputPath || "", input.outputPath || "");
          case "convert_media":
            return await convertMedia(input.inputPath || "", input.outputPath || "", input.options);
          default:
            return { success: false, error: "Unknown action" };
        }
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }
  };
}

async function generateImage(prompt: string, outputPath: string): Promise<MediaOutput> {
  if (!process.env.OPENAI_API_KEY) {
    return { success: false, error: "OPENAI_API_KEY not set" };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "dall-e-3",
        prompt,
        n: 1,
        size: "1024x1024"
      })
    });

    const data = await response.json();
    if (data.error) {
      return { success: false, error: data.error.message };
    }

    const imageUrl = data.data[0]?.url;
    if (!imageUrl) {
      return { success: false, error: "No image URL returned" };
    }

    if (outputPath) {
      await downloadFile(imageUrl, outputPath);
      return { success: true, file: outputPath };
    }

    return { success: true, result: imageUrl };
  } catch (e: any) {
    return { success: false, error: e.message };
  }
}

async function generateVideo(inputPath: string, outputPath: string): Promise<MediaOutput> {
  return new Promise((resolve) => {
    const ffmpeg = process.platform === "win32" ? "ffmpeg" : "ffmpeg";
    const args = ["-i", inputPath, "-c:v", "libx264", "-pix_fmt", "yuv420p", outputPath];

    const proc = spawn(ffmpeg, args, { stdio: "inherit" });
    proc.on("close", (code) => {
      resolve({
        success: code === 0,
        result: code === 0 ? `Video created: ${outputPath}` : "Video generation failed"
      });
    });
    proc.on("error", (e) => {
      resolve({ success: false, error: e.message });
    });
  });
}

async function createPdf(text: string, outputPath: string): Promise<MediaOutput> {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 40px; line-height: 1.6; }
    h1 { color: #333; }
  </style>
</head>
<body>
  ${text.split("\n").map(line => `<p>${line}</p>`).join("\n")}
</body>
</html>`;

  const tempHtml = join(tmpdir(), `temp_${Date.now()}.html`);
  await writeFile(tempHtml, html, "utf-8");

  return new Promise((resolve) => {
    if (process.platform === "win32") {
      exec(`wkhtmltopdf "${tempHtml}" "${outputPath}"`, (err) => {
        resolve({ success: !err, file: outputPath });
      });
    } else {
      exec(`wkhtmltopdf "${tempHtml}" "${outputPath}"`, (err) => {
        resolve({ success: !err, file: outputPath });
      });
    }
  });
}

async function extractAudio(inputPath: string, outputPath: string): Promise<MediaOutput> {
  return new Promise((resolve) => {
    const ffmpeg = process.platform === "win32" ? "ffmpeg" : "ffmpeg";
    const args = ["-i", inputPath, "-vn", "-acodec", "libmp3lame", outputPath];

    const proc = spawn(ffmpeg, args);
    proc.on("close", (code) => {
      resolve({
        success: code === 0,
        result: code === 0 ? `Audio extracted: ${outputPath}` : "Extraction failed"
      });
    });
    proc.on("error", (e) => {
      resolve({ success: false, error: e.message });
    });
  });
}

async function convertMedia(inputPath: string, outputPath: string, options?: Record<string, any>): Promise<MediaOutput> {
  return new Promise((resolve) => {
    const ffmpeg = process.platform === "win32" ? "ffmpeg" : "ffmpeg";
    const args = ["-i", inputPath];

    if (options?.videoCodec) args.push("-c:v", options.videoCodec);
    if (options?.audioCodec) args.push("-c:a", options.audioCodec);
    if (options?.quality) args.push("-crf", String(options.quality));

    args.push(outputPath);

    const proc = spawn(ffmpeg, args);
    proc.on("close", (code) => {
      resolve({
        success: code === 0,
        result: code === 0 ? `Converted: ${outputPath}` : "Conversion failed"
      });
    });
    proc.on("error", (e) => {
      resolve({ success: false, error: e.message });
    });
  });
}

async function downloadFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url);
  const buffer = await response.arrayBuffer();
  await writeFile(outputPath, Buffer.from(buffer));
}

export default createMediaTool;