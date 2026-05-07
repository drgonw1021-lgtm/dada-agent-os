import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface SemanticEntry {
  id: string;
  text: string;
  embedding: number[];
  tags: string[];
  createdAt: string;
  lastAccessedAt: string;
  accessCount: number;
}

export interface SemanticSearchResult {
  entry: SemanticEntry;
  similarity: number;
}

// ─── Stop words (EN + CN) ─────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "through", "during",
  "before", "after", "above", "below", "between", "under", "again",
  "then", "once", "here", "there", "when", "where", "why", "how",
  "all", "both", "each", "few", "more", "most", "other", "some", "such",
  "no", "nor", "not", "only", "own", "same", "so", "than", "too",
  "very", "just", "about", "also", "but", "and", "or", "if", "this",
  "that", "it", "its", "he", "she", "they", "them", "we", "you", "i",
  "me", "my", "your", "his", "her", "our", "their", "what", "which",
  "who", "whom", "up", "down", "out", "off", "over",
  // Chinese stop words
  "的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都", "一",
  "一个", "这", "那", "他", "她", "它", "们", "你", "么", "吗", "吧",
  "啊", "嗯", "哦", "呀", "啦", "吧", "呢", "哈", "哇", "呵", "嗨",
  "与", "及", "或", "但", "而", "且", "虽", "然", "所", "以", "因",
  "为", "于", "对", "从", "被", "把", "将", "向", "让", "给", "到",
  "着", "过", "去", "来", "能", "会", "要", "可", "可以", "应该",
  "已经", "正在", "还是", "就是", "如果", "虽然", "因为", "所以",
  "什么", "怎么", "哪", "哪里", "谁", "几", "多", "少", "很", "最",
  "太", "更", "非常", "比较", "没", "没有", "别", "勿", "请",
]);

// ─── Memory ───────────────────────────────────────────────────────────────────────

export class SemanticMemory {
  private entries: Map<string, SemanticEntry> = new Map();
  private persistPath: string;
  private initialized = false;
  private embeddingAvailable = false;

  // Multi-index: tag → entry IDs for fast filtered search
  private tagIndex: Map<string, Set<string>> = new Map();
  // TF-IDF vocabulary: word → { df: doc frequency, idf: precomputed idf }
  private vocabulary: Map<string, { df: number; idf: number }> = new Map();
  // Embedding cache: entry ID → embedding (avoids recomputation)
  private embeddingCache: Map<string, number[]> = new Map();
  // Query cache: query hash → results (TTL-based, cleared periodically)
  private queryCache: Map<string, { results: SemanticSearchResult[]; timestamp: number }> = new Map();
  private queryCacheHits = 0;
  private queryCacheMaxSize = 50;

  // Fallback: keyword-based vector simulation when embeddings aren't available
  private keywordVectors: Map<string, number[]> = new Map();
  private dimensions = 128;

  constructor(persistPath: string = "./.agent/semantic-memory.json") {
    this.persistPath = persistPath;
  }

  async initialize(): Promise<void> {
    await mkdir(join(this.persistPath, ".."), { recursive: true });
    if (existsSync(this.persistPath)) {
      try {
        const raw = await readFile(this.persistPath, "utf8");
        const data = JSON.parse(raw) as SemanticEntry[];
        for (const entry of data) {
          this.entries.set(entry.id, entry);
          // Rebuild tag index
          for (const tag of entry.tags) {
            this.addToTagIndex(entry.id, tag);
          }
          // Rebuild TF-IDF vocabulary
          this.indexText(entry.text);
          // Populate embedding cache from stored embeddings
          if (entry.embedding && entry.embedding.length > 0) {
            this.embeddingCache.set(entry.id, entry.embedding);
          }
        }
        console.log(`[SemanticMemory] Loaded ${this.entries.size} entries, ${this.vocabulary.size} terms indexed`);
      } catch {
        console.log(`[SemanticMemory] Could not load store, starting fresh`);
      }
    }

    await this.tryInitEmbeddings();
    this.initialized = true;
  }

