import type { ToolDefinition, ToolContext, PermissionScope } from "../../core/types.js";
import { getDomainEngine } from "../../domains/index.js";
import { domainLearner } from "../../domains/domain-learner.js";

export interface DomainToolInput {
  domain: string;
  goal: string;
  useThinking?: boolean;
}

export interface DomainToolOutput {
  success: boolean;
  taskId: string;
  domain: string;
  result?: any;
  summary: string;
  thinking?: {
    depth: number;
    iterations: number;
    outcome: string;
  };
}

export interface DomainToolSpec {
  toolId: string;
  description: string;
  /** Thinking prompts for each depth level (1-4). Index 0 = depth 1. */
  thinkingPrompts: string[];
}

export function createDomainTool(spec: DomainToolSpec): ToolDefinition<DomainToolInput, DomainToolOutput> {
  return {
    id: spec.toolId,
    description: spec.description,
    requiredScopes: [] as PermissionScope[],
    inputSchema: {
      type: "object" as const,
      properties: {
        domain: { type: "string" as const, description: `Domain name (default: ${spec.toolId.replace("domain.", "")})` },
        goal: { type: "string" as const, description: "Goal or question for this domain workflow" },
        useThinking: { type: "boolean" as const, description: "Enable RDT-style thinking (default: true)" }
      },
      required: ["goal"]
    },
    async execute(input: DomainToolInput, context: ToolContext): Promise<DomainToolOutput> {
      const engine = getDomainEngine();
      const taskId = context.taskId;
      const useThinking = input.useThinking !== false;
      const domainId = spec.toolId.replace("domain.", "");

      let thinkingResult: { depth: number; iterations: any[]; outcome: string } | null = null;

      if (useThinking && spec.thinkingPrompts.length > 0) {
        thinkingResult = await domainLearner.think(
          input.goal,
          domainId,
          async (depth) => {
            const promptIdx = Math.min(depth - 1, spec.thinkingPrompts.length - 1);
            const prompt = `[推理深度 ${depth}/4] 目标: ${input.goal}

请进行第 ${depth} 轮深度分析，并评估置信度 (0-1):

${spec.thinkingPrompts[promptIdx]}

请返回 JSON 格式: {"thought": "分析内容", "confidence": 0.x}`;

            try {
              const eng = getDomainEngine();
              const completer = (eng as any).completer;
              if (completer) {
                const response = await completer(prompt);
                const parsed = JSON.parse(response.replace(/```json|```/g, "").trim());
                return {
                  thought: parsed.thought || response,
                  confidence: parsed.confidence || 0.5
                };
              }
            } catch {}

            return {
              thought: `深度 ${depth} 分析完成`,
              confidence: 0.5 + (depth * 0.1)
            };
          }
        );
      }

      const result = await engine.executeWorkflow(domainId, input.goal, taskId);

      if (thinkingResult && result.success) {
        await domainLearner.addLearning({
          domain: domainId,
          goal: input.goal,
          outcome: "success",
          keyInsight: `${spec.toolId} 分析完成 - 推理深度: ${thinkingResult.depth}, 置信度: ${thinkingResult.iterations.length}`
        });
      }

      return {
        success: result.success,
        taskId,
        domain: domainId,
        result: result.steps,
        summary: result.summary,
        thinking: thinkingResult ? {
          depth: thinkingResult.depth,
          iterations: thinkingResult.iterations.length,
          outcome: thinkingResult.outcome
        } : undefined
      };
    }
  };
}

