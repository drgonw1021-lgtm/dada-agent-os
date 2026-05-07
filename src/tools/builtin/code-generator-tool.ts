import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";
import { parseJsonFromLLMOutput } from "../../domains/llm-output-parser.js";

export interface CodeGeneratorInput {
  task: string;
  language?: string;
  existingCode?: string;
  constraints?: string[];
}

export interface CodeGeneratorOutput {
  success: boolean;
  generatedCode?: string;
  explanation?: string;
  error?: string;
}

export function createCodeGeneratorTool(
  writeRoots: string[],
  modelCompleter: (prompt: string) => Promise<string>
): ToolDefinition<CodeGeneratorInput, CodeGeneratorOutput> {
  return {
    id: "code.generator",
    description: "Generate code based on task description, can improve existing code or create new functionality",
    requiredScopes: ["filesystem.write", "shell.exec"] as PermissionScope[],
    riskLevel: "high",
    inputSchema: {
      type: "object" as const,
      properties: {
        task: { type: "string" as const, description: "Code generation task description" },
        language: { type: "string" as const, description: "Target programming language (e.g. typescript, python, rust)" },
        existingCode: { type: "string" as const, description: "Existing code to improve or extend" },
        constraints: { type: "array" as const, description: "Constraints or requirements", items: { type: "string" as const } }
      },
      required: ["task"]
    },
    async execute(input: CodeGeneratorInput, context: ToolContext): Promise<CodeGeneratorOutput> {
      const { task, language = "typescript", existingCode, constraints = [] } = input;

      const prompt = [
        "You are a code generator. Generate high-quality, production-ready code based on the task.",
        "",
        `Task: ${task}`,
        `Language: ${language}`,
        existingCode ? `\nExisting code to improve:\n\`\`\`\n${existingCode}\n\`\`\`` : "",
        constraints.length > 0 ? `\nConstraints:\n${constraints.map((c) => `- ${c}`).join("\n")}` : "",
        "",
        "Respond in JSON format:",
        "{",
        '  "generatedCode": "the generated code",',
        '  "explanation": "brief explanation of the code"',
        "}"
      ].filter(Boolean).join("\n");

      try {
        const result = await modelCompleter(prompt);

        const parsed = parseJsonFromLLMOutput(result);
        if (!parsed || typeof parsed !== "object") {
          return { success: false, error: "Failed to parse generated code", generatedCode: result };
        }

        return {
          success: true,
          generatedCode: parsed.generatedCode || parsed.code || result,
          explanation: parsed.explanation
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  };
}

export interface CodeImproverInput {
  filePath: string;
  task: string;
  language?: string;
}

export interface CodeImproverOutput {
  success: boolean;
  improvedCode?: string;
  explanation?: string;
  filePath?: string;
  error?: string;
}

export function createCodeImproverTool(
  readRoots: string[],
  writeRoots: string[],
  modelCompleter: (prompt: string) => Promise<string>
): ToolDefinition<CodeImproverInput, CodeImproverOutput> {
  function normalizePath(targetPath: string, roots: string[]): string | null {
    const resolved = resolve(targetPath);
    for (const root of roots) {
      const rootResolved = resolve(root);
      if (resolved.startsWith(rootResolved)) {
        return resolved;
      }
    }
    return null;
  }

  return {
    id: "code.improver",
    description: "Read existing code, analyze it, and generate improved version based on task",
    requiredScopes: ["filesystem.read", "filesystem.write", "shell.exec"] as PermissionScope[],
    riskLevel: "high",
    async execute(input: CodeImproverInput, context: ToolContext): Promise<CodeImproverOutput> {
      const { filePath, task, language = "typescript" } = input;

      const allowedPath = normalizePath(filePath, readRoots);
      if (!allowedPath) {
        return { success: false, error: `Path not in allowed read roots: ${filePath}` };
      }

      try {
        const existingCode = await readFile(allowedPath, "utf8");

        const prompt = [
          "You are a code improvement expert. Analyze the existing code and improve it based on the task.",
          "",
          `Task: ${task}`,
          `Language: ${language}`,
          `\nExisting code:\n\`\`\`\n${existingCode}\n\`\`\``,
          "",
          "Respond in JSON format:",
          "{",
          '  "improvedCode": "the improved code",',
          '  "explanation": "brief explanation of what was improved"',
          "}"
        ].join("\n");

        const result = await modelCompleter(prompt);

        const parsed = parseJsonFromLLMOutput(result);
        if (!parsed || typeof parsed !== "object") {
          return { success: false, error: "Failed to parse improved code" };
        }
        const improvedCode = parsed.improvedCode || parsed.code;

        if (improvedCode) {
          const writePath = normalizePath(filePath, writeRoots);
          if (writePath) {
            await writeFile(writePath, improvedCode, "utf8");
            return {
              success: true,
              improvedCode,
              explanation: parsed.explanation,
              filePath: writePath
            };
          }
        }

        return {
          success: true,
          improvedCode,
          explanation: parsed.explanation
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  };
}
