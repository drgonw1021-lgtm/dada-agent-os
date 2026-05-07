/**
 * StrategyEvaluator — A/B compares different execution strategies for the same goal
 * and selects the best based on quality, speed, and cost.
 */

import { randomUUID } from "node:crypto";

export interface StrategyVariant {
  id: string;
  label: string;
  /** Which model to use */
  model?: string;
  /** System prompt override */
  systemPrompt?: string;
  /** Which tools are available */
  toolAllowlist?: string[];
  /** Strategy description */
  description: string;
}

export interface StrategyRun {
  runId: string;
  variantId: string;
  goal: string;
  startedAt: string;
  completedAt?: string;
  success: boolean;
  summary: string;
  /** 0-1 quality score */
  qualityScore: number;
  /** Execution duration in ms */
  durationMs: number;
  /** Steps executed */
  stepCount: number;
  /** Approximate token cost */
  tokenCost: number;
  /** Errors encountered */
  errors: string[];
}

export interface StrategyComparison {
  comparisonId: string;
  goal: string;
  variants: StrategyVariant[];
  runs: StrategyRun[];
  winner: StrategyRun | null;
  /** Per-variant aggregated stats */
  stats: StrategyVariantStats[];
  createdAt: string;
}

export interface StrategyVariantStats {
  variantId: string;
  label: string;
  runs: number;
  successRate: number;
  avgQualityScore: number;
  avgDurationMs: number;
  avgTokenCost: number;
}

export interface StrategyEvaluatorOptions {
  /** Minimum runs per variant to be statistically meaningful */
  minRunsPerVariant?: number;
  /** Quality weight vs speed weight (0-1). Higher = quality matters more. */
  qualityWeight?: number;
}

export class StrategyEvaluator {
  private comparisons: StrategyComparison[] = [];
  private options: Required<StrategyEvaluatorOptions>;

  constructor(options: StrategyEvaluatorOptions = {}) {
    this.options = {
      minRunsPerVariant: options.minRunsPerVariant ?? 3,
      qualityWeight: options.qualityWeight ?? 0.6,
    };
  }

  /** Start a new A/B comparison for a goal */
  createComparison(goal: string, variants: StrategyVariant[]): StrategyComparison {
    const comparison: StrategyComparison = {
      comparisonId: randomUUID(),
      goal,
      variants,
      runs: [],
      winner: null,
      stats: [],
      createdAt: new Date().toISOString(),
    };
    this.comparisons.push(comparison);
    if (this.comparisons.length > 100) {
      this.comparisons = this.comparisons.slice(-50);
    }
    return comparison;
  }

  /** Record a strategy run result */
  recordRun(
    comparisonId: string,
    variantId: string,
    run: Omit<StrategyRun, "runId" | "variantId">
  ): StrategyRun | null {
    const comp = this.comparisons.find(c => c.comparisonId === comparisonId);
    if (!comp) return null;

    const fullRun: StrategyRun = {
      runId: randomUUID(),
      variantId,
      ...run,
    };

    comp.runs.push(fullRun);
    this.updateStats(comp);

    return fullRun;
  }

  /** Get the best variant based on all runs so far */
  getBestVariant(comparisonId: string): StrategyVariantStats | null {
    const comp = this.comparisons.find(c => c.comparisonId === comparisonId);
    if (!comp) return null;

    this.updateStats(comp);
    return comp.winner
      ? comp.stats.find(s => s.variantId === comp.winner!.variantId) ?? null
      : null;
  }

  /** Check if we have enough data to declare a winner */
  isConfident(comparisonId: string): boolean {
    const comp = this.comparisons.find(c => c.comparisonId === comparisonId);
    if (!comp) return false;

    return comp.stats.every(s => s.runs >= this.options.minRunsPerVariant);
  }

  /** Get full comparison report */
  getComparison(comparisonId: string): StrategyComparison | null {
    return this.comparisons.find(c => c.comparisonId === comparisonId) ?? null;
  }

  listComparisons(): StrategyComparison[] {
    return [...this.comparisons];
  }

