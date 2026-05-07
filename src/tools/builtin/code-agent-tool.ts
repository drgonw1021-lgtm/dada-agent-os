import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { PermissionScope, ToolContext, ToolDefinition } from "../../core/types.js";
import { parseJsonFromLLMOutput } from "../../domains/llm-output-parser.js";

export interface CodeAgentInput {
  goal: string;
  repoContext?: string;
  constraints?: string[];
  preferredStack?: string;
}

export interface CodeAgentOutput {
  success: boolean;
  summary?: string;
  plan?: {
    architecture: string[];
    filesToInspect: string[];
    filesToChange: string[];
    validation: string[];
    missingCapabilities: string[];
  };
  savedPlanPath?: string;
  error?: string;
}

export function createCodeAgentTool(
  rootDir: string,
  modelCompleter: (prompt: string) => Promise<string>
): ToolDefinition<CodeAgentInput, CodeAgentOutput> {
  return {
    id: "code.agent",
    description: "Intelligent coding orchestrator: produce architecture-aware implementation and verification plans before editing code",
    requiredScopes: ["filesystem.write", "shell.exec"] as PermissionScope[],
    riskLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string", description: "Coding goal description" },
        repoContext: { type: "string", description: "Repository context" },
        constraints: { type: "array", items: { type: "string" }, description: "Constraints to follow" },
        preferredStack: { type: "string", description: "Preferred tech stack" }
      },
      required: ["goal"]
    },
    async execute(input: CodeAgentInput, context: ToolContext): Promise<CodeAgentOutput> {
      const prompt = [
        "You are an expert coding agent planner.",
        "Produce an implementation-first coding plan grounded in architecture, file changes, and verification.",
        "",
        `Goal: ${input.goal}`,
        input.preferredStack ? `Preferred stack: ${input.preferredStack}` : "",
        input.repoContext ? `Repo context:\n${input.repoContext}` : "",
        input.constraints?.length ? `Constraints:\n${input.constraints.map((item) => `- ${item}`).join("\n")}` : "",
        "",
        "Respond as JSON with keys:",
        "{",
        '  "summary": "short summary",',
        '  "architecture": ["..."],',
        '  "filesToInspect": ["..."],',
        '  "filesToChange": ["..."],',
        '  "validation": ["..."],',
        '  "missingCapabilities": ["..."]',
        "}"
      ]
        .filter(Boolean)
        .join("\n");

      try {
        const response = await modelCompleter(prompt);
        const parsed = parseJsonFromLLMOutput(response);
        if (!parsed || typeof parsed !== "object") {
          return { success: false, error: "Failed to parse coding plan JSON" };
        }

        const typed = parsed as {
          summary?: string;
          architecture?: string[];
          filesToInspect?: string[];
          filesToChange?: string[];
          validation?: string[];
          missingCapabilities?: string[];
        };

        const plan = {
          architecture: parsed.architecture ?? [],
          filesToInspect: parsed.filesToInspect ?? [],
          filesToChange: parsed.filesToChange ?? [],
          validation: parsed.validation ?? [],
          missingCapabilities: parsed.missingCapabilities ?? []
        };

        const planDir = resolve(rootDir, ".agent", "coding-plans");
        await mkdir(planDir, { recursive: true });
        const savedPlanPath = join(planDir, `${context.taskId}.json`);
        await writeFile(
          savedPlanPath,
          JSON.stringify(
            {
              goal: input.goal,
              summary: parsed.summary ?? "",
              plan
            },
            null,
            2
          ),
          "utf8"
        );

        return {
          success: true,
          summary: parsed.summary ?? "",
          plan,
          savedPlanPath
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    }
  };
}
