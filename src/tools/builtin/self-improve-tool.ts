import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";
import { parseJsonFromLLMOutput } from "../../domains/llm-output-parser.js";

export interface SelfImproveInput {
  task: string;
  language?: string;
  testFramework?: string;
  testCommand?: string;
  maxIterations?: number;
}

export interface SelfImproveOutput {
  success: boolean;
  finalCode?: string;
  testResults?: Array<{
    iteration: number;
    code: string;
    testOutput: string;
    passed: boolean;
    error?: string;
  }>;
  iterations: number;
  finalSummary?: string;
  error?: string;
}

export function createSelfImproveTool(
  writeRoots: string[],
  modelCompleter: (prompt: string) => Promise<string>
): ToolDefinition<SelfImproveInput, SelfImproveOutput> {
  return {
    id: "code.self_improve",
    description: "Self-improvement loop: generate code, run tests, fix issues iteratively",
    requiredScopes: ["filesystem.read", "filesystem.write", "shell.exec"] as PermissionScope[],
    riskLevel: "high",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Code generation task description" },
        language: { type: "string", description: "Programming language (default typescript)" },
        testFramework: { type: "string", description: "Test framework (default jest)" },
        testCommand: { type: "string", description: "Custom test command" },
        maxIterations: { type: "number", description: "Maximum improvement iterations (default 3)" }
      },
      required: ["task"]
    },
    async execute(input: SelfImproveInput, context: ToolContext): Promise<SelfImproveOutput> {
      const { task, language = "typescript", testFramework = "jest", maxIterations = 3 } = input;

      const testResults: SelfImproveOutput["testResults"] = [];
      let currentCode = "";
      let finalSummary = "";

      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        try {
          let prompt: string;

          if (iteration === 1) {
            prompt = [
              "You are a code generation expert. Generate production-ready code with corresponding tests.",
              "",
              `Task: ${task}`,
              `Language: ${language}`,
              `Test framework: ${testFramework}`,
              "",
              "Respond in JSON format:",
              "{",
              '  "code": "the main code file",',
              '  "testCode": "the test file code",',
              '  "explanation": "brief explanation"',
              "}"
            ].join("\n");
          } else {
            const previousResult = testResults[iteration - 2];
            prompt = [
              "You are a code improvement expert. Fix the issues found in the previous iteration.",
              "",
              `Task: ${task}`,
              `Language: ${language}`,
              `Test framework: ${testFramework}`,
              "",
              `Previous code:\n\`\`\`\n${previousResult?.code || currentCode}\n\`\`\``,
              `Previous test output:\n\`\`\`\n${previousResult?.testOutput}\n\`\`\``,
              previousResult?.error ? `Error: ${previousResult.error}` : "",
              "",
              "Respond in JSON format:",
              "{",
              '  "code": "the fixed code",',
              '  "testCode": "the updated test file",',
              '  "explanation": "what was fixed"',
              "}"
            ].filter(Boolean).join("\n");
          }

          const result = await modelCompleter(prompt);
          const parsed = parseJsonFromLLMOutput(result);

          if (!parsed || typeof parsed !== "object") {
            testResults.push({
              iteration,
              code: currentCode,
              testOutput: "Failed to parse model response",
              passed: false,
              error: "Parse error"
            });
            continue;
          }

          currentCode = parsed.code || parsed.generatedCode || "";

          const workDir = resolve(writeRoots[0] || ".");
          const codePath = join(workDir, `.agent/temp/improve_${context.taskId}.${language === "python" ? "py" : "ts"}`);
          const testPath = join(workDir, `.agent/temp/improve_${context.taskId}.test.${language === "python" ? "py" : "ts"}`);

          await mkdir(resolve(workDir, ".agent/temp"), { recursive: true });
          await writeFile(codePath, currentCode, "utf8");

          let testCode = parsed.testCode;
          if (testCode) {
            await writeFile(testPath, testCode, "utf8");
          }

          let testOutput = "";
          let testPassed = false;
          let testError: string | undefined;

          if (testCode) {
            try {
              const testProc = await runTest(codePath, testPath, testFramework, language);
              testOutput = testProc.stdout + testProc.stderr;
              testPassed = testProc.exitCode === 0;
              testError = testPassed ? undefined : `Exit code: ${testProc.exitCode}`;
            } catch (e) {
              testError = e instanceof Error ? e.message : String(e);
              testOutput = testError;
            }
          }

          testResults.push({
            iteration,
            code: currentCode,
            testOutput,
            passed: testPassed,
            error: testError
          });

          if (testPassed) {
            finalSummary = `Successfully generated and verified code in ${iteration} iteration(s)`;
            break;
          }

          if (iteration === maxIterations) {
            finalSummary = `Completed ${maxIterations} iterations, tests still failing. Last output: ${testOutput}`;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          testResults.push({
            iteration,
            code: currentCode,
            testOutput: message,
            passed: false,
            error: message
          });
        }
      }

      return {
        success: testResults[testResults.length - 1]?.passed ?? false,
        finalCode: currentCode,
        testResults,
        iterations: testResults.length,
        finalSummary
      };
    }
  };
}

async function runTest(
  codePath: string,
  testPath: string,
  framework: string,
  language: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    let command: string;
    let args: string[];

    if (language === "python") {
      if (framework === "pytest") {
        command = "pytest";
        args = [testPath, "-v"];
      } else {
        command = "python";
        args = ["-m", "unittest", testPath];
      }
    } else {
      if (framework === "jest") {
        command = "npx";
        args = ["jest", testPath];
      } else if (framework === "vitest") {
        command = "npx";
        args = ["vitest", "run", testPath];
      } else {
        command = "npx";
        args = ["ts-node", testPath];
      }
    }

    const proc = spawn(command, args, { stdio: "pipe" });
    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => { stdout += data.toString(); });
    proc.stderr?.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on("error", () => {
      resolve({ stdout, stderr, exitCode: 1 });
    });
  });
}