import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface BusinessObjective {
  id: string;
  name: string;
  description: string;
  /** High-level success criteria the agent can verify */
  successCriteria: string[];
  /** Cron schedule for periodic execution */
  schedule: string;
  /** Sub-tasks that decompose the objective */
  subTasks: ObjectiveTask[];
  status: "active" | "paused" | "completed" | "failed";
  createdAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  totalSuccesses: number;
  /** Accumulated learnings from executions */
  learnings: string[];
  /** Latest report generated */
  latestReport?: string;
}

export interface ObjectiveTask {
  id: string;
  goal: string;
  taskType?: string;
  dependsOn?: string[];
  /** Set by the agent after execution */
  resultSummary?: string;
  lastStatus?: "completed" | "failed" | "pending";
}

export interface ObjectiveReport {
  objectiveId: string;
  objectiveName: string;
  generatedAt: string;
  period: { from: string; to: string };
  summary: string;
  taskResults: Array<{ taskId: string; goal: string; status: string; summary: string }>;
  learnings: string[];
  recommendations: string[];
}

export interface AutonomousEngineDeps {
  /** Submit a task goal for execution, return taskId */
  runTask: (goal: string, taskType?: string) => Promise<{ taskId: string; success: boolean; summary?: string }>;
  /** Cron-like scheduler: add a recurring task */
  scheduleTask: (name: string, cron: string, goal: string) => Promise<string>;
  /** Remove a scheduled task */
  removeScheduledTask: (name: string) => Promise<void>;
  /** Path to persist engine state */
  dataDir: string;
}

interface EngineState {
  objectives: BusinessObjective[];
  reports: ObjectiveReport[];
}

/**
 * AutonomousEngine drives long-running business objectives.
 * It decomposes goals into scheduled sub-tasks, tracks progress,
 * accumulates learnings, and generates periodic reports.
 */
