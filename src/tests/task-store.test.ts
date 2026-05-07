import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { TaskStore } from "../tasks/task-store.js";

test("task store persists lifecycle transitions", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-task-store-"));

  try {
    const store = new TaskStore(join(tempDir, "tasks.json"));
    const created = await store.create({
      taskId: "task-1",
      goal: "do work",
      source: "manual"
    });

    assert.equal(created.status, "pending");
    assert.equal(created.retryCount, 0);
    assert.equal(created.maxRetries, 0);

    await store.markRunning("task-1");
    await store.markCompleted("task-1", { summary: "done", result: { ok: true } });

    const saved = await store.get("task-1");
    assert.equal(saved?.status, "completed");
    assert.equal(saved?.summary, "done");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("task store supports cancellation and retry records", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-task-store-control-"));

  try {
    const store = new TaskStore(join(tempDir, "tasks.json"));
    await store.create({
      taskId: "task-1",
      goal: "do work",
      source: "manual",
      maxRetries: 1
    });

    const cancelled = await store.requestCancel("task-1");
    assert.equal(cancelled?.status, "cancelled");

    const retry = await store.createRetry("task-1", "task-2");
    assert.equal(retry?.status, "pending");
    assert.equal(retry?.retryCount, 1);
    assert.equal(retry?.parentTaskId, "task-1");

    const original = await store.get("task-1");
    assert.equal(original?.retriedByTaskId, "task-2");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("task store creates replay records for failed tasks", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-task-store-replay-"));

  try {
    const store = new TaskStore(join(tempDir, "tasks.json"));
    await store.create({
      taskId: "task-1",
      goal: "do work",
      source: "manual"
    });
    await store.markFailed("task-1", "boom");

    const replay = await store.createReplay("task-1", "task-2", "replay goal");
    assert.equal(replay?.status, "pending");
    assert.equal(replay?.goal, "replay goal");
    assert.equal(replay?.replayOfTaskId, "task-1");

    const original = await store.get("task-1");
    assert.equal(original?.replayedByTaskId, "task-2");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
