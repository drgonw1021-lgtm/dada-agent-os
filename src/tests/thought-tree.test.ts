import test from "node:test";
import assert from "node:assert/strict";
import {
  ThoughtTreePlanner,
  parseBranchEvaluations,
  scoreBranches,
  type BranchEvaluation,
  type ThoughtNode,
} from "../runtime/thought-tree-planner.js";

function makeToolCall(name: string, args: Record<string, unknown> = {}) {
  return { id: `call-${name}`, function: { name, arguments: JSON.stringify(args) } };
}

// ── Tree Initialization & Basic Operations ─────────────────────────────────────

test("ThoughtTreePlanner initializes with root node", async () => {
  const planner = new ThoughtTreePlanner({ maxDepth: 3, numBranches: 3 });
  const state = planner.initTree("Research AI market and write report");

  assert.ok(state.root);
  assert.equal(state.root.depth, 0);
  assert.equal(state.root.visits, 1);
  assert.equal(state.stats.totalNodes, 1);
  assert.equal(state.currentNode.id, state.root.id);
});

test("addBranch creates child node with correct parent", async () => {
  const planner = new ThoughtTreePlanner();
  const state = planner.initTree("Write code");

  const child = planner.addBranch(
    state.root,
    "Search for documentation",
    [makeToolCall("search", { query: "API docs" })]
  );

  assert.equal(child.parentId, state.root.id);
  assert.equal(child.depth, 1);
  assert.equal(state.root.children.length, 1);
  assert.equal(state.stats.totalNodes, 2);
  assert.equal(state.stats.totalBranchesExplored, 1);
});

test("recordExecution backpropagates scores up the tree", async () => {
  const planner = new ThoughtTreePlanner();
  const state = planner.initTree("Root task");

  const child1 = planner.addBranch(state.root, "Branch A", [makeToolCall("search")]);
  const child2 = planner.addBranch(state.root, "Branch B", [makeToolCall("fs.write_file")]);

  // Execute child1 successfully
  planner.recordExecution(child1, true, [
    { step: 1, action: "execute", tool: "search", reasoning: "Found data" }
  ]);

  assert.equal(child1.executed, true);
  assert.equal(child1.success, true);
  assert.ok(child1.totalScore > 0, `Expected positive score, got ${child1.totalScore}`);

  // Root should have been updated via backprop
  assert.ok(state.root.visits >= 2, `Root visits should be >=2, got ${state.root.visits}`);
  assert.ok(state.root.totalScore > 0.3, `Root totalScore should be >0.3, got ${state.root.totalScore}`);

  // Execute child2 with failure
  planner.recordExecution(child2, false, [], "Tool not found");

  assert.equal(child2.executed, true);
  assert.equal(child2.success, false);
  assert.equal(child2.error, "Tool not found");

  // Stats
  assert.equal(state.stats.totalActionsExecuted, 2);
});

// ── UCB1 Selection ────────────────────────────────────────────────────────────

test("selectBestChild picks unvisited node first", async () => {
  const planner = new ThoughtTreePlanner({ explorationWeight: 1.4 });
  const state = planner.initTree("Task");

  const child1 = planner.addBranch(state.root, "A", [makeToolCall("search")]);
  const child2 = planner.addBranch(state.root, "B", [makeToolCall("fs.write_file")]);

  // Neither visited — should return the first unvisited child
  const selected = planner.selectBestChild(state.root);
  assert.ok(selected, "Should return an unvisited child");
  assert.equal(selected!.visits, 0);
});

test("selectBestChild prefers high-score visited nodes", async () => {
  const planner = new ThoughtTreePlanner({ explorationWeight: 0.1 }); // low exploration
  const state = planner.initTree("Task");

  const child1 = planner.addBranch(state.root, "High quality", [makeToolCall("fs.write_file")]);
  const child2 = planner.addBranch(state.root, "Low quality", [makeToolCall("search")]);

  // Record high score for child1
  planner.recordExecution(child1, true, [{ step: 1, action: "execute", tool: "fs.write_file", reasoning: "" }]);
  planner.recordExecution(child1, true, [{ step: 1, action: "execute", tool: "fs.write_file", reasoning: "" }]);

  // Record low score for child2
  planner.recordExecution(child2, false, [], "error");

  const selected = planner.selectBestChild(state.root);
  assert.ok(selected);
  // With low exploration weight, exploitation should dominate
  // child1 has higher average score
  assert.equal(selected!.id, child1.id);
});

// ── Best Path ─────────────────────────────────────────────────────────────────

