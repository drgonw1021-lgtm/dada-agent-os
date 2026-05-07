import type { IncomingMessage } from "node:http";
import { readJsonBody, type ServerContext } from "../util.js";

export async function handlePostIndex(ctx: ServerContext) {
  const kb = ctx.app.knowledgeBase;
  const result = await kb.index();
  return {
    status: 200,
    data: { ok: true, ...result, at: new Date().toISOString() }
  };
}

export async function handleGetSearch(ctx: ServerContext, query: string, topK: number = 5) {
  if (!query.trim()) {
    return { status: 400, data: { error: "Query parameter 'q' is required" } };
  }
  const kb = ctx.app.knowledgeBase;
  const k = Math.min(topK, 10);
  const results = await kb.query(query, k);
  const contextString = await kb.getContextString(query, k, 3000);
  return {
    status: 200,
    data: {
      query,
      topK: k,
      results,
      contextString: contextString || null,
      resultCount: results.length
    }
  };
}

export async function handleGetStats(ctx: ServerContext) {
  const kb = ctx.app.knowledgeBase;
  return {
    status: 200,
    data: kb.getStats()
  };
}

export async function handlePostReindex(ctx: ServerContext) {
  const kb = ctx.app.knowledgeBase;
  const result = await kb.reindex();
  return {
    status: 200,
    data: { ok: true, ...result, at: new Date().toISOString() }
  };
}

export async function handlePostClear(ctx: ServerContext) {
  await ctx.app.knowledgeBase.clear();
  return {
    status: 200,
    data: { ok: true, message: "Knowledge base cleared" }
  };
}
