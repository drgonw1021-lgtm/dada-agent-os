import { ApprovalRequiredError, ToolNotFoundError } from "../core/errors.js";
import type { ToolDefinition, ToolContext, ToolStreamChunk } from "../core/types.js";
import { ApprovalStore } from "../governance/approval-store.js";
import { PermissionGate } from "../governance/permission-gate.js";
import { RiskPolicy } from "../governance/risk-policy.js";
import type { McpManager } from "../mcp/mcp-manager.js";

export interface ToolInfo {
  id: string;
  description: string;
  inputSchema?: import("../core/types.js").ToolParam;
  riskLevel?: string;
  available: boolean;
  unavailableReason?: string;
  hasStream?: boolean;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<unknown, unknown>>();
  private readonly unavailable = new Map<string, string>();
  private mcpManager: McpManager | null = null;

  constructor(
    private readonly permissionGate: PermissionGate,
    private readonly riskPolicy: RiskPolicy,
    private readonly approvalStore?: ApprovalStore
  ) {}

  setMcpManager(mcp: McpManager): void {
    this.mcpManager = mcp;
  }

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    this.tools.set(tool.id, tool as ToolDefinition<unknown, unknown>);
  }

  markUnavailable(id: string, reason: string): void {
    this.unavailable.set(id, reason);
    this.tools.delete(id);
  }

  /** Run capability checks on registered tools. Each check returns { available, reason }. Unavailable tools are marked and removed from the active registry. */
  async runCapabilityChecks(checks: Array<{ id: string; check: () => Promise<{ available: boolean; reason?: string }> }>): Promise<Array<{ id: string; available: boolean; reason: string }>> {
    const results: Array<{ id: string; available: boolean; reason: string }> = [];
    for (const { id, check } of checks) {
      if (!this.tools.has(id)) continue;
      try {
        const result = await check();
        if (!result.available) {
          const reason = result.reason ?? "Capability check failed";
          this.markUnavailable(id, reason);
        }
        results.push({ id, available: result.available, reason: result.reason ?? "Available" });
      } catch (err) {
        const reason = `Capability check error: ${err instanceof Error ? err.message : String(err)}`;
        this.markUnavailable(id, reason);
        results.push({ id, available: false, reason });
      }
    }
    return results;
  }

  getCapabilityReport(): { total: number; available: number; unavailable: Array<{ id: string; reason: string }> } {
    const allIds = new Set([
      ...Array.from(this.tools.keys()),
      ...Array.from(this.unavailable.keys())
    ]);
    const unavailableList = Array.from(this.unavailable.entries()).map(([id, reason]) => ({ id, reason }));
    return {
      total: allIds.size,
      available: this.tools.size,
      unavailable: unavailableList
    };
  }

  list(): ToolInfo[] {
    const builtin: ToolInfo[] = Array.from(this.tools.values()).map((tool) => ({
      id: tool.id,
      description: tool.description,
      inputSchema: tool.inputSchema,
      riskLevel: tool.riskLevel,
      available: true,
      hasStream: !!tool.executeStream
    }));
    for (const [id, reason] of this.unavailable) {
      builtin.push({ id, description: reason, riskLevel: "low", available: false, unavailableReason: reason });
    }
    if (this.mcpManager) {
      const mcpTools = this.mcpManager.listTools();
      for (const mt of mcpTools) {
        builtin.push({
          id: mt.id,
          description: mt.description,
          inputSchema: mt.inputSchema as import("../core/types.js").ToolParam,
          riskLevel: "medium",
          available: true
        });
      }
    }
    return builtin;
  }

  async execute<TInput, TOutput>(
    toolId: string,
    input: TInput,
    context: ToolContext
  ): Promise<TOutput> {
    // Route MCP tools dynamically
    if (toolId.startsWith("mcp:") && this.mcpManager) {
      const result = await this.mcpManager.callTool(toolId, input as Record<string, unknown>);
      if (!result.success) {
        throw new Error(result.error || `MCP tool ${toolId} failed`);
      }
      return result.result as TOutput;
    }

    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new ToolNotFoundError(toolId);
    }

    this.permissionGate.assert(tool.id, tool.requiredScopes);
    const decision = this.riskPolicy.getDecision(tool, input);
    if (decision === "block") {
      this.riskPolicy.assertToolAllowed(tool);
    }

    if (decision === "require_approval") {
      const approved = this.approvalStore
        ? await this.approvalStore.findUsableApproval({
            lineageTaskId: context.taskLineageId,
            toolId,
            input
          })
        : undefined;

      if (!approved) {
        if (!this.approvalStore) {
          throw new Error(`Tool "${tool.id}" requires approval but approval store is unavailable`);
        }
        const request = await this.approvalStore.ensurePending({
          taskId: context.taskId,
          lineageTaskId: context.taskLineageId,
          goal: context.goal,
          toolId,
          input,
          reason: `High-risk tool "${tool.id}" requested by agent`
        });
        throw new ApprovalRequiredError(tool.id, request.id);
      }

      await this.approvalStore?.consume(approved.id);
    }

    return tool.execute(input as never, context) as Promise<TOutput>;
  }

  async executeStream<TInput>(
    toolId: string,
    input: TInput,
    context: ToolContext,
    onProgress: (chunk: ToolStreamChunk) => void
  ): Promise<unknown> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new ToolNotFoundError(toolId);
    }

    if (!tool.executeStream) {
      // Fall back to regular execute — no progress events
      return tool.execute(input as never, context);
    }

    this.permissionGate.assert(tool.id, tool.requiredScopes);
    const decision = this.riskPolicy.getDecision(tool, input);
    if (decision === "block") {
      this.riskPolicy.assertToolAllowed(tool);
    }
    if (decision === "require_approval") {
      const approved = this.approvalStore
        ? await this.approvalStore.findUsableApproval({
            lineageTaskId: context.taskLineageId,
            toolId,
            input
          })
        : undefined;
      if (!approved) {
        if (!this.approvalStore) {
          throw new Error(`Tool "${tool.id}" requires approval but approval store is unavailable`);
        }
        const request = await this.approvalStore.ensurePending({
          taskId: context.taskId,
          lineageTaskId: context.taskLineageId,
          goal: context.goal,
          toolId,
          input,
          reason: `High-risk tool "${tool.id}" requested by agent`
        });
        throw new ApprovalRequiredError(tool.id, request.id);
      }
      await this.approvalStore?.consume(approved.id);
    }

    return tool.executeStream(input as never, context, onProgress);
  }
}
