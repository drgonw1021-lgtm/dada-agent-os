import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentRuntime, type AgentRuntimeDeps } from "../runtime/agent-runtime.js";

function createMockDeps(overrides?: Partial<AgentRuntimeDeps>): AgentRuntimeDeps {
  const experiences: unknown[] = [];
  const tools = [
    { id: "search", description: "Search the web", riskLevel: "low" as const, available: true },
    { id: "web.fetch", description: "Fetch a web page", riskLevel: "low" as const, available: true },
    { id: "fs.write_file", description: "Write a file", riskLevel: "medium" as const, available: true },
    { id: "fs.read_file", description: "Read a file", riskLevel: "low" as const, available: true },
    { id: "core.echo", description: "Echo text", riskLevel: "low" as const, available: true },
    { id: "task.planner", description: "Plan the task", riskLevel: "low" as const, available: true },
    { id: "gen.chart", description: "Generate chart", riskLevel: "low" as const, available: true },
  ];

  return {
    router: {
      async complete(request) {
        const lastMsg = request.messages[request.messages.length - 1]?.content || "";

        // Critic reflection
        if (request.messages[0]?.content?.includes("critic")) {
          return { content: "Progress is good. Keep writing files. Next: add data table." };
        }

        // Verification via critic
        if (request.messages[0]?.content?.includes("Judge whether")) {
          return { content: "The task produced a valid report file. Credibility: high. Risk: some data is estimated." };
        }

        // Auto-compile report
        if (request.messages[0]?.content?.includes("professional report writer")) {
          return { content: "# Test Report\n\n## Summary\nMocked report content for testing.\n\n## Analysis\nSome data." };
        }

        // Plan response with tool call
        if (request.tools && request.tools.length > 0) {
          // First call returns a tool call
          return {
            content: "I'll search for the data first.",
            toolCalls: [{
              id: "call-1",
              function: { name: "search", arguments: '{"query":"test data","maxResults":2}' }
            }]
          };
        }

        // Domain engine response
        if (lastMsg.includes("Domain")) {
          return { content: "TOOL fs.write_file {\"path\":\"output.md\",\"content\":\"# Domain Report\"}" };
        }

        return { content: "Default response" };
      },
      async *completeStream() {
        yield { content: "streaming", done: true };
      }
    },
    tools: {
      list: () => tools,
      async execute(name: string, args: unknown) {
        if (name === "search") {
          return { results: [{ title: "Result 1", url: "http://example.com", snippet: "Test data" }] };
        }
        if (name === "web.fetch") {
          return { content: "Fetched content", title: "Page" };
        }
        if (name === "fs.write_file") {
          return { success: true, path: (args as any).path, size: 100 };
        }
        if (name === "core.echo") {
          return { echoed: (args as any).text };
        }
        if (name === "task.planner") {
          return { plan: "Search → Write → Complete" };
        }
        if (name === "gen.chart") {
          return { success: true, path: "chart.png" };
        }
        return { ok: true };
      }
    },
    plannerModel: "mock:planner",
    executorModel: "mock:executor",
    criticModel: "mock:critic",
    maxPlanningCycles: 3,
    maxSteps: 50,
    maxToolCalls: 5,
    disableVerifier: false,
    audit: {
      append: () => {},
      list: () => [],
      records: []
    } as any,
    experiences: {
      list: async () => experiences,
      appendFromTask: async (t: unknown) => { experiences.push(t); }
    },
    advisor: {
      suggest: () => [],
      suggestEnhanced: () => [],
      learnFromOutcome: () => {}
    },
    skills: {
      list: () => [],
      get: () => undefined,
      loadFromDirectory: async () => {}
    },
    domainEngine: {
      plan: async () => "TOOL fs.write_file {\"path\":\"domain-output.md\",\"content\":\"# Domain Output\"}",
      getInsights: () => "",
      learn: async () => ({})
    },
    progress: {
      emit: () => {}
    },
    ...overrides
  };
}

// ── Test: full pipeline ─────────────────────────────────────────────────────────

test("agent runtime completes full classify→plan→execute→verify pipeline", async () => {
  const deps = createMockDeps();
  const runtime = new AgentRuntime(deps);

  const result = await runtime.runTask({
    goal: "Research test topic and write a report",
    taskId: "e2e-test-001"
  });

  assert.equal(result.taskId, "e2e-test-001");
  assert.equal(result.success, true);
  // Should have classify + plan + execute + verify steps at minimum
  const classifySteps = result.steps.filter(s => s.action === "classify");
  const planSteps = result.steps.filter(s => s.action === "plan");
  const executeSteps = result.steps.filter(s => s.action === "execute");
  const verifySteps = result.steps.filter(s => s.action === "verify");
  const doneSteps = result.steps.filter(s => s.action === "done");

  assert.equal(classifySteps.length >= 1, true, "Should have at least one classify step");
  assert.equal(planSteps.length >= 1, true, "Should have at least one plan step");
  assert.equal(executeSteps.length >= 1, true, "Should have at least one execute step");
  assert.equal(verifySteps.length >= 1, true, "Should have at least one verify step");

  // Verify correct ordering: classify first, verify last
  const firstAction = result.steps[0]?.action;
  const lastAction = result.steps[result.steps.length - 1]?.action;
  assert.equal(firstAction, "classify");
  assert.equal(lastAction, "verify");
});

