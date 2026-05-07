/**
 * DockerSandbox — runs high-risk shell commands inside isolated Docker containers.
 * Provides CPU/memory limits, network isolation, read-only rootfs, and timeouts.
 */

import { spawn } from "node:child_process";

export interface DockerSandboxOptions {
  /** Docker image to use. Default "node:20-alpine" */
  image?: string;
  /** CPU limit (e.g. "0.5" = half a core). Default "1" */
  cpus?: string;
  /** Memory limit (e.g. "256m"). Default "512m" */
  memory?: string;
  /** Timeout in seconds. Default 30. */
  timeoutSec?: number;
  /** Working directory inside the container. Default "/work" */
  workdir?: string;
  /** Bind-mount host directory into container at /work */
  hostWorkdir: string;
  /** Enable network access. Default false (isolated). */
  allowNetwork?: boolean;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** Max output bytes before truncation. Default 65536 (64KB). */
  maxOutputBytes?: number;
}

export interface SandboxResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  /** Whether the execution timed out */
  timedOut: boolean;
  /** Duration in ms */
  durationMs: number;
}

export class DockerSandbox {
  private options: Required<Omit<DockerSandboxOptions, "env" | "hostWorkdir" | "allowNetwork">> & {
    env: Record<string, string>;
    hostWorkdir: string;
    allowNetwork: boolean;
  };

  constructor(options: DockerSandboxOptions) {
    this.options = {
      image: options.image ?? "node:20-alpine",
      cpus: options.cpus ?? "1",
      memory: options.memory ?? "512m",
      timeoutSec: options.timeoutSec ?? 30,
      workdir: options.workdir ?? "/work",
      hostWorkdir: options.hostWorkdir,
      allowNetwork: options.allowNetwork ?? false,
      env: options.env ?? {},
      maxOutputBytes: options.maxOutputBytes ?? 65536,
    };
  }

  /** Check if Docker is available on the host */
  async isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      const proc = spawn("docker", ["version", "--format", "{{.Server.Version}}"], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5000,
      });
      proc.on("close", code => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  /** Execute a command inside a Docker container */
  async execute(command: string): Promise<SandboxResult> {
    const startTime = Date.now();
    const args = this.buildDockerArgs(command);

    return new Promise(resolve => {
      const proc = spawn("docker", args, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let killed = false;

      const kill = () => {
        if (killed) return;
        killed = true;
        try { proc.kill("SIGKILL"); } catch { /* already dead */ }
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        kill();
      }, this.options.timeoutSec * 1000);

      proc.stdout!.on("data", (chunk: Buffer) => {
        if (stdout.length < this.options.maxOutputBytes) {
          stdout += chunk.toString("utf8");
        } else if (stdout.length >= this.options.maxOutputBytes && !stdout.endsWith("\n[TRUNCATED]")) {
          stdout += "\n[TRUNCATED]";
        }
      });

      proc.stderr!.on("data", (chunk: Buffer) => {
        if (stderr.length < this.options.maxOutputBytes) {
          stderr += chunk.toString("utf8");
        }
      });

      proc.on("close", (code) => {
        clearTimeout(timeout);
        // Docker cleanup: remove the container
        this.cleanupContainer();

        resolve({
          success: code === 0 && !timedOut,
          stdout: stdout.slice(0, this.options.maxOutputBytes),
          stderr: stderr.slice(0, this.options.maxOutputBytes),
          exitCode: code ?? -1,
          timedOut,
          durationMs: Date.now() - startTime,
        });
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        resolve({
          success: false,
          stdout,
          stderr: `Docker spawn error: ${err.message}`,
          exitCode: -1,
          timedOut: false,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }

  /** Pull the sandbox image ahead of time */
  async pullImage(): Promise<boolean> {
    return new Promise(resolve => {
      const proc = spawn("docker", ["pull", this.options.image], {
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 120000,
      });
      proc.on("close", code => resolve(code === 0));
      proc.on("error", () => resolve(false));
    });
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private containerId: string | null = null;

  private buildDockerArgs(command: string): string[] {
    const args: string[] = ["run", "--rm"];

    // Resource limits
    args.push("--cpus", this.options.cpus);
    args.push("--memory", this.options.memory);
    args.push("--memory-swap", this.options.memory); // no swap

    // Network isolation
    if (!this.options.allowNetwork) {
      args.push("--network", "none");
    }

    // Read-only rootfs (except /tmp and workdir)
    args.push("--read-only");
    args.push("--tmpfs", "/tmp:rw,noexec,nosuid,size=64m");

    // Bind mount working directory
    args.push("-v", `${this.options.hostWorkdir}:${this.options.workdir}:rw`);

    // Working directory
    args.push("-w", this.options.workdir);

    // Environment
    for (const [k, v] of Object.entries(this.options.env)) {
      args.push("-e", `${k}=${v}`);
    }

    // Security: drop all capabilities, no new privileges
    args.push("--cap-drop", "ALL");
    args.push("--security-opt", "no-new-privileges");

    // Image and command
    args.push(this.options.image);
    args.push("sh", "-c", command);

    return args;
  }

  private cleanupContainer(): void {
    // --rm flag handles cleanup, but as a safety net:
    if (this.containerId) {
      spawn("docker", ["rm", "-f", this.containerId], {
        stdio: "ignore",
      }).on("error", () => {});
      this.containerId = null;
    }
  }
}

/** Quick helper: check if Docker is usable */
export async function isDockerAvailable(): Promise<boolean> {
  const sandbox = new DockerSandbox({ hostWorkdir: "/tmp" });
  return sandbox.isAvailable();
}