  private async tryInitEmbeddings(): Promise<void> {
    try {
      const { getLlama } = await import("node-llama-cpp");
      const llama = await getLlama({ gpu: false, progressLogs: false });
      (this as any)._llama = llama;
      this.embeddingAvailable = true;
      console.log(`[SemanticMemory] Embedding capability initialized`);
    } catch {
      console.log(`[SemanticMemory] Embeddings unavailable, using TF-IDF keyword similarity fallback`);
      this.embeddingAvailable = false;
    }
  }

  isEmbeddingAvailable(): boolean {
    return this.embeddingAvailable;
  }

  async addEntry(text: string, tags: string[] = []): Promise<SemanticEntry> {
    const embedding = await this.generateEmbedding(text);

    const entry: SemanticEntry = {
      id: randomUUID(),
      text,
      embedding,
      tags,
      createdAt: new Date().toISOString(),
      lastAccessedAt: new Date().toISOString(),
      accessCount: 0
    };

    this.entries.set(entry.id, entry);
    this.embeddingCache.set(entry.id, embedding);

    // Update indices
    for (const tag of tags) {
      this.addToTagIndex(entry.id, tag);
    }
    this.indexText(text);
    this.invalidateQueryCache();

    // Keep memory bounded - remove oldest if over 1000 entries
    if (this.entries.size > 1000) {
      const oldest = Array.from(this.entries.values())
        .sort((a, b) => new Date(a.lastAccessedAt).getTime() - new Date(b.lastAccessedAt).getTime())
        [0];
      if (oldest) {
        this.removeEntry(oldest.id);
      }
    }

    await this.persist();
    return entry;
  }

  /**
   * Two-pass search: fast keyword pre-filter, then embedding reranking.
   * When embeddings are available, uses cosine similarity on real vectors.
   * Falls back to TF-IDF weighted keyword similarity.
   */
  async search(query: string, limit = 10, threshold = 0.3): Promise<SemanticSearchResult[]> {
    // Check query cache
    const cacheKey = `${query}:${limit}:${threshold}`;
    const cached = this.queryCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < 30000) {
      this.queryCacheHits++;
      return cached.results;
    }

    const queryEmbedding = await this.generateEmbedding(query);
    const results: SemanticSearchResult[] = [];

    for (const entry of this.entries.values()) {
      // Get cached embedding or compute
      let entryEmbedding = this.embeddingCache.get(entry.id);
      if (!entryEmbedding) {
        entryEmbedding = entry.embedding;
        if (entryEmbedding.length > 0) {
          this.embeddingCache.set(entry.id, entryEmbedding);
        }
      }

      const similarity = this.cosineSimilarity(queryEmbedding, entryEmbedding);
      if (similarity >= threshold) {
        results.push({ entry, similarity });
      }
    }

    // Sort by similarity descending, then boost by recency
    results.sort((a, b) => {
      const scoreDiff = b.similarity - a.similarity;
      if (Math.abs(scoreDiff) > 0.05) return scoreDiff;
      // Recency boost for ties: newer entries rank higher
      return new Date(b.entry.createdAt).getTime() - new Date(a.entry.createdAt).getTime();
    });

    const top = results.slice(0, limit);

    // Mark accessed
    for (const r of top) {
      r.entry.accessCount++;
      r.entry.lastAccessedAt = new Date().toISOString();
    }

    if (top.length > 0) await this.persist();

    // Cache results
    this.addToQueryCache(cacheKey, top);

