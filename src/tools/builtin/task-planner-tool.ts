import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";
import { parseJsonFromLLMOutput } from "../../domains/llm-output-parser.js";

export interface TaskPlannerInput {
  goal: string;
  context?: string;
}

export interface TaskPlannerOutput {
  success: boolean;
  plan?: {
    steps: Array<{
      id: number;
      description: string;
      tool?: string;
      dependsOn?: number[];
    }>;
    reasoning: string;
  };
  error?: string;
}

export function createTaskPlannerTool(
  modelCompleter: (prompt: string) => Promise<string>
): ToolDefinition<TaskPlannerInput, TaskPlannerOutput> {
  return {
    id: "task.planner",
    description: "Decompose complex goals into actionable steps with dependencies",
    requiredScopes: [],
    riskLevel: "low",
    inputSchema: {
      type: "object" as const,
      properties: {
        goal: { type: "string" as const, description: "Complex goal to decompose into steps" },
        context: { type: "string" as const, description: "Additional context or constraints" }
      },
      required: ["goal"]
    },
    async execute(input: TaskPlannerInput, context: ToolContext): Promise<TaskPlannerOutput> {
      const { goal, context: ctx } = input;

      const prompt = [
        "You are a task planning expert. Decompose the given goal into clear, actionable steps.",
        "",
        `Goal: ${goal}`,
        ctx ? `\nContext:\n${ctx}` : "",
        "",
        "Available tools:",
        "- fs.enhanced (file operations)",
        "- code.exec (execute code)",
        "- code.generator (generate code)",
        "- code.improver (improve code)",
        "- code.self_improve (generate, test, and repair code iteratively)",
        "- web.fetch (fetch web content)",
        "- search (search web)",
        "- api.request (make API calls)",
        "- model (inspect, load, or manage built-in models)",
        "",
        "Respond in JSON format:",
        "{",
        '  "steps": [',
        '    {',
        '      "id": 1,',
        '      "description": "step description",',
        '      "tool": "optional tool to use",',
        '      "dependsOn": []',
        '    }',
        '  ],',
        '  "reasoning": "overall reasoning for the plan"',
        "}"
      ].filter(Boolean).join("\n");

      try {
        const result = await modelCompleter(prompt);

        const parsed = parseJsonFromLLMOutput(result);
        if (!parsed || typeof parsed !== "object") {
          return { success: false, error: "Failed to parse plan", plan: { steps: [], reasoning: result } };
        }
        return {
          success: true,
          plan: {
            steps: parsed.steps || [],
            reasoning: parsed.reasoning || ""
          }
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  };
}
