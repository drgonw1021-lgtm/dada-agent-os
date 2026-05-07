import type { IncomingMessage } from "node:http";
import { readJsonBody, type ServerContext } from "../util.js";
import { domainLearner } from "../../domains/domain-learner.js";

export async function handleGetDomainStatus(ctx: ServerContext) {
  const { app } = ctx;
  const status =
    app.domainEngine && typeof (app.domainEngine as any).getStatus === "function"
      ? (app.domainEngine as any).getStatus()
      : null;
  return { domainEngine: status };
}

export async function handlePostDomainPlan(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as { goal?: string };
  const goal = body.goal?.trim();
  if (!goal) {
    return { status: 400, data: { error: "goal is required" } };
  }

  const domainEngine = ctx.app.domainEngine as any;
  const plan = domainEngine?.plan
    ? await domainEngine.plan(goal)
    : `PLAN generic\nNOTE domainEngine not available for goal: ${goal}`;
  return { status: 200, data: { plan } };
}

export async function handleGetLearningStats(_ctx: ServerContext) {
  const stats = domainLearner.getStats();
  const learnings = domainLearner.getLearnings();
  const history = domainLearner.getReasoningHistory();
  return {
    stats,
    learnings: learnings.slice(-10),
    recentReasoning: history.slice(-5)
  };
}

export async function handlePostLearningThink(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as { goal?: string; domain?: string };
  const goal = body.goal?.trim();
  const domain = body.domain || "generic";
  if (!goal) {
    return { status: 400, data: { error: "goal is required" } };
  }

  const domainEngine = ctx.app.domainEngine as any;
  const completer = domainEngine?.completer;

  const result = await domainLearner.think(goal, domain, async (depth) => {
    if (completer) {
      try {
        const response = await completer(`[深度 ${depth}] 分析: ${goal}`);
        return { thought: response, confidence: 0.5 + depth * 0.1 };
      } catch {}
    }
    return { thought: `推理深度 ${depth} 完成`, confidence: 0.5 + depth * 0.1 };
  });

  return { status: 200, data: { result } };
}
