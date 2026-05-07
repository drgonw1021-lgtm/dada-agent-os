import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { ExecutionStep, TaskInput, TaskResult } from "../core/types.js";

// ─── State types ────────────────────────────────────────────────────────────────

export type AgentState =
  | "idle"
  | "classify"
  | "strategic_plan"
  | "critic"
  | "verify"
  | "self_evolve"
  | "done"
  | "paused"
  | "cancelled";

export const TERMINAL_STATES: AgentState[] = ["done", "cancelled"];
export const RESUMPTION_STATES: AgentState[] = [
  "idle", "classify", "strategic_plan",
  "critic", "verify", "self_evolve"
];

// ─── Transition map ─────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<AgentState, AgentState[]> = {
  idle:           ["classify"],
  classify:       ["strategic_plan", "done", "cancelled", "paused"],
  strategic_plan: ["critic", "verify", "done", "cancelled", "paused"],
  critic:         ["strategic_plan", "verify", "done", "cancelled", "paused"],
  verify:         ["done", "self_evolve", "cancelled", "paused"],
  self_evolve:    ["done", "cancelled"],
  done:           ["self_evolve"],
  paused:         ["classify", "strategic_plan", "critic", "verify", "cancelled"],
  cancelled:      [],
};

// ─── State context ──────────────────────────────────────────────────────────────

export interface StateContext {
  taskId: string;
  taskLineageId: string;
  goal: string;
  taskType?: string;
  outputFormat?: string;
  workflowLabel?: string;
  cycle: number;
  stepCounter: number;
  steps: ExecutionStep[];
  observationNotes: string[];
  taskPlannerUsed: boolean;
  consecutiveSearchCycles: number;
  consecutiveSameToolCycles: number;
  previousCycleToolSet: string;
  searchLockedOut: boolean;
  executedAnyTool: boolean;
  doneReason: string;
  attachments?: TaskInput["attachments"];
  modelOverrides?: TaskInput["modelOverrides"];
  // Capability routing
  capabilityPlan?: {
    matchedTools: string[];
    matchedSkills: { name: string }[];
    missingCapabilities: string[];
    missingTools: string[];
    routingPrompt: string;
  };
}

export function createEmptyContext(taskId: string, goal: string, taskLineageId?: string): StateContext {
  return {
    taskId,
    taskLineageId: taskLineageId ?? taskId,
    goal,
    cycle: 0,
    stepCounter: 1,
    steps: [],
    observationNotes: [],
    taskPlannerUsed: false,
    consecutiveSearchCycles: 0,
    consecutiveSameToolCycles: 0,
    previousCycleToolSet: "",
    searchLockedOut: false,
    executedAnyTool: false,
    doneReason: "",
  };
}

// ─── Serialized form ────────────────────────────────────────────────────────────

export interface SerializedMachine {
  version: 1;
  taskId: string;
  state: AgentState;
  context: StateContext;
  savedAt: string;
  prePauseState?: AgentState | null;
}

// ─── Machine ────────────────────────────────────────────────────────────────────

export class AgentStateMachine {
  private state: AgentState = "idle";
  private context: StateContext;
  private emitter = new EventEmitter();
  private persistDir: string;

  constructor(taskId: string, goal: string, taskLineageId?: string) {
    this.context = createEmptyContext(taskId, goal, taskLineageId);
    this.persistDir = "./.agent/state";
  }

  // ── State management ──────────────────────────────────────────────────────

  getState(): AgentState {
    return this.state;
  }

  getContext(): Readonly<StateContext> {
    return this.context;
  }

  updateContext(patch: Partial<StateContext>): void {
    Object.assign(this.context, patch);
  }

  isTerminal(): boolean {
    return TERMINAL_STATES.includes(this.state);
  }

  isActive(): boolean {
    return !this.isTerminal();
  }

  // ── Transition ──────────────────────────────────────────────────────────

  canTransitionTo(target: AgentState): boolean {
    return VALID_TRANSITIONS[this.state]?.includes(target) ?? false;
  }

