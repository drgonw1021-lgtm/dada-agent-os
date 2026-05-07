import test from "node:test";
import assert from "node:assert/strict";
import { buildCapabilityRoutePlan } from "../capabilities/capability-router.js";
import { resolveTaskIntent } from "../tasks/task-intent.js";
import type { LoadedSkill } from "../skills/skill-loader.js";

const skills: LoadedSkill[] = [
  {
    metadata: {
      name: "code_developer",
      description: "Write, test, debug, and improve code",
      triggers: ["code", "debug", "test"]
    },
    instructions: "Use code tools",
    toolDefinitions: []
  },
  {
    metadata: {
      name: "web_search",
      description: "Search the web for research",
      triggers: ["search", "research"]
    },
    instructions: "Use web tools",
    toolDefinitions: []
  },
  {
    metadata: {
      name: "social_publisher",
      description: "Prepare social publishing packages for shortform platforms",
      triggers: ["publish", "douyin", "shortform", "script"]
    },
    instructions: "Use social publishing tools",
    toolDefinitions: []
  }
];

test("capability router matches skills and tools for code tasks", () => {
  const intent = resolveTaskIntent({
    goal: "fix the build and run tests",
    taskType: "auto",
    outputFormat: "auto",
    attachments: []
  });
  const plan = buildCapabilityRoutePlan({
    goal: "fix the build and run tests",
    intent,
    availableTools: ["fs.read_file", "shell.exec", "code.exec", "code.self_improve"],
    skills
  });

  assert.equal(plan.taskType, "code");
  assert.equal(plan.matchedSkills.some((skill) => skill.name === "code_developer"), true);
  assert.equal(plan.matchedTools.includes("shell.exec"), true);
});

test("capability router proposes self extension when skill is missing", () => {
  const intent = resolveTaskIntent({
    goal: "analyze uploaded video and audio",
    taskType: "auto",
    outputFormat: "auto",
    attachments: [
      {
        id: "a1",
        name: "demo.mp4",
        mimeType: "video/mp4",
        kind: "video",
        path: "C:/tmp/demo.mp4",
        size: 1
      }
    ]
  });
  const plan = buildCapabilityRoutePlan({
    goal: "analyze uploaded video and audio",
    intent,
    availableTools: ["vision", "ocr", "media"],
    skills
  });

  assert.equal(plan.taskType, "media_analysis");
  assert.equal(plan.missingCapabilities.some((item) => item.includes("no directly matched skill")), true);
  assert.equal(plan.fallbackActions.some((item) => item.includes("skill.create")), true);
});

test("capability router matches generative media tool for image tasks", () => {
  const intent = resolveTaskIntent({
    goal: "generate an app icon image",
    taskType: "auto",
    outputFormat: "auto",
    attachments: []
  });
  const plan = buildCapabilityRoutePlan({
    goal: "generate an app icon image",
    intent,
    availableTools: ["gen.media", "vision", "media"],
    skills
  });

  assert.equal(intent.taskType, "image_generation");
  assert.equal(plan.matchedTools.includes("gen.media"), true);
});

test("capability router exposes social publishing blockers", () => {
  const intent = resolveTaskIntent({
    goal: "打开网页 搜索最近一周的新闻大事件 整理成一个口播稿 并发布在我的抖音号",
    taskType: "auto",
    outputFormat: "auto",
    attachments: []
  });
  const plan = buildCapabilityRoutePlan({
    goal: "打开网页 搜索最近一周的新闻大事件 整理成一个口播稿 并发布在我的抖音号",
    intent,
    availableTools: ["search", "web.fetch", "browser", "publish.package"],
    skills
  });

  assert.equal(plan.taskType, "social_publish");
  assert.equal(plan.matchedTools.includes("publish.package"), true);
  assert.equal(plan.matchedSkills.some((skill) => skill.name === "social_publisher"), true);
  assert.equal(
    plan.missingCapabilities.some((item) => item.includes("direct platform posting requires")),
    true
  );
});
