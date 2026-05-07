import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface TaskFact {
  id: string;
  taskId: string;
  goal: string;
  key: string;
  value: string;
  category: "finding" | "decision" | "error" | "pattern" | "tool_usage";
  confidence: number; // 0-1
  createdAt: string;
  lastReferencedAt: string;
  referenceCount: number;
}

export interface TaskMemoryStats {
  totalFacts: number;
  byCategory: Record<string, number>;
  totalTasks: number;
}

// ─── Store ────────────────────────────────────────────────────────────────────────

export class TaskMemoryStore {
  private storePath: string;
  private facts: Map<string, TaskFact> = new Map();
  private initialized = false;

  constructor(storePath: string = "./.agent/task-memory.json") {
    this.storePath = storePath;
  }

  async initialize(): Promise<void> {
    await mkdir(join(this.storePath, ".."), { recursive: true });
    if (existsSync(this.storePath)) {
      try {
        const raw = await readFile(this.storePath, "utf8");
        const data = JSON.parse(raw) as TaskFact[];
        for (const fact of data) {
          this.facts.set(fact.id, fact);
        }
        console.log(`[TaskMemory] Loaded ${this.facts.size} facts from ${this.storePath}`);
      } catch {
        console.log(`[TaskMemory] Could not load store, starting fresh`);
      }
    }
    this.initialized = true;
  }

  async addFact(
    taskId: string,
    goal: string,
    key: string,
    value: string,
    category: TaskFact["category"] = "finding"
  ): Promise<TaskFact> {
    const fact: TaskFact = {
      id: randomUUID(),
      taskId,
      goal,
      key,
      value,
      category,
      confidence: 0.7,
      createdAt: new Date().toISOString(),
      lastReferencedAt: new Date().toISOString(),
      referenceCount: 0
    };
    this.facts.set(fact.id, fact);
    await this.persist();
    return fact;
  }

  async getFactsByTask(taskId: string): Promise<TaskFact[]> {
    return Array.from(this.facts.values())
      .filter(f => f.taskId === taskId)
      .sort((a, b) => b.referenceCount - a.referenceCount);
  }

  async getFactsByGoal(goal: string, limit = 10): Promise<TaskFact[]> {
    const goalLower = goal.toLowerCase();
    const matches = Array.from(this.facts.values())
      .filter(f => f.goal.toLowerCase().includes(goalLower) || goalLower.includes(f.goal.toLowerCase()))
      .sort((a, b) => b.referenceCount - a.referenceCount);
    return matches.slice(0, limit);
  }

  async searchFacts(query: string, limit = 10): Promise<TaskFact[]> {
    const q = query.toLowerCase();
    const matches = Array.from(this.facts.values())
      .filter(f =>
        f.key.toLowerCase().includes(q) ||
        f.value.toLowerCase().includes(q) ||
        f.goal.toLowerCase().includes(q)
      )
      .sort((a, b) => b.referenceCount - a.referenceCount);

    // Mark as referenced
    for (const f of matches.slice(0, limit)) {
      f.referenceCount++;
      f.lastReferencedAt = new Date().toISOString();
    }

    if (matches.length > 0) await this.persist();
    return matches.slice(0, limit);
  }

  /**
   * Extract key facts from execution steps and store them.
   */
  async extractFromSteps(
    taskId: string,
    goal: string,
    steps: Array<{ action: string; tool?: string; reasoning?: string; result?: unknown }>
  ): Promise<TaskFact[]> {
    const facts: TaskFact[] = [];

    for (const step of steps) {
      if (step.action === "execute" && step.tool) {
        // Record tool usage pattern
        facts.push(await this.addFact(
          taskId, goal,
          `tool:${step.tool}`,
          step.result ? JSON.stringify(step.result).substring(0, 200) : "executed",
          "tool_usage"
        ));
      }
      if (step.action === "error" && step.reasoning) {
        // Record error pattern for future avoidance
        facts.push(await this.addFact(
          taskId, goal,
          `error:${step.tool || "unknown"}`,
          step.reasoning.substring(0, 300),
          "error"
        ));
      }
      if (step.action === "done" && step.reasoning) {
        facts.push(await this.addFact(
          taskId, goal,
          "outcome",
          step.reasoning.substring(0, 300),
          "decision"
        ));
      }
    }

    return facts;
  }

  /**
   * Get relevant context from past tasks for a new goal.
   * Finds similar past goals and returns their key findings.
   */
  async getRelevantContext(goal: string, limit = 5): Promise<string> {
    const facts = await this.getFactsByGoal(goal, limit);
    if (facts.length === 0) return "";

    const entries = facts.map(f =>
      `[${f.category}] ${f.key}: ${f.value} (confidence: ${f.confidence.toFixed(1)})`
    );
    return `## Relevant Past Experience\n\n${entries.join("\n")}`;
  }

  async getStats(): Promise<TaskMemoryStats> {
    const facts = Array.from(this.facts.values());
    const taskIds = new Set(facts.map(f => f.taskId));
    const byCategory: Record<string, number> = {};
    for (const f of facts) {
      byCategory[f.category] = (byCategory[f.category] || 0) + 1;
    }
    return {
      totalFacts: facts.length,
      byCategory,
      totalTasks: taskIds.size
    };
  }

  async getRelevantPastTasks(goal: string, limit = 3): Promise<string[]> {
    const facts = await this.getFactsByGoal(goal, limit * 3);
    const taskSummaries = new Map<string, string[]>();
    for (const f of facts) {
      if (!taskSummaries.has(f.taskId)) taskSummaries.set(f.taskId, []);
      taskSummaries.get(f.taskId)!.push(`- ${f.key}: ${f.value.substring(0, 100)}`);
    }
    return Array.from(taskSummaries.entries())
      .slice(0, limit)
      .map(([taskId, entries]) => `Task ${taskId.slice(0, 8)}:\n${entries.join("\n")}`);
  }

  private async persist(): Promise<void> {
    const data = Array.from(this.facts.values());
    await writeFile(this.storePath, JSON.stringify(data, null, 2), "utf8");
  }
}
