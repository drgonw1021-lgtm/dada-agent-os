import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalRequiredError } from "../core/errors.js";
import type { PermissionScope, ToolDefinition } from "../core/types.js";
import { ApprovalStore } from "../governance/approval-store.js";
import { PermissionGate } from "../governance/permission-gate.js";
import { RiskPolicy } from "../governance/risk-policy.js";
import { ToolRegistry } from "../tools/tool-registry.js";

test("tool registry requests approval for high-risk tool and allows approved retry", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-tool-approval-"));

  try {
    const approvals = new ApprovalStore(join(tempDir, "approvals.json"));
    const registry = new ToolRegistry(
      new PermissionGate(new Set<PermissionScope>(["shell.exec"])),
      new RiskPolicy({ allowHighRisk: false, requireApprovalForHighRisk: true }),
      approvals
    );

    const tool: ToolDefinition<{ command: string }, { ok: boolean }> = {
      id: "shell.exec",
      description: "Execute a shell command",
      requiredScopes: ["shell.exec"],
      riskLevel: "high",
      async execute() {
        return { ok: true };
      }
    };
    registry.register(tool);

    await assert.rejects(
      () =>
        registry.execute(
          "shell.exec",
          { command: "python -c 'print(1)'" },
          {
            now: new Date(),
            taskId: "task-1",
            taskLineageId: "task-1",
            goal: "test approval"
          }
        ),
      (error: unknown) => error instanceof ApprovalRequiredError
    );

    const [approval] = await approvals.list();
    assert.equal(approval?.status, "pending");

    await approvals.approve(approval.id);
    const result = await registry.execute(
      "shell.exec",
      { command: "python -c 'print(1)'" },
      {
        now: new Date(),
        taskId: "task-2",
        taskLineageId: "task-1",
        goal: "test approval"
      }
    );

    assert.deepEqual(result, { ok: true });
    const used = await approvals.get(approval.id);
    assert.equal(used?.status, "used");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
