import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createCodeAgentTool } from "../tools/builtin/code-agent-tool.js";

test("code.agent creates a coding plan artifact", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-code-agent-"));
  try {
    const tool = createCodeAgentTool(tempDir, async () =>
      JSON.stringify({
        summary: "Plan the fix",
        architecture: ["Keep the module boundary stable"],
        filesToInspect: ["src/server.ts"],
        filesToChange: ["src/runtime/agent-runtime.ts"],
        validation: ["npm test"],
        missingCapabilities: []
      })
    );

    const result = await tool.execute(
      { goal: "Fix the task router" },
      {
        now: new Date(),
        taskId: "task-1",
        taskLineageId: "task-1",
        goal: "Fix the task router"
      }
    );

    assert.equal(result.success, true);
    assert.equal(Boolean(result.savedPlanPath), true);
    assert.equal(result.plan?.filesToInspect.includes("src/server.ts"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
