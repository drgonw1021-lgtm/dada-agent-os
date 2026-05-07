import { mkdir, writeFile, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { ExecutionStep } from "../core/types.js";

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface Checkpoint {
  id: string;
  taskId: string;
  sequence: number;
  cycle: number;
  stepCounter: number;
  steps: ExecutionStep[];
  state: string;
  goal: string;
  taskType?: string;
  outputFormat?: string;
  createdAt: string;
  /** Opaque context blob for resumption */
  context: Record<string, unknown>;
}

export interface CheckpointFilter {
  taskId?: string;
  before?: string; // ISO date
  limit?: number;
}

// ─── Manager ──────────────────────────────────────────────────────────────────────

export class CheckpointManager {
  private dir: string;
  private maxCheckpointsPerTask: number;

  constructor(dir = "./.agent/checkpoints", maxCheckpointsPerTask = 20) {
    this.dir = dir;
    this.maxCheckpointsPerTask = maxCheckpointsPerTask;
  }

  async initialize(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  /** Save a checkpoint for a running task */
  async save(params: {
    taskId: string;
    cycle: number;
    stepCounter: number;
    steps: ExecutionStep[];
    state: string;
    goal: string;
    taskType?: string;
    outputFormat?: string;
    context?: Record<string, unknown>;
  }): Promise<Checkpoint> {
    await mkdir(this.dir, { recursive: true });

    const checkpoint: Checkpoint = {
      id: randomUUID(),
      taskId: params.taskId,
      sequence: Date.now(),
      cycle: params.cycle,
      stepCounter: params.stepCounter,
      steps: params.steps,
      state: params.state,
      goal: params.goal,
      taskType: params.taskType,
      outputFormat: params.outputFormat,
      createdAt: new Date().toISOString(),
      context: params.context || {},
    };

    // Write individual checkpoint
    const filePath = join(this.dir, `${params.taskId}-${checkpoint.sequence}.json`);
    await writeFile(filePath, JSON.stringify(checkpoint, null, 2), "utf8");

    // Prune old checkpoints for this task
    await this.pruneTask(params.taskId);

    return checkpoint;
  }

  /** Load the latest checkpoint for a task */
  async loadLatest(taskId: string): Promise<Checkpoint | null> {
    try {
      const entries = await readdir(this.dir, { withFileTypes: true });
      const taskEntries = entries
        .filter(e => e.isFile() && e.name.startsWith(`${taskId}-`) && e.name.endsWith(".json"))
        .sort((a, b) => b.name.localeCompare(a.name)); // newest first by sequence

      if (taskEntries.length === 0) return null;

      const raw = await readFile(join(this.dir, taskEntries[0].name), "utf8");
      return JSON.parse(raw) as Checkpoint;
    } catch {
      return null;
    }
  }

  /** List checkpoints matching the filter */
  async list(filter: CheckpointFilter = {}): Promise<Checkpoint[]> {
    try {
      const entries = await readdir(this.dir, { withFileTypes: true });
      let checkpoints: Checkpoint[] = [];

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        if (filter.taskId && !entry.name.startsWith(`${filter.taskId}-`)) continue;

        try {
          const raw = await readFile(join(this.dir, entry.name), "utf8");
          const cp = JSON.parse(raw) as Checkpoint;
          if (filter.before && cp.createdAt >= filter.before) continue;
          checkpoints.push(cp);
        } catch { /* skip corrupt */ }
      }

      checkpoints.sort((a, b) => b.sequence - a.sequence);
      if (filter.limit && filter.limit > 0) {
        checkpoints = checkpoints.slice(0, filter.limit);
      }

      return checkpoints;
    } catch {
      return [];
    }
  }

  /** List all tasks that have checkpoints (for crash recovery) */
  async listInterruptedTasks(): Promise<string[]> {
    try {
      const entries = await readdir(this.dir, { withFileTypes: true });
      const taskIds = new Set<string>();
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        // Format: {taskId}-{sequence}.json
        const dashIdx = entry.name.lastIndexOf("-");
        if (dashIdx > 0) {
          taskIds.add(entry.name.substring(0, dashIdx));
        }
      }
      return [...taskIds];
    } catch {
      return [];
    }
  }

  /** Check if a task can be resumed from a checkpoint */
  async canResume(taskId: string): Promise<boolean> {
    const cp = await this.loadLatest(taskId);
    return cp !== null && cp.stepCounter > 0;
  }

  /** Build a resume goal from the latest checkpoint */
  async buildResumeGoal(taskId: string): Promise<string | null> {
    const cp = await this.loadLatest(taskId);
    if (!cp) return null;

    const completedSteps = cp.steps.filter(s => s.action === "execute").map(s => s.tool).filter(Boolean);
    const errorSteps = cp.steps.filter(s => s.action === "error");

    let resumeGoal = `[RESUME] ${cp.goal}\n\n`;
    resumeGoal += `## Previous Progress (Cycle ${cp.cycle}, Step ${cp.stepCounter})\n`;
    resumeGoal += `- State: ${cp.state}\n`;
    resumeGoal += `- Tools already executed: ${completedSteps.join(", ") || "none"}\n`;

    if (errorSteps.length > 0) {
      resumeGoal += `- Previous errors encountered:\n`;
      for (const s of errorSteps) {
        resumeGoal += `  - ${s.tool || "unknown"}: ${s.reasoning?.substring(0, 120) || "no detail"}\n`;
      }
    }

    resumeGoal += `\n## Instructions\n`;
    resumeGoal += `Continue from where the previous execution left off. Do NOT repeat already-completed steps. `;
    resumeGoal += `Build on the existing progress to complete the original goal.`;

    return resumeGoal;
  }

  /** Delete all checkpoints for a task (e.g., after successful completion) */
  async deleteTaskCheckpoints(taskId: string): Promise<void> {
    try {
      const entries = await readdir(this.dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.startsWith(`${taskId}-`) && entry.name.endsWith(".json")) {
          await unlink(join(this.dir, entry.name));
        }
      }
    } catch { /* ignore */ }
  }

  /** Clean up old checkpoints (older than maxAgeMs) */
  async cleanup(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = Date.now() - maxAgeMs;
    let deleted = 0;

    try {
      const entries = await readdir(this.dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const filePath = join(this.dir, entry.name);
        try {
          const stat = await readFile(filePath, "utf8");
          const cp = JSON.parse(stat) as Checkpoint;
          if (new Date(cp.createdAt).getTime() < cutoff) {
            await unlink(filePath);
            deleted++;
          }
        } catch { /* skip corrupt */ }
      }
    } catch { /* ignore */ }

    return deleted;
  }

  getStats(): { totalCheckpoints: number; interruptedTasks: number } {
    // Will be populated lazily
    return { totalCheckpoints: 0, interruptedTasks: 0 };
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private async pruneTask(taskId: string): Promise<void> {
    try {
      const entries = await readdir(this.dir, { withFileTypes: true });
      const taskEntries = entries
        .filter(e => e.isFile() && e.name.startsWith(`${taskId}-`) && e.name.endsWith(".json"))
        .sort((a, b) => a.name.localeCompare(b.name)); // oldest first

      while (taskEntries.length > this.maxCheckpointsPerTask) {
        const oldest = taskEntries.shift()!;
        await unlink(join(this.dir, oldest.name));
      }
    } catch { /* ignore */ }
  }
}
