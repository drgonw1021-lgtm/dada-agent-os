import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AutomationRegistry } from "../automation/automation-registry.js";

test("automation registry creates and updates interval automations", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-automation-"));

  try {
    const registry = new AutomationRegistry(join(tempDir, "automations.json"));
    const created = await registry.create({
      name: "nightly-review",
      goal: "review the repo",
      type: "interval",
      intervalMinutes: 30
    });

    assert.equal(created.type, "interval");
    assert.ok(created.nextRunAt);

    const updated = await registry.markRun(created.id, "2026-01-01T00:00:00.000Z");
    assert.ok(updated);
    assert.equal(updated?.lastRunAt, "2026-01-01T00:00:00.000Z");
    assert.equal(updated?.nextRunAt, "2026-01-01T00:30:00.000Z");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
