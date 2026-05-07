/**
 * SmartEscalation decides when DaDa should ask the user for help.
 * Beyond the existing permission-based approval system, this adds
 * confidence-based escalation — the agent knows when it's unsure.
 */

export type EscalationLevel = "none" | "notify" | "confirm" | "block";

export interface EscalationConfig {
  /** Minimum tool confidence score before escalating (0-1) */
  minToolConfidence: number;
  /** Maximum consecutive failures before escalating */
  maxConsecutiveFailures: number;
  /** Tasks running longer than this (ms) trigger escalation */
  maxTaskDurationMs: number;
  /** Escalate when cost exceeds this (estimated tokens * rate) */
  maxEstimatedCost: number;
  /** Which level to use for each trigger */
  levels: {
    lowConfidence: EscalationLevel;
    repeatedFailure: EscalationLevel;
    timeout: EscalationLevel;
    highCost: EscalationLevel;
  };
}

export interface EscalationEvent {
  id: string;
  taskId: string;
  reason: string;
  level: EscalationLevel;
  context: string;
  timestamp: string;
  resolved: boolean;
  resolution?: string;
}

const DEFAULT_CONFIG: EscalationConfig = {
  minToolConfidence: 0.6,
  maxConsecutiveFailures: 3,
  maxTaskDurationMs: 30 * 60_000, // 30 min
  maxEstimatedCost: 0.5, // $0.50
  levels: {
    lowConfidence: "confirm",
    repeatedFailure: "notify",
    timeout: "notify",
    highCost: "confirm",
  },
};

export class SmartEscalation {
  private events: EscalationEvent[] = [];
  private consecutiveFailures: Map<string, number> = new Map();
  private taskStartTimes: Map<string, number> = new Map();

  constructor(private config: EscalationConfig = DEFAULT_CONFIG) {}

  // ── Task lifecycle ──────────────────────────────────────────────────

  trackTaskStart(taskId: string): void {
    this.taskStartTimes.set(taskId, Date.now());
    this.consecutiveFailures.set(taskId, 0);
  }

  trackTaskEnd(taskId: string): void {
    this.taskStartTimes.delete(taskId);
    this.consecutiveFailures.delete(taskId);
  }

  trackSuccess(taskId: string): void {
    this.consecutiveFailures.set(taskId, 0);
  }

  trackFailure(taskId: string): void {
    const count = (this.consecutiveFailures.get(taskId) || 0) + 1;
    this.consecutiveFailures.set(taskId, count);
  }

  // ── Escalation checks ───────────────────────────────────────────────

  checkLowConfidence(taskId: string, toolName: string, confidence: number): EscalationEvent | null {
    if (confidence >= this.config.minToolConfidence) return null;
    return this.createEvent(
      taskId,
      `Tool "${toolName}" has low confidence (${Math.round(confidence * 100)}% < ${Math.round(this.config.minToolConfidence * 100)}%)`,
      this.config.levels.lowConfidence,
      `The agent is unsure about using ${toolName}. Consider providing more specific instructions.`
    );
  }

  checkRepeatedFailure(taskId: string): EscalationEvent | null {
    const count = this.consecutiveFailures.get(taskId) || 0;
    if (count < this.config.maxConsecutiveFailures) return null;
    return this.createEvent(
      taskId,
      `${count} consecutive failures on task — may need human intervention`,
      this.config.levels.repeatedFailure,
      `The agent has failed ${count} times in a row. Review the task approach.`
    );
  }

  checkTimeout(taskId: string): EscalationEvent | null {
    const start = this.taskStartTimes.get(taskId);
    if (!start) return null;
    const elapsed = Date.now() - start;
    if (elapsed < this.config.maxTaskDurationMs) return null;
    return this.createEvent(
      taskId,
      `Task has been running for ${Math.round(elapsed / 60000)} minutes — may be stuck`,
      this.config.levels.timeout,
      `Consider cancelling and rephrasing the goal.`
    );
  }

  // ── Event management ────────────────────────────────────────────────

  private createEvent(
    taskId: string,
    reason: string,
    level: EscalationLevel,
    context: string
  ): EscalationEvent {
    const event: EscalationEvent = {
      id: `esc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      taskId,
      reason,
      level,
      context,
      timestamp: new Date().toISOString(),
      resolved: false,
    };
    this.events.push(event);
    if (this.events.length > 500) this.events.shift();
    return event;
  }

  resolveEvent(eventId: string, resolution?: string): void {
    const event = this.events.find(e => e.id === eventId);
    if (event) {
      event.resolved = true;
      event.resolution = resolution;
    }
  }

  getActiveEscalations(taskId?: string): EscalationEvent[] {
    const active = this.events.filter(e => !e.resolved);
    return taskId ? active.filter(e => e.taskId === taskId) : active;
  }

  shouldPause(taskId: string): boolean {
    return this.getActiveEscalations(taskId).some(e => e.level === "block");
  }

  getConfig(): EscalationConfig {
    return { ...this.config };
  }
}
