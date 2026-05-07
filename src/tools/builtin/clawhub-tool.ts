import type { ToolDefinition, ToolContext } from "../../core/types.js";
import type { ClawhubRuntime } from "../../skills/clawhub-runtime.js";

export interface ClawhubSearchInput {
  query: string;
  limit?: number;
}

export interface ClawhubSearchOutput {
  success: boolean;
  results?: Array<{ name: string; description: string; author?: string }>;
  error?: string;
}

export interface ClawhubInstallInput {
  name: string;
  uninstall?: boolean; // true = uninstall instead
}

export interface ClawhubInstallOutput {
  success: boolean;
  path?: string;
  tools?: string[];
  error?: string;
}

export function createClawhubSearchTool(runtime: ClawhubRuntime): ToolDefinition<ClawhubSearchInput, ClawhubSearchOutput> {
  return {
    id: "clawhub.search",
    description: "Search ClaWHub skill registry for available skills by keyword",
    requiredScopes: ["shell.exec"],
    riskLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keyword" },
        limit: { type: "number", description: "Max results (default 10)", default: 10 }
      },
      required: ["query"]
    },
    async execute(input: ClawhubSearchInput): Promise<ClawhubSearchOutput> {
      const results = await runtime.searchSkills(input.query);
      return { success: true, results: results.slice(0, input.limit ?? 10) };
    }
  };
}

export function createClawhubInstallTool(runtime: ClawhubRuntime): ToolDefinition<ClawhubInstallInput, ClawhubInstallOutput> {
  return {
    id: "clawhub.install",
    description: "Install or uninstall a ClaWHub skill into the local agent",
    requiredScopes: ["filesystem.write", "shell.exec"],
    riskLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name (e.g. openai-whisper)" },
        uninstall: { type: "boolean", description: "Set true to uninstall instead", default: false }
      },
      required: ["name"]
    },
    async execute(input: ClawhubInstallInput): Promise<ClawhubInstallOutput> {
      if (input.uninstall) {
        const result = await runtime.uninstallSkill(input.name);
        return { success: result.success, error: result.error };
      }

      const result = await runtime.installSkill(input.name);
      if (!result.success) return { success: false, error: result.error };

      const skill = runtime.getSkill(input.name);
      const tools = skill ? skill.scripts.map((s) => `clawhub:${skill.manifest.name}.${s.scriptName}`) : [];
      return { success: true, path: result.path, tools };
    }
  };
}
