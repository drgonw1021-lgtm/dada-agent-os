import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import type { TaskAttachment } from "../core/types.js";

export interface SaveUploadInput {
  name: string;
  mimeType: string;
  dataBase64: string;
}

function detectKind(mimeType: string): TaskAttachment["kind"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.includes("csv") || mimeType.includes("excel") || mimeType.includes("json")) return "data";
  if (mimeType.includes("pdf") || mimeType.includes("text") || mimeType.includes("word")) return "document";
  return "other";
}

function safeBaseName(name: string): string {
  return name.replace(/[^\w.\-()\u4e00-\u9fa5]/g, "_");
}

export class UploadStore {
  constructor(
    private readonly rootDir: string,
    private readonly maxBytes: number = 10_485_760 // 10 MB default
  ) {}

  async save(input: SaveUploadInput): Promise<TaskAttachment> {
    // Check base64 size before decoding
    const estimatedSize = Math.ceil((input.dataBase64.length * 3) / 4);
    if (estimatedSize > this.maxBytes) {
      throw new Error(
        `Upload exceeds size limit: ${(estimatedSize / 1_048_576).toFixed(1)}MB (max ${(this.maxBytes / 1_048_576).toFixed(1)}MB)`
      );
    }

    const extension = extname(input.name) || "";
    const fileName = `${Date.now()}-${randomUUID()}-${safeBaseName(input.name || `upload${extension}`)}`;
    const filePath = resolve(this.rootDir, fileName);
    await mkdir(dirname(filePath), { recursive: true });
    const buffer = Buffer.from(input.dataBase64, "base64");
    await writeFile(filePath, buffer);
    return {
      id: randomUUID(),
      name: input.name,
      mimeType: input.mimeType,
      kind: detectKind(input.mimeType),
      path: filePath,
      size: buffer.length
    };
  }

  toPublicUrl(attachment: TaskAttachment): string {
    return `/api/uploads/file?path=${encodeURIComponent(attachment.path)}`;
  }
}
