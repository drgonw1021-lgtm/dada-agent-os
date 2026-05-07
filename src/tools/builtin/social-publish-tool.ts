import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { PermissionScope, ToolContext, ToolDefinition } from "../../core/types.js";
import type { SocialPublishBridge, PublishPlatform } from "../../bots/social-publish-bridge.js";

export interface PublishPackageInput {
  platform: "douyin" | "tiktok" | "kuaishou" | "xiaohongshu" | "wechat_channels" | "other";
  account?: string;
  title?: string;
  spokenScript?: string;
  caption?: string;
  hashtags?: string[];
  sourceUrls?: string[];
  mediaFiles?: string[];
  publishRequested?: boolean;
  approvalNote?: string;
}

export interface PublishPackageOutput {
  success: boolean;
  status: "draft_ready" | "blocked" | "published" | "failed";
  platform: PublishPackageInput["platform"];
  file?: string;
  draftId?: string;
  url?: string;
  nextStep: string;
  blockers: string[];
  automationScript?: string;
}

function safeName(value: string): string {
  return value
    .replace(/[^\w一-龥\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "package";
}

function mapPlatform(input: PublishPackageInput["platform"]): PublishPlatform | null {
  const map: Record<string, PublishPlatform> = {
    douyin: "douyin",
    tiktok: "douyin",
    xiaohongshu: "xiaohongshu",
    kuaishou: "kuaishou",
    wechat_channels: "wechat_channels",
  };
  return map[input] || null;
}

function buildPackageMarkdown(input: PublishPackageInput, blockers: string[], extra: Record<string, string> = {}): string {
  const lines = [
    `# ${input.title || "Publishing Package"}`,
    "",
    `- Platform: ${input.platform}`,
    input.account ? `- Account: ${input.account}` : "- Account: not configured",
    `- Publish requested: ${input.publishRequested ? "yes" : "no"}`,
  ];
  for (const [k, v] of Object.entries(extra)) {
    lines.push(`- ${k}: ${v}`);
  }
  lines.push(
    "",
    "## Spoken Script",
    "",
    input.spokenScript || "No spoken script provided yet.",
    "",
    "## Caption",
    "",
    input.caption || "",
    "",
    "## Hashtags",
    "",
    (input.hashtags ?? []).map((tag) => `- ${tag.startsWith("#") ? tag : `#${tag}`}`).join("\n") || "- none",
    "",
    "## Sources",
    "",
    (input.sourceUrls ?? []).map((source) => `- ${source}`).join("\n") || "- none",
    "",
    "## Media Files",
    "",
    (input.mediaFiles ?? []).map((file) => `- ${file}`).join("\n") || "- none",
    "",
    "## Publishing Blockers",
    "",
    blockers.map((blocker) => `- ${blocker}`).join("\n")
  );
  return lines.join("\n");
}

export function createPublishPackageTool(
  outputDir = "./.agent/publish-packages",
  getBridge?: () => SocialPublishBridge | undefined
): ToolDefinition<PublishPackageInput, PublishPackageOutput> {
  return {
    id: "publish.package",
    description: "Create a platform-ready publishing package with bridge support for Douyin (抖音), Xiaohongshu (小红书), Kuaishou (快手), WeChat Channels (视频号), and Bilibili (B站). Generates browser automation scripts for actual posting.",
    requiredScopes: ["filesystem.write"] as PermissionScope[],
    riskLevel: "medium",
    inputSchema: {
      type: "object" as const,
      properties: {
        platform: { type: "string" as const, enum: ["douyin", "tiktok", "kuaishou", "xiaohongshu", "wechat_channels", "other"], description: "Target platform" },
        account: { type: "string" as const, description: "Platform account name" },
        title: { type: "string" as const, description: "Content title" },
        spokenScript: { type: "string" as const, description: "Video spoken script content" },
        caption: { type: "string" as const, description: "Post caption/text" },
        hashtags: { type: "array" as const, description: "Hashtags (with or without #)", items: { type: "string" as const } },
        sourceUrls: { type: "array" as const, description: "Source URLs referenced in content", items: { type: "string" as const } },
        mediaFiles: { type: "array" as const, description: "Paths to media files to publish", items: { type: "string" as const } },
        publishRequested: { type: "boolean" as const, description: "Whether user explicitly requested publishing (default: false)" },
        approvalNote: { type: "string" as const, description: "Approval note or confirmation" }
      },
      required: ["platform"]
    },
    async execute(input: PublishPackageInput, context: ToolContext): Promise<PublishPackageOutput> {
      const bridge = getBridge?.();
      const targetPlatform = mapPlatform(input.platform);
      const blockers: string[] = [];

      // Check bridge availability
      if (!bridge && input.publishRequested) {
        blockers.push("Publishing bridge is not configured. Start DaDa with social publishing enabled.");
      }

      // Check media for publish requests
      if (input.publishRequested && (!input.mediaFiles || input.mediaFiles.length === 0)) {
        blockers.push("No media files attached. Video/image content is required for publishing.");
      }

      // Check session for real platforms
      if (bridge && input.publishRequested && targetPlatform) {
        if (!bridge.hasValidSession(targetPlatform)) {
          blockers.push(
            `No active login session for ${targetPlatform}. ` +
            `Open the creator platform in browser, scan QR code to login, then use the session save API to store cookies.`
          );
        }
      }

      if (!input.publishRequested) {
        blockers.push("Publish not explicitly requested — draft only mode.");
      }

      // Always mark these as safety blockers
      const safetyBlockers = [
        "DaDa must not claim content was published until a platform tool returns a post URL or success proof.",
      ];

      const allBlockers = [...blockers, ...safetyBlockers];

      // Build the package data
      const packageData = {
        id: randomUUID(),
        taskId: context.taskId,
        goal: context.goal,
        platform: input.platform,
        account: input.account,
        title: input.title,
        spokenScript: input.spokenScript,
        caption: input.caption,
        hashtags: input.hashtags ?? [],
        sourceUrls: input.sourceUrls ?? [],
        mediaFiles: input.mediaFiles ?? [],
        publishRequested: input.publishRequested === true,
        approvalNote: input.approvalNote,
        blockers: allBlockers,
        createdAt: new Date().toISOString()
      };

      const baseName = safeName(input.title || context.goal || context.taskId);
      const filePath = resolve(outputDir, `${baseName}-${context.taskId.slice(0, 8)}.package.json`);
      const markdownPath = resolve(outputDir, `${baseName}-${context.taskId.slice(0, 8)}.package.md`);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(packageData, null, 2), "utf8");

      // Attempt bridge publishing if requested and available
      let automationScript: string | undefined;
      let draftId: string | undefined;
      let publishStatus: PublishPackageOutput["status"] = input.publishRequested ? "blocked" : "draft_ready";

      if (bridge && targetPlatform && input.publishRequested && blockers.length === 0) {
        const draft = await bridge.createDraft({
          platform: targetPlatform,
          title: input.title || "Untitled",
          description: input.caption || input.spokenScript || "",
          hashtags: input.hashtags ?? [],
          mediaFiles: input.mediaFiles ?? [],
          metadata: { taskId: context.taskId, sourceUrls: input.sourceUrls },
        });
        draftId = draft.id;

        const result = await bridge.publish(draft.id, {
          dryRun: !input.publishRequested,
          headless: bridge["config"]?.headless ?? false,
        });
        publishStatus = result.status === "published" ? "published" : "failed";
        automationScript = result.automationScript;

        if (result.status === "published") {
          allBlockers.length = 0;
        } else if (result.error) {
          blockers.unshift(result.error);
        }
      } else if (bridge && targetPlatform && input.publishRequested) {
        // Create a draft even if blocked, so user can resume later
        try {
          const draft = await bridge.createDraft({
            platform: targetPlatform,
            title: input.title || "Untitled",
            description: input.caption || input.spokenScript || "",
            hashtags: input.hashtags ?? [],
            mediaFiles: input.mediaFiles ?? [],
            metadata: { taskId: context.taskId, sourceUrls: input.sourceUrls },
          });
          draftId = draft.id;
          automationScript = bridge.generateAutomationScript(draft);
        } catch { /* draft creation optional */ }
      }

      const extra: Record<string, string> = {};
      if (draftId) extra["Draft ID"] = draftId;
      if (automationScript) extra["Automation Script"] = "see below";

      await writeFile(markdownPath, buildPackageMarkdown(input, allBlockers, extra), "utf8");

      return {
        success: publishStatus !== "failed",
        status: publishStatus,
        platform: input.platform,
        file: filePath,
        draftId,
        nextStep: publishStatus === "published"
          ? "Content has been submitted via browser automation. Verify on the platform."
          : input.publishRequested
            ? "Publishing blocked. Review blockers, login to platform via browser, save session, and retry."
            : "Review the publishing package, attach media if needed, then approve a platform-specific posting step.",
        blockers: allBlockers,
        automationScript,
      };
    }
  };
}
