/**
 * ExternalTriggers — generic webhook receiver that maps incoming HTTP calls
 * to DaDa task execution. Enables external services (GitHub, Slack, cron
 * monitors, etc.) to trigger autonomous workflows.
 */

import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface TriggerConfig {
  id: string;
  name: string;
  /** URL path segment: /api/triggers/<path> */
  path: string;
  /** Optional secret token for HMAC verification */
  secret?: string;
  /** The goal template. Use {{body.path}} for JSON body extraction. */
  goalTemplate: string;
  /** Task type to use */
  taskType?: string;
  /** Only accept from these IPs/CIDRs (empty = allow all) */
  allowedIps?: string[];
  /** Optional webhook source (GitHub, Slack, Stripe, custom) */
  source?: string;
  enabled: boolean;
  createdAt: string;
  lastTriggeredAt?: string;
  triggerCount: number;
}

export interface TriggerEvent {
  id: string;
  triggerId: string;
  triggerName: string;
  receivedAt: string;
  headers: Record<string, string>;
  body: unknown;
  /** The resolved goal that was executed */
  resolvedGoal: string;
  /** The task that was created */
  taskId?: string;
  success?: boolean;
}

export interface ExternalTriggersOptions {
  dataDir: string;
  /** Callback to execute a task from a resolved goal */
  onTrigger: (goal: string, taskType?: string, metadata?: Record<string, unknown>) => Promise<{ taskId: string }>;
}

export class ExternalTriggers {
  private triggers: Map<string, TriggerConfig> = new Map();
  private events: TriggerEvent[] = [];

  constructor(private options: ExternalTriggersOptions) {}

  // ── Persistence ──────────────────────────────────────────────────────

  private triggersPath(): string {
    return this.options.dataDir + "/triggers.json";
  }

  private eventsPath(): string {
    return this.options.dataDir + "/trigger-events.json";
  }

  async initialize(): Promise<void> {
    await mkdir(this.options.dataDir, { recursive: true });
    try {
      const data = JSON.parse(await readFile(this.triggersPath(), "utf8"));
      for (const t of data) this.triggers.set(t.id, t);
    } catch { /* no triggers yet */ }
    try {
      this.events = JSON.parse(await readFile(this.eventsPath(), "utf8"));
    } catch { this.events = []; }
  }

  private async save(): Promise<void> {
    await writeFile(this.triggersPath(), JSON.stringify([...this.triggers.values()], null, 2), "utf8");
  }

  private async saveEvents(): Promise<void> {
    // Keep last 1000 events
    if (this.events.length > 1000) this.events = this.events.slice(-500);
    await writeFile(this.eventsPath(), JSON.stringify(this.events, null, 2), "utf8");
  }

  // ── Trigger CRUD ──────────────────────────────────────────────────────

  createTrigger(params: {
    name: string;
    path: string;
    secret?: string;
    goalTemplate: string;
    taskType?: string;
    allowedIps?: string[];
    source?: string;
  }): TriggerConfig {
    const id = randomUUID();
    const trigger: TriggerConfig = {
      id,
      name: params.name,
      path: params.path.replace(/^\/+/, ""), // normalize
      secret: params.secret,
      goalTemplate: params.goalTemplate,
      taskType: params.taskType,
      allowedIps: params.allowedIps,
      source: params.source,
      enabled: true,
      createdAt: new Date().toISOString(),
      triggerCount: 0,
    };
    this.triggers.set(id, trigger);
    this.save().catch(() => {});
    return trigger;
  }

  updateTrigger(id: string, updates: Partial<TriggerConfig>): TriggerConfig | null {
    const trigger = this.triggers.get(id);
    if (!trigger) return null;
    Object.assign(trigger, updates);
    this.save().catch(() => {});
    return trigger;
  }

  deleteTrigger(id: string): boolean {
    const result = this.triggers.delete(id);
    if (result) this.save().catch(() => {});
    return result;
  }

  getTrigger(id: string): TriggerConfig | undefined {
    return this.triggers.get(id);
  }

  listTriggers(): TriggerConfig[] {
    return [...this.triggers.values()];
  }

  /** Get a trigger by its URL path */
  getTriggerByPath(path: string): TriggerConfig | undefined {
    const normalized = path.replace(/^\/+/, "");
    return [...this.triggers.values()].find(
      t => t.enabled && t.path === normalized
    );
  }

  // ── Webhook handling ──────────────────────────────────────────────────

