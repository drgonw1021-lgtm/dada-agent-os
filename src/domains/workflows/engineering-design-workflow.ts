import { DomainWorkflow, type WorkflowStep } from "../domain-workflow.js";
import { parseJsonFromLLMOutput } from "../llm-output-parser.js";

const STEPS: WorkflowStep[] = [
  {
    id: "requirements_analysis",
    name: "需求分析",
    description: "分析工程需求和约束条件",
    async execute(ctx) {
      try {
        let searchContext = "";
        if (ctx.search) {
          const results = await ctx.search(`${ctx.goal} 工程设计 技术方案 架构`, 5);
          if (results.length > 0) {
            searchContext = results.map((r, i) =>
              `[${i + 1}] ${r.title}\n${r.content || r.snippet || ""}`
            ).join("\n\n");
          }
        }
        const prompt = `你是一个专业工程设计顾问。分析以下工程目标的需求和约束：
目标：${ctx.goal}
${searchContext ? `\n参考资料：\n${searchContext}` : ""}
请提供：1. 功能需求 2. 非功能需求(性能/安全/可维护) 3. 技术约束 4. 资源评估 5. 风险识别
用JSON格式返回，字段：functional, non_functional, constraints, resources, risks`;
        const output = await ctx.complete(prompt);
        ctx.data.set("requirements", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("requirements") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  },
  {
    id: "solution_design",
    name: "方案设计",
    description: "设计工程解决方案和架构",
    async execute(ctx) {
      try {
        const reqs = ctx.data.get("requirements");
        const prompt = `基于以下需求，设计工程解决方案：
需求：${JSON.stringify(reqs?.parsed || reqs?.raw || "")}
目标：${ctx.goal}
请提供：1. 系统架构描述 2. 技术栈选型 3. 模块划分 4. 接口设计 5. 数据流设计 6. 部署方案
用JSON格式返回，字段：architecture, tech_stack, modules, interfaces, data_flow, deployment`;
        const output = await ctx.complete(prompt);
        ctx.data.set("solution", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("solution") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  },
  {
    id: "implementation_plan",
    name: "实施计划",
    description: "制定工程实施和验证计划",
    async execute(ctx) {
      try {
        const solution = ctx.data.get("solution");
        const prompt = `基于以下方案设计，制定工程实施计划：
方案：${JSON.stringify(solution?.parsed || solution?.raw || "")}
目标：${ctx.goal}
请提供：1. 开发阶段划分 2. 每阶段交付物 3. 里程碑时间线 4. 测试策略 5. 资源分配 6. 应急预案
用JSON格式返回，字段：phases, deliverables, milestones, test_strategy, resources, contingency`;
        const output = await ctx.complete(prompt);
        ctx.data.set("plan", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("plan") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  }
];

export class EngineeringDesignWorkflow extends DomainWorkflow {
  id = "engineering-design";
  name = "工程设计";
  steps = STEPS;
}
