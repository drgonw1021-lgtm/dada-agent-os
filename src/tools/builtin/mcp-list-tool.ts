import type { ToolDefinition, ToolContext } from "../../core/types.js";
import type { McpManager } from "../../mcp/mcp-manager.js";

export interface McpListOutput {
  success: boolean;
  servers?: Array<{
    name: string;
    toolCount: number;
    tools: Array<{ id: string; description: string }>;
  }>;
  totalServers?: number;
  totalTools?: number;
  hint?: string;
  error?: string;
}

export function createMcpListTool(mcpManager: McpManager): ToolDefinition<{}, McpListOutput> {
  return {
    id: "mcp.list",
    description:
      "List all installed and connected MCP (Model Context Protocol) servers and their available tools. " +
      "Use this to see what MCP capabilities are currently active.",
    requiredScopes: [],
    riskLevel: "low",
    inputSchema: {
      type: "object",
      properties: {},
      required: []
    },
    async execute(_input: {}, _context: ToolContext): Promise<McpListOutput> {
      try {
        const serverNames = mcpManager.listServers();
        const allTools = mcpManager.listTools();

        // Group tools by server
        const servers = serverNames.map(name => {
          const serverTools = allTools
            .filter(t => t.id.startsWith(`mcp:${name}.`))
            .map(t => ({ id: t.id, description: t.description }));
          return { name, toolCount: serverTools.length, tools: serverTools };
        });

        const totalTools = allTools.length;

        if (servers.length === 0) {
          return {
            success: true,
            servers: [],
            totalServers: 0,
            totalTools: 0,
            hint: "No MCP servers installed. Use mcp.search to discover available servers, then mcp.install to add them."
          };
        }

        return {
          success: true,
          servers,
          totalServers: servers.length,
          totalTools,
          hint: `Use mcp.install with uninstall:true to remove a server. Use tools.list to see all tools including built-in and MCP tools.`
        };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    }
  };
}
