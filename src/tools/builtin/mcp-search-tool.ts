import type { ToolDefinition, ToolContext } from "../../core/types.js";

export interface McpSearchInput {
  query: string;
  limit?: number;
}

export interface McpSearchOutput {
  success: boolean;
  results?: Array<{
    packageName: string;
    description: string;
    version?: string;
    source?: "curated" | "npm" | "github";
  }>;
  error?: string;
  tip?: string;
}

// ─── Caching ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  results: Array<{ packageName: string; description: string; version?: string; source?: "curated" | "npm" | "github" }>;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function cacheKey(query: string): string {
  return query.toLowerCase().trim();
}

function cacheGet(query: string) {
  const entry = cache.get(cacheKey(query));
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) return entry.results;
  if (entry) cache.delete(cacheKey(query));
  return null;
}

function cacheSet(query: string, results: CacheEntry["results"]): void {
  cache.set(cacheKey(query), { results, timestamp: Date.now() });
  // Evict oldest if cache grows too large
  if (cache.size > 50) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
    if (oldest) cache.delete(oldest[0]);
  }
}

// ─── Known MCP servers (20 categories, 50+ servers) ─────────────────────────────

const KNOWN_MCPS: Record<string, Array<{ packageName: string; description: string }>> = {
  search: [
    { packageName: "@anthropic/mcp-server-brave-search", description: "Brave Search API: web, image, video, news search + AI summarizer. Free tier: 2,000 queries/month" },
    { packageName: "serper-search-mcp-server", description: "Serper.dev Google Search API: fast Google results. Free tier: 2,500 queries/month" },
    { packageName: "mcp-serpapi", description: "SerpAPI multi-engine search: Google, Bing, Baidu, Yandex, DuckDuckGo" },
    { packageName: "@modelcontextprotocol/server-brave-search", description: "Official MCP Brave Search server by Anthropic" },
    { packageName: "tavily-mcp-server", description: "Tavily Search API optimized for AI agents: real-time web search with AI extraction" },
  ],
  pdf: [
    { packageName: "pdf-mcp-server", description: "Generate beautiful PDFs from Markdown with custom themes (Professional, Minimal, Dark)" },
    { packageName: "@harjjotsinghh/documents-mcp", description: "Read/write PDF, DOCX, PPTX, XLSX documents" },
    { packageName: "md-to-pdf-mcp", description: "Convert Markdown to PDF with headers, footers, page numbers, and CSS styling" },
  ],
  pptx: [
    { packageName: "pptxgenjs-mcp-server", description: "Create PowerPoint presentations with charts (bar, line, pie), tables, images, and text" },
    { packageName: "presentation-creator-mcp-server", description: "Create PPTX presentations from HTML slides" },
  ],
  chart: [
    { packageName: "quickchart-mcp-server", description: "Generate chart images (bar, line, pie, radar, etc.) via QuickChart.io" },
    { packageName: "chart-mcp-server", description: "Apache ECharts-based chart generation: 20+ chart types, interactive options" },
  ],
  image: [
    { packageName: "@kazuph/mcp-google-image-search", description: "Google Image Search via Custom Search API + SerpAPI fallback" },
    { packageName: "@anthropic/mcp-server-stability", description: "Stability AI image generation (Stable Diffusion) via Stability API" },
    { packageName: "mcp-server-flux", description: "Flux AI image generation: photorealistic and artistic image creation" },
  ],
  news: [
    { packageName: "@chanmeng666/google-news-server", description: "Google News search via SerpAPI — multi-language, auto-categorization" },
    { packageName: "newsapi-mcp-server", description: "NewsAPI.org access: 80,000+ sources, headlines, search, language filtering" },
  ],
  database: [
    { packageName: "@anthropic/mcp-server-postgres", description: "PostgreSQL database access with schema introspection and query execution" },
    { packageName: "@anthropic/mcp-server-sqlite", description: "SQLite database access — local file-based DB, no server needed" },
    { packageName: "@modelcontextprotocol/server-postgres", description: "Official MCP PostgreSQL server" },
    { packageName: "mysql-mcp-server", description: "MySQL/MariaDB database access with query execution and schema management" },
  ],
  file: [
    { packageName: "@anthropic/mcp-server-filesystem", description: "Filesystem operations: read, write, list, move, delete files and directories" },
    { packageName: "@modelcontextprotocol/server-filesystem", description: "Official MCP filesystem server with path allow-listing" },
  ],
  git: [
    { packageName: "@anthropic/mcp-server-github", description: "GitHub API: repos, issues, PRs, code search, actions, and more" },
    { packageName: "@modelcontextprotocol/server-git", description: "Git operations: log, diff, status, branch, commit, push, pull" },
    { packageName: "gitlab-mcp-server", description: "GitLab API: repos, merge requests, CI/CD pipelines, issues" },
  ],
  slack: [
    { packageName: "@anthropic/mcp-server-slack", description: "Slack API: send messages, list channels, search messages, manage users" },
  ],
  memory: [
    { packageName: "@anthropic/mcp-server-memory", description: "Persistent memory system for knowledge graph storage and retrieval" },
    { packageName: "@modelcontextprotocol/server-memory", description: "Official MCP knowledge-graph memory server" },
  ],
  browser: [
    { packageName: "@anthropic/mcp-server-puppeteer", description: "Headless Chrome browser automation: navigate, click, extract, screenshot" },
    { packageName: "@modelcontextprotocol/server-puppeteer", description: "Official MCP Puppeteer server for web scraping and automation" },
    { packageName: "playwright-mcp-server", description: "Playwright-based browser automation: cross-browser (Chrome, Firefox, WebKit)" },
  ],
  weather: [
    { packageName: "@anthropic/mcp-server-weather", description: "Weather data via OpenWeatherMap API: current, forecast, alerts" },
  ],
  rag: [
    { packageName: "@anthropic/mcp-server-context7", description: "Context7 documentation RAG: query up-to-date library docs at query time" },
    { packageName: "mcp-rag-server", description: "RAG (Retrieval Augmented Generation) over local documents with embeddings" },
  ],
  email: [
    { packageName: "mcp-server-gmail", description: "Gmail API: read, send, search, and manage emails + labels and filters" },
    { packageName: "mcp-server-email", description: "Email sending via SMTP with attachment support, templates, and delivery tracking" },
  ],
  calendar: [
    { packageName: "mcp-server-google-calendar", description: "Google Calendar API: create events, list schedule, manage attendees, set reminders" },
  ],
  translation: [
    { packageName: "mcp-server-deepl", description: "DeepL translation API: 30+ languages, formal/informal tone, glossary support" },
    { packageName: "linguee-mcp-server", description: "Linguee dictionary and translation memory: context-aware translations with examples" },
  ],
  maps: [
    { packageName: "mcp-server-google-maps", description: "Google Maps API: geocoding, directions, places search, distance matrix" },
  ],
  finance: [
    { packageName: "mcp-server-yfinance", description: "Yahoo Finance data: stock quotes, historical data, financial statements, news" },
    { packageName: "mcp-server-coingecko", description: "CoinGecko API: cryptocurrency prices, market data, exchange rates, trends" },
  ],
  notification: [
    { packageName: "mcp-server-ntfy", description: "Push notifications via ntfy.sh: send alerts to phone/desktop, topic-based pub/sub" },
  ],
  scraping: [
    { packageName: "scrapling", description: "Scrapling: Lightning-fast adaptive web scraping for Python. Handles bot detection bypass (Cloudflare), JS rendering (Playwright), auto-selector generation, concurrent crawling. Built-in MCP server for AI-assisted scraping. Install: pip install 'scrapling[fetchers]' && scrapling install" },
  ],
};

