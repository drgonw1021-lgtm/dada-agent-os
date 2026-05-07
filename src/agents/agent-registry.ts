import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface AgentInfo {
  id: string;
  name: string;
  role: string; // "planner", "executor", "critic", "specialist", "worker"
  capabilities: string[]; // e.g. ["search", "code", "vision", "data-analysis"]
  status: AgentStatus;
  endpoint: string; // local or remote address for delegation
  registeredAt: string;
  lastHeartbeat: string;
  currentTask?: string;
  maxConcurrency: number;
  activeTaskCount: number;
  metadata?: Record<string, string>;
}

export type AgentStatus = "idle" | "busy" | "offline" | "draining";

export interface AgentHeartbeat {
  agentId: string;
  status: AgentStatus;
  currentTask?: string;
  activeTaskCount: number;
  timestamp: string;
}

export interface RegistryStats {
  totalAgents: number;
  online: number;
  busy: number;
  idle: number;
  byRole: Record<string, number>;
}

// ─── Registry ─────────────────────────────────────────────────────────────────────

export class AgentRegistry extends EventEmitter {
  private agents: Map<string, AgentInfo> = new Map();
  private heartbeatTimeout: number; // ms before agent considered offline
  private heartbeatTimer: NodeJS.Timeout | null = null;

  constructor(heartbeatTimeoutMs = 30000) {
    super();
    this.heartbeatTimeout = heartbeatTimeoutMs;
  }

  start(): void {
    // Periodically check for stale agents
    this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), this.heartbeatTimeout / 3);
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Register a new agent or update existing */
  register(info: Omit<AgentInfo, "id" | "registeredAt" | "lastHeartbeat">): AgentInfo {
    const id = randomUUID();
    const agent: AgentInfo = {
      ...info,
      id,
      registeredAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString()
    };
    this.agents.set(id, agent);
    this.emit("agent:registered", agent);
    console.log(`[AgentRegistry] Agent registered: ${agent.name} (${agent.role}) with [${agent.capabilities.join(", ")}]`);
    return agent;
  }

  /** Update agent status via heartbeat */
  heartbeat(heartbeat: AgentHeartbeat): boolean {
    const agent = this.agents.get(heartbeat.agentId);
    if (!agent) return false;

    agent.status = heartbeat.status;
    agent.lastHeartbeat = heartbeat.timestamp;
    agent.currentTask = heartbeat.currentTask;
    agent.activeTaskCount = heartbeat.activeTaskCount;

    this.emit("agent:heartbeat", agent);
    return true;
  }

  /** Unregister an agent */
  unregister(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.status = "offline";
    this.emit("agent:offline", agent);
    this.agents.delete(agentId);
    console.log(`[AgentRegistry] Agent unregistered: ${agent.name}`);
    return true;
  }

  /** Find agents by capability — returns best matches first */
  findByCapability(capability: string): AgentInfo[] {
    const capLower = capability.toLowerCase();
    return Array.from(this.agents.values())
      .filter(a => a.status !== "offline")
      .filter(a => a.capabilities.some(c => c.toLowerCase().includes(capLower) || capLower.includes(c.toLowerCase())))
      .sort((a, b) => {
        // Prefer idle over busy, then by capability match quality
        if (a.status === "idle" && b.status !== "idle") return -1;
        if (b.status === "idle" && a.status !== "idle") return 1;
        return a.activeTaskCount - b.activeTaskCount;
      });
  }

  /** Find agents by role */
  findByRole(role: string): AgentInfo[] {
    return Array.from(this.agents.values())
      .filter(a => a.status !== "offline" && a.role === role)
      .sort((a, b) => a.activeTaskCount - b.activeTaskCount);
  }

  /** Get the best available agent for a task */
  findBest(capabilities: string[], preferredRole?: string): AgentInfo | null {
    const online = Array.from(this.agents.values())
      .filter(a => a.status !== "offline");

    if (online.length === 0) return null;

    // Score each agent
    const scored = online.map(agent => {
      let score = 0;

      // Capability match (each matched capability adds points)
      for (const cap of capabilities) {
        const capLower = cap.toLowerCase();
        if (agent.capabilities.some(c => c.toLowerCase().includes(capLower) || capLower.includes(c.toLowerCase()))) {
          score += 10;
        }
      }

      // Role preference
      if (preferredRole && agent.role === preferredRole) score += 5;

      // Idle agents preferred
      if (agent.status === "idle") score += 3;

      // Less loaded agents preferred
      score -= agent.activeTaskCount * 2;

      // Recently active agents preferred
      const lastHb = new Date(agent.lastHeartbeat).getTime();
      const now = Date.now();
      if (now - lastHb < 10000) score += 2;

      return { agent, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored[0]?.score > 0 ? scored[0].agent : null;
  }

  /** Get agent by ID */
  get(agentId: string): AgentInfo | undefined {
    return this.agents.get(agentId);
  }

  /** List all registered agents */
  list(): AgentInfo[] {
    return Array.from(this.agents.values());
  }

  /** Get registry statistics */
  getStats(): RegistryStats {
    const all = Array.from(this.agents.values());
    const online = all.filter(a => a.status !== "offline");
    const byRole: Record<string, number> = {};

    for (const a of all) {
      byRole[a.role] = (byRole[a.role] || 0) + 1;
    }

    return {
      totalAgents: all.length,
      online: online.length,
      busy: online.filter(a => a.status === "busy").length,
      idle: online.filter(a => a.status === "idle").length,
      byRole
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private checkHeartbeats(): void {
    const now = Date.now();
    for (const agent of this.agents.values()) {
      if (agent.status === "offline") continue;
      const lastHb = new Date(agent.lastHeartbeat).getTime();
      if (now - lastHb > this.heartbeatTimeout) {
        agent.status = "offline";
        this.emit("agent:offline", agent);
        console.log(`[AgentRegistry] Agent ${agent.name} went offline (no heartbeat for ${((now - lastHb) / 1000).toFixed(0)}s)`);
      }
    }
  }
}
