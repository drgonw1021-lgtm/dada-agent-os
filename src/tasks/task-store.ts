import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type {
  CollaborationMode,
  ExecutionMode,
  ModeTrigger,
  OutputFormat,
  TaskAttachment,
  TaskArtifact,
  TaskModelOverrides,
  TaskType
} from "../core/types.js";

export type TaskSource = "manual" | "automation";
export type TaskStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export interface TaskRecord {
  taskId: string;
  goal: string;
  source: TaskSource;
  automationId?: string;
  automationName?: string;
  taskType?: TaskType;
  outputFormat?: OutputFormat;
  attachments?: TaskAttachment[];
  modelOverrides?: TaskModelOverrides;
  status: TaskStatus;
  createdAt: string;
  updatedAt?: string;
  startedAt?: string;
  completedAt?: string;
  retryCount: number;
  maxRetries: number;
  parentTaskId?: string;
  retriedByTaskId?: string;
  replayOfTaskId?: string;
  replayedByTaskId?: string;
  projectId?: string;
  projectDirectory?: string;
  /** Higher = more urgent. Default 0. */
  priority: number;
  /** Role assigned for worker-pool routing */
  assignedRole?: "researcher" | "engineer" | "media" | "reviewer" | "coordinator";
  executionMode?: ExecutionMode;
  collaborationMode?: CollaborationMode;
  modeTrigger?: ModeTrigger;
  cancelRequested?: boolean;
  waitingApprovalId?: string;
  waitingToolId?: string;
  summary?: string;
  artifacts?: TaskArtifact[];
  result?: unknown;
  error?: string;
}

export interface CreateTaskInput {
  taskId: string;
  goal: string;
  source: TaskSource;
  automationId?: string;
  automationName?: string;
  taskType?: TaskType;
  outputFormat?: OutputFormat;
  attachments?: TaskAttachment[];
  modelOverrides?: TaskModelOverrides;
  retryCount?: number;
  maxRetries?: number;
  parentTaskId?: string;
  replayOfTaskId?: string;
  projectId?: string;
  projectDirectory?: string;
  priority?: number;
  assignedRole?: "researcher" | "engineer" | "media" | "reviewer" | "coordinator";
  executionMode?: ExecutionMode;
  collaborationMode?: CollaborationMode;
  modeTrigger?: ModeTrigger;
}

export class TaskStore {
  private writeBusy = false;
  private writeQueue: Array<() => void> = [];

  constructor(private readonly filePath: string) {}

  /** Simple mutex to prevent concurrent JSON writes from corrupting the file */
  private async acquireWriteLock(): Promise<void> {
    if (!this.writeBusy) {
      this.writeBusy = true;
      return;
    }
    return new Promise(resolve => {
      this.writeQueue.push(resolve);
    });
  }

  private releaseWriteLock(): void {
    const next = this.writeQueue.shift();
    if (next) {
      next();
    } else {
      this.writeBusy = false;
    }
  }