    return top;
  }

  /**
   * Tag-filtered search: only search within entries matching given tags.
   */
  async searchByTags(
    query: string,
    tags: string[],
    limit = 10,
    threshold = 0.3
  ): Promise<SemanticSearchResult[]> {
    if (tags.length === 0) return this.search(query, limit, threshold);

    // Find entry IDs matching all specified tags
    const firstIds = this.tagIndex.get(tags[0].toLowerCase());
    if (!firstIds || firstIds.size === 0) return [];
    let candidateIds = new Set<string>(firstIds);

    for (let i = 1; i < tags.length; i++) {
      const ids = this.tagIndex.get(tags[i].toLowerCase());
      if (!ids || ids.size === 0) return [];
      const filtered = new Set<string>();
      for (const id of candidateIds) {
        if (ids.has(id)) filtered.add(id);
      }
      candidateIds = filtered;
    }

    if (!candidateIds || candidateIds.size === 0) return [];

    const queryEmbedding = await this.generateEmbedding(query);
    const results: SemanticSearchResult[] = [];

    for (const id of candidateIds) {
      const entry = this.entries.get(id);
      if (!entry) continue;

      const entryEmbedding = this.embeddingCache.get(entry.id) || entry.embedding;
      const similarity = this.cosineSimilarity(queryEmbedding, entryEmbedding);
      if (similarity >= threshold) {
        results.push({ entry, similarity });
      }
    }

    results.sort((a, b) => b.similarity - a.similarity);

    const top = results.slice(0, limit);
    for (const r of top) {
      r.entry.accessCount++;
      r.entry.lastAccessedAt = new Date().toISOString();
    }
    if (top.length > 0) await this.persist();

    return top;
  }

  /**
   * Recency-boosted search: prefer recent entries for time-sensitive queries.
   */
  async searchRecent(query: string, limit = 10, threshold = 0.3): Promise<SemanticSearchResult[]> {
    const results = await this.search(query, Math.max(limit * 2, 20), threshold * 0.8);

    // Boost recent entries (within last 24h get 15% boost, within last week get 5%)
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const WEEK = 7 * DAY;

    const boosted = results.map(r => {
      const age = now - new Date(r.entry.createdAt).getTime();
      let boost = 1.0;
      if (age < DAY) boost = 1.15;
      else if (age < WEEK) boost = 1.05;
      return { ...r, similarity: r.similarity * boost };
    });

    boosted.sort((a, b) => b.similarity - a.similarity);
    return boosted.slice(0, limit);
  }

  async getRelevantContext(text: string, limit = 5): Promise<string> {
    // Try tag-filtered search first based on extracted keywords
    const keywords = this.extractKeywords(text);
    const tagResults = keywords.length > 0
      ? await this.searchByTags(text, keywords.slice(0, 3), limit, 0.25)
      : [];

    // Fall back to regular search if tag search returns too few results
    let results = tagResults;
    if (results.length < limit) {
      const regular = await this.search(text, limit);
      // Merge, deduplicate by entry ID
      const seen = new Set(results.map(r => r.entry.id));
      for (const r of regular) {
        if (!seen.has(r.entry.id)) {
          results.push(r);
          seen.add(r.entry.id);
        }
      }
      results.sort((a, b) => b.similarity - a.similarity);
      results = results.slice(0, limit);
    }

    if (results.length === 0) return "";

    return `## Semantically Similar Past Experience\n\n${
      results.map((r, i) =>
        `**Match ${i + 1}** (${(r.similarity * 100).toFixed(0)}%): ${r.entry.text.substring(0, 300)}`
      ).join("\n\n")
    }`;
  }

  async consolidateFrom(texts: string[], tags: string[] = []): Promise<void> {
    for (const text of texts) {
      const existing = await this.search(text, 1, 0.85);
      if (existing.length === 0) {
        await this.addEntry(text, tags);
      }
    }
  }

  async getStats(): Promise<{
    totalEntries: number;
    embeddingAvailable: boolean;
    vocabularySize: number;
    tagIndexSize: number;
    queryCacheHits: number;
  }> {
    return {
      totalEntries: this.entries.size,
      embeddingAvailable: this.embeddingAvailable,
      vocabularySize: this.vocabulary.size,
      tagIndexSize: this.tagIndex.size,
      queryCacheHits: this.queryCacheHits,
    };
  }

  // ─── Embedding generation ────────────────────────────────────────────────────

  private async generateEmbedding(text: string): Promise<number[]> {
    if (this.embeddingAvailable) {
      try {
        return await this.generateLlamaEmbedding(text);
      } catch {
        // Fall through to TF-IDF fallback
      }
    }
    return this.tfidfEmbedding(text);
  }

  private async generateLlamaEmbedding(text: string): Promise<number[]> {
    const llama = (this as any)._llama;
    if (!llama) throw new Error("Llama not initialized");

    const embeddingContext = await llama.createEmbeddingContext({
      contextSize: 512
    });

    try {
      const embedding = await embeddingContext.createEmbedding({ text });
      const vec = Array.from(embedding.vector as Float32Array) as number[];
      return this.normalize(vec);
    } finally {
      if (embeddingContext?.dispose) {
        embeddingContext.dispose();
      }
    }
  }

  /**
   * TF-IDF weighted keyword embedding.
   * Much better than simple pseudo-random vectors:
   * - Tokenizes text into words (EN + CN)
   * - Weights each word by its TF-IDF score
   * - Uses deterministic word vectors for cosine similarity
   */
  private tfidfEmbedding(text: string): number[] {
    const vector = new Array(this.dimensions).fill(0);
    const tokens = this.tokenize(text);

    if (tokens.length === 0) return vector;

    // Compute term frequencies for this text
    const tf: Map<string, number> = new Map();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    // Weight by TF-IDF and accumulate
    const maxTf = Math.max(...tf.values());
    let totalWeight = 0;

    for (const [token, count] of tf) {
      const tfNorm = count / maxTf; // Normalized TF
      const idf = this.getIdf(token); // IDF from vocabulary
      const weight = tfNorm * idf;

      const wordVec = this.getWordVector(token);
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] += wordVec[i] * weight;
      }
      totalWeight += weight;
    }

    if (totalWeight > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] /= totalWeight;
      }
    }

    return this.normalize(vector);
  }

  // ─── Tokenization ───────────────────────────────────────────────────────────

  private tokenize(text: string): string[] {
    const tokens: string[] = [];

    // Extract Chinese characters as bigrams for better semantic matching
    const cnChars = text.match(/[一-鿿]+/g);
    if (cnChars) {
      for (const word of cnChars) {
        if (word.length >= 2 && !STOP_WORDS.has(word)) {
          tokens.push(word);
          // Also add character bigrams for partial matching
          for (let i = 0; i < word.length - 1; i++) {
            tokens.push(word.substring(i, i + 2));
          }
        }
      }
    }

    // Extract English/alpha words
    const enWords = text.toLowerCase().match(/[a-z_][a-z0-9_]{1,30}/gi);
    if (enWords) {
      for (const word of enWords) {
        const w = word.toLowerCase();
        if (!STOP_WORDS.has(w) && w.length >= 2) {
          tokens.push(w);
        }
      }
    }

    return tokens;
  }

  private extractKeywords(text: string): string[] {
    const tokens = this.tokenize(text);
    const tf: Map<string, number> = new Map();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    // Score by TF-IDF, return top keywords
    const scored = Array.from(tf.entries())
      .map(([token, count]) => ({ token, score: count * this.getIdf(token) }))
      .sort((a, b) => b.score - a.score);

    return scored.slice(0, 10).map(s => s.token);
  }

  // ─── TF-IDF vocabulary ──────────────────────────────────────────────────────

  private indexText(text: string): void {
    const tokens = new Set(this.tokenize(text));
    for (const token of tokens) {
      const entry = this.vocabulary.get(token);
      if (entry) {
        entry.df++;
      } else {
        this.vocabulary.set(token, { df: 1, idf: 0 });
      }
    }
    // Recompute IDFs for affected terms
    const N = this.entries.size;
    for (const token of tokens) {
      const entry = this.vocabulary.get(token);
      if (entry) {
        entry.idf = Math.log((N + 1) / (entry.df + 1)) + 1;
      }
    }
  }

  private getIdf(token: string): number {
    const entry = this.vocabulary.get(token);
    if (entry && entry.idf > 0) return entry.idf;
    // Default IDF for unknown terms
    return Math.log((this.entries.size + 2) / 2) + 1;
  }

  // ─── Word vectors ───────────────────────────────────────────────────────────

  /**
   * Deterministic word vector using FNV-1a hash with better bit mixing.
   * Produces pseudo-orthogonal vectors suitable for cosine similarity.
   */
  private getWordVector(word: string): number[] {
    const cached = this.keywordVectors.get(word);
    if (cached) return cached;

    const vec = new Array(this.dimensions).fill(0);

    // Use multiple hash seeds for better distribution across dimensions
    for (let i = 0; i < this.dimensions; i++) {
      // FNV-1a with dimension-specific seed
      let hash = 2166136261 >>> 0;
      const seed = i * 2654435761;
      hash = ((hash ^ (seed & 0xFF)) * 16777619) >>> 0;
      hash = ((hash ^ ((seed >> 8) & 0xFF)) * 16777619) >>> 0;

      for (let j = 0; j < word.length; j++) {
        hash = ((hash ^ word.charCodeAt(j)) * 16777619) >>> 0;
      }

      // Convert to normal distribution approximation via Box-Muller on hashed bits
      const u = (hash & 0xFFFF) / 0xFFFF;
      const v = ((hash >> 16) & 0xFFFF) / 0xFFFF;
      vec[i] = Math.sqrt(-2 * Math.log(Math.max(u, 0.001))) * Math.cos(2 * Math.PI * v);
    }

    const normalized = this.normalize(vec);
    this.keywordVectors.set(word, normalized);
    return normalized;
  }

  // ─── Index management ───────────────────────────────────────────────────────

  private addToTagIndex(entryId: string, tag: string): void {
    const key = tag.toLowerCase();
    if (!this.tagIndex.has(key)) {
      this.tagIndex.set(key, new Set());
    }
    this.tagIndex.get(key)!.add(entryId);
  }

  private removeFromTagIndex(entryId: string): void {
    for (const [, ids] of this.tagIndex) {
      ids.delete(entryId);
    }
  }

  private removeEntry(id: string): void {
    this.entries.delete(id);
    this.embeddingCache.delete(id);
    this.removeFromTagIndex(id);
  }

  // ─── Query cache ────────────────────────────────────────────────────────────

  private addToQueryCache(key: string, results: SemanticSearchResult[]): void {
    if (this.queryCache.size >= this.queryCacheMaxSize) {
      // Evict oldest entry
      let oldestKey = "";
      let oldestTime = Infinity;
      for (const [k, v] of this.queryCache) {
        if (v.timestamp < oldestTime) {
          oldestTime = v.timestamp;
          oldestKey = k;
        }
      }
      if (oldestKey) this.queryCache.delete(oldestKey);
    }
    this.queryCache.set(key, { results, timestamp: Date.now() });
  }

  private invalidateQueryCache(): void {
    // Only clear if cache is getting stale (many entries)
    // Don't clear on every single add — amortized invalidation
    if (this.queryCache.size > 0 && this.entries.size % 10 === 0) {
      this.queryCache.clear();
    }
  }

  // ─── Math ────────────────────────────────────────────────────────────────────

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  private normalize(vec: number[]): number[] {
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (magnitude === 0) return vec;
    return vec.map(v => v / magnitude);
  }

  private async persist(): Promise<void> {
    const data = Array.from(this.entries.values());
    await writeFile(this.persistPath, JSON.stringify(data, null, 2), "utf8");
  }
}
