import type { IncomingMessage } from "node:http";
import { readJsonBody, type ServerContext } from "../util.js";

export async function handleGetApprovals(ctx: ServerContext) {
  const approvals = await ctx.app.approvalStore.list();
  return { approvals };
}

export async function handleGetApprovalPolicy(ctx: ServerContext) {
  const { app } = ctx;
  return {
    preset: app.config.approvalPolicyPreset,
    requireApprovalForHighRisk: app.config.requireApprovalForHighRisk,
    allowHighRiskTools: app.config.allowHighRiskTools,
    autoAllowCommands: app.config.approvalAutoAllowCommands,
    presets: [
      { id: "strict", description: "所有高风险工具都进入审批队列" },
      { id: "balanced", description: "自动放行测试、构建、状态检查等明确安全命令，其它高风险工具审批" },
      { id: "permissive", description: "比 balanced 放行更多本地运行命令，但破坏性命令仍需审批" }
    ]
  };
}

export async function handlePostApprove(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const { taskQueue } = ctx;
  const body = (await readJsonBody(req)) as { id?: string; note?: string };
  const id = body.id?.trim();
  if (!id) {
    return { status: 400, data: { error: "id is required" } };
  }

  const approval = await ctx.app.approvalStore.approve(id, body.note);
  if (!approval) {
    return { status: 404, data: { error: "approval not found" } };
  }

  const task = await taskQueue.retry(approval.taskId, { force: true });
  return { status: 202, data: { approval, task } };
}

export async function handlePostReject(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as { id?: string; note?: string };
  const id = body.id?.trim();
  if (!id) {
    return { status: 400, data: { error: "id is required" } };
  }

  const approval = await ctx.app.approvalStore.reject(id, body.note);
  if (!approval) {
    return { status: 404, data: { error: "approval not found" } };
  }

  await ctx.taskStore.markFailed(
    approval.taskId,
    approval.decisionNote || `Approval rejected for tool "${approval.toolId}"`
  );
  return { status: 200, data: { approval } };
}
