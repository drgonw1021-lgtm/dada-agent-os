import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { resolveStaticFilePath, serveStaticAsset } from "../server-static.js";

test("resolveStaticFilePath maps root request to index.html", () => {
  const webRoot = resolve("web");
  const filePath = resolveStaticFilePath(webRoot, "/");

  assert.equal(filePath, resolve(webRoot, "index.html"));
});

test("resolveStaticFilePath blocks directory traversal", () => {
  const webRoot = resolve("web");

  assert.throws(() => resolveStaticFilePath(webRoot, "/../.env"), /outside web root/);
});

test("serveStaticAsset serves jpeg assets with image content type", async () => {
  const tempDir = mkdtempSync(resolve(tmpdir(), "dada-static-"));

  try {
    writeFileSync(resolve(tempDir, "icon.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const file = await serveStaticAsset(tempDir, "/icon.jpg");

    assert.equal(file.type, "image/jpeg");
    assert.equal(Buffer.isBuffer(file.body), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
