import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPublishPackageTool } from "../tools/builtin/social-publish-tool.js";

test("publish.package creates a safe publishing package instead of claiming a post", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-publish-package-"));
  try {
    const tool = createPublishPackageTool(tempDir);
    const result = await tool.execute(
      {
        platform: "douyin",
        title: "本周新闻大事件",
        spokenScript: "大家好，今天整理最近一周的大事件。",
        caption: "本周新闻速览",
        hashtags: ["新闻", "热点"],
        sourceUrls: ["https://example.com/news"],
        publishRequested: true
      },
      {
        now: new Date(),
        taskId: "task-social-1",
        taskLineageId: "task-social-1",
        goal: "发布到抖音"
      }
    );

    assert.equal(result.success, true);
    assert.equal(result.status, "blocked");
    assert.equal(result.platform, "douyin");
    assert.equal(existsSync(result.file || ""), true);
    assert.equal(result.blockers.some((item) => item.includes("Publishing bridge is not configured")), true);
    assert.equal(result.blockers.some((item) => item.includes("DaDa must not claim content was published")), true);
    const content = readFileSync(result.file || "", "utf8");
    assert.match(content, /本周新闻大事件/);
    assert.match(content, /proof/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
