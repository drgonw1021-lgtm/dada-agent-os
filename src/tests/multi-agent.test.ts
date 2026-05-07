import test from "node:test";
import assert from "node:assert/strict";
import { AgentRegistry, type AgentInfo } from "../agents/agent-registry.js";
import { DelegationManager, type DelegationHandler, type DelegationAck, type DelegationResult } from "../agents/delegation-protocol.js";
import { ContextBus } from "../agents/context-bus.js";
import type { ContextMessage } from "../agents/context-bus.js";

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function makeAgent(overrides: Partial<Omit<AgentInfo, "id" | "registeredAt" | "lastHeartbeat">>): Omit<AgentInfo, "id" | "registeredAt" | "lastHeartbeat"> {
  return { name: "", role: "worker", capabilities: [] as string[], endpoint: "local://default", status: "idle" as const, maxConcurrency: 2, activeTaskCount: 0, ...overrides } as Omit<AgentInfo, "id" | "registeredAt" | "lastHeartbeat">;
}

// ── Test: AgentRegistry ─────────────────────────────────────────────────────────────

test("agent registry registers, finds, and manages agents", async () => {
  const registry = new AgentRegistry(5000);

  const planner = registry.register(makeAgent({
    name: "Planner-1", role: "planner", capabilities: ["planning", "decomposition", "task-intent"], endpoint: "local://planner-1"
  }));

  const searcher = registry.register(makeAgent({
    name: "Searcher-1", role: "specialist", capabilities: ["search", "web-fetch", "data-scraping"], endpoint: "local://searcher-1"
  }));

  const coder = registry.register(makeAgent({
    name: "Coder-1", role: "executor", capabilities: ["code", "shell", "file-write"], status: "busy" as const, endpoint: "local://coder-1", maxConcurrency: 1, activeTaskCount: 1
  }));

  assert.equal(registry.list().length, 3);

  // Find by capability
  const searchAgents = registry.findByCapability("search");
  assert.equal(searchAgents.length, 1);
  assert.equal(searchAgents[0]!.name, "Searcher-1");

  // Find by role
  const executors = registry.findByRole("executor");
  assert.equal(executors.length, 1);
  assert.equal(executors[0]!.name, "Coder-1");

  // Find best for code task
  const best = registry.findBest(["code", "shell"]);
  assert.ok(best);
  assert.equal(best!.name, "Coder-1");

  // Heartbeat
  assert.equal(registry.heartbeat({
    agentId: searcher.id, status: "busy", currentTask: "search-123", activeTaskCount: 1, timestamp: new Date().toISOString()
  }), true);

  const updated = registry.get(searcher.id);
  assert.equal(updated?.status, "busy");
  assert.equal(updated?.currentTask, "search-123");

  // Stats
  const stats = registry.getStats();
  assert.equal(stats.totalAgents, 3);
  assert.equal(stats.online, 3);
  assert.equal(stats.busy, 2); // coder + searcher after heartbeat
  assert.equal(stats.idle, 1);

  // Unregister
  assert.equal(registry.unregister(planner.id), true);
  assert.equal(registry.list().length, 2);

  registry.stop();
});

// ── Test: DelegationManager — full lifecycle ───────────────────────────────────────

test("delegation manager handles full accept-execute-complete lifecycle", async () => {
  const manager = new DelegationManager(3);
  let executionCount = 0;
  let completedCount = 0;

  const workerHandler: DelegationHandler = {
    async onDelegationRequest(req): Promise<DelegationAck> {
      return { delegationId: req.delegationId, accepted: true, agentId: "worker-1", estimatedMs: 500 };
    },
    async executeDelegatedTask(req): Promise<DelegationResult> {
      executionCount++;
      return {
        delegationId: req.delegationId, status: "completed",
        result: { output: `Executed: ${req.task.goal}`, files: ["output.md"] },
        steps: [
          { action: "search", tool: "search", output: "Found data" },
          { action: "write", tool: "fs.write_file", output: "Wrote report" }
        ],
        startedAt: req.createdAt, completedAt: new Date().toISOString(), retries: 0
      };
    },
    async onCancelDelegation() {}
  };

  manager.registerHandler("worker-1", workerHandler);

  const req = manager.createDelegation("orchestrator-1", {
    goal: "Research AI market trends", context: "Need data for a report", outputFormat: "markdown"
  }, {
    requiredCapabilities: ["search"],
    callbacks: { onCompleted: () => { completedCount++; } }
  });

  assert.ok(req.delegationId);
  assert.equal(req.fromAgentId, "orchestrator-1");

  const ack = await manager.handleIncoming("worker-1", req);
  assert.equal(ack.accepted, true);
  manager.updateAcceptance(req.delegationId, ack);

  const result = await manager.executeDelegation("worker-1", req.delegationId);
  assert.equal(result.status, "completed");
  assert.equal(executionCount, 1);
  assert.equal(completedCount, 1);
  assert.ok(result.result);
  assert.equal(result.steps!.length, 2);
});

