import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJsonBody, json, error, type ServerContext } from "../util.js";
import { buildCapabilityRoutePlan } from "../../capabilities/capability-router.js";
import { resolveTaskIntent } from "../../tasks/task-intent.js";
import type { ProgressEvent } from "../../progress-manager.js";

export async function handlePostRun(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as { goal?: string };
  const goal = body.goal?.trim();
  if (!goal) {
    return { status: 400, data: { error: "goal is required" } };
  }
  // Route through the task queue for proper lifecycle management (cancel, pause, artifacts)
  const intent = resolveTaskIntent({ goal });
  const task = await ctx.taskQueue.enqueue({
    goal,
    source: "manual",
    taskType: intent.taskType,
    outputFormat: intent.outputFormat,
  });
  return { status: 202, data: { task, intent } };
}

export async function handlePostRunAsync(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const { app, taskQueue } = ctx;
  const body = (await readJsonBody(req)) as {
    goal?: string;
    taskType?: import("../../core/types.js").TaskType;
    outputFormat?: import("../../core/types.js").OutputFormat;
    attachments?: import("../../core/types.js").TaskAttachment[];
    modelOverrides?: import("../../core/types.js").TaskModelOverrides;
    projectId?: string;
    executionMode?: import("../../core/types.js").ExecutionMode;
    collaborationMode?: import("../../core/types.js").CollaborationMode;
  };
  const goal = body.goal?.trim();
  if (!goal) {
    return { status: 400, data: { error: "goal is required" } };
  }
  const intent = resolveTaskIntent({
    goal,
    taskType: body.taskType,
    outputFormat: body.outputFormat,
    attachments: body.attachments
  });

  const task = await taskQueue.enqueue({
    goal,
    source: "manual",
    taskType: intent.taskType,
    outputFormat: intent.outputFormat,
    attachments: body.attachments,
    modelOverrides: body.modelOverrides,
    projectId: body.projectId,
    executionMode: body.executionMode,
    collaborationMode: body.collaborationMode,
    modeTrigger: body.executionMode ? "manual" : "auto",
  });
  const capabilityPlan = buildCapabilityRoutePlan({
    goal,
    intent,
    availableTools: app.availableTools,
    skills: app.skills.list()
  });
  return { status: 202, data: { task, intent, capabilityPlan } };
}

export function handlePostRunStream(
  ctx: ServerContext,
  req: IncomingMessage,
  res: ServerResponse
): void {
  const { app } = ctx;

  (async () => {
    const body = (await readJsonBody(req)) as { goal?: string };
    const goal = body.goal?.trim();
    if (!goal) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "goal is required" }));
      return;
    }

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      Connection: "keep-alive",
    });
    res.write("\n");

    const emit = (type: string, data: unknown) => {
      if (!res.writableEnded) {
        res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      }
    };

    // Generate taskId upfront so we can attach progress listener before running
    const taskId = randomUUID();

    // Pipe live progress events into SSE stream
    const progressListener = (ev: ProgressEvent) => {
      emit(ev.type, ev);
    };
    app.progressManager.attach(taskId, progressListener);

    try {
      emit("status", { phase: "starting", goal, taskId });

      const result = await app.runtime.runTask({ goal, taskId });

      emit("status", { phase: "complete", result: result.success });
      emit("result", result);
      emit("done", {});
    } catch (e: any) {
      emit("error", { message: e.message });
    } finally {
      app.progressManager.detach(taskId, progressListener);
      res.end();
    }
  })().catch((e) => {
    if (!res.writableEnded) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

export function handleGetProgress(
  ctx: ServerContext,
  req: IncomingMessage,
  res: ServerResponse,
  taskId: string
): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    Connection: "keep-alive"
  });
  res.write("\n");

  // Attach listener FIRST to avoid race condition where events fire
  // between getHistory and attach (would be silently lost).
  const seenTypes = new Set<string>();
  const listener = (ev: ProgressEvent) => {
    seenTypes.add(ev.type);
    res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    // If we just received a terminal event, close proactively
    if (ev.type === "task.completed" || ev.type === "task.failed") {
      if (!res.writableEnded) res.end();
    }
  };
  ctx.app.progressManager.attach(taskId, listener);

  // Replay history AFTER attach — duplicates for the same type are
  // deduped via seenTypes (the listener already saw them live).
  const history = ctx.app.progressManager.getHistory(taskId);
  for (const ev of history) {
    if (!seenTypes.has(ev.type) || ev.type !== "task.completed" && ev.type !== "task.failed") {
      res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`);
    }
  }

  req.on("close", () => {
    ctx.app.progressManager.detach(taskId, listener);
  });
  // Safety: if no terminal event within 60s, close the stream
  const safetyTimer = setTimeout(() => {
    if (!res.writableEnded) {
      res.write(`event: task.failed\ndata: ${JSON.stringify({ error: "SSE timeout — no terminal event received within 60s" })}\n\n`);
      res.end();
    }
  }, 60_000);
  req.on("close", () => clearTimeout(safetyTimer));
}
