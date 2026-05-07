import test from "node:test";
import assert from "node:assert/strict";
import { DomainEngine } from "../domains/domain-engine.js";

test("domain engine routes Chinese market goals", async () => {
  const engine = new DomainEngine();
  const plan = await engine.plan("请帮我做一个市场分析和选品方案");

  assert.match(plan, /PLAN market-analysis/);
  assert.match(plan, /domain\.market-analysis/);
});

test("domain engine routes Chinese product goals", async () => {
  const engine = new DomainEngine();
  const plan = await engine.plan("做一份产品设计调研");

  assert.match(plan, /PLAN product-design/);
  assert.match(plan, /domain\.product-design/);
});