test("getBestPath follows highest average score", async () => {
  const planner = new ThoughtTreePlanner();
  const state = planner.initTree("Root");

  const a = planner.addBranch(state.root, "A", [makeToolCall("search")]);
  const b = planner.addBranch(state.root, "B", [makeToolCall("fs.write_file")]);

  // Branch A is better
  planner.recordExecution(a, true, [{ step: 1, action: "execute", tool: "search", reasoning: "" }]);
  planner.recordExecution(b, false, [], "fail");

  // Add children under A
  const a1 = planner.addBranch(a, "A.1", [makeToolCall("fs.write_file")]);
  const a2 = planner.addBranch(a, "A.2", [makeToolCall("code.exec")]);
  planner.recordExecution(a1, true, [{ step: 1, action: "execute", tool: "fs.write_file", reasoning: "" }]);
  planner.recordExecution(a2, false, [], "syntax error");

  const path = planner.getBestPath();
  assert.equal(path.length, 3);
  assert.equal(path[0]!.id, state.root.id);
  // A's average > B's average
  assert.equal(path[1]!.id, a.id);
  // A.1's average > A.2's average
  assert.equal(path[2]!.id, a1.id);
});

test("getBestPathSteps returns all executed steps along best path", async () => {
  const planner = new ThoughtTreePlanner();
  const state = planner.initTree("Task");

  const a = planner.addBranch(state.root, "A", [makeToolCall("search")]);
  planner.recordExecution(a, true, [
    { step: 1, action: "execute", tool: "search", reasoning: "Searched" }
  ]);

  const a1 = planner.addBranch(a, "A.1", [makeToolCall("fs.write_file")]);
  planner.recordExecution(a1, true, [
    { step: 2, action: "execute", tool: "fs.write_file", reasoning: "Wrote file" }
  ]);

  const steps = planner.getBestPathSteps();
  assert.ok(steps.length >= 2);
  const toolNames = steps.filter(s => s.tool).map(s => s.tool);
  assert.ok(toolNames.includes("search"));
  assert.ok(toolNames.includes("fs.write_file"));
});

// ── Branch Evaluation Parsing ─────────────────────────────────────────────────

test("parseBranchEvaluations extracts valid JSON from model output", async () => {
  const raw = `Here are the candidates:
[
  {
    "planText": "Search for market data first",
    "toolCall": { "function": { "name": "search", "arguments": "{\\"query\\":\\"AI market size\\"}" } },
    "reasoning": "Need data before writing",
    "expectedQuality": 8,
    "riskLevel": "low"
  },
  {
    "planText": "Write report directly from knowledge",
    "toolCall": { "function": { "name": "fs.write_file", "arguments": "{\\"path\\":\\"report.md\\",\\"content\\":\\"# Report\\"}" } },
    "reasoning": "Faster to use existing knowledge",
    "expectedQuality": 7,
    "riskLevel": "medium"
  }
]`;

  const branches = parseBranchEvaluations(raw, 3);
  assert.equal(branches.length, 2);
  assert.equal(branches[0]!.planText, "Search for market data first");
  assert.equal(branches[0]!.toolCalls[0]!.function.name, "search");
  assert.equal(branches[0]!.expectedQuality, 8);
  assert.equal(branches[1]!.toolCalls[0]!.function.name, "fs.write_file");
  assert.equal(branches[1]!.riskLevel, "medium");
});

test("parseBranchEvaluations returns empty on invalid input", async () => {
  assert.equal(parseBranchEvaluations("Random text with no JSON", 3).length, 0);
  assert.equal(parseBranchEvaluations("", 3).length, 0);
});

// ── Branch Scoring ────────────────────────────────────────────────────────────

test("scoreBranches penalizes repeat tools and boosts file-write actions", async () => {
  const branches: BranchEvaluation[] = [
    {
      planText: "Search again",
      toolCalls: [makeToolCall("search", { query: "new query" })],
      reasoning: "Try another search",
      expectedQuality: 7,
      riskLevel: "low"
    },
    {
      planText: "Write findings to file",
      toolCalls: [makeToolCall("fs.write_file", { path: "output.md", content: "data" })],
      reasoning: "Produce deliverable",
      expectedQuality: 7,
      riskLevel: "low"
    }
  ];

  const scored = scoreBranches(branches, new Set(["search"]));

  // search branch should be penalized for repeat
  assert.ok(
    scored[0]!.expectedQuality < scored[1]!.expectedQuality,
    `Expected write branch (${scored[1]!.expectedQuality}) to score higher than search repeat (${scored[0]!.expectedQuality})`
  );
});

