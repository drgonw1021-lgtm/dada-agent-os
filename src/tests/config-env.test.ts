import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig } from "../config.js";

test("loadConfig loads values from .env", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-config-env-"));
  const previousCwd = process.cwd();

  try {
    writeFileSync(
      join(tempDir, ".env"),
      "PLANNER_MODEL=builtin:default\nMODELS_DIR=./custom-models\n",
      "utf8"
    );

    process.chdir(tempDir);

    const config = loadConfig({});

    assert.equal(config.plannerModel, "builtin:default");
    assert.equal(config.modelsDir, "./custom-models");
    assert.deepEqual(config.envFiles, [join(tempDir, ".env")]);
  } finally {
    process.chdir(previousCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadConfig lets .env.local override .env but not explicit env", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "dada-config-local-"));
  const previousCwd = process.cwd();

  try {
    writeFileSync(
      join(tempDir, ".env"),
      "PLANNER_MODEL=builtin:default\nMODELS_DIR=./from-env\n",
      "utf8"
    );
    writeFileSync(
      join(tempDir, ".env.local"),
      "PLANNER_MODEL=cloud:gpt-4o-mini\nMODELS_DIR=./from-local\n",
      "utf8"
    );

    process.chdir(tempDir);

    const config = loadConfig({
      MODELS_DIR: "./from-process"
    });

    assert.equal(config.plannerModel, "cloud:gpt-4o-mini");
    assert.equal(config.modelsDir, "./from-process");
    assert.deepEqual(config.envFiles, [join(tempDir, ".env"), join(tempDir, ".env.local")]);
  } finally {
    process.chdir(previousCwd);
    rmSync(tempDir, { recursive: true, force: true });
  }
});
