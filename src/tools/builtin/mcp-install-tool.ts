import type { ToolDefinition, ToolContext } from "../../core/types.js";
import type { McpManager } from "../../mcp/mcp-manager.js";

export interface McpInstallInput {
  /** npm package name to install. Use package names from mcp.search results. */
  packageName: string;
  /** Environment variables for the MCP server (e.g., API keys) */
  env?: Record<string, string>;
  /** Set to true to uninstall instead */
  uninstall?: boolean;
}

export interface McpInstallOutput {
  success: boolean;
  /** Name of the connected MCP server */
  serverName?: string;
  /** Tools now available from this MCP server */
  installedTools?: string[];
  error?: string;
  /** Hint for what to do next */
  hint?: string;
}

export function createMcpInstallTool(mcpManager: McpManager): ToolDefinition<McpInstallInput, McpInstallOutput> {
  return {
    id: "mcp.install",
    description:
      "Install and connect to an MCP (Model Context Protocol) server from npm. " +
      "Once installed, all tools from the MCP server become available as 'mcp:<server>.<tool>' tools. " +
      "Use mcp.search first to find available MCP servers, then install the ones you need. " +
      "IMPORTANT: Some MCP servers require API keys — set them in the env parameter (e.g., {BRAVE_SEARCH_API_KEY: 'xxx'}).",
    requiredScopes: ["shell.exec", "filesystem.write"],
    riskLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        packageName: {
          type: "string",
          description:
            "npm package name of the MCP server to install. Get package names from mcp.search results. Examples: '@brave/brave-search-mcp-server', 'pdf-mcp-server', 'pptxgenjs-mcp-server'",
        },
        env: {
          type: "object",
          description:
            "Environment variables to pass to the MCP server. Required for API-key-based servers. Example: {BRAVE_SEARCH_API_KEY: 'BSA...'}",
        },
        uninstall: {
          type: "boolean",
          description: "Set to true to uninstall and disconnect this MCP server",
          default: false,
        },
      },
      required: ["packageName"],
    },
    async execute(input: McpInstallInput, _context: ToolContext): Promise<McpInstallOutput> {
      const { packageName, env, uninstall } = input;

      try {
        if (uninstall) {
          const serverName = packageName.replace(/^@/, "").replace(/\//g, "-").replace(/-mcp(-server)?$/, "");
          await mcpManager.disconnect(serverName);
          return {
            success: true,
            serverName,
            hint: `MCP server "${serverName}" disconnected. Its tools are no longer available.`,
          };
        }

        console.log(`[mcp.install] Installing ${packageName}...`);
        const result = await mcpManager.installServer(packageName, env);
        const toolIds = result.tools.map((t) => `mcp:${result.name}.${t.name}`);

        return {
          success: true,
          serverName: result.name,
          installedTools: toolIds,
          hint: `${result.tools.length} new tools available: ${toolIds.join(", ")}. Use 'tools.list' to see all available tools.`,
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          success: false,
          error: msg,
          hint: `Install failed. Try: 1) Check the package name is correct 2) Ensure the package exists on npm 3) Some MCP servers need API keys in env. You can also try manually: shell.exec "npx -y ${packageName}"`,
        };
      }
    },
  };
}
