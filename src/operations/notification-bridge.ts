import type { BotManager } from "../bots/bot-manager.js";
import type { BotPlatform, BotResponse } from "../bots/bot-interface.js";

/** Notification channels: system desktop, webhook-based, and bot platforms */
export type NotificationChannel = "system" | "slack" | "email" | BotPlatform;

/** Subset of channels that map to BotPlatform */
const BOT_CHANNELS: Set<string> = new Set(["telegram", "discord", "lark", "dingtalk", "wechat"]);

function toBotPlatform(channel: NotificationChannel): BotPlatform | null {
  return BOT_CHANNELS.has(channel) ? (channel as BotPlatform) : null;
}

export interface Notification {
  title: string;
  body: string;
  level: "info" | "warning" | "critical";
  requiresResponse?: boolean;
  actions?: NotificationAction[];
  metadata?: Record<string, string>;
}

export interface NotificationAction {
  label: string;
  action: string;
  url?: string;
}

export interface NotificationResult {
  success: boolean;
  channel: NotificationChannel;
  messageId?: string;
  error?: string;
}

/**
 * NotificationBridge provides a unified interface for sending notifications
 * to users across multiple channels. It wires into the existing bot adapters
 * and system notification tools.
 */
export class NotificationBridge {
  private defaultChannels: NotificationChannel[] = ["system"];
  private botManager: BotManager | null = null;

  constructor(private options: {
    defaultChannels?: NotificationChannel[];
    botManager?: BotManager;
    /** Called for system desktop notifications */
    systemNotify?: (title: string, body: string) => Promise<void>;
    /** Called for webhook-based notifications (Slack, email, etc.) */
    webhookNotify?: (channel: string, title: string, body: string) => Promise<void>;
  }) {
    this.defaultChannels = options.defaultChannels || ["system"];
    this.botManager = options.botManager || null;
  }

  async send(notification: Notification): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];
    for (const channel of this.defaultChannels) {
      results.push(await this.sendToChannel(channel, notification));
    }
    return results;
  }

  async sendToChannel(
    channel: NotificationChannel,
    notification: Notification
  ): Promise<NotificationResult> {
    try {
      const botPlatform = toBotPlatform(channel);

      if (botPlatform) {
        return await this.sendViaBot(botPlatform, notification);
      }

      switch (channel) {
        case "system":
          await this.sendSystem(notification);
          return { success: true, channel };

        case "slack":
        case "email":
          if (this.options.webhookNotify) {
            await this.options.webhookNotify(channel, notification.title, notification.body);
          }
          return { success: true, channel };

        default:
          return { success: false, channel, error: `Unknown channel: ${channel}` };
      }
    } catch (err) {
      return { success: false, channel, error: String(err) };
    }
  }

  private async sendSystem(notification: Notification): Promise<void> {
    if (this.options.systemNotify) {
      await this.options.systemNotify(notification.title, notification.body);
    }
  }

  private async sendViaBot(
    platform: BotPlatform,
    notification: Notification
  ): Promise<NotificationResult> {
    if (!this.botManager) {
      return { success: false, channel: platform, error: "BotManager not configured" };
    }

    const bot = this.botManager.getBot(platform);
    if (!bot || bot.status !== "connected") {
      return { success: false, channel: platform, error: `${platform} bot not connected` };
    }

    const text = this.formatForChat(notification);
    const response: BotResponse = { text, markdown: true };

    // For notifications, send to a default channel/DM.
    // Bot adapters accept any chatId string — here we use config-driven or default.
    const info = this.botManager.getStatus().find(s => s.platform === platform);
    const chatId = (info as any)?.defaultChatId || "default";

    await this.botManager.sendMessage(platform, chatId, response);
    return { success: true, channel: platform };
  }

  private formatForChat(notification: Notification): string {
    const levelEmoji: Record<string, string> = { info: "ℹ️", warning: "⚠️", critical: "🚨" };
    let text = `${levelEmoji[notification.level]} *${notification.title}*\n${notification.body}`;

    if (notification.actions && notification.actions.length > 0) {
      text += "\n\nActions:";
      for (const action of notification.actions) {
        text += `\n  • ${action.label}${action.url ? ` — ${action.url}` : ""}`;
      }
    }

    return text;
  }

  async escalate(event: {
    taskId: string;
    reason: string;
    level: "info" | "warning" | "critical";
    suggestedActions?: NotificationAction[];
  }): Promise<void> {
    const notification: Notification = {
      title: "DaDa needs your input",
      body: event.reason,
      level: event.level,
      requiresResponse: event.level === "critical",
      actions: event.suggestedActions || [
        { label: "View Task", action: "view" },
      ],
      metadata: { taskId: event.taskId },
    };

    const results = await Promise.all(
      ["system", "slack", "telegram", "discord", "email"].map(ch =>
        this.sendToChannel(ch as NotificationChannel, notification)
      )
    );

    const succeeded = results.filter(r => r.success).length;
    if (succeeded === 0) {
      console.warn("[NotificationBridge] Failed to send escalation to any channel:", event.reason);
    }
  }

  async sendDailyReport(report: {
    completedTasks: number;
    failedTasks: number;
    activeObjectives: number;
    highlights: string[];
  }): Promise<void> {
    const body = [
      `✓ ${report.completedTasks} tasks completed`,
      report.failedTasks > 0 ? `✗ ${report.failedTasks} tasks failed` : null,
      `▶ ${report.activeObjectives} objectives active`,
      "",
      report.highlights.length > 0 ? "Highlights:" : null,
      ...report.highlights.map(h => `  • ${h}`),
    ].filter(Boolean).join("\n");

    await this.send({
      title: "DaDa Daily Report",
      body,
      level: "info",
    });
  }
}
