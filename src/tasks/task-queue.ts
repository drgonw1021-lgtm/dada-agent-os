import { randomUUID } from "node:crypto";
import { TaskPausedForApprovalError } from "../core/errors.js";
import type {
  OutputFormat,
  TaskArtifact,
  TaskAttachment,
  TaskModelOverrides,
  TaskResult,
  TaskType
} from "../core/types.js";

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}
import {
  buildFailureReplayGoal,
  selectFailureReplayCandidates
} from "./failure-replay.js";
import type { TaskRecord, TaskSource } from "./task-store.js";
import { TaskStore } from "./task-store.js";
import type { CheckpointManager } from "../runtime/checkpoint-manager.js";

export interface EnqueueTaskInput {
  goal: string;
  source: TaskSource;
  automationId?: string;
  automationName?: string;
  taskType?: TaskType;
  outputFormat?: OutputFormat;
  attachments?: TaskAttachment[];
  modelOverrides?: TaskModelOverrides;
  maxRetries?: number;
  retryCount?: number;
  parentTaskId?: string;
  projectId?: string;
  /** Higher = more urgent. Default 0. */
  priority?: number;
  /** Role for worker-pool routing */
  assignedRole?: "researcher" | "engineer" | "media" | "reviewer" | "coordinator";
  executionMode?: import("../core/types.js").ExecutionMode;
  collaborationMode?: import("../core/types.js").CollaborationMode;
  modeTrigger?: import("../core/types.js").ModeTrigger;
}

export interface TaskQueueOptions {
  /** Total concurrency across all roles */
  concurrency?: number;
  /** Per-role concurrency slots. Falls back to total concurrency / role count if unset. */
  roleConcurrency?: Partial<Record<string, number>>;
  /** Max concurrent tasks per project (0 = unlimited). Default 3. */
  maxConcurrentPerProject?: number;
  defaultMaxRetries?: number;
  onCompleted?: (task: TaskRecord, result: TaskResult) => Promise<TaskArtifact[]>;
  /** Checkpoint manager for crash recovery. When set, interrupted tasks resume from checkpoint instead of being marked failed. */
  checkpointManager?: CheckpointManager;
  /** Callback when a task is automatically recovered from checkpoint */
  onRecovered?: (originalTaskId: string, newTask: TaskRecord, resumeGoal: string) => void;
  /** Wall-clock timeout per task in ms. If the runner exceeds this, the task is force-failed. Default: 30 min (1800000 ms). */
  taskTimeoutMs?: number;
}

export class TaskQueue {
  private activeCount = 0;
  private activeByRole = new Map<string, number>();
  private activeByProject = new Map<string, number>();
  private pumpRunning = false;

  constructor(
    private readonly taskStore: TaskStore,
    private readonly runner: (params: {
      goal: string;
      taskId: string;
      taskLineageId: string;
      taskType?: TaskType;
      outputFormat?: OutputFormat;
      attachments?: TaskAttachment[];
      modelOverrides?: TaskModelOverrides;
      checkPause?: () => Promise<boolean>;
      checkCancel?: () => Promise<boolean>;
      projectId?: string;
      projectDirectory?: string;
      assignedRole?: string;
      executionMode?: import("../core/types.js").ExecutionMode;
      collaborationMode?: import("../core/types.js").CollaborationMode;
      modeTrigger?: import("../core/types.js").ModeTrigger;
    }) => Promise<TaskResult>,
    private readonly options: TaskQueueOptions = {}
  ) {}

  async initialize(): Promise<void> {
    // Try checkpoint-based recovery first for interrupted running tasks
    const recovered = await this.recoverInterruptedTasks();
    // Mark remaining running tasks (those without checkpoints) as failed
    const marked = await this.taskStore.markInterruptedRunningTasks();
    if (recovered > 0) {
      console.log(`[TaskQueue] Recovered ${recovered} task(s) from checkpoints`);
    }
    if (marked > 0) {
      console.log(`[TaskQueue] Marked ${marked} interrupted task(s) as failed (no checkpoint available)`);
    }
    await this.pump();
  }

