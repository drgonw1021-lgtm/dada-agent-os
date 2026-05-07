import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AutomationRegistry } from "../automation/automation-registry.js";
import { AutomationRunner } from "../automation/automation-runner.js";

test("automation runner enqueues due interval automations", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-automation-runner-"));

  try {
    const registry = new AutomationRegistry(join(tempDir, "automations.json"));
    const automation = await registry.create({
      name: "interval-task",
      goal: "check repo",
      type: "interval",
      intervalMinutes: 10
    });

    await registry.markRun(automation.id, "2026-01-01T00:00:00.000Z");

    const queued: string[] = [];
    const runner = new AutomationRunner(registry, async (item) => {
      queued.push(item.id);
    });

    const triggered = await runner.tick("2026-01-01T00:10:00.000Z");
    assert.equal(triggered, 1);
    assert.deepEqual(queued, [automation.id]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
