import { DomainWorkflow, type WorkflowStep } from "../domain-workflow.js";
import { parseJsonFromLLMOutput } from "../llm-output-parser.js";

const STEPS: WorkflowStep[] = [
  {
    id: "financial_data_collection",
    name: "财务数据收集",
    description: "收集目标公司/行业的财务数据和报告",
    async execute(ctx) {
      try {
        let searchContext = "";
        if (ctx.search) {
          const searchResults = await ctx.search(`${ctx.goal} 财务报告 营收 利润 分析`, 5);
          if (searchResults.length > 0) {
            searchContext = searchResults.map((r, i) =>
              `[${i + 1}] ${r.title}\n${r.content || r.snippet || ""}\n来源: ${r.url || "N/A"}`
            ).join("\n\n");
          }
        }
        const prompt = `你是一个专业财务分析师。分析以下目标的财务状况：
目标：${ctx.goal}
${searchContext ? `\n搜索数据：\n${searchContext}` : ""}
请提供：1. 收入结构分析 2. 成本结构 3. 利润率和现金流 4. 关键财务指标 5. 风险评估
用JSON格式返回，字段：revenue, costs, profitability, key_metrics, risks`;
        const output = await ctx.complete(prompt);
        ctx.data.set("financial_data", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("financial_data") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  },
  {
    id: "financial_modeling",
    name: "财务建模",
    description: "构建财务模型和预测",
    async execute(ctx) {
      try {
        const prevData = ctx.data.get("financial_data");
        const prompt = `基于以下财务数据，构建财务模型和预测：
数据：${JSON.stringify(prevData?.parsed || prevData?.raw || "")}
目标：${ctx.goal}
请提供：1. 收入预测(3年) 2. 成本预测 3. 现金流预测 4. 投资回报分析 5. 敏感性分析
用JSON格式返回，字段：revenue_forecast, cost_forecast, cashflow, roi, sensitivity`;
        const output = await ctx.complete(prompt);
        ctx.data.set("financial_model", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("financial_model") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  },
  {
    id: "investment_recommendation",
    name: "投资建议",
    description: "生成投资建议和决策报告",
    async execute(ctx) {
      try {
        const model = ctx.data.get("financial_model");
        const prompt = `基于以下财务模型，生成投资决策建议：
模型：${JSON.stringify(model?.parsed || model?.raw || "")}
目标：${ctx.goal}
请提供：1. 投资建议(买入/持有/卖出) 2. 目标估值 3. 风险收益比 4. 投资时间线 5. 关键假设
用JSON格式返回，字段：recommendation, valuation, risk_reward, timeline, assumptions`;
        const output = await ctx.complete(prompt);
        ctx.data.set("recommendation", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("recommendation") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  }
];

export class FinancialAnalysisWorkflow extends DomainWorkflow {
  id = "financial-analysis";
  name = "财务分析";
  steps = STEPS;
}
