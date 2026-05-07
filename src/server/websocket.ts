import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { ProgressEvent } from "../progress-manager.js";

// ─── Types ────────────────────────────────────────────────────────────────────────

export type WsClientMessage =
  | { type: "cancel_task"; taskId: string }
  | { type: "pause_task"; taskId: string }
  | { type: "resume_task"; taskId: string }
  | { type: "approve"; approvalId: string }
  | { type: "reject"; approvalId: string }
  | { type: "submit_task"; goal: string }
  | { type: "ping" };

export type WsServerMessage =
  | { type: "progress"; taskId: string; event: ProgressEvent }
  | { type: "tool_start"; taskId: string; tool: string; args: unknown }
  | { type: "tool_done"; taskId: string; tool: string; success: boolean }
  | { type: "phase_change"; taskId: string; phase: string; label: string }
  | { type: "approval_required"; taskId: string; approvalId: string; tool: string }
  | { type: "task_completed"; taskId: string; result: unknown }
  | { type: "task_failed"; taskId: string; error: string }
  | { type: "pong" };

// ─── WebSocket constants ──────────────────────────────────────────────────────────

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OPCODE_TEXT = 0x01;
const OPCODE_CLOSE = 0x08;
const OPCODE_PING = 0x09;
const OPCODE_PONG = 0x0A;

// ─── Client ───────────────────────────────────────────────────────────────────────

class WsClient {
  id: string;
  private socket: Socket;
  private onMessage: (msg: WsClientMessage) => void;
  private onClose: () => void;

  constructor(socket: Socket, onMessage: (msg: WsClientMessage) => void, onClose: () => void) {
    this.id = randomUUID();
    this.socket = socket;
    this.onMessage = onMessage;
    this.onClose = onClose;

    socket.on("data", (buf: Buffer) => this.handleFrame(buf));
    socket.on("close", () => this.onClose());
    socket.on("error", () => this.onClose());
  }

  send(msg: WsServerMessage): void {
    try {
      const payload = Buffer.from(JSON.stringify(msg), "utf8");
      const frame = this.encodeFrame(payload, OPCODE_TEXT);
      this.socket.write(frame);
    } catch {
      // Socket likely closed
    }
  }

  close(): void {
    try {
      const frame = this.encodeFrame(Buffer.alloc(0), OPCODE_CLOSE);
      this.socket.write(frame);
      this.socket.destroy();
    } catch {
      // Already closed
    }
  }

  // ── WebSocket Frame Protocol ───────────────────────────────────────────────

  private handleFrame(buffer: Buffer): void {
    try {
      let offset = 0;

      while (offset < buffer.length) {
        const firstByte = buffer[offset++];
        const opcode = firstByte & 0x0F;
        const secondByte = buffer[offset++];
        const masked = (secondByte & 0x80) !== 0;
        let payloadLength = secondByte & 0x7F;

        if (payloadLength === 126) {
          payloadLength = buffer.readUInt16BE(offset);
          offset += 2;
        } else if (payloadLength === 127) {
          // 64-bit length - read as Number (safe for our use case)
          payloadLength = Number(buffer.readBigUInt64BE(offset));
          offset += 8;
        }

        let maskKey: Buffer | undefined;
        if (masked) {
          maskKey = buffer.subarray(offset, offset + 4);
          offset += 4;
        }

        let payload = buffer.subarray(offset, offset + payloadLength);
        offset += payloadLength;

        if (masked && maskKey) {
          payload = Buffer.from(payload.map((b, i) => b ^ maskKey![i % 4]));
        }

        switch (opcode) {
          case OPCODE_TEXT:
            try {
              const msg = JSON.parse(payload.toString("utf8")) as WsClientMessage;
              this.onMessage(msg);
            } catch {
              // Invalid JSON, ignore
            }
            break;
          case OPCODE_PING:
            this.socket.write(this.encodeFrame(payload, OPCODE_PONG));
            break;
          case OPCODE_CLOSE:
            this.close();
            break;
        }
      }
    } catch {
      // Frame parse error, close
      this.close();
    }
  }

