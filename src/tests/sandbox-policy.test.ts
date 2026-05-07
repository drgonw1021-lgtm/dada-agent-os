import test from "node:test";
import assert from "node:assert/strict";
import { SandboxPolicy } from "../governance/sandbox-policy.js";

test("sandbox policy allows configured path/domain/command", () => {
  const policy = new SandboxPolicy({
    readRoots: ["."],
    writeRoots: ["."],
    shellAllowlist: ["node", "npm"],
    webAllowlist: ["example.com"]
  });

  policy.assertReadPath("./README.md");
  policy.assertWritePath("./tmp/out.txt");
  policy.assertShellCommand("node -v");
  policy.assertWebUrl("https://example.com/docs");
});

test("sandbox policy blocks unconfigured command", () => {
  const policy = new SandboxPolicy({
    readRoots: ["."],
    writeRoots: ["."],
    shellAllowlist: ["node"],
    webAllowlist: ["example.com"]
  });

  assert.throws(() => policy.assertShellCommand("python app.py"));
});