  /**
   * Handle an incoming webhook request. Verifies the trigger exists,
   * resolves the goal template, executes the task.
   */
  async handleWebhook(
    path: string,
    headers: Record<string, string>,
    body: unknown,
    clientIp?: string
  ): Promise<{ accepted: boolean; taskId?: string; error?: string }> {
    const trigger = this.getTriggerByPath(path);
    if (!trigger) {
      return { accepted: false, error: `No trigger registered for path: ${path}` };
    }

    // IP allowlist check
    if (trigger.allowedIps && trigger.allowedIps.length > 0 && clientIp) {
      const allowed = trigger.allowedIps.some(cidr => ipMatches(clientIp, cidr));
      if (!allowed) {
        return { accepted: false, error: `IP ${clientIp} not in allowlist` };
      }
    }

    // Secret verification (HMAC-SHA256)
    if (trigger.secret && trigger.source) {
      const verified = verifyWebhookSignature(trigger.source, headers, body, trigger.secret);
      if (!verified) {
        return { accepted: false, error: "Signature verification failed" };
      }
    }

    // Resolve goal template
    const resolvedGoal = resolveTemplate(trigger.goalTemplate, body);

    // Execute task
    try {
      const { taskId } = await this.options.onTrigger(resolvedGoal, trigger.taskType, {
        triggerId: trigger.id,
        triggerName: trigger.name,
        source: trigger.source,
      });

      // Record event
      const event: TriggerEvent = {
        id: randomUUID(),
        triggerId: trigger.id,
        triggerName: trigger.name,
        receivedAt: new Date().toISOString(),
        headers,
        body,
        resolvedGoal,
        taskId,
      };
      this.events.push(event);

      // Update trigger stats
      trigger.lastTriggeredAt = new Date().toISOString();
      trigger.triggerCount++;

      this.save().catch(() => {});
      this.saveEvents().catch(() => {});

      return { accepted: true, taskId };
    } catch (err) {
      return { accepted: false, error: String(err) };
    }
  }

  // ── Event history ─────────────────────────────────────────────────────

  getEvents(triggerId?: string, limit = 50): TriggerEvent[] {
    const filtered = triggerId
      ? this.events.filter(e => e.triggerId === triggerId)
      : this.events;
    return filtered.slice(-limit);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Resolve {{body.field.path}} template syntax against a JSON body */
function resolveTemplate(template: string, body: unknown): string {
  if (!body || typeof body !== "object") return template;

  return template.replace(/\{\{([^}]+)\}\}/g, (_match, path: string) => {
    const trimmed = path.trim();
    if (trimmed === "body") {
      return typeof body === "string" ? body : JSON.stringify(body);
    }
    if (trimmed.startsWith("body.")) {
      const fields = trimmed.slice(5).split(".");
      let value: unknown = body;
      for (const field of fields) {
        if (value && typeof value === "object") {
          value = (value as Record<string, unknown>)[field];
        } else {
          return `{{${trimmed}}}`; // Keep unresolved
        }
      }
      return value != null ? String(value) : `{{${trimmed}}}`;
    }
    return `{{${trimmed}}}`; // Keep unresolved
  });
}

/** Simple IP matching (exact or /24 CIDR) */
function ipMatches(ip: string, cidr: string): boolean {
  if (cidr === ip) return true;
  if (cidr.includes("/")) {
    const [base, bitsStr] = cidr.split("/");
    const bits = parseInt(bitsStr, 10);
    if (bits < 24) return false; // Only support /24 and narrower for safety
    const ipParts = ip.split(".").map(Number);
    const baseParts = base.split(".").map(Number);
    const matchOctets = Math.floor(bits / 8);
    for (let i = 0; i < matchOctets; i++) {
      if (ipParts[i] !== baseParts[i]) return false;
    }
    return true;
  }
  return false;
}

/** Verify webhook signatures for common platforms */
function verifyWebhookSignature(
  source: string,
  headers: Record<string, string>,
  body: unknown,
  secret: string
): boolean {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);

  switch (source.toLowerCase()) {
    case "github": {
      const sig = headers["x-hub-signature-256"] || "";
      const { createHmac } = require("node:crypto");
      const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
      // Constant-time comparison via Buffer
      try {
        return require("node:crypto").timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
      } catch {
        return sig === expected;
      }
    }

    case "slack": {
      // Slack uses signing secret with v0=<hmac> format
      const timestamp = headers["x-slack-request-timestamp"] || "";
      const slackSig = headers["x-slack-signature"] || "";
      if (!timestamp || !slackSig) return false;
      const { createHmac } = require("node:crypto");
      const baseString = `v0:${timestamp}:${rawBody}`;
      const expected = "v0=" + createHmac("sha256", secret).update(baseString).digest("hex");
      return slackSig === expected;
    }

    default:
      // Generic: check for x-signature or authorization bearer
      return true; // Skip verification for unknown sources
  }
}
