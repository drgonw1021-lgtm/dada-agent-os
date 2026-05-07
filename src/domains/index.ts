import { DomainEngine } from "./domain-engine.js";
import { ProgressManager } from "../progress-manager.js";
import { MarketAnalysisWorkflow } from "./workflows/market-analysis-workflow.js";
import { ProductDesignWorkflow } from "./workflows/product-design-workflow.js";
import { FinancialAnalysisWorkflow } from "./workflows/financial-analysis-workflow.js";
import { LegalReviewWorkflow } from "./workflows/legal-review-workflow.js";
import { HrRecruitmentWorkflow } from "./workflows/hr-recruitment-workflow.js";
import { EngineeringDesignWorkflow } from "./workflows/engineering-design-workflow.js";
import { ContentMarketingWorkflow } from "./workflows/content-marketing-workflow.js";
import { CustomerSupportWorkflow } from "./workflows/customer-support-workflow.js";

let instance: DomainEngine | null = null;
let progressManager: ProgressManager | null = null;

export function getDomainEngine(): DomainEngine {
  if (!instance) {
    instance = new DomainEngine();
  }
  return instance;
}

export function initDomainEngine(pm: ProgressManager): DomainEngine {
  progressManager = pm;
  const engine = getDomainEngine();
  engine.setProgressManager(pm);
  return engine;
}

export { DomainEngine, MarketAnalysisWorkflow, ProductDesignWorkflow, FinancialAnalysisWorkflow, LegalReviewWorkflow, HrRecruitmentWorkflow, EngineeringDesignWorkflow, ContentMarketingWorkflow, CustomerSupportWorkflow };
export { DomainWorkflow } from "./domain-workflow.js";
export { DomainPack, DomainPackRegistry } from "./domain-pack.js";
export type { DomainPackSpec } from "./domain-pack.js";