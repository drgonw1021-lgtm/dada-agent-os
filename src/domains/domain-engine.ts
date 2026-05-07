import { DomainPack, DomainPackRegistry } from "./domain-pack.js";
import { DomainWorkflow } from "./domain-workflow.js";
import { MarketAnalysisWorkflow } from "./workflows/market-analysis-workflow.js";
import { ProductDesignWorkflow } from "./workflows/product-design-workflow.js";
import { FinancialAnalysisWorkflow } from "./workflows/financial-analysis-workflow.js";
import { LegalReviewWorkflow } from "./workflows/legal-review-workflow.js";
import { HrRecruitmentWorkflow } from "./workflows/hr-recruitment-workflow.js";
import { EngineeringDesignWorkflow } from "./workflows/engineering-design-workflow.js";
import { ContentMarketingWorkflow } from "./workflows/content-marketing-workflow.js";
import { CustomerSupportWorkflow } from "./workflows/customer-support-workflow.js";
import { ProgressManager } from "../progress-manager.js";
import { WorkflowResultStore, WorkflowResultRecord } from "./workflow-result-store.js";
import { DomainLearner } from "./domain-learner.js";

export interface WorkflowResult {
  success: boolean;
  steps: any[];
  summary: string;
}

export class DomainEngine {
  private domains = new Map<string, any>();
  private packs = new DomainPackRegistry();
  private workflows = new Map<string, DomainWorkflow>();
  private progressManager: ProgressManager | null = null;
  private completer: ((prompt: string) => Promise<string>) | null = null;
  private searchFn: ((query: string, maxResults?: number) => Promise<Array<{ title: string; url?: string; content: string; snippet?: string; relevance?: number }>>) | null = null;
  private learner = new DomainLearner();
  private resultStore = new WorkflowResultStore();

  constructor() {
    this.registerDefaultWorkflows();
    this.learner.initialize();
  }

  private registerDefaultWorkflows() {
    const workflows: DomainWorkflow[] = [
      new MarketAnalysisWorkflow(),
      new ProductDesignWorkflow(),
      new FinancialAnalysisWorkflow(),
      new LegalReviewWorkflow(),
      new HrRecruitmentWorkflow(),
      new EngineeringDesignWorkflow(),
      new ContentMarketingWorkflow(),
      new CustomerSupportWorkflow(),
    ];
    for (const w of workflows) {
      this.workflows.set(w.id, w);
    }
  }

  getInsights(domain: string, goal: string): string {
    return this.learner.getInsightsForPrompt(domain, goal);
  }

  async learn(domain: string, goal: string, outcome: "success" | "failure", insight: string) {
    return this.learner.addLearning({ domain, goal, outcome, keyInsight: insight });
  }

  /** Deep reasoning loop — auto-triggered before complex domain tasks */
  async think(domain: string, goal: string): Promise<string> {
    if (!this.completer) return "";

    const result = await this.learner.think(goal, domain, async (depth: number) => {
      const prompt = [
        "You are a strategic reasoning engine. Think deeply about this task.",
        `Goal: ${goal}`,
        `Domain: ${domain}`,
        `Current reasoning depth: ${depth}`,
        "",
        "Respond with ONLY valid JSON:",
        '{"thought": "your deep analysis of how to approach this (1-3 sentences)", "confidence": 0.0-1.0}',
      ].join("\n");

      const raw = await this.completer!(prompt);
      try {
        const json = raw.replace(/```json\s*|\s*```/g, "").trim();
        const parsed = JSON.parse(json);
        return {
          thought: String(parsed.thought || raw.substring(0, 200)),
          confidence: Math.min(1, Math.max(0, Number(parsed.confidence) || 0.5)),
        };
      } catch {
        return { thought: raw.substring(0, 200), confidence: 0.5 };
      }
    });

    if (result.iterations.length > 0) {
      const thoughts = result.iterations.map(i =>
        `[推理层${i.step}/${result.depth}] ${i.thought} (置信度: ${(i.confidence * 100).toFixed(0)}%)`
      ).join("\n");
      return `\n## 🧠 深度推理 (${result.outcome === "success" ? "已收敛" : `达到最大深度${result.depth}`})\n${thoughts}\n`;
    }
    return "";
  }

  getLearnerStats() {
    return this.learner.getStats();
  }

  setCompleter(completeFn: (prompt: string) => Promise<string>) {
    this.completer = completeFn;
  }

  setSearchFunction(fn: (query: string, maxResults?: number) => Promise<Array<{ title: string; url?: string; content: string; snippet?: string; relevance?: number }>>) {
    this.searchFn = fn;
  }

  setProgressManager(pm: ProgressManager) {
    this.progressManager = pm;
  }

  register(spec: { id: string; name: string; keywords?: string[] }) {
    this.domains.set(spec.id, spec);
  }

  registerPack(pack: DomainPack) {
    this.packs.register(pack.spec);
  }

  registerWorkflow(workflow: DomainWorkflow) {
    this.workflows.set(workflow.id, workflow);
  }

