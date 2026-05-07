import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface ContextMessage {
  id: string;
  type: ContextMessageType;
  fromAgentId: string;
  toAgentId?: string; // undefined = broadcast
  topic: string;
  payload: unknown;
  timestamp: string;
  ttl?: number; // ms until message expires
  correlationId?: string; // for request-response pairing
}

export type ContextMessageType =
  | "knowledge.share"     // Share a finding with other agents
  | "knowledge.query"     // Ask other agents for information
  | "task.result"         // Share a task result
  | "task.progress"       // Share task progress
  | "alert"               // Alert other agents of something
  | "capability.announce" // Announce new capability
  | "capability.request"  // Request a capability from others
  | "context.sync"        // Sync shared context
  | "context.query"       // Query shared context
  | "handshake"           // Agent discovery handshake
  ;

export interface SharedContext {
  key: string;
  value: unknown;
  sourceAgentId: string;
  updatedAt: string;
  version: number;
  tags: string[];
}

// ─── Bus ──────────────────────────────────────────────────────────────────────────

export class ContextBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50);
  }
  private messages: ContextMessage[] = [];
  private sharedContext: Map<string, SharedContext> = new Map();
  private maxMessages = 500;
  private maxContextEntries = 1000;

  // ── Messaging ──────────────────────────────────────────────────────────────

  /** Publish a message to the bus */
  publish(msg: Omit<ContextMessage, "id" | "timestamp">): ContextMessage {
    const full: ContextMessage = {
      ...msg,
      id: randomUUID(),
      timestamp: new Date().toISOString()
    };

    this.messages.push(full);
    if (this.messages.length > this.maxMessages) {
      this.messages.splice(0, this.messages.length - this.maxMessages);
    }

    // Emit to topic subscribers
    this.emit(`topic:${msg.topic}`, full);

    // Emit to agent-specific subscribers
    if (msg.toAgentId) {
      this.emit(`agent:${msg.toAgentId}`, full);
    } else {
      this.emit("broadcast", full);
    }

    // Handle TTL expiration
    if (full.ttl && full.ttl > 0) {
      setTimeout(() => {
        const idx = this.messages.indexOf(full);
        if (idx >= 0) this.messages.splice(idx, 1);
      }, full.ttl);
    }

    return full;
  }

  /** Subscribe to messages on a specific topic */
  subscribe(topic: string, listener: (msg: ContextMessage) => void): () => void {
    const event = `topic:${topic}`;
    this.on(event, listener);
    return () => this.off(event, listener);
  }

  /** Subscribe to messages directed at a specific agent */
  subscribeAgent(agentId: string, listener: (msg: ContextMessage) => void): () => void {
    const event = `agent:${agentId}`;
    this.on(event, listener);
    return () => this.off(event, listener);
  }

  /** Subscribe to all broadcast messages */
  subscribeBroadcast(listener: (msg: ContextMessage) => void): () => void {
    this.on("broadcast", listener);
    return () => this.off("broadcast", listener);
  }

  /** Query recent messages by topic */
  queryMessages(topic: string, limit = 20): ContextMessage[] {
    return this.messages
      .filter(m => m.topic === topic)
      .slice(-limit);
  }

  /** Query messages by correlation ID (request-response tracking) */
  queryByCorrelation(correlationId: string): ContextMessage[] {
    return this.messages.filter(m => m.correlationId === correlationId);
  }

  // ── Shared Context ──────────────────────────────────────────────────────────

  /** Set a shared context value (upsert) */
  setContext(key: string, value: unknown, sourceAgentId: string, tags: string[] = []): SharedContext {
    const existing = this.sharedContext.get(key);
    const entry: SharedContext = {
      key,
      value,
      sourceAgentId,
      updatedAt: new Date().toISOString(),
      version: (existing?.version ?? 0) + 1,
      tags
    };

    if (this.sharedContext.size >= this.maxContextEntries && !existing) {
      // Evict oldest entry
      let oldestKey = "";
      let oldestTime = Infinity;
      for (const [k, v] of this.sharedContext) {
        const t = new Date(v.updatedAt).getTime();
        if (t < oldestTime) { oldestTime = t; oldestKey = k; }
      }
      if (oldestKey) this.sharedContext.delete(oldestKey);
    }

    this.sharedContext.set(key, entry);
    this.emit(`context:${key}`, entry);
    this.emit("context:changed", entry);

    return entry;
  }

  /** Get a shared context value */
  getContext(key: string): SharedContext | undefined {
    return this.sharedContext.get(key);
  }

  /** Query shared context by tags */
  queryContext(tags: string[], limit = 20): SharedContext[] {
    if (tags.length === 0) return [];

    return Array.from(this.sharedContext.values())
      .filter(entry => tags.some(t => entry.tags.some(et => et.toLowerCase().includes(t.toLowerCase()))))
      .sort((a, b) => b.version - a.version)
      .slice(0, limit);
  }

  /** Get all context keys matching a prefix */
  getContextByPrefix(prefix: string): SharedContext[] {
    return Array.from(this.sharedContext.entries())
      .filter(([key]) => key.startsWith(prefix))
      .map(([, entry]) => entry)
      .sort((a, b) => b.version - a.version);
  }

  /** Delete a shared context entry */
  deleteContext(key: string): boolean {
    const deleted = this.sharedContext.delete(key);
    if (deleted) this.emit("context:deleted", key);
    return deleted;
  }

  /** Get context statistics */
  getStats(): { messageCount: number; contextEntries: number; topicCount: number } {
    const topics = new Set(this.messages.map(m => m.topic));
    return {
      messageCount: this.messages.length,
      contextEntries: this.sharedContext.size,
      topicCount: topics.size
    };
  }
}
