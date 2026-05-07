import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PermissionScope, ToolContext, ToolDefinition } from "../../core/types.js";

export interface SkillCreateInput {
  name: string;
  description: string;
  triggers?: string[];
  instructions: string;
  tools?: string[];
}

export interface SkillCreateOutput {
  success: boolean;
  path?: string;
  name?: string;
  error?: string;
}

function safeSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64) || "generated-skill";
}

function buildSkillMarkdown(input: SkillCreateInput, safeName: string): string {
  const triggers = (input.triggers ?? [])
    .map((trigger) => trigger.trim())
    .filter(Boolean)
    .join(", ");
  const tools = (input.tools ?? []).map((tool) => `- ${tool}`).join("\n");

  return [
    "---",
    `name: ${safeName}`,
    `description: ${input.description}`,
    "version: 0.1.0",
    triggers ? `triggers: ${triggers}` : "",
    "---",
    "",
    `# ${input.name}`,
    "",
    "## Purpose",
    "",
    input.description,
    "",
    "## When to Use",
    "",
    input.instructions,
    "",
    tools ? "## Suggested Tools" : "",
    tools,
    "",
    "## Operating Rules",
    "",
    "- Prefer existing safe tools before high-risk tools.",
    "- If the workflow is uncertain, produce a plan before acting.",
    "- If a high-risk operation is required, request approval.",
    "- Record assumptions and verification steps in the final result.",
    ""
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function createSkillCreateTool(rootDir = "./.agent/skills"): ToolDefinition<SkillCreateInput, SkillCreateOutput> {
  return {
    id: "skill.create",
    description: "Create a reusable local DaDa skill draft when the current task needs a missing workflow capability",
    requiredScopes: ["filesystem.write"] as PermissionScope[],
    riskLevel: "high",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string" as const, description: "Skill name (will be slugified)" },
        description: { type: "string" as const, description: "Skill description" },
        triggers: { type: "array" as const, description: "Trigger keywords or phrases", items: { type: "string" as const } },
        instructions: { type: "string" as const, description: "Skill instructions/behavior definition" },
        tools: { type: "array" as const, description: "Suggested tool names for this skill", items: { type: "string" as const } }
      },
      required: ["name", "description", "instructions"]
    },
    async execute(input: SkillCreateInput, context: ToolContext): Promise<SkillCreateOutput> {
      if (!input.name?.trim() || !input.description?.trim() || !input.instructions?.trim()) {
        return { success: false, error: "name, description and instructions are required" };
      }

      const safeName = safeSkillName(input.name);
      const filePath = resolve(rootDir, safeName, "SKILL.md");
      const root = resolve(rootDir);
      if (!filePath.startsWith(root)) {
        return { success: false, error: "resolved skill path escaped the skills directory" };
      }

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, buildSkillMarkdown(input, safeName), "utf8");

      return {
        success: true,
        name: safeName,
        path: filePath
      };
    }
  };
}