// ─── npm registry HTTP API ──────────────────────────────────────────────────────

async function searchNpmRegistry(query: string, limit: number, retryCount = 0): Promise<Array<{ packageName: string; description: string; version?: string }>> {
  const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=${Math.min(limit + 5, 20)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "Accept": "application/json" },
    });

    if (res.status === 429 && retryCount < 2) {
      const waitMs = (retryCount + 1) * 2000; // 2s, 4s backoff
      await new Promise(r => setTimeout(r, waitMs));
      return searchNpmRegistry(query, limit, retryCount + 1);
    }

    if (res.status === 429) return [];

    if (!res.ok) return [];

    const data = await res.json() as {
      objects?: Array<{
        package: { name: string; description?: string; version?: string };
      }>;
    };

    return (data.objects || [])
      .filter((o) => /\bmcp\b/i.test(o.package.name))
      .map((o) => ({
        packageName: o.package.name,
        description: o.package.description || "MCP server",
        version: o.package.version,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ─── GitHub topic search ────────────────────────────────────────────────────────

async function searchGitHubTopics(query: string, limit: number): Promise<Array<{ packageName: string; description: string; version?: string }>> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const topicQ = query.replace(/\s+/g, "-");
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}+mcp+topic:mcp&per_page=${Math.min(limit + 5, 20)}&sort=stars&order=desc`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "DaDa/0.4",
      },
    });

    if (res.status === 403 || res.status === 429) return []; // Rate limited
    if (!res.ok) return [];

    const data = await res.json() as {
      items?: Array<{
        full_name: string;
        description?: string;
        stargazers_count?: number;
      }>;
    };

    return (data.items || [])
      .filter((r) => r.full_name && r.description)
      .map((r) => ({
        packageName: r.full_name,
        description: `${r.description}☆${r.stargazers_count ?? 0}`,
        source: "github" as const,
      }));
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Tool factory ───────────────────────────────────────────────────────────────

export function createMcpSearchTool(): ToolDefinition<McpSearchInput, McpSearchOutput> {
  return {
    id: "mcp.search",
    description:
      "Search for MCP (Model Context Protocol) servers on npm/GitHub that provide capabilities you need. " +
      "MCP servers give you access to real APIs (search, PDF generation, image generation, etc.) that go beyond your built-in tools. " +
      "Use this when you detect a capability gap — e.g., you need real web search results, chart generation, or PDF export.",
    requiredScopes: ["web.fetch"],
    riskLevel: "low",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What capability you need. Examples: 'web search', 'pdf generation', 'chart', 'image', 'PPTX', 'news', 'database', 'git', 'slack', 'email', 'calendar', 'translation', 'maps', 'finance', 'notification', 'weather', 'browser'",
        },
        limit: { type: "number", description: "Max results (default 8)", default: 8 },
      },
      required: ["query"],
    },
    async execute(input: McpSearchInput, _context: ToolContext): Promise<McpSearchOutput> {
      const { query, limit = 8 } = input;

      // Check cache first
      const cached = cacheGet(query);
      if (cached) {
        return { success: true, results: cached.slice(0, limit) };
      }

      const results: Array<{ packageName: string; description: string; version?: string; source?: "curated" | "npm" | "github" }> = [];

      try {
        // 1. Check known MCPs first (instant)
        const q = query.toLowerCase();
        for (const [category, servers] of Object.entries(KNOWN_MCPS)) {
          if (q.includes(category) || category.includes(q)) {
            for (const s of servers) {
              if (!results.some((r) => r.packageName === s.packageName)) {
                results.push({ ...s, source: "curated" as const });
              }
            }
          }
        }

        // Also broad-match: any individual keyword in query matches category
        const qWords = q.split(/\s+/);
        for (const word of qWords) {
          for (const [category, servers] of Object.entries(KNOWN_MCPS)) {
            if (category.includes(word) || word.includes(category)) {
              for (const s of servers) {
                if (!results.some((r) => r.packageName === s.packageName)) {
                  results.push({ ...s, source: "curated" as const });
                }
              }
            }
          }
        }

        // 2. npm registry HTTP API (sequential fallback, ~0.5s)
        const searchTerm = q.includes("mcp") ? q : `${q} mcp server`;
        const npmResults = await searchNpmRegistry(searchTerm, limit);
        for (const r of npmResults) {
          if (!results.some((x) => x.packageName === r.packageName)) {
            results.push({ ...r, source: "npm" });
          }
        }

        // 3. GitHub topic search (secondary fallback)
        if (results.length < 3) {
          const ghResults = await searchGitHubTopics(q, limit);
          for (const r of ghResults) {
            if (!results.some((x) => x.packageName === r.packageName)) {
              results.push(r);
            }
          }
        }

        const final = results.slice(0, limit);
        cacheSet(query, final);

        if (final.length === 0) {
          return {
            success: true,
            results: [],
            tip: `No MCP servers found for "${query}". Try broader keywords, or check https://github.com/modelcontextprotocol/servers for the official list. Install with: npx -y <package-name>.`,
          };
        }

        return { success: true, results: final };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  };
}