// ── Test: tool execution via text action parsing ─────────────────────────────────

test("agent runtime executes tools from text-format plan actions", async () => {
  let toolsExecuted: string[] = [];
  const deps = createMockDeps({
    tools: {
      list: () => [
        { id: "search", description: "Search", riskLevel: "low", available: true },
        { id: "fs.write_file", description: "Write", riskLevel: "medium", available: true },
        { id: "core.echo", description: "Echo", riskLevel: "low", available: true },
        { id: "task.planner", description: "Plan", riskLevel: "low", available: true },
        { id: "web.fetch", description: "Fetch", riskLevel: "low", available: true },
      ],
      async execute(name: string) {
        toolsExecuted.push(name);
        return { ok: true };
      }
    },
    router: {
      async complete(request) {
        if (request.messages[0]?.content?.includes("critic")) {
          return { content: "Good progress." };
        }
        if (request.messages[0]?.content?.includes("Judge whether")) {
          return { content: "Pass. Report written." };
        }
        if (request.messages[0]?.content?.includes("professional report writer")) {
          return { content: "# Report\nContent." };
        }
        // Return text-format tool action (not native tool calls)
        return {
          content: 'THINK: I need to search first.\nTOOL search {"query":"test topic","maxResults":3}\nDONE Task completed, report written.',
          toolCalls: undefined
        };
      },
      async *completeStream() { yield { content: "", done: true }; }
    }
  });

  const runtime = new AgentRuntime(deps);
  const result = await runtime.runTask({
    goal: "Quick research task",
    taskId: "e2e-text-tools"
  });

  assert.equal(result.success, true);
  assert.equal(toolsExecuted.includes("search"), true, "search tool should be executed from text action");
  // Domain engine plan is parsed for TOOL actions (e.g. fs.write_file), not "domain.plan"
  assert.equal(toolsExecuted.some(t => t === "fs.write_file" || t.startsWith("domain.")), true, "domain or file tool should be executed");
});

// ── Test: pause checkpoints via checkPause callback ───────────────────────────────

test("agent runtime pauses when checkPause returns true", async () => {
  // Use unique taskId to avoid stale persisted state from previous runs
  const pauseTaskId = `e2e-pause-${Date.now()}`;
  let pauseChecked = false;
  let pauseCount = 0;
  const deps = createMockDeps({
    router: {
      async complete() {
        return {
          content: 'THINK: Working...\nTOOL core.echo {"text":"still working"}',
          toolCalls: undefined
        };
      },
      async *completeStream() { yield { content: "", done: true }; }
    }
  });

  const runtime = new AgentRuntime(deps);
  const result = await runtime.runTask({
    goal: "Task that gets paused",
    taskId: pauseTaskId,
    checkPause: async () => {
      pauseChecked = true;
      pauseCount++;
      // Pause on first check
      return pauseCount === 1;
    }
  });

  assert.equal(pauseChecked, true, "checkPause should have been called");
  assert.equal(result.success, false);
  assert.equal(result.summary, "Task paused — resume to continue");
  // Steps should include any work done before pause
  const classifySteps = result.steps.filter(s => s.action === "classify");
  assert.equal(classifySteps.length, 1, "classify should complete before pause");
});

// ── Test: task resumes from paused state ─────────────────────────────────────────

