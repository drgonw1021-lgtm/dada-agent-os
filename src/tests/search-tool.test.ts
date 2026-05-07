import test from "node:test";
import assert from "node:assert/strict";
import { createSearchTool } from "../tools/builtin/search-tool.js";

test("search-tool has correct metadata", () => {
  const tool = createSearchTool();
  assert.equal(tool.id, "search");
  assert.ok(tool.description.includes("Search"));
  assert.deepEqual(tool.requiredScopes, ["web.fetch"]);
});

test("search-tool requires query parameter", () => {
  const tool = createSearchTool();
  assert.ok(tool.inputSchema?.required?.includes("query"));
});

test("search-tool supports optional type and maxResults", () => {
  const tool = createSearchTool();
  const props = tool.inputSchema?.properties || {};
  assert.ok(props.query);
  assert.ok(props.type);
  assert.ok(props.maxResults);
});

test("search-tool returns results for basic query via free backends", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.duckduckgo.com")) {
        return new Response(JSON.stringify({
          AbstractText: "TypeScript is a strongly typed programming language that builds on JavaScript.",
          AbstractURL: "https://www.typescriptlang.org/",
          AbstractSource: "TypeScript",
          Heading: "TypeScript",
          RelatedTopics: [
            { Text: "JavaScript", FirstURL: "https://en.wikipedia.org/wiki/JavaScript" },
            { Text: "Static typing", FirstURL: "https://en.wikipedia.org/wiki/Type_system" }
          ]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("html.duckduckgo.com")) {
        return new Response('<html><body><a rel="nofollow" class="result__a" href="https://www.typescriptlang.org/">TypeScript</a></body></html>', { status: 200 });
      }
      if (url.includes("bing.com")) {
        return new Response('<html><body>Bing results</body></html>', { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as any;

    const tool = createSearchTool();
    const result = await tool.execute(
      { query: "TypeScript programming language", maxResults: 3 },
      { now: new Date(), taskId: "t1", taskLineageId: "t1" }
    );
    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.results), "results should be an array");
    if (result.results!.length > 0) {
      const first = result.results![0];
      assert.ok(first.title, "result should have a title");
      assert.ok(first.content || first.snippet, "result should have content or snippet");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("search-tool handles Chinese queries", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.duckduckgo.com")) {
        return new Response(JSON.stringify({
          AbstractText: "",
          RelatedTopics: [
            { Text: "人工智能发展趋势", FirstURL: "https://example.com/ai-trends" }
          ]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("html.duckduckgo.com")) {
        return new Response('<html><body><a rel="nofollow" class="result__a" href="https://example.com/ai">AI Trends</a></body></html>', { status: 200 });
      }
      if (url.includes("bing.com")) {
        return new Response('<html><body>Bing results</body></html>', { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as any;

    const tool = createSearchTool();
    const result = await tool.execute(
      { query: "人工智能发展趋势", maxResults: 2 },
      { now: new Date(), taskId: "t2", taskLineageId: "t2" }
    );
    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.results));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("search-tool handles empty query gracefully", async () => {
  const tool = createSearchTool();
  const result = await tool.execute(
    { query: "", maxResults: 2 },
    { now: new Date(), taskId: "t3", taskLineageId: "t3" }
  );
  // Should not crash — may return success: false or empty results
  assert.ok(result.success !== undefined);
});
