/**
 * BusTransport — cross-process transport layer for ContextBus.
 * File-based IPC using JSON files + polling, enabling multi-process agent meshes.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, writeFile, unlink, rename } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { EventEmitter } from "node:events";
import type { ContextMessage } from "./context-bus.js";

export interface TransportMessage {
  id: string;
  envelope: ContextMessage;
  sentAt: string;
  senderPid: number;
  /** Retry count for delivery */
  retries: number;
}

export interface BusTransportOptions {
  /** Directory for IPC message exchange */
  inboxDir: string;
  /** Directory for process status / health */
  statusDir: string;
  /** Polling interval in ms */
  pollIntervalMs: number;
  /** Max age of messages before cleanup (ms) */
  messageTtlMs: number;
  /** Process identifier (defaults to PID) */
  processId?: string;
  /** Callback when a remote message is received */
  onMessage: (msg: ContextMessage) => void;
}

export class BusTransport extends EventEmitter {
  private inboxDir: string;
  private statusDir: string;
  private pollIntervalMs: number;
  private messageTtlMs: number;
  private processId: string;
  private pid: number;
  private onMessage: (msg: ContextMessage) => void;
  private pollTimer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(options: BusTransportOptions) {
    super();
    this.inboxDir = options.inboxDir;
    this.statusDir = options.statusDir;
    this.pollIntervalMs = options.pollIntervalMs;
    this.messageTtlMs = options.messageTtlMs;
    this.processId = options.processId ?? `proc-${process.pid}`;
    this.pid = process.pid;
    this.onMessage = options.onMessage;
  }

  async start(): Promise<void> {
    this.running = true;
    await mkdir(this.inboxDir, { recursive: true });
    await mkdir(this.statusDir, { recursive: true });
    await this.writeStatus("running");

    // Process any messages left from before startup
    await this.pollInbox();

    this.pollTimer = setInterval(() => this.pollInbox(), this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    await this.writeStatus("stopped");
  }

  /** Send a message to all other processes */
  async broadcast(msg: ContextMessage): Promise<void> {
    const transport: TransportMessage = {
      id: randomUUID(),
      envelope: msg,
      sentAt: new Date().toISOString(),
      senderPid: this.pid,
      retries: 0,
    };

    const filePath = join(this.inboxDir, `${this.processId}-${transport.id}.json`);
    await writeFile(filePath, JSON.stringify(transport, null, 2), "utf8");
  }

  /** Get health status of all known processes */
  async getPeerStatuses(): Promise<Array<{ processId: string; pid: number; status: string; lastSeen: string }>> {
    try {
      const entries = await readdir(this.statusDir, { withFileTypes: true });
      const statuses: Array<{ processId: string; pid: number; status: string; lastSeen: string }> = [];

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        try {
          const raw = await readFile(join(this.statusDir, entry.name), "utf8");
          statuses.push(JSON.parse(raw));
        } catch { /* skip corrupt */ }
      }

      return statuses;
    } catch {
      return [];
    }
  }

  /** Detect stale peer processes (no heartbeat for longer than threshold ms) */
  async detectStalePeers(thresholdMs: number): Promise<string[]> {
    const statuses = await this.getPeerStatuses();
    const now = Date.now();
    return statuses
      .filter(s => s.processId !== this.processId && now - new Date(s.lastSeen).getTime() > thresholdMs)
      .map(s => s.processId);
  }

  /** Clean up old messages */
  async cleanup(): Promise<number> {
    const cutoff = Date.now() - this.messageTtlMs;
    let deleted = 0;

    try {
      const entries = await readdir(this.inboxDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const filePath = join(this.inboxDir, entry.name);
        try {
          const raw = await readFile(filePath, "utf8");
          const msg = JSON.parse(raw) as TransportMessage;
          if (new Date(msg.sentAt).getTime() < cutoff) {
            await unlink(filePath);
            deleted++;
          }
        } catch {
          // Delete corrupt files
          await unlink(filePath).catch(() => {});
          deleted++;
        }
      }
    } catch { /* ignore */ }

    return deleted;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async pollInbox(): Promise<void> {
    if (!this.running) return;

    try {
      const entries = await readdir(this.inboxDir, { withFileTypes: true });
      const ourPrefix = `${this.processId}-`;

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        // Skip our own messages
        if (entry.name.startsWith(ourPrefix)) continue;

        const filePath = join(this.inboxDir, entry.name);
        try {
          const raw = await readFile(filePath, "utf8");
          const msg = JSON.parse(raw) as TransportMessage;
          // Delete after reading (at-most-once delivery)
          await unlink(filePath);

          // Don't process messages we sent ourselves
          if (msg.senderPid === this.pid) continue;

          this.onMessage(msg.envelope);
        } catch {
          // Delete unreadable files
          await unlink(filePath).catch(() => {});
        }
      }
    } catch { /* inbox might be empty */ }

    // Update heartbeat
    await this.writeStatus("running");
  }

  private async writeStatus(status: string): Promise<void> {
    try {
      const filePath = join(this.statusDir, `${this.processId}.json`);
      const tmpPath = filePath + ".tmp";
      await writeFile(tmpPath, JSON.stringify({
        processId: this.processId,
        pid: this.pid,
        status,
        lastSeen: new Date().toISOString(),
      }, null, 2), "utf8");
      await rename(tmpPath, filePath);
    } catch { /* best-effort */ }
  }
}
