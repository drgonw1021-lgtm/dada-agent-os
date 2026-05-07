import type { ToolDefinition } from "../../core/types.js";
import { SandboxPolicy } from "../../governance/sandbox-policy.js";

interface WebFetchInput {
  url: string;
  maxChars?: number;
}

interface WebFetchOutput {
  url: string;
  status: number;
  body: string;
  error?: string;
}

export function createWebFetchTool(
  sandboxPolicy: SandboxPolicy
): ToolDefinition<WebFetchInput, WebFetchOutput> {
  return {
    id: "web.fetch",
    description: "Fetch content from a URL and return it as text",
    requiredScopes: ["web.fetch"],
    riskLevel: "medium",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to fetch" },
        maxChars: { type: "number", description: "Maximum characters to return (default 10000, max 50000)" }
      },
      required: ["url"]
    },
    async execute(input) {
      sandboxPolicy.assertWebUrl(input.url);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);

      try {
        const response = await fetch(input.url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "DaDa/1.0 (autonomous-agent; +https://github.com/dada-agent)",
            "Accept": "text/html,text/plain,application/json;q=0.9,*/*;q=0.5",
          },
        });

        // Check content type — skip binary files
        const contentType = response.headers.get("content-type") || "";
        const isText = /text\/|application\/json|application\/xml|application\/xhtml/i.test(contentType);
        if (!isText) {
          return {
            url: input.url,
            status: response.status,
            body: `[Non-text content: ${contentType}. Use a download tool or browser to view this file.]`,
            error: `Non-text content type: ${contentType}`,
          };
        }

        const text = await response.text();

        // Check for large responses — warn but still return truncated
        const maxChars = Math.min(input.maxChars ?? 10_000, 50_000);
        let body = text.trim();
        if (body.length > maxChars) {
          body = body.slice(0, maxChars) + `\n\n[Truncated: ${body.length - maxChars} more characters]`;
        }

        return {
          url: input.url,
          status: response.status,
          body,
          ...(response.status >= 400 ? { error: `HTTP ${response.status}${response.statusText ? `: ${response.statusText}` : ""}` } : {}),
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isTimeout = err instanceof DOMException && err.name === "AbortError";
        return {
          url: input.url,
          status: 0,
          body: "",
          error: isTimeout ? "Request timed out (15s)" : `Fetch failed: ${msg.slice(0, 300)}`,
        };
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
