import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";

export interface SearchInput {
  query: string;
  type?: "web" | "code" | "docs";
  maxResults?: number;
}

export interface SearchOutput {
  success: boolean;
  results?: Array<{
    title: string;
    url?: string;
    content: string;
    snippet?: string;
    relevance?: number;
  }>;
  error?: string;
  provider?: string;
  /** Backend tier: "api" (Brave/Serper), "self-hosted" (SearXNG), "free-scrape" (DDG/Bing) */
  sourceTier?: "api" | "self-hosted" | "free-scrape";
  /** Hint shown to user when no API key is configured */
  setupHint?: string;
}

function hasCJK(text: string): boolean {
  return /[一-鿿㐀-䶿]/.test(text);
}

// ── Brave Search API ─────────────────────────────────────────────────
// Free tier: 2,000 queries/month. Sign up at https://brave.com/search/api/
// Set BRAVE_SEARCH_API_KEY in .env

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
}

interface BraveSearchResponse {
  web?: { results?: BraveWebResult[] };
}

async function searchBrave(
  query: string,
  maxResults: number,
  apiKey: string,
  country?: string
): Promise<Array<{ title: string; url: string; content: string }>> {
  const params = new URLSearchParams({ q: query, count: String(maxResults) });
  if (country) params.set("country", country);

  const resp = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params}`,
    {
      headers: {
        "Accept": "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey
      },
      signal: AbortSignal.timeout(15000)
    }
  );
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Brave Search API ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await resp.json()) as BraveSearchResponse;
  return (data.web?.results || []).map(r => ({
    title: r.title,
    url: r.url,
    content: r.description
  }));
}

interface SerperResponse {
  organic?: Array<{ title: string; link: string; snippet: string }>;
}

async function searchSerper(
  query: string,
  maxResults: number,
  apiKey: string
): Promise<Array<{ title: string; url: string; content: string }>> {
  const resp = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ q: query, num: maxResults }),
    signal: AbortSignal.timeout(15000)
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Serper API ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await resp.json()) as SerperResponse;
  return (data.organic || []).map(r => ({
    title: r.title,
    url: r.link,
    content: r.snippet
  }));
}

// ── Tavily Search API ────────────────────────────────────────────────
// AI-optimized search API. Usage-based free tier. https://tavily.com
// Set TAVILY_API_KEY in .env or .env.local

interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface TavilyResponse {
  results?: TavilyResult[];
  response_time?: number;
}

async function searchTavily(
  query: string,
  maxResults: number,
  apiKey: string
): Promise<Array<{ title: string; url: string; content: string }>> {
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: maxResults, search_depth: "basic" }),
    signal: AbortSignal.timeout(15000)
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Tavily API ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await resp.json()) as TavilyResponse;
  return (data.results || []).map(r => ({
    title: r.title,
    url: r.url,
    content: r.content
  }));
}

function refineQuery(query: string, isChinese: boolean): string {
  const q = query.toLowerCase();
  // Disambiguate "pet" from PET plastic when context is supplies/market/industry
  if (/\bpet\b/.test(q) && !/\b(pet plastic|polyester|polyethylene|recycling|bottle)\b/.test(q)) {
    if (/\b(supplies|market|industry|care|food|toy|accessor|shop|store|owner|dog|cat|animal)\b/.test(q)) {
      return query; // already has disambiguating context
    }
    return `${query} pet industry market`;
  }
  return query;
}

type CompleterFn = (prompt: string) => Promise<string>;

export function createSearchTool(completer?: CompleterFn): ToolDefinition<SearchInput, SearchOutput> {
  const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";


  // ── AI relevance filter ──────────────────────────────────────────────
  async function filterByRelevance(
    query: string,
    results: Array<{ title: string; url: string; content: string }>
  ): Promise<Array<{ title: string; url: string; content: string; relevance?: number }>> {
    if (!completer || results.length === 0) return results;

    const items = results.map((r, i) =>
      `[${i}] Title: ${r.title}\n   Snippet: ${r.content.substring(0, 200)}`
    ).join("\n\n");

    try {
      const response = await completer(
        `Rate how relevant each result is to the query "${query}" on a scale of 0-1. ` +
        `Return ONLY a JSON array of numbers, one per result, like [0.9, 0.3, 0.7].\n\n${items}`
      );
      const jsonMatch = response.match(/\[[\d.,\s]+\]/);
      if (jsonMatch) {
        const scores = JSON.parse(jsonMatch[0]) as number[];
        const scored = results.map((r, i) => ({ ...r, relevance: scores[i] ?? 0.5 }));
        const sorted = scored.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
        const relevant = sorted.filter(r => (r.relevance ?? 0) >= 0.3);
        // If nothing is relevant, return empty — don't feed garbage results to the model
        if (relevant.length === 0) return [];
        const keepCount = Math.max(2, Math.ceil(sorted.length * 0.6));
        return relevant.slice(0, keepCount);
      }
    } catch { /* fall through */ }
    return results;
  }

  // ── Dedup helper ──────────────────────────────────────────────────────
  function dedupByUrl(results: Array<{ title: string; url: string; content: string }>) {
    const seen = new Set<string>();
    return results.filter(r => {
      const key = r.url;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Bing parser ──────────────────────────────────────────────────────
  async function searchBing(query: string, maxResults: number, useIntl = false): Promise<Array<{ title: string; url: string; content: string }>> {
    const results: Array<{ title: string; url: string; content: string }> = [];
    const bingHost = useIntl ? "www.bing.com" : "cn.bing.com";
    const langHeader = useIntl ? "en-US,en;q=0.9" : "zh-CN,zh;q=0.9,en;q=0.8";
    try {
      const resp = await fetch(
        `https://${bingHost}/search?q=${encodeURIComponent(query)}&count=${maxResults}`,
        { headers: { "User-Agent": ua, "Accept-Language": langHeader }, signal: AbortSignal.timeout(12000) }
      );
      if (!resp.ok) return results;
      const html = await resp.text();

      // Strategy 1: b_algo blocks with H2 title links
      const blockRegex = /<li class="b_algo"[^>]*>([\s\S]*?)<\/li>/gi;
      let blockMatch;
      while ((blockMatch = blockRegex.exec(html)) !== null && results.length < maxResults) {
        const block = blockMatch[1];
        // H2-wrapped title link (most reliable)
        const titleLinkMatch = /<h2[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
          || /<a[^>]*target="_blank"[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block)
          || /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
        const captionMatch = /<p class="b_lineclamp\d"[^>]*>([\s\S]*?)<\/p>/i.exec(block)
          || /<div class="b_caption"[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/i.exec(block)
          || /<span class="b_algoSlug"[^>]*>([\s\S]*?)<\/span>/i.exec(block);
        if (titleLinkMatch) {
          const title = titleLinkMatch[2].replace(/<[^>]*>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").trim();
          const url = titleLinkMatch[1];
          const snippet = (captionMatch?.[1] || "").replace(/<[^>]*>/g, "").replace(/&ensp;|&#0183;|&nbsp;/g, " ").trim();
          if (title && url.startsWith("http") && !url.includes("bing.com")) {
            results.push({ title, url, content: snippet || title });
          }
        }
      }

      // Strategy 2: broader pattern — any H2 containing an anchor
      if (results.length < maxResults) {
        const h2Regex = /<h2[^>]*>\s*<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi;
        let h2m;
        while ((h2m = h2Regex.exec(html)) !== null && results.length < maxResults) {
          const url = h2m[1];
          const title = h2m[2].replace(/<[^>]*>/g, "").trim();
          if (title && url.startsWith("http") && !url.includes("bing.com") && !results.some(r => r.url === url)) {
            results.push({ title, url, content: title });
          }
        }
      }
    } catch { /* fall through */ }
    return results;
  }

  // ── SearXNG meta-search engine (self-hosted) ──────────────────────────
  // Set SEARXNG_ENDPOINT in .env to enable. Not tried when unconfigured.
  async function searchSearXng(query: string, maxResults: number): Promise<Array<{ title: string; url: string; content: string }>> {
    const results: Array<{ title: string; url: string; content: string }> = [];
    const endpoint = process.env.SEARXNG_ENDPOINT;
    if (!endpoint) return results;
    try {
      const resp = await fetch(
        `${endpoint}/search?q=${encodeURIComponent(query)}&format=json&pageno=1`,
        { headers: { "User-Agent": ua }, signal: AbortSignal.timeout(8000) }
      );
      if (!resp.ok) return results;
      const data = await resp.json() as { results?: Array<{ title: string; url: string; content?: string; snippet?: string }> };
      for (const r of data.results || []) {
        if (results.length >= maxResults) break;
        if (r.url && r.title) {
          results.push({ title: r.title, url: r.url, content: r.content || r.snippet || r.title });
        }
      }
    } catch { /* SearXNG offline, continue */ }
    return results;
  }

  // ── DuckDuckGo JSON API ──────────────────────────────────────────────
  async function searchDuckDuckGoInstant(query: string): Promise<Array<{ title: string; url: string; content: string }>> {
    const results: Array<{ title: string; url: string; content: string }> = [];
    try {
      // Instant Answer API — returns structured JSON for many queries
      const resp = await fetch(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1&t=dada-agent`,
        { headers: { "User-Agent": ua }, signal: AbortSignal.timeout(12000) }
      );
      if (!resp.ok) return results;
      const data = await resp.json() as Record<string, unknown>;

      // Abstract + AbstractURL
      if (data.Abstract && typeof data.Abstract === "string" && data.Abstract.trim()) {
        results.push({
          title: (data.Heading as string) || query,
          url: (data.AbstractURL as string) || `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
          content: data.Abstract.substring(0, 500)
        });
      }
      // RelatedTopics
      const topics = data.RelatedTopics as Array<{ Text?: string; FirstURL?: string }> | undefined;
      if (topics) {
        for (const topic of topics) {
          if (topic.Text && topic.FirstURL) {
            const text = topic.Text.replace(/<[^>]*>/g, "").trim();
            if (text && results.length < 8) {
              results.push({ title: text.substring(0, 100), url: topic.FirstURL, content: text.substring(0, 300) });
            }
          }
        }
      }
    } catch { /* fall through */ }
    return results;
  }

  // ── DuckDuckGo HTML (lite) ───────────────────────────────────────────
  async function searchDuckDuckGoHtml(query: string, maxResults: number): Promise<Array<{ title: string; url: string; content: string }>> {
    const results: Array<{ title: string; url: string; content: string }> = [];
    try {
      const resp = await fetch(
        `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
        { headers: { "User-Agent": ua }, signal: AbortSignal.timeout(12000) }
      );
      if (!resp.ok) return results;
      const html = await resp.text();

      // Strategy 1: classic result__a / result__snippet classes
      const regex1 = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
      let match;
      while ((match = regex1.exec(html)) !== null && results.length < maxResults) {
        const url = decodeURIComponent(match[1] || "");
        const title = match[2]?.replace(/<[^>]*>/g, "").trim() || "Untitled";
        const snippet = match[3]?.replace(/<[^>]*>/g, "").trim() || "";
        if (url.startsWith("http") && !url.includes("duckduckgo.com")) {
          results.push({ title, url, content: snippet });
        }
      }

      // Strategy 2: newer DDG HTML structure — data-testid or generic link extraction
      if (results.length < maxResults) {
        const regex2 = /<a[^>]*href="(https?:\/\/[^"]+)"[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
        let m2;
        while ((m2 = regex2.exec(html)) !== null && results.length < maxResults) {
          const url = m2[1];
          const title = m2[2]?.replace(/<[^>]*>/g, "").replace(/<b>/g, "").replace(/<\/b>/g, "").trim();
          if (title && url.startsWith("http") && !url.includes("duckduckgo.com") && !results.some(r => r.url === url)) {
            results.push({ title, url: decodeURIComponent(url), content: title });
          }
        }
      }

      // Strategy 3: generic external links with text content
      if (results.length < maxResults) {
        const regex3 = /<a[^>]*rel="nofollow"[^>]*href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
        let m3;
        while ((m3 = regex3.exec(html)) !== null && results.length < maxResults) {
          const url = m3[1];
          const title = m3[2]?.replace(/<[^>]*>/g, "").trim();
          if (title && url.startsWith("http") && !url.includes("duckduckgo.com") && !results.some(r => r.url === url)) {
            results.push({ title, url: decodeURIComponent(url), content: title });
          }
        }
      }
    } catch { /* fall through */ }
    return results;
  }

  return {
    id: "search",
    description: "Search the web, code repositories, or documentation for information. Uses multiple engines with AI relevance filtering.",
    requiredScopes: ["web.fetch"] as PermissionScope[],
    riskLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query string. Use English for technical topics, Chinese for local content." },
        type: { type: "string", enum: ["web", "code", "docs"], description: "Search type: web, code, or docs (default web)" },
        maxResults: { type: "number", description: "Maximum number of results (default 8)" }
      },
      required: ["query"]
    },
    async execute(input: SearchInput, _context: ToolContext): Promise<SearchOutput> {
      const { query, type = "web", maxResults = 8 } = input;

      try {
        if (type === "web") {
          let results: Array<{ title: string; url: string; content: string }> = [];
          const isChinese = hasCJK(query);

          // ── Query refinement for ambiguous terms ─────────────────────
          const refinedQuery = refineQuery(query, isChinese);
          let searchQuery = refinedQuery !== query ? refinedQuery : query;

          // ── Time-aware query enhancement: append current year for recency queries ──
          const now = new Date();
          const currentYear = String(now.getFullYear());
          const isRecentQuery = /\b(最近|最新|latest|recent|new\b|news|2026|trends|breaking|this week|this month|this year)\b/i.test(searchQuery);
          if (isRecentQuery && !searchQuery.includes(currentYear)) {
            searchQuery = `${searchQuery} ${currentYear}`;
          }

          // ── AI-powered query optimization ────────────────────────────
          if (completer) {
            try {
              const dateStr = now.toISOString().split("T")[0] ?? "";
              const optimized = await completer(
                `Today is ${dateStr}. Rewrite this search query to get the most relevant results from a web search engine. ` +
                `Add disambiguating context words, remove ambiguous terms, and make it specific. ` +
                `If the query is about recent events or news, include the year "${currentYear}" to ensure fresh results. ` +
                `Return ONLY the rewritten query, nothing else.\n\nQuery: ${searchQuery}`
              );
              const cleaned = optimized.trim().replace(/^["']|["']$/g, "");
              if (cleaned.length > 5 && cleaned.length < 200) {
                searchQuery = cleaned;
              }
            } catch { /* keep original */ }
          }

          let provider = "";

          // ── Tavily Search API (primary — AI-optimized) ─────────────────────
          const tavilyApiKey = process.env.TAVILY_API_KEY;
          if (tavilyApiKey) {
            try {
              results = await searchTavily(searchQuery, maxResults, tavilyApiKey);
              provider = "tavily";
              if (results.length > 0) {
                console.log(`[search] Tavily returned ${results.length} results for: "${searchQuery.slice(0, 80)}"`);
              }
            } catch (e) {
              console.warn(`[search] Tavily failed, falling back: ${(e as Error).message}`);
            }
          }

          // ── Brave Search API (secondary, if key available) ──────────────────
          const braveApiKey = process.env.BRAVE_SEARCH_API_KEY;
          if (results.length === 0 && braveApiKey) {
            try {
              results = await searchBrave(searchQuery, maxResults, braveApiKey);
              provider = "brave";
              if (results.length > 0) {
                console.log(`[search] Brave Search returned ${results.length} results for: "${searchQuery.slice(0, 80)}"`);
              }
            } catch (e) {
              console.warn(`[search] Brave Search failed, falling back to HTML scraping: ${(e as Error).message}`);
            }
          }

          // ── Serper.dev API (tertiary, free tier: 2500 queries/month) ──────
          const serperApiKey = process.env.SERPER_API_KEY;
          if (results.length === 0 && serperApiKey) {
            try {
              results = await searchSerper(searchQuery, maxResults, serperApiKey);
              provider = "serper";
              if (results.length > 0) {
                console.log(`[search] Serper returned ${results.length} results for: "${searchQuery.slice(0, 80)}"`);
              }
            } catch (e) {
              console.warn(`[search] Serper failed, falling back: ${(e as Error).message}`);
            }
          }

          // ── Free fallback chain (fast-first, parallel where possible) ─
          if (results.length === 0) {
            // Tier 1: DDG Instant Answer API (structured JSON, sub-500ms)
            const ddgInstant = await searchDuckDuckGoInstant(searchQuery);
            if (ddgInstant.length > 0) {
              results = ddgInstant;
              provider = "duckduckgo-instant";
            }

            // Tier 2: DDG HTML + Bing (CN + INTL) in parallel — no API keys needed
            if (results.length < 2) {
              const [ddgHtml, bingCN, bingIntl] = await Promise.all([
                searchDuckDuckGoHtml(searchQuery, maxResults),
                searchBing(searchQuery, maxResults, false),
                searchBing(searchQuery, maxResults, true),
              ]);
              // Merge: DDG first, then Bing (CN first for Chinese, INTL first for English)
              const bingFirst = isChinese ? bingCN : bingIntl;
              const bingSecond = isChinese ? bingIntl : bingCN;
              const freeResults = dedupByUrl([...ddgHtml, ...bingFirst, ...bingSecond]);
              if (freeResults.length > 0) {
                results = dedupByUrl([...results, ...freeResults]);
                provider = provider || "web";
                console.log(`[search] Free engines returned ${freeResults.length} results: ddg=${ddgHtml.length} bing_cn=${bingCN.length} bing_intl=${bingIntl.length}`);
              }
            }

            // Tier 3: SearXNG (only if SEARXNG_ENDPOINT is explicitly configured)
            if (results.length < 2) {
              const searxResults = await searchSearXng(searchQuery, maxResults);
              if (searxResults.length > 0) {
                results = dedupByUrl([...results, ...searxResults]);
                provider = provider || "searxng";
              }
            }
          }

          // ── Dedup ──────────────────────────────────────────────────
          results = dedupByUrl(results);

          // ── AI relevance filter ────────────────────────────────────
          if (results.length > 3 && completer) {
            results = await filterByRelevance(query, results.slice(0, Math.min(results.length, 12)));
          }

          // ── Trim to maxResults ─────────────────────────────────────
          results = results.slice(0, maxResults);

          if (results.length === 0) {
            const noApiKey = !braveApiKey && !serperApiKey;
            return {
              success: false,
              error: `No search results for "${query}". All free engines returned empty. Tips: (1) try different keywords; (2) set BRAVE_SEARCH_API_KEY for premium search (2000 free/month at https://brave.com/search/api/); (3) set SEARXNG_ENDPOINT for self-hosted meta-search; (4) use web.fetch with a specific URL.`,
              provider,
              sourceTier: "free-scrape" as const,
              setupHint: noApiKey
                ? "Tip: Get a free Brave Search API key at https://brave.com/search/api/ (2000 queries/month, no credit card) for faster, more reliable results. Set it as BRAVE_SEARCH_API_KEY in .env.local."
                : undefined
            };
          }

          const sourceTier = provider === "brave" || provider === "serper" || provider === "tavily"
            ? "api" as const
            : provider === "searxng"
              ? "self-hosted" as const
              : "free-scrape" as const;

          const setupHint = sourceTier === "free-scrape"
            ? "Note: using free web scraping (DDG/Bing). For faster results, get a free Brave Search API key at https://brave.com/search/api/ (2000/mo) and set BRAVE_SEARCH_API_KEY in .env.local."
            : undefined;

          return { success: true, results, provider, sourceTier, setupHint };

        } else if (type === "code") {
          const response = await fetch(
            `https://grep.app/api/search?q=${encodeURIComponent(query)}`,
            { headers: { "User-Agent": "dada-agent/1.0" } }
          );
          if (!response.ok) return { success: false, error: `Code search failed: ${response.status}` };
          const data = await response.json() as Array<{ id: string; path: string; lines?: Array<{ line_number: number; line: string }> }>;
          const codeResults = (data || []).slice(0, maxResults).map(item => ({
            title: `${item.path}:${item.lines?.[0]?.line_number || "?"}`,
            url: `https://grep.app/search?q=${encodeURIComponent(query)}`,
            content: item.lines?.map(l => `${l.line_number}: ${l.line}`).join("\n") || item.path
          }));
          return { success: true, results: codeResults, provider: "grep.app" };

        } else if (type === "docs") {
          const response = await fetch(
            `https://devdocs.io/api?query=${encodeURIComponent(query)}`,
            { headers: { "User-Agent": "dada-agent/1.0" } }
          );
          const text = await response.text();
          return { success: true, results: [{ title: `Docs search for "${query}"`, content: text.substring(0, 2000) }], provider: "devdocs" };
        }

        return { success: false, error: `Unknown search type: ${type}` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { success: false, error: message };
      }
    }
  };
}
