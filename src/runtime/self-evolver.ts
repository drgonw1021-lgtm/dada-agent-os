import { writeFile, mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import type { ExecutionStep } from "../core/types.js";

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface EvolvedSkill {
  name: string;
  description: string;
  version: string;
  triggers: string[];
  instructions: string;
  sourceTaskId: string;
  sourceGoal: string;
  createdAt: string;
  successCount: number;
  lastUsedAt: string;
}

export interface EvolutionCandidate {
  goal: string;
  taskType: string;
  steps: ExecutionStep[];
  toolSequence: string[];
  success: boolean;
  summary: string;
}

export interface EvolutionResult {
  skill?: EvolvedSkill;
  skipped: boolean;
  reason: string;
}

// ─── Evolver ──────────────────────────────────────────────────────────────────────

export interface SelfEvolverDeps {
  /** LLM completer for skill generation (reasoner model, no tools) */
  reflector: (prompt: string) => Promise<string>;
  /** Directory where evolved skills are stored */
  skillsDir: string;
  /** Minimum number of tool executions to consider a task "pattern-worthy" */
  minToolSteps: number;
  /** Minimum success count before a skill is considered mature */
  minSuccessCount: number;
}

export class SelfEvolver {
  private skills: Map<string, EvolvedSkill> = new Map();
  private initialized = false;

  constructor(private deps: SelfEvolverDeps) {}

  async initialize(): Promise<void> {
    await mkdir(this.deps.skillsDir, { recursive: true });
    await this.loadExistingSkills();
    this.initialized = true;
    console.log(`[SelfEvolver] Loaded ${this.skills.size} evolved skills from ${this.deps.skillsDir}`);
  }

  /**
   * Main entry point: analyze a completed task and potentially evolve a new skill.
   * Called from agent-runtime after successful verification.
   */
  async evolveFromTask(candidate: EvolutionCandidate): Promise<EvolutionResult> {
    if (!this.initialized) await this.initialize();

    // Gate 1: Only evolve from successful tasks
    if (!candidate.success) {
      return { skipped: true, reason: "Task did not succeed" };
    }

    // Gate 2: Must have enough tool executions to form a pattern
    if (candidate.toolSequence.length < this.deps.minToolSteps) {
      return { skipped: true, reason: `Only ${candidate.toolSequence.length} tool steps (min: ${this.deps.minToolSteps})` };
    }

    // Gate 3: Check for duplicate patterns — skip if we already have a similar skill
    const existingMatch = await this.findSimilarSkill(candidate);
    if (existingMatch) {
      existingMatch.successCount++;
      existingMatch.lastUsedAt = new Date().toISOString();
      await this.persistSkill(existingMatch);
      return {
        skill: existingMatch,
        skipped: true,
        reason: `Reinforced existing skill: ${existingMatch.name} (success count: ${existingMatch.successCount})`
      };
    }

    // Generate skill via LLM reflection
    try {
      const skill = await this.generateSkill(candidate);
      if (!skill) {
        return { skipped: true, reason: "LLM reflection produced no usable skill" };
      }

      this.skills.set(skill.name, skill);
      await this.persistSkill(skill);
      console.log(`[SelfEvolver] New skill evolved: ${skill.name} (from task ${candidate.goal.substring(0, 60)})`);
      return { skill, skipped: false, reason: `New skill evolved: ${skill.name}` };
    } catch (e: any) {
      return { skipped: true, reason: `Evolution failed: ${e.message}` };
    }
  }

  /** Get all evolved skills */
  list(): EvolvedSkill[] {
    return Array.from(this.skills.values())
      .sort((a, b) => b.successCount - a.successCount);
  }

  /** Get mature skills (above success threshold) */
  getMatureSkills(): EvolvedSkill[] {
    return this.list().filter(s => s.successCount >= this.deps.minSuccessCount);
  }

  /** Get failure avoidance patterns (anti-patterns learned from past failures) */
  getFailurePatterns(): EvolvedSkill[] {
    return this.list().filter(s => s.name.startsWith("anti-") || s.successCount === 0);
  }

  /**
   * Analyze a failed task and extract lessons learned as a "failure avoidance" pattern.
   * Called from agent-runtime after task failure with sufficient tool steps.
   */
  async evolveFromFailure(candidate: EvolutionCandidate): Promise<EvolutionResult> {
    if (!this.initialized) await this.initialize();

    // Gate 1: Only learn from failures
    if (candidate.success) {
      return { skipped: true, reason: "Task succeeded, use evolveFromTask instead" };
    }

    // Gate 2: Need enough tool executions to analyze
    if (candidate.toolSequence.length < 2) {
      return { skipped: true, reason: `Only ${candidate.toolSequence.length} tool steps — not enough to analyze` };
    }

    // Gate 3: Check for duplicate failure patterns
    const existingMatch = await this.findSimilarSkill(candidate);
    if (existingMatch) {
      existingMatch.lastUsedAt = new Date().toISOString();
      await this.persistSkill(existingMatch);
      return {
        skill: existingMatch,
        skipped: true,
        reason: `Similar failure pattern already captured: ${existingMatch.name}`
      };
    }

    // Generate failure-avoidance skill via LLM reflection
    try {
      const skill = await this.generateFailureSkill(candidate);
      if (!skill) {
        return { skipped: true, reason: "LLM reflection produced no usable failure pattern" };
      }

      this.skills.set(skill.name, skill);
      await this.persistSkill(skill);
      console.log(`[SelfEvolver] Failure pattern captured: ${skill.name}`);
      return { skill, skipped: false, reason: `Failure pattern captured: ${skill.name}` };
    } catch (e: any) {
      return { skipped: true, reason: `Failure evolution failed: ${e.message}` };
    }
  }

  /** Get skill instructions for task matching (used by capability router) */
  getInstructionsForTask(goal: string, taskType?: string): string {
    const matching: string[] = [];
    const goalLower = goal.toLowerCase();
    for (const skill of this.skills.values()) {
      let matched = false;
      // Match by trigger keywords in goal
      for (const trigger of skill.triggers) {
        if (goalLower.includes(trigger.toLowerCase())) {
          matched = true;
          break;
        }
      }
      // Also match by task type if the skill's source task was same type
      if (!matched && taskType && skill.sourceGoal) {
        // Heuristic: if skill's triggers overlap with the task type domain
        const typeTriggers: Record<string, string[]> = {
          research: ['research', 'report', 'search'],
          code: ['code', 'function', 'script', 'file'],
          presentation: ['slide', 'presentation', 'deck'],
          social_publish: ['publish', 'post', 'douyin', 'tiktok', 'social'],
          image_generation: ['image', 'generate', 'cover', 'poster'],
          financial_analysis: ['financial', 'investment', 'valuation', 'revenue'],
          automation: ['automation', 'schedule', 'cron', 'workflow'],
        };
        const domainTriggers = typeTriggers[taskType] || [];
        matched = domainTriggers.some(t => skill.triggers.some(st => st.includes(t) || t.includes(st)));
      }
      if (matched) {
        matching.push(`## Evolved Skill: ${skill.name}\n\n${skill.instructions}`);
      }
    }
    return matching.join("\n\n---\n\n");
  }

  /** Get a specific evolved skill */
  get(name: string): EvolvedSkill | undefined {
    return this.skills.get(name);
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private async loadExistingSkills(): Promise<void> {
    try {
      const entries = await readdir(this.deps.skillsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillPath = join(this.deps.skillsDir, entry.name, "SKILL.md");
        const metaPath = join(this.deps.skillsDir, entry.name, "meta.json");
        if (!existsSync(skillPath)) continue;

        const content = await readFile(skillPath, "utf8");
        const parsed = this.parseSkillMd(content);

        let meta: Partial<EvolvedSkill> = {};
        if (existsSync(metaPath)) {
          try { meta = JSON.parse(await readFile(metaPath, "utf8")); } catch { /* ignore */ }
        }

        const skill: EvolvedSkill = {
          name: parsed.name || entry.name,
          description: parsed.description || "",
          version: parsed.version || "0.1.0",
          triggers: parsed.triggers || [],
          instructions: parsed.body,
          sourceTaskId: meta.sourceTaskId || "",
          sourceGoal: meta.sourceGoal || "",
          createdAt: meta.createdAt || new Date().toISOString(),
          successCount: meta.successCount || 0,
          lastUsedAt: meta.lastUsedAt || new Date().toISOString(),
        };

        this.skills.set(skill.name, skill);
      }
    } catch {
      console.log(`[SelfEvolver] No existing evolved skills found`);
    }
  }

  private async findSimilarSkill(candidate: EvolutionCandidate): Promise<EvolvedSkill | null> {
    const goalLower = candidate.goal.toLowerCase();
    const toolSet = new Set(candidate.toolSequence);

    for (const skill of this.skills.values()) {
      // Check trigger overlap
      const triggerMatch = skill.triggers.some(t => goalLower.includes(t.toLowerCase()));
      if (triggerMatch) return skill;

      // Check tool pattern similarity
      const skillToolMatch = skill.instructions.split("\n")
        .filter(l => l.includes("TOOL") || l.includes("tool"))
        .length;
      if (skillToolMatch > 0 && candidate.toolSequence.length > 0) {
        // Rough heuristic: if skill mentions similar tools
        const toolOverlap = candidate.toolSequence.filter(t =>
          skill.instructions.includes(t)
        ).length;
        if (toolOverlap >= candidate.toolSequence.length * 0.6) {
          return skill;
        }
      }
    }

    return null;
  }

  private async generateSkill(candidate: EvolutionCandidate): Promise<EvolvedSkill | null> {
    const stepSummary = candidate.steps
      .filter(s => s.action === "execute" || s.action === "error")
      .map(s => {
        const parts = [`action=${s.action}`];
        if (s.tool) parts.push(`tool=${s.tool}`);
        if (s.reasoning) parts.push(`error=${s.reasoning.substring(0, 100)}`);
        if (s.result) parts.push(`result=${JSON.stringify(s.result).substring(0, 150)}`);
        return parts.join("; ");
      })
      .join("\n");

    const prompt = [
      "You are a skill extraction AI. Analyze a successfully completed task and extract the reusable workflow pattern as a SKILL.md file.",
      "",
      "## Rules",
      "- Extract the generalizable pattern, NOT the specific task details",
      "- The skill should be reusable for similar future tasks",
      "- Name the skill as lowercase_with_underscores (e.g., market_research_report)",
      "- Include 3-5 trigger keywords that would match similar tasks",
      "- Write clear, actionable instructions that another AI agent could follow",
      "- Include the tool sequence as part of the instructions",
      "",
      "## Output Format (exact)",
      "```",
      "---",
      "name: skill_name_here",
      "description: One-line description of what this skill does",
      "version: 0.1.0",
      "triggers: keyword1, keyword2, keyword3",
      "---",
      "",
      "# Skill Name",
      "",
      "## When to Use",
      "Describe when this skill should be activated.",
      "",
      "## Workflow",
      "1. Step one description",
      "2. Step two description",
      "3. Step three description",
      "",
      "## Tool Sequence",
      "Describe which tools to use and in what order.",
      "",
      "## Common Pitfalls",
      "- Pitfall 1",
      "- Pitfall 2",
      "```",
      "",
      "## Task to Extract From",
      `Goal: ${candidate.goal}`,
      `Task Type: ${candidate.taskType}`,
      `Success: ${candidate.success}`,
      `Summary: ${candidate.summary}`,
      `Tools Used: ${candidate.toolSequence.join(" → ")}`,
      "",
      "## Execution Steps",
      stepSummary.substring(0, 3000),
      "",
      "Extract the reusable skill pattern now. Output ONLY the SKILL.md content, no meta-commentary."
    ].join("\n");

    const raw = await this.deps.reflector(prompt);

    // Parse the output
    const parsed = this.parseSkillMd(raw);
    if (!parsed.name || !parsed.body || parsed.body.length < 50) {
      return null;
    }

    const skill: EvolvedSkill = {
      name: parsed.name,
      description: parsed.description || `Auto-evolved from: ${candidate.goal.substring(0, 80)}`,
      version: parsed.version || "0.1.0",
      triggers: parsed.triggers || this.extractKeywords(candidate.goal),
      instructions: parsed.body,
      sourceTaskId: randomUUID(),
      sourceGoal: candidate.goal,
      createdAt: new Date().toISOString(),
      successCount: 1,
      lastUsedAt: new Date().toISOString(),
    };

    return skill;
  }

  private parseSkillMd(content: string): {
    name: string;
    description: string;
    version: string;
    triggers: string[];
    body: string;
  } {
    // Strip code fences if present
    let clean = content.trim();
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```\w*\n/, "").replace(/\n```$/, "");
    }

    const frontmatterMatch = clean.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!frontmatterMatch) {
      // No frontmatter — use entire content as body with auto-generated name
      return {
        name: "",
        description: "",
        version: "0.1.0",
        triggers: [],
        body: clean
      };
    }

    const meta: Record<string, string> = {};
    for (const line of frontmatterMatch[1].split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const val = line.slice(idx + 1).trim();
      meta[key] = val;
    }

    return {
      name: meta["name"] || "",
      description: meta["description"] || "",
      version: meta["version"] || "0.1.0",
      triggers: (meta["triggers"] || "").split(",").map(t => t.trim()).filter(Boolean),
      body: frontmatterMatch[2].trim(),
    };
  }

  private extractKeywords(goal: string): string[] {
    // Simple keyword extraction: split on common delimiters, filter short words
    const words = goal
      .replace(/[，。！？、；：""（）【】《》\s]+/g, " ")
      .split(/[\s]+/)
      .filter(w => w.length >= 2 && w.length <= 20)
      .filter(w => !/^(的|了|在|是|我|有|和|就|不|人|都|一|一个|这|那|他|她|它|们|你|么|吗|吧|啊|嗯|哦)$/i.test(w));

    // Return up to 5 most distinctive keywords (longer = more distinctive)
    return [...new Set(words)]
      .sort((a, b) => b.length - a.length)
      .slice(0, 5);
  }

  private async generateFailureSkill(candidate: EvolutionCandidate): Promise<EvolvedSkill | null> {
    // Collect error steps for root cause analysis
    const errorSteps = candidate.steps
      .filter(s => s.action === "error")
      .map(s => s.reasoning || "unknown error");

    const toolSteps = candidate.steps
      .filter(s => s.action === "execute")
      .map(s => `${s.tool}: ${JSON.stringify(s.result || {}).substring(0, 200)}`);

    const stepSummary = candidate.steps
      .map(s => {
        const parts = [`action=${s.action}`];
        if (s.tool) parts.push(`tool=${s.tool}`);
        if (s.reasoning) parts.push(`detail=${s.reasoning.substring(0, 150)}`);
        return parts.join("; ");
      })
      .join("\n");

    const prompt = [
      "You are a failure analysis AI. Analyze a FAILED task and extract the lessons learned as an anti-pattern SKILL.md file.",
      "",
      "## Rules",
      "- Identify the ROOT CAUSE of the failure, not just the symptoms",
      "- Extract what SHOULD have been done differently",
      "- Name the skill as anti_pattern_brief_description",
      "- Include 3-5 trigger keywords that would match similar risky tasks",
      "- Write actionable AVOIDANCE instructions that prevent this failure",
      "- Focus on preventive measures and early warning signs",
      "",
      "## Output Format (exact)",
      "```",
      "---",
      "name: anti_pattern_name_here",
      "description: One-line description of the failure pattern and how to avoid it",
      "version: 0.1.0",
      "triggers: keyword1, keyword2, keyword3",
      "---",
      "",
      "# Anti-Pattern: Pattern Name",
      "",
      "## Failure Symptoms",
      "What went wrong — observable symptoms of this failure.",
      "",
      "## Root Cause",
      "The underlying reason this task failed.",
      "",
      "## Prevention",
      "1. Before starting: check X",
      "2. During execution: verify Y",
      "3. After completion: validate Z",
      "",
      "## Safe Workflow",
      "Step-by-step safe approach to similar tasks.",
      "",
      "## Warning Signs",
      "- Sign 1: description",
      "- Sign 2: description",
      "```",
      "",
      "## Failed Task",
      `Goal: ${candidate.goal}`,
      `Task Type: ${candidate.taskType}`,
      `Summary: ${candidate.summary}`,
      `Tools Used: ${candidate.toolSequence.join(" → ")}`,
      "",
      "## Errors Encountered",
      errorSteps.map((e, i) => `${i + 1}. ${e}`).join("\n"),
      "",
      "## Tool Execution Results",
      toolSteps.join("\n"),
      "",
      "## All Steps",
      stepSummary.substring(0, 3000),
      "",
      "Extract the failure avoidance pattern now. Output ONLY the SKILL.md content."
    ].join("\n");

    const raw = await this.deps.reflector(prompt);
    const parsed = this.parseSkillMd(raw);
    if (!parsed.name || !parsed.body || parsed.body.length < 50) {
      return null;
    }

    const skill: EvolvedSkill = {
      name: parsed.name.startsWith("anti-") ? parsed.name : `anti-${parsed.name}`,
      description: parsed.description || `Failure pattern: ${candidate.goal.substring(0, 80)}`,
      version: parsed.version || "0.1.0",
      triggers: parsed.triggers || this.extractKeywords(candidate.goal),
      instructions: parsed.body,
      sourceTaskId: randomUUID(),
      sourceGoal: candidate.goal,
      createdAt: new Date().toISOString(),
      successCount: 0, // Failure patterns start at 0
      lastUsedAt: new Date().toISOString(),
    };

    return skill;
  }

  private async persistSkill(skill: EvolvedSkill): Promise<void> {
    const skillDir = join(this.deps.skillsDir, skill.name);
    await mkdir(skillDir, { recursive: true });

    // Write SKILL.md
    const frontmatter = [
      "---",
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      `version: ${skill.version}`,
      `triggers: ${skill.triggers.join(", ")}`,
      "---",
    ].join("\n");

    const skillMd = `${frontmatter}\n\n${skill.instructions}`;
    await writeFile(join(skillDir, "SKILL.md"), skillMd, "utf8");

    // Write meta.json with stats
    const meta = {
      sourceTaskId: skill.sourceTaskId,
      sourceGoal: skill.sourceGoal,
      createdAt: skill.createdAt,
      successCount: skill.successCount,
      lastUsedAt: skill.lastUsedAt,
    };
    await writeFile(join(skillDir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  }
}
