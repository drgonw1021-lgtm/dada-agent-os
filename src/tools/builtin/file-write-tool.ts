import { writeFile } from "node:fs/promises";
import type { ToolDefinition } from "../../core/types.js";
import { SandboxPolicy } from "../../governance/sandbox-policy.js";

interface FileWriteInput {
  path: string;
  content: string;
}

interface FileWriteOutput {
  path: string;
  bytes: number;
}

export function createFileWriteTool(
  sandboxPolicy: SandboxPolicy
): ToolDefinition<FileWriteInput, FileWriteOutput> {
  return {
    id: "fs.write_file",
    description: "Write text content to a local file",
    requiredScopes: ["filesystem.write"],
    riskLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to write" },
        content: { type: "string", description: "Text content to write" }
      },
      required: ["path", "content"]
    },
    async execute(input) {
      sandboxPolicy.assertWritePath(input.path);
      await writeFile(input.path, input.content, "utf8");
      return {
        path: input.path,
        bytes: Buffer.byteLength(input.content, "utf8")
      };
    }
  };
}
