import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { SelfEvolver, EvolutionCandidate } from "./self-evolver.js";

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface BenchmarkTask {
  id: string;
  name: string;
  goal: string;
  taskType: string;
  expectedOutputPatterns: string[]; // substrings that should appear in a successful output
  maxSteps: number;
  timeoutMs: number;
  tags: string[];
}

export interface BenchmarkRun {
  id: string;
  taskId: string;
  taskName: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  stepCount: number;
  toolCallCount: number;
  totalTokens: number;
  durationMs: number;
  output: string;
  error?: string;
  toolSequence: string[];
  steps: Array<{ action: string; tool?: string; error?: string }>;
}

export interface BenchmarkResult {
  runId: string;
  taskId: string;
  passed: boolean;
  metrics: {
    success: boolean;
    stepCount: number;
    toolCallCount: number;
    totalTokens: number;
    durationMs: number;
  };
  regressions: RegressionFlag[];
  baselineComparison?: {
    previousSuccessRate: number;
    currentDeviation: "improved" | "degraded" | "stable";
    degradationPercent: number;
  };
}

export interface RegressionFlag {
  type: "success_rate_drop" | "latency_spike" | "tool_loop" | "new_error_pattern";
  severity: "low" | "medium" | "high";
  description: string;
  previousValue?: string;
  currentValue: string;
}

export interface FailureCluster {
  id: string;
  name: string;
  description: string;
  errorPattern: string;
  affectedTaskTypes: string[];
  commonToolSequence: string[];
  failureCount: number;
  firstSeen: string;
  lastSeen: string;
  rootCause?: string;
  suggestedFix?: string;
}

export interface ImprovementMetrics {
  totalTasks: number;
  successRate: number;
  avgSteps: number;
  avgTokens: number;
  avgDurationMs: number;
  regressions: RegressionFlag[];
  clusters: FailureCluster[];
  baselineDate?: string;
}

// ─── Self-Improver ─────────────────────────────────────────────────────────────────

export interface SelfImproverDeps {
  evolver: SelfEvolver;
  /** Directory for storing benchmark data */
  dataDir: string;
  /** Function to execute a benchmark task */
  runBenchmarkTask: (task: BenchmarkTask) => Promise<{
    success: boolean;
    steps: Array<{ action: string; tool?: string; error?: string }>;
    output: string;
    stepCount: number;
    toolCallCount: number;
    totalTokens: number;
    durationMs: number;
  }>;
}

export interface AutoModeConfig {
  /** Delay before first benchmark run (ms), default: 30000 (30s) */
  initialDelayMs?: number;
  /** Interval between benchmark runs (ms), default: 3600000 (1 hour) */
  intervalMs?: number;
  /** Whether to auto-fix regressions, default: true */
  autoFix?: boolean;
  /** Max auto-fix attempts per regression, default: 3 */
  maxFixAttempts?: number;
}

export class SelfImprover {
  private benchmarks: BenchmarkTask[] = [];
  private runs: BenchmarkRun[] = [];
  private clusters: FailureCluster[] = [];
  private initialized = false;
  private autoTimer: ReturnType<typeof setInterval> | null = null;
  private autoFixAttempts = new Map<string, number>();
  private autoModeRunning = false;

  constructor(private deps: SelfImproverDeps) {}

  async initialize(): Promise<void> {
    await mkdir(this.deps.dataDir, { recursive: true });
    await Promise.all([
      this.loadBenchmarks(),
      this.loadRuns(),
      this.loadClusters(),
    ]);
    this.initialized = true;
    console.log(`[SelfImprover] Loaded ${this.benchmarks.length} benchmarks, ${this.runs.length} runs, ${this.clusters.length} clusters`);
  }

  // ─── Benchmark Management ───────────────────────────────────────────────────

  registerBenchmark(task: BenchmarkTask): void {
    this.benchmarks.push(task);
  }

  registerDefaultBenchmarks(): void {
    // Only register benchmarks if the user hasn't defined any yet.
    // These are lightweight sanity checks, not heavy research tasks.
    if (this.benchmarks.length > 0) return;

    const defaults: BenchmarkTask[] = [
      {
        id: "bench_basic_search",
        name: "Basic Search",
        goal: "Search for current date and time and report what day it is",
        taskType: "general",
        expectedOutputPatterns: ["202", "day"],
        maxSteps: 4,
        timeoutMs: 30000,
        tags: ["search", "basic"],
      },
    ];

    for (const b of defaults) {
      this.registerBenchmark(b);
    }
  }