  /** Attempt to recover tasks that have checkpoints saved */
  async recoverInterruptedTasks(): Promise<number> {
    const cpm = this.options.checkpointManager;
    if (!cpm) return 0;

    let recovered = 0;
    try {
      const interrupted = await cpm.listInterruptedTasks();
      const allTasks = await this.taskStore.list();
      const runningTasks = allTasks.filter(t => t.status === "running");

      for (const taskId of interrupted) {
        const task = runningTasks.find(t => t.taskId === taskId);
        if (!task) continue;

        const resumeGoal = await cpm.buildResumeGoal(taskId);
        if (!resumeGoal) continue;

        // Mark the original as failed (interrupted)
        await this.taskStore.markFailed(taskId, "Task interrupted — recovered from checkpoint");

        // Create a resume task
        const newTask = await this.taskStore.create({
          taskId: randomUUID(),
          goal: resumeGoal,
          source: task.source,
          automationId: task.automationId,
          automationName: task.automationName,
          taskType: task.taskType,
          outputFormat: task.outputFormat,
          attachments: task.attachments,
          modelOverrides: task.modelOverrides,
          retryCount: task.retryCount,
          maxRetries: task.maxRetries,
          parentTaskId: task.parentTaskId ?? task.taskId,
          projectId: task.projectId,
          projectDirectory: task.projectDirectory,
          priority: task.priority + 1, // Bump priority for recovered tasks
          assignedRole: task.assignedRole,
        });

        this.options.onRecovered?.(taskId, newTask, resumeGoal);
        recovered++;
      }
    } catch (err) {
      console.warn(`[TaskQueue] Checkpoint recovery error: ${err instanceof Error ? err.message : String(err)}`);
    }

    return recovered;
  }

  async enqueue(input: EnqueueTaskInput): Promise<TaskRecord> {
    // Reject goals with Unicode replacement characters (encoding corruption)
    if (input.goal.includes('�')) {
      throw new Error('Goal contains invalid characters (encoding corruption detected)');
    }
    const task = await this.taskStore.create({
      taskId: randomUUID(),
      goal: input.goal,
      source: input.source,
      automationId: input.automationId,
      automationName: input.automationName,
      taskType: input.taskType,
      outputFormat: input.outputFormat,
      attachments: input.attachments,
      modelOverrides: input.modelOverrides,
      retryCount: input.retryCount,
      maxRetries: input.maxRetries ?? this.options.defaultMaxRetries ?? 0,
      parentTaskId: input.parentTaskId,
      projectId: input.projectId,
      priority: input.priority,
      assignedRole: input.assignedRole,
      executionMode: input.executionMode,
      collaborationMode: input.collaborationMode,
      modeTrigger: input.modeTrigger,
    });

    await this.pump();
    return task;
  }

  async list(): Promise<TaskRecord[]> {
    return this.taskStore.list();
  }

  async get(taskId: string): Promise<TaskRecord | undefined> {
    return this.taskStore.get(taskId);
  }

  async cancel(taskId: string): Promise<TaskRecord | null> {
    return this.taskStore.requestCancel(taskId);
  }

  async pause(taskId: string): Promise<TaskRecord | null> {
    const task = await this.taskStore.get(taskId);
    if (!task || !["pending", "running"].includes(task.status)) {
      return null;
    }
    return this.taskStore.markPaused(taskId);
  }

  async resume(taskId: string): Promise<TaskRecord | null> {
    const task = await this.taskStore.get(taskId);
    if (!task || task.status !== "paused") {
      return null;
    }
    const resumed = await this.taskStore.markResumed(taskId);
    if (resumed) {
      await this.pump();
    }
    return resumed;
  }

  async retry(taskId: string, options: { force?: boolean } = {}): Promise<TaskRecord | null> {
    const nextTask = await this.taskStore.createRetry(taskId, randomUUID(), options);
    if (nextTask) {
      await this.pump();
    }
    return nextTask;
  }

  async replayFailed(
    taskId: string,
    options: { preferSelfImprove?: boolean } = {}
  ): Promise<TaskRecord | null> {
    const task = await this.taskStore.get(taskId);
    if (!task || task.status !== "failed") {
      return null;
    }

    const nextTask = await this.taskStore.createReplay(
      taskId,
      randomUUID(),
      buildFailureReplayGoal(task, options)
    );
    if (nextTask) {
      await this.pump();
    }
    return nextTask;
  }

  async replayFailedBatch(
    limit = 3,
    options: { preferSelfImprove?: boolean } = {}
  ): Promise<TaskRecord[]> {
    const candidates = selectFailureReplayCandidates(await this.taskStore.list(), limit);
    const replayed: TaskRecord[] = [];
    for (const candidate of candidates) {
      const task = await this.replayFailed(candidate.taskId, options);
      if (task) {
        replayed.push(task);
      }
    }
    return replayed;
  }

