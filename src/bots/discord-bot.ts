import { BotAdapter, type BotConfig, type BotMessage, type BotResponse, type BotStatus } from "./bot-interface.js";

const API_BASE = "https://discord.com/api/v10";

export class DiscordBot implements BotAdapter {
  readonly platform = "discord" as const;
  private _status: BotStatus = "disconnected";
  private token: string;
  private enabled: boolean;
  private messageHandler?: (msg: BotMessage) => Promise<BotResponse | void>;
  private ws: any = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private startedAt?: string;

  constructor(config: BotConfig) {
    this.token = config.token || "";
    this.enabled = config.enabled !== false;
  }

  get status(): BotStatus { return this._status; }

  async start(): Promise<void> {
    if (!this.token) {
      this._status = "error";
      throw new Error("Discord bot token is required");
    }

    this._status = "connecting";
    await this.connectGateway();
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
    this._status = "disconnected";
  }

  async sendMessage(chatId: string, response: BotResponse): Promise<string> {
    const body: any = { content: response.text.substring(0, 2000) };

    const result = await this.apiCall("POST", `/channels/${chatId}/messages`, body) as any;
    return result?.id || "";
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
      await this.apiCall("GET", "/users/@me");
      return true;
    } catch {
      return false;
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private async apiCall(method: string, path: string, body?: unknown): Promise<unknown> {
    const url = `${API_BASE}${path}`;
    const headers: Record<string, string> = {
      "Authorization": `Bot ${this.token}`,
      "Content-Type": "application/json"
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Discord API ${path} failed (${res.status}): ${text.substring(0, 200)}`);
    }

    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  private async connectGateway(): Promise<void> {
    try {
      // Get gateway URL
      const gatewayResp = await this.apiCall("GET", "/gateway/bot") as any;
      const gatewayUrl = `${gatewayResp.url}?v=10&encoding=json`;

      // Using native Node.js WebSocket (available in Node 21+)
      const WebSocket = (globalThis as any).WebSocket;
      if (!WebSocket) {
        throw new Error("WebSocket not available. Use Node.js 21+ or install 'ws' package.");
      }

      this.ws = new WebSocket(gatewayUrl);

      this.ws.on("open", () => {
        console.log("[DiscordBot] Gateway connected, waiting for identify...");
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const payload = JSON.parse(data.toString());
          this.handleGatewayMessage(payload);
        } catch {}
      });

      this.ws.on("close", (code: number) => {
        console.log(`[DiscordBot] Gateway closed (code ${code})`);
        this._status = "disconnected";
      });

      this.ws.on("error", (err: Error) => {
        console.error(`[DiscordBot] Gateway error: ${err.message}`);
        this._status = "error";
      });

    } catch (e: any) {
      this._status = "error";
      throw new Error(`Discord gateway connection failed: ${e.message}`);
    }
  }

  private handleGatewayMessage(payload: any): void {
    const { op, d, s, t } = payload;

    if (s) this.sequence = s;

    switch (op) {
      case 10: // Hello
        const { heartbeat_interval } = d;
        // Send Identify
        this.sendGateway({
          op: 2,
          d: {
            token: this.token,
            intents: 1 << 9 | 1 << 15, // GUILD_MESSAGES | MESSAGE_CONTENT
            properties: { os: "linux", browser: "dada", device: "dada" }
          }
        });

        // Start heartbeat
        this.heartbeatTimer = setInterval(() => {
          this.sendGateway({ op: 1, d: this.sequence });
        }, heartbeat_interval);
        break;

      case 0: // Dispatch
        if (t === "READY") {
          this.sessionId = d.session_id;
          this._status = "connected";
          this.startedAt = new Date().toISOString();
          console.log(`[DiscordBot] Ready as ${d.user?.username || "unknown"}`);
        }

        if (t === "MESSAGE_CREATE" && d.author && !d.author.bot) {
          const botMsg: BotMessage = {
            messageId: d.id,
            chatId: d.channel_id,
            userId: d.author.id,
            userName: d.author.username || d.author.global_name || "Unknown",
            text: d.content || "",
            platform: "discord",
            isGroup: d.guild_id != null,
            timestamp: new Date().toISOString(),
            raw: d
          };

          if (this.messageHandler && botMsg.text) {
            this.messageHandler(botMsg).catch(e => {
              console.error(`[DiscordBot] Message handler error: ${e.message}`);
            });
          }
        }
        break;

      case 11: // Heartbeat ACK
        break;
    }
  }

  private sendGateway(payload: unknown): void {
    if (this.ws && (this.ws as any).readyState === 1) { // OPEN
      this.ws.send(JSON.stringify(payload));
    }
  }

}
