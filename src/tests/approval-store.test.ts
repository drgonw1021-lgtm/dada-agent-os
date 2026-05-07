import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ApprovalStore } from "../governance/approval-store.js";

test("approval store creates, approves, and consumes approval", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-approval-store-"));

  try {
    const store = new ApprovalStore(join(tempDir, "approvals.json"));
    const pending = await store.ensurePending({
      taskId: "task-1",
      lineageTaskId: "task-1",
      goal: "run shell command",
      toolId: "shell.exec",
      input: { command: "echo hi" },
      reason: "high risk"
    });

    assert.equal(pending.status, "pending");

    await store.approve(pending.id, "looks safe");
    const approved = await store.findUsableApproval({
      lineageTaskId: "task-1",
      toolId: "shell.exec",
      input: { command: "echo hi" }
    });
    assert.equal(approved?.status, "approved");

    await store.consume(pending.id);
    const used = await store.get(pending.id);
    assert.equal(used?.status, "used");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
