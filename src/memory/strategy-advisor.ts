import type { ExperienceRecord } from "./experience-store.js";

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface EvolvedSkillInfo {
  name: string;
  description: string;
  triggers: string[];
  successCount: number;
}

export interface StrategyContext {
  goal: string;
  taskType?: string;
  availableTools?: string[];
  evolvedSkills?: EvolvedSkillInfo[];
  pastFailures?: string[]; // error patterns to avoid
}

export interface StrategySuggestion {
  type: "past_experience" | "evolved_skill" | "tool_recommendation" | "pitfall_warning";
  priority: number; // 0-1, higher = more important
  content: string;
  source: string;
}

// ─── Tokenizer ────────────────────────────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9一-龥\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 2)
  );
}

function overlapScore(a: Set<string>, b: Set<string>): number {
  let hit = 0;
  for (const token of a) {
    if (b.has(token)) hit += 1;
  }
  return hit;
}

// ─── Advisor ──────────────────────────────────────────────────────────────────────

export class StrategyAdvisor {
  /** Accumulated error patterns to warn about */
  private knownPitfalls: Map<string, { pattern: string; count: number }> = new Map();

  /**
   * Suggest relevant past experiences given a goal.
   */
  suggest(goal: string, records: ExperienceRecord[], limit = 3): ExperienceRecord[] {
    const goalTokens = tokenize(goal);
    return records
      .map((record) => ({
        record,
        score:
          overlapScore(
            goalTokens,
            tokenize([record.goal, record.summary, ...(record.tags ?? [])].join(" "))
          ) + (record.success ? 0.25 : 0)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.record);
  }

  /**
   * Enhanced suggestion engine that considers evolved skills, pitfalls, and tools.
   * Used by agent-runtime to enrich the task context with actionable strategies.
   */
  suggestEnhanced(ctx: StrategyContext, records: ExperienceRecord[]): StrategySuggestion[] {
    const suggestions: StrategySuggestion[] = [];
    const goalTokens = tokenize(ctx.goal);

    // 1. Match evolved skills by trigger keywords
    if (ctx.evolvedSkills && ctx.evolvedSkills.length > 0) {
      for (const skill of ctx.evolvedSkills) {
        const skillText = [skill.name, skill.description, ...skill.triggers].join(" ");
        const skillTokens = tokenize(skillText);
        const score = overlapScore(goalTokens, skillTokens);

        if (score > 0) {
          const confidence = Math.min(1.0, score / Math.max(skillTokens.size, 1) + skill.successCount * 0.1);
          suggestions.push({
            type: "evolved_skill",
            priority: confidence,
            content: `Use evolved skill "${skill.name}": ${skill.description} (proven ${skill.successCount}x)`,
            source: skill.name
          });
        }
      }
    }

    // 2. Match past experiences
    for (const record of records) {
      const recordTokens = tokenize([record.goal, record.summary, ...(record.tags ?? [])].join(" "));
      const score = overlapScore(goalTokens, recordTokens);
      if (score > 0) {
        const confidence = Math.min(1.0, score / Math.max(recordTokens.size, 1) + (record.success ? 0.2 : 0.05));
        suggestions.push({
          type: "past_experience",
          priority: confidence,
          content: record.success
            ? `Past success: "${record.goal}" — ${record.summary}`
            : `Past attempt: "${record.goal}" — ${record.summary} (failed, learn from this)`,
          source: record.taskId
        });
      }
    }

    // 3. Warn about known pitfalls matching this goal
    for (const [key, pitfall] of this.knownPitfalls) {
      const pitfallTokens = tokenize(key);
      if (overlapScore(goalTokens, pitfallTokens) > 0) {
        suggestions.push({
          type: "pitfall_warning",
          priority: 0.7 + pitfall.count * 0.05,
          content: `⚠️ Watch out: ${pitfall.pattern} (encountered ${pitfall.count}x before)`,
          source: "pitfall_db"
        });
      }
    }

    // 4. Tool recommendations based on task patterns
    if (ctx.availableTools && records.length > 0) {
      const successfulTools = new Map<string, number>();
      for (const r of records.filter(r => r.success)) {
        for (const tool of (r.toolSequence || [])) {
          successfulTools.set(tool, (successfulTools.get(tool) || 0) + 1);
        }
      }

      // Recommend top tools used in similar successful tasks
      const topTools = Array.from(successfulTools.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .filter(([tool]) => ctx.availableTools!.some(t => t.includes(tool) || tool.includes(t)));

      if (topTools.length > 0) {
        suggestions.push({
          type: "tool_recommendation",
          priority: 0.6,
          content: `Consider using tools: ${topTools.map(([t, c]) => `${t}(${c}x)`).join(", ")}`,
          source: "usage_stats"
        });
      }
    }

    // Sort by priority descending, deduplicate by content prefix
    suggestions.sort((a, b) => b.priority - a.priority);

    const seen = new Set<string>();
    return suggestions.filter(s => {
      const key = s.content.substring(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Record a pitfall/error pattern for future warnings.
   * Called when a task fails or encounters a specific error.
   */
  recordPitfall(goal: string, errorPattern: string): void {
    const key = `${goal.substring(0, 80)}::${errorPattern.substring(0, 80)}`;
    const existing = this.knownPitfalls.get(key);
    if (existing) {
      existing.count++;
    } else {
      this.knownPitfalls.set(key, { pattern: errorPattern, count: 1 });
    }
  }

  /**
   * Learn from a completed task: adjust internal weights.
   * Successful tasks reinforce patterns, failures record pitfalls.
   */
  learnFromOutcome(goal: string, success: boolean, errors: string[]): void {
    if (!success) {
      for (const err of errors) {
        this.recordPitfall(goal, err);
      }
    }
    // Successful tasks naturally reinforce through experience store
    // Pitfalls are tracked here for cross-task learning
  }

  getPitfallCount(): number {
    return this.knownPitfalls.size;
  }
}