  /** Run all registered benchmarks and collect results */
  async runAllBenchmarks(): Promise<BenchmarkResult[]> {
    if (!this.initialized) await this.initialize();

    const results: BenchmarkResult[] = [];

    for (const task of this.benchmarks) {
      const previousRun = this.getPreviousRunStats(task.id);
      const startedAt = Date.now();
      try {
        const outcome = await this.deps.runBenchmarkTask(task);
        const durationMs = Date.now() - startedAt;

        const run: BenchmarkRun = {
          id: randomUUID(),
          taskId: task.id,
          taskName: task.name,
          startedAt: new Date(startedAt).toISOString(),
          completedAt: new Date().toISOString(),
          success: outcome.success,
          stepCount: outcome.stepCount,
          toolCallCount: outcome.toolCallCount,
          totalTokens: outcome.totalTokens,
          durationMs,
          output: outcome.output,
          error: outcome.success ? undefined : "Task failed verification",
          toolSequence: outcome.steps.filter(s => s.tool).map(s => s.tool!),
          steps: outcome.steps,
        };

        this.runs.push(run);
        const passed = outcome.success && task.expectedOutputPatterns.every(p =>
          outcome.output.toLowerCase().includes(p.toLowerCase())
        );

        const regressions = this.detectRegressions(task, run, previousRun);

        results.push({
          runId: run.id,
          taskId: task.id,
          passed,
          metrics: {
            success: outcome.success,
            stepCount: outcome.stepCount,
            toolCallCount: outcome.toolCallCount,
            totalTokens: outcome.totalTokens,
            durationMs,
          },
          regressions,
          baselineComparison: previousRun ? {
            previousSuccessRate: previousRun.successRate,
            currentDeviation: passed === (previousRun.successRate >= 0.5) ? "stable" : passed ? "improved" : "degraded",
            degradationPercent: previousRun.avgDurationMs > 0
              ? Math.round((durationMs - previousRun.avgDurationMs) / previousRun.avgDurationMs * 100)
              : 0,
          } : undefined,
        });

        // Persist periodically
        await this.persistRuns();
      } catch (e: any) {
        results.push({
          runId: randomUUID(),
          taskId: task.id,
          passed: false,
          metrics: { success: false, stepCount: 0, toolCallCount: 0, totalTokens: 0, durationMs: Date.now() - startedAt },
          regressions: [{ type: "new_error_pattern", severity: "high", description: e.message, currentValue: "exception" }],
        });
      }
    }

    return results;
  }

  // ─── Failure Clustering ─────────────────────────────────────────────────────

  /** Analyze recent failures and group them into clusters */
  async clusterFailures(candidates: EvolutionCandidate[]): Promise<FailureCluster[]> {
    if (!this.initialized) await this.initialize();

    const failures = candidates.filter(c => !c.success);
    if (failures.length === 0) return [];

    const newClusters: FailureCluster[] = [];

    for (const failure of failures) {
      // Extract error signature
      const errorSteps = failure.steps.filter(s => s.action === "error");
      const errorPattern = errorSteps.map(s => s.reasoning?.substring(0, 80) || "unknown").join(" | ") || "no_error_detail";

      // Try to match an existing cluster
      let matched = false;
      for (const cluster of this.clusters) {
        if (this.similarErrorPattern(cluster.errorPattern, errorPattern) &&
            this.overlappingTaskType(cluster.affectedTaskTypes, failure.taskType)) {
          cluster.failureCount++;
          cluster.lastSeen = new Date().toISOString();
          if (!cluster.affectedTaskTypes.includes(failure.taskType)) {
            cluster.affectedTaskTypes.push(failure.taskType);
          }
          // Merge tool sequences
          for (const tool of failure.toolSequence) {
            if (!cluster.commonToolSequence.includes(tool)) {
              cluster.commonToolSequence.push(tool);
            }
          }
          matched = true;
          break;
        }
      }

      if (!matched) {
        const cluster: FailureCluster = {
          id: randomUUID(),
          name: `Failure Cluster: ${errorPattern.substring(0, 40)}`,
          description: `Common failure: ${errorPattern.substring(0, 100)}`,
          errorPattern,
          affectedTaskTypes: [failure.taskType],
          commonToolSequence: failure.toolSequence,
          failureCount: 1,
          firstSeen: new Date().toISOString(),
          lastSeen: new Date().toISOString(),
        };
        this.clusters.push(cluster);
        newClusters.push(cluster);
      }
    }

    // Prune stale clusters (no failures in 30 days)
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    this.clusters = this.clusters.filter(c =>
      new Date(c.lastSeen).getTime() > thirtyDaysAgo || c.failureCount >= 5
    );

    await this.persistClusters();
    return newClusters;
  }

