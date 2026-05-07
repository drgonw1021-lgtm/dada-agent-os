/**
 * Thought-Tree Planner — adds depth to agent planning via tree-of-thought exploration.
 *
 * Instead of linear ReAct (one plan → execute), this generates N candidate action
 * branches, evaluates each via LLM-as-judge, selects the best, executes one action,
 * observes the real result, and re-evaluates. The tree grows lazily — only promising
 * paths are explored.
 *
 * Inspired by: Tree of Thoughts (Yao et al.), MCTS, and GEPA-style verify→retry loops.
 */

import { randomUUID } from "node:crypto";
import type { ExecutionStep, ToolCall } from "../core/types.js";

// ─── Types ──────────────────────────────────────────────────────────────────────

export interface ThoughtNode {
  id: string;
  parentId: string | null;
  /** The full plan text at this node */
  planText: string;
  /** Tool calls planned for this step */
  toolCalls: ToolCall[];
  /** Tool steps actually executed (populated after real execution) */
  executedSteps: ExecutionStep[];
  /** Children nodes (created during expansion) */
  children: ThoughtNode[];
  /** MCTS stats */
  visits: number;
  /** Cumulative score (0-1), higher = better */
  totalScore: number;
  /** Depth in tree (0 = root) */
  depth: number;
  /** Whether this node has been executed (real tool run) */
  executed: boolean;
  /** Whether execution succeeded */
  success: boolean;
  /** Error message if execution failed */
  error?: string;
}

export interface ThoughtTreeConfig {
  /** Number of candidate branches to generate per node (default 3) */
  numBranches: number;
  /** Maximum tree depth (default 4) */
  maxDepth: number;
  /** UCT exploration weight — higher = more exploration (default 1.4) */
  explorationWeight: number;
  /** Maximum total nodes in the tree (default 50) */
  maxNodes: number;
  /** Minimum score for a branch to be considered (0-1, default 0.3) */
  minScore: number;
}

export interface ThoughtTreeState {
  root: ThoughtNode;
  currentNode: ThoughtNode;
  allNodes: Map<string, ThoughtNode>;
  stats: {
    totalNodes: number;
    totalBranchesExplored: number;
    totalActionsExecuted: number;
    bestPathScore: number;
  };
}

const DEFAULT_CONFIG: ThoughtTreeConfig = {
  numBranches: 3,
  maxDepth: 4,
  explorationWeight: 1.4,
  maxNodes: 50,
  minScore: 0.3,
};

// ─── Planner ────────────────────────────────────────────────────────────────────

export class ThoughtTreePlanner {
  private config: ThoughtTreeConfig;
  private state: ThoughtTreeState | null = null;

