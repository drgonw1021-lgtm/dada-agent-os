import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskPausedForApprovalError } from "../core/errors.js";
import { TaskQueue } from "../tasks/task-queue.js";
import { TaskStore } from "../tasks/task-store.js";

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 1000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

test("task queue retries failed tasks within retry limit", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-task-queue-"));

  try {
    const store = new TaskStore(join(tempDir, "tasks.json"));
    let attempts = 0;
    const queue = new TaskQueue(
      store,
      async ({ taskId }) => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error(`planned failure ${taskId}`);
        }
        return {
          taskId,
          success: true,
          summary: "done",
          steps: []
        };
      },
      { defaultMaxRetries: 1 }
    );

    await queue.initialize();
    await queue.enqueue({ goal: "do work", source: "manual" });

    await waitFor(async () => {
      const stats = await store.getStats();
      return stats.failed === 1 && stats.completed === 1;
    });

    const tasks = await store.list();
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0]?.retriedByTaskId, tasks[1]?.taskId);
    assert.equal(tasks[1]?.retryCount, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("task queue marks task as waiting approval when runner pauses", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-task-queue-approval-"));

  try {
    const store = new TaskStore(join(tempDir, "tasks.json"));
    const queue = new TaskQueue(store, async () => {
      throw new TaskPausedForApprovalError("approval-1", "shell.exec");
    });

    await queue.initialize();
    const task = await queue.enqueue({ goal: "do risky work", source: "manual" });

    await waitFor(async () => (await store.get(task.taskId))?.status === "waiting_approval");

    const latest = await store.get(task.taskId);
    assert.equal(latest?.status, "waiting_approval");
    assert.equal(latest?.waitingApprovalId, "approval-1");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
