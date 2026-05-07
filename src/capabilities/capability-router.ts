import type { LoadedSkill } from "../skills/skill-loader.js";
import type { TaskIntent } from "../tasks/task-intent.js";

export interface CapabilityRoutePlan {
  taskType: string;
  deliveryKind: string;
  matchedTools: string[];
  missingTools: string[];
  matchedSkills: Array<{
    name: string;
    description: string;
  }>;
  missingCapabilities: string[];
  fallbackActions: string[];
  routingPrompt: string;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[_\-.]+/g, " ").trim();
}

function toolAvailable(toolId: string, availableTools: string[]): boolean {
  const wanted = normalize(toolId);
  return availableTools.some((id) => {
    const current = normalize(id);
    return current === wanted || current.includes(wanted) || wanted.includes(current);
  });
}

function skillMatches(skill: LoadedSkill, keywords: string[]): boolean {
  const haystack = [
    skill.metadata.name,
    skill.metadata.description,
    ...(skill.metadata.triggers ?? [])
  ]
    .map(normalize)
    .join(" ");

  return keywords.some((keyword) => haystack.includes(normalize(keyword)));
}

function requiredSkillKeywords(intent: TaskIntent): string[] {
  switch (intent.taskType) {
    case "image_generation":
      return ["image", "generation", "comfyui", "creative", "design"];
    case "video_generation":
      return ["video", "generation", "animate", "creative", "comfyui"];
    case "voice_generation":
      return ["voice", "speech", "tts", "audio", "narration"];
    case "social_publish":
      return ["publish", "social", "douyin", "tiktok", "short video", "news", "script"];
    case "code":
      return ["code", "developer", "debug", "test", "refactor"];
    case "product_research":
    case "research":
      return ["research", "web", "search", "market", "competitor"];
    case "presentation":
      return ["presentation", "slides", "deck", "report"];
    case "data_analysis":
      return ["data", "excel", "csv", "analysis"];
    case "media_analysis":
      return ["media", "vision", "ocr", "audio", "video"];
    case "automation":
      return ["automation", "workflow", "schedule"];
    default:
      return [intent.taskType];
  }
}

function missingCapabilityText(intent: TaskIntent, missingTools: string[], matchedSkills: LoadedSkill[]): string[] {
  const missing: string[] = [];
  if (missingTools.length > 0) {
    missing.push(`missing tools: ${missingTools.join(", ")} — try mcp.search to find alternatives`);
  }
  if (matchedSkills.length === 0) {
    missing.push(`no directly matched skill for ${intent.taskType} — check ClawHub or mcp.search`);
  }
  if (intent.delivery.kind === "slide_deck") {
    missing.push("PPT/slides output expected — use mcp.search 'pptx generation' to find a PPTX MCP server, or fall back to structured Markdown");
  }
  if (intent.delivery.kind === "research_report" && intent.delivery.primaryArtifact === "pdf") {
    missing.push("PDF output expected — use mcp.search 'pdf generation' to find a PDF MCP server, or output Markdown as the primary deliverable");
  }
  if (
    (intent.taskType === "image_generation" || intent.taskType === "video_generation") &&
    missingTools.includes("gen.media")
  ) {
    missing.push("generative media engine is unavailable; configure ComfyUI or OpenAI media access, or use mcp.search to find alternative image/video generation MCPs");
  }
  if (intent.taskType === "social_publish") {
    if (missingTools.includes("publish.package")) {
      missing.push("social publishing package tool is unavailable; cannot prepare a platform-ready package");
    }
    missing.push("direct platform posting requires a logged-in browser session, platform API/bridge, and explicit approval");
  }
  return missing;
}

export function buildCapabilityRoutePlan(params: {
  goal: string;
  intent: TaskIntent;
  availableTools: string[];
  skills: LoadedSkill[];
}): CapabilityRoutePlan {
  const preferredTools = params.intent.preferredTools;
  const matchedTools = preferredTools.filter((tool) => toolAvailable(tool, params.availableTools));
  const missingTools = preferredTools.filter((tool) => !toolAvailable(tool, params.availableTools));
  const skillKeywords = requiredSkillKeywords(params.intent);
  const matchedSkills = params.skills.filter((skill) => skillMatches(skill, skillKeywords));
  const missingCapabilities = missingCapabilityText(params.intent, missingTools, matchedSkills);
  const mcpSuggestions: string[] = [];
  if (missingTools.length > 0) {
    mcpSuggestions.push(`Missing tools detected: ${missingTools.join(", ")}. Use mcp.search to find MCP servers that provide these capabilities, then mcp.install to load them.`);
  }
  if (!toolAvailable("gen.chart", params.availableTools) && (params.intent.taskType === "research" || params.intent.taskType === "product_research")) {
    mcpSuggestions.push("Charts would improve this report. Search mcp for chart generation if gen.chart is unavailable.");
  }
  if (!toolAvailable("mcp:pdf", params.availableTools) && params.intent.delivery.artifactBundle.includes("pdf")) {
    mcpSuggestions.push("PDF output is expected. Use mcp.search 'pdf generation' to find a PDF MCP server.");
  }

  const fallbackActions = [
    "First use matched skills and available tools.",
    "If a tool is missing, use mcp.search to find an MCP server → mcp.install to install it.",
    "If mcp.search finds nothing, use clawhub:search to find a Skill → clawhub:install to install it.",
    "If neither MCP nor Skill exists, use code.self_improve or code.generator to write the tool yourself.",
    "If evidence or documentation is missing, use search/web.fetch/api.request to retrieve it.",
    "If search quality is poor, install a real search API via mcp.search → mcp.install, or ask the user for an API key.",
    "If a reusable workflow is missing, call skill.create to write a new skill draft under .agent/skills.",
    "For social publishing tasks, produce a ready-to-post package first and only perform irreversible posting after login/session checks and approval.",
    "If a high-risk action is required, request approval instead of silently skipping it.",
    ...mcpSuggestions
  ];

  const routingPrompt = [
    "## Capability Routing Plan",
    `Task type: ${params.intent.taskType}`,
    `Delivery kind: ${params.intent.delivery.kind}`,
    `Expected result: ${params.intent.delivery.resultLabel}`,
    `Matched tools: ${matchedTools.join(", ") || "none"}`,
    `Missing tools: ${missingTools.join(", ") || "none"}`,
    `Matched skills: ${matchedSkills.map((skill) => skill.metadata.name).join(", ") || "none"}`,
    `Missing capabilities: ${missingCapabilities.join("; ") || "none"}`,
    "",
    "Fallback policy:",
    ...fallbackActions.map((item) => `- ${item}`)
  ].join("\n");

  return {
    taskType: params.intent.taskType,
    deliveryKind: params.intent.delivery.kind,
    matchedTools,
    missingTools,
    matchedSkills: matchedSkills.map((skill) => ({
      name: skill.metadata.name,
      description: skill.metadata.description
    })),
    missingCapabilities,
    fallbackActions,
    routingPrompt
  };
}
