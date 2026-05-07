import { randomUUID } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface DelegationRequest {
  /** Unique delegation ID */
  delegationId: string;
  /** The agent sending the delegation */
  fromAgentId: string;
  /** Target agent (or null for auto-assignment) */
  toAgentId?: string;
  /** Required capabilities for the task */
  requiredCapabilities: string[];
  /** Preferred agent role */
  preferredRole?: string;
  /** The task/subgoal to delegate */
  task: DelegatedTask;
  /** Priority: 0=low, 1=normal, 2=high, 3=critical */
  priority: number;
  /** Timeout in ms for the entire delegation */
  timeoutMs: number;
  /** When the delegation was created */
  createdAt: string;
}

export interface DelegatedTask {
  /** Short description of the subgoal */
  goal: string;
  /** Task type hint */
  taskType?: string;
  /** Additional context for the delegate */
  context: string;
  /** Expected output format */
  outputFormat?: string;
  /** Constraints (e.g. "must not write files", "read-only") */
  constraints?: string[];
  /** Data/attachments to pass along */
  payload?: unknown;
}

export interface DelegationResult {
  delegationId: string;
  status: "accepted" | "rejected" | "completed" | "failed" | "timed_out" | "cancelled";
  acceptedBy?: string; // agent ID
  result?: unknown;
  error?: string;
  steps?: Array<{ action: string; tool?: string; output?: string }>;
  startedAt?: string;
  completedAt?: string;
  retries: number;
}

export interface DelegationAck {
  delegationId: string;
  accepted: boolean;
  agentId: string;
  reason?: string;
  estimatedMs?: number;
}

export type DelegationStatus = DelegationResult["status"];

// ─── Protocol ─────────────────────────────────────────────────────────────────────

export interface DelegationHandler {
  /** Handle an incoming delegation request. Return ack if accepted, or reject. */
  onDelegationRequest: (req: DelegationRequest) => Promise<DelegationAck>;
  /** Execute a delegated task. Called after acceptance. */
  executeDelegatedTask: (req: DelegationRequest) => Promise<DelegationResult>;
  /** Cancel a running delegation */
  onCancelDelegation: (delegationId: string) => Promise<void>;
}

export interface DelegationCallbacks {
  /** Called when delegation is accepted by a worker */
  onAccepted?: (delegationId: string, agentId: string) => void;
  /** Called when delegation completes */
  onCompleted?: (delegationId: string, result: DelegationResult) => void;
  /** Called when delegation fails or times out */
  onFailed?: (delegationId: string, error: string) => void;
  /** Called for progress updates from the worker */
  onProgress?: (delegationId: string, update: string) => void;
}

// ─── Delegation Manager ───────────────────────────────────────────────────────────

export class DelegationManager {
  private activeDelegations: Map<string, {
    request: DelegationRequest;
    result: DelegationResult;
    timer: NodeJS.Timeout | null;
    callbacks: DelegationCallbacks;
  }> = new Map();

  private handlers: Map<string, DelegationHandler> = new Map();
  private maxRetries: number;

  constructor(maxRetries = 2) {
    this.maxRetries = maxRetries;
  }

  /** Register a handler for incoming delegations (typically one per agent) */
  registerHandler(agentId: string, handler: DelegationHandler): void {
    this.handlers.set(agentId, handler);
  }

  unregisterHandler(agentId: string): void {
    this.handlers.delete(agentId);
  }

  /** Create a new delegation request */
  createDelegation(
    fromAgentId: string,
    task: DelegatedTask,
    options: {
      toAgentId?: string;
      requiredCapabilities?: string[];
      preferredRole?: string;
      priority?: number;
      timeoutMs?: number;
      callbacks?: DelegationCallbacks;
    } = {}
  ): DelegationRequest {
    const req: DelegationRequest = {
      delegationId: randomUUID(),
      fromAgentId,
      toAgentId: options.toAgentId,
      requiredCapabilities: options.requiredCapabilities || [],
      preferredRole: options.preferredRole,
      task,
      priority: options.priority ?? 1,
      timeoutMs: options.timeoutMs ?? 120000,
      createdAt: new Date().toISOString()
    };

    const result: DelegationResult = {
      delegationId: req.delegationId,
      status: "accepted",
      retries: 0
    };

    let timer: NodeJS.Timeout | null = null;
    if (req.timeoutMs > 0) {
      timer = setTimeout(() => this.handleTimeout(req.delegationId), req.timeoutMs);
    }

    this.activeDelegations.set(req.delegationId, {
      request: req,
      result,
      timer,
      callbacks: options.callbacks || {}
    });

    return req;
  }

