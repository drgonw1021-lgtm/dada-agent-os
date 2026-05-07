/**
 * EmbeddingService — pluggable text embedding with multiple backends.
 *
 * Backends (tried in order):
 *   1. node-llama-cpp (already a project dependency, if a GGUF model is loaded)
 *   2. Local HTTP endpoint (Ollama, LM Studio, vLLM — OpenAI /v1/embeddings API)
 *   3. TF-IDF deterministic hash (always available, zero-dependency fallback)
 *
 * All backends produce normalized float32 vectors. Dimensionality varies by backend;
 * the service records which backend produced each vector so similarity can be
 * computed within the same embedding space.
 */

import { createHash } from "node:crypto";

export type EmbeddingBackend = "llama-cpp" | "local-http" | "tfidf-hash";

export interface EmbeddingVector {
  values: number[];
  backend: EmbeddingBackend;
  dimensions: number;
  model?: string;
}

export interface EmbeddingServiceOptions {
  /** URL for a local OpenAI-compatible embeddings endpoint */
  localEmbeddingEndpoint?: string;
  /** Model name to pass to the local endpoint */
  localEmbeddingModel?: string;
  /** Dimensions for TF-IDF hash fallback (default 128) */
  hashDimensions?: number;
}

/**
 * Normalize a vector to unit length (in place).
 */
function normalize(vec: number[]): number[] {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

/**
 * Cosine similarity between two same-length vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export class EmbeddingService {
  private backend: EmbeddingBackend = "tfidf-hash";
  private dims: number;
  private llamaEmbeddingFn: ((text: string) => Promise<number[]>) | null = null;

  constructor(private options: EmbeddingServiceOptions = {}) {
    this.dims = options.hashDimensions || 128;
  }

  get activeBackend(): EmbeddingBackend {
    return this.backend;
  }

  get dimensions(): number {
    return this.dims;
  }

  // ── Backend registration ──────────────────────────────────────────────

  /** Register a node-llama-cpp embedding function. Call once after model loads. */
  setLlamaEmbedding(fn: (text: string) => Promise<number[]>): void {
    this.llamaEmbeddingFn = fn;
    this.backend = "llama-cpp";
    // Llama embeddings are typically 384-4096 dims — probe on first use
  }

  /** Enable the local HTTP backend (Ollama/LM Studio/vLLM compatible). */
  enableLocalHttp(endpoint?: string, model?: string): void {
    if (endpoint) this.options.localEmbeddingEndpoint = endpoint;
    if (model) this.options.localEmbeddingModel = model;
    if (this.options.localEmbeddingEndpoint) {
      this.backend = "local-http";
    }
  }

  // ── Embedding ─────────────────────────────────────────────────────────

  async embed(text: string): Promise<EmbeddingVector> {
    switch (this.backend) {
      case "llama-cpp":
        return this.embedLlamaCpp(text);
      case "local-http":
        return this.embedLocalHttp(text);
      default:
        return this.embedTfidfHash(text);
    }
  }

  async embedBatch(texts: string[]): Promise<EmbeddingVector[]> {
    return Promise.all(texts.map(t => this.embed(t)));
  }

  // ── Backend implementations ───────────────────────────────────────────

  private async embedLlamaCpp(text: string): Promise<EmbeddingVector> {
    if (!this.llamaEmbeddingFn) {
      return this.embedTfidfHash(text);
    }
    try {
      const values = await this.llamaEmbeddingFn(text);
      this.dims = values.length;
      return { values: normalize(values), backend: "llama-cpp", dimensions: values.length };
    } catch {
      // Fallback on error
      return this.embedTfidfHash(text);
    }
  }

  private async embedLocalHttp(text: string): Promise<EmbeddingVector> {
    const endpoint = this.options.localEmbeddingEndpoint;
    if (!endpoint) return this.embedTfidfHash(text);

    try {
      const url = endpoint.endsWith("/embeddings") ? endpoint : endpoint + "/embeddings";
      const model = this.options.localEmbeddingModel || "text-embedding-bge-small-zh";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: text, model }),
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const json = await res.json() as { data?: Array<{ embedding: number[] }> };
      const values = json.data?.[0]?.embedding;
      if (!values || !Array.isArray(values)) throw new Error("No embedding in response");

      this.dims = values.length;
      return { values: normalize(values), backend: "local-http", dimensions: values.length, model };
    } catch {
      return this.embedTfidfHash(text);
    }
  }

  private embedTfidfHash(text: string): EmbeddingVector {
    const dims = this.dims;
    const values = new Array(dims).fill(0);

    // Tokenize: Chinese bigrams + English words
    const tokens: string[] = [];
    let buf = "";
    for (const ch of text) {
      if (/[一-鿿]/.test(ch)) {
        if (buf) { tokens.push(buf.toLowerCase()); buf = ""; }
        tokens.push(ch);
      } else if (/[a-zA-Z0-9]/.test(ch)) {
        buf += ch;
      } else {
        if (buf) { tokens.push(buf.toLowerCase()); buf = ""; }
      }
    }
    if (buf) tokens.push(buf.toLowerCase());

    // Bigrams for Chinese
    const chineseChars = tokens.filter(t => /^[一-鿿]$/.test(t));
    for (let i = 0; i < chineseChars.length - 1; i++) {
      tokens.push(chineseChars[i] + chineseChars[i + 1]);
    }

    // IDF-like weighting: term frequency in this document
    const tf = new Map<string, number>();
    for (const t of tokens) {
      if (t.length < 2 || t.length > 30) continue;
      tf.set(t, (tf.get(t) || 0) + 1);
    }

    // Deterministic hash to vector component + sign
    for (const [token, freq] of tf) {
      const hash = createHash("sha256").update(token).digest();
      for (let i = 0; i < dims; i++) {
        const h = hash[i % hash.length];
        const component = (h + i * 0.618033988749895) % dims;
        // FNV-1a style mixing for sign
        const sign = ((hash[(i * 7 + 3) % hash.length] & 1) ? -1 : 1);
        values[i] += sign * freq * (1.0 / (1 + Math.log(1 + i)));
      }
    }

    return {
      values: normalize(values),
      backend: "tfidf-hash",
      dimensions: dims,
    };
  }
}
