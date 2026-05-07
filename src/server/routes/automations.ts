import type { IncomingMessage } from "node:http";
import { readJsonBody, type ServerContext } from "../util.js";

export async function handleGetAutomations(ctx: ServerContext) {
  const automations = await ctx.app.automationRegistry.list();
  return { automations };
}

export async function handlePostAutomations(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as {
    name?: string;
    goal?: string;
    type?: "manual" | "interval";
    intervalMinutes?: number;
  };

  const name = body.name?.trim();
  const goal = body.goal?.trim();
  if (!name || !goal) {
    return { status: 400, data: { error: "name and goal are required" } };
  }

  const automation = await ctx.app.automationRegistry.create({
    name,
    goal,
    type: body.type,
    intervalMinutes: body.intervalMinutes
  });
  return { status: 201, data: { automation } };
}

export async function handlePostAutomationRun(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const { taskQueue } = ctx;
  const body = (await readJsonBody(req)) as { id?: string };
  const id = body.id?.trim();
  if (!id) {
    return { status: 400, data: { error: "id is required" } };
  }

  const automation = await ctx.app.automationRegistry.get(id);
  if (!automation) {
    return { status: 404, data: { error: "automation not found" } };
  }

  await ctx.app.automationRegistry.markRun(id);
  const task = await taskQueue.enqueue({
    goal: automation.goal,
    source: "automation",
    automationId: automation.id,
    automationName: automation.name
  });
  return { status: 202, data: { automation, task } };
}
