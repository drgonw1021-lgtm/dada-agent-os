import { createHash } from "node:crypto";
import { BotAdapter, type BotConfig, type BotMessage, type BotResponse, type BotStatus } from "./bot-interface.js";

// ─── WeChat (微信) Official Account Bot Adapter ───────────────────────────────
// Uses WeChat Official Account (公众号) message API
// Receives: XML callbacks from WeChat server
// Sends: HTTP API with access_token

const API_BASE = "https://api.weixin.qq.com/cgi-bin";

export class WeChatBot implements BotAdapter {
  readonly platform = "wechat" as const;
  private _status: BotStatus = "disconnected";
  private appId: string;
  private appSecret: string;
  private token: string; // WeChat verification token
  private enabled: boolean;
  private messageHandler?: (msg: BotMessage) => Promise<BotResponse | void>;
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private startedAt?: string;

  constructor(config: BotConfig) {
    this.appId = config.appId || "";
    this.appSecret = config.appSecret || "";
    this.token = config.token || "";
    this.enabled = config.enabled !== false;
  }

  get status(): BotStatus { return this._status; }

  async start(): Promise<void> {
    if (!this.appId || !this.appSecret) {
      this._status = "error";
      throw new Error("WeChat appId and appSecret are required");
    }

    this._status = "connecting";

    try {
      await this.getAccessToken();
      this._status = "connected";
      this.startedAt = new Date().toISOString();
      console.log("[WeChatBot] Connected to WeChat Official Account API");
    } catch (e: any) {
      this._status = "error";
      throw new Error(`WeChat auth failed: ${e.message}`);
    }
  }

  async stop(): Promise<void> {
    this._status = "disconnected";
    this.accessToken = null;
  }

  async sendMessage(chatId: string, response: BotResponse): Promise<string> {
    const token = await this.getAccessToken();
    const body: any = {
      touser: chatId,
      msgtype: "text",
      text: { content: response.text.substring(0, 2048) }
    };

    const url = `${API_BASE}/message/custom/send?access_token=${token}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await res.json() as any;
    if (data.errcode !== 0) {
      throw new Error(`WeChat send failed: ${data.errmsg} (code ${data.errcode})`);
    }

    return data.msgid?.toString() || "";
  }

  /** Verify WeChat server signature (GET request from WeChat) */
  verifySignature(signature: string, timestamp: string, nonce: string): boolean {
    if (!this.token) return false;
    const tmpArr = [this.token, timestamp, nonce].sort();
    const tmpStr = tmpArr.join("");
    const hash = createHash("sha1").update(tmpStr).digest("hex");
    return hash === signature;
  }

  /** Parse WeChat XML message callback */
  parseXmlMessage(xml: string): BotMessage | null {
    try {
      const getTag = (name: string) => {
        const m = xml.match(new RegExp(`<${name}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${name}>`));
        if (m) return m[1];
        const m2 = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
        return m2?.[1] || "";
      };

      const msgType = getTag("MsgType");
      const text = msgType === "text" ? getTag("Content") : `[${msgType}]`;

      return {
        messageId: getTag("MsgId") || String(Date.now()),
        chatId: getTag("FromUserName"),
        userId: getTag("FromUserName"),
        userName: "WeChat User",
        text,
        platform: "wechat",
        isGroup: false,
        timestamp: new Date(Number(getTag("CreateTime")) * 1000 || Date.now()).toISOString()
      };
    } catch {
      return null;
    }
  }

  onMessage(handler: (msg: BotMessage) => Promise<BotResponse | void>): void {
    this.messageHandler = handler;
  }

  /** Process WeChat callback (POST with XML) */
  async processCallback(xml: string): Promise<string> {
    const msg = this.parseXmlMessage(xml);
    if (!msg) return "success";

    if (this.messageHandler) {
      try {
        const response = await this.messageHandler(msg);
        if (response) {
          await this.sendMessage(msg.chatId, response);
        }
      } catch (e: any) {
        console.error(`[WeChatBot] Message handler error: ${e.message}`);
      }
    }

    return "success";
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

    const url = `${API_BASE}/token?grant_type=client_credential&appid=${this.appId}&secret=${this.appSecret}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`WeChat token request failed: ${res.status}`);

    const data = await res.json() as any;
    if (data.errcode) {
      throw new Error(`WeChat token error: ${data.errmsg} (code ${data.errcode})`);
    }

    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;
    return this.accessToken!;
  }
}
