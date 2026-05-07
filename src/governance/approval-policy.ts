import type { ToolDefinition } from "../core/types.js";

export type ApprovalPolicyPreset = "strict" | "balanced" | "permissive";
export type ApprovalPolicyAction = "allow" | "require_approval" | "block";

export interface ApprovalPolicyOptions {
  preset: ApprovalPolicyPreset;
  autoAllowCommands?: string[];
}

export interface ApprovalPolicyDecision {
  action: ApprovalPolicyAction;
  reason: string;
}

const SAFE_BALANCED_COMMANDS = [
  /^npm(\.cmd)?\s+run\s+(check|build|test|verify|doctor)\s*$/i,
  /^node\s+--version\s*$/i,
  /^npm(\.cmd)?\s+--version\s*$/i,
  /^git\s+(status|diff|log|show)(\s+.*)?$/i,
  /^rg(\s+.*)?$/i,
  // Safe read-only filesystem commands
  /^(ls|dir)(\s+.*)?$/i,
  /^(cat|type)\s+.*$/i,
  /^(echo|pwd|cd)\b.*$/i,
  /^(head|tail|wc)\s+.*$/i,
  /^(find|findstr|grep)\s+((?!-delete|-exec|rm).)*$/i
];

const SAFE_PERMISSIVE_COMMANDS = [
  ...SAFE_BALANCED_COMMANDS,
  /^npm(\.cmd)?\s+run\s+(dev|dev:ui|start:ui|start:ready)\s*$/i,
  /^node\s+dist\/server\.js\s*$/i
];

const DANGEROUS_COMMAND_TOKENS = [
  /\brm\s+(-|\/)/i,
  /\brmdir\b/i,
  /\bdel\b/i,
  /\berase\b/i,
  /\bremove-item\b/i,
  /\bgit\s+(reset|clean)\b/i,
  /\bformat\b/i,
  /\bshutdown\b/i,
  /\bset-executionpolicy\b/i,
  />/,
  /\|\s*iex\b/i
];

function getShellCommand(input: unknown): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const command = (input as { command?: unknown }).command;
  return typeof command === "string" ? command.trim() : undefined;
}

function hasDangerousShellToken(command: string): boolean {
  return DANGEROUS_COMMAND_TOKENS.some((pattern) => pattern.test(command));
}

function matchesCommand(command: string, patterns: string[]): boolean {
  return patterns.some((pattern) => command.toLowerCase() === pattern.trim().toLowerCase());
}

export function evaluateApprovalPolicy(
  tool: ToolDefinition<unknown, unknown>,
  input: unknown,
  options: ApprovalPolicyOptions
): ApprovalPolicyDecision {
  const risk = tool.riskLevel ?? "low";
  if (risk !== "high") {
    return { action: "allow", reason: "Tool is not high risk" };
  }

  if (options.preset === "strict") {
    return { action: "require_approval", reason: "Strict policy requires approval for high-risk tools" };
  }

  const command = tool.id === "shell.exec" ? getShellCommand(input) : undefined;
  if (command) {
    if (hasDangerousShellToken(command)) {
      return { action: "require_approval", reason: "Shell command contains potentially destructive tokens" };
    }

    if (matchesCommand(command, options.autoAllowCommands ?? [])) {
      return { action: "allow", reason: "Shell command is explicitly auto-allowed" };
    }

    const safePatterns =
      options.preset === "permissive" ? SAFE_PERMISSIVE_COMMANDS : SAFE_BALANCED_COMMANDS;
    if (safePatterns.some((pattern) => pattern.test(command))) {
      return { action: "allow", reason: `${options.preset} policy auto-allows read/check command` };
    }
  }

  if (options.preset === "permissive" && tool.id === "code.exec") {
    return { action: "require_approval", reason: "Code execution still requires approval in permissive policy" };
  }

  return { action: "require_approval", reason: "High-risk tool does not match an auto-allow policy" };
}