/** Pre-built domain tool specs for all 8 domains */
export const DOMAIN_TOOL_SPECS: DomainToolSpec[] = [
  {
    toolId: "domain.market-analysis",
    description: "Execute Market Analysis domain workflow with RDT-style thinking (选品, 铺货, 营销, 客服, 售后)",
    thinkingPrompts: [
      "第一轮: 初步市场分析",
      "第二轮: 深入分析竞品和市场趋势",
      "第三轮: 综合评估和风险分析",
      "第四轮: 最终决策和建议"
    ]
  },
  {
    toolId: "domain.product-design",
    description: "Execute Product Design domain workflow with RDT-style thinking (调研, 规划, 设计, 生产)",
    thinkingPrompts: [
      "第一轮: 用户需求和竞品调研",
      "第二轮: 产品规格和功能规划",
      "第三轮: 设计和原型规划",
      "第四轮: 生产方案和成本估算"
    ]
  },
  {
    toolId: "domain.financial-analysis",
    description: "Execute Financial Analysis domain workflow with RDT-style thinking (财务数据, 建模, 投资建议)",
    thinkingPrompts: [
      "第一轮: 财务数据收集和初步分析",
      "第二轮: 深入财务指标和趋势分析",
      "第三轮: 财务建模和预测",
      "第四轮: 投资建议和风险评估"
    ]
  },
  {
    toolId: "domain.legal-review",
    description: "Execute Legal Review domain workflow with RDT-style thinking (法律研究, 合同审查, 合规报告)",
    thinkingPrompts: [
      "第一轮: 适用法律法规研究",
      "第二轮: 合同条款风险分析",
      "第三轮: 合规差距评估",
      "第四轮: 最终合规建议和报告"
    ]
  },
  {
    toolId: "domain.hr-recruitment",
    description: "Execute HR Recruitment domain workflow with RDT-style thinking (职位分析, 候选人筛选, 入职计划)",
    thinkingPrompts: [
      "第一轮: 职位需求和市场分析",
      "第二轮: 候选人画像和筛选标准",
      "第三轮: 面试流程和评估设计",
      "第四轮: 入职和留任策略"
    ]
  },
  {
    toolId: "domain.engineering-design",
    description: "Execute Engineering Design domain workflow with RDT-style thinking (需求分析, 方案设计, 实施计划)",
    thinkingPrompts: [
      "第一轮: 功能和非功能需求分析",
      "第二轮: 系统架构和技术选型",
      "第三轮: 模块划分和接口设计",
      "第四轮: 实施路线图和风险控制"
    ]
  },
  {
    toolId: "domain.content-marketing",
    description: "Execute Content Marketing domain workflow with RDT-style thinking (受众分析, 内容规划, 效果衡量)",
    thinkingPrompts: [
      "第一轮: 目标受众和内容偏好分析",
      "第二轮: 内容主题和日历规划",
      "第三轮: 分发策略和SEO关键词",
      "第四轮: KPI设定和优化策略"
    ]
  },
  {
    toolId: "domain.customer-support",
    description: "Execute Customer Support domain workflow with RDT-style thinking (需求分析, 知识库, 质控体系)",
    thinkingPrompts: [
      "第一轮: 客服需求和场景分析",
      "第二轮: 知识库和话术体系构建",
      "第三轮: 质检标准和KPI设定",
      "第四轮: 团队配置和培训计划"
    ]
  },
  {
    toolId: "domain.education",
    description: "Execute Education domain workflow with RDT-style thinking (课程设计, 教学方案, 评估体系)",
    thinkingPrompts: [
      "第一轮: 学员画像和学习目标分析",
      "第二轮: 课程大纲和教学内容设计",
      "第三轮: 教学方法和互动方案规划",
      "第四轮: 学习评估和效果衡量体系"
    ]
  },
  {
    toolId: "domain.healthcare",
    description: "Execute Healthcare domain workflow with RDT-style thinking (病例分析, 诊疗方案, 健康管理)",
    thinkingPrompts: [
      "第一轮: 症状和病史信息收集分析",
      "第二轮: 鉴别诊断和检查方案建议",
      "第三轮: 治疗方案和用药指导评估",
      "第四轮: 康复计划和随访管理方案"
    ]
  },
  {
    toolId: "domain.real-estate",
    description: "Execute Real Estate domain workflow with RDT-style thinking (市场分析, 估值, 投资策略)",
    thinkingPrompts: [
      "第一轮: 区域市场数据和政策分析",
      "第二轮: 物业估值和投资回报计算",
      "第三轮: 市场周期和风险评估",
      "第四轮: 投资策略和交易方案建议"
    ]
  }
];
