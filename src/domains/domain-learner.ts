import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

export interface Learning {
  id: string;
  domain: string;
  goal: string;
  outcome: "success" | "failure";
  keyInsight: string;
  timestamp: string;
  loopDepth?: number;
  confidence?: number;
}

export interface ReasoningRecord {
  id: string;
  goal: string;
  domain: string;
  depth: number;
  iterations: ReasoningIteration[];
  finalOutcome: "success" | "failure" | "timeout";
  confidence: number;
  timestamp: string;
}

export interface ReasoningIteration {
  step: number;
  thought: string;
  confidence: number;
  hiddenState?: number[];
  converged: boolean;
  reflection?: string;
}

export class DomainLearner {
  private learnings: Learning[] = [];
  private reasoningHistory: ReasoningRecord[] = [];
  private filePath: string;
  private reasoningPath: string;

  private maxLoopDepth: number = 4;
  private convergenceThreshold: number = 0.85;
  private spectralRadiusCap: number = 0.95;

  constructor(baseDir: string = "./.agent") {
    this.filePath = `${baseDir}/learnings.json`;
    this.reasoningPath = `${baseDir}/reasoning.json`;
  }

  async initialize() {
    try {
      if (existsSync(this.filePath)) {
        const content = await readFile(this.filePath, "utf-8");
        this.learnings = JSON.parse(content);
      }
    } catch {
      this.learnings = [];
    }

    try {
      if (existsSync(this.reasoningPath)) {
        const content = await readFile(this.reasoningPath, "utf-8");
        this.reasoningHistory = JSON.parse(content);
      }
    } catch {
      this.reasoningHistory = [];
    }
  }

  async addLearning(learning: Omit<Learning, "id" | "timestamp">) {
    const newLearning: Learning = {
      ...learning,
      id: `learn_${Date.now()}`,
      timestamp: new Date().toISOString()
    };
    this.learnings.push(newLearning);
    await this.saveLearnings();
    return newLearning;
  }

  async recordReasoning(record: Omit<ReasoningRecord, "id" | "timestamp">) {
    const newRecord: ReasoningRecord = {
      ...record,
      id: `reason_${Date.now()}`,
      timestamp: new Date().toISOString()
    };
    this.reasoningHistory.push(newRecord);

    if (this.reasoningHistory.length > 1000) {
      this.reasoningHistory = this.reasoningHistory.slice(-500);
    }

    await this.saveReasoning();
    return newRecord;
  }

  async think(
    goal: string,
    domain: string,
    generateThought: (depth: number) => Promise<{ thought: string; confidence: number; hiddenState?: number[] }>
  ): Promise<{ depth: number; iterations: ReasoningIteration[]; outcome: string }> {
    const iterations: ReasoningIteration[] = [];
    let converged = false;
    let currentDepth = 0;
    let bestThought = "";
    let bestConfidence = 0;

    while (currentDepth < this.maxLoopDepth && !converged) {
      currentDepth++;

      const result = await generateThought(currentDepth);
      const thought = result.thought;
      const confidence = result.confidence;
      const hiddenState = result.hiddenState;

      const reflection = this.generateReflection(iterations, thought, confidence);

      iterations.push({
        step: currentDepth,
        thought,
        confidence,
        hiddenState,
        converged: confidence >= this.convergenceThreshold,
        reflection
      });

      if (confidence > bestConfidence) {
        bestConfidence = confidence;
        bestThought = thought;
      }

      if (confidence >= this.convergenceThreshold) {
        converged = true;
      }

      if (this.shouldExitEarly(confidence, currentDepth, iterations)) {
        break;
      }
    }

    const finalOutcome = converged ? "success" : "timeout";

    await this.recordReasoning({
      goal,
      domain,
      depth: currentDepth,
      iterations,
      finalOutcome,
      confidence: bestConfidence
    });

    if (!converged && bestConfidence > 0.5) {
      await this.addLearning({
        domain,
        goal,
        outcome: "failure",
        keyInsight: `需要更多循环深度处理: ${goal} (深度${currentDepth}, 置信度${bestConfidence.toFixed(2)})`
      });
    }

    return {
      depth: currentDepth,
      iterations,
      outcome: finalOutcome
    };
  }

  private generateReflection(
    history: ReasoningIteration[],
    currentThought: string,
    confidence: number
  ): string {
    if (history.length === 0) {
      return "开始推理...";
    }

    const prev = history[history.length - 1];
    const improvement = confidence - (prev.converged ? 0 : 0);

    if (improvement > 0.1) {
      return `推理加深，置信度提升 +${improvement.toFixed(2)}`;
    }

    if (improvement < 0) {
      return `推理可能过深，置信度下降 ${Math.abs(improvement).toFixed(2)}`;
    }

    return "继续推理中...";
  }

  private shouldExitEarly(
    confidence: number,
    depth: number,
    history: ReasoningIteration[]
  ): boolean {
    if (history.length < 2) return false;

    const recentChanges = history.slice(-2).map(h => Math.abs(h.confidence - (history[history.indexOf(h) - 1]?.confidence || 0)));

    const avgChange = recentChanges.reduce((a, b) => a + b, 0) / recentChanges.length;

    if (avgChange < 0.05 && depth > 2) {
      return true;
    }

    return false;
  }

  getOptimalDepth(domain: string, goalType: string): number {
    const relevant = this.reasoningHistory.filter(
      r => r.domain === domain && r.finalOutcome === "success"
    );

    if (relevant.length === 0) return this.maxLoopDepth;

    const avgDepth = relevant.reduce((sum, r) => sum + r.depth, 0) / relevant.length;

    return Math.min(Math.ceil(avgDepth), this.maxLoopDepth);
  }

  getInsightsForPrompt(domain: string, goal: string): string {
    const relevant = this.learnings
      .filter(l => l.domain === domain)
      .slice(-5);

    if (relevant.length === 0) return "";

    const insights = relevant.map(l => `- ${l.keyInsight}`).join("\n");
    return `\n\nPrevious learnings that may help:\n${insights}`;
  }

  private async saveLearnings() {
    const dir = this.filePath.substring(0, this.filePath.lastIndexOf("/"));
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(this.filePath, JSON.stringify(this.learnings, null, 2), "utf-8");
  }

  private async saveReasoning() {
    const dir = this.reasoningPath.substring(0, this.reasoningPath.lastIndexOf("/"));
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(this.reasoningPath, JSON.stringify(this.reasoningHistory, null, 2), "utf-8");
  }

  getLearnings(domain?: string): Learning[] {
    if (domain) {
      return this.learnings.filter(l => l.domain === domain);
    }
    return this.learnings;
  }

  getReasoningHistory(domain?: string): ReasoningRecord[] {
    if (domain) {
      return this.reasoningHistory.filter(r => r.domain === domain);
    }
    return this.reasoningHistory;
  }

  getStats() {
    const successCount = this.reasoningHistory.filter(r => r.finalOutcome === "success").length;
    const total = this.reasoningHistory.length;
    const avgDepth = this.reasoningHistory.reduce((sum, r) => sum + r.depth, 0) / total || 0;

    return {
      totalLearnings: this.learnings.length,
      totalReasoningSessions: total,
      successRate: total > 0 ? successCount / total : 0,
      averageDepth: avgDepth.toFixed(2)
    };
  }
}

export const domainLearner = new DomainLearner();