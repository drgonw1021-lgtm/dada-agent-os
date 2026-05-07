import { DomainWorkflow, type WorkflowStep } from "../domain-workflow.js";
import { parseJsonFromLLMOutput } from "../llm-output-parser.js";

const STEPS: WorkflowStep[] = [
  {
    id: "audience_analysis",
    name: "受众分析",
    description: "分析目标受众和内容策略",
    async execute(ctx) {
      try {
        let searchContext = "";
        if (ctx.search) {
          const results = await ctx.search(`${ctx.goal} 内容营销 受众 策略 趋势`, 5);
          if (results.length > 0) {
            searchContext = results.map((r, i) =>
              `[${i + 1}] ${r.title}\n${r.content || r.snippet || ""}`
            ).join("\n\n");
          }
        }
        const prompt = `你是一个专业内容营销专家。分析以下目标的受众和内容策略：
目标：${ctx.goal}
${searchContext ? `\n参考资料：\n${searchContext}` : ""}
请提供：1. 目标受众画像 2. 内容偏好 3. 渠道偏好 4. 竞品内容分析 5. 差异化定位
用JSON格式返回，字段：audience, content_preferences, channels, competitor_content, positioning`;
        const output = await ctx.complete(prompt);
        ctx.data.set("audience", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("audience") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  },
  {
    id: "content_planning",
    name: "内容规划",
    description: "制定内容日历和创作计划",
    async execute(ctx) {
      try {
        const audience = ctx.data.get("audience");
        const prompt = `基于以下受众分析，制定内容营销计划：
受众：${JSON.stringify(audience?.parsed || audience?.raw || "")}
目标：${ctx.goal}
请提供：1. 内容主题规划 2. 月度内容日历 3. 各平台分发策略 4. SEO关键词策略 5. 预算分配建议
用JSON格式返回，字段：themes, calendar, distribution, seo_keywords, budget`;
        const output = await ctx.complete(prompt);
        ctx.data.set("content_plan", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("content_plan") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  },
  {
    id: "performance_metrics",
    name: "效果衡量",
    description: "制定KPI和效果评估体系",
    async execute(ctx) {
      try {
        const plan = ctx.data.get("content_plan");
        const prompt = `基于以下内容计划，制定效果衡量体系：
计划：${JSON.stringify(plan?.parsed || plan?.raw || "")}
目标：${ctx.goal}
请提供：1. 核心KPI指标 2. 数据采集方案 3. ROI预估 4. AB测试方案 5. 优化迭代策略
用JSON格式返回，字段：kpis, data_collection, roi_estimate, ab_testing, optimization`;
        const output = await ctx.complete(prompt);
        ctx.data.set("metrics", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("metrics") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  }
];

export class ContentMarketingWorkflow extends DomainWorkflow {
  id = "content-marketing";
  name = "内容营销";
  steps = STEPS;
}