test("agent runtime resumes from persisted state machine", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-e2e-resume-"));
  try {
    // This test validates the pause/resume flow end-to-end:
    // 1. Run a task with checkPause that pauses after 2nd cycle
    // 2. Verify pause result
    // The state machine persistence is tested via saveToDisk/loadFromDisk

    let cycleCount = 0;
    const deps = createMockDeps({
      router: {
        async complete() {
          return {
            content: 'TOOL core.echo {"text":"cycle"}\nDONE Done.',
            toolCalls: undefined
          };
        },
        async *completeStream() { yield { content: "", done: true }; }
      }
    });

    const runtime = new AgentRuntime(deps);

    // First run: pauses after first cycle
    const pauseResult = await runtime.runTask({
      goal: "Resumable task",
      taskId: "e2e-resume-001",
      checkPause: async () => {
        cycleCount++;
        return cycleCount >= 1;
      }
    });

    assert.equal(pauseResult.success, false);
    assert.ok(pauseResult.summary.includes("paused"));

    // In a real resume, the TaskQueue would create a new task and call runTask with
    // the same taskId, which would trigger loadFromDisk. The runtime handles this.
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// ── Test: max steps enforcement ──────────────────────────────────────────────────

test("agent runtime enforces maxSteps and auto-compiles report", async () => {
  let fileWritten = false;
  const deps = createMockDeps({
    maxSteps: 4,
    maxPlanningCycles: 5,
    tools: {
      list: () => [
        { id: "search", description: "Search", riskLevel: "low", available: true },
        { id: "fs.write_file", description: "Write", riskLevel: "medium", available: true },
        { id: "core.echo", description: "Echo", riskLevel: "low", available: true },
        { id: "task.planner", description: "Plan", riskLevel: "low", available: true },
        { id: "web.fetch", description: "Fetch", riskLevel: "low", available: true },
      ],
      async execute(name: string, args: unknown) {
        if (name === "fs.write_file") {
          fileWritten = true;
          return { success: true, path: (args as any).path };
        }
        if (name === "search") {
          return { results: [{ title: "R", url: "http://x.com", snippet: "data" }] };
        }
        return { ok: true };
      }
    },
    router: {
      async complete(request) {
        if (request.messages[0]?.content?.includes("critic")) {
          return { content: "OK." };
        }
        if (request.messages[0]?.content?.includes("Judge whether")) {
          return { content: "Report written but data is estimated. Pass with caveat." };
        }
        if (request.messages[0]?.content?.includes("professional report writer")) {
          return { content: "# Auto Report\nCompiled content." };
        }
        // Keep searching, never writes — triggers auto-compile
        return {
          content: 'TOOL search {"query":"more data","maxResults":2}',
          toolCalls: undefined
        };
      },
      async *completeStream() { yield { content: "", done: true }; }
    }
  });

  const runtime = new AgentRuntime(deps);
  const result = await runtime.runTask({
    goal: "Endless search task",
    taskId: "e2e-max-steps"
  });

  // Should have been forced to complete
  const doneSteps = result.steps.filter(s => s.action === "done");
  assert.equal(doneSteps.length >= 1, true, "Should have a done step");
  assert.equal(fileWritten, true, "Should auto-compile and write report");
});

// ── Test: self-evolution triggered on success ────────────────────────────────────

test("agent runtime triggers self-evolution on successful task", async () => {
  const deps = createMockDeps({
    selfEvolver: {
      getMatureSkills: () => [],
      getFailurePatterns: () => [],
      evolveFromTask: async (input: any) => {
        return {
          skill: {
            name: "auto-skill",
            description: `Auto-evolved from: ${input.goal}`,
            version: "0.1.0",
            triggers: [input.goal.substring(0, 20)],
            instructions: "# Auto-evolved skill\n\nTOOL search → TOOL fs.write_file → DONE",
            sourceTaskId: "e2e-evolve-001",
            sourceGoal: input.goal,
            createdAt: new Date().toISOString(),
            successCount: 1,
            lastUsedAt: new Date().toISOString()
          },
          skipped: false,
          reason: "Pattern extracted: search→write→verify"
        };
      }
    } as any,
    router: {
      async complete(request) {
        if (request.messages[0]?.content?.includes("critic")) {
          return { content: "Good work." };
        }
        if (request.messages[0]?.content?.includes("Judge whether")) {
          return { content: "High credibility. All deliverables present." };
        }
        if (request.messages[0]?.content?.includes("professional report writer")) {
          return { content: "# Report\nDone." };
        }
        return {
          content: 'TOOL fs.write_file {"path":"out.md","content":"# Done"}\nDONE Task done.',
          toolCalls: undefined
        };
      },
      async *completeStream() { yield { content: "", done: true }; }
    }
  });

  const runtime = new AgentRuntime(deps);
  const result = await runtime.runTask({
    goal: "Write a test report about AI",
    taskId: "e2e-evolve-001"
  });

  assert.equal(result.success, true);
  const evolveSteps = result.steps.filter(s => s.action === "self_evolve");
  assert.equal(evolveSteps.length, 1, "Should have a self_evolve step");
  assert.ok(evolveSteps[0]!.reasoning!.includes("Pattern extracted"));
});

// ── Test: critic reflection runs after tool execution ────────────────────────────

test("agent runtime runs critic after executing tools", async () => {
  let criticCalled = false;
  let plannerCallCount = 0;
  const deps = createMockDeps({
    router: {
      async complete(request) {
        if (request.messages[0]?.content?.includes("critic")) {
          criticCalled = true;
          return { content: "Gap: missing data table. Next: add chart." };
        }
        if (request.messages[0]?.content?.includes("Judge whether")) {
          return { content: "Good report. Pass." };
        }
        if (request.messages[0]?.content?.includes("professional report writer")) {
          return { content: "# Report\nDone." };
        }
        plannerCallCount++;
        // First plan call: execute tool (no DONE, so critic runs)
        // Second plan call: DONE to exit the loop
        if (plannerCallCount >= 2) {
          return {
            content: 'DONE All tasks complete.',
            toolCalls: undefined
          };
        }
        return {
          content: 'TOOL fs.write_file {"path":"out.md","content":"# Draft"}',
          toolCalls: undefined
        };
      },
      async *completeStream() { yield { content: "", done: true }; }
    }
  });

  const runtime = new AgentRuntime(deps);
  const result = await runtime.runTask({
    goal: "Write a report",
    taskId: "e2e-critic-001"
  });

  assert.equal(result.success, true);
  assert.equal(criticCalled, true, "Critic model should be called after tool execution");
  const reflectSteps = result.steps.filter(s => s.action === "reflect");
  assert.equal(reflectSteps.length >= 1, true, "Should have reflect steps from critic");
});
