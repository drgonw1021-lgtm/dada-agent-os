import { BotAdapter, type BotConfig, type BotMessage, type BotResponse, type BotStatus } from "./bot-interface.js";

// ─── DingTalk (钉钉) Bot Adapter ──────────────────────────────────────────────
// Uses DingTalk robot webhook: https://open.dingtalk.com/
// Two modes: incoming webhook (simple) + outgoing webhook (receive messages)

export class DingTalkBot implements BotAdapter {
  readonly platform = "dingtalk" as const;
  private _status: BotStatus = "disconnected";
  private webhookUrl: string;
  private appSecret: string;
  private enabled: boolean;
  private messageHandler?: (msg: BotMessage) => Promise<BotResponse | void>;
  private startedAt?: string;

  constructor(config: BotConfig) {
    this.webhookUrl = config.webhookPath || "";
    this.appSecret = config.appSecret || "";
    this.enabled = config.enabled !== false;
  }

  get status(): BotStatus { return this._status; }

  async start(): Promise<void> {
    if (!this.webhookUrl) {
      // DingTalk can work with just the outgoing webhook URL
      // The webhook path receives POST from DingTalk server
    }
    this._status = "connected";
    this.startedAt = new Date().toISOString();
    console.log("[DingTalkBot] Ready (webhook-based)");
  }

  async stop(): Promise<void> {
    this._status = "disconnected";
  }

  async sendMessage(chatId: string, response: BotResponse): Promise<string> {
    // DingTalk sends via incoming webhook URL
    if (!this.webhookUrl) {
      throw new Error("DingTalk incoming webhook URL not configured (set webhookPath in config)");
    }

    const body: any = {
      msgtype: "markdown",
      markdown: {
        title: "DaDa",
        text: response.text.substring(0, 20000)
      },
      at: {
        atUserIds: [],
        isAtAll: false
      }
    };

    const res = await fetch(this.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await res.json() as any;
    if (data.errcode !== 0) {
      throw new Error(`DingTalk send failed: ${data.errmsg}`);
    }

    return String(Date.now());
  }

  /** Handle outgoing webhook callback from DingTalk */
  async handleOutgoingWebhook(body: any): Promise<BotMessage | null> {
    const msg: BotMessage = {
      messageId: body.msgId || String(Date.now()),
      chatId: body.sessionWebhook || body.conversationId || "unknown",
      userId: body.senderStaffId || body.senderId || "unknown",
      userName: body.senderNick || "User",
      text: body.text?.content || body.text || "",
      platform: "dingtalk",
      isGroup: body.conversationType === "2", // 1=single, 2=group
      timestamp: new Date(Number(body.createAt) || Date.now()).toISOString(),
      raw: body
    };

    return msg;
  }

  onMessage(handler: (msg: BotMessage) => Promise<BotResponse | void>): void {
    this.messageHandler = handler;
  }

  /** Process webhook and trigger message handler */
  async processWebhook(body: any): Promise<{ status: number; data: unknown }> {
    const msg = await this.handleOutgoingWebhook(body);
    if (msg && this.messageHandler) {
      try {
        const response = await this.messageHandler(msg);
        if (response) {
          await this.sendMessage(msg.chatId, response);
        }
      } catch {}
    }
    return { status: 200, data: { msgtype: "empty" } };
  }

  getInfo() {
    return {
      platform: this.platform,
      status: this._status,
      startedAt: this.startedAt
    };
  }

  async healthCheck(): Promise<boolean> {
    return this._status === "connected";
  }
}
