import test from "node:test";
import assert from "node:assert/strict";
import {
  getProviderNameForModel,
  joinEndpoint,
  stripProviderPrefix
} from "../model/provider-utils.js";

test("provider selection prefers builtin runtime when no explicit prefix is given", () => {
  const provider = getProviderNameForModel("qwen2.5-7b", {
    builtinAvailable: true,
    cloudAvailable: true
  });

  assert.equal(provider, "builtin");
});

test("provider selection falls back to cloud when builtin is unavailable", () => {
  const provider = getProviderNameForModel("gpt-4o-mini", {
    builtinAvailable: false,
    cloudAvailable: true
  });

  assert.equal(provider, "openai-compatible");
});

test("provider-specific prefixes are stripped before request dispatch", () => {
  assert.equal(stripProviderPrefix("ollama:llama3", "ollama-compatible"), "llama3");
  assert.equal(stripProviderPrefix("local:qwen2.5", "ollama-compatible"), "qwen2.5");
  assert.equal(stripProviderPrefix("lmstudio:qwen2.5", "lmstudio"), "qwen2.5");
  assert.equal(stripProviderPrefix("cloud:gpt-4o", "openai-compatible"), "gpt-4o");
});

test("endpoint joining avoids duplicated version segments", () => {
  assert.equal(
    joinEndpoint("http://127.0.0.1:1234/v1", "/v1/chat/completions"),
    "http://127.0.0.1:1234/v1/chat/completions"
  );
  assert.equal(
    joinEndpoint("http://127.0.0.1:11434/api", "/api/tags"),
    "http://127.0.0.1:11434/api/tags"
  );
});