// ── Test: DelegationManager — rejection handling ────────────────────────────────────

test("delegation manager handles rejection", async () => {
  const manager = new DelegationManager();
  let failedCount = 0;

  const busyHandler: DelegationHandler = {
    async onDelegationRequest(req): Promise<DelegationAck> {
      return { delegationId: req.delegationId, accepted: false, agentId: "busy-worker", reason: "Already at max capacity" };
    },
    async executeDelegatedTask() {
      return { delegationId: "", status: "failed", error: "never called", retries: 0 };
    },
    async onCancelDelegation() {}
  };

  manager.registerHandler("busy-worker", busyHandler);

  const req = manager.createDelegation("orchestrator-1", {
    goal: "Heavy task", context: "Requires resources"
  }, {
    callbacks: { onFailed: () => { failedCount++; } }
  });

  const ack = await manager.handleIncoming("busy-worker", req);
  assert.equal(ack.accepted, false);
  manager.updateAcceptance(req.delegationId, ack);

  const status = manager.getStatus(req.delegationId);
  assert.equal(status?.status, "rejected");
  assert.equal(failedCount, 1);
});

// ── Test: DelegationManager — retry on failure ──────────────────────────────────────

test("delegation manager retries on failure", async () => {
  const manager = new DelegationManager(2);
  let attempts = 0;

  const flakyHandler: DelegationHandler = {
    async onDelegationRequest(req): Promise<DelegationAck> {
      return { delegationId: req.delegationId, accepted: true, agentId: "flaky" };
    },
    async executeDelegatedTask(req): Promise<DelegationResult> {
      attempts++;
      if (attempts <= 2) throw new Error("Temporary failure");
      return { delegationId: req.delegationId, status: "completed", result: "Success after retry", retries: attempts - 1 };
    },
    async onCancelDelegation() {}
  };

  manager.registerHandler("flaky", flakyHandler);

  const req = manager.createDelegation("orchestrator-1", { goal: "Flaky task", context: "May fail" });
  const ack = await manager.handleIncoming("flaky", req);
  manager.updateAcceptance(req.delegationId, ack);

  const result = await manager.executeDelegation("flaky", req.delegationId);
  assert.equal(result.status, "completed");
  assert.equal(attempts, 3);
  assert.equal(result.retries, 2);
});

// ── Test: DelegationManager — timeout handling ──────────────────────────────────────

test("delegation manager times out stalled delegations", async () => {
  const manager = new DelegationManager(0);
  let failedCount = 0;

  const req = manager.createDelegation("orchestrator-1", {
    goal: "Timeout task", context: "Should timeout"
  }, {
    timeoutMs: 100,
    callbacks: { onFailed: () => { failedCount++; } }
  });

  await delay(200);

  const status = manager.getStatus(req.delegationId);
  assert.equal(status?.status, "timed_out");
  assert.equal(failedCount, 1);
});

// ── Test: ContextBus — message passing between agents ───────────────────────────────

test("context bus delivers messages and manages shared context", async () => {
  const bus = new ContextBus();

  const received: ContextMessage[] = [];
  bus.on("broadcast", (msg: ContextMessage) => {
    received.push(msg);
  });

  // Publish a knowledge share
  const msg = bus.publish({
    type: "knowledge.share",
    fromAgentId: "researcher-1",
    topic: "market-data",
    payload: { market: "AI Agent", size: "$50B", growth: "35% CAGR" }
  });

  assert.equal(received.length, 1);
  assert.equal(received[0]!.type, "knowledge.share");
  assert.equal(received[0]!.topic, "market-data");

  // Subscribe to topic
  const topicMessages: ContextMessage[] = [];
  bus.subscribe("market-data", (ctxMsg) => {
    topicMessages.push(ctxMsg);
  });

  bus.publish({
    type: "task.result",
    fromAgentId: "analyst-1",
    topic: "market-data",
    payload: { conclusion: "Strong growth opportunity" }
  });

  assert.equal(topicMessages.length, 1);
  assert.equal(topicMessages[0]!.type, "task.result");

  // Shared context
  bus.setContext("market-report", {
    title: "AI Agent Market Report 2024", data: { pages: 42, charts: 12 }
  }, "researcher-1", ["market", "report"]);

  const ctx = bus.getContext("market-report");
  assert.ok(ctx);
  assert.equal((ctx!.value as any).title, "AI Agent Market Report 2024");
  assert.equal(ctx!.version, 1);

  // Update shared context (version bump)
  bus.setContext("market-report", {
    title: "AI Agent Market Report 2024 v2", data: { pages: 45, charts: 14 }
  }, "analyst-1", ["market", "report"]);

  const ctx2 = bus.getContext("market-report");
  assert.equal(ctx2!.version, 2);
  assert.equal((ctx2!.value as any).title, "AI Agent Market Report 2024 v2");

  // Query by tag
  const marketEntries = bus.queryContext(["market"]);
  assert.equal(marketEntries.length, 1);

  // Query messages by topic
  const marketMsgs = bus.queryMessages("market-data");
  assert.equal(marketMsgs.length, 2);
});

