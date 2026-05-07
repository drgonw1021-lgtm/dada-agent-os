import type { ExecutionDAG, StrategyNode } from "./strategy-engine.js";
import type { TaskResult } from "../core/types.js";

export interface PipelinePhaseResult {
  nodeId: string;
  phase: StrategyNode["phase"];
  role: string;
  success: boolean;
  summary: string;
  artifacts?: string[]; // file paths
  error?: string;
}

export interface DagPipelineOptions {
  /** Called for each phase dispatch */
  onPhaseStart?: (nodeId: string, phase: string, role: string) => void;
  /** Called when a phase completes */
  onPhaseEnd?: (nodeId: string, result: PipelinePhaseResult) => void;
  /** Executor: runs a single phase sub-task. Returns the task result. */
  executePhase: (params: {
    goal: string;
    assignedRole: string;
    preferredTools: string[];
    context: string;
    parentTaskId: string;
  }) => Promise<TaskResult>;
}

/**
 * Map a DAG phase to a worker role for task queue routing.
 */
export function phaseToRole(phase: StrategyNode["phase"]): string {
  switch (phase) {
    case "plan":       return "coordinator";
    case "collect":    return "researcher";
    case "execute":    return "engineer";
    case "synthesize": return "engineer";
    case "verify":     return "reviewer";
    case "package":    return "engineer";
  }
}

/**
 * DAG Pipeline Orchestrator
 *
 * Executes a DAG's nodes in topological order, dispatching each as a role-specific
 * sub-task. Results from earlier phases are passed as context to later phases.
 */
export class DagPipelineOrchestrator {
  constructor(private readonly options: DagPipelineOptions) {}

  async execute(
    dag: ExecutionDAG,
    goal: string,
    parentTaskId: string
  ): Promise<{ phases: PipelinePhaseResult[]; aggregatedSummary: string }> {
    const sorted = topologicalSort(dag.nodes);
    const phaseResults = new Map<string, PipelinePhaseResult>();
    let aggregatedContext = `Project goal: ${goal}`;

    for (const node of sorted) {
      // Skip if all deps produced sufficient output and this is optional
      if (node.optional && this.allDepsSufficient(node, phaseResults)) {
        phaseResults.set(node.id, {
          nodeId: node.id,
          phase: node.phase,
          role: phaseToRole(node.phase),
          success: true,
          summary: "(skipped — dependencies produced sufficient output)",
        });
        continue;
      }

      const role = phaseToRole(node.phase);
      this.options.onPhaseStart?.(node.id, node.phase, role);

      // Build context from dependency results
      const depContext = node.dependsOn
        .map((depId) => {
          const r = phaseResults.get(depId);
          return r ? `[${r.phase}] ${r.summary}` : "";
        })
        .filter(Boolean)
        .join("\n");

      const phaseGoal = this.buildPhaseGoal(node, goal, depContext);

      try {
        const result = await this.options.executePhase({
          goal: phaseGoal,
          assignedRole: role,
          preferredTools: node.preferredTools,
          context: aggregatedContext + "\n" + depContext,
          parentTaskId,
        });

        const artifactPaths = (result.artifacts ?? [])
          .map((a) => a.path)
          .filter(Boolean);

        const phaseResult: PipelinePhaseResult = {
          nodeId: node.id,
          phase: node.phase,
          role,
          success: result.success,
          summary: result.summary || result.content || "",
          artifacts: artifactPaths,
        };

        phaseResults.set(node.id, phaseResult);
        this.options.onPhaseEnd?.(node.id, phaseResult);

        if (result.success) {
          aggregatedContext += `\n\n## Phase: ${node.phase} (${node.label})\n${result.summary}`;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const failedResult: PipelinePhaseResult = {
          nodeId: node.id,
          phase: node.phase,
          role,
          success: false,
          summary: "",
          error: errorMsg,
        };
        phaseResults.set(node.id, failedResult);
        this.options.onPhaseEnd?.(node.id, failedResult);
        // Continue with remaining phases even if one fails
        aggregatedContext += `\n\n## Phase: ${node.phase} (FAILED)\nError: ${errorMsg}`;
      }
    }

    return {
      phases: [...phaseResults.values()],
      aggregatedSummary: this.aggregate(phaseResults, goal),
    };
  }

  private buildPhaseGoal(
    node: StrategyNode,
    originalGoal: string,
    depContext: string
  ): string {
    let phaseGoal = `[Phase: ${node.phase} — ${node.label}]\n${node.description}\n\n`;
    phaseGoal += `Original goal: ${originalGoal}`;
    if (depContext) {
      phaseGoal += `\n\nPrevious phase results:\n${depContext}`;
    }
    phaseGoal += `\n\nDeliverable: ${node.outputKind}`;
    if (node.preferredTools.length > 0) {
      phaseGoal += `\nPreferred tools: ${node.preferredTools.join(", ")}`;
    }
    return phaseGoal;
  }

  private allDepsSufficient(
    node: StrategyNode,
    results: Map<string, PipelinePhaseResult>
  ): boolean {
    return (
      node.dependsOn.length > 0 &&
      node.dependsOn.every((depId) => results.get(depId)?.success === true)
    );
  }

  private aggregate(
    results: Map<string, PipelinePhaseResult>,
    goal: string
  ): string {
    const entries = [...results.values()];
    const summary = entries
      .map(
        (r) =>
          `- **${r.phase}** (${r.role}): ${r.success ? "OK" : "FAILED"} — ${r.summary.slice(0, 200)}`
      )
      .join("\n");
    const allOk = entries.every((r) => r.success);
    return `# Pipeline: ${goal}\n\nStatus: ${allOk ? "All phases completed" : "Some phases failed"}\n\n${summary}`;
  }
}

/**
 * Standard Kahn's algorithm topological sort.
 */
function topologicalSort(nodes: StrategyNode[]): StrategyNode[] {
  const idToNode = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const n of nodes) {
    inDegree.set(n.id, n.dependsOn.length);
    for (const dep of n.dependsOn) {
      if (!adjacency.has(dep)) adjacency.set(dep, []);
      adjacency.get(dep)!.push(n.id);
    }
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  const sorted: StrategyNode[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = idToNode.get(id);
    if (node) sorted.push(node);
    for (const next of adjacency.get(id) ?? []) {
      const newDeg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    }
  }

  return sorted;
}
