/**
 * Integration tests for Phase 3 P2/P3 features:
 * - Priority queue + per-project quotas
 * - Checkpoint recovery
 * - Persistent audit log
 * - Strategy evaluator
 * - BusTransport IPC
 * - AgentMonitor health checks
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { TaskStore } from "../tasks/task-store.js";
import { TaskQueue } from "../tasks/task-queue.js";
import { AuditLog } from "../governance/audit-log.js";
import { StrategyEvaluator } from "../governance/strategy-evaluator.js";
import { CheckpointManager } from "../runtime/checkpoint-manager.js";
import { BusTransport } from "../agents/bus-transport.js";
import { AgentMonitor } from "../agents/agent-monitor.js";
import { AgentRegistry } from "../agents/agent-registry.js";
import { ContextBus } from "../agents/context-bus.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function tempDir() {
  return mkdtempSync(join(tmpdir(), "dada-p3-test-"));
}

// ─── 1. Priority Queue & Per-Project Quota ─────────────────────────────────

test("priority queue: higher priority tasks execute first", async () => {
  const dir = tempDir();
  try {
    const store = new TaskStore(join(dir, "tasks.json"));
    let executed: string[] = [];
    let startSignal: (() => void) | null = null;
    const started = new Promise<void>(r => { startSignal = r; });

    const queue = new TaskQueue(store, async (params) => {
      executed.push(params.goal);
      startSignal?.();
      // Hold the first task so others pile up in pending
      await new Promise(r => setTimeout(r, 200));
      return { taskId: params.taskId, success: true, summary: "done", steps: [] };
    }, { concurrency: 1 });

    // Enqueue all before any completes — the first enqueue triggers pump
    // But pump won't pick more until activeCount < concurrency
    // So we need to enqueue all first without waiting for pump
    await Promise.all([
      queue.enqueue({ goal: "low-prio", source: "manual", priority: 0 }),
      queue.enqueue({ goal: "urgent", source: "manual", priority: 10 }),
      queue.enqueue({ goal: "medium", source: "manual", priority: 5 }),
    ]);

    // Wait for all to finish
    await new Promise(r => setTimeout(r, 800));

    // After first task finishes, pump should pick highest priority next
    assert.equal(executed[0], "low-prio", "First enqueued starts immediately (FIFO at enqueue time)");
    // The next two should be priority-ordered by the pump
    const remaining = executed.slice(1);
    assert.equal(remaining[0], "urgent", "After first finishes, highest priority picked next");
    assert.equal(remaining[1], "medium");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("per-project quota: blocks tasks when project at capacity", async () => {
  const dir = tempDir();
  try {
    const store = new TaskStore(join(dir, "tasks.json"));
    let activeByProject = new Map<string, number>();

    const queue = new TaskQueue(store, async (params) => {
      const pid = params.projectId ?? "none";
      activeByProject.set(pid, (activeByProject.get(pid) || 0) + 1);
      // Simulate long-running task
      await new Promise(r => setTimeout(r, 300));
      return { taskId: params.taskId, success: true, summary: "done", steps: [] };
    }, { concurrency: 4, maxConcurrentPerProject: 2 });

    const pid = "project-alpha";
    await queue.enqueue({ goal: "task-1", source: "manual", projectId: pid });
    await queue.enqueue({ goal: "task-2", source: "manual", projectId: pid });
    await queue.enqueue({ goal: "task-3", source: "manual", projectId: pid });
    await queue.enqueue({ goal: "task-4", source: "manual", projectId: "project-beta" });

    // Let tasks start
    await new Promise(r => setTimeout(r, 100));

    // project-alpha should have at most 2 active
    const alphaActive = activeByProject.get(pid) ?? 0;
    assert.ok(alphaActive <= 2, `Project alpha should have <=2 active, got ${alphaActive}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 2. Checkpoint Recovery ────────────────────────────────────────────────

test("checkpoint recovery: interrupted tasks resume from checkpoint", async () => {
  const dir = tempDir();
  try {
    const ckptDir = join(dir, "checkpoints");
    const store = new TaskStore(join(dir, "tasks.json"));
    const ckpt = new CheckpointManager(ckptDir, 20);
    await ckpt.initialize();

    // Simulate a task that was running and has a checkpoint
    const taskId = randomUUID();
    await store.create({
      taskId,
      goal: "build a website",
      source: "manual",
    });
    await store.markRunning(taskId);

    // Save a checkpoint for the "running" task
    await ckpt.save({
      taskId,
      cycle: 2,
      stepCounter: 5,
      steps: [
        { step: 1, action: "execute", tool: "fs.write_file", reasoning: "Created index.html" },
        { step: 2, action: "execute", tool: "shell.exec", reasoning: "Ran npm install" },
      ],
      state: "executing",
      goal: "build a website",
    });

    // Create queue with checkpoint recovery
    let recoveredTask: string | null = null;
    const queue = new TaskQueue(store, async (params) => {
      return { taskId: params.taskId, success: true, summary: "resumed", steps: [] };
    }, {
      concurrency: 1,
      checkpointManager: ckpt,
      onRecovered: (originalId, newTask, resumeGoal) => {
        recoveredTask = newTask.taskId;
        assert.ok(resumeGoal.includes("[RESUME]"), "Resume goal should contain [RESUME] prefix");
        assert.ok(resumeGoal.includes("build a website"), "Resume goal should include original goal");
      },
    });

    await queue.initialize();

    // The original task should be marked as failed
    const original = await store.get(taskId);
    assert.equal(original?.status, "failed", "Original task should be marked failed");

    // A recovery task should have been created
    assert.ok(recoveredTask, "Should have created a recovery task");

    const recovered = await store.get(recoveredTask!);
    assert.ok(recovered, "Recovery task should exist in store");
    assert.ok(recovered!.goal.includes("[RESUME]"), "Recovery task goal should have [RESUME]");
    assert.equal(recovered!.priority, 1, "Recovered task should have bumped priority");

  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 3. Persistent Audit Log ───────────────────────────────────────────────

test("audit log: persists to JSONL and recovers on restart", async () => {
  const dir = tempDir();
  try {
    const auditPath = join(dir, "audit.jsonl");

    // First session: write records
    const audit1 = new AuditLog(auditPath);
    await audit1.initialize();
    audit1.append("task-1", { step: 1, action: "execute", tool: "fs.write_file" });
    audit1.append("task-1", { step: 2, action: "execute", tool: "shell.exec" });
    audit1.append("task-2", { step: 1, action: "error", tool: "search", reasoning: "timeout" });

    // Wait for flush to complete
    await audit1.flush();

    // Verify file exists and has content
    assert.ok(existsSync(auditPath), "Audit JSONL file should exist");
    const raw = readFileSync(auditPath, "utf8");
    const lines = raw.trim().split("\n");
    assert.ok(lines.length >= 3, `Should have at least 3 lines, got ${lines.length}`);

    // Second session: recover
    const audit2 = new AuditLog(auditPath);
    await audit2.initialize();

    assert.equal(audit2.size, 3, "Should recover all 3 records");

    // Query by taskId
    const task1Records = audit2.list("task-1");
    assert.equal(task1Records.length, 2);

    // Query by tool
    const shellRecords = audit2.query({ tool: "shell.exec" });
    assert.equal(shellRecords.length, 1);

    // getTaskStats
    const stats = audit2.getTaskStats("task-1");
    assert.equal(stats.totalSteps, 2);
    assert.equal(stats.errors, 0);
    assert.ok(stats.toolsUsed["fs.write_file"] >= 1);

    // Export
    const json = audit2.exportJSON("task-2");
    assert.ok(json.includes("timeout"), "Export should contain the error reasoning");

  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 4. Strategy Evaluator ─────────────────────────────────────────────────

test("strategy evaluator: A/B comparison picks best variant", () => {
  const evaluator = new StrategyEvaluator({ minRunsPerVariant: 2, qualityWeight: 0.8 });

  const comparison = evaluator.createComparison("research AI trends 2026", [
    { id: "v1", label: "DeepSeek V4", model: "deepseek-v4", description: "Single deep research pass" },
    { id: "v2", label: "Claude Opus", model: "claude-opus-4", description: "Multi-step chain-of-thought" },
  ]);

  // Variant 1 runs: fast but lower quality
  evaluator.recordRun(comparison.comparisonId, "v1", {
    goal: "research AI trends", startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(), success: true,
    summary: "Done", qualityScore: 0.65, durationMs: 5000, stepCount: 3, tokenCost: 0.02, errors: [],
  });
  evaluator.recordRun(comparison.comparisonId, "v1", {
    goal: "research AI trends", startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(), success: true,
    summary: "Done", qualityScore: 0.63, durationMs: 5200, stepCount: 3, tokenCost: 0.018, errors: [],
  });

  // Variant 2 runs: slower but much higher quality
  evaluator.recordRun(comparison.comparisonId, "v2", {
    goal: "research AI trends", startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(), success: true,
    summary: "Done", qualityScore: 0.92, durationMs: 12000, stepCount: 6, tokenCost: 0.05, errors: [],
  });
  evaluator.recordRun(comparison.comparisonId, "v2", {
    goal: "research AI trends", startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(), success: true,
    summary: "Done", qualityScore: 0.90, durationMs: 11500, stepCount: 5, tokenCost: 0.048, errors: [],
  });

  assert.ok(evaluator.isConfident(comparison.comparisonId), "Should be confident with 2 runs per variant");

  const winner = evaluator.getBestVariant(comparison.comparisonId);
  assert.ok(winner, "Should have a winner");
  // With qualityWeight=0.8, variant 2 (much higher quality) should win despite being slower
  assert.equal(winner!.variantId, "v2", "Higher quality variant should win with qualityWeight=0.8");

  // Verify the composite scores make sense
  const comp = evaluator.getComparison(comparison.comparisonId);
  const statsV2 = comp!.stats.find(s => s.variantId === "v2")!;
  assert.ok(statsV2.avgQualityScore > 0.88, "V2 should have high average quality");

  // Format report
  const report = evaluator.formatReport(comparison.comparisonId);
  assert.ok(report.includes("WINNER"), "Report should mark the winner");
  assert.ok(report.includes("Claude Opus"), "Report should mention winning variant name");
});

test("strategy evaluator: handles failed runs in success rate", () => {
  const evaluator = new StrategyEvaluator();

  const comparison = evaluator.createComparison("fix broken build", [
    { id: "a", label: "Auto-fix", description: "Automated fix" },
    { id: "b", label: "Manual plan", description: "Manual approach" },
  ]);

  // Variant A: 2/3 success
  evaluator.recordRun(comparison.comparisonId, "a", {
    goal: "fix build", startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(), success: true,
    summary: "Fixed", qualityScore: 0.8, durationMs: 3000, stepCount: 2, tokenCost: 0.01, errors: [],
  });
  evaluator.recordRun(comparison.comparisonId, "a", {
    goal: "fix build", startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(), success: true,
    summary: "Fixed", qualityScore: 0.75, durationMs: 3500, stepCount: 3, tokenCost: 0.012, errors: [],
  });
  evaluator.recordRun(comparison.comparisonId, "a", {
    goal: "fix build", startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(), success: false,
    summary: "Failed", qualityScore: 0.2, durationMs: 5000, stepCount: 1, tokenCost: 0.005,
    errors: ["Could not resolve dependency"],
  });

  // Variant B: 1/1 success
  evaluator.recordRun(comparison.comparisonId, "b", {
    goal: "fix build", startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(), success: true,
    summary: "Fixed", qualityScore: 0.85, durationMs: 8000, stepCount: 4, tokenCost: 0.03, errors: [],
  });

  const comp = evaluator.getComparison(comparison.comparisonId);
  const statsA = comp!.stats.find(s => s.variantId === "a")!;
  assert.ok(statsA.successRate < 1, "Variant A should have <100% success rate");
  assert.ok(statsA.successRate > 0.5, "Variant A should have >50% success rate");
});

// ─── 5. BusTransport IPC ───────────────────────────────────────────────────

test("bus transport: sends messages to inbox and polls them", async () => {
  const dir = tempDir();
  try {
    const inboxDir = join(dir, "inbox");
    const statusDir = join(dir, "status");

    const received: any[] = [];
    const transport = new BusTransport({
      inboxDir,
      statusDir,
      pollIntervalMs: 100,
      messageTtlMs: 60000,
      onMessage: (msg) => { received.push(msg); },
    });

    await transport.start();

    // Broadcast a message (writes to inbox)
    await transport.broadcast({
      type: "knowledge.share",
      fromAgentId: "agent-1",
      topic: "test.topic",
      payload: { data: "hello from proc A" },
    } as any);

    // Let the poll cycle pick it up (should NOT pick up our own message)
    await new Promise(r => setTimeout(r, 300));

    // Our own broadcast should NOT be delivered to ourselves
    assert.equal(received.length, 0, "Should not receive own messages");

    // Simulate another process writing a message
    const otherMsg = {
      id: randomUUID(),
      envelope: {
        type: "knowledge.share",
        fromAgentId: "agent-2",
        topic: "test.topic",
        payload: { data: "hello from proc B" },
      },
      sentAt: new Date().toISOString(),
      senderPid: 9999, // different PID
      retries: 0,
    };
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(inboxDir, `proc-b-${otherMsg.id}.json`), JSON.stringify(otherMsg));

    await new Promise(r => setTimeout(r, 300));

    assert.equal(received.length, 1, "Should receive message from other process");
    assert.equal(received[0].fromAgentId, "agent-2");

    // Test peer status
    const statuses = await transport.getPeerStatuses();
    assert.ok(statuses.length >= 1, "Should have at least our own status");

    // Test stale detection
    const stale = await transport.detectStalePeers(1000);
    assert.equal(stale.length, 0, "No stale peers immediately");

    await transport.stop();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 6. AgentMonitor Health Checks ─────────────────────────────────────────

test("agent monitor: detects stale agents and triggers alerts", async () => {
  const registry = new AgentRegistry();
  const contextBus = new ContextBus();

  const staleAlerts: any[] = [];
  contextBus.subscribe("agent.stale", (msg) => {
    staleAlerts.push(msg.payload);
  });

  // Register an agent with a very old heartbeat
  const agent = registry.register({
    name: "test-agent",
    role: "worker",
    capabilities: ["test"],
    status: "idle",
    endpoint: "local://test",
    maxConcurrency: 1,
    activeTaskCount: 0,
  });

  // Manually set last heartbeat to 2 minutes ago
  // We need to trick the registry — override the heartbeat via the registry's public API
  registry.heartbeat({
    agentId: agent.id,
    status: "idle",
    activeTaskCount: 0,
    timestamp: new Date(Date.now() - 120_000).toISOString(), // 2 min ago
  });

  const monitor = new AgentMonitor({
    registry,
    contextBus,
    staleThresholdMs: 30000, // 30 seconds
    checkIntervalMs: 500,
  });

  monitor.start();

  // Wait for health check to run
  await new Promise(r => setTimeout(r, 1000));

  const stale = monitor.getStaleAgents();
  assert.ok(stale.includes(agent.id), "Agent should be detected as stale");

  assert.ok(staleAlerts.length >= 1, "Should emit stale alert via context bus");

  // Test recovery
  const recovered = await monitor.attemptRecovery(agent.id);
  assert.ok(recovered, "Recovery should succeed");

  monitor.stop();
});

test("agent monitor: recovers when heartbeat resumes", async () => {
  const registry = new AgentRegistry();
  const contextBus = new ContextBus();

  const agent = registry.register({
    name: "flaky-agent",
    role: "worker",
    capabilities: ["test"],
    status: "idle",
    endpoint: "local://flaky",
    maxConcurrency: 1,
    activeTaskCount: 0,
  });

  // Set old heartbeat
  registry.heartbeat({
    agentId: agent.id,
    status: "idle", activeTaskCount: 0,
    timestamp: new Date(Date.now() - 60000).toISOString(),
  });

  const recoveredAlerts: any[] = [];
  const monitor = new AgentMonitor({
    registry,
    contextBus,
    staleThresholdMs: 30000,
    checkIntervalMs: 300,
    onRecovered: (a) => { recoveredAlerts.push(a); },
  });

  monitor.start();
  await new Promise(r => setTimeout(r, 500));
  assert.ok(monitor.getStaleAgents().includes(agent.id));

  // Send fresh heartbeat
  registry.heartbeat({
    agentId: agent.id,
    status: "idle", activeTaskCount: 0,
    timestamp: new Date().toISOString(),
  });

  await new Promise(r => setTimeout(r, 500));
  assert.equal(monitor.getStaleAgents().length, 0, "Should no longer be stale");
  assert.ok(recoveredAlerts.length >= 1, "Should fire onRecovered callback");

  monitor.stop();
});

// ─── 7. TaskStore Write Lock ────────────────────────────────────────────────

test("task store: concurrent writes do not corrupt data", async () => {
  const dir = tempDir();
  try {
    const store = new TaskStore(join(dir, "tasks.json"));

    // Create initial tasks
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const rec = await store.create({
        taskId: randomUUID(),
        goal: `task-${i}`,
        source: "manual",
        priority: i,
      });
      ids.push(rec.taskId);
    }

    // Concurrent updates to different tasks
    const updates = ids.map(async (id, i) => {
      if (i % 2 === 0) {
        await store.markRunning(id);
        await store.markCompleted(id, { summary: `done-${i}` });
      } else {
        await store.markRunning(id);
        await store.markFailed(id, `error-${i}`);
      }
    });

    await Promise.all(updates);

    // Verify all tasks are intact
    const all = await store.list();
    assert.equal(all.length, 5, "All 5 tasks should still exist");

    for (const id of ids) {
      const task = await store.get(id);
      assert.ok(task, `Task ${id} should exist`);
      assert.ok(task!.status === "completed" || task!.status === "failed", `Task should be completed or failed, got ${task!.status}`);
    }

    // Verify data integrity: no duplicate taskIds, no missing fields
    const taskIds = all.map(t => t.taskId);
    assert.equal(new Set(taskIds).size, all.length, "No duplicate task IDs");

  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
