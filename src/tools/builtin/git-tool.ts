import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface GitInput {
  action: "status" | "log" | "diff" | "commit" | "push" | "pull" | "branch" | "checkout" | "add" | "clone" | "init";
  repo?: string;
  message?: string;
  path?: string;
  branch?: string;
  files?: string[];
}

export interface GitOutput {
  success: boolean;
  result?: string;
  error?: string;
}

export function createGitTool(): ToolDefinition<GitInput, GitOutput> {
  return {
    id: "git",
    description: "Git version control: status, log, commit, push, pull, branch management, clone, init",
    requiredScopes: ["shell.exec", "filesystem.read", "filesystem.write"] as PermissionScope[],
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "log", "diff", "commit", "push", "pull", "branch", "checkout", "add", "clone", "init"], description: "Git action to perform" },
        repo: { type: "string", description: "Repository URL (for clone)" },
        message: { type: "string", description: "Commit message (for commit)" },
        path: { type: "string", description: "Repository path" },
        branch: { type: "string", description: "Branch name (for checkout)" },
        files: { type: "array", items: { type: "string" }, description: "File paths (for add/commit)" }
      },
      required: ["action"]
    },
    async execute(input: GitInput, _context: ToolContext): Promise<GitOutput> {
      const cwd = input.path || process.cwd();

      if (!existsSync(join(cwd, ".git")) && input.action !== "init" && input.action !== "clone") {
        return { success: false, error: "Not a git repository" };
      }

      try {
        switch (input.action) {
          case "status":
            return await git(cwd, ["status", "--porcelain"]);
          case "log":
            return await git(cwd, ["log", "--oneline", "-20"]);
          case "diff":
            return await git(cwd, ["diff", "--stat"]);
          case "commit": {
            if (!input.message) return { success: false, error: "Commit message required" };
            if (input.files?.length) {
              await git(cwd, ["add", ...input.files]);
            }
            return await git(cwd, ["commit", "-m", input.message]);
          }
          case "push":
            return await git(cwd, ["push"]);
          case "pull":
            return await git(cwd, ["pull"]);
          case "branch":
            return await git(cwd, ["branch", "-a"]);
          case "checkout":
            if (!input.branch) return { success: false, error: "Branch name required" };
            return await git(cwd, ["checkout", input.branch]);
          case "add":
            return await git(cwd, ["add", ...(input.files ?? ["."])]);
          case "clone": {
            if (!input.repo) return { success: false, error: "Repository URL required" };
            const safeRepo = input.repo.replace(/[;&|`$(){}[\]!<>#]/g, "");
            return await git(process.cwd(), ["clone", safeRepo]);
          }
          case "init":
            return await git(cwd, ["init"]);
          default:
            return { success: false, error: "Unknown action" };
        }
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  };
}

function git(cwd: string, args: string[]): Promise<GitOutput> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, shell: false, timeout: 60000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, result: stdout });
      } else {
        resolve({ success: false, error: stderr || stdout || `git exited with code ${code}` });
      }
    });
    child.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

export default createGitTool;

export function checkGitCapability(): { available: boolean; reason?: string } {
  try {
    execSync("git --version", { encoding: "utf8", timeout: 5000, stdio: "pipe" });
    return { available: true };
  } catch {
    return { available: false, reason: "Git not found. Install from git-scm.com" };
  }
}
