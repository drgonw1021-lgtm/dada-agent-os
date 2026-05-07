import type { BotAdapter, BotConfig, BotMessage, BotPlatform, BotResponse, BotStatus } from "./bot-interface.js";

export interface BotManagerConfig {
  bots: BotConfig[];
  /** Called when any bot receives a message */
  onMessage: (msg: BotMessage) => Promise<BotResponse>;
}

export interface BotInfo {
  platform: BotPlatform;
  status: BotStatus;
  enabled: boolean;
  startedAt?: string;
}

export class BotManager {
  private bots: Map<BotPlatform, BotAdapter> = new Map();
  private config: BotManagerConfig;

  constructor(config: BotManagerConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    for (const botConfig of this.config.bots) {
      if (!botConfig.enabled) {
        console.log(`[BotManager] ${botConfig.platform}: disabled`);
        continue;
      }

      const adapter = await this.createAdapter(botConfig);
      if (adapter) {
        adapter.onMessage(async (msg) => {
          try {
            const response = await this.config.onMessage(msg);
            if (response) {
              await adapter.sendMessage(msg.chatId, response);
            }
          } catch (e: any) {
            console.error(`[BotManager] Error handling message from ${botConfig.platform}:`, e.message);
          }
        });

        try {
          await adapter.start();
          this.bots.set(botConfig.platform, adapter);
          console.log(`[BotManager] ${botConfig.platform}: started`);
        } catch (e: any) {
          console.error(`[BotManager] ${botConfig.platform}: failed to start — ${e.message}`);
        }
      }
    }

    console.log(`[BotManager] Initialized ${this.bots.size} bot(s): ${Array.from(this.bots.keys()).join(", ") || "none"}`);
  }

  async shutdown(): Promise<void> {
    for (const [platform, adapter] of this.bots) {
      try {
        await adapter.stop();
        console.log(`[BotManager] ${platform}: stopped`);
      } catch (e: any) {
        console.error(`[BotManager] ${platform}: error stopping — ${e.message}`);
      }
    }
    this.bots.clear();
  }

  /** Send a message to a specific platform's chat */
  async sendMessage(platform: BotPlatform, chatId: string, response: BotResponse): Promise<string | null> {
    const bot = this.bots.get(platform);
    if (!bot) return null;
    return bot.sendMessage(chatId, response);
  }

  /** Get status of all bots */
  getStatus(): BotInfo[] {
    return this.config.bots.map(config => {
      const bot = this.bots.get(config.platform);
      return {
        platform: config.platform,
        status: bot?.status || "disconnected",
        enabled: config.enabled,
        startedAt: (bot?.getInfo() as any)?.startedAt
      };
    });
  }

  /** Get a specific bot adapter */
  getBot(platform: BotPlatform): BotAdapter | undefined {
    return this.bots.get(platform);
  }

  private async createAdapter(config: BotConfig): Promise<BotAdapter | null> {
    switch (config.platform) {
      case "telegram":
        try {
          const { TelegramBot } = await import("./telegram-bot.js");
          return new TelegramBot(config);
        } catch (e: any) {
          console.error(`[BotManager] Telegram adapter import failed: ${e.message}`);
          return null;
        }
      case "discord":
        try {
          const { DiscordBot } = await import("./discord-bot.js");
          return new DiscordBot(config);
        } catch (e: any) {
          console.error(`[BotManager] Discord adapter import failed: ${e.message}`);
          return null;
        }
      case "lark":
        try {
          const { LarkBot } = await import("./lark-bot.js");
          return new LarkBot(config);
        } catch (e: any) {
          console.error(`[BotManager] Lark adapter import failed: ${e.message}`);
          return null;
        }
      case "dingtalk":
        try {
          const { DingTalkBot } = await import("./dingtalk-bot.js");
          return new DingTalkBot(config);
        } catch (e: any) {
          console.error(`[BotManager] DingTalk adapter import failed: ${e.message}`);
          return null;
        }
      case "wechat":
        try {
          const { WeChatBot } = await import("./wechat-bot.js");
          return new WeChatBot(config);
        } catch (e: any) {
          console.error(`[BotManager] WeChat adapter import failed: ${e.message}`);
          return null;
        }
      default:
        console.warn(`[BotManager] Unknown platform: ${(config as any).platform}`);
        return null;
    }
  }
}
