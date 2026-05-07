import type { ToolDefinition, ToolContext } from "../../core/types.js";

interface UapiSearchInput {
  query: string;
  limit?: number;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  score: number;
  publish_time?: string;
}

interface UapiSearchOutput {
  success: boolean;
  query: string;
  totalResults: number;
  results: SearchResult[];
  provider: string;
  error?: string;
}

export function createUapiSearchTool(): ToolDefinition<UapiSearchInput, UapiSearchOutput> {
  const BASE = "https://uapis.cn/api/v1";

  return {
    id: "uapi.search",
    description: "PREFERRED web search engine. Aggregates Bing + Baidu + other engines with AI ranking. Returns 25 high-quality results with title, URL, snippet, domain, and publish time. Use this instead of 'search' for web searches — it is faster and returns better results.",
    requiredScopes: ["web.fetch"],
    riskLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query. Supports both Chinese and English." },
        limit: { type: "number", description: "Max results to return (default 8, max 25)" }
      },
      required: ["query"]
    },
    async execute(input: UapiSearchInput, _ctx: ToolContext): Promise<UapiSearchOutput> {
      const { query, limit = 8 } = input;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);

        try {
          const resp = await fetch(`${BASE}/search/aggregate`, {
            method: "POST",
            signal: controller.signal,
            headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "DaDa/1.0" },
            body: JSON.stringify({ query, limit: Math.min(limit, 25) })
          });
          if (!resp.ok) {
            const errText = await resp.text().catch(() => "");
            return { success: false, query, totalResults: 0, results: [], provider: "uapi", error: `UAPI ${resp.status}: ${errText.slice(0, 200)}` };
          }
          const data = await resp.json() as any;
          const results: SearchResult[] = (data.results || []).map((r: any) => ({
            title: r.title || "",
            url: r.url || "",
            snippet: (r.snippet || "").replace(/!\[.*?\]\(.*?\)/g, "").replace(/\n{3,}/g, "\n").trim().slice(0, 500),
            domain: r.domain || "",
            score: r.score ?? 0.5,
            publish_time: r.publish_time || undefined
          }));
          console.log(`[uapi.search] UAPI returned ${results.length} results for: "${query.slice(0, 80)}" (total=${data.total_results})`);
          return { success: true, query, totalResults: data.total_results || results.length, results, provider: "uapi" };
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { success: false, query, totalResults: 0, results: [], provider: "uapi", error: `Search failed: ${msg.slice(0, 300)}` };
      }
    }
  };
}
