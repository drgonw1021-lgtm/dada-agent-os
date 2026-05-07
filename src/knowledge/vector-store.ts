/**
 * TF-IDF vector store with cosine similarity search.
 * Zero external dependencies — works on any Node.js runtime.
 */

export interface VectorDocument {
  id: string;
  content: string;
  metadata: DocumentMeta;
}

export interface DocumentMeta {
  filePath: string;
  chunkIndex: number;
  totalChunks: number;
  fileType: string;
  lastModified: number;
}

interface TermIndex {
  /** term → docId → tf (term frequency in document) */
  index: Map<string, Map<string, number>>;
  /** docId → term count (for IDF) */
  docLengths: Map<string, number>;
  /** global document frequency: term → how many docs contain it */
  df: Map<string, number>;
}

const TOKEN_PATTERN = /[\p{L}\p{N}]{2,}/gu;

function tokenize(text: string): string[] {
  const tokens = text.toLowerCase().match(TOKEN_PATTERN);
  return tokens ?? [];
}

export class VectorStore {
  private docs = new Map<string, VectorDocument>();
  private termIndex: TermIndex = { index: new Map(), docLengths: new Map(), df: new Map() };

  // ── Indexing ──────────────────────────────────────────────────────────────────

  addDocument(doc: VectorDocument): void {
    this.removeDocument(doc.id);
    this.docs.set(doc.id, doc);

    const tokens = tokenize(doc.content);
    const tf = new Map<string, number>();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
    }

    this.termIndex.docLengths.set(doc.id, tokens.length);

    for (const [term, count] of tf) {
      let postings = this.termIndex.index.get(term);
      if (!postings) {
        postings = new Map();
        this.termIndex.index.set(term, postings);
      }
      postings.set(doc.id, count);
      this.termIndex.df.set(term, (this.termIndex.df.get(term) ?? 0) + 1);
    }
  }

  removeDocument(docId: string): void {
    const existing = this.docs.get(docId);
    if (existing) {
      const tokens = tokenize(existing.content);
      for (const t of new Set(tokens)) {
        const postings = this.termIndex.index.get(t);
        if (postings) {
          postings.delete(docId);
          if (postings.size === 0) this.termIndex.index.delete(t);
        }
        const df = this.termIndex.df.get(t);
        if (df !== undefined) {
          if (df <= 1) this.termIndex.df.delete(t);
          else this.termIndex.df.set(t, df - 1);
        }
      }
      this.termIndex.docLengths.delete(docId);
      this.docs.delete(docId);
    }
  }

  removeByFile(filePath: string): number {
    let removed = 0;
    for (const [id, doc] of this.docs) {
      if (doc.metadata.filePath === filePath) {
        this.removeDocument(id);
        removed++;
      }
    }
    return removed;
  }

  // ── Search ────────────────────────────────────────────────────────────────────

  search(query: string, topK: number = 5): { doc: VectorDocument; score: number }[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    const queryVec = this.computeQueryVector(queryTokens);
    const totalDocs = this.docs.size;
    if (totalDocs === 0) return [];

    // Compute cosine similarity for each doc
    const scores: { doc: VectorDocument; score: number }[] = [];

    for (const doc of this.docs.values()) {
      const docVec = this.computeDocVector(doc.id);
      if (!docVec) continue;
      const score = this.cosineSimilarity(queryVec, docVec);
      if (score > 0) {
        scores.push({ doc, score });
      }
    }

    return scores
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // ── Vector helpers ────────────────────────────────────────────────────────────

  private computeQueryVector(tokens: string[]): Map<string, number> {
    const vec = new Map<string, number>();
    const totalDocs = this.docs.size;

    for (const t of tokens) {
      const tf = (vec.get(t) ?? 0) + 1;
      vec.set(t, tf);

      const df = this.termIndex.df.get(t) ?? 0;
      if (df > 0 && totalDocs > 0) {
        vec.set(t, tf * Math.log((totalDocs + 1) / (df + 1)) + 1);
      }
    }

    return vec;
  }

  private computeDocVector(docId: string): Map<string, number> | null {
    const totalDocs = this.docs.size;
    const length = this.termIndex.docLengths.get(docId);
    if (!length) return null;

    const vec = new Map<string, number>();
    for (const [term, postings] of this.termIndex.index) {
      const tf = postings.get(docId);
      if (tf) {
        const df = this.termIndex.df.get(term) ?? 1;
        const idf = Math.log((totalDocs + 1) / (df + 1)) + 1;
        vec.set(term, (tf / length) * idf);
      }
    }
    return vec;
  }

  private cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (const [term, weightA] of a) {
      normA += weightA * weightA;
      const weightB = b.get(term);
      if (weightB !== undefined) dot += weightA * weightB;
    }

    for (const weightB of b.values()) {
      normB += weightB * weightB;
    }

    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ── Persistence ───────────────────────────────────────────────────────────────

  toJSON(): { docs: VectorDocument[] } {
    return { docs: Array.from(this.docs.values()) };
  }

  loadFromJSON(data: { docs: VectorDocument[] }): void {
    this.clear();
    for (const doc of data.docs) {
      this.addDocument(doc);
    }
  }

  clear(): void {
    this.docs.clear();
    this.termIndex = { index: new Map(), docLengths: new Map(), df: new Map() };
  }

  get size(): number {
    return this.docs.size;
  }

  getStats(): { documentCount: number; fileCount: number; termCount: number } {
    const files = new Set<string>();
    for (const doc of this.docs.values()) {
      files.add(doc.metadata.filePath);
    }
    return {
      documentCount: this.docs.size,
      fileCount: files.size,
      termCount: this.termIndex.index.size
    };
  }
}