  /** Handle incoming delegation request — decide accept/reject */
  async handleIncoming(agentId: string, req: DelegationRequest): Promise<DelegationAck> {
    const handler = this.handlers.get(agentId);
    if (!handler) {
      return { delegationId: req.delegationId, accepted: false, agentId, reason: "No handler registered" };
    }

    try {
      return await handler.onDelegationRequest(req);
    } catch (e: any) {
      return { delegationId: req.delegationId, accepted: false, agentId, reason: e.message };
    }
  }

  /** Execute a delegated task (called by the worker agent) */
  async executeDelegation(agentId: string, delegationId: string): Promise<DelegationResult> {
    const entry = this.activeDelegations.get(delegationId);
    if (!entry) {
      return { delegationId, status: "failed", error: "Delegation not found", retries: 0 };
    }

    const handler = this.handlers.get(agentId);
    if (!handler) {
      return { delegationId, status: "failed", error: "No handler for agent", retries: entry.result.retries };
    }

    entry.result.startedAt = new Date().toISOString();

    try {
      const result = await handler.executeDelegatedTask(entry.request);

      // Merge result
      entry.result.status = result.status;
      entry.result.result = result.result;
      entry.result.error = result.error;
      entry.result.steps = result.steps;
      entry.result.completedAt = new Date().toISOString();

      if (entry.timer) clearTimeout(entry.timer);

      if (result.status === "completed") {
        entry.callbacks.onCompleted?.(delegationId, entry.result);
      } else {
        // Handle retry
        if (entry.result.retries < this.maxRetries) {
          entry.result.retries++;
          entry.result.status = "accepted";
          return this.executeDelegation(agentId, delegationId);
        }
        entry.callbacks.onFailed?.(delegationId, result.error || "Delegation failed");
      }

      return entry.result;
    } catch (e: any) {
      entry.result.status = "failed";
      entry.result.error = e.message;
      entry.result.completedAt = new Date().toISOString();

      if (entry.timer) clearTimeout(entry.timer);

      if (entry.result.retries < this.maxRetries) {
        entry.result.retries++;
        entry.result.status = "accepted";
        return this.executeDelegation(agentId, delegationId);
      }

      entry.callbacks.onFailed?.(delegationId, e.message);
      return entry.result;
    }
  }

  /** Cancel a running delegation */
  async cancelDelegation(delegationId: string): Promise<void> {
    const entry = this.activeDelegations.get(delegationId);
    if (!entry) return;

    entry.result.status = "cancelled";
    entry.result.completedAt = new Date().toISOString();
    if (entry.timer) clearTimeout(entry.timer);

    // Notify worker
    const toAgentId = entry.result.acceptedBy;
    if (toAgentId) {
      const handler = this.handlers.get(toAgentId);
      if (handler) {
        await handler.onCancelDelegation(delegationId).catch(() => {});
      }
    }

    this.activeDelegations.delete(delegationId);
  }

  /** Update acceptance — called after an agent accepts */
  updateAcceptance(delegationId: string, ack: DelegationAck): void {
    const entry = this.activeDelegations.get(delegationId);
    if (!entry) return;

    if (ack.accepted) {
      entry.result.acceptedBy = ack.agentId;
      entry.result.status = "accepted";
      entry.callbacks.onAccepted?.(delegationId, ack.agentId);
    } else {
      entry.result.status = "rejected";
      entry.result.error = ack.reason;
      if (entry.timer) clearTimeout(entry.timer);
      entry.callbacks.onFailed?.(delegationId, ack.reason || "Rejected");
    }
  }

  /** Get delegation status */
  getStatus(delegationId: string): DelegationResult | null {
    const entry = this.activeDelegations.get(delegationId);
    return entry ? { ...entry.result } : null;
  }

  /** List all active delegations */
  listActive(): DelegationRequest[] {
    return Array.from(this.activeDelegations.values())
      .filter(e => e.result.status === "accepted")
      .map(e => e.request);
  }

  /** Clean up completed/failed delegations older than the given age */
  cleanup(maxAgeMs = 300000): void {
    const now = Date.now();
    for (const [id, entry] of this.activeDelegations) {
      if (entry.result.status === "completed" || entry.result.status === "failed" || entry.result.status === "cancelled") {
        const completedAt = entry.result.completedAt ? new Date(entry.result.completedAt).getTime() : 0;
        if (now - completedAt > maxAgeMs) {
          if (entry.timer) clearTimeout(entry.timer);
          this.activeDelegations.delete(id);
        }
      }
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private handleTimeout(delegationId: string): void {
    const entry = this.activeDelegations.get(delegationId);
    if (!entry) return;

    if (entry.result.status === "accepted") {
      entry.result.status = "timed_out";
      entry.result.error = `Delegation timed out after ${entry.request.timeoutMs}ms`;
      entry.result.completedAt = new Date().toISOString();
      entry.callbacks.onFailed?.(delegationId, entry.result.error);
    }
  }
}
