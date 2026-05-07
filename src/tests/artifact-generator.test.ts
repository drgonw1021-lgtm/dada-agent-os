import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ArtifactGenerator } from "../tasks/artifact-generator.js";
import type { TaskResult } from "../core/types.js";
import type { TaskRecord } from "../tasks/task-store.js";

function buildTask(outputFormat: TaskRecord["outputFormat"]): TaskRecord {
  return {
    taskId: "task-1",
    goal: "make a research report",
    source: "manual",
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    retryCount: 0,
    maxRetries: 0,
    priority: 0,
    outputFormat
  };
}

const result: TaskResult = {
  taskId: "task-1",
  success: true,
  summary: "completed",
  steps: [{ step: 1, action: "done", reasoning: "done" }]
};

test("artifact generator creates pdf and markdown artifacts", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-artifacts-"));
  try {
    const generator = new ArtifactGenerator(tempDir);
    const artifacts = await generator.generate(buildTask("pdf"), result);
    assert.equal(artifacts.length >= 2, true);
    assert.equal(artifacts.some((item) => item.mimeType === "application/pdf"), true);
    assert.equal(artifacts.some((item) => item.kind === "markdown"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("artifact generator creates slides html artifacts", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-slides-"));
  try {
    const generator = new ArtifactGenerator(tempDir);
    const artifacts = await generator.generate(buildTask("slides"), result);
    assert.equal(artifacts.some((item) => item.kind === "slides"), true);
    assert.equal(artifacts.some((item) => item.mimeType === "application/pdf"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("artifact generator bundles report outputs for product research", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-report-bundle-"));
  try {
    const generator = new ArtifactGenerator(tempDir);
    const artifacts = await generator.generate(
      {
        ...buildTask("auto"),
        taskType: "product_research"
      },
      result
    );
    assert.equal(artifacts.some((item) => item.kind === "markdown"), true);
    assert.equal(artifacts.some((item) => item.kind === "pdf"), true);
    assert.equal(artifacts.some((item) => item.kind === "slides"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
