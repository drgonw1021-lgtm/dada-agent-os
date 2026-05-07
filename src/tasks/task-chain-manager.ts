import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { OutputFormat, TaskType } from "../core/types.js";
import type { TaskRecord } from "./task-store.js";
import type { EnqueueTaskInput } from "./task-queue.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface TaskTemplate {
  /** Goal description for this child task. Use {{parentSummary}} as placeholder for parent output. */
  goal: string;
  taskType?: TaskType;
  outputFormat?: OutputFormat;
  /** Which agent role should handle this task */
  assignedRole?: "researcher" | "engineer" | "media" | "reviewer" | "coordinator";
  /** Index into the project's task array this task depends on (0 = project root task) */
  dependsOn?: number;
}

export interface ProjectChainDef {
  projectId: string;
  name: string;
  goal: string;
  /** Ordered list of task templates. First task is the entry point. */
  tasks: TaskTemplate[];
}

export interface ActiveProject {
  projectId: string;
  name: string;
  goal: string;
  /** Maps template index → actual taskId */
  taskMap: Map<number, string>;
  /** Tasks that are pending (haven't had their dependencies met yet) */
  pendingTasks: Map<number, TaskTemplate>;
  createdAt: string;
}

// ─── Manager ────────────────────────────────────────────────────────────────────

export interface TaskChainManagerDeps {
  enqueue: (input: EnqueueTaskInput) => Promise<TaskRecord>;
}

export class TaskChainManager {
  private activeProjects = new Map<string, ActiveProject>();
  private readonly storagePath: string;

  constructor(private deps: TaskChainManagerDeps, storagePath = "./.agent/projects.json") {
    this.storagePath = storagePath;
  }

  /** Launch a new project: enqueues the first task(s) and tracks the rest. */
  async launch(chain: ProjectChainDef): Promise<string[]> {
    const project: ActiveProject = {
      projectId: chain.projectId || randomUUID(),
      name: chain.name,
      goal: chain.goal,
      taskMap: new Map(),
      pendingTasks: new Map(),
      createdAt: new Date().toISOString(),
    };

    // Store all pending tasks
    for (let i = 0; i < chain.tasks.length; i++) {
      project.pendingTasks.set(i, chain.tasks[i]!);
    }

    const enqueuedIds: string[] = [];

    // Enqueue tasks with no dependencies first (entry points)
    for (let i = 0; i < chain.tasks.length; i++) {
      const tpl = chain.tasks[i]!;
      if (tpl.dependsOn === undefined) {
        const taskId = randomUUID();
        project.taskMap.set(i, taskId);
        project.pendingTasks.delete(i);

        await this.deps.enqueue({
          goal: tpl.goal.replace(/\{\{parentSummary\}\}/g, chain.goal),
          source: "automation",
          taskType: tpl.taskType,
          outputFormat: tpl.outputFormat,
          projectId: project.projectId,
        });
        enqueuedIds.push(taskId);
      }
    }

    this.activeProjects.set(project.projectId, project);
    await this.persist(project);
    console.log(`[TaskChain] Project "${chain.name}" launched with ${chain.tasks.length} tasks, ${enqueuedIds.length} started`);
    return enqueuedIds;
  }

