import { BotAdapter, type BotConfig, type BotMessage, type BotResponse, type BotStatus } from "./bot-interface.js";

// ─── Telegram Bot Adapter ──────────────────────────────────────────────────────

const API_BASE = "https://api.telegram.org";

export class TelegramBot implements BotAdapter {
  readonly platform = "telegram" as const;
  private _status: BotStatus = "disconnected";
  private token: string;
  private enabled: boolean;
  private messageHandler?: (msg: BotMessage) => Promise<BotResponse | void>;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastUpdateId = 0;
  private startedAt?: string;

  constructor(config: BotConfig) {
    this.token = config.token || "";
    this.enabled = config.enabled !== false;
  }

  get status(): BotStatus { return this._status; }

  async start(): Promise<void> {
    if (!this.token) {
      this._status = "error";
      throw new Error("Telegram bot token is required");
    }

    this._status = "connecting";

    // Verify bot token with a getMe call
    try {
      const me = await this.apiCall("getMe");
      console.log(`[TelegramBot] Connected as @${(me as any).result?.username || "unknown"}`);
      this._status = "connected";
      this.startedAt = new Date().toISOString();
    } catch (e: any) {
      this._status = "error";
      throw new Error(`Telegram bot auth failed: ${e.message}`);
    }

    // Start long-polling for updates
    this.startPolling();
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this._status = "disconnected";
    console.log("[TelegramBot] Stopped");
  }

  async sendMessage(chatId: string, response: BotResponse): Promise<string> {
    const result = await this.apiCall("sendMessage", {
      chat_id: chatId,
      text: response.text.substring(0, 4096),
      parse_mode: response.markdown !== false ? "Markdown" : undefined
    }) as any;

    return result?.result?.message_id?.toString() || "";
  }

  onMessage(handler: (msg: BotMessage) => Promise<BotResponse | void>): void {
    this.messageHandler = handler;
  }

  getInfo() {
    return {
      platform: this.platform,
      status: this._status,
      startedAt: this.startedAt
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.apiCall("getMe");
      return true;
    } catch {
      return false;
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private async apiCall(method: string, body?: Record<string, unknown>): Promise<unknown> {
    const url = `${API_BASE}/bot${this.token}/${method}`;

    const fetchOptions: RequestInit = { method: "GET" };
    if (body) {
      fetchOptions.method = "POST";
      fetchOptions.headers = { "Content-Type": "application/json" };
      fetchOptions.body = JSON.stringify(body);
    }

    const res = await fetch(url, fetchOptions);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Telegram API ${method} failed (${res.status}): ${text.substring(0, 200)}`);
    }
    return res.json();
  }

  private startPolling(): void {
    const poll = async () => {
      try {
        const result = await this.apiCall("getUpdates", {
          offset: this.lastUpdateId + 1,
          timeout: 30,
          allowed_updates: ["message"]
        }) as any;

        const updates = result?.result || [];
        for (const update of updates) {
          this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);

          const msg = update.message || update.channel_post;
          if (!msg || !msg.text) continue;

          const botMsg: BotMessage = {
            messageId: msg.message_id.toString(),
            chatId: msg.chat.id.toString(),
            userId: msg.from?.id?.toString() || "unknown",
            userName: msg.from?.first_name || msg.from?.username || "Unknown",
            text: msg.text,
            platform: "telegram",
            isGroup: msg.chat.type === "group" || msg.chat.type === "supergroup",
            timestamp: new Date(msg.date * 1000).toISOString(),
            raw: update
          };

          if (this.messageHandler) {
            try {
              await this.messageHandler(botMsg);
            } catch (e: any) {
              console.error(`[TelegramBot] Message handler error: ${e.message}`);
            }
          }
        }
      } catch (e: any) {
        if (this._status === "connected") {
          console.error(`[TelegramBot] Poll error: ${e.message}`);
        }
      }

      // Schedule next poll (1 second delay, long-polling handles most of the wait)
      this.pollTimer = setTimeout(poll, 1000);
    };

    poll();
  }
}
