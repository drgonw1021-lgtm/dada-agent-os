import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { VectorStore } from "../knowledge/vector-store.js";
import { chunkDocument } from "../knowledge/document-chunker.js";
import { scanWorkspace, isTextFile } from "../knowledge/workspace-scanner.js";
import { KnowledgeBase } from "../knowledge/knowledge-base.js";

const TEST_DIR = join(process.cwd(), ".test-kb");

test("VectorStore indexes and searches documents", async () => {
  const store = new VectorStore();

  store.addDocument({
    id: "readme.md#0",
    content: "DaDa autonomous AI agent with built-in model runtime and tool execution",
    metadata: { filePath: "readme.md", chunkIndex: 0, totalChunks: 1, fileType: ".md", lastModified: 0 }
  });

  store.addDocument({
    id: "config.ts#0",
    content: "export interface Config { plannerModel: string; maxSteps: number; disableVerifier: boolean }",
    metadata: { filePath: "config.ts", chunkIndex: 0, totalChunks: 1, fileType: ".ts", lastModified: 0 }
  });

  store.addDocument({
    id: "tools.ts#0",
    content: "shell exec tool runs commands in a sandbox with approval policy enforcement",
    metadata: { filePath: "tools.ts", chunkIndex: 0, totalChunks: 1, fileType: ".ts", lastModified: 0 }
  });

  assert.equal(store.size, 3);

  // Search for AI-related content
  const aiResults = store.search("autonomous AI agent model runtime", 2);
  assert.ok(aiResults.length >= 1);
  assert.ok(aiResults[0]!.doc.metadata.filePath.includes("readme"));

  // Search for config-related content
  const configResults = store.search("plannerModel maxSteps config interface", 2);
  assert.ok(configResults.length >= 1);
  assert.ok(configResults[0]!.doc.metadata.filePath.includes("config"));

  // Remove by file
  store.removeByFile("readme.md");
  assert.equal(store.size, 2);

  // Verify stats
  const stats = store.getStats();
  assert.equal(stats.documentCount, 2);
  assert.equal(stats.fileCount, 2);
});

test("VectorStore handles empty and no-match searches", async () => {
  const store = new VectorStore();
  assert.equal(store.search("anything", 5).length, 0);
  assert.equal(store.size, 0);
});

test("VectorStore serialize/deserialize round-trip", async () => {
  const store1 = new VectorStore();
  store1.addDocument({
    id: "a.md#0",
    content: "Hello world from the test document",
    metadata: { filePath: "a.md", chunkIndex: 0, totalChunks: 1, fileType: ".md", lastModified: 100 }
  });

  const json = store1.toJSON();
  const store2 = new VectorStore();
  store2.loadFromJSON(json);

  assert.equal(store2.size, 1);
  const results = store2.search("hello world", 1);
  assert.equal(results.length, 1);
  assert.equal(results[0]!.doc.content, "Hello world from the test document");
});

// ── Document Chunker ──────────────────────────────────────────────────────────

test("chunkDocument handles short text as single chunk", async () => {
  const chunks = chunkDocument("Short text.");
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.text, "Short text.");
});

test("chunkDocument splits long text into overlapping chunks", async () => {
  const longText = Array(100).fill("This is a paragraph of text that forms part of a document. It has multiple sentences.").join("\n\n");
  const chunks = chunkDocument(longText, { chunkSize: 500, overlap: 100, maxChunks: 20 });
  assert.ok(chunks.length > 1);
  assert.ok(chunks.length <= 20);
  // Verify each chunk is within reasonable size
  for (const chunk of chunks) {
    assert.ok(chunk.text.length <= 600, `chunk too large: ${chunk.text.length}`);
    assert.ok(chunk.text.length >= 80);
  }
});

test("chunkDocument respects maxChunks", async () => {
  const longText = Array(200).fill("Many paragraphs. With content. That needs splitting.").join("\n\n");
  const chunks = chunkDocument(longText, { chunkSize: 200, overlap: 50, maxChunks: 5 });
  assert.ok(chunks.length <= 5);
});

// ── Workspace Scanner ─────────────────────────────────────────────────────────

test("isTextFile recognizes text extensions", async () => {
  assert.equal(isTextFile(".ts"), true);
  assert.equal(isTextFile(".md"), true);
  assert.equal(isTextFile(".json"), true);
  assert.equal(isTextFile(".py"), true);
  assert.equal(isTextFile(".png"), false);
  assert.equal(isTextFile(".exe"), false);
  assert.equal(isTextFile(".zip"), false);
});

