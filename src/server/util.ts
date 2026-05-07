import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentAppResult } from "../app.js";
import type { TaskStore } from "../tasks/task-store.js";
import type { MediaJobStore } from "../tasks/media-job-store.js";
import type { UploadStore } from "../tasks/upload-store.js";
import type { ArtifactGenerator } from "../tasks/artifact-generator.js";
import type { TaskQueue } from "../tasks/task-queue.js";
import type { WebSocketServer } from "./websocket.js";
import type { BotManager } from "../bots/bot-manager.js";

export interface ServerContext {
  app: AgentAppResult;
  port: number;
  webRoot: string;
  locale: "zh" | "en";
  taskStore: TaskStore;
  mediaJobStore: MediaJobStore;
  uploadStore: UploadStore;
  artifactGenerator: ArtifactGenerator;
  taskQueue: TaskQueue;
  wss: WebSocketServer;
  botManager?: BotManager;
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

  if (!raw) return {};
  return JSON.parse(raw);
}

export function isAllowedAgentFile(filePath: string): boolean {
  return filePath.startsWith(join(process.cwd(), ".agent"));
}

export function contentTypeForFile(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

export function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

export function error(res: ServerResponse, status: number, message: string): void {
  json(res, status, { error: message });
}

export async function serveFile(
  res: ServerResponse,
  filePath: string
): Promise<void> {
  if (!isAllowedAgentFile(filePath)) {
    error(res, 403, "path is not allowed");
    return;
  }
  const body = await readFile(filePath);
  const type = contentTypeForFile(filePath);
  res.writeHead(200, { "content-type": type });
  res.end(body);
}
