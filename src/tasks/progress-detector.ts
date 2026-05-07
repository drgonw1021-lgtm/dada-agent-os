/**
 * ProgressDetector — watches per-cycle execution health and warns before stall-kill.
 * Phase 3 minimum viable: tracks tool diversity, idle cycles, and emits early warnings.
 */

// Tools that constitute "productive work" (output-producing, not just data-gathering)
const PRODUCTIVE_TOOLS = new Set([
  "fs.write_file",
  "fs.append_file",
  "shell.exec",
  "core.echo",
  "gen.chart",
  "gen.media",
  "code.exec",
  "code.self_improve",
  "code.improver",
  "web.fetch",
  "search",
]);

function isProductiveTool(tool: string): boolean {
  if (PRODUCTIVE_TOOLS.has(tool)) return true;
  // MCP tools that install/call external services are productive
  if (tool.startsWith("mcp.")) return true;
  // Domain tools often produce output
  if (tool.startsWith("domain.")) return true;
  return false;
}

export interface CycleSnapshot {
  cycle: number;
  stepCount: number;
  toolsExecuted: string[];
  hasProductiveWork: boolean;
}

export interface ProgressDetectorDeps {
  emit: (type: string, payload?: unknown) => void;
  maxCycles: number;
}

export class ProgressDetector {
  private cycles: CycleSnapshot[] = [];
  private consecutiveIdle = 0;
  private toolHistory = new Set<string>();

  constructor(private deps: ProgressDetectorDeps) {}

  recordCycle(snapshot: CycleSnapshot): void {
    this.cycles.push(snapshot);
    snapshot.toolsExecuted.forEach(t => this.toolHistory.add(t));

    if (snapshot.toolsExecuted.length === 0) {
      this.consecutiveIdle++;
    } else {
      this.consecutiveIdle = 0;
    }
  }

  /** Called at end of each cycle. Returns true if task should abort. */
  evaluate(cycle: number): { shouldAbort: boolean; reason?: string; warning?: string; suggestion?: string } {
    const recent = this.cycles.slice(-3);
    const allIdle = recent.every(c => c.toolsExecuted.length === 0);
    const hadProductiveWork = this.cycles.some(c => c.hasProductiveWork);

    // Phase 1: early warning — 1 idle cycle after productive work
    if (this.consecutiveIdle === 1 && hadProductiveWork && cycle < this.deps.maxCycles) {
      this.deps.emit("task.progress_warning", {
        warning: "stall_risk",
        message: "Agent has stopped executing tools. Goal may already be achieved.",
        cycle,
        maxCycles: this.deps.maxCycles,
        consecutiveIdle: this.consecutiveIdle,
      });
      return {
        shouldAbort: false,
        warning: "stall_risk",
        suggestion: "WARNING: The agent appears to be stuck. The last cycle produced no productive work. Consider: (1) switching to a different approach or tool, (2) searching for missing capabilities via mcp.search, (3) delegating subtasks via agent.delegate, (4) if the goal is already achieved, declare DONE."
      };
    }

    // Phase 2: persistent idle — last chance warning
    if (this.consecutiveIdle >= 2 && hadProductiveWork && cycle < this.deps.maxCycles) {
      this.deps.emit("task.progress_warning", {
        warning: "imminent_stall",
        message: `No tool execution for ${this.consecutiveIdle} cycles. Forcing completion soon.`,
        cycle,
        consecutiveIdle: this.consecutiveIdle,
      });
      return {
        shouldAbort: false,
        warning: "imminent_stall",
        suggestion: "URGENT: No tool execution for multiple cycles. You will be stopped soon. If you have results, write them with fs.write_file NOW. If stuck, try: (1) agent.delegate to hand off the task, (2) mcp.search for missing capabilities, (3) code.self_improve to build what you need."
      };
    }

    // Phase 3: abort — no productive work ever AND idle for 2+ cycles
    if (this.consecutiveIdle >= 2 && !hadProductiveWork) {
      this.deps.emit("task.stalled", {
        reason: "no_progress_ever",
        message: "Agent produced no productive output across all cycles.",
        totalCycles: this.cycles.length,
        toolsEverUsed: [...this.toolHistory],
      });
      return {
        shouldAbort: true,
        reason: "No productive output in any cycle — task cannot be completed",
        suggestion: "The agent produced no productive work across all cycles. Consider: (1) rephrasing the task into smaller, clearer steps, (2) checking that needed tools are available, (3) running in a workspace where files can be written."
      };
    }

    // Phase 4: abort — all cycles exhausted with no recent work
    if (cycle >= this.deps.maxCycles && allIdle) {
      this.deps.emit("task.stalled", {
        reason: "max_cycles_exhausted",
        message: `All ${this.deps.maxCycles} planning cycles exhausted with no recent tool execution.`,
        totalCycles: this.cycles.length,
        toolsEverUsed: [...this.toolHistory],
      });
      return {
        shouldAbort: true,
        reason: "Max planning cycles exhausted",
        suggestion: "All planning cycles used up. Consider: (1) increasing maxPlanningCycles in config, (2) simplifying the task, (3) using a faster model."
      };
    }

    return { shouldAbort: false };
  }

  getSummary() {
    return {
      totalCycles: this.cycles.length,
      consecutiveIdle: this.consecutiveIdle,
      toolsUsed: [...this.toolHistory],
      hadProductiveWork: this.cycles.some(c => c.hasProductiveWork),
    };
  }

  reset(): void {
    this.cycles = [];
    this.consecutiveIdle = 0;
    this.toolHistory = new Set();
  }
}
