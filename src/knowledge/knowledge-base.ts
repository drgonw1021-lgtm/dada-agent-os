/**
 * RAG Knowledge Base — indexes workspace files and retrieves relevant context for tasks.
 *
 * Pipeline: scan workspace → read files → chunk → TF-IDF vector store
 * Query: TF-IDF vector search → return ranked chunks as context string
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { VectorStore, type VectorDocument } from "./vector-store.js";
import { scanWorkspace, isTextFile, type ScanOptions, type ScannedFile } from "./workspace-scanner.js";
import { chunkDocument, type ChunkOptions } from "./document-chunker.js";

export interface KnowledgeBaseOptions {
  /** Workspace root directory */
  workspaceDir: string;
  /** Persistence directory for the index */
  storageDir?: string;
  /** Scan options */
  scan?: ScanOptions;
  /** Chunk options */
  chunk?: ChunkOptions;
}

export interface SearchResult {
  content: string;
  filePath: string;
  chunkIndex: number;
  score: number;
}

export interface KnowledgeStats {
  indexedFiles: number;
  totalChunks: number;
  totalTerms: number;
  lastIndexedAt: string | null;
}

export class KnowledgeBase {
  private readonly vectorStore = new VectorStore();
  private readonly workspaceDir: string;
  private readonly storageDir: string;
  private readonly scanOptions: ScanOptions;
  private readonly chunkOptions: ChunkOptions;
  private lastIndexedAt: string | null = null;
  private readonly indexedFiles = new Map<string, number>(); // filePath → lastModified

  constructor(options: KnowledgeBaseOptions) {
    this.workspaceDir = options.workspaceDir;
    this.storageDir = options.storageDir ?? join(options.workspaceDir, ".agent", "knowledge");
    this.scanOptions = options.scan ?? {};
    this.chunkOptions = options.chunk ?? {};
  }

  // ── Indexing ──────────────────────────────────────────────────────────────────

  /** Scan workspace and index all text files. Returns count of indexed files. */
  async index(): Promise<{ filesIndexed: number; chunksCreated: number; errors: string[] }> {
    const errors: string[] = [];
    const files = await scanWorkspace(this.workspaceDir, this.scanOptions);

    let chunksCreated = 0;
    let filesIndexed = 0;

    for (const file of files) {
      // Skip unchanged files
      const prevModified = this.indexedFiles.get(file.relPath);
      if (prevModified && prevModified >= file.lastModified) continue;

      try {
        const content = await readFile(file.absPath, "utf8");
        const chunks = chunkDocument(content, this.chunkOptions);

        // Remove old chunks for this file
        this.vectorStore.removeByFile(file.relPath);

        for (let i = 0; i < chunks.length; i++) {
          const chunk = chunks[i]!;
          const doc: VectorDocument = {
            id: `${file.relPath}#${i}`,
            content: chunk.text,
            metadata: {
              filePath: file.relPath,
              chunkIndex: i,
              totalChunks: chunks.length,
              fileType: file.ext,
              lastModified: file.lastModified
            }
          };
          this.vectorStore.addDocument(doc);
          chunksCreated++;
        }

        this.indexedFiles.set(file.relPath, file.lastModified);
        filesIndexed++;
      } catch (err) {
        errors.push(`${file.relPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Remove entries for deleted files
    for (const filePath of this.indexedFiles.keys()) {
      if (!files.some(f => f.relPath === filePath)) {
        this.vectorStore.removeByFile(filePath);
        this.indexedFiles.delete(filePath);
      }
    }

    this.lastIndexedAt = new Date().toISOString();
    await this.save();

    return { filesIndexed, chunksCreated, errors };
  }

  // ── Query ─────────────────────────────────────────────────────────────────────

  /** Search the knowledge base and return relevant context as a formatted string */
  async query(queryText: string, topK: number = 5): Promise<SearchResult[]> {
    if (this.vectorStore.size === 0) return [];

    const results = this.vectorStore.search(queryText, topK);
    return results.map(r => ({
      content: r.doc.content,
      filePath: r.doc.metadata.filePath,
      chunkIndex: r.doc.metadata.chunkIndex,
      score: Math.round(r.score * 100) / 100
    }));
  }

  /** Get context as a formatted string ready for prompt injection */
  async getContextString(queryText: string, topK: number = 5, maxChars: number = 3000): Promise<string> {
    const results = await this.query(queryText, topK);
    if (results.length === 0) return "";

    let context = "## 相关工作区文件内容\n\n";
    let totalChars = context.length;

    for (const r of results) {
      const entry = `### ${r.filePath} (相关性: ${r.score})\n\`\`\`\n${r.content}\n\`\`\`\n\n`;
      if (totalChars + entry.length > maxChars + context.length) break;
      context += entry;
      totalChars += entry.length;
    }

    return context;
  }

  // ── Persistence ───────────────────────────────────────────────────────────────

  async save(): Promise<void> {
    await mkdir(this.storageDir, { recursive: true });

    const data = {
      lastIndexedAt: this.lastIndexedAt,
      indexedFiles: Array.from(this.indexedFiles.entries()),
      vectorStore: this.vectorStore.toJSON()
    };

    await writeFile(
      join(this.storageDir, "kb-index.json"),
      JSON.stringify(data, null, 2),
      "utf8"
    );
  }

  async load(): Promise<boolean> {
    try {
      const raw = await readFile(join(this.storageDir, "kb-index.json"), "utf8");
      const data = JSON.parse(raw);

      if (data.lastIndexedAt) this.lastIndexedAt = data.lastIndexedAt;
      if (data.indexedFiles) {
        this.indexedFiles.clear();
        for (const [k, v] of data.indexedFiles) {
          this.indexedFiles.set(k, v);
        }
      }
      if (data.vectorStore) {
        this.vectorStore.clear();
        this.vectorStore.loadFromJSON(data.vectorStore);
      }

      return true;
    } catch {
      return false;
    }
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  getStats(): KnowledgeStats {
    const vs = this.vectorStore.getStats();
    return {
      indexedFiles: vs.fileCount,
      totalChunks: vs.documentCount,
      totalTerms: vs.termCount,
      lastIndexedAt: this.lastIndexedAt
    };
  }

  /** Clear all indexed data */
  async clear(): Promise<void> {
    this.vectorStore.clear();
    this.indexedFiles.clear();
    this.lastIndexedAt = null;
  }

  /** Re-index everything from scratch */
  async reindex(): Promise<{ filesIndexed: number; chunksCreated: number; errors: string[] }> {
    await this.clear();
    return this.index();
  }
}