test("scanWorkspace finds text files in test directory", async () => {
  // Create a temporary workspace
  const wsDir = join(TEST_DIR, "scan-workspace");
  await mkdir(join(wsDir, "src"), { recursive: true });
  await mkdir(join(wsDir, "docs"), { recursive: true });

  await writeFile(join(wsDir, "src", "index.ts"), "export const x = 1;", "utf8");
  await writeFile(join(wsDir, "src", "utils.js"), "module.exports = {};", "utf8");
  await writeFile(join(wsDir, "docs", "readme.md"), "# Hello", "utf8");
  await writeFile(join(wsDir, "image.png"), Buffer.alloc(100), "utf8");

  const files = await scanWorkspace(wsDir, { maxFiles: 10 });
  const relPaths = files.map(f => f.relPath);

  assert.ok(relPaths.some(p => p.includes("index.ts")));
  assert.ok(relPaths.some(p => p.includes("utils.js")));
  assert.ok(relPaths.some(p => p.includes("readme.md")));
  // PNG should not appear since it's not a text file
  assert.ok(!relPaths.some(p => p.includes("image.png")));

  // Cleanup
  await rm(wsDir, { recursive: true, force: true });
});

test("scanWorkspace respects includeExtensions filter", async () => {
  const wsDir = join(TEST_DIR, "scan-filter");
  await mkdir(wsDir, { recursive: true });
  await writeFile(join(wsDir, "a.ts"), "x", "utf8");
  await writeFile(join(wsDir, "b.md"), "y", "utf8");
  await writeFile(join(wsDir, "c.json"), "{}", "utf8");

  const tsOnly = await scanWorkspace(wsDir, { includeExtensions: [".ts"], maxFiles: 10 });
  assert.equal(tsOnly.length, 1);
  assert.ok(tsOnly[0]!.relPath.endsWith(".ts"));

  await rm(wsDir, { recursive: true, force: true });
});

// ── Knowledge Base (Integration) ──────────────────────────────────────────────

test("KnowledgeBase indexes workspace and answers queries", async () => {
  const wsDir = join(TEST_DIR, "kb-workspace");
  await mkdir(wsDir, { recursive: true });
  await writeFile(join(wsDir, "README.md"), "# DaDa Project\n\nAn autonomous AI agent for task automation.", "utf8");
  await writeFile(join(wsDir, "config.ts"), "export const plannerModel = 'builtin:default';\nexport const maxSteps = 25;", "utf8");
  await writeFile(join(wsDir, "tools.md"), "# Tools\n\n- shell.exec: run commands\n- search: web search\n- fs.write_file: save files", "utf8");

  const kb = new KnowledgeBase({
    workspaceDir: wsDir,
    storageDir: join(TEST_DIR, "kb-storage"),
    scan: { maxFiles: 50 }
  });

  const { filesIndexed, chunksCreated, errors } = await kb.index();
  assert.ok(filesIndexed >= 3);
  assert.ok(chunksCreated >= 3);
  assert.equal(errors.length, 0);

  // Search
  const results = await kb.query("autonomous AI agent", 3);
  assert.ok(results.length >= 1);
  const matches = results.filter(r => r.filePath.includes("README"));
  assert.ok(matches.length >= 1);

  // Config search
  const configResults = await kb.query("plannerModel config maxSteps", 2);
  assert.ok(configResults.some(r => r.filePath.includes("config")));

  // Context string
  const ctx = await kb.getContextString("shell exec tools", 3, 2000);
  assert.ok(ctx.includes("tools.md") || ctx.includes("工作区"));

  // Stats
  const stats = kb.getStats();
  assert.equal(stats.indexedFiles, filesIndexed);
  assert.ok(stats.totalChunks > 0);

  // Persist + reload
  await kb.save();
  const kb2 = new KnowledgeBase({
    workspaceDir: wsDir,
    storageDir: join(TEST_DIR, "kb-storage")
  });
  const loaded = await kb2.load();
  assert.equal(loaded, true);
  assert.equal(kb2.getStats().totalChunks, chunksCreated);

  // Re-index
  const reindexResult = await kb.reindex();
  assert.ok(reindexResult.filesIndexed >= 3);

  // Cleanup
  await rm(wsDir, { recursive: true, force: true });
  await rm(join(TEST_DIR, "kb-storage"), { recursive: true, force: true });
});

test("KnowledgeBase handles empty workspace gracefully", async () => {
  const emptyDir = join(TEST_DIR, "kb-empty");
  await mkdir(emptyDir, { recursive: true });

  const kb = new KnowledgeBase({
    workspaceDir: emptyDir,
    storageDir: join(TEST_DIR, "kb-empty-storage")
  });

  const { filesIndexed, errors } = await kb.index();
  assert.equal(filesIndexed, 0);
  assert.equal(errors.length, 0);

  const results = await kb.query("anything", 5);
  assert.equal(results.length, 0);

  await rm(emptyDir, { recursive: true, force: true });
});
