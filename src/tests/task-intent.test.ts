import test from "node:test";
import assert from "node:assert/strict";
import { resolveArtifactFormats, resolveTaskIntent } from "../tasks/task-intent.js";

test("task intent routes presentation goals to slide output", () => {
  const intent = resolveTaskIntent({
    goal: "请把这份产品调研整理成 PPT 汇报",
    taskType: "auto",
    outputFormat: "auto",
    attachments: []
  });

  assert.equal(intent.taskType, "presentation");
  assert.equal(intent.outputFormat, "slides");
  assert.equal(intent.delivery.kind, "slide_deck");
  assert.equal(intent.delivery.primaryArtifact, "slides");
});

test("task intent routes media attachments to multimodal analysis", () => {
  const intent = resolveTaskIntent({
    goal: "分析我上传的视频内容并提取重点",
    taskType: "auto",
    outputFormat: "auto",
    attachments: [
      {
        id: "a1",
        name: "demo.mp4",
        mimeType: "video/mp4",
        kind: "video",
        path: "C:/tmp/demo.mp4",
        size: 128
      }
    ]
  });

  assert.equal(intent.taskType, "media_analysis");
  assert.equal(intent.preferredTools.includes("vision"), true);
  assert.equal(intent.delivery.kind, "media_brief");
});

test("artifact format resolver bundles product research outputs", () => {
  const formats = resolveArtifactFormats({
    goal: "做一个 AI 产品市场调研并输出报告",
    taskType: "product_research",
    outputFormat: "auto"
  });

  assert.deepEqual(formats, ["markdown", "pdf", "slides"]);
});

test("task intent infers decision brief for product research mission", () => {
  const intent = resolveTaskIntent({
    goal: "分析 AI Agent 市场机会并给管理层一个可决策的结论",
    taskType: "auto",
    outputFormat: "auto",
    attachments: []
  });

  assert.equal(intent.taskType, "product_research");
  assert.equal(intent.delivery.kind, "decision_brief");
  assert.equal(intent.delivery.resultLabel, "decision-ready product brief");
});

test("task intent routes image generation goals to image assets", () => {
  const intent = resolveTaskIntent({
    goal: "generate a product poster image for the landing page",
    taskType: "auto",
    outputFormat: "auto",
    attachments: []
  });

  assert.equal(intent.taskType, "image_generation");
  assert.equal(intent.outputFormat, "image");
  assert.equal(intent.delivery.kind, "image_asset");
});

test("task intent routes news-to-douyin tasks to social publishing packages", () => {
  const intent = resolveTaskIntent({
    goal: "打开网页 搜索最近一周的新闻大事件 整理成一个口播稿 并发布在我的抖音号",
    taskType: "auto",
    outputFormat: "auto",
    attachments: []
  });

  assert.equal(intent.taskType, "social_publish");
  assert.equal(intent.outputFormat, "publish_package");
  assert.equal(intent.delivery.kind, "social_publication");
  assert.equal(intent.preferredTools.includes("publish.package"), true);
});

// ── Regression: simple search should NOT become research ──────────────

test("simple search without report intent routes to general (fast path)", () => {
  const intent = resolveTaskIntent({
    goal: "搜索今天AI领域的重要新闻，列出5条最重要的新闻标题和概要",
    taskType: "auto",
    outputFormat: "auto",
    attachments: []
  });

  assert.equal(intent.taskType, "general");
  assert.equal(intent.complexity, "simple");
});

test("search with file-write intent routes to research", () => {
  const intent = resolveTaskIntent({
    goal: "搜索最近一周AI领域的5条重要新闻，保存到文件 D:/report.md",
    taskType: "auto",
    outputFormat: "auto",
    attachments: []
  });

  assert.equal(intent.taskType, "research");
});

test("pure lookup query routes to general with simple complexity", () => {
  const intent = resolveTaskIntent({
    goal: "查询最新的TypeScript版本号",
    taskType: "auto",
    outputFormat: "auto",
    attachments: []
  });

  assert.equal(intent.taskType, "general");
  assert.equal(intent.complexity, "simple");
});

// ── Regression: content planning with 封面 should NOT become image_generation ──

test("content planning with cover text suggestion is NOT image_generation", () => {
  const intent = resolveTaskIntent({
    goal: "策划3条短视频选题，含标题、封面文字建议、目标受众",
    taskType: "auto",
    outputFormat: "auto",
    attachments: []
  });

  assert.notEqual(intent.taskType, "image_generation");
});

test("explicit image generation with 生成封面 still routes to image_generation", () => {
  const intent = resolveTaskIntent({
    goal: "生成一个产品封面图用于抖音发布",
    taskType: "auto",
    outputFormat: "auto",
    attachments: []
  });

  assert.equal(intent.taskType, "image_generation");
});

// ── Weather is always simple ──────────────────────────────────────────

test("weather query routes to weather with simple complexity", () => {
  const intent = resolveTaskIntent({
    goal: "今天北京的天气怎么样",
    taskType: "auto",
    outputFormat: "auto",
    attachments: []
  });

  assert.equal(intent.taskType, "weather");
  assert.equal(intent.complexity, "simple");
});