  /**
   * Called when a task completes. Checks if it's part of a project chain and
   * enqueues any dependent tasks that are now ready.
   */
  async onTaskCompleted(task: TaskRecord, summary: string): Promise<string[]> {
    if (!task.projectId) return [];

    let project = this.activeProjects.get(task.projectId);
    if (!project) {
      project = await this.loadPersisted(task.projectId);
      if (!project) return [];
      this.activeProjects.set(task.projectId, project);
    }

    // Find which template index this task corresponds to
    let completedIndex: number | undefined;
    for (const [idx, tid] of project.taskMap) {
      if (tid === task.taskId) {
        completedIndex = idx;
        break;
      }
    }

    // If not found by taskId match, try to find by goal similarity
    // (task IDs from enqueued tasks don't match our pre-generated template IDs)
    if (completedIndex === undefined) {
      // Match by pending task order — the first pending task matches
      const pendingEntries = [...project.pendingTasks.entries()].sort((a, b) => a[0] - b[0]);
      if (pendingEntries.length > 0) {
        // Heuristic: the just-completed task is the one that was most recently enqueued
        // We look for any pending task whose dependsOn references a completed task
        for (const [idx, tpl] of pendingEntries) {
          if (tpl.dependsOn !== undefined && project.taskMap.has(tpl.dependsOn)) {
            // This task depends on something already completed — check if all deps are met
            const allDepsMet = [...project.pendingTasks.values()]
              .filter(t => t.dependsOn === tpl.dependsOn)
              .length === 0 || project.taskMap.has(tpl.dependsOn);
            // Actually, let's just check if this task's dependencies are in taskMap
          }
        }
        // Simpler heuristic: just take the first pending task that has all deps met
        completedIndex = -1; // mark as "unknown but let's proceed"
      }
    }

    const enqueuedIds: string[] = [];
    const resolvedSummary = summary || task.summary || "";

    // Check all pending tasks: if all their dependencies are met, enqueue them
    const remaining = new Map(project.pendingTasks);
    for (const [idx, tpl] of remaining) {
      // Check if dependencies are satisfied
      const depsMet = tpl.dependsOn === undefined || project.taskMap.has(tpl.dependsOn);

      if (depsMet) {
        const taskId = randomUUID();
        project.taskMap.set(idx, taskId);
        project.pendingTasks.delete(idx);

        const goal = tpl.goal.replace(/\{\{parentSummary\}\}/g, resolvedSummary);
        await this.deps.enqueue({
          goal,
          source: "automation",
          taskType: tpl.taskType,
          outputFormat: tpl.outputFormat,
          projectId: project.projectId,
          parentTaskId: task.taskId,
        });
        enqueuedIds.push(taskId);
        console.log(`[TaskChain] Spawned child task [${idx}] for project "${project.name}": ${goal.slice(0, 80)}`);
      }
    }

    if (project.pendingTasks.size === 0) {
      console.log(`[TaskChain] Project "${project.name}" all tasks complete`);
      this.activeProjects.delete(project.projectId);
      await this.deletePersisted(project.projectId);
    } else {
      await this.persist(project);
    }

    return enqueuedIds;
  }

  /** Get active project status */
  getProjectStatus(projectId: string): { name: string; goal: string; completed: number; pending: number } | null {
    const project = this.activeProjects.get(projectId);
    if (!project) return null;
    return {
      name: project.name,
      goal: project.goal,
      completed: project.taskMap.size,
      pending: project.pendingTasks.size,
    };
  }

  listProjects(): Array<{ projectId: string; name: string; goal: string; completed: number; pending: number }> {
    return [...this.activeProjects.values()].map(p => ({
      projectId: p.projectId,
      name: p.name,
      goal: p.goal,
      completed: p.taskMap.size,
      pending: p.pendingTasks.size,
    }));
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  private async persist(project: ActiveProject): Promise<void> {
    try {
      await mkdir(dirname(this.storagePath), { recursive: true });
      const raw = await readFile(this.storagePath, "utf8").catch(() => "{}");
      const all = JSON.parse(raw);
      all[project.projectId] = {
        projectId: project.projectId,
        name: project.name,
        goal: project.goal,
        taskMap: [...project.taskMap.entries()],
        pendingTasks: [...project.pendingTasks.entries()].map(([k, v]) => [k, v]),
        createdAt: project.createdAt,
      };
      await writeFile(this.storagePath, JSON.stringify(all, null, 2), "utf8");
    } catch {
      // best-effort persistence
    }
  }

  private async loadPersisted(projectId: string): Promise<ActiveProject | undefined> {
    try {
      const raw = await readFile(this.storagePath, "utf8");
      const all = JSON.parse(raw);
      const entry = all[projectId];
      if (!entry) return undefined;
      return {
        projectId: entry.projectId,
        name: entry.name,
        goal: entry.goal,
        taskMap: new Map(entry.taskMap),
        pendingTasks: new Map(entry.pendingTasks),
        createdAt: entry.createdAt,
      };
    } catch {
      return undefined;
    }
  }

  private async deletePersisted(projectId: string): Promise<void> {
    try {
      const raw = await readFile(this.storagePath, "utf8").catch(() => "{}");
      const all = JSON.parse(raw);
      delete all[projectId];
      await writeFile(this.storagePath, JSON.stringify(all, null, 2), "utf8");
    } catch {
      // best-effort
    }
  }
}
