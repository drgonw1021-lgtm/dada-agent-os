import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createSkillCreateTool } from "../tools/builtin/skill-create-tool.js";

test("skill.create writes a reusable skill draft", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-skill-create-"));
  try {
    const tool = createSkillCreateTool(tempDir);
    const result = await tool.execute(
      {
        name: "Video Analysis",
        description: "Analyze uploaded video files",
        triggers: ["video", "media"],
        instructions: "Inspect media files and summarize evidence.",
        tools: ["media", "vision"]
      },
      {
        now: new Date(),
        taskId: "task-1",
        taskLineageId: "task-1",
        goal: "test"
      }
    );

    assert.equal(result.success, true);
    assert.equal(existsSync(result.path || ""), true);
    const content = readFileSync(result.path || "", "utf8");
    assert.match(content, /name: video-analysis/);
    assert.match(content, /Analyze uploaded video files/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
