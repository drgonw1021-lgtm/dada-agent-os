import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface DockerInput {
  action: "ps" | "images" | "run" | "stop" | "start" | "restart" | "remove" | "logs" | "build" | "pull" | "exec" | "stats";
  container?: string;
  image?: string;
  name?: string;
  command?: string;
  port?: string;
  env?: string[];
  volume?: string[];
  dockerfile?: string;
  tag?: string;
}

export interface DockerOutput {
  success: boolean;
  result?: string;
  error?: string;
}

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_.\-:\/]*$/;

function assertSafeName(value: string, label: string): void {
  if (value && !SAFE_NAME.test(value)) {
    throw new Error(`Invalid ${label}: "${value}"`);
  }
}

// ── Runtime detection ────────────────────────────────────────────────────────

let _detectedRuntime: string | null = null;
let _detectionDone = false;

async function detectContainerRuntime(): Promise<string | null> {
  if (_detectionDone) return _detectedRuntime;

  // 1. Check explicit env override
  const envRuntime = process.env.DADA_CONTAINER_RUNTIME;
  if (envRuntime && existsSync(envRuntime)) {
    _detectedRuntime = envRuntime;
    _detectionDone = true;
    return _detectedRuntime;
  }

  // 2. Check Docker Desktop paths (Windows)
  if (process.platform === "win32") {
    const winPaths = [
      "C:\\Program Files\\Docker\\Docker\\resources\\bin\\docker.exe",
      "C:\\Program Files (x86)\\Docker\\Docker\\resources\\bin\\docker.exe",
    ];
    for (const p of winPaths) {
      if (existsSync(p)) {
        _detectedRuntime = p;
        _detectionDone = true;
        return _detectedRuntime;
      }
    }
  }

  // 3. Try "docker" in PATH
  try {
    const out = execSync("docker --version", { encoding: "utf8", timeout: 5000, stdio: "pipe" }).trim();
    if (out.toLowerCase().includes("docker")) {
      _detectedRuntime = "docker";
      _detectionDone = true;
      return _detectedRuntime;
    }
  } catch { /* not in PATH */ }

  // 4. Try "podman" as fallback (drop-in Docker replacement)
  try {
    const out = execSync("podman --version", { encoding: "utf8", timeout: 5000, stdio: "pipe" }).trim();
    if (out.toLowerCase().includes("podman")) {
      _detectedRuntime = "podman";
      _detectionDone = true;
      return _detectedRuntime;
    }
  } catch { /* not available */ }

  _detectionDone = true;
  return null;
}

function installGuide(): string {
  if (process.platform === "win32") {
    return "Docker not found. Install options:\n" +
      "  Option A: Docker Desktop → https://docs.docker.com/desktop/setup/install/windows-install/\n" +
      "  Option B: Podman (lighter) → https://github.com/containers/podman/releases\n" +
      "  Option C: Set DADA_CONTAINER_RUNTIME env var to your docker/podman binary path";
  }
  return "Docker not found. Install: brew install docker (macOS) or apt install docker.io (Linux). Or try podman as a lighter alternative.";
}

// ── Main tool ────────────────────────────────────────────────────────────────

export function createDockerTool(): ToolDefinition<DockerInput, DockerOutput> {
  return {
    id: "docker",
    description: "Docker container management: run, stop, logs, execute commands, build images. Auto-detects Docker Desktop, podman, and system docker.",
    requiredScopes: ["shell.exec"] as PermissionScope[],
    riskLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["ps", "images", "run", "stop", "start", "restart", "remove", "logs", "build", "pull", "exec", "stats"], description: "Docker action" },
        container: { type: "string", description: "Container name or ID" },
        image: { type: "string", description: "Image name" },
        name: { type: "string", description: "Container name (for run)" },
        command: { type: "string", description: "Command to execute" },
        port: { type: "string", description: "Port mapping (e.g. 8080:80)" },
        env: { type: "array", items: { type: "string" }, description: "Environment variables" },
        volume: { type: "array", items: { type: "string" }, description: "Volume mounts" },
        dockerfile: { type: "string", description: "Dockerfile path (for build)" },
        tag: { type: "string", description: "Image tag (for build)" }
      },
      required: ["action"]
    },
    async execute(input: DockerInput, _context: ToolContext): Promise<DockerOutput> {
      const runtime = await detectContainerRuntime();
      if (!runtime) {
        return { success: false, error: installGuide() };
      }

      try {
        switch (input.action) {
          case "ps":
            return await containerRun(runtime, ["ps", "-a", "--format", "{{.ID}}|{{.Names}}|{{.Status}}|{{.Image}}|{{.Ports}}"]);
          case "images":
            return await containerRun(runtime, ["images", "--format", "{{.ID}}|{{.Repository}}|{{.Tag}}|{{.Size}}"]);
          case "run":
            return await dockerRun(runtime, input);
          case "stop":
            assertSafeName(input.container ?? "", "container name");
            return await containerRun(runtime, ["stop", input.container!]);
          case "start":
            assertSafeName(input.container ?? "", "container name");
            return await containerRun(runtime, ["start", input.container!]);
          case "restart":
            assertSafeName(input.container ?? "", "container name");
            return await containerRun(runtime, ["restart", input.container!]);
          case "remove":
            assertSafeName(input.container ?? "", "container name");
            return await containerRun(runtime, ["rm", "-f", input.container!]);
          case "logs":
            assertSafeName(input.container ?? "", "container name");
            return await containerRun(runtime, ["logs", input.container!, "--tail", "100"]);
          case "build": {
            assertSafeName(input.tag ?? "", "tag");
            const dockerfile = input.dockerfile ?? ".";
            return await containerRun(runtime, ["build", "-t", input.tag!, dockerfile]);
          }
          case "pull":
            assertSafeName(input.image ?? "", "image name");
            return await containerRun(runtime, ["pull", input.image!]);
          case "exec":
            assertSafeName(input.container ?? "", "container name");
            return await containerRun(runtime, ["exec", input.container!, input.command ?? ""]);
          case "stats":
            return await containerRun(runtime, ["stats", "--no-stream", "--format", "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}"]);
          default:
            return { success: false, error: "Unknown action" };
        }
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  };
}

async function dockerRun(runtime: string, input: DockerInput): Promise<DockerOutput> {
  if (!input.image) return { success: false, error: "Image name required" };
  assertSafeName(input.image, "image name");
  assertSafeName(input.name ?? "", "container name");

  const args = ["run", "-d", "--name", input.name!, input.image];
  if (input.command) args.push(input.command);

  return containerRun(runtime, args);
}

function containerRun(runtime: string, args: string[]): Promise<DockerOutput> {
  return new Promise((resolve) => {
    const child = spawn(runtime, args, { shell: false, timeout: 120000 });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr!.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, result: stdout });
      } else {
        resolve({ success: false, error: stderr || stdout || `exited with code ${code}` });
      }
    });
    child.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

export default createDockerTool;

// ── Capability check ─────────────────────────────────────────────────────────

export async function checkDockerCapability(): Promise<{ available: boolean; reason?: string }> {
  const runtime = await detectContainerRuntime();
  if (runtime) {
    return { available: true };
  }
  return { available: false, reason: installGuide() };
}