  /** Get active (high-frequency) failure clusters */
  getActiveClusters(minFailures = 3): FailureCluster[] {
    return this.clusters
      .filter(c => c.failureCount >= minFailures)
      .sort((a, b) => b.failureCount - a.failureCount);
  }

  /** Generate improvement suggestions from failure clusters */
  getImprovementSuggestions(): string[] {
    const suggestions: string[] = [];

    for (const cluster of this.getActiveClusters()) {
      if (cluster.commonToolSequence.length >= 3) {
        suggestions.push(
          `[${cluster.affectedTaskTypes.join(", ")}] ${cluster.name}: ` +
          `Repeated tool sequence [${cluster.commonToolSequence.join(" → ")}] failed ${cluster.failureCount} times. ` +
          `Consider: verify first tool output before chaining, or add validation between steps.`
        );
      } else {
        suggestions.push(
          `[${cluster.affectedTaskTypes.join(", ")}] ${cluster.name}: ` +
          `Pattern "${cluster.errorPattern.substring(0, 60)}" occurred ${cluster.failureCount} times. ` +
          `Consider: add precondition checks or improve error handling for this scenario.`
        );
      }
    }

    return suggestions;
  }

  // ─── Metrics ────────────────────────────────────────────────────────────────

  /** Compute improvement metrics from all runs */
  getMetrics(): ImprovementMetrics {
    const recentRuns = this.runs.filter(r =>
      new Date(r.completedAt).getTime() > Date.now() - 7 * 24 * 60 * 60 * 1000
    );

    const successful = recentRuns.filter(r => r.success);
    const regressions: RegressionFlag[] = [];

    // Check success rate degradation vs all-time
    const allTimeSuccessRate = this.runs.length > 0
      ? this.runs.filter(r => r.success).length / this.runs.length
      : 1;
    const recentSuccessRate = recentRuns.length > 0
      ? successful.length / recentRuns.length
      : 1;

    if (recentSuccessRate < allTimeSuccessRate - 0.15) {
      regressions.push({
        type: "success_rate_drop",
        severity: recentSuccessRate < allTimeSuccessRate - 0.3 ? "high" : "medium",
        description: `Recent success rate ${(recentSuccessRate * 100).toFixed(0)}% vs all-time ${(allTimeSuccessRate * 100).toFixed(0)}%`,
        previousValue: `${(allTimeSuccessRate * 100).toFixed(0)}%`,
        currentValue: `${(recentSuccessRate * 100).toFixed(0)}%`,
      });
    }

    return {
      totalTasks: recentRuns.length,
      successRate: recentSuccessRate,
      avgSteps: successful.length > 0 ? successful.reduce((s, r) => s + r.stepCount, 0) / successful.length : 0,
      avgTokens: successful.length > 0 ? successful.reduce((s, r) => s + r.totalTokens, 0) / successful.length : 0,
      avgDurationMs: successful.length > 0 ? successful.reduce((s, r) => s + r.durationMs, 0) / successful.length : 0,
      regressions,
      clusters: this.getActiveClusters(),
      baselineDate: this.runs.length > 0 ? this.runs[0].completedAt : undefined,
    };
  }

  /** Notify the self-improver about a completed task (success or failure) */
  async recordTask(candidate: EvolutionCandidate): Promise<void> {
    if (!this.initialized) await this.initialize();

    // Record as a run for metrics tracking
    const run: BenchmarkRun = {
      id: randomUUID(),
      taskId: candidate.goal.substring(0, 40),
      taskName: candidate.goal.substring(0, 80),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      success: candidate.success,
      stepCount: candidate.steps.length,
      toolCallCount: candidate.toolSequence.length,
      totalTokens: 0, // unknown for ad-hoc tasks
      durationMs: 0,
      output: candidate.summary,
      toolSequence: candidate.toolSequence,
      steps: candidate.steps.map(s => ({
        action: s.action,
        tool: s.tool,
        error: s.reasoning?.substring(0, 200),
      })),
    };
    this.runs.push(run);

    // Cluster failures
    if (!candidate.success) {
      await this.clusterFailures([candidate]);
    }

    // Persist periodically (every 10 runs)
    if (this.runs.length % 10 === 0) {
      await this.persistRuns();
    }
  }

  // ─── Auto Mode ────────────────────────────────────────────────────────────────