test("scoreBranches penalizes high risk", async () => {
  const branches: BranchEvaluation[] = [
    {
      planText: "Safe action",
      toolCalls: [makeToolCall("fs.read_file", { path: "config" })],
      reasoning: "Read config",
      expectedQuality: 7,
      riskLevel: "low"
    },
    {
      planText: "Risky action",
      toolCalls: [makeToolCall("shell.exec", { command: "rm -rf /" })],
      reasoning: "Clean up",
      expectedQuality: 7,
      riskLevel: "high"
    }
  ];

  const scored = scoreBranches(branches, new Set());

  const safe = scored.find(s => s.planText === "Safe action")!;
  const risky = scored.find(s => s.planText === "Risky action")!;
  assert.ok(safe.expectedQuality > risky.expectedQuality,
    `Safe (${safe.expectedQuality}) should score higher than risky (${risky.expectedQuality})`);
});

// ── Tree Limits ────────────────────────────────────────────────────────────────

test("shouldStop returns true when maxNodes reached", async () => {
  const planner = new ThoughtTreePlanner({ maxNodes: 3 });
  const state = planner.initTree("Task");

  planner.addBranch(state.root, "A", [makeToolCall("search")]);
  planner.addBranch(state.root, "B", [makeToolCall("write")]);

  // 3 nodes total (root + 2 branches)
  assert.ok(planner.shouldStop());
});

test("isAtMaxDepth checks depth correctly", async () => {
  const planner = new ThoughtTreePlanner({ maxDepth: 2 });
  const state = planner.initTree("Task");

  const child = planner.addBranch(state.root, "A", [makeToolCall("search")]);
  assert.ok(!planner.isAtMaxDepth(child)); // depth 1 < 2

  const grandchild = planner.addBranch(child, "A.1", [makeToolCall("write")]);
  assert.ok(planner.isAtMaxDepth(grandchild)); // depth 2 >= 2
});

// ── Summarize ──────────────────────────────────────────────────────────────────

test("summarize returns tree statistics and best path", async () => {
  const planner = new ThoughtTreePlanner();
  planner.initTree("Complex multi-step task");

  const state = planner.getState()!;
  const a = planner.addBranch(state.root, "Research phase", [makeToolCall("search")]);
  planner.recordExecution(a, true, [
    { step: 1, action: "execute", tool: "search", reasoning: "Done" }
  ]);

  const summary = planner.summarize();
  assert.ok(summary.includes("Thought Tree Summary"));
  assert.ok(summary.includes("Research phase"));
  assert.ok(summary.includes("search"));
});

// ── Multiple depth tree ────────────────────────────────────────────────────────

test("deep tree with branching at multiple levels", async () => {
  const planner = new ThoughtTreePlanner({ maxDepth: 3, numBranches: 2 });
  const state = planner.initTree("Build a complete feature");

  // Level 1: two approaches
  const approach1 = planner.addBranch(state.root, "Research-first approach", [makeToolCall("search")]);
  const approach2 = planner.addBranch(state.root, "Code-first approach", [makeToolCall("code.exec")]);

  planner.recordExecution(approach1, true, [
    { step: 1, action: "execute", tool: "search", reasoning: "" }
  ]);
  planner.recordExecution(approach2, false, [], "Missing dependencies");

  // Level 2: two options under approach1
  const a1b = planner.addBranch(approach1, "Search more - leaf", [makeToolCall("search")]);
  const a1a = planner.addBranch(approach1, "Write draft", [makeToolCall("fs.write_file")]);

  planner.recordExecution(a1b, true, [
    { step: 1, action: "execute", tool: "search", reasoning: "" }
  ]);
  planner.recordExecution(a1a, true, [
    { step: 1, action: "execute", tool: "fs.write_file", reasoning: "" }
  ]);

  // Select best L2 node — a1b wins (same score, first in children list)
  const bestL2 = planner.selectBestChild(approach1);
  assert.ok(bestL2, "Should select a best child at level 2");

  // Level 3: add child to the SELECTED node (not hardcoded)
  const l3 = planner.addBranch(bestL2, "Continue from best L2 node", [makeToolCall("fs.write_file")]);
  planner.recordExecution(l3, true, [
    { step: 2, action: "execute", tool: "fs.write_file", reasoning: "" }
  ]);

  // Tree structure verification
  assert.equal(state.root.children.length, 2);
  assert.equal(approach1.children.length, 2);
  // L2 node that was selected now has a child
  assert.equal(bestL2.children.length, 1);
  assert.equal(state.stats.totalNodes, 6); // root + 2 L1 + 2 L2 + 1 L3

  const path = planner.getBestPath();
  assert.ok(path.length >= 3, `Expected >=3 nodes in best path, got ${path.length}`);

  const steps = planner.getBestPathSteps();
  assert.ok(steps.length >= 2, `Expected >=2 steps, got ${steps.length}`);
});
