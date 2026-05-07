import test from "node:test";
import assert from "node:assert/strict";
import type { ToolDefinition } from "../core/types.js";
import { evaluateApprovalPolicy } from "../governance/approval-policy.js";

const shellTool: ToolDefinition<{ command: string }, unknown> = {
  id: "shell.exec",
  description: "Execute shell command",
  requiredScopes: ["shell.exec"],
  riskLevel: "high",
  async execute() {
    return {};
  }
};

test("balanced approval policy auto-allows safe check commands", () => {
  const decision = evaluateApprovalPolicy(
    shellTool,
    { command: "npm.cmd run check" },
    { preset: "balanced" }
  );

  assert.equal(decision.action, "allow");
});

test("balanced approval policy requires approval for destructive commands", () => {
  const decision = evaluateApprovalPolicy(
    shellTool,
    { command: "Remove-Item -Recurse .\\dist" },
    { preset: "balanced" }
  );

  assert.equal(decision.action, "require_approval");
});

test("strict approval policy always requires approval for high-risk tools", () => {
  const decision = evaluateApprovalPolicy(
    shellTool,
    { command: "npm.cmd run check" },
    { preset: "strict" }
  );

  assert.equal(decision.action, "require_approval");
});