  async list(): Promise<TaskRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((item) => this.normalize(item)) : [];
    } catch {
      return [];
    }
  }

  async get(taskId: string): Promise<TaskRecord | undefined> {
    const items = await this.list();
    return items.find((item) => item.taskId === taskId);
  }

  async create(input: CreateTaskInput): Promise<TaskRecord> {
    await this.acquireWriteLock();
    try {
      const items = await this.list();
      const record: TaskRecord = {
        taskId: input.taskId,
        goal: input.goal,
        source: input.source,
        automationId: input.automationId,
        automationName: input.automationName,
        taskType: input.taskType,
        outputFormat: input.outputFormat,
        attachments: input.attachments,
        modelOverrides: input.modelOverrides,
        status: "pending",
        createdAt: new Date().toISOString(),
        retryCount: input.retryCount ?? 0,
        maxRetries: input.maxRetries ?? 0,
        parentTaskId: input.parentTaskId,
        replayOfTaskId: input.replayOfTaskId,
        projectId: input.projectId,
        projectDirectory: input.projectDirectory,
        priority: input.priority ?? 0,
        assignedRole: input.assignedRole,
        executionMode: input.executionMode,
        collaborationMode: input.collaborationMode,
        modeTrigger: input.modeTrigger,
      };

      items.push(record);
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(items, null, 2), "utf8");
      return record;
    } finally {
      this.releaseWriteLock();
    }
  }

  async markRunning(taskId: string): Promise<TaskRecord | null> {
    return this.update(taskId, (item) => {
      item.status = "running";
      item.startedAt = new Date().toISOString();
      item.error = undefined;
      item.cancelRequested = false;
      item.waitingApprovalId = undefined;
      item.waitingToolId = undefined;
    });
  }

  async markCompleted(
    taskId: string,
    params: { summary?: string; result?: unknown; artifacts?: TaskArtifact[] }
  ): Promise<TaskRecord | null> {
    return this.update(taskId, (item) => {
      item.status = "completed";
      item.completedAt = new Date().toISOString();
      item.summary = params.summary;
      item.artifacts = params.artifacts;
      item.result = params.result;
      item.error = undefined;
      item.cancelRequested = false;
      item.waitingApprovalId = undefined;
      item.waitingToolId = undefined;
    });
  }

  async markFailed(taskId: string, error: string): Promise<TaskRecord | null> {
    return this.update(taskId, (item) => {
      item.status = "failed";
      item.completedAt = new Date().toISOString();
      item.error = error;
      item.waitingApprovalId = undefined;
      item.waitingToolId = undefined;
    });
  }

  async markWaitingApproval(
    taskId: string,
    params: { approvalId: string; toolId: string; reason: string }
  ): Promise<TaskRecord | null> {
    return this.update(taskId, (item) => {
      item.status = "waiting_approval";
      item.error = params.reason;
      item.waitingApprovalId = params.approvalId;
      item.waitingToolId = params.toolId;
      item.cancelRequested = false;
    });
  }

  async markPaused(taskId: string): Promise<TaskRecord | null> {
    return this.update(taskId, (item) => {
      item.status = "paused";
      item.cancelRequested = true;
    });
  }

  async markResumed(taskId: string): Promise<TaskRecord | null> {
    return this.update(taskId, (item) => {
      item.status = "pending";
      item.cancelRequested = false;
      item.error = undefined;
    });
  }

  async markCancelled(taskId: string, reason = "Task cancelled"): Promise<TaskRecord | null> {
    return this.update(taskId, (item) => {
      item.status = "cancelled";
      item.completedAt = new Date().toISOString();
      item.error = reason;
      item.cancelRequested = true;
      item.waitingApprovalId = undefined;
      item.waitingToolId = undefined;
    });
  }

  async requestCancel(taskId: string): Promise<TaskRecord | null> {
    await this.acquireWriteLock();
    try {
      const items = await this.list();
      const item = items.find((entry) => entry.taskId === taskId);
      if (!item || !["pending", "running", "waiting_approval", "paused"].includes(item.status)) {
        return null;
      }

      if (item.status === "pending") {
        item.status = "cancelled";
        item.completedAt = new Date().toISOString();
        item.error = "Task cancelled before execution";
      } else if (item.status === "running") {
        item.cancelRequested = true;
        item.error = "Cancellation requested; waiting for active step to finish";
      } else if (item.status === "waiting_approval") {
        item.status = "cancelled";
        item.completedAt = new Date().toISOString();
        item.error = "Task cancelled while waiting for approval";
      }
      item.updatedAt = new Date().toISOString();
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(items, null, 2), "utf8");
      return item;
    } finally {
      this.releaseWriteLock();
    }
  }

  async createRetry(
    taskId: string,
    newTaskId: string,
    options: { force?: boolean } = {}
  ): Promise<TaskRecord | null> {
    await this.acquireWriteLock();
    try {
      const items = await this.list();
      const item = items.find((entry) => entry.taskId === taskId);
      if (!item) return null;

      const retryCount = item.retryCount + 1;
      if (!options.force && retryCount > item.maxRetries) return null;

      const retryRecord: TaskRecord = {
        taskId: newTaskId,
        goal: item.goal,
        source: item.source,
        automationId: item.automationId,
        automationName: item.automationName,
        taskType: item.taskType,
        outputFormat: item.outputFormat,
        attachments: item.attachments,
        modelOverrides: item.modelOverrides,
        status: "pending",
        createdAt: new Date().toISOString(),
        retryCount,
        maxRetries: Math.max(item.maxRetries, retryCount),
        parentTaskId: item.parentTaskId ?? item.taskId,
        projectId: item.projectId,
        projectDirectory: item.projectDirectory,
        priority: item.priority,
        assignedRole: item.assignedRole,
        executionMode: item.executionMode,
        collaborationMode: item.collaborationMode,
        modeTrigger: item.modeTrigger,
      };

      item.retriedByTaskId = newTaskId;
      item.updatedAt = new Date().toISOString();
      items.push(retryRecord);
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(items, null, 2), "utf8");
      return retryRecord;
    } finally {
      this.releaseWriteLock();
    }
  }

  async createReplay(
    taskId: string,
    newTaskId: string,
    replayGoal: string
  ): Promise<TaskRecord | null> {
    await this.acquireWriteLock();
    try {
      const items = await this.list();
      const item = items.find((entry) => entry.taskId === taskId);
      if (!item || item.status !== "failed" || item.replayedByTaskId) return null;

      const replayRecord: TaskRecord = {
        taskId: newTaskId,
        goal: replayGoal,
        source: item.source,
        automationId: item.automationId,
        automationName: item.automationName,
        taskType: item.taskType,
        outputFormat: item.outputFormat,
        attachments: item.attachments,
        modelOverrides: item.modelOverrides,
        status: "pending",
        createdAt: new Date().toISOString(),
        retryCount: 0,
        maxRetries: item.maxRetries,
        parentTaskId: item.parentTaskId ?? item.taskId,
        replayOfTaskId: item.taskId,
        projectId: item.projectId,
        projectDirectory: item.projectDirectory,
        priority: item.priority,
        assignedRole: item.assignedRole,
        executionMode: item.executionMode,
        collaborationMode: item.collaborationMode,
        modeTrigger: item.modeTrigger,
      };

      item.replayedByTaskId = newTaskId;
      item.updatedAt = new Date().toISOString();
      items.push(replayRecord);
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(items, null, 2), "utf8");
      return replayRecord;
    } finally {
      this.releaseWriteLock();
    }
  }

  async getRetryCandidate(taskId: string): Promise<TaskRecord | undefined> {
    const item = await this.get(taskId);
    if (!item || item.retryCount >= item.maxRetries) {
      return undefined;
    }
    return item;
  }

  async markInterruptedRunningTasks(): Promise<number> {
    await this.acquireWriteLock();
    try {
      const items = await this.list();
      let changed = 0;

      for (const item of items) {
        if (item.status === "running") {
          item.status = "failed";
          item.completedAt = new Date().toISOString();
          item.error = "Task interrupted by service restart";
          item.cancelRequested = false;
          changed += 1;
        } else if (item.status === "waiting_approval") {
          item.error = item.error ?? "Still waiting for approval after service restart";
        }
      }

      if (changed > 0) {
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, JSON.stringify(items, null, 2), "utf8");
      }

      return changed;
    } finally {
      this.releaseWriteLock();
    }
  }

  async getPendingTasks(): Promise<TaskRecord[]> {
    const items = await this.list();
    return items
      .filter((item) => item.status === "pending")
      .sort((a, b) => {
        // Higher priority first
        const pa = a.priority ?? 0;
        const pb = b.priority ?? 0;
        if (pa !== pb) return pb - pa;
        // Then FIFO within same priority
        return a.createdAt.localeCompare(b.createdAt);
      });
  }

  async getStats(): Promise<{
    total: number;
    pending: number;
    running: number;
    waitingApproval: number;
    completed: number;
    failed: number;
    cancelled: number;
    paused: number;
  }> {
    const items = await this.list();
    return {
      total: items.length,
      pending: items.filter((item) => item.status === "pending").length,
      running: items.filter((item) => item.status === "running").length,
      waitingApproval: items.filter((item) => item.status === "waiting_approval").length,
      completed: items.filter((item) => item.status === "completed").length,
      failed: items.filter((item) => item.status === "failed").length,
      cancelled: items.filter((item) => item.status === "cancelled").length,
      paused: items.filter((item) => item.status === "paused").length
    };
  }

  private async update(taskId: string, mutate: (item: TaskRecord) => void): Promise<TaskRecord | null> {
    // Hold write lock for the full read-modify-write cycle to prevent races
    await this.acquireWriteLock();
    try {
      const items = await this.list();
      const item = items.find((entry) => entry.taskId === taskId);
      if (!item) {
        return null;
      }

      mutate(item);
      item.updatedAt = new Date().toISOString();
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(items, null, 2), "utf8");
      return item;
    } finally {
      this.releaseWriteLock();
    }
  }

  private async save(items: TaskRecord[]): Promise<void> {
    await this.acquireWriteLock();
    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(this.filePath, JSON.stringify(items, null, 2), "utf8");
    } finally {
      this.releaseWriteLock();
    }
  }

  private normalize(item: Partial<TaskRecord>): TaskRecord {
    return {
      taskId: item.taskId ?? "",
      goal: item.goal ?? "",
      source: item.source ?? "manual",
      automationId: item.automationId,
      automationName: item.automationName,
      taskType: item.taskType,
      outputFormat: item.outputFormat,
      attachments: item.attachments,
      modelOverrides: item.modelOverrides,
      status: item.status ?? "pending",
      createdAt: item.createdAt ?? new Date().toISOString(),
      updatedAt: item.updatedAt,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      retryCount: item.retryCount ?? 0,
      maxRetries: item.maxRetries ?? 0,
      parentTaskId: item.parentTaskId,
      retriedByTaskId: item.retriedByTaskId,
      replayOfTaskId: item.replayOfTaskId,
      replayedByTaskId: item.replayedByTaskId,
      projectId: item.projectId,
      projectDirectory: item.projectDirectory,
      priority: item.priority ?? 0,
      assignedRole: item.assignedRole,
      cancelRequested: item.cancelRequested ?? false,
      waitingApprovalId: item.waitingApprovalId,
      waitingToolId: item.waitingToolId,
      summary: item.summary,
      artifacts: item.artifacts,
      result: item.result,
      error: item.error
    };
  }
}