  /** Start automatic benchmark scheduling + regression detection + auto-fix loop */
  startAutoMode(config: AutoModeConfig = {}): void {
    if (this.autoModeRunning) return;

    const initialDelay = config.initialDelayMs ?? 30000;
    const interval = config.intervalMs ?? 21_600_000; // 6 hours
    const autoFix = config.autoFix !== false;
    const maxFixAttempts = config.maxFixAttempts ?? 3;

    this.autoModeRunning = true;
    console.log(`[SelfImprover] Auto mode starting — initial delay ${initialDelay / 1000}s, interval ${interval / 3600000}h, autoFix: ${autoFix}`);

    // Initial run after delay (let system warm up)
    this.autoTimer = setTimeout(() => {
      this.runAutoCycle(autoFix, maxFixAttempts);

      // Then periodic runs
      this.autoTimer = setInterval(() => {
        this.runAutoCycle(autoFix, maxFixAttempts);
      }, interval);
    }, initialDelay);
  }

  /** Stop auto mode */
  stopAutoMode(): void {
    if (this.autoTimer) {
      clearInterval(this.autoTimer as any);
      this.autoTimer = null;
    }
    this.autoModeRunning = false;
    console.log("[SelfImprover] Auto mode stopped");
  }

  isAutoModeRunning(): boolean {
    return this.autoModeRunning;
  }

  /** Run a full auto cycle: benchmarks → detect regressions → auto-fix if needed */
  private async runAutoCycle(autoFix: boolean, maxFixAttempts: number): Promise<void> {
    console.log("[SelfImprover] Running auto benchmark cycle...");
    try {
      const results = await this.runAllBenchmarks();
      const passed = results.filter(r => r.passed).length;
      console.log(`[SelfImprover] Benchmarks: ${passed}/${results.length} passed`);

      const regressed = results.filter(r => r.regressions.length > 0);
      if (regressed.length === 0) {
        console.log("[SelfImprover] No regressions detected");
        return;
      }

      console.log(`[SelfImprover] ${regressed.length} regressions detected:`);
      for (const r of regressed) {
        for (const reg of r.regressions) {
          console.log(`  - [${reg.severity}] ${reg.type}: ${reg.description}`);
        }
      }

      if (autoFix) {
        await this.attemptAutoFix(regressed, maxFixAttempts);
      }
    } catch (e: any) {
      console.error(`[SelfImprover] Auto cycle error: ${e.message}`);
    }
  }

  /** Attempt to auto-fix regressions by feeding failures to SelfEvolver */
  private async attemptAutoFix(regressed: BenchmarkResult[], maxFixAttempts: number): Promise<void> {
    for (const result of regressed) {
      for (const reg of result.regressions) {
        const fixKey = `${result.taskId}:${reg.type}`;
        const attempts = this.autoFixAttempts.get(fixKey) || 0;

        if (attempts >= maxFixAttempts) {
          console.log(`[SelfImprover] Skipping auto-fix for ${fixKey} — max attempts (${maxFixAttempts}) reached`);
          continue;
        }

        console.log(`[SelfImprover] Attempting auto-fix #${attempts + 1} for ${fixKey}...`);
        this.autoFixAttempts.set(fixKey, attempts + 1);

        try {
          // Find the corresponding benchmark run
          const run = this.runs.find(r => r.id === result.runId);
          if (!run) continue;

          // Build an EvolutionCandidate from the failed run
          const candidate = {
            goal: `[Benchmark Regression] ${reg.description}`,
            taskType: "code" as const,
            steps: run.steps.map(s => ({
              step: 0,
              action: s.action,
              tool: s.tool,
              reasoning: s.error,
            })),
            toolSequence: run.toolSequence,
            success: false,
            summary: `Regression: ${reg.type} — ${reg.description}. Previous: ${reg.previousValue || "N/A"} → Current: ${reg.currentValue}`,
          };

          // Evolve from failure to create an anti-pattern / fix skill
          const evolutionResult = await this.deps.evolver.evolveFromFailure(candidate);

          if (evolutionResult.skill) {
            console.log(`[SelfImprover] Auto-fix skill created: ${evolutionResult.skill.name} — ${evolutionResult.skill.description}`);
          } else {
            console.log(`[SelfImprover] Auto-fix skipped: ${evolutionResult.reason}`);
          }
        } catch (e: any) {
          console.error(`[SelfImprover] Auto-fix attempt failed: ${e.message}`);
        }
      }
    }
  }

