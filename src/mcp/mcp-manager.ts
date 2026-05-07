import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { McpClient, type McpToolDef } from "./mcp-client.js";

interface McpConfig {
  servers: Array<{
    name: string;
    packageName: string;
    command: string;
    args: string[];
    env?: Record<string, string>;
    installedAt: string;
  }>;
}

export interface McpToolCallResult {
  success: boolean;
  result?: unknown;
  error?: string;
}

export class McpManager {
  private clients = new Map<string, McpClient>();
  private tools = new Map<string, { serverName: string; tool: McpToolDef }>();
  private configPath: string;

  constructor(private readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.configPath = join(dataDir, "mcp-config.json");
  }

  getConfig(): McpConfig {
    try {
      return JSON.parse(readFileSync(this.configPath, "utf8")) as McpConfig;
    } catch {
      return { servers: [] };
    }
  }

  private saveConfig(config: McpConfig): void {
    writeFileSync(this.configPath, JSON.stringify(config, null, 2), "utf8");
  }

  async connect(name: string, command: string, args: string[], env?: Record<string, string>): Promise<McpToolDef[]> {
    if (this.clients.has(name)) {
      await this.disconnect(name);
    }

    const client = new McpClient(command, args, env);
    const info = await client.connect();
    this.clients.set(name, client);

    for (const tool of info.tools) {
      const toolId = `mcp:${name}.${tool.name}`;
      this.tools.set(toolId, { serverName: name, tool });
    }

    console.log(`[McpManager] Connected to "${name}" — ${info.tools.length} tools available`);
    return info.tools;
  }

  async disconnect(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (client) {
      await client.disconnect().catch(() => {});
      this.clients.delete(name);
    }
    // Remove all tools from this server
    for (const [id, entry] of this.tools) {
      if (entry.serverName === name) this.tools.delete(id);
    }
  }

  async installServer(packageName: string, env?: Record<string, string>): Promise<{ name: string; tools: McpToolDef[] }> {
    const name = packageName.replace(/^@/, "").replace(/\//g, "-").replace(/-mcp(-server)?$/, "");

    // Determine command and args based on package name pattern
    let command = "npx";
    let args = ["-y", packageName];

    // Some MCP servers use different entry points
    if (packageName === "@brave/brave-search-mcp-server" || packageName === "brave-search-mcp") {
      args = ["-y", packageName];
    }

    console.log(`[McpManager] Installing ${packageName}...`);
    const tools = await this.connect(name, command, args, env);

    // Save to config
    const config = this.getConfig();
    const existing = config.servers.findIndex((s) => s.name === name);
    const entry = {
      name,
      packageName,
      command,
      args,
      env,
      installedAt: new Date().toISOString(),
    };
    if (existing >= 0) config.servers[existing] = entry;
    else config.servers.push(entry);
    this.saveConfig(config);

    return { name, tools };
  }

  async callTool(fullName: string, args: Record<string, unknown>): Promise<McpToolCallResult> {
    const entry = this.tools.get(fullName);
    if (!entry) {
      return { success: false, error: `Tool not found: ${fullName}` };
    }
    // Don't reconnect - fail fast so agent can handle it
    const client = this.clients.get(entry.serverName);
    if (!client) {
      return { success: false, error: `MCP server "${entry.serverName}" not connected. Restart required.` };
    }
    try {
      const result = await client.callTool(entry.tool.name, args);
      return { success: true, result };
    } catch (e: unknown) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  listTools(): Array<{ id: string; description: string; inputSchema: McpToolDef["inputSchema"] }> {
    const result: Array<{ id: string; description: string; inputSchema: McpToolDef["inputSchema"] }> = [];
    for (const [id, entry] of this.tools) {
      result.push({
        id,
        description: entry.tool.description || `${entry.tool.name} (MCP tool from ${entry.serverName})`,
        inputSchema: entry.tool.inputSchema,
      });
    }
    return result;
  }

  listServers(): string[] {
    return Array.from(this.clients.keys());
  }

  async shutDown(): Promise<void> {
    const names = Array.from(this.clients.keys());
    await Promise.all(names.map((n) => this.disconnect(n).catch(() => {})));
  }
}

export function createMcpManager(dataDir: string): McpManager {
  return new McpManager(dataDir);
}
