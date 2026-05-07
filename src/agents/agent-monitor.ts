/**
 * AgentMonitor — watches agent heartbeats and detects/recovers stale agents.
 * Uses AgentRegistry heartbeat timestamps to detect failures, and ContextBus
 * for cross-process health tracking via BusTransport when available.
 */

import { AgentRegistry, type AgentInfo } from "./agent-registry.js";
import { ContextBus } from "./context-bus.js";
import type { BusTransport } from "./bus-transport.js";

export interface AgentMonitorOptions {
  registry: AgentRegistry;
  contextBus: ContextBus;
  /** Max time without heartbeat before agent is considered stale (ms). Default 30s. */
  staleThresholdMs: number;
  /** Polling interval for health checks (ms). Default 10s. */
  checkIntervalMs: number;
  /** Optional cross-process transport for multi-process health tracking */
  transport?: BusTransport;
  /** Called when a stale agent is detected */
  onStaleAgent?: (agent: AgentInfo, offlineDurationMs: number) => void;
  /** Called when a stale agent recovers (heartbeat resumes) */
  onRecovered?: (agent: AgentInfo) => void;
}

export interface HealthStatus {
  agentId: string;
  name: string;
  role: string;
  status: string;
  lastHeartbeat: string;
  stale: boolean;
  offlineDurationMs: number;
  /** Whether this agent is in a different process */
  remote: boolean;
}

export class AgentMonitor {
  private options: AgentMonitorOptions;
  private timer: NodeJS.Timeout | null = null;
  private staleAgents = new Set<string>();
  private running = false;

  constructor(options: AgentMonitorOptions) {
    this.options = options;
  }

  start(): void {
    this.running = true;
    this.timer = setInterval(() => this.checkHealth(), this.options.checkIntervalMs);
    console.log(`[AgentMonitor] Started health checks (interval: ${this.options.checkIntervalMs}ms, stale threshold: ${this.options.staleThresholdMs}ms)`);
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Check all agents' health status */
  checkHealth(): HealthStatus[] {
    const agents = this.options.registry.list();
    const now = Date.now();
    const results: HealthStatus[] = [];

    for (const agent of agents) {
      const lastHb = new Date(agent.lastHeartbeat || agent.registeredAt).getTime();
      const offlineMs = now - lastHb;
      const isStale = offlineMs > this.options.staleThresholdMs;

      results.push({
        agentId: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status,
        lastHeartbeat: agent.lastHeartbeat || agent.registeredAt,
        stale: isStale,
        offlineDurationMs: offlineMs,
        remote: false,
      });

      if (isStale && !this.staleAgents.has(agent.id)) {
        this.staleAgents.add(agent.id);
        this.options.onStaleAgent?.(agent, offlineMs);

        this.options.contextBus.publish({
          type: "alert",
          fromAgentId: "monitor",
          topic: "agent.stale",
          payload: {
            agentId: agent.id,
            name: agent.name,
            role: agent.role,
            offlineDurationMs: offlineMs,
          },
        });

        console.warn(`[AgentMonitor] Stale agent detected: ${agent.name} (${agent.id.substring(0, 8)}) — offline ${Math.round(offlineMs / 1000)}s`);
      } else if (!isStale && this.staleAgents.has(agent.id)) {
        this.staleAgents.delete(agent.id);
        this.options.onRecovered?.(agent);
        console.log(`[AgentMonitor] Agent recovered: ${agent.name} (${agent.id.substring(0, 8)})`);
      }
    }

    // Also check cross-process peers if transport is available
    if (this.options.transport) {
      this.checkRemoteHealth(now, results);
    }

    return results;
  }

  /** Check remote process health via BusTransport */
  private async checkRemoteHealth(now: number, results: HealthStatus[]): Promise<void> {
    try {
      const peers = await this.options.transport!.getPeerStatuses();
      for (const peer of peers) {
        const lastSeen = new Date(peer.lastSeen).getTime();
        const offlineMs = now - lastSeen;
        const isStale = offlineMs > this.options.staleThresholdMs;

        results.push({
          agentId: peer.processId,
          name: peer.processId,
          role: "remote",
          status: peer.status,
          lastHeartbeat: peer.lastSeen,
          stale: isStale,
          offlineDurationMs: offlineMs,
          remote: true,
        });

        if (isStale) {
          // For remote processes, publish cleanup alert
          this.options.contextBus.publish({
            type: "alert",
            fromAgentId: "monitor",
            topic: "process.stale",
            payload: { processId: peer.processId, pid: peer.pid, offlineDurationMs: offlineMs },
          });
        }
      }
    } catch { /* transport might be unavailable */ }
  }

  /** Get list of currently stale agents */
  getStaleAgents(): string[] {
    return [...this.staleAgents];
  }

  /** Force recovery attempt for a stale agent (re-register in bus) */
  async attemptRecovery(agentId: string): Promise<boolean> {
    const agent = this.options.registry.get(agentId);
    if (!agent) return false;

    // Force a heartbeat update to mark agent as active
    this.options.registry.heartbeat({
      agentId,
      status: "idle",
      currentTask: "Recovered by monitor",
      activeTaskCount: 0,
      timestamp: new Date().toISOString(),
    });

    this.staleAgents.delete(agentId);
    this.options.contextBus.publish({
      type: "context.sync",
      fromAgentId: "monitor",
      topic: "agent.recovered",
      payload: { agentId, name: agent.name },
    });

    console.log(`[AgentMonitor] Recovery attempted for ${agent.name} (${agentId.substring(0, 8)})`);
    return true;
  }
}
