import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

function contentType(path: string): string {
  const ext = extname(path);
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".svg") return "image/svg+xml; charset=utf-8";
  return "text/plain; charset=utf-8";
}

export function resolveStaticFilePath(webRoot: string, requestPath: string): string {
  const normalizedRequestPath = requestPath === "/" ? "/index.html" : requestPath;
  const resolvedWebRoot = resolve(webRoot);
  const decodedPath = decodeURIComponent(normalizedRequestPath);
  const pathSegments = decodedPath.split(/[\\/]+/).filter(Boolean);

  if (pathSegments.includes("..")) {
    throw new Error("Static path is outside web root");
  }

  const resolvedFilePath = resolve(resolvedWebRoot, ...pathSegments);

  if (
    resolvedFilePath !== resolvedWebRoot &&
    !resolvedFilePath.startsWith(`${resolvedWebRoot}${sep}`)
  ) {
    throw new Error("Static path is outside web root");
  }

  return resolvedFilePath;
}

export async function serveStaticAsset(
  webRoot: string,
  requestPath: string
): Promise<{ status: number; body: Buffer; type: string }> {
  const filePath = resolveStaticFilePath(webRoot, requestPath);
  const body = await readFile(filePath);
  return {
    status: 200,
    body,
    type: contentType(filePath)
  };
}
