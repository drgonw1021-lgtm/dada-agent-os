import type { ServerContext } from "../util.js";

export async function handleGetAgents(ctx: ServerContext) {
  const agents = ctx.app.agentRegistry.list().map(a => ({
    id: a.id,
    name: a.name,
    role: a.role,
    capabilities: a.capabilities,
    status: a.status,
    activeTaskCount: a.activeTaskCount,
    maxConcurrency: a.maxConcurrency,
    lastHeartbeat: a.lastHeartbeat
  }));
  return { agents, stats: ctx.app.agentRegistry.getStats() };
}

export async function handleGetContextBus(ctx: ServerContext) {
  return ctx.app.contextBus.getStats();
}

export async function handleGetDelegations(ctx: ServerContext) {
  return { active: ctx.app.delegationManager.listActive().map(r => ({
    delegationId: r.delegationId,
    fromAgentId: r.fromAgentId,
    toAgentId: r.toAgentId,
    task: r.task.goal,
    priority: r.priority,
    createdAt: r.createdAt
  }))};
}
