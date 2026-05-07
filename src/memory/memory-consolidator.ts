/**
 * MemoryConsolidator — periodically compacts and summarizes old memories
 * into high-value "insight" entries, preventing unbounded growth while
 * preserving key learnings.
 */

import { randomUUID } from "node:crypto";
import type { EmbeddingService } from "./embedding-service.js";

export interface MemoryInsight {
  id: string;
  /** Human-readable summary of the insight */
  summary: string;
  /** The original memory IDs that were consolidated */
  sourceIds: string[];
  /** Category tag */
  category: "pattern" | "pitfall" | "strategy" | "fact";
  /** When this insight was created */
  createdAt: string;
  /** Number of memories consolidated into this insight */
  sourceCount: number;
  /** Confidence (0-1) based on pattern repetition */
  confidence: number;
}

export interface ConsolidationOptions {
  /** Minimum number of similar memories to trigger consolidation */
  minClusterSize: number;
  /** Similarity threshold for clustering (cosine similarity, 0-1) */
  similarityThreshold: number;
  /** Maximum age of memories to consider (ms). Older memories get priority. */
  maxAgeMs: number;
  /** Maximum number of insights to keep */
  maxInsights: number;
}

const DEFAULT_OPTIONS: ConsolidationOptions = {
  minClusterSize: 3,
  similarityThreshold: 0.75,
  maxAgeMs: 7 * 24 * 3600_000, // 7 days
  maxInsights: 200,
};

export interface ConsolidatableEntry {
  id: string;
  text: string;
  tags: string[];
  createdAt: string;
}

export class MemoryConsolidator {
  private insights: MemoryInsight[] = [];

  constructor(
    private embeddingService: EmbeddingService,
    private options: ConsolidationOptions = DEFAULT_OPTIONS
  ) {}

  // ── Clustering ────────────────────────────────────────────────────────

  /**
   * Cluster similar memories together, then generate insight summaries.
   * Returns newly created insights.
   */
  async consolidate(
    entries: ConsolidatableEntry[],
    existingInsights: MemoryInsight[] = []
  ): Promise<MemoryInsight[]> {
    this.insights = existingInsights;

    if (entries.length < this.options.minClusterSize) return [];

    // Only consider entries older than 1 hour (let fresh ones stay raw)
    const now = Date.now();
    const candidates = entries.filter(e => {
      const age = now - new Date(e.createdAt).getTime();
      return age > 3600_000; // older than 1 hour
    });

    if (candidates.length < this.options.minClusterSize) return [];

    // Embed all candidates
    const vectors = await this.embeddingService.embedBatch(
      candidates.map(e => e.text.slice(0, 500))
    );

    // Simple greedy clustering: find groups of similar entries
    const clusters: Array<{ entries: ConsolidatableEntry[]; centroid: number[] }> = [];
    const assigned = new Set<number>();

    for (let i = 0; i < candidates.length; i++) {
      if (assigned.has(i)) continue;
      const cluster: ConsolidatableEntry[] = [candidates[i]];
      const groupVectors: number[][] = [vectors[i].values];

      for (let j = i + 1; j < candidates.length; j++) {
        if (assigned.has(j)) continue;
        // Compare with all current group members — use average similarity
        let totalSim = 0;
        for (const gv of groupVectors) {
          totalSim += cosineSim(vectors[i].values, vectors[j].values);
        }
        const avgSim = totalSim / groupVectors.length;

        if (avgSim >= this.options.similarityThreshold) {
          cluster.push(candidates[j]);
          groupVectors.push(vectors[j].values);
          assigned.add(j);
        }
      }

      if (cluster.length >= this.options.minClusterSize) {
        assigned.add(i);
        // Compute centroid
        const centroid = new Array(vectors[0].values.length).fill(0);
        for (const gv of groupVectors) {
          for (let k = 0; k < centroid.length; k++) {
            centroid[k] += gv[k];
          }
        }
        for (let k = 0; k < centroid.length; k++) {
          centroid[k] /= groupVectors.length;
        }
        clusters.push({ entries: cluster, centroid });
      }
    }

    // Generate insights from clusters
    const newInsights: MemoryInsight[] = [];
    for (const cluster of clusters) {
      const insight = this.createInsight(cluster);
      newInsights.push(insight);
      this.insights.push(insight);
    }

    // Prune old insights
    while (this.insights.length > this.options.maxInsights) {
      this.insights.shift();
    }

    return newInsights;
  }

  private createInsight(cluster: {
    entries: ConsolidatableEntry[];
    centroid: number[];
  }): MemoryInsight {
    // Determine category from tags
    const tagCounts = new Map<string, number>();
    for (const e of cluster.entries) {
      for (const t of e.tags) {
        tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
      }
    }

    let category: MemoryInsight["category"] = "fact";
    const tagStr = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t)
      .join(" ");

    if (/error|fail|bug|pitfall|trap/i.test(tagStr)) category = "pitfall";
    else if (/pattern|template|workflow|recipe/i.test(tagStr)) category = "pattern";
    else if (/strategy|plan|approach|decision/i.test(tagStr)) category = "strategy";

    // Build summary from entry texts
    const summaries = cluster.entries.map(e =>
      e.text.slice(0, 120).replace(/\n/g, " ")
    );

    return {
      id: randomUUID(),
      summary: summaries[0], // Most representative (first in cluster)
      sourceIds: cluster.entries.map(e => e.id),
      category,
      createdAt: new Date().toISOString(),
      sourceCount: cluster.entries.length,
      confidence: Math.min(0.95, 0.5 + cluster.entries.length * 0.1),
    };
  }

  // ── Insight management ────────────────────────────────────────────────

  getInsights(category?: MemoryInsight["category"]): MemoryInsight[] {
    if (category) return this.insights.filter(i => i.category === category);
    return [...this.insights];
  }

  /** Format insights as markdown for prompt injection */
  formatForPrompt(limit = 10): string {
    const recent = this.insights.slice(-limit);
    if (!recent.length) return "";

    const lines = ["## Consolidated Insights"];
    for (const ins of recent) {
      const catLabel = { pattern: "Pattern", pitfall: "Pitfall", strategy: "Strategy", fact: "Fact" }[ins.category];
      lines.push(
        `- [${catLabel}] ${ins.summary} ` +
        `(from ${ins.sourceCount} experiences, confidence: ${Math.round(ins.confidence * 100)}%)`
      );
    }
    return lines.join("\n");
  }

  /** Serialize insights for persistence */
  toJSON(): MemoryInsight[] {
    return this.insights;
  }

  /** Load insights from persisted data */
  load(insights: MemoryInsight[]): void {
    this.insights = insights;
  }
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