  /** Format a comparison as a readable report */
  formatReport(comparisonId: string): string {
    const comp = this.comparisons.find(c => c.comparisonId === comparisonId);
    if (!comp) return "Comparison not found.";

    const lines: string[] = [
      `# Strategy Comparison Report`,
      `Goal: ${comp.goal}`,
      `Date: ${comp.createdAt}`,
      ``,
      `## Variants`,
    ];

    for (const v of comp.variants) {
      lines.push(`- **${v.label}**: ${v.description} (model: ${v.model ?? "default"})`);
    }

    lines.push(``, `## Results`);

    const { qualityWeight } = this.options;
    for (const stat of comp.stats) {
      const variant = comp.variants.find(v => v.id === stat.variantId);
      const name = variant?.label ?? stat.variantId;
      const isWinner = comp.winner?.variantId === stat.variantId;
      const marker = isWinner ? " **WINNER**" : "";

      lines.push(`### ${name}${marker}`);
      lines.push(`- Runs: ${stat.runs}`);
      lines.push(`- Success rate: ${(stat.successRate * 100).toFixed(1)}%`);
      lines.push(`- Average quality: ${stat.avgQualityScore.toFixed(2)}/1.0`);
      lines.push(`- Average duration: ${(stat.avgDurationMs / 1000).toFixed(2)}s`);
      lines.push(`- Average token cost: $${stat.avgTokenCost.toFixed(4)}`);
      lines.push(``);
    }

    if (comp.winner) {
      const wv = comp.variants.find(v => v.id === comp.winner!.variantId);
      lines.push(`## Conclusion`);
      lines.push(`Best strategy: **${wv?.label ?? comp.winner.variantId}**`);
      lines.push(`(quality weight: ${(qualityWeight * 100).toFixed(0)}%, speed weight: ${((1 - qualityWeight) * 100).toFixed(0)}%)`);
    }

    return lines.join("\n");
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private updateStats(comp: StrategyComparison): void {
    const { qualityWeight } = this.options;

    const stats = new Map<string, StrategyVariantStats>();

    for (const variant of comp.variants) {
      stats.set(variant.id, {
        variantId: variant.id,
        label: variant.label,
        runs: 0,
        successRate: 0,
        avgQualityScore: 0,
        avgDurationMs: 0,
        avgTokenCost: 0,
      });
    }

    // Aggregate
    for (const run of comp.runs) {
      const stat = stats.get(run.variantId);
      if (!stat) continue;
      stat.runs++;
      stat.avgQualityScore += run.qualityScore;
      stat.avgDurationMs += run.durationMs;
      stat.avgTokenCost += run.tokenCost;
    }

    // Compute averages and success rates
    for (const [id, stat] of stats) {
      if (stat.runs > 0) {
        stat.avgQualityScore /= stat.runs;
        stat.avgDurationMs /= stat.runs;
        stat.avgTokenCost /= stat.runs;

        const variantRuns = comp.runs.filter(r => r.variantId === id);
        stat.successRate = variantRuns.filter(r => r.success).length / variantRuns.length;
      }
    }

    comp.stats = [...stats.values()];

    // Pick winner: composite score = quality * w + (normalized_speed) * (1-w)
    if (comp.stats.length >= 2 && comp.stats.every(s => s.runs > 0)) {
      const durations = comp.stats.map(s => s.avgDurationMs);
      const minDuration = Math.min(...durations);
      const maxDuration = Math.max(...durations);
      const range = maxDuration - minDuration || 1;

      let bestScore = -Infinity;
      let bestVariant: StrategyVariantStats | null = null;

      for (const stat of comp.stats) {
        // Min-max normalize: fastest = 1, slowest = 0
        const speedScore = 1 - (stat.avgDurationMs - minDuration) / range;
        const composite = stat.avgQualityScore * qualityWeight + speedScore * (1 - qualityWeight);

        if (composite > bestScore) {
          bestScore = composite;
          bestVariant = stat;
        }
      }

      comp.winner = bestVariant
        ? comp.runs.find(r => r.variantId === bestVariant!.variantId) ?? null
        : null;
    }
  }
}
