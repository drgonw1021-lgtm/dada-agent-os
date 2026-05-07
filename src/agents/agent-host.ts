import { randomUUID } from "node:crypto";
import { AgentRegistry, type AgentInfo, type AgentStatus } from "./agent-registry.js";
import { DelegationManager, type DelegationRequest, type DelegationResult, type DelegationHandler, type DelegationAck, type DelegatedTask } from "./delegation-protocol.js";
import { ContextBus, type ContextMessage } from "./context-bus.js";

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface AgentHostConfig {
  /** Unique name for this host */
  name: string;
  /** Role in the agent mesh */
  role: "planner" | "executor" | "critic" | "coordinator" | "worker";
  /** Capabilities this host provides */
  capabilities: string[];
  /** Maximum concurrent tasks this host can handle */
  maxConcurrency: number;
  /** Heartbeat interval in ms */
  heartbeatIntervalMs: number;
  /** Agent registry (shared across hosts in the same process) */
  registry: AgentRegistry;
  /** Delegation manager (shared) */
  delegationManager: DelegationManager;
  /** Context bus (shared) */
  contextBus: ContextBus;
  /** Function to execute a delegated task */
  taskExecutor?: (task: DelegatedTask) => Promise<DelegationResult>;
}

export interface AgentHostStats {
  agentId: string;
  name: string;
  role: string;
  status: AgentStatus;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  uptime: number;
}

// ─── Host ─────────────────────────────────────────────────────────────────────────

export class AgentHost {
  readonly agentId: string;
  readonly name: string;
  readonly role: string;
  readonly capabilities: string[];
  readonly maxConcurrency: number;

  private registry: AgentRegistry;
  private delegationManager: DelegationManager;
  private contextBus: ContextBus;
  private taskExecutor?: (task: DelegatedTask) => Promise<DelegationResult>;

  private status: AgentStatus = "idle";
  private activeTaskCount = 0;
  private completedTasks = 0;
  private failedTasks = 0;
  private startedAt: string;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private agentInfo: AgentInfo;
  private unsubscribers: Array<() => void> = [];

