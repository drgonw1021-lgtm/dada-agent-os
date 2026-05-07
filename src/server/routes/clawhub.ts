import type { IncomingMessage } from "node:http";
import { readJsonBody, type ServerContext } from "../util.js";

export async function handleGetClawhubSkills(ctx: ServerContext) {
  const skills = ctx.app.clawhubRuntime.listSkills();
  return { skills };
}

export async function handleGetClawhubSkill(ctx: ServerContext, name: string) {
  const skill = ctx.app.clawhubRuntime.getSkill(name);
  if (!skill) {
    return { status: 404, data: { error: `Skill "${name}" not found` } };
  }
  return { status: 200, data: { skill } };
}

export async function handlePostClawhubSearch(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as { query?: string };
  if (!body.query?.trim()) {
    return { status: 400, data: { error: "query is required" } };
  }
  const results = await ctx.app.clawhubRuntime.searchSkills(body.query.trim());
  return { status: 200, data: { results } };
}

export async function handlePostClawhubInstall(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as { name?: string };
  const name = body.name?.trim();
  if (!name) {
    return { status: 400, data: { error: "name is required" } };
  }
  const result = await ctx.app.clawhubRuntime.installSkill(name);
  return {
    status: result.success ? 200 : 500,
    data: { success: result.success, path: result.path, error: result.error }
  };
}

export async function handlePostClawhubUninstall(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as { name?: string };
  const name = body.name?.trim();
  if (!name) {
    return { status: 400, data: { error: "name is required" } };
  }
  const result = await ctx.app.clawhubRuntime.uninstallSkill(name);
  return {
    status: result.success ? 200 : 400,
    data: { success: result.success, error: result.error }
  };
}
