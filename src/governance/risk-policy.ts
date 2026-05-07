import type { ToolDefinition } from "../core/types.js";
import {
  evaluateApprovalPolicy,
  type ApprovalPolicyPreset
} from "./approval-policy.js";

export interface RiskPolicyOptions {
  allowHighRisk: boolean;
  requireApprovalForHighRisk?: boolean;
  approvalPolicyPreset?: ApprovalPolicyPreset;
  approvalAutoAllowCommands?: string[];
}

export class RiskPolicy {
  constructor(private readonly options: RiskPolicyOptions) {}

  getDecision(
    tool: ToolDefinition<unknown, unknown>,
    input?: unknown
  ): "allow" | "require_approval" | "block" {
    const risk = tool.riskLevel ?? "low";
    if (risk !== "high") {
      return "allow";
    }

    if (this.options.allowHighRisk) {
      return "allow";
    }

    if (this.options.requireApprovalForHighRisk ?? false) {
      return evaluateApprovalPolicy(tool, input, {
        preset: this.options.approvalPolicyPreset ?? "balanced",
        autoAllowCommands: this.options.approvalAutoAllowCommands
      }).action;
    }

    return "block";
  }

  update(partial: Partial<RiskPolicyOptions>): void {
    Object.assign(this.options, partial);
  }

  assertToolAllowed(tool: ToolDefinition<unknown, unknown>): void {
    if (this.getDecision(tool) === "block") {
      throw new Error(`Tool "${tool.id}" is blocked by risk policy (high risk disabled)`);
    }
  }
}
