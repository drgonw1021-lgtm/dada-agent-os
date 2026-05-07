import { randomUUID } from "node:crypto";
import type { ExecutionStep } from "../core/types.js";

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface Subgoal {
  id: string;
  description: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  children: Subgoal[];
  result?: string;
  error?: string;
  retries: number;
  maxRetries: number;
  order: number;
  toolSteps?: ExecutionStep[];
}

export interface DecompositionResult {
  subgoals: Subgoal[];
  reasoning: string;
}

export interface ExecutionResult {
  subgoalId: string;
  success: boolean;
  output: string;
  toolSteps?: ExecutionStep[];
}

// ─── Planner ──────────────────────────────────────────────────────────────────────

export interface HierarchicalPlannerDeps {
  strategicPlanner: (prompt: string) => Promise<string>;
  subgoalExecutor: (goal: string, parentTaskId: string) => Promise<ExecutionResult>;
  maxRetries: number;
}

export class HierarchicalPlanner {
  constructor(private deps: HierarchicalPlannerDeps) {}

  /**
   * Decompose a high-level goal into a tree of subgoals.
   * Uses the strategic planner (reasoner model, no tools) for clean decomposition.
   */
  async decompose(goal: string, context?: string): Promise<DecompositionResult> {
    const prompt = [
      "You are a strategic AI planner. Decompose the following goal into a tree of concrete, executable subgoals.",
      "",
      "Rules:",
      "- Each subgoal MUST have a non-empty, descriptive \"description\" field. No blanks.",
      "- Each subgoal must be self-contained and independently verifiable",
      "- Leaf subgoals should be directly executable (search, write file, run command, etc.)",
      "- Parent subgoals depend on children completing first",
      "- 2-5 subgoals total. More than 5 means you're being too granular.",
      "- Order matters: later subgoals can depend on earlier ones' output",
      "- If you cannot decompose further, return a single subgoal with the original goal as description",
      "- NEVER output an empty description like \"\" or null",
      "",
      "Output format (JSON array of subgoals):",
      `[
        {
          "description": "Research X using search tools",
          "children": [],
          "dependsOn": []
        },
        {
          "description": "Write report based on research",
          "children": [],
          "dependsOn": [0]
        }
      ]`,
      "",
      context ? `Context: ${context}` : "",
      "",
      `Goal: ${goal}`,
      "",
      "Output ONLY the JSON array, no other text."
    ].filter(Boolean).join("\n");

    const raw = await this.deps.strategicPlanner(prompt);

    try {
      // Extract JSON array from response
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return { subgoals: [this.makeLeafSubgoal(goal, 0)], reasoning: raw };
      }

      const parsed = JSON.parse(jsonMatch[0]) as Array<{
        description: string;
        children?: typeof parsed;
        dependsOn?: number[];
      }>;

      const subgoals = this.buildSubgoalTree(parsed);
      return { subgoals, reasoning: raw };
    } catch (err) {
      console.warn(`[HierarchicalPlanner] Failed to parse decomposition JSON: ${err instanceof Error ? err.message : String(err)}`);
      console.warn(`[HierarchicalPlanner] Raw response (first 500 chars): ${raw.slice(0, 500)}`);
      return { subgoals: [this.makeLeafSubgoal(goal, 0)], reasoning: "Failed to parse decomposition, treating as single goal" };
    }
  }

  /**
   * Execute a subgoal tree sequentially, verifying each before proceeding.
   * GEPA-inspired: verify→retry→adjust on failure.
   */
  async execute(
    subgoals: Subgoal[],
    parentTaskId: string,
    onProgress?: (sg: Subgoal) => void
  ): Promise<Subgoal[]> {
    for (const sg of this.flattenOrdered(subgoals)) {
      sg.status = "running";
      onProgress?.(sg);

      let success = false;
      let lastError = "";

      for (let attempt = 0; attempt <= sg.maxRetries && !success; attempt++) {
        if (attempt > 0) {
          sg.retries = attempt;
          onProgress?.(sg);
        }

        try {
          const result = await this.deps.subgoalExecutor(sg.description, parentTaskId);
          success = result.success;
          if (success) {
            sg.result = result.output;
            sg.status = "done";
            if (result.toolSteps) sg.toolSteps = result.toolSteps;
          } else {
            lastError = result.output || "Subgoal execution returned failure";
            sg.error = lastError;
          }
        } catch (e: any) {
          lastError = e.message;
          sg.error = lastError;
        }
      }

      if (!success) {
        sg.status = "failed";
        sg.error = lastError;
        // Skip children of failed subgoals
        this.skipChildren(sg);
      }

      onProgress?.(sg);
    }

    return subgoals;
  }

  /**
   * Aggregate results from executed subgoals into a summary.
   */
  aggregate(subgoals: Subgoal[]): string {
    const flat = this.flattenOrdered(subgoals);
    const done = flat.filter(s => s.status === "done");
    const failed = flat.filter(s => s.status === "failed");

    let summary = `## Execution Summary\n\n`;
    summary += `- Total subgoals: ${flat.length}\n`;
    summary += `- Completed: ${done.length}\n`;
    summary += `- Failed: ${failed.length}\n\n`;

    if (done.length > 0) {
      summary += `### Completed\n\n`;
      for (const s of done) {
        const desc = s.description || "(unnamed subgoal)";
        summary += `**${desc}**\n${s.result?.substring(0, 500) || "No output"}\n\n`;
      }
    }

    if (failed.length > 0) {
      summary += `### Failed\n\n`;
      for (const s of failed) {
        const desc = s.description || "(unnamed subgoal)";
        summary += `**${desc}**\nError: ${s.error}\n\n`;
      }
    }

    return summary;
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private buildSubgoalTree(
    items: Array<{ description: string; children?: typeof items; dependsOn?: number[] }>
  ): Subgoal[] {
    return items
      .filter((item, idx) => {
        if (!item.description || item.description.trim().length === 0) {
          console.warn(`[HierarchicalPlanner] Filtering out subgoal at position ${idx} with empty description`);
          return false;
        }
        return true;
      })
      .map((item, i) => ({
        id: randomUUID(),
        description: item.description.trim(),
        status: "pending" as const,
        children: item.children ? this.buildSubgoalTree(item.children) : [],
        retries: 0,
        maxRetries: this.deps.maxRetries,
        order: i,
      }));
  }

  private makeLeafSubgoal(description: string, order: number): Subgoal {
    return {
      id: randomUUID(),
      description,
      status: "pending",
      children: [],
      retries: 0,
      maxRetries: this.deps.maxRetries,
      order,
    };
  }

  private flattenOrdered(subgoals: Subgoal[]): Subgoal[] {
    const result: Subgoal[] = [];
    for (const sg of subgoals) {
      result.push(sg);
      result.push(...this.flattenOrdered(sg.children));
    }
    result.sort((a, b) => a.order - b.order);
    return result;
  }

  private skipChildren(parent: Subgoal): void {
    for (const child of parent.children) {
      child.status = "skipped";
      this.skipChildren(child);
    }
  }
}