  /** Force a benchmark cycle now (useful for testing) */
  async forceBenchmarkCycle(): Promise<{ results: BenchmarkResult[]; regressions: number }> {
    const results = await this.runAllBenchmarks();
    const regressed = results.filter(r => r.regressions.length > 0);
    return { results, regressions: regressed.length };
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private getPreviousRunStats(taskId: string): {
    successRate: number;
    avgDurationMs: number;
    avgSteps: number;
  } | undefined {
    const taskRuns = this.runs.filter(r => r.taskId === taskId);
    if (taskRuns.length === 0) return undefined;

    const successful = taskRuns.filter(r => r.success);
    return {
      successRate: successful.length / taskRuns.length,
      avgDurationMs: taskRuns.reduce((s, r) => s + r.durationMs, 0) / taskRuns.length,
      avgSteps: taskRuns.reduce((s, r) => s + r.stepCount, 0) / taskRuns.length,
    };
  }

  private detectRegressions(
    task: BenchmarkTask,
    run: BenchmarkRun,
    baseline?: { successRate: number; avgDurationMs: number; avgSteps: number }
  ): RegressionFlag[] {
    const flags: RegressionFlag[] = [];

    if (!baseline) return flags;

    // Success rate drop
    if (!run.success && baseline.successRate >= 0.7) {
      flags.push({
        type: "success_rate_drop",
        severity: baseline.successRate >= 0.9 ? "high" : "medium",
        description: `Previously stable task ${task.name} failed (was ${(baseline.successRate * 100).toFixed(0)}% successful)`,
        previousValue: `${(baseline.successRate * 100).toFixed(0)}%`,
        currentValue: "failed",
      });
    }

    // Latency spike (>2x baseline)
    if (baseline.avgDurationMs > 0 && run.durationMs > baseline.avgDurationMs * 2) {
      flags.push({
        type: "latency_spike",
        severity: run.durationMs > baseline.avgDurationMs * 4 ? "high" : "low",
        description: `${task.name} took ${run.durationMs}ms vs baseline ${baseline.avgDurationMs}ms (${Math.round(run.durationMs / baseline.avgDurationMs)}x)`,
        previousValue: `${baseline.avgDurationMs}ms`,
        currentValue: `${run.durationMs}ms`,
      });
    }

    // Tool loop detection (>2x baseline steps)
    if (run.stepCount > baseline.avgSteps * 2 && run.stepCount > 6) {
      flags.push({
        type: "tool_loop",
        severity: run.stepCount > baseline.avgSteps * 3 ? "high" : "medium",
        description: `${task.name} used ${run.stepCount} steps vs baseline ${baseline.avgSteps.toFixed(0)}`,
        previousValue: `${baseline.avgSteps.toFixed(0)} steps`,
        currentValue: `${run.stepCount} steps`,
      });
    }

    return flags;
  }

  private similarErrorPattern(a: string, b: string): boolean {
    // Simple similarity: shared words / total words
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (wordsA.size === 0 || wordsB.size === 0) return false;

    let overlap = 0;
    for (const w of wordsA) {
      if (wordsB.has(w)) overlap++;
    }

    const similarity = overlap / Math.max(wordsA.size, wordsB.size);
    return similarity >= 0.5;
  }

  private overlappingTaskType(typesA: string[], typeB: string): boolean {
    return typesA.length === 0 || typesA.some(t => t.toLowerCase() === typeB.toLowerCase());
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  private async loadBenchmarks(): Promise<void> {
    const path = join(this.deps.dataDir, "benchmarks.json");
    if (!existsSync(path)) return;
    try {
      this.benchmarks = JSON.parse(await readFile(path, "utf8"));
    } catch { /* ignore */ }
  }

  private async loadRuns(): Promise<void> {
    const path = join(this.deps.dataDir, "benchmark_runs.json");
    if (!existsSync(path)) return;
    try {
      this.runs = JSON.parse(await readFile(path, "utf8"));
      // Keep only last 500 runs
      if (this.runs.length > 500) {
        this.runs = this.runs.slice(-500);
      }
    } catch { /* ignore */ }
  }

  private async loadClusters(): Promise<void> {
    const path = join(this.deps.dataDir, "failure_clusters.json");
    if (!existsSync(path)) return;
    try {
      this.clusters = JSON.parse(await readFile(path, "utf8"));
    } catch { /* ignore */ }
  }

  private async persistRuns(): Promise<void> {
    try {
      await writeFile(
        join(this.deps.dataDir, "benchmark_runs.json"),
        JSON.stringify(this.runs.slice(-500), null, 2),
        "utf8"
      );
    } catch { /* ignore */ }
  }

  private async persistClusters(): Promise<void> {
    try {
      await writeFile(
        join(this.deps.dataDir, "failure_clusters.json"),
        JSON.stringify(this.clusters, null, 2),
        "utf8"
      );
    } catch { /* ignore */ }
  }
}
