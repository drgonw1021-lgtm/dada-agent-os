import { spawn } from "node:child_process";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";
import type { SandboxPolicy } from "../../governance/sandbox-policy.js";

export interface CodeExecInput {
  language: "javascript" | "python" | "bash" | "powershell" | "typescript";
  code: string;
  timeout?: number;
}

export interface CodeExecOutput {
  success: boolean;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  error?: string;
  executionTime?: number;
}

const MAX_CODE_LENGTH = 10000;

export function createCodeExecTool(sandboxPolicy?: SandboxPolicy): ToolDefinition<CodeExecInput, CodeExecOutput> {
  return {
    id: "code.exec",
    description: "Execute code in various languages (javascript, python, bash, powershell, typescript)",
    requiredScopes: ["code.exec"] as PermissionScope[],
    riskLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        language: { type: "string", enum: ["javascript", "python", "bash", "powershell", "typescript"], description: "Programming language" },
        code: { type: "string", description: "Code to execute" },
        timeout: { type: "number", description: "Timeout in milliseconds (default 30000)" }
      },
      required: ["language", "code"]
    },
    async execute(input: CodeExecInput, context: ToolContext): Promise<CodeExecOutput> {
      const startTime = Date.now();

      if (input.code.length > MAX_CODE_LENGTH) {
        return { success: false, error: `Code exceeds max length of ${MAX_CODE_LENGTH} characters` };
      }

      if (sandboxPolicy && (input.language === "bash" || input.language === "powershell")) {
        try {
          sandboxPolicy.assertShellCommand(input.code);
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : String(e) };
        }
      }

      return new Promise((resolve) => {
        const { language, code, timeout = 30000 } = input;

        let command: string;
        let args: string[];
        let shell: boolean;

        switch (language) {
          case "javascript":
            command = "node";
            args = ["-e", code];
            shell = false;
            break;
          case "typescript":
            command = "npx";
            args = ["ts-node", "-e", code];
            shell = false;
            break;
          case "python":
            command = "python";
            args = ["-c", code];
            shell = false;
            break;
          case "bash":
            command = "bash";
            args = ["-c", code];
            shell = false;
            break;
          case "powershell":
            command = "powershell";
            args = ["-Command", code];
            shell = false;
            break;
          default:
            resolve({ success: false, error: `Unsupported language: ${language}` });
            return;
        }

        const proc = spawn(command, args, {
          stdio: ["pipe", "pipe", "pipe"],
          timeout,
          env: { ...process.env, DADA_TASK_ID: context.taskId }
        });

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (data) => {
          stdout += data.toString();
        });

        proc.stderr?.on("data", (data) => {
          stderr += data.toString();
        });

        const timer = setTimeout(() => {
          proc.kill("SIGTERM");
          resolve({
            success: false,
            stdout,
            stderr,
            error: `Execution timed out after ${timeout}ms`,
            executionTime: Date.now() - startTime
          });
        }, timeout);

        proc.on("close", (code) => {
          clearTimeout(timer);
          resolve({
            success: code === 0,
            stdout,
            stderr,
            exitCode: code ?? undefined,
            executionTime: Date.now() - startTime
          });
        });

        proc.on("error", (error) => {
          clearTimeout(timer);
          resolve({
            success: false,
            error: error.message,
            executionTime: Date.now() - startTime
          });
        });
      });
    }
  };
}
