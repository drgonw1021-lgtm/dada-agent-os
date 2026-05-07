import { DomainWorkflow, type WorkflowStep } from "../domain-workflow.js";
import { parseJsonFromLLMOutput } from "../llm-output-parser.js";

const STEPS: WorkflowStep[] = [
  {
    id: "legal_research",
    name: "法律研究",
    description: "研究相关法律法规和判例",
    async execute(ctx) {
      try {
        let searchContext = "";
        if (ctx.search) {
          const results = await ctx.search(`${ctx.goal} 法律法规 合规 判例`, 5);
          if (results.length > 0) {
            searchContext = results.map((r, i) =>
              `[${i + 1}] ${r.title}\n${r.content || r.snippet || ""}\n来源: ${r.url || "N/A"}`
            ).join("\n\n");
          }
        }
        const prompt = `你是一个专业法务审查师。分析以下目标的法律合规情况：
目标：${ctx.goal}
${searchContext ? `\n参考资料：\n${searchContext}` : ""}
请提供：1. 适用法律法规 2. 合规风险点 3. 潜在法律责任 4. 合规建议 5. 所需资质/许可
用JSON格式返回，字段：applicable_laws, compliance_risks, liabilities, recommendations, required_licenses`;
        const output = await ctx.complete(prompt);
        ctx.data.set("legal_research", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("legal_research") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  },
  {
    id: "contract_review",
    name: "合同审查",
    description: "审查合同条款和法律文件",
    async execute(ctx) {
      try {
        const research = ctx.data.get("legal_research");
        const prompt = `基于以下法律研究，审查相关合同和法律文件的关键条款：
研究结果：${JSON.stringify(research?.parsed || research?.raw || "")}
目标：${ctx.goal}
请提供：1. 关键条款风险 2. 缺失条款 3. 争议解决建议 4. 谈判要点 5. 标准条款对照
用JSON格式返回，字段：risky_clauses, missing_clauses, dispute_resolution, negotiation_points, standard_terms`;
        const output = await ctx.complete(prompt);
        ctx.data.set("contract_review", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("contract_review") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  },
  {
    id: "compliance_report",
    name: "合规报告",
    description: "生成合规审查报告",
    async execute(ctx) {
      try {
        const review = ctx.data.get("contract_review");
        const research = ctx.data.get("legal_research");
        const prompt = `综合以下法律研究和合同审查结果，生成最终合规报告：
法律研究：${JSON.stringify(research?.parsed || "")}
合同审查：${JSON.stringify(review?.parsed || "")}
目标：${ctx.goal}
请提供：1. 总体合规评分(1-10) 2. 主要风险清单 3. 整改建议 4. 时间线 5. 预估费用
用JSON格式返回，字段：score, risk_list, remediation, timeline, estimated_costs`;
        const output = await ctx.complete(prompt);
        ctx.data.set("compliance_report", { raw: output, parsed: parseJsonFromLLMOutput(output) });
        return { success: true, output: ctx.data.get("compliance_report") };
      } catch (e: any) { return { success: false, error: e.message }; }
    }
  }
];

export class LegalReviewWorkflow extends DomainWorkflow {
  id = "legal-review";
  name = "法务审查";
  steps = STEPS;
}
