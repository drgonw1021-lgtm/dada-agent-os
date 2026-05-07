import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

interface ScheduledTask {
  id: string;
  name: string;
  cron?: string;
  interval?: number;
  action: string;
  input: Record<string, unknown>;
  enabled: boolean;
  lastRun?: string;
  nextRun?: string;
  lastResult?: unknown;
}

export interface SchedulerInput {
  action: "add" | "remove" | "list" | "enable" | "disable" | "run" | "status";
  name?: string;
  cron?: string;
  interval?: number;
  actionName?: string;
  input?: Record<string, unknown>;
}

export interface SchedulerOutput {
  success: boolean;
  result?: unknown;
  error?: string;
}

const SCHEDULER_FILE = ".agent/scheduler.json";

function parseCronField(field: string, min: number, max: number): number[] {
  if (field === "*") {
    const result: number[] = [];
    for (let i = min; i <= max; i++) result.push(i);
    return result;
  }
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    if (isNaN(step) || step < 1) return [];
    const result: number[] = [];
    for (let i = min; i <= max; i += step) result.push(i);
    return result;
  }
  const num = parseInt(field, 10);
  if (!isNaN(num) && num >= min && num <= max) return [num];
  return [];
}

function cronMatches(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [minute, hour, dom, month, dow] = parts;
  const minutes = parseCronField(minute!, 0, 59);
  const hours = parseCronField(hour!, 0, 23);
  const doms = parseCronField(dom!, 1, 31);
  const months = parseCronField(month!, 1, 12);
  const dows = parseCronField(dow!, 0, 6);

  return (
    minutes.includes(date.getMinutes()) &&
    hours.includes(date.getHours()) &&
    doms.includes(date.getDate()) &&
    months.includes(date.getMonth() + 1) &&
    dows.includes(date.getDay())
  );
}

function computeNextRun(task: ScheduledTask, from: Date): string | undefined {
  if (task.cron) {
    const next = new Date(from.getTime() + 60000);
    next.setSeconds(0, 0);
    for (let i = 0; i < 1440; i++) {
      if (cronMatches(task.cron, next)) return next.toISOString();
      next.setMinutes(next.getMinutes() + 1);
    }
    return undefined;
  }
  if (task.interval && task.interval > 0) {
    return new Date(from.getTime() + task.interval).toISOString();
  }
  return undefined;
}

function loadTasks(): ScheduledTask[] {
  try {
    if (!existsSync(SCHEDULER_FILE)) return [];
    return JSON.parse(readFileSync(SCHEDULER_FILE, "utf-8"));
  } catch {
    return [];
  }
}

function saveTasks(tasks: ScheduledTask[]): void {
  const dir = join(".agent");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(SCHEDULER_FILE, JSON.stringify(tasks, null, 2));
}

export interface SchedulerExecutor {
  (name: string, actionName: string, input: Record<string, unknown>): Promise<unknown>;
}

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let executorRef: SchedulerExecutor | null = null;