  async plan(goal: string, _context?: string): Promise<string> {
    const g = (goal ?? "").toLowerCase();
    const escape = (s: string) => s.replace(/"/g, '\\"');

    if (
      g.includes("市场分析") ||
      g.includes("市场调研") ||
      g.includes("市场规模") ||
      g.includes("品牌竞争") ||
      g.includes("行业报告") ||
      g.includes("选品") ||
      g.includes("铺货") ||
      g.includes("营销") ||
      g.includes("客服") ||
      g.includes("售后") ||
      (g.includes("市场") && g.includes("调研"))
    ) {
      return [
        "PLAN market-analysis",
        `TOOL domain.market-analysis {"domain":"market-analysis","goal":"${escape(goal)}"}`,
        "DONE Domain market-analysis planned"
      ].join("\n");
    }

    if (
      g.includes("产品设计") ||
      g.includes("产品调研") ||
      g.includes("原型") ||
      g.includes("生产制造") ||
      (g.includes("设计") && !g.includes("市场"))
    ) {
      return [
        "PLAN product-design",
        `TOOL domain.product-design {"domain":"product-design","goal":"${escape(goal)}"}`,
        "DONE Domain product-design planned"
      ].join("\n");
    }

    if (
      g.includes("财务") ||
      g.includes("投资") ||
      g.includes("估值") ||
      g.includes("营收") ||
      g.includes("现金流") ||
      g.includes("财报") ||
      g.includes("金融") ||
      g.includes("理财")
    ) {
      return [
        "PLAN financial-analysis",
        `TOOL domain.financial-analysis {"domain":"financial-analysis","goal":"${escape(goal)}"}`,
        "DONE Domain financial-analysis planned"
      ].join("\n");
    }

    if (
      g.includes("法律") ||
      g.includes("合同") ||
      g.includes("合规") ||
      g.includes("法务") ||
      g.includes("法规") ||
      g.includes("诉讼") ||
      g.includes("条款") ||
      g.includes("审查")
    ) {
      return [
        "PLAN legal-review",
        `TOOL domain.legal-review {"domain":"legal-review","goal":"${escape(goal)}"}`,
        "DONE Domain legal-review planned"
      ].join("\n");
    }

    if (
      g.includes("招聘") ||
      g.includes("面试") ||
      g.includes("入职") ||
      g.includes("hr") ||
      g.includes("人事") ||
      g.includes("JD") ||
      g.includes("职位描述") ||
      g.includes("人才")
    ) {
      return [
        "PLAN hr-recruitment",
        `TOOL domain.hr-recruitment {"domain":"hr-recruitment","goal":"${escape(goal)}"}`,
        "DONE Domain hr-recruitment planned"
      ].join("\n");
    }

    if (
      g.includes("工程") ||
      g.includes("架构") ||
      g.includes("技术方案") ||
      g.includes("系统设计") ||
      g.includes("需求分析") && !g.includes("市场")
    ) {
      return [
        "PLAN engineering-design",
        `TOOL domain.engineering-design {"domain":"engineering-design","goal":"${escape(goal)}"}`,
        "DONE Domain engineering-design planned"
      ].join("\n");
    }

    if (
      g.includes("内容营销") ||
      g.includes("自媒体") ||
      g.includes("内容策略") ||
      g.includes("涨粉") ||
      g.includes("受众") ||
      g.includes("内容日历")
    ) {
      return [
        "PLAN content-marketing",
        `TOOL domain.content-marketing {"domain":"content-marketing","goal":"${escape(goal)}"}`,
        "DONE Domain content-marketing planned"
      ].join("\n");
    }

    if (
      g.includes("客服") ||
      g.includes("售后") && !g.includes("市场") ||
      g.includes("知识库") ||
      g.includes("话术") ||
      g.includes("faq") ||
      g.includes("质检") ||
      g.includes("投诉")
    ) {
      return [
        "PLAN customer-support",
        `TOOL domain.customer-support {"domain":"customer-support","goal":"${escape(goal)}"}`,
        "DONE Domain customer-support planned"
      ].join("\n");
    }

    return ["PLAN generic", `NOTE No domain-specific plan generated for: ${goal}`].join("\n");
  }

  async executeWorkflow(domain: string, goal: string, taskId: string): Promise<WorkflowResult> {
    const workflow = this.workflows.get(domain);
    if (!workflow) {
      return {
        success: false,
        steps: [],
        summary: `No workflow found for domain: ${domain}`
      };
    }

    const startedAt = new Date().toISOString();

    const context = {
      goal,
      domain,
      data: new Map<string, any>(),
      progress: this.progressManager || new ProgressManager(),
      taskId,
      complete: this.completer || (async (prompt: string) => `[Mock] ${prompt}`),
      search: this.searchFn || undefined
    };

    context.progress.emit(taskId, {
      type: "workflow_start",
      payload: { domain, workflow: workflow.name, goal },
      at: startedAt
    });

    const results = await workflow.execute(context);
    const successful = results.filter((result) => result.success).length;
    const completedAt = new Date().toISOString();
    const summary = `Completed ${successful}/${results.length} steps for ${workflow.name}`;

    const record: WorkflowResultRecord = {
      id: taskId,
      domain,
      goal,
      taskId,
      startedAt,
      completedAt,
      success: successful === results.length,
      steps: results.map((result, index) => ({
        id: workflow.steps[index]?.id || `step_${index}`,
        name: workflow.steps[index]?.name || `Step ${index}`,
        success: result.success,
        output: result.output,
        error: result.error
      })),
      summary
    };

    try {
      await this.resultStore.save(record);
    } catch (error) {
      console.error("[DomainEngine] Failed to save result:", error);
    }

    return {
      success: successful === results.length,
      steps: results,
      summary
    };
  }

  async listResults(): Promise<WorkflowResultRecord[]> {
    return this.resultStore.list();
  }

  async getResult(taskId: string): Promise<WorkflowResultRecord | null> {
    return this.resultStore.get(taskId);
  }

  getStatus(): { domains: string[]; count: number } {
    const domains = Array.from(this.domains.values()).map((domain) => domain.name ?? domain.id);
    return { domains, count: domains.length };
  }

  getPackStatus(): { packs: string[]; count: number } {
    const packs = this.packs.list().map((pack) => pack.name);
    return { packs, count: packs.length };
  }

  getWorkflows(): string[] {
    return Array.from(this.workflows.keys());
  }
}

export default DomainEngine;
