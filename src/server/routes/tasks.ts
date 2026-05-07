import type { IncomingMessage } from "node:http";
import { readJsonBody, type ServerContext } from "../util.js";

export async function handleGetTasks(ctx: ServerContext) {
  const tasks = await ctx.taskQueue.list();
  return { tasks };
}

export async function handleGetTaskStatus(ctx: ServerContext, taskId: string) {
  const task = await ctx.taskQueue.get(taskId);
  if (!task) {
    return { status: 404, data: { error: "task not found" } };
  }
  const progressHistory = ctx.app.progressManager.getHistory(taskId);
  const latestPhase = progressHistory.filter(e => e.type === "phase").pop();
  // Resolve complexity from goal for UI display
  let complexity: string | undefined;
  try {
    const { resolveTaskIntent } = await import("../../tasks/task-intent.js");
    complexity = resolveTaskIntent({ goal: task.goal }).complexity;
  } catch { /* best-effort */ }
  return { status: 200, data: { task: { ...task, complexity }, progress: latestPhase?.payload || null } };
}

export async function handlePostTaskCancel(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as { taskId?: string };
  const taskId = body.taskId?.trim();
  if (!taskId) {
    return { status: 400, data: { error: "taskId is required" } };
  }

  const task = await ctx.taskQueue.cancel(taskId);
  if (!task) {
    const existing = await ctx.taskQueue.get(taskId);
    return {
      status: existing ? 409 : 404,
      data: { error: existing ? "task cannot be cancelled in its current status" : "task not found" }
    };
  }
  return { status: 200, data: { task } };
}

export async function handlePostTaskRetry(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as { taskId?: string };
  const taskId = body.taskId?.trim();
  if (!taskId) {
    return { status: 400, data: { error: "taskId is required" } };
  }

  const task = await ctx.taskQueue.retry(taskId, { force: true });
  if (!task) {
    const existing = await ctx.taskQueue.get(taskId);
    return {
      status: existing ? 409 : 404,
      data: { error: existing ? "task cannot be retried" : "task not found" }
    };
  }
  return { status: 202, data: { task } };
}

export async function handlePostTaskReplayFailed(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const { app } = ctx;
  const body = (await readJsonBody(req)) as {
    taskId?: string;
    limit?: number;
    selfImprove?: boolean;
  };
  const taskId = body.taskId?.trim();
  if (taskId) {
    const task = await ctx.taskQueue.replayFailed(taskId, {
      preferSelfImprove: body.selfImprove === true
    });
    if (!task) {
      const existing = await ctx.taskQueue.get(taskId);
      return {
        status: existing ? 409 : 404,
        data: { error: existing ? "task cannot be replayed" : "task not found" }
      };
    }
    return { status: 202, data: { tasks: [task] } };
  }

  const limit = Number.isFinite(body.limit)
    ? Math.max(1, Math.min(20, Number(body.limit)))
    : app.config.failureReplayLimit;
  const tasks = await ctx.taskQueue.replayFailedBatch(limit, {
    preferSelfImprove: body.selfImprove === true
  });
  return { status: 202, data: { tasks } };
}

export async function handlePostTaskPause(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as { taskId?: string };
  const taskId = body.taskId?.trim();
  if (!taskId) {
    return { status: 400, data: { error: "taskId is required" } };
  }

  const task = await ctx.taskQueue.pause(taskId);
  if (!task) {
    return { status: 404, data: { error: "task not found or cannot be paused" } };
  }
  return { status: 200, data: { task } };
}

export async function handlePostTaskResume(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as { taskId?: string };
  const taskId = body.taskId?.trim();
  if (!taskId) {
    return { status: 400, data: { error: "taskId is required" } };
  }

  const task = await ctx.taskQueue.resume(taskId);
  if (!task) {
    return { status: 404, data: { error: "task not found or cannot be resumed" } };
  }
  return { status: 202, data: { task } };
}
