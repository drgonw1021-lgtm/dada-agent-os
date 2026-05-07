// ─── Types ────────────────────────────────────────────────────────────────────────

export interface BotMessage {
  /** Unique message ID from the platform */
  messageId: string;
  /** Platform-specific chat/channel/group ID */
  chatId: string;
  /** User ID who sent the message */
  userId: string;
  /** Display name of the sender */
  userName: string;
  /** The text content */
  text: string;
  /** Platform type */
  platform: BotPlatform;
  /** Original raw payload for platform-specific handling */
  raw?: unknown;
  /** Attachments (images, files, etc.) */
  attachments?: BotAttachment[];
  /** Whether this is a group/channel message */
  isGroup: boolean;
  /** Timestamp */
  timestamp: string;
}

export interface BotAttachment {
  type: "image" | "file" | "audio" | "video";
  name: string;
  mimeType: string;
  url?: string;
  data?: Buffer;
  size?: number;
}

export interface BotResponse {
  /** Text response */
  text: string;
  /** Optional attachments to send back */
  attachments?: BotAttachment[];
  /** Whether to format the text as markdown */
  markdown?: boolean;
  /** Platform-specific overrides */
  platformExtra?: Record<string, unknown>;
}

export type BotPlatform = "telegram" | "discord" | "lark" | "dingtalk" | "wechat";

export type BotStatus = "disconnected" | "connecting" | "connected" | "error";

export interface BotConfig {
  platform: BotPlatform;
  enabled: boolean;
  /** Platform-specific config */
  token?: string;
  appId?: string;
  appSecret?: string;
  webhookPath?: string;
  /** For bots that need a public URL */
  publicUrl?: string;
}

// ─── Interface ────────────────────────────────────────────────────────────────────

export interface BotAdapter {
  readonly platform: BotPlatform;
  readonly status: BotStatus;

  /** Start the bot (connect to platform API) */
  start(): Promise<void>;

  /** Stop the bot (disconnect) */
  stop(): Promise<void>;

  /** Send a response message back to a chat */
  sendMessage(chatId: string, response: BotResponse): Promise<string>;

  /** Set handler for incoming messages */
  onMessage(handler: (msg: BotMessage) => Promise<BotResponse | void>): void;

  /** Get bot info (name, avatar, etc.) */
  getInfo(): { platform: BotPlatform; status: BotStatus; startedAt?: string };

  /** Health check */
  healthCheck(): Promise<boolean>;
}