  private encodeFrame(payload: Buffer, opcode: number): Buffer {
    const length = payload.length;
    let header: Buffer;

    if (length < 126) {
      header = Buffer.from([0x80 | opcode, length]);
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(length), 2);
    }

    return Buffer.concat([header, payload]);
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────────

export interface WsServerHandlers {
  onCancelTask: (taskId: string) => Promise<void>;
  onPauseTask: (taskId: string) => Promise<void>;
  onResumeTask: (taskId: string) => Promise<void>;
  onApprove: (approvalId: string) => Promise<void>;
  onReject: (approvalId: string) => Promise<void>;
  onSubmitTask: (goal: string) => Promise<{ taskId: string }>;
}

export class WebSocketServer {
  private clients = new Map<string, WsClient>();
  private handlers: WsServerHandlers;

  constructor(handlers: WsServerHandlers) {
    this.handlers = handlers;
  }

  /**
   * Handle HTTP Upgrade request. Call this from the main HTTP server
   * when a request comes in with Upgrade: websocket header.
   */
  handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    const key = req.headers["sec-websocket-key"];
    if (!key) {
      socket.destroy();
      return;
    }

    // Compute accept key
    const acceptKey = createHash("sha1")
      .update(key + WS_MAGIC)
      .digest("base64");

    // Send handshake response
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
      "\r\n"
    );

    const client = new WsClient(
      socket,
      (msg) => this.handleMessage(client, msg),
      () => this.clients.delete(client.id)
    );

    this.clients.set(client.id, client);
    console.log(`[WS] Client connected: ${client.id} (total: ${this.clients.size})`);
  }

  /** Broadcast progress event to all connected clients */
  broadcast(event: ProgressEvent, taskId: string): void {
    const msg: WsServerMessage = { type: "progress", taskId, event };
    this.broadcastRaw(msg);
  }

  /** Broadcast tool start */
  broadcastToolStart(taskId: string, tool: string, args: unknown): void {
    this.broadcastRaw({ type: "tool_start", taskId, tool, args });
  }

  /** Broadcast tool done */
  broadcastToolDone(taskId: string, tool: string, success: boolean): void {
    this.broadcastRaw({ type: "tool_done", taskId, tool, success });
  }

  /** Broadcast phase change */
  broadcastPhase(taskId: string, phase: string, label: string): void {
    this.broadcastRaw({ type: "phase_change", taskId, phase, label });
  }

  /** Broadcast approval required */
  broadcastApprovalRequired(taskId: string, approvalId: string, tool: string): void {
    this.broadcastRaw({ type: "approval_required", taskId, approvalId, tool });
  }

  /** Broadcast task completed */
  broadcastTaskCompleted(taskId: string, result: unknown): void {
    this.broadcastRaw({ type: "task_completed", taskId, result });
  }

  getClientCount(): number {
    return this.clients.size;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async handleMessage(client: WsClient, msg: WsClientMessage): Promise<void> {
    try {
      switch (msg.type) {
        case "cancel_task":
          await this.handlers.onCancelTask(msg.taskId);
          break;
        case "pause_task":
          await this.handlers.onPauseTask(msg.taskId);
          break;
        case "resume_task":
          await this.handlers.onResumeTask(msg.taskId);
          break;
        case "approve":
          await this.handlers.onApprove(msg.approvalId);
          break;
        case "reject":
          await this.handlers.onReject(msg.approvalId);
          break;
        case "submit_task":
          const result = await this.handlers.onSubmitTask(msg.goal);
          this.broadcastTaskCompleted(result.taskId, result);
          break;
        case "ping":
          client.send({ type: "pong" });
          break;
      }
    } catch (e: any) {
      console.log(`[WS] Error handling message from ${client.id}: ${e.message}`);
    }
  }

  private broadcastRaw(msg: WsServerMessage): void {
    for (const client of this.clients.values()) {
      client.send(msg);
    }
  }
}
