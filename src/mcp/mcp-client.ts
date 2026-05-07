import { spawn, ChildProcess } from "node:child_process";
import { createInterface, Interface } from "node:readline";

// ── Types ──────────────────────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[]; items?: Record<string, unknown>; properties?: Record<string, unknown>; required?: string[]; default?: unknown }>;
    required?: string[];
  };
}

export interface McpServerInfo {
  name: string;
  version: string;
  tools: McpToolDef[];
}

// ── Client ─────────────────────────────────────────────────────────────────────

export class McpClient {
  private proc: ChildProcess | null = null;
  private rl: Interface | null = null;
  private reqId = 0;
  private pending = new Map<number, { resolve: (v: JsonRpcResponse) => void; reject: (e: Error) => void }>();
  private buffer = "";

  constructor(private readonly command: string, private readonly args: string[], private readonly env?: Record<string, string>) {}

  async connect(): Promise<McpServerInfo> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`MCP server startup timed out: ${this.command} ${this.args.join(" ")}`));
      }, 30000);

      this.proc = spawn(this.command, this.args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...this.env },
        shell: process.platform === "win32",
      });

      this.proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      this.proc.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          console.warn(`[McpClient] ${this.command} exited with code ${code}`);
        }
      });

      this.rl = createInterface({ input: this.proc.stdout!, crlfDelay: Infinity });
      this.rl.on("line", (line: string) => {
        try {
          const resp = JSON.parse(line) as JsonRpcResponse;
          const handler = this.pending.get(resp.id);
          if (handler) {
            this.pending.delete(resp.id);
            handler.resolve(resp);
          }
        } catch {
          // skip non-JSON lines
        }
      });

      // Send initialize
      this.send("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "dada", version: "0.5.3" },
      })
        .then((initResp) => {
          if (initResp.error) {
            clearTimeout(timeout);
            reject(new Error(`MCP init error: ${initResp.error.message}`));
            return;
          }
          const serverInfo = initResp.result as { name: string; version: string };
          // Send initialized notification
          this.sendNotification("notifications/initialized", {});
          // Get tools
          return this.listTools().then((tools) => {
            clearTimeout(timeout);
            resolve({ name: serverInfo.name, version: serverInfo.version, tools });
          });
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  }

  async listTools(): Promise<McpToolDef[]> {
    const resp = await this.send("tools/list", {});
    if (resp.error) throw new Error(`tools/list failed: ${resp.error.message}`);
    const result = resp.result as { tools?: McpToolDef[] };
    return result.tools || [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const resp = await this.send("tools/call", { name, arguments: args });
    if (resp.error) throw new Error(`Tool "${name}" failed: ${resp.error.message}`);
    return resp.result;
  }

  async disconnect(): Promise<void> {
    for (const [, h] of this.pending) h.reject(new Error("Client disconnected"));
    this.pending.clear();
    this.rl?.close();
    this.proc?.kill();
    this.proc = null;
    this.rl = null;
  }

  get connected(): boolean {
    return this.proc !== null && !this.proc.killed;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async send(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    if (!this.proc || this.proc.killed) {
      throw new Error("MCP client not connected");
    }
    const id = ++this.reqId;
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin!.write(JSON.stringify(req) + "\n");
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.proc || this.proc.killed) return;
    const notif = { jsonrpc: "2.0", method, params };
    this.proc.stdin!.write(JSON.stringify(notif) + "\n");
  }
}