  constructor(config: Partial<ThoughtTreeConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Initialize a new thought tree from the root goal */
  initTree(goal: string, initialPlanText: string = ""): ThoughtTreeState {
    const root: ThoughtNode = {
      id: randomUUID(),
      parentId: null,
      planText: initialPlanText || goal,
      toolCalls: [],
      executedSteps: [],
      children: [],
      visits: 1,
      totalScore: 0.5, // neutral starting score
      depth: 0,
      executed: false,
      success: true,
    };

    this.state = {
      root,
      currentNode: root,
      allNodes: new Map([[root.id, root]]),
      stats: {
        totalNodes: 1,
        totalBranchesExplored: 0,
        totalActionsExecuted: 0,
        bestPathScore: 0.5,
      },
    };

    return this.state;
  }

  getState(): ThoughtTreeState | null {
    return this.state;
  }

  /** Add a child node (candidate branch) to a parent */
  addBranch(
    parent: ThoughtNode,
    planText: string,
    toolCalls: ToolCall[]
  ): ThoughtNode {
    if (!this.state) throw new Error("Tree not initialized");

    const node: ThoughtNode = {
      id: randomUUID(),
      parentId: parent.id,
      planText,
      toolCalls,
      executedSteps: [],
      children: [],
      visits: 0,
      totalScore: 0,
      depth: parent.depth + 1,
      executed: false,
      success: true,
    };

    parent.children.push(node);
    this.state.allNodes.set(node.id, node);
    this.state.stats.totalNodes++;
    this.state.stats.totalBranchesExplored++;

    return node;
  }

  /** Record execution result for a node (backprop) */
  recordExecution(
    node: ThoughtNode,
    success: boolean,
    steps: ExecutionStep[],
    error?: string
  ): void {
    node.executed = true;
    node.success = success;
    node.executedSteps = steps;
    node.error = error;
    if (this.state) {
      this.state.stats.totalActionsExecuted++;
    }

    // Backpropagate score up the tree
    const score = success ? 0.8 : Math.max(0.1, 0.4 - (error ? 0.2 : 0));
    this.backpropagate(node, score);
  }

  /** UCB1 selection: pick the best child of a node */
  selectBestChild(node: ThoughtNode): ThoughtNode | null {
    if (node.children.length === 0) return null;

    let bestChild: ThoughtNode | null = null;
    let bestScore = -Infinity;

    for (const child of node.children) {
      if (child.visits === 0) return child; // explore unvisited nodes first

      const exploitation = child.totalScore / child.visits;
      const exploration =
        this.config.explorationWeight *
        Math.sqrt(Math.log(node.visits) / child.visits);
      const ucb = exploitation + exploration;

      if (ucb > bestScore) {
        bestScore = ucb;
        bestChild = child;
      }
    }

    return bestChild;
  }

  /** Get the best path from root to any leaf */
  getBestPath(): ThoughtNode[] {
    if (!this.state) return [];

    const path: ThoughtNode[] = [this.state.root];
    let current = this.state.root;

    while (current.children.length > 0) {
      // Pick child with highest average score
      let best: ThoughtNode | null = null;
      let bestAvg = -1;

      for (const child of current.children) {
        const avg =
          child.visits > 0 ? child.totalScore / child.visits : 0;
        if (avg > bestAvg) {
          bestAvg = avg;
          best = child;
        }
      }

      if (!best) break;
      path.push(best);
      current = best;
    }

    return path;
  }

  /** Get all executed steps along the best path */
  getBestPathSteps(): ExecutionStep[] {
    const path = this.getBestPath();
    const steps: ExecutionStep[] = [];
    for (const node of path) {
      steps.push(...node.executedSteps);
    }
    return steps;
  }

  /** Generate a summary of the tree for debugging */
  summarize(): string {
    if (!this.state) return "Tree not initialized";

    const path = this.getBestPath();
    let summary = `## Thought Tree Summary\n\n`;
    summary += `Total nodes: ${this.state.stats.totalNodes}\n`;
    summary += `Branches explored: ${this.state.stats.totalBranchesExplored}\n`;
    summary += `Actions executed: ${this.state.stats.totalActionsExecuted}\n`;
    summary += `Tree depth: ${path.length}\n\n`;

    summary += `### Best Path\n\n`;
    for (let i = 0; i < path.length; i++) {
      const node = path[i]!;
      const avgScore = node.visits > 0 ? (node.totalScore / node.visits).toFixed(2) : "N/A";
      const status = node.executed ? (node.success ? "✓" : "✗") : "○";
      summary += `${status} Node[${i}] depth=${node.depth} score=${avgScore} visits=${node.visits}\n`;
      summary += `   Plan: ${node.planText.substring(0, 100)}...\n`;
      if (node.executedSteps.length > 0) {
        const toolNames = node.executedSteps
          .filter(s => s.action === "execute" && s.tool)
          .map(s => s.tool)
          .join(", ");
        if (toolNames) summary += `   Tools: ${toolNames}\n`;
      }
      if (node.error) summary += `   Error: ${node.error}\n`;
    }

    return summary;
  }

  /** Check if we should stop exploring (budget exhausted) */
  shouldStop(): boolean {
    if (!this.state) return true;
    return this.state.stats.totalNodes >= this.config.maxNodes;
  }

  /** Check if current depth is at max */
  isAtMaxDepth(node: ThoughtNode): boolean {
    return node.depth >= this.config.maxDepth;
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private backpropagate(node: ThoughtNode, score: number): void {
    let current: ThoughtNode | null = node;

    while (current) {
      current.visits++;
      current.totalScore += score;
      // Decay score as we go up (parent gets partial credit)
      score *= 0.8;

      if (this.state && current.id !== this.state.root.id) {
        this.state.stats.bestPathScore = Math.max(
          this.state.stats.bestPathScore,
          current.totalScore / current.visits
        );
      }

      if (!current.parentId) break;
      current = this.state?.allNodes.get(current.parentId) ?? null;
    }
  }
}

// ─── Branch Generator (LLM-as-judge) ─────────────────────────────────────────────

export interface BranchEvaluation {
  planText: string;
  toolCalls: ToolCall[];
  reasoning: string;
  expectedQuality: number; // 0-10
  riskLevel: "low" | "medium" | "high";
}

/**
 * Build a prompt that asks the model to generate N candidate action sequences
 * for the current state, then parse the structured output.
 */
export function buildBranchingPrompt(
  goal: string,
  currentState: string,
  context: string,
  numBranches: number
): string {
  return [
    "You are a strategic AI planner. Given the current task state, generate multiple candidate next actions.",
    "",
    "Rules:",
    "- Generate exactly ${numBranches} distinct candidate action sequences",
    "- Each candidate must be a CONCRETE tool call (TOOL name {...}) with reasoning",
    "- Candidates should explore DIFFERENT strategies (not minor variations of the same approach)",
    "- Evaluate each candidate's expected quality (0-10) and risk level (low/medium/high)",
    "- Prefer actions that produce DELIVERABLES (files, data, reports) over pure information gathering",
    "- If previous actions have already gathered data, prefer synthesis/writing actions",
    "",
    "Output format (JSON array):",
    `[
      {
        "planText": "What this branch will accomplish",
        "toolCall": { "function": { "name": "tool.id", "arguments": "{\\"param\\":\\"value\\"}" } },
        "reasoning": "Why this is a good next step",
        "expectedQuality": 8,
        "riskLevel": "medium"
      }
    ]`,
    "",
    "Goal: " + goal,
    "",
    context ? "Context:\n" + context : "",
    "",
    "Current state: " + (currentState || "Just starting"),
    "",
    "Output ONLY the JSON array, no other text. Exactly " + numBranches + " candidates.",
  ].join("\n").replace("${numBranches}", String(numBranches));
}

/** Parse model output into branch evaluations */
export function parseBranchEvaluations(
  rawOutput: string,
  numBranches: number
): BranchEvaluation[] {
  try {
    // Extract JSON array
    const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      planText: string;
      toolCall: { function: { name: string; arguments: string } };
      reasoning: string;
      expectedQuality: number;
      riskLevel: "low" | "medium" | "high";
    }>;

    return parsed.slice(0, numBranches).map((item) => ({
      planText: item.planText || "",
      toolCalls: item.toolCall
        ? [{ id: randomUUID(), function: item.toolCall.function }]
        : [],
      reasoning: item.reasoning || "",
      expectedQuality: Math.max(0, Math.min(10, item.expectedQuality ?? 5)),
      riskLevel: item.riskLevel || "medium",
    }));
  } catch {
    return [];
  }
}

/** Score branches by expected quality, penalizing repeats and high risk */
export function scoreBranches(
  branches: BranchEvaluation[],
  executedToolNames: Set<string>
): BranchEvaluation[] {
  return branches.map((b) => {
    let score = b.expectedQuality / 10; // normalize 0-1

    // Penalize repeating already-executed tools
    const tools = b.toolCalls.map((tc) => tc.function.name);
    const repeatCount = tools.filter((t) => executedToolNames.has(t)).length;
    if (repeatCount > 0) score -= 0.2 * repeatCount;

    // Penalize high risk
    if (b.riskLevel === "high") score -= 0.15;
    if (b.riskLevel === "medium") score -= 0.05;

    // Boost branches with concrete file-writing actions
    if (tools.some((t) => t.includes("write") || t.includes("save"))) {
      score += 0.1;
    }

    return { ...b, expectedQuality: Math.round(Math.max(0, Math.min(1, score)) * 100) / 100 };
  });
}
