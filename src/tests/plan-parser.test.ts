import test from "node:test";
import assert from "node:assert/strict";
import { parsePlanActions } from "../runtime/plan-parser.js";

// ── DSML normalization ──────────────────────────────────────────────────────────

test("parsePlanActions normalizes DSML-wrapped <invoke> tags", () => {
  // Simulate what DeepSeek V4 Pro actually outputs:
  // fullwidth vertical bars + "DSML" wrapping
  // DSML = two U+FF5C fullwidth bars + "DSML" + two U+FF5C bars
  const dsml = "｜DSML｜";
  const raw = `<${dsml}invoke name="search">\n<${dsml}parameter name="query" string="true">latest AI news 2026</${dsml}parameter>\n<${dsml}parameter name="maxResults" string="false">5</${dsml}parameter>\n</${dsml}invoke>`;

  const actions = parsePlanActions(raw);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "tool");
  assert.equal((actions[0] as any).tool, "search");
  assert.equal((actions[0] as any).input.query, "latest AI news 2026");
  assert.equal((actions[0] as any).input.maxResults, 5); // parsed as JSON number
});

test("parsePlanActions normalizes DSML-wrapped <invoke> with self-closing params", () => {
  const dsml = "｜DSML｜";
  const raw = `<${dsml}invoke name="code.exec">\n<${dsml}parameter name="language" value="python"/>\n<${dsml}parameter name="code" string="true">print("hello")</${dsml}parameter>\n</${dsml}invoke>`;

  const actions = parsePlanActions(raw);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "tool");
  assert.equal((actions[0] as any).tool, "code.exec");
  assert.equal((actions[0] as any).input.language, "python");
  assert.equal((actions[0] as any).input.code, 'print("hello")');
});

test("parsePlanActions normalizes DSML-wrapped <tool_calls> wrapper", () => {
  const dsml = "｜DSML｜";
  const raw = `<${dsml}tool_calls>\n<${dsml}invoke name="web.fetch">\n<${dsml}parameter name="url" string="true">https://example.com</${dsml}parameter>\n</${dsml}invoke>\n</${dsml}tool_calls>`;

  const actions = parsePlanActions(raw);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "tool");
  assert.equal((actions[0] as any).tool, "web.fetch");
  assert.equal((actions[0] as any).input.url, "https://example.com");
});

test("parsePlanActions parses normal <invoke> tags (non-DSML)", () => {
  const raw = `<invoke name="search">\n<parameter name="query" string="true">normal test</parameter>\n</invoke>`;

  const actions = parsePlanActions(raw);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "tool");
  assert.equal((actions[0] as any).tool, "search");
  assert.equal((actions[0] as any).input.query, "normal test");
});

test("parsePlanActions parses inline <invoke> tags", () => {
  const raw = `<invoke name="search"><parameter name="query" value="inline query"/></invoke>`;

  const actions = parsePlanActions(raw);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "tool");
  assert.equal((actions[0] as any).tool, "search");
  assert.equal((actions[0] as any).input.query, "inline query");
});

test("parsePlanActions handles DSML with mixed content (DSML invoke + normal text)", () => {
  const dsml = "｜DSML｜";
  const raw = `I will search for the information now.\n\n<${dsml}invoke name="search">\n<${dsml}parameter name="query" string="true">AI trends</${dsml}parameter>\n</${dsml}invoke>\n\nAfter searching, I'll write the report.`;

  const actions = parsePlanActions(raw);
  const toolActions = actions.filter(a => a.type === "tool");
  const noteActions = actions.filter(a => a.type === "note");

  assert.equal(toolActions.length, 1);
  assert.equal((toolActions[0] as any).tool, "search");
  assert.equal((toolActions[0] as any).input.query, "AI trends");
  assert.equal(noteActions.length >= 1, true, "Should have at least one note for surrounding text");
});

// ── Edge cases ─────────────────────────────────────────────────────────────────

test("parsePlanActions handles empty input", () => {
  const actions = parsePlanActions("");
  assert.equal(actions.length, 0);
});

test("parsePlanActions handles text with no actions", () => {
  const actions = parsePlanActions("This is just some plain text.\nNo tools or actions here.");
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "note");
});

test("parsePlanActions handles TOOL format", () => {
  const raw = `TOOL search {"query":"test","maxResults":3}`;
  const actions = parsePlanActions(raw);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "tool");
  assert.equal((actions[0] as any).tool, "search");
});

test("parsePlanActions extracts DONE with text", () => {
  const raw = `DONE Task completed successfully. Report written.`;
  const actions = parsePlanActions(raw);
  assert.equal(actions.some(a => a.type === "done"), true);
});

test("parsePlanActions extracts THINK", () => {
  const raw = `THINK: I should search for this first.`;
  const actions = parsePlanActions(raw);
  assert.equal(actions.some(a => a.type === "think"), true);
});

test("parsePlanActions handles tool_calls JSON block", () => {
  const raw = `{"tool_calls":[{"function":{"name":"search","arguments":"{\\"query\\":\\"test\\"}"}}]}`;
  const actions = parsePlanActions(raw);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].type, "tool");
  assert.equal((actions[0] as any).tool, "search");
});
