import { exec, execSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import { platform } from "node:os";
import type { ToolDefinition, ToolStreamChunk } from "../../core/types.js";
import { SandboxPolicy } from "../../governance/sandbox-policy.js";

const execAsync = promisify(exec);

interface ShellExecInput {
  command: string;
  cwd?: string;
  timeoutMs?: number;
}

interface ShellExecOutput {
  stdout: string;
  stderr: string;
}

// ── Shell detection ────────────────────────────────────────────────────────

let _detectedShell: string | null = null;

function detectShell(): string {
  if (_detectedShell !== null) return _detectedShell;

  // Non-Windows: use default shell
  if (platform() !== "win32") {
    _detectedShell = process.env.SHELL || "/bin/bash";
    return _detectedShell;
  }

  // Windows: prefer Git Bash (MSYS2), NOT WSL bash
  // WSL's bash maps ~ to /home/xxx, not Windows user profile
  const gitBashCandidates = [
    "F:\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\usr\\bin\\bash.exe",
    "D:\\Git\\usr\\bin\\bash.exe",
  ];

  for (const candidate of gitBashCandidates) {
    try {
      execSync(`if exist "${candidate}" exit 0`, { timeout: 2000, stdio: "pipe", shell: "cmd.exe" });
      _detectedShell = candidate;
      return _detectedShell;
    } catch { /* not at this path */ }
  }

  // Try PATH-based detection for Git Bash (but exclude WSL wrapper)
  try {
    const whereResult = execSync('where bash 2>nul', { timeout: 3000, stdio: "pipe", shell: "cmd.exe" });
    const paths = whereResult.toString().trim().split(/\r?\n/);
    // Pick the first bash that is NOT in WindowsApps (which is WSL wrapper)
    for (const p of paths) {
      if (!p.includes("WindowsApps") && !p.includes("System32")) {
        _detectedShell = p.trim();
        return _detectedShell;
      }
    }
  } catch { /* no bash in PATH */ }

  // Try WSL as last resort (translate paths)
  try {
    execSync('wsl bash --version', { timeout: 3000, stdio: "pipe", shell: "cmd.exe" });
    _detectedShell = "wsl bash";
    return _detectedShell;
  } catch { /* no WSL */ }

  // Fallback to PowerShell
  _detectedShell = "powershell.exe";
  return _detectedShell;
}

function isBashLike(shell: string): boolean {
  return shell.includes("bash") || shell.includes("Git") || shell === "wsl bash";
}

function wrapWindowsCommand(command: string): string {
  const shell = detectShell();
  // Bash-based shells: pass command through unchanged
  if (isBashLike(shell)) return command;

  // PowerShell: auto-fix common Linux patterns that don't work in PS
  let fixed = command;
  fixed = fixed.replace(/2>\/dev\/null/g, "2>$null");
  fixed = fixed.replace(/>\/dev\/null(?!\/)/g, ">$null");

  return fixed;
}

// ── Tool ───────────────────────────────────────────────────────────────────

export function createShellExecTool(
  sandboxPolicy: SandboxPolicy
): ToolDefinition<ShellExecInput, ShellExecOutput> {
  return {
    id: "shell.exec",
    description: "Execute a shell command",
    requiredScopes: ["shell.exec"],
    riskLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        cwd: { type: "string", description: "Working directory for the command" },
        timeoutMs: { type: "number", description: "Timeout in milliseconds (default 30000)" }
      },
      required: ["command"]
    },
    async execute(input) {
      sandboxPolicy.assertShellCommand(input.command);
      if (input.cwd) {
        sandboxPolicy.assertWritePath(input.cwd);
      }
      const command = wrapWindowsCommand(input.command);
      return new Promise((resolve, reject) => {
        exec(command, {
          cwd: input.cwd,
          timeout: input.timeoutMs ?? 30000,
          maxBuffer: 1024 * 1024,
          shell: detectShell()
        }, (error, stdout, stderr) => {
          if (error) {
            // Non-zero exit code or signal — throw consistently with streaming mode
            const exitInfo = (error as any).code ? `exit code ${(error as any).code}` : (error as any).signal ? `signal ${(error as any).signal}` : "unknown";
            reject(new Error(`shell.exec: ${exitInfo}: ${stderr || stdout || error.message}`));
          } else {
            resolve({ stdout, stderr });
          }
        });
      });
    },
    async executeStream(input, context, onProgress) {
      sandboxPolicy.assertShellCommand(input.command);
      if (input.cwd) {
        sandboxPolicy.assertWritePath(input.cwd);
      }
      const command = wrapWindowsCommand(input.command);

      return new Promise((resolve, reject) => {
        const child = spawn(command, {
          cwd: input.cwd,
          timeout: input.timeoutMs ?? 30000,
          shell: detectShell()
        });

        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (data: Buffer) => {
          const text = data.toString("utf-8");
          stdout += text;
          onProgress({ type: "output", content: text, percent: undefined });
        });

        child.stderr?.on("data", (data: Buffer) => {
          const text = data.toString("utf-8");
          stderr += text;
          onProgress({ type: "output", content: text, percent: undefined });
        });

        child.on("close", (code) => {
          if (code === 0) {
            onProgress({ type: "progress", content: `Exit: ${code}`, percent: 100 });
            resolve({ stdout, stderr });
          } else {
            reject(new Error(`Exit code ${code}: ${stderr || stdout}`));
          }
        });

        child.on("error", (err) => {
          reject(err);
        });
      });
    }
  };
}
