import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../config.js";
import { buildModelProfiles } from "../model/model-profiles.js";

test("model profiles expose active local-only strategy", () => {
  const config = loadConfig({
    PLANNER_MODEL: "builtin:default",
    EXECUTOR_MODEL: "builtin:default",
    CRITIC_MODEL: "builtin:default"
  });

  const profiles = buildModelProfiles({
    config,
    modelRuntime: {
      modelsDir: "./models",
      modelCount: 1,
      availableModels: ["demo"],
      currentModelId: null,
      loaded: false,
      llamaCppAvailable: true,
      builtinReady: true,
      builtinGpu: "auto",
      detectedLocalEndpoints: [],
    }
  });

  const localOnly = profiles.find((profile) => profile.id === "local-only");
  assert.equal(localOnly?.active, true);
  assert.equal(localOnly?.ready, true);
});