  transition(target: AgentState): void {
    if (!this.canTransitionTo(target)) {
      throw new Error(
        `Invalid state transition: ${this.state} → ${target}. ` +
        `Allowed: ${VALID_TRANSITIONS[this.state].join(", ") || "none"}`
      );
    }
    const from = this.state;
    this.state = target;
    this.emitter.emit("transition", { from, to: target, context: this.context });
    this.emitter.emit(`state:${target}`, { from, context: this.context });
  }

  // ── Shortcut transitions ─────────────────────────────────────────────────

  toClassify(): void    { this.transition("classify"); }
  toStrategicPlan(): void { this.transition("strategic_plan"); }
  toCritic(): void      { this.transition("critic"); }
  toVerify(): void      { this.transition("verify"); }
  toSelfEvolve(): void  { this.transition("self_evolve"); }
  toDone(): void {
    if (this.state === "done") return; // safe re-entry
    this.transition("done");
  }

  toPaused(): void {
    this.prePauseState = this.state;
    if (!this.canTransitionTo("paused")) {
      this.emitter.emit("force_pause", { from: this.state, context: this.context });
    }
    this.state = "paused";
    this.emitter.emit("state:paused", { from: this.state, prePauseState: this.prePauseState, context: this.context });
  }

  toCancelled(): void {
    this.state = "cancelled";
    this.emitter.emit("state:cancelled", { context: this.context });
  }

  private prePauseState: AgentState | null = null;

  resumeFromPaused(): AgentState {
    if (this.state !== "paused") {
      throw new Error(`Cannot resume: current state is ${this.state}, not paused`);
    }
    const resumeState = this.prePauseState || "classify";
    this.state = resumeState;
    this.prePauseState = null;
    this.emitter.emit("state:resumed", { to: resumeState, context: this.context });
    return resumeState;
  }

  getPrePauseState(): AgentState | null {
    return this.prePauseState;
  }

  // ── Events ────────────────────────────────────────────────────────────────

  on(event: string, listener: (...args: any[]) => void): void {
    this.emitter.on(event, listener);
  }

  off(event: string, listener: (...args: any[]) => void): void {
    this.emitter.off(event, listener);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  serialize(): SerializedMachine {
    return {
      version: 1,
      taskId: this.context.taskId,
      state: this.state,
      context: { ...this.context },
      savedAt: new Date().toISOString(),
      prePauseState: this.prePauseState,
    };
  }

  static deserialize(data: SerializedMachine): AgentStateMachine {
    const m = new AgentStateMachine(data.taskId, data.context.goal, data.context.taskLineageId);
    m.state = data.state;
    m.context = data.context;
    m.prePauseState = data.prePauseState ?? null;
    return m;
  }

  async saveToDisk(): Promise<string> {
    await mkdir(this.persistDir, { recursive: true });
    const filePath = join(this.persistDir, `task-${this.context.taskId}.json`);
    const data = this.serialize();
    await writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
    this.emitter.emit("persisted", { filePath });
    return filePath;
  }

  static async loadFromDisk(taskId: string, persistDir?: string): Promise<AgentStateMachine | null> {
    const dir = persistDir || "./.agent/state";
    const filePath = join(dir, `task-${taskId}.json`);
    if (!existsSync(filePath)) return null;

    try {
      const raw = await readFile(filePath, "utf8");
      const data = JSON.parse(raw) as SerializedMachine;
      if (data.version !== 1) return null;
      // Migration: remap removed states from previous versions
      if ((data.state as string) === "decompose" || (data.state as string) === "execute_subgoal" || (data.state as string) === "observe") {
        data.state = "strategic_plan";
      }
      if ((data.prePauseState as string) === "decompose" || (data.prePauseState as string) === "execute_subgoal" || (data.prePauseState as string) === "observe") {
        data.prePauseState = "strategic_plan";
      }
      const m = AgentStateMachine.deserialize(data);
      m.persistDir = dir;
      return m;
    } catch {
      return null;
    }
  }

  async deletePersisted(): Promise<void> {
    const filePath = join(this.persistDir, `task-${this.context.taskId}.json`);
    if (existsSync(filePath)) {
      await unlink(filePath);
    }
  }
}
