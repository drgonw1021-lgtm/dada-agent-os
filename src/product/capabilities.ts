import type { AppConfig } from "../config.js";
import { AutomationRegistry } from "../automation/automation-registry.js";
import type { ApprovalStore } from "../governance/approval-store.js";
import type { TaskStore } from "../tasks/task-store.js";

export interface ProductCapabilitySummary {
  productStage: "prototype" | "foundation" | "growth";
  modelOrchestration: {
    plannerModel: string;
    executorModel: string;
    criticModel: string;
    multiModelReady: boolean;
  };
  automation: {
    total: number;
    enabled: number;
    interval: number;
    manual: number;
  };
  taskExecution: {
    total: number;
    pending: number;
    running: number;
    waitingApproval: number;
    completed: number;
    failed: number;
    cancelled: number;
    concurrency: number;
    maxRetries: number;
    replayLimit: number;
  };
  approvals: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    used: number;
    approvalRequiredEnabled: boolean;
    policyPreset: string;
  };
  selfImprovement: {
    available: boolean;
    recommendedLoop: string[];
  };
  roadmap: string[];
}

export async function buildProductCapabilities(params: {
  config: AppConfig;
  availableTools: string[];
  automationRegistry: AutomationRegistry;
  taskStore: TaskStore;
  approvalStore: ApprovalStore;
}): Promise<ProductCapabilitySummary> {
  const automation = await params.automationRegistry.getStats();
  const taskStats = await params.taskStore.getStats();
  const approvalStats = await params.approvalStore.getStats();
  const modelOrchestration = {
    plannerModel: params.config.plannerModel,
    executorModel: params.config.executorModel,
    criticModel: params.config.criticModel,
    multiModelReady:
      params.config.plannerModel !== params.config.executorModel ||
      params.config.executorModel !== params.config.criticModel
  };

  return {
    productStage:
      automation.total > 0 || modelOrchestration.multiModelReady || taskStats.total > 0
        ? "foundation"
        : "prototype",
    modelOrchestration,
    automation,
    taskExecution: {
      ...taskStats,
      concurrency: params.config.maxConcurrentTasks,
      maxRetries: params.config.maxTaskRetries,
      replayLimit: params.config.failureReplayLimit
    },
    approvals: {
      ...approvalStats,
      approvalRequiredEnabled: params.config.requireApprovalForHighRisk,
      policyPreset: params.config.approvalPolicyPreset
    },
    selfImprovement: {
      available: params.availableTools.includes("code.self_improve"),
      recommendedLoop: ["生成方案", "执行验证", "记录经验", "自动回放失败任务"]
    },
    roadmap: [
      "拆分任务队列与执行器，支持长期后台任务",
      "引入自动回放和失败重试策略",
      "提供多模型角色模板与成本/质量策略",
      "把自动化、经验、工作流沉淀为产品化能力"
    ]
  };
}
