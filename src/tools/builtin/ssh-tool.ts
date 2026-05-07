import { spawn } from "node:child_process";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface SSHInput {
  action: "connect" | "execute" | "upload" | "download" | "list";
  host?: string;
  user?: string;
  port?: number;
  key?: string;
  command?: string;
  localPath?: string;
  remotePath?: string;
  password?: string;
}

export interface SSHOutput {
  success: boolean;
  result?: string;
  error?: string;
}

const SAFE_HOST = /^[a-zA-Z0-9][a-zA-Z0-9.\-]*$/;
const SAFE_PATH = /^[a-zA-Z0-9_\-.\/\\: ]*$/;

function assertSafe(value: string, pattern: RegExp, label: string): void {
  if (!pattern.test(value)) {
    throw new Error(`Invalid ${label}: "${value}"`);
  }
}

export function createSSHTool(): ToolDefinition<SSHInput, SSHOutput> {
  return {
    id: "ssh",
    description: "SSH remote connection: execute commands, upload/download files, list connections",
    requiredScopes: ["shell.exec"] as PermissionScope[],
    riskLevel: "high",
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string" as const, enum: ["connect", "execute", "upload", "download", "list"], description: "SSH action to perform" },
        host: { type: "string" as const, description: "Remote host address" },
        user: { type: "string" as const, description: "SSH username (default: root)" },
        port: { type: "integer" as const, description: "SSH port (default: 22)" },
        key: { type: "string" as const, description: "Path to private key file" },
        command: { type: "string" as const, description: "Command to execute on remote host" },
        localPath: { type: "string" as const, description: "Local file path for upload/download" },
        remotePath: { type: "string" as const, description: "Remote file path for upload/download" },
        password: { type: "string" as const, description: "SSH password (not recommended, use key instead)" }
      },
      required: ["action"]
    },
    async execute(input: SSHInput, _context: ToolContext): Promise<SSHOutput> {
      const host = input.host || process.env.SSH_HOST || "";
      const user = input.user || process.env.SSH_USER || "root";
      const port = input.port || 22;

      if (!host && input.action !== "list") {
        return { success: false, error: "SSH host required" };
      }

      if (host) assertSafe(host, SAFE_HOST, "host");
      assertSafe(user, SAFE_HOST, "user");

      try {
        switch (input.action) {
          case "execute":
            return await sshExecute(host, user, port, input.command || "", input.key);
          case "upload":
            return await scpUpload(host, user, port, input.localPath || "", input.remotePath || "", input.key);
          case "download":
            return await scpDownload(host, user, port, input.remotePath || "", input.localPath || "", input.key);
          case "list":
            return await listSSHConnections();
          default:
            return { success: false, error: "Unknown action" };
        }
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  };
}

function sshExecute(host: string, user: string, port: number, command: string, key?: string): Promise<SSHOutput> {
  if (!command) return Promise.resolve({ success: false, error: "Command required" });

  const args = [
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-p", String(port),
    `${user}@${host}`,
    command
  ];
  if (key) { args.unshift("-i", key); }

  return sshSpawn(args);
}

function scpUpload(host: string, user: string, port: number, localPath: string, remotePath: string, key?: string): Promise<SSHOutput> {
  if (!localPath || !remotePath) {
    return Promise.resolve({ success: false, error: "Local and remote paths required" });
  }
  assertSafe(localPath, SAFE_PATH, "localPath");
  assertSafe(remotePath, SAFE_PATH, "remotePath");

  const args = ["-P", String(port), localPath, `${user}@${host}:${remotePath}`];
  if (key) { args.unshift("-i", key); }

  return scpSpawn(args);
}

function scpDownload(host: string, user: string, port: number, remotePath: string, localPath: string, key?: string): Promise<SSHOutput> {
  if (!remotePath || !localPath) {
    return Promise.resolve({ success: false, error: "Local and remote paths required" });
  }
  assertSafe(localPath, SAFE_PATH, "localPath");
  assertSafe(remotePath, SAFE_PATH, "remotePath");

  const args = ["-P", String(port), `${user}@${host}:${remotePath}`, localPath];
  if (key) { args.unshift("-i", key); }

  return scpSpawn(args);
}

function sshSpawn(args: string[]): Promise<SSHOutput> {
  return new Promise((resolve) => {
    const child = spawn("ssh", args, { shell: false, timeout: 60000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, result: stdout });
      } else {
        resolve({ success: false, error: stderr || stdout || `ssh exited with code ${code}` });
      }
    });
    child.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

function scpSpawn(args: string[]): Promise<SSHOutput> {
  return new Promise((resolve) => {
    const child = spawn("scp", args, { shell: false, timeout: 60000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ success: true, result: stdout || "Transfer complete" });
      } else {
        resolve({ success: false, error: stderr || stdout || `scp exited with code ${code}` });
      }
    });
    child.on("error", (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}

function listSSHConnections(): Promise<SSHOutput> {
  const connections = [
    { name: "SSH_HOST", host: process.env.SSH_HOST, user: process.env.SSH_USER },
    { name: "AWS_PROD", host: process.env.AWS_PROD_HOST, user: process.env.AWS_PROD_USER },
    { name: "AWS_STAGING", host: process.env.AWS_STAGING_HOST, user: process.env.AWS_STAGING_USER },
  ].filter(c => c.host);

  return Promise.resolve({ success: true, result: JSON.stringify(connections, null, 2) });
}

export default createSSHTool;
