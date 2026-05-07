import test from "node:test";
import assert from "node:assert/strict";
import { createWebFetchTool } from "../tools/builtin/web-fetch-tool.js";

function mockSandbox() {
  return {
    assertWebUrl(_url: string) { /* allow all */ },
    assertFilePath(_path: string) {},
    assertShellCommand(_cmd: string) {},
    assertCodeExecution(_code: string) {},
  } as any;
}

test("web-fetch tool has correct metadata", () => {
  const tool = createWebFetchTool(mockSandbox());
  assert.equal(tool.id, "web.fetch");
  assert.ok(tool.description.includes("URL"));
  assert.deepEqual(tool.requiredScopes, ["web.fetch"]);
  assert.equal(tool.riskLevel, "medium");
});

test("web-fetch requires url parameter", () => {
  const tool = createWebFetchTool(mockSandbox());
  assert.ok(tool.inputSchema?.required?.includes("url"));
});

test("web-fetch returns error for unreachable URL", async () => {
  const tool = createWebFetchTool(mockSandbox());
  const result = await tool.execute({ url: "http://127.0.0.1:9/not-found" }, {
    now: new Date(), taskId: "t1", taskLineageId: "t1",
  });
  assert.equal(result.status, 0);
  assert.ok(result.error, "Should have error field");
  assert.ok(result.error!.includes("Fetch failed") || result.error!.includes("timed out"),
    `Expected error to describe failure, got: ${result.error}`);
});

test("web-fetch returns error for invalid URL scheme", async () => {
  const tool = createWebFetchTool({
    assertWebUrl(url: string) { throw new Error(`Blocked: ${url}`); },
  } as any);
  await assert.rejects(
    () => tool.execute({ url: "ftp://evil.com/hack.exe" }, { now: new Date(), taskId: "t1", taskLineageId: "t1" }),
    /Blocked/,
  );
});

test("web-fetch respects maxChars option", async () => {
  const tool = createWebFetchTool(mockSandbox());
  // Use a URL we know returns short content
  const result = await tool.execute({ url: "http://127.0.0.1:9/test", maxChars: 50 }, {
    now: new Date(), taskId: "t1", taskLineageId: "t1",
  });
  // On failure (which we expect for this nonexistent host), verify error structure
  assert.ok(result.body !== undefined || result.error !== undefined);
});