export class AutonomousEngine {
  private state: EngineState = { objectives: [], reports: [] };
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private deps: AutonomousEngineDeps) {}

  // ── Persistence ──────────────────────────────────────────────────────

  private statePath(): string {
    return this.deps.dataDir + "/autonomous-state.json";
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.statePath(), "utf8");
      this.state = JSON.parse(raw);
    } catch {
      this.state = { objectives: [], reports: [] };
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.statePath()), { recursive: true });
    await writeFile(this.statePath(), JSON.stringify(this.state, null, 2), "utf8");
  }

  // ── Objective Management ────────────────────────────────────────────

  async createObjective(params: {
    name: string;
    description: string;
    successCriteria: string[];
    schedule: string;
  }): Promise<BusinessObjective> {
    const objective: BusinessObjective = {
      id: randomUUID(),
      name: params.name,
      description: params.description,
      successCriteria: params.successCriteria,
      schedule: params.schedule,
      subTasks: await this.decomposeObjective(params),
      status: "active",
      createdAt: new Date().toISOString(),
      runCount: 0,
      totalSuccesses: 0,
      learnings: [],
    };

    // Schedule each sub-task
    for (const task of objective.subTasks) {
      await this.deps.scheduleTask(
        `${objective.name}:${task.id.slice(0, 8)}`,
        objective.schedule,
        task.goal
      );
    }

    this.state.objectives.push(objective);
    await this.save();
    return objective;
  }

  /** Use the agent to decompose a business objective into concrete sub-tasks */
  private async decomposeObjective(params: {
    name: string;
    description: string;
    successCriteria: string[];
  }): Promise<ObjectiveTask[]> {
    // Run a one-shot decomposition task
    const decomposeGoal = [
      `[AUTO-DECOMPOSE] Business objective: ${params.name}`,
      `Description: ${params.description}`,
      `Success criteria: ${params.successCriteria.join(", ")}`,
      `Break this down into 3-6 concrete, executable sub-tasks. Each sub-task should be a single clear goal that DaDa can execute. Return ONLY a JSON array of { "goal": "...", "taskType": "..." }.`,
    ].join("\n");

    try {
      const result = await this.deps.runTask(decomposeGoal, "planning");
      if (result.summary) {
        // Try to parse JSON from result
        const jsonMatch = result.summary.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const tasks = JSON.parse(jsonMatch[0]);
          return tasks.map((t: { goal: string; taskType?: string }) => ({
            id: randomUUID(),
            goal: t.goal,
            taskType: t.taskType || "auto",
          }));
        }
      }
    } catch { /* fall through to default decomposition */ }

    // Fallback: simple decomposition
    return [
      { id: randomUUID(), goal: `Execute: ${params.name} — research phase`, taskType: "research" },
      { id: randomUUID(), goal: `Execute: ${params.name} — production phase`, taskType: "code" },
      { id: randomUUID(), goal: `Verify and report: ${params.name}`, taskType: "auto" },
    ];
  }

  getObjective(id: string): BusinessObjective | undefined {
    return this.state.objectives.find(o => o.id === id);
  }

  listObjectives(): BusinessObjective[] {
    return [...this.state.objectives];
  }

  async pauseObjective(id: string): Promise<void> {
    const obj = this.state.objectives.find(o => o.id === id);
    if (obj) {
      obj.status = "paused";
      for (const task of obj.subTasks) {
        await this.deps.removeScheduledTask(`${obj.name}:${task.id.slice(0, 8)}`);
      }
      await this.save();
    }
  }

  async resumeObjective(id: string): Promise<void> {
    const obj = this.state.objectives.find(o => o.id === id);
    if (obj) {
      obj.status = "active";
      for (const task of obj.subTasks) {
        await this.deps.scheduleTask(
          `${obj.name}:${task.id.slice(0, 8)}`,
          obj.schedule,
          task.goal
        );
      }
      await this.save();
    }
  }

  // ── Execution Tracking ──────────────────────────────────────────────

  async recordTaskResult(
    objectiveId: string,
    taskGoal: string,
    success: boolean,
    summary?: string
  ): Promise<void> {
    const obj = this.state.objectives.find(o => o.id === objectiveId);
    if (!obj) return;

    const task = obj.subTasks.find(t => t.goal === taskGoal);
    if (task) {
      task.lastStatus = success ? "completed" : "failed";
      task.resultSummary = summary;
    }

    obj.runCount++;
    if (success) obj.totalSuccesses++;

    // Extract learnings from successful runs
    if (success && summary) {
      obj.learnings.push(`[${new Date().toISOString().slice(0, 10)}] ${summary.slice(0, 200)}`);
      if (obj.learnings.length > 50) obj.learnings.shift();
    }

    // Check if all criteria met
    if (obj.totalSuccesses >= obj.subTasks.length * 3) {
      obj.status = "completed";
      obj.latestReport = await this.generateReport(obj);
    }

    await this.save();
  }

  // ── Report Generation ────────────────────────────────────────────────

  private async generateReport(obj: BusinessObjective): Promise<string> {
    const allCompleted = obj.subTasks.every(t => t.lastStatus === "completed");
    const successRate = obj.runCount > 0
      ? Math.round((obj.totalSuccesses / obj.runCount) * 100)
      : 0;

    const report: ObjectiveReport = {
      objectiveId: obj.id,
      objectiveName: obj.name,
      generatedAt: new Date().toISOString(),
      period: { from: obj.createdAt, to: new Date().toISOString() },
      summary: allCompleted
        ? `Objective "${obj.name}" completed with ${successRate}% success rate across ${obj.runCount} runs.`
        : `Objective "${obj.name}" in progress. ${obj.totalSuccesses}/${obj.runCount} runs successful.`,
      taskResults: obj.subTasks.map(t => ({
        taskId: t.id,
        goal: t.goal,
        status: t.lastStatus || "pending",
        summary: t.resultSummary || "No summary available",
      })),
      learnings: obj.learnings.slice(-10),
      recommendations: successRate < 50
        ? ["Consider simplifying the objective or adjusting success criteria."]
        : ["Objective is on track. Consider increasing frequency or expanding scope."],
    };

    this.state.reports.push(report);
    if (this.state.reports.length > 100) this.state.reports.shift();

    // Write standalone report file
    const reportPath = `${this.deps.dataDir}/report-${obj.id.slice(0, 8)}-${Date.now()}.json`;
    await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");

    return reportPath;
  }

  async generateObjectiveReport(objectiveId: string): Promise<ObjectiveReport | null> {
    const obj = this.state.objectives.find(o => o.id === objectiveId);
    if (!obj) return null;

    await this.generateReport(obj);
    return this.state.reports.find(r => r.objectiveId === objectiveId) || null;
  }

  listReports(): ObjectiveReport[] {
    return [...this.state.reports];
  }

  // ── Auto Mode ───────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;

    // Periodic state sync and stale objective detection
    this.timer = setInterval(() => {
      this.healthCheck().catch(() => {});
    }, 300_000); // every 5 min
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Check objectives for health — generate reports for completed ones, alert on failures */
  private async healthCheck(): Promise<void> {
    for (const obj of this.state.objectives) {
      if (obj.status !== "active") continue;

      // If objective has been running for 7+ days, auto-generate report
      const ageDays = (Date.now() - new Date(obj.createdAt).getTime()) / 86_400_000;
      if (ageDays >= 7 && obj.runCount > 0) {
        obj.latestReport = await this.generateReport(obj);
      }
    }
    await this.save();
  }
}
