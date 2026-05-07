import { DomainWorkflow, type WorkflowStep } from "../domain-workflow.js";
import { parseJsonFromLLMOutput } from "../llm-output-parser.js";

export const PRODUCT_DESIGN_STEPS: WorkflowStep[] = [
  {
    id: "research",
    name: "研究",
    description: "用户需求和竞品分析",
    async execute(ctx) {
      try {
        // Search for real market/user data before LLM generation
        let searchContext = "";
        if (ctx.search) {
          try {
            // Extract key terms from goal for better search queries
            const searchQuery = ctx.goal.length > 50
              ? ctx.goal.replace(/做一份|一份|报告|包含|、|，|。|请|帮我|需要/g, " ").replace(/\s+/g, " ").trim().substring(0, 80)
              : ctx.goal;
            const searchResults = await ctx.search(`${searchQuery} 用户需求 竞品分析 市场`, 5);
            if (searchResults.length > 0) {
              searchContext = `\n\n以下是从网络上搜索到的相关产品研究数据，请参考这些数据进行分析：\n${
                searchResults.map((r, i) =>
                  `[${i + 1}] ${r.title}\n${r.content || r.snippet || ""}\n来源: ${r.url || "N/A"}`
                ).join("\n\n")
              }`;
            }
          } catch { /* search failed, continue with LLM-only */ }
        }

        const prompt = `你是一个产品研究员。请对以下产品进行用户需求和竞品分析：

目标：${ctx.goal}${searchContext}

请提供：
1. 目标用户画像和核心需求
2. 竞品分析（至少3个竞品）
3. 市场Gap分析（差异化机会）
4. 技术趋势分析
5. 用户痛点总结

请用JSON格式返回，包含字段：user_persona, pain_points, competitor_analysis, gap_analysis, tech_trends`;
        const rawOutput = await ctx.complete(prompt);
        const parsed = parseJsonFromLLMOutput(rawOutput);
        const result = {
          raw: rawOutput,
          analysis: parsed,
          timestamp: new Date().toISOString(),
          source: searchContext ? "llm+search" : "llm"
        };
        ctx.data.set("research", result);
        return { success: true, output: result };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  },
  {
    id: "planning",
    name: "规划",
    description: "产品规格和路线图",
    async execute(ctx) {
      try {
        const research = ctx.data.get("research");
        const prompt = `基于以下研究结果，请制定产品规格和开发路线图：

研究分析：${JSON.stringify(research?.analysis || "")}
原始目标：${ctx.goal}

请提供：
1. 产品核心规格（尺寸、材质、颜色等）
2. 功能特性列表
3. 开发里程碑和时间线
4. 预算估算
5. 优先级排序

请用JSON格式返回，包含字段：specifications, features, roadmap, budget, priorities`;
        const rawOutput = await ctx.complete(prompt);
        const parsed = parseJsonFromLLMOutput(rawOutput);
        const result = {
          raw: rawOutput,
          plan: parsed,
          timestamp: new Date().toISOString()
        };
        ctx.data.set("planning", result);
        return { success: true, output: result };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  },
  {
    id: "design",
    name: "设计",
    description: "产品设计和原型",
    async execute(ctx) {
      try {
        const planning = ctx.data.get("planning");
        const prompt = `请基于以下规划生成产品设计方案：

产品规格：${JSON.stringify(planning?.plan?.specifications || "")}
功能特性：${JSON.stringify(planning?.plan?.features || "")}
原始目标：${ctx.goal}

请提供：
1. 3D模型设计建议
2. 渲染图描述
3. 原理图/电路设计建议
4. 原型制作计划
5. 材料和成本估算

请用JSON格式返回，包含字段：3d_design, renderings, schematics, prototypes, cost_estimate`;
        const rawOutput = await ctx.complete(prompt);
        const parsed = parseJsonFromLLMOutput(rawOutput);
        const result = {
          raw: rawOutput,
          output: parsed,
          timestamp: new Date().toISOString()
        };
        ctx.data.set("design", result);
        return { success: true, output: result };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  },
  {
    id: "production",
    name: "生产",
    description: "制造和质量控制",
    async execute(ctx) {
      try {
        const design = ctx.data.get("design");
        const prompt = `请基于以下设计制定生产方案：

设计方案：${JSON.stringify(design?.output || "")}
原始目标：${ctx.goal}

请提供：
1. 代工厂选择建议
2. 最小起订量(MOQ)
3. 单位成本估算
4. 质量标准（ISO、CE等）
5. 生产时间节点
6. 包装方案
7. QC质检点

请用JSON格式返回，包含字段：manufacturer, moq, unit_cost, quality_standards, timeline, packaging, qc_checkpoints`;
        const rawOutput = await ctx.complete(prompt);
        const parsed = parseJsonFromLLMOutput(rawOutput);
        const result = {
          raw: rawOutput,
          plan: parsed,
          timestamp: new Date().toISOString()
        };
        ctx.data.set("production", result);
        return { success: true, output: result };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  }
];

export class ProductDesignWorkflow extends DomainWorkflow {
  id = "product-design";
  name = "产品设计";
  steps = PRODUCT_DESIGN_STEPS;
}
