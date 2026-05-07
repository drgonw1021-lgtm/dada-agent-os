import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, serveFile, type ServerContext } from "../util.js";

export async function handleGetArtifactFile(
  res: ServerResponse,
  _ctx: ServerContext,
  filePath: string
): Promise<void> {
  await serveFile(res, filePath);
}

export async function handleGetUploadFile(
  res: ServerResponse,
  _ctx: ServerContext,
  filePath: string
): Promise<void> {
  await serveFile(res, filePath);
}

export async function handlePostUpload(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as {
    name?: string;
    mimeType?: string;
    dataBase64?: string;
  };
  const name = body.name?.trim();
  const mimeType = body.mimeType?.trim();
  const dataBase64 = body.dataBase64?.trim();
  if (!name || !mimeType || !dataBase64) {
    return { status: 400, data: { error: "name, mimeType and dataBase64 are required" } };
  }

  const attachment = await ctx.uploadStore.save({ name, mimeType, dataBase64 });
  return { status: 201, data: { attachment, url: ctx.uploadStore.toPublicUrl(attachment) } };
}
