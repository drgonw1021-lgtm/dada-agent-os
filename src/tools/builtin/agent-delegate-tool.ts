import type { ToolDefinition, PermissionScope } from "../../core/types.js";
import type { AgentHost } from "../../agents/agent-host.js";
import type { AgentRegistry } from "../../agents/agent-registry.js";

export function createAgentDelegateTool(
  agentHost: AgentHost,
  agentRegistry: AgentRegistry
): ToolDefinition {
  return {
    id: "agent.delegate",
    description:
      "Delegate a subtask to another AI agent in the mesh. Use this for parallel execution of independent subtasks. Other agents can search, write files, and execute tools just like you.",
    requiredScopes: [] as PermissionScope[],
    inputSchema: {
      type: "object",
      properties: {
        goal: {
          type: "string",
          description: "The subtask goal to delegate. Be specific about what you want the other agent to do."
        },
        taskType: {
          type: "string",
          description: "Type of task: research, code, data_analysis, media, automation, or general."
        },
        requiredCapabilities: {
          type: "array",
          items: { type: "string" },
          description: "Capabilities the delegate agent must have (e.g. search, code, vision, data-analysis)."
        },
        context: {
          type: "string",
          description: "Additional context the delegate needs to understand the task."
        },
        outputFormat: {
          type: "string",
          description: "Expected output format: text, json, markdown, or code."
        },
        timeoutMs: {
          type: "number",
          description: "Max time to wait for the delegation in ms. Default 120000 (2 min)."
        }
      },
      required: ["goal"]
    },
    riskLevel: "low",
    execute: async (args, _context) => {
      const params = args as {
        goal: string;
        taskType?: string;
        requiredCapabilities?: string[];
        context?: string;
        outputFormat?: string;
        timeoutMs?: number;
      };

      const allAgents = agentRegistry.list().filter(a => a.id !== agentHost.agentId);
      if (allAgents.length === 0) {
        return JSON.stringify({
          delegated: false,
          reason: "No other agents available in the mesh. Execute this subtask yourself.",
          hint: "You can create worker agents by starting additional DaDa instances with different roles."
        });
      }

      const result = await agentHost.delegateTask(
        {
          goal: params.goal,
          taskType: params.taskType || "general",
          context: params.context || "",
          outputFormat: params.outputFormat || "text"
        },
        {
          requiredCapabilities: params.requiredCapabilities,
          timeoutMs: params.timeoutMs || 120000
        }
      );

      return JSON.stringify({
        delegated: result.status === "completed",
        status: result.status,
        result: result.result,
        error: result.error,
        acceptedBy: result.acceptedBy?.substring(0, 8),
        retries: result.retries
      });
    }
  };
}

export function createAgentListTool(agentRegistry: AgentRegistry): ToolDefinition {
  return {
    id: "agent.list",
    description: "List all available agents in the mesh and their capabilities. Use before agent.delegate to find the right agent.",
    requiredScopes: [] as PermissionScope[],
    inputSchema: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          description: "Filter by capability (e.g. 'search', 'code')."
        },
        role: {
          type: "string",
          description: "Filter by role (e.g. 'executor', 'worker')."
        }
      },
      required: []
    },
    riskLevel: "low",
    execute: async (args, _context) => {
      const params = args as { capability?: string; role?: string };

      let agents = agentRegistry.list();
      if (params.capability) {
        agents = agentRegistry.findByCapability(params.capability);
      }
      if (params.role) {
        agents = agents.filter(a => a.role === params.role);
      }

      const summary = agents.map(a => ({
        id: a.id.substring(0, 8),
        name: a.name,
        role: a.role,
        capabilities: a.capabilities,
        status: a.status,
        load: `${a.activeTaskCount}/${a.maxConcurrency}`
      }));

      return JSON.stringify({
        total: summary.length,
        agents: summary,
        hint: summary.length === 0
          ? "No agents match your criteria. You can still execute the task yourself."
          : `Found ${summary.length} agent(s). Use agent.delegate to assign work to one.`
      });
    }
  };
}