// ── Test: Multi-agent coordination ──────────────────────────────────────────────────

test("multi-agent coordination: registry + delegation + context bus", async () => {
  const registry = new AgentRegistry(30000);
  const manager = new DelegationManager(1);
  const bus = new ContextBus();

  const planner = registry.register(makeAgent({
    name: "Orchestrator", role: "planner", capabilities: ["planning", "decomposition"], endpoint: "local://orch"
  }));

  const researcher = registry.register(makeAgent({
    name: "Researcher", role: "specialist", capabilities: ["search", "data-analysis"], endpoint: "local://research"
  }));

  const writer = registry.register(makeAgent({
    name: "Writer", role: "executor", capabilities: ["file-write", "markdown"], endpoint: "local://write"
  }));

  // Register delegation handlers for worker agents
  const researchResults: string[] = [];

  manager.registerHandler(researcher.id, {
    async onDelegationRequest(req) {
      return { delegationId: req.delegationId, accepted: true, agentId: researcher.id };
    },
    async executeDelegatedTask(req) {
      const result = `Research completed: ${req.task.goal} — found key data points`;
      researchResults.push(result);
      bus.publish({
        type: "knowledge.share", fromAgentId: researcher.id, topic: "research-findings",
        payload: { goal: req.task.goal, findings: result }
      });
      return { delegationId: req.delegationId, status: "completed", result: { findings: result }, completedAt: new Date().toISOString(), retries: 0 };
    },
    async onCancelDelegation() {}
  });

  manager.registerHandler(writer.id, {
    async onDelegationRequest(req) {
      return { delegationId: req.delegationId, accepted: true, agentId: writer.id };
    },
    async executeDelegatedTask(req) {
      return { delegationId: req.delegationId, status: "completed", result: { file: "report.md", content: `# Report\n\n${req.task.context}` }, completedAt: new Date().toISOString(), retries: 0 };
    },
    async onCancelDelegation() {}
  });

  // Orchestrator finds best agents
  const bestResearcher = registry.findBest(["search"]);
  assert.ok(bestResearcher);
  assert.equal(bestResearcher!.name, "Researcher");

  const bestWriter = registry.findBest(["file-write", "markdown"]);
  assert.ok(bestWriter);
  assert.equal(bestWriter!.name, "Writer");

  // Delegate research task
  const researchReq = manager.createDelegation(planner.id, {
    goal: "Research AI agent market size 2024", context: "Need data for executive report"
  }, { requiredCapabilities: ["search"] });

  const researchAck = await manager.handleIncoming(researcher.id, researchReq);
  manager.updateAcceptance(researchReq.delegationId, researchAck);
  const researchResult = await manager.executeDelegation(researcher.id, researchReq.delegationId);

  assert.equal(researchResult.status, "completed");
  assert.equal(researchResults.length, 1);

  // Delegate writing task
  const writeReq = manager.createDelegation(planner.id, {
    goal: "Write executive report", context: `Based on: ${researchResults[0]}`, outputFormat: "markdown"
  }, { requiredCapabilities: ["file-write"] });

  const writeAck = await manager.handleIncoming(writer.id, writeReq);
  manager.updateAcceptance(writeReq.delegationId, writeAck);
  const writeResult = await manager.executeDelegation(writer.id, writeReq.delegationId);

  assert.equal(writeResult.status, "completed");
  assert.ok(writeResult.result);

  // Verify context bus
  const findingsMsg = bus.queryMessages("research-findings");
  assert.equal(findingsMsg.length, 1);

  // Verify registry stats
  const stats = registry.getStats();
  assert.equal(stats.totalAgents, 3);
  assert.equal(stats.online, 3);

  registry.stop();
});
