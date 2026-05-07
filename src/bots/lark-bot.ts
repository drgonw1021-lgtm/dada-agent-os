import { BotAdapter, type BotConfig, type BotMessage, type BotResponse, type BotStatus } from "./bot-interface.js";

// ─── Lark (飞书) Bot Adapter ──────────────────────────────────────────────────
// Uses Lark Open Platform: https://open.feishu.cn/
// Authentication: tenant_access_token via app_id + app_secret

const API_BASE = "https://open.feishu.cn/open-apis";

export class LarkBot implements BotAdapter {
  readonly platform = "lark" as const;
  private _status: BotStatus = "disconnected";
  private appId: string;
  private appSecret: string;
  private enabled: boolean;
  private messageHandler?: (msg: BotMessage) => Promise<BotResponse | void>;
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private startedAt?: string;

  // Store pending webhook callbacks keyed by chat_id for sendMessage
  private chatContexts: Map<string, { chatId: string; chatType: string }> = new Map();

  constructor(config: BotConfig) {
    this.appId = config.appId || "";
    this.appSecret = config.appSecret || "";
    this.enabled = config.enabled !== false;
  }

  get status(): BotStatus { return this._status; }

  async start(): Promise<void> {
    if (!this.appId || !this.appSecret) {
      this._status = "error";
      throw new Error("Lark appId and appSecret are required");
    }

    this._status = "connecting";

    try {
      await this.getAccessToken();
      this._status = "connected";
      this.startedAt = new Date().toISOString();
      console.log("[LarkBot] Connected to Lark Open Platform");
    } catch (e: any) {
      this._status = "error";
      throw new Error(`Lark auth failed: ${e.message}`);
    }
  }

  async stop(): Promise<void> {
    this._status = "disconnected";
    this.accessToken = null;
  }

  async sendMessage(chatId: string, response: BotResponse): Promise<string> {
    const ctx = this.chatContexts.get(chatId);
    if (!ctx) throw new Error(`No chat context for ${chatId}`);

    const content = this.buildMessageContent(response);
    const body: any = {
      receive_id: ctx.chatId,
      msg_type: "interactive",
      content: JSON.stringify(content)
    };

    const result = await this.apiCall("POST", `/im/v1/messages?receive_id_type=${ctx.chatType}`, body) as any;
    return result?.data?.message_id || "";
  }

  /** Handle an incoming webhook from Lark server */
  async handleWebhook(body: any): Promise<BotMessage | null> {
    // Lark sends different event types via webhook
    const event = body?.event;
    if (!event || !event.message) return null;

    const msg = event.message;
    const chatId = msg.chat_id || event.sender?.sender_id?.open_id || "";

    // Store chat context for sendMessage
    this.chatContexts.set(chatId, {
      chatId,
      chatType: msg.chat_type || "open_id"
    });

    const botMsg: BotMessage = {
      messageId: msg.message_id || String(Date.now()),
      chatId,
      userId: event.sender?.sender_id?.open_id || "unknown",
      userName: event.sender?.sender_id?.open_id?.substring(0, 8) || "User",
      text: this.extractText(msg),
      platform: "lark",
      isGroup: msg.chat_type === "group_chat",
      timestamp: new Date(Number(msg.create_time) || Date.now()).toISOString(),
      raw: body
    };

    return botMsg;
  }

  onMessage(handler: (msg: BotMessage) => Promise<BotResponse | void>): void {
    this.messageHandler = handler;
  }

  /** Process webhook and trigger message handler */
  async processWebhook(body: any): Promise<{ status: number; data: unknown }> {
    // Verify challenge
    if (body?.type === "url_verification") {
      return { status: 200, data: { challenge: body.challenge } };
    }

    const msg = await this.handleWebhook(body);
    if (msg && this.messageHandler) {
      try {
        const response = await this.messageHandler(msg);
        if (response) {
          await this.sendMessage(msg.chatId, response);
        }
      } catch {}
      return { status: 200, data: {} };
    }

    return { status: 200, data: {} };
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
      await this.getAccessToken();
      return true;
    } catch {
      return false;
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const url = `${API_BASE}/auth/v3/tenant_access_token/internal`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret
      })
    });

    if (!res.ok) {
      throw new Error(`Lark token request failed: ${res.status}`);
    }

    const data = await res.json() as any;
    this.accessToken = data.tenant_access_token;
    this.tokenExpiry = Date.now() + (data.expire - 300) * 1000; // 5min buffer
    return this.accessToken!;
  }

  private async apiCall(method: string, path: string, body?: unknown): Promise<unknown> {
    const token = await this.getAccessToken();
    const url = `${API_BASE}${path}`;

    const res = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Lark API ${path} failed (${res.status}): ${text.substring(0, 200)}`);
    }

    return res.json();
  }

  private extractText(msg: any): string {
    if (typeof msg.content === "string") {
      try {
        const content = JSON.parse(msg.content);
        return content.text || "";
      } catch {
        return msg.content;
      }
    }
    // Rich text
    if (msg.content?.text) return msg.content.text;
    // Fallback
    return msg.text || "";
  }

  private buildMessageContent(response: BotResponse): any {
    return {
      config: { wide_screen_mode: true },
      header: {
        title: { tag: "plain_text", content: "DaDa" },
        template: "blue" as const
      },
      elements: [
        {
          tag: "markdown",
          content: response.text.substring(0, 30000)
        }
      ]
    };
  }
}
