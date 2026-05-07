import { spawn } from "node:child_process";
import { networkInterfaces } from "node:os";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface NetworkInput {
  action: "info" | "ping" | "dns" | "curl" | "download";
  host?: string;
  url?: string;
  outputPath?: string;
}

export interface NetworkOutput {
  success: boolean;
  data?: unknown;
  error?: string;
}

const SAFE_HOST = /^[a-zA-Z0-9][a-zA-Z0-9.\-]*$/;
const SAFE_URL = /^https?:\/\/[^\s"'`;$(){}[\]|&]+$/;

function assertSafeHost(host: string): void {
  const h = host.replace(/^https?:\/\//, "").split(/[/:#]/)[0] ?? "";
  if (!SAFE_HOST.test(h)) {
    throw new Error(`Invalid host: "${host}"`);
  }
}

export function createNetworkTool(): ToolDefinition<NetworkInput, NetworkOutput> {
  return {
    id: "network",
    description: "Network tool: view network info, ping, DNS lookup, download files",
    requiredScopes: ["shell.exec"] as PermissionScope[],
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["info", "ping", "dns", "curl", "download"], description: "Network action" },
        host: { type: "string", description: "Host for ping/dns" },
        url: { type: "string", description: "URL for curl/download" },
        outputPath: { type: "string", description: "Save path for download" }
      },
      required: ["action"]
    },
    async execute(input: NetworkInput, _context: ToolContext): Promise<NetworkOutput> {
      try {
        switch (input.action) {
          case "info":
            return getNetworkInfo();
          case "ping":
            return await ping(input.host || "");
          case "dns":
            return await dnsLookup(input.host || "");
          case "curl":
            return await curl(input.url || "");
          case "download":
            return await downloadFile(input.url || "", input.outputPath || "");
          default:
            return { success: false, error: "Unknown action" };
        }
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  };
}

function getNetworkInfo(): NetworkOutput {
  const interfaces = networkInterfaces();
  const result: Record<string, unknown>[] = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (addrs) {
      for (const addr of addrs) {
        result.push({
          name,
          address: addr.address,
          family: addr.family,
          mac: addr.mac,
          internal: addr.internal
        });
      }
    }
  }

  return { success: true, data: result };
}

function ping(host: string): Promise<NetworkOutput> {
  return new Promise((resolve) => {
    assertSafeHost(host);
    const args = process.platform === "win32" ? ["-n", "4", host] : ["-c", "4", host];
    const child = spawn("ping", args, { shell: false, timeout: 10000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve({ success: true, data: stdout });
      else resolve({ success: false, error: stderr || stdout || `ping exited with code ${code}` });
    });
    child.on("error", (err) => resolve({ success: false, error: err.message }));
  });
}

function dnsLookup(host: string): Promise<NetworkOutput> {
  return new Promise((resolve) => {
    assertSafeHost(host);
    const cmd = process.platform === "win32" ? "nslookup" : "dig";
    const child = spawn(cmd, [host], { shell: false, timeout: 10000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve({ success: true, data: stdout });
      else resolve({ success: false, error: stderr || stdout || `dns lookup failed` });
    });
    child.on("error", (err) => resolve({ success: false, error: err.message }));
  });
}

function curl(url: string): Promise<NetworkOutput> {
  return new Promise((resolve) => {
    if (!SAFE_URL.test(url)) {
      resolve({ success: false, error: `Invalid URL: "${url}"` });
      return;
    }
    const child = spawn("curl", ["-s", "-L", url], { shell: false, timeout: 30000 });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve({ success: true, data: stdout.substring(0, 50000) });
      else resolve({ success: false, error: stderr || `curl exited with code ${code}` });
    });
    child.on("error", (err) => resolve({ success: false, error: err.message }));
  });
}

function downloadFile(url: string, outputPath: string): Promise<NetworkOutput> {
  return new Promise((resolve) => {
    if (!SAFE_URL.test(url)) {
      resolve({ success: false, error: `Invalid URL: "${url}"` });
      return;
    }
    const child = spawn("curl", ["-L", "-o", outputPath, url], { shell: false, timeout: 60000 });
    let stderr = "";
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve({ success: true, data: `Downloaded to ${outputPath}` });
      else resolve({ success: false, error: stderr || `curl exited with code ${code}` });
    });
    child.on("error", (err) => resolve({ success: false, error: err.message }));
  });
}

export default createNetworkTool;