  constructor(config: AgentHostConfig) {
    this.name = config.name;
    this.role = config.role;
    this.capabilities = config.capabilities;
    this.maxConcurrency = config.maxConcurrency;
    this.registry = config.registry;
    this.delegationManager = config.delegationManager;
    this.contextBus = config.contextBus;
    this.taskExecutor = config.taskExecutor;
    this.startedAt = new Date().toISOString();

    // Register this agent
    this.agentInfo = this.registry.register({
      name: this.name,
      role: this.role,
      capabilities: this.capabilities,
      status: "idle",
      endpoint: `local://${this.name}`,
      maxConcurrency: this.maxConcurrency,
      activeTaskCount: 0
    });
    this.agentId = this.agentInfo.id;

    // Register as delegation handler
    this.delegationManager.registerHandler(this.agentId, this.createDelegationHandler());

    // Subscribe to context bus
    this.setupContextBusSubscriptions();

    // Start heartbeat
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), config.heartbeatIntervalMs);

    // Announce capabilities
    this.contextBus.publish({
      type: "capability.announce",
      fromAgentId: this.agentId,
      topic: "agent.capabilities",
      payload: {
        agentId: this.agentId,
        name: this.name,
        role: this.role,
        capabilities: this.capabilities
      }
    });

    console.log(`[AgentHost] ${this.name} started as ${this.role} (id: ${this.agentId.substring(0, 8)})`);
  }

  /** Delegate a task to another agent in the mesh */
  async delegateTask(
    task: DelegatedTask,
    options: {
      toAgentId?: string;
      requiredCapabilities?: string[];
      preferredRole?: string;
      priority?: number;
      timeoutMs?: number;
    } = {}
  ): Promise<DelegationResult> {
    // Find best agent if not specified
    let targetAgentId = options.toAgentId;
    if (!targetAgentId) {
      const best = this.registry.findBest(
        options.requiredCapabilities || [],
        options.preferredRole
      );
      if (!best) {
        return {
          delegationId: "",
          status: "failed",
          error: "No suitable agent found for delegation",
          retries: 0
        };
      }
      targetAgentId = best.id;
    }

    return new Promise((resolve) => {
      const req = this.delegationManager.createDelegation(
        this.agentId,
        task,
        {
          toAgentId: targetAgentId,
          requiredCapabilities: options.requiredCapabilities,
          preferredRole: options.preferredRole,
          priority: options.priority,
          timeoutMs: options.timeoutMs,
          callbacks: {
            onAccepted: (delegationId, agentId) => {
              console.log(`[AgentHost] Delegation ${delegationId.substring(0, 8)} accepted by ${agentId.substring(0, 8)}`);
            },
            onCompleted: (delegationId, result) => {
              console.log(`[AgentHost] Delegation ${delegationId.substring(0, 8)} completed`);
              resolve(result);
            },
            onFailed: (delegationId, error) => {
              console.log(`[AgentHost] Delegation ${delegationId.substring(0, 8)} failed: ${error}`);
              resolve({
                delegationId,
                status: "failed",
                error,
                retries: 0
              });
            }
          }
        }
      );

      // Send delegation request to target via context bus
      this.contextBus.publish({
        type: "task.result", // Using existing type for delegation delivery
        fromAgentId: this.agentId,
        toAgentId: targetAgentId,
        topic: "delegation.request",
        payload: req,
        ttl: options.timeoutMs || 120000
      });

      // The target agent's handler will process this
      // Results come back via callbacks
    });
  }

  /** Shut down the agent host gracefully */
  async shutdown(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    // Unsubscribe all
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];

    this.delegationManager.unregisterHandler(this.agentId);
    this.registry.unregister(this.agentId);

    this.contextBus.publish({
      type: "alert",
      fromAgentId: this.agentId,
      topic: "agent.shutdown",
      payload: { agentId: this.agentId, name: this.name }
    });

    console.log(`[AgentHost] ${this.name} shut down`);
  }

  getStats(): AgentHostStats {
    return {
      agentId: this.agentId,
      name: this.name,
      role: this.role,
      status: this.status,
      activeTasks: this.activeTaskCount,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      uptime: Date.now() - new Date(this.startedAt).getTime()
    };
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private sendHeartbeat(): void {
    this.status = this.activeTaskCount >= this.maxConcurrency ? "busy" : "idle";
    this.registry.heartbeat({
      agentId: this.agentId,
      status: this.status,
      currentTask: this.activeTaskCount > 0 ? `Executing ${this.activeTaskCount} task(s)` : undefined,
      activeTaskCount: this.activeTaskCount,
      timestamp: new Date().toISOString()
    });
  }

  private createDelegationHandler(): DelegationHandler {
    return {
      onDelegationRequest: async (req: DelegationRequest): Promise<DelegationAck> => {
        // Check if we can accept
        if (this.activeTaskCount >= this.maxConcurrency) {
          return {
            delegationId: req.delegationId,
            accepted: false,
            agentId: this.agentId,
            reason: `At capacity (${this.activeTaskCount}/${this.maxConcurrency})`
          };
        }

        // Check capability match
        const matchesCapability = req.requiredCapabilities.length === 0 ||
          req.requiredCapabilities.some(cap =>
            this.capabilities.some(c => c.toLowerCase().includes(cap.toLowerCase()))
          );

        if (!matchesCapability) {
          return {
            delegationId: req.delegationId,
            accepted: false,
            agentId: this.agentId,
            reason: `Capability mismatch: need [${req.requiredCapabilities.join(", ")}], have [${this.capabilities.join(", ")}]`
          };
        }

        this.activeTaskCount++;
        this.status = this.activeTaskCount >= this.maxConcurrency ? "busy" : "idle";

        return {
          delegationId: req.delegationId,
          accepted: true,
          agentId: this.agentId,
          estimatedMs: 60000
        };
      },

      executeDelegatedTask: async (req: DelegationRequest): Promise<DelegationResult> => {
        try {
          if (!this.taskExecutor) {
            return {
              delegationId: req.delegationId,
              status: "failed",
              error: "No task executor configured",
              retries: 0
            };
          }

          // Update status
          this.status = "busy";
          this.contextBus.publish({
            type: "task.progress",
            fromAgentId: this.agentId,
            topic: "delegation.progress",
            payload: { delegationId: req.delegationId, status: "started" },
            correlationId: req.delegationId
          });

          const result = await this.taskExecutor(req.task);

          // Update counters
          this.activeTaskCount = Math.max(0, this.activeTaskCount - 1);
          if (result.status === "completed") {
            this.completedTasks++;
          } else {
            this.failedTasks++;
          }

          // Share result via context bus
          this.contextBus.setContext(
            `delegation:${req.delegationId}`,
            result,
            this.agentId,
            ["delegation", "result", result.status]
          );

          // Share knowledge from successful tasks
          if (result.status === "completed" && result.result) {
            this.contextBus.publish({
              type: "knowledge.share",
              fromAgentId: this.agentId,
              topic: "task.knowledge",
              payload: {
                task: req.task.goal,
                result: result.result,
                steps: result.steps
              }
            });
          }

          return result;
        } catch (e: any) {
          this.activeTaskCount = Math.max(0, this.activeTaskCount - 1);
          this.failedTasks++;
          return {
            delegationId: req.delegationId,
            status: "failed",
            error: e.message,
            retries: 0
          };
        } finally {
          this.status = this.activeTaskCount >= this.maxConcurrency ? "busy" : "idle";
        }
      },

      onCancelDelegation: async (delegationId: string) => {
        this.activeTaskCount = Math.max(0, this.activeTaskCount - 1);
        this.status = this.activeTaskCount >= this.maxConcurrency ? "busy" : "idle";
        console.log(`[AgentHost] Delegation ${delegationId.substring(0, 8)} cancelled`);
      }
    };
  }

  private setupContextBusSubscriptions(): void {
    // Listen for delegation requests directed to this agent
    const unsub1 = this.contextBus.subscribeAgent(this.agentId, async (msg: ContextMessage) => {
      if (msg.topic === "delegation.request" && msg.type === "task.result") {
        const req = msg.payload as DelegationRequest;
        if (!req || !req.delegationId) return;

        // Handle incoming delegation
        const ack = await this.delegationManager.handleIncoming(this.agentId, req);
        this.delegationManager.updateAcceptance(req.delegationId, ack);

        // Send ack back via context bus
        this.contextBus.publish({
          type: "task.result",
          fromAgentId: this.agentId,
          toAgentId: req.fromAgentId,
          topic: "delegation.ack",
          payload: ack,
          correlationId: req.delegationId
        });

        // If accepted, execute
        if (ack.accepted) {
          const result = await this.delegationManager.executeDelegation(this.agentId, req.delegationId);
          this.contextBus.publish({
            type: "task.result",
            fromAgentId: this.agentId,
            toAgentId: req.fromAgentId,
            topic: "delegation.result",
            payload: result,
            correlationId: req.delegationId
          });
        }
      }
    });
    this.unsubscribers.push(unsub1);

    // Listen for capability requests — respond with our capabilities
    const unsub2 = this.contextBus.subscribe("agent.capabilities", (msg: ContextMessage) => {
      if (msg.type === "capability.request" && msg.fromAgentId !== this.agentId) {
        this.contextBus.publish({
          type: "capability.announce",
          fromAgentId: this.agentId,
          toAgentId: msg.fromAgentId,
          topic: "agent.capabilities",
          payload: {
            agentId: this.agentId,
            name: this.name,
            role: this.role,
            capabilities: this.capabilities,
            status: this.status
          }
        });
      }
    });
    this.unsubscribers.push(unsub2);

    // Listen for knowledge sharing
    const unsub3 = this.contextBus.subscribe("task.knowledge", (msg: ContextMessage) => {
      if (msg.type === "knowledge.share" && msg.fromAgentId !== this.agentId) {
        const payload = msg.payload as any;
        if (payload?.task && payload?.result) {
          // Store shared knowledge in context for future reference
          this.contextBus.setContext(
            `knowledge:${msg.fromAgentId}:${Date.now()}`,
            payload,
            msg.fromAgentId,
            ["knowledge", "shared", "task_result"]
          );
        }
      }
    });
    this.unsubscribers.push(unsub3);
  }
}
