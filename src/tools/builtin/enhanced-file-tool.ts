import { readFile, writeFile, readdir, stat, mkdir } from "node:fs/promises";
import { join, resolve, relative } from "node:path";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface FileOperationInput {
  operation: "read" | "write" | "list" | "exists" | "mkdir" | "stat";
  path: string;
  content?: string;
}

export interface FileOperationOutput {
  success: boolean;
  result?: string | string[] | boolean | Record<string, unknown>;
  error?: string;
}

export function createEnhancedFileTool(readRoots: string[], writeRoots: string[]): ToolDefinition<FileOperationInput, FileOperationOutput> {
  function normalizePath(targetPath: string, roots: string[]): string | null {
    const resolved = resolve(targetPath);
    for (const root of roots) {
      const rootResolved = resolve(root);
      if (resolved.startsWith(rootResolved) || resolved === rootResolved) {
        return resolved;
      }
    }
    return null;
  }

  return {
    id: "fs.enhanced",
    description: "Enhanced file operations: read, write, list directory, check existence, create directory, get file stats",
    requiredScopes: ["filesystem.read", "filesystem.write"] as PermissionScope[],
    riskLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        operation: { type: "string", enum: ["read", "write", "list", "exists", "mkdir", "stat"], description: "File operation to perform" },
        path: { type: "string", description: "File or directory path" },
        content: { type: "string", description: "Content to write (required for write operation)" }
      },
      required: ["operation", "path"]
    },
    async execute(input: Input, context: ToolContext): Promise<Output> {
      try {
        const { operation, path, content } = input;

        if (operation === "read" || operation === "stat" || operation === "exists") {
          const allowedPath = normalizePath(path, readRoots);
          if (!allowedPath) {
            return { success: false, error: `Path not in allowed read roots: ${path}` };
          }

          if (operation === "read") {
            const data = await readFile(allowedPath, "utf8");
            return { success: true, result: data };
          }

          if (operation === "exists") {
            try {
              await stat(allowedPath);
              return { success: true, result: true };
            } catch {
              return { success: true, result: false };
            }
          }

          if (operation === "stat") {
            const stats = await stat(allowedPath);
            return {
              success: true,
              result: {
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory(),
                size: stats.size,
                created: stats.birthtime.toISOString(),
                modified: stats.mtime.toISOString()
              }
            };
          }
        }

        if (operation === "write" || operation === "mkdir") {
          const allowedPath = normalizePath(path, writeRoots);
          if (!allowedPath) {
            return { success: false, error: `Path not in allowed write roots: ${path}` };
          }

          if (operation === "write") {
            if (!content) {
              return { success: false, error: "Content required for write operation" };
            }
            await writeFile(allowedPath, content, "utf8");
            return { success: true, result: `Written to ${allowedPath}` };
          }

          if (operation === "mkdir") {
            await mkdir(allowedPath, { recursive: true });
            return { success: true, result: `Created directory ${allowedPath}` };
          }
        }

        if (operation === "list") {
          const allowedPath = normalizePath(path, readRoots);
          if (!allowedPath) {
            return { success: false, error: `Path not in allowed read roots: ${path}` };
          }

          const entries = await readdir(allowedPath);
          return { success: true, result: entries };
        }

        return { success: false, error: `Unknown operation: ${operation}` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  };
}

type Input = FileOperationInput;
type Output = FileOperationOutput;
