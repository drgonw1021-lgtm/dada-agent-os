import type { TaskResult } from "../core/types.js";
import { HierarchicalPlanner, type ExecutionResult, type Subgoal } from "./hierarchical-planner.js";

export interface MasterWorkerDeps {
  /** LLM decomposer for breaking the goal into subgoals */
  strategicPlanner: (prompt: string) => Promise<string>;
  /** Executes a single subgoal as a role-specific sub-task */
  subgoalExecutor: (params: {
    goal: string;
    assignedRole: string;
    context: string;
    parentTaskId: string;
  }) => Promise<TaskResult>;
  /** LLM aggregator for combining sub-task results into a final summary */
  aggregator: (goal: string, results: SubTaskResult[]) => Promise<string>;
  /** Max retries per subgoal */
  maxRetries?: number;
}

export interface SubTaskResult {
  subgoalId: string;
  description: string;
  role: string;
  success: boolean;
  summary: string;
  error?: string;
}

export interface MasterWorkerResult {
  success: boolean;
  summary: string;
  subTasks: SubTaskResult[];
}

/**
 * Master-Worker Orchestrator
 *
 * Coordinator (Master) decomposes the goal, dispatches subgoals to role-specific
 * Worker agents, then aggregates the results. Subgoals with no cross-dependencies
 * can be dispatched concurrently.
 */
export class MasterWorkerOrchestrator {
  private readonly planner: HierarchicalPlanner;

  constructor(private readonly deps: MasterWorkerDeps) {
    this.planner = new HierarchicalPlanner({
      strategicPlanner: deps.strategicPlanner,
      subgoalExecutor: async (goal, parentTaskId) => {
        const result = await deps.subgoalExecutor({
          goal,
          assignedRole: "engineer", // default, overridden per subgoal
          context: "",
          parentTaskId,
        });
        return {
          subgoalId: "",
          success: result.success,
          output: result.summary || "",
          toolSteps: result.steps,
        };
      },
      maxRetries: deps.maxRetries ?? 1,
    });
  }

  async execute(
    goal: string,
    context: string,
    parentTaskId: string
  ): Promise<MasterWorkerResult> {
    // Step 1: Coordinator decomposes
    const decomposition = await this.planner.decompose(goal, context);
    const flatSubgoals = flattenSubgoals(decomposition.subgoals);

    // Step 2: Infer roles for each subgoal
    const subgoalsWithRoles = flatSubgoals.map((sg) => ({
      ...sg,
      role: inferRole(sg.description),
    }));

    // Step 3: Dispatch (sequential for now — future: parallel for independent subgoals)
    const results: SubTaskResult[] = [];
    let allSuccess = true;

    for (const sg of subgoalsWithRoles) {
      const depResults = results
        .map((r) => `[${r.role}] ${r.summary}`)
        .join("\n");

      try {
        const taskResult = await this.deps.subgoalExecutor({
          goal: `[Subgoal] ${sg.description}`,
          assignedRole: sg.role,
          context: `Project goal: ${goal}\n${context}\n\nPrevious results:\n${depResults}`,
          parentTaskId,
        });

        const subResult: SubTaskResult = {
          subgoalId: sg.id,
          description: sg.description,
          role: sg.role,
          success: taskResult.success,
          summary: taskResult.summary || taskResult.content || "",
          error: taskResult.success ? undefined : (taskResult as any).error,
        };
        results.push(subResult);

        if (!taskResult.success) {
          allSuccess = false;
        }
      } catch (err) {
        allSuccess = false;
        results.push({
          subgoalId: sg.id,
          description: sg.description,
          role: sg.role,
          success: false,
          summary: "",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Step 4: Coordinator aggregates
    const summary = await this.deps.aggregator(goal, results);

    return { success: allSuccess, summary, subTasks: results };
  }
}

function flattenSubgoals(subgoals: Subgoal[]): Subgoal[] {
  const flat: Subgoal[] = [];
  for (const sg of subgoals) {
    flat.push(sg);
    if (sg.children.length > 0) {
      flat.push(...flattenSubgoals(sg.children));
    }
  }
  return flat;
}

function inferRole(description: string): string {
  const lower = description.toLowerCase();
  if (/search|research|find|analyze|调研|搜索|查找|分析/.test(lower)) return "researcher";
  if (/code|implement|build|develop|写|开发|实现|编码|构建/.test(lower)) return "engineer";
  if (/test|verify|review|check|测试|验证|检查|审查/.test(lower)) return "reviewer";
  if (/media|image|video|audio|generate|图片|视频|音频|生成/.test(lower)) return "media";
  if (/plan|coordinate|orchestrate|规划|协调|编排/.test(lower)) return "coordinator";
  return "engineer"; // default
}
