import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExecutionStep } from "../core/types.js";

export interface AuditRecord {
  taskId: string;
  at: string;
  step: ExecutionStep;
}

export interface AuditQuery {
  taskId?: string;
  tool?: string;
  action?: string;
  after?: string;
  before?: string;
  limit?: number;
  offset?: number;
}

export class AuditLog {
  private readonly records: AuditRecord[] = [];
  private filePath: string;
  private persistedCount = 0;

  constructor(filePath = "./.agent/audit.jsonl") {
    this.filePath = filePath;
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, "utf8");
      for (const line of raw.trim().split("\n")) {
        if (!line) continue;
        try {
          this.records.push(JSON.parse(line));
        } catch { /* skip corrupt lines */ }
      }
    } catch { /* no audit log yet */ }
  }

  append(taskId: string, step: ExecutionStep): void {
    const record: AuditRecord = {
      taskId,
      at: new Date().toISOString(),
      step,
    };
    this.records.push(record);
    this.flushToDisk();
  }

  /** Query audit records with filters */
  query(q: AuditQuery = {}): AuditRecord[] {
    let results = [...this.records];

    if (q.taskId) {
      results = results.filter(r => r.taskId === q.taskId);
    }
    if (q.tool) {
      results = results.filter(r => r.step.tool === q.tool);
    }
    if (q.action) {
      results = results.filter(r => r.step.action === q.action);
    }
    if (q.after) {
      results = results.filter(r => r.at >= q.after!);
    }
    if (q.before) {
      results = results.filter(r => r.at <= q.before!);
    }

    const offset = q.offset ?? 0;
    const limit = q.limit ?? 200;
    return results.slice(offset, offset + limit);
  }

  /** Get all unique task IDs that have audit entries */
  listTaskIds(): string[] {
    return [...new Set(this.records.map(r => r.taskId))];
  }

  /** Get stats for a task: tool counts, error count, phase transitions */
  getTaskStats(taskId: string): {
    totalSteps: number;
    toolsUsed: Record<string, number>;
    errors: number;
    phases: string[];
    durationMs: number;
  } {
    const entries = this.records.filter(r => r.taskId === taskId);
    const toolsUsed: Record<string, number> = {};
    let errors = 0;
    const phases: string[] = [];

    for (const entry of entries) {
      const tool = entry.step.tool;
      if (tool) {
        toolsUsed[tool] = (toolsUsed[tool] || 0) + 1;
      }
      if (entry.step.action === "error") errors++;
    }

    const times = entries.map(e => new Date(e.at).getTime());
    const durationMs = times.length >= 2
      ? Math.max(...times) - Math.min(...times)
      : 0;

    return { totalSteps: entries.length, toolsUsed, errors, phases, durationMs };
  }

  /** Export as JSON for external analysis */
  exportJSON(taskId?: string): string {
    const data = taskId
      ? this.records.filter(r => r.taskId === taskId)
      : this.records;
    return JSON.stringify(data, null, 2);
  }

  list(taskId?: string): AuditRecord[] {
    if (!taskId) return [...this.records];
    return this.records.filter(r => r.taskId === taskId);
  }

  /** Number of audit records */
  get size(): number {
    return this.records.length;
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private writeBusy = false;

  private async flushToDisk(): Promise<void> {
    const newRecords = this.records.slice(this.persistedCount);
    if (newRecords.length === 0) return;
    if (this.writeBusy) return;
    this.writeBusy = true;

    try {
      await mkdir(dirname(this.filePath), { recursive: true });
      const lines = newRecords.map(r => JSON.stringify(r)).join("\n") + "\n";
      await appendFile(this.filePath, lines, "utf8");
      this.persistedCount += newRecords.length;
    } catch { /* best-effort */ }
    finally {
      this.writeBusy = false;
    }
  }

  async flush(): Promise<void> {
    // Wait for any in-progress write, then flush remaining
    while (this.writeBusy) await new Promise(r => setTimeout(r, 5));
    await this.flushToDisk();
  }
}