export function createSchedulerTool(
  executor?: SchedulerExecutor
): ToolDefinition<SchedulerInput, SchedulerOutput> {
  if (executor && !schedulerTimer) {
    executorRef = executor;
    schedulerTimer = setInterval(async () => {
      const now = new Date();
      const tasks = loadTasks();
      let changed = false;

      for (const task of tasks) {
        if (!task.enabled) continue;
        if (!task.nextRun) {
          task.nextRun = computeNextRun(task, now);
          changed = true;
          continue;
        }
        if (new Date(task.nextRun) <= now) {
          try {
            const result = await executorRef!(task.name, task.action, task.input ?? {});
            task.lastResult = result;
          } catch (err) {
            task.lastResult = { error: err instanceof Error ? err.message : String(err) };
          }
          task.lastRun = now.toISOString();
          task.nextRun = computeNextRun(task, now);
          changed = true;
        }
      }

      if (changed) saveTasks(tasks);
    }, 30000); // Check every 30 seconds
  }

  return {
    id: "scheduler",
    description: "任务调度器：定时执行任务、循环任务、延迟执行。类 cron 的自动化工具，支持每分钟检查调度",
    requiredScopes: [] as PermissionScope[],
    inputSchema: {
      type: "object" as const,
      properties: {
        action: { type: "string" as const, enum: ["add", "remove", "list", "enable", "disable", "run", "status"], description: "Scheduler action" },
        name: { type: "string" as const, description: "Task name (required for add/remove/enable/disable/run)" },
        cron: { type: "string" as const, description: "Cron expression, e.g. '0 9 * * *' for daily at 9am, '*/5 * * * *' every 5 min" },
        interval: { type: "integer" as const, description: "Interval in milliseconds (alternative to cron)" },
        actionName: { type: "string" as const, description: "Name of tool/action to execute" },
        input: { type: "object" as const, description: "Input arguments for the scheduled action", additionalProperties: true }
      },
      required: ["action"]
    },
    async execute(input: SchedulerInput, _context: ToolContext): Promise<SchedulerOutput> {
      try {
        switch (input.action) {
          case "add":
            return addTask(input.name || "", input.cron, input.interval, input.actionName || "", input.input ?? {});
          case "remove":
            return removeTask(input.name || "");
          case "list":
            return listTasks();
          case "enable":
            return toggleTask(input.name || "", true);
          case "disable":
            return toggleTask(input.name || "", false);
          case "run":
            return runTask(input.name || "");
          case "status":
            return getSchedulerStatus();
          default:
            return { success: false, error: "Unknown action" };
        }
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  };
}

async function addTask(
  name: string,
  cron?: string,
  interval?: number,
  actionName?: string,
  input?: Record<string, unknown>
): Promise<SchedulerOutput> {
  if (!name) return { success: false, error: "Task name required" };

  if (cron && cron.trim().split(/\s+/).length !== 5) {
    return { success: false, error: "Invalid cron expression. Use 5-field format: minute hour day month day-of-week" };
  }

  const tasks = loadTasks();
  if (tasks.find((t) => t.name === name)) {
    return { success: false, error: "Task already exists" };
  }

  const task: ScheduledTask = {
    id: `task_${Date.now()}`,
    name,
    cron: cron?.trim(),
    interval,
    action: actionName || "manual",
    input: input ?? {},
    enabled: true
  };
  task.nextRun = computeNextRun(task, new Date());

  tasks.push(task);
  saveTasks(tasks);

  return { success: true, result: `Task "${name}" added, next run: ${task.nextRun ?? "manual only"}` };
}

async function removeTask(name: string): Promise<SchedulerOutput> {
  if (!name) return { success: false, error: "Task name required" };

  const tasks = loadTasks();
  const filtered = tasks.filter((t) => t.name !== name);

  if (tasks.length === filtered.length) {
    return { success: false, error: "Task not found" };
  }

  saveTasks(filtered);
  return { success: true, result: `Task "${name}" removed` };
}

async function listTasks(): Promise<SchedulerOutput> {
  const tasks = loadTasks();
  return {
    success: true,
    result: tasks.map((t) => ({
      name: t.name,
      schedule: t.cron || (t.interval ? `${t.interval}ms` : "manual"),
      enabled: t.enabled,
      lastRun: t.lastRun,
      nextRun: t.nextRun,
      action: t.action,
      lastResult: t.lastResult
    }))
  };
}

async function toggleTask(name: string, enabled: boolean): Promise<SchedulerOutput> {
  if (!name) return { success: false, error: "Task name required" };

  const tasks = loadTasks();
  const task = tasks.find((t) => t.name === name);

  if (!task) return { success: false, error: "Task not found" };

  task.enabled = enabled;
  if (enabled) {
    task.nextRun = computeNextRun(task, new Date());
  }
  saveTasks(tasks);

  return { success: true, result: `Task "${name}" ${enabled ? "enabled" : "disabled"}` };
}

async function runTask(name: string): Promise<SchedulerOutput> {
  if (!name) return { success: false, error: "Task name required" };

  const tasks = loadTasks();
  const task = tasks.find((t) => t.name === name);

  if (!task) return { success: false, error: "Task not found" };

  const now = new Date().toISOString();
  let result: unknown = undefined;

  if (executorRef) {
    try {
      result = await executorRef(task.name, task.action, task.input ?? {});
    } catch (err) {
      return { success: false, error: `Execution failed: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  task.lastRun = now;
  task.lastResult = result;
  task.nextRun = computeNextRun(task, new Date());
  saveTasks(tasks);

  return { success: true, result: { executedAt: now, taskResult: result } };
}

async function getSchedulerStatus(): Promise<SchedulerOutput> {
  const tasks = loadTasks();
  const enabled = tasks.filter((t) => t.enabled).length;
  const now = new Date();
  const pending = tasks.filter((t) => t.enabled && t.nextRun && new Date(t.nextRun) <= now);

  return {
    success: true,
    result: {
      total: tasks.length,
      enabled,
      disabled: tasks.length - enabled,
      pendingDue: pending.length,
      timerActive: schedulerTimer !== null
    }
  };
}

export default createSchedulerTool;