  private async pump(): Promise<void> {
    if (this.pumpRunning) return;
    this.pumpRunning = true;

    try {
      const totalConcurrency = Math.max(1, this.options.concurrency ?? 1);
      const maxPerProject = this.options.maxConcurrentPerProject ?? 3;

      while (this.activeCount < totalConcurrency) {
        const pending = await this.taskStore.getPendingTasks();
        if (!pending.length) break;

        // Pick the best candidate respecting role caps and per-project limits
        const slot = this.pickNextTask(pending, totalConcurrency, maxPerProject);
        if (!slot) break;

        const task = slot.task;
        this.activeCount += 1;
        const role = task.assignedRole ?? "default";
        this.activeByRole.set(role, (this.activeByRole.get(role) || 0) + 1);
        if (task.projectId) {
          this.activeByProject.set(task.projectId, (this.activeByProject.get(task.projectId) || 0) + 1);
        }

        void this.executeTask(task).finally(() => {
          this.activeCount -= 1;
          const r = task.assignedRole ?? "default";
          this.activeByRole.set(r, Math.max(0, (this.activeByRole.get(r) || 1) - 1));
          if (task.projectId) {
            this.activeByProject.set(task.projectId, Math.max(0, (this.activeByProject.get(task.projectId) || 1) - 1));
          }
          void this.pump();
        });
      }
    } finally {
      this.pumpRunning = false;
    }
  }

  /**
   * Pick the best pending task respecting:
   * 1. Role concurrency caps (if configured)
   * 2. Per-project concurrency limits
   * 3. Priority ordering (already sorted by getPendingTasks)
   */
  private pickNextTask(
    pending: TaskRecord[],
    totalConcurrency: number,
    maxPerProject: number
  ): { task: TaskRecord } | null {
    for (const task of pending) {
      // Check per-project quota
      if (task.projectId && maxPerProject > 0) {
        const activeInProject = this.activeByProject.get(task.projectId) || 0;
        if (activeInProject >= maxPerProject) continue;
      }

      // Check role concurrency
      const role = task.assignedRole ?? "default";
      const roleCap = this.getRoleCap(role, totalConcurrency);
      const activeInRole = this.activeByRole.get(role) || 0;
      if (activeInRole >= roleCap) continue;

      return { task };
    }
    return null;
  }

  private getRoleCap(role: string, totalConcurrency: number): number {
    if (this.options.roleConcurrency && role in this.options.roleConcurrency) {
      return this.options.roleConcurrency[role]!;
    }
    return totalConcurrency; // default: any role can fill any slot
  }

  private async executeTask(task: TaskRecord): Promise<void> {
    await this.taskStore.markRunning(task.taskId);
    try {
      const taskTimeout = this.options.taskTimeoutMs ?? 1_800_000; // default 30 min
      const result = await withTimeout(
        this.runner({
        goal: task.goal,
        taskId: task.taskId,
        taskLineageId: task.parentTaskId ?? task.taskId,
        taskType: task.taskType,
        outputFormat: task.outputFormat,
        attachments: task.attachments,
        modelOverrides: task.modelOverrides,
        projectId: task.projectId,
        projectDirectory: task.projectDirectory,
        assignedRole: task.assignedRole,
        executionMode: task.executionMode,
        collaborationMode: task.collaborationMode,
        modeTrigger: task.modeTrigger,
        checkPause: async () => {
          const latest = await this.taskStore.get(task.taskId);
          return latest?.status === "paused";
        },
        checkCancel: async () => {
          const latest = await this.taskStore.get(task.taskId);
          return latest?.cancelRequested === true || latest?.status === "cancelled";
        }
      }),
      taskTimeout,
      "Task"
    );
      const latest = await this.taskStore.get(task.taskId);
      if (latest?.cancelRequested) {
        if (latest.status !== "paused") {
          await this.taskStore.markCancelled(task.taskId, "Task cancelled after active step finished");
        }
        return;
      }
      const artifacts = this.options.onCompleted
        ? await this.options.onCompleted(task, result)
        : result.artifacts;
      result.artifacts = artifacts;

      await this.taskStore.markCompleted(task.taskId, {
        summary: result.summary,
        artifacts,
        result
      });
    } catch (error) {
      if (error instanceof TaskPausedForApprovalError) {
        await this.taskStore.markWaitingApproval(task.taskId, {
          approvalId: error.approvalId,
          toolId: error.toolId,
          reason: error.message
        });
        return;
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      await this.taskStore.markFailed(task.taskId, errorMsg);

      // Don't auto-retry timeout errors — the runner is likely still hanging
      if (errorMsg.includes('timed out')) return;

      const retryCandidate = await this.taskStore.getRetryCandidate(task.taskId);
      if (retryCandidate && !retryCandidate.cancelRequested) {
        await this.retry(task.taskId);
      }
    }
  }
}
