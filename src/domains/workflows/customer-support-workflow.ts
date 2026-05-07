import { DomainWorkflow, type WorkflowStep } from "../domain-workflow.js";
import { parseJsonFromLLMOutput } from "../llm-output-parser.js";

const STEPS: WorkflowStep[] = [
  {
    id: "support_analysis",
    name: "客服需求分析",
    description: "分析客服需求和场景",
    async execute(ctx) {
      try {
        const prompt = `你是一个专业客服运营专家。分析以下目标的客服需求和场景：
目标：${ctx.goal}
请提供：1. 客户问题类型分类 2. 高频问题预测 3. 客服渠道需求 4. 服务水平目标(SLA) 5. 团队配置建议
用JSON格式返回，字段：issue_categories, common_issues, channels, sla_targets, team_config`;
        const output = await ctx.complete(prompt);
        ctx.data.set("support_analysis", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("support_analysis") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  },
  {
    id: "faq_knowledge_base",
    name: "知识库建设",
    description: "构建FAQ和知识库体系",
    async execute(ctx) {
      try {
        const analysis = ctx.data.get("support_analysis");
        const prompt = `基于以下客服分析，构建FAQ知识库：
分析：${JSON.stringify(analysis?.parsed || analysis?.raw || "")}
目标：${ctx.goal}
请提供：1. FAQ条目(至少15条Q&A) 2. 标准话术模板(10条) 3. 升级规则 4. 知识库分类结构 5. 持续更新机制
用JSON格式返回，字段：faq, templates, escalation_rules, categories, update_mechanism`;
        const output = await ctx.complete(prompt);
        ctx.data.set("knowledge_base", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("knowledge_base") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  },
  {
    id: "quality_system",
    name: "质控体系",
    description: "建立服务质量和监控体系",
    async execute(ctx) {
      try {
        const kb = ctx.data.get("knowledge_base");
        const prompt = `基于以下知识库，建立客服质量监控体系：
知识库：${JSON.stringify(kb?.parsed || kb?.raw || "")}
目标：${ctx.goal}
请提供：1. 质检标准 2. 满意度调查问题 3. 客服绩效KPI 4. 培训计划 5. 投诉处理流程
用JSON格式返回，字段：quality_standards, satisfaction_survey, agent_kpis, training_plan, complaint_process`;
        const output = await ctx.complete(prompt);
        ctx.data.set("quality", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("quality") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  }
];

export class CustomerSupportWorkflow extends DomainWorkflow {
  id = "customer-support";
  name = "客服运营";
  steps = STEPS;
}
