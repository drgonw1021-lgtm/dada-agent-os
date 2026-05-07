import { DomainWorkflow, type WorkflowStep } from "../domain-workflow.js";
import { parseJsonFromLLMOutput } from "../llm-output-parser.js";

export const MARKET_ANALYSIS_STEPS: WorkflowStep[] = [
  {
    id: "analyze_market",
    name: "分析市场",
    description: "研究市场趋势、需求和竞争",
    async execute(ctx) {
      try {
        // Search for real market data before LLM generation
        let searchContext = "";
        if (ctx.search) {
          try {
            // Extract key terms from goal for better search queries
            const searchQuery = ctx.goal.length > 50
              ? ctx.goal.replace(/做一份|一份|报告|包含|、|，|。|请|帮我|需要/g, " ").replace(/\s+/g, " ").trim().substring(0, 80)
              : ctx.goal;
            const searchResults = await ctx.search(`${searchQuery} 市场规模 趋势 分析`, 5);
            if (searchResults.length > 0) {
              searchContext = `\n\n以下是从网络上搜索到的相关市场数据，请参考这些数据进行分析：\n${
                searchResults.map((r, i) =>
                  `[${i + 1}] ${r.title}\n${r.content || r.snippet || ""}\n来源: ${r.url || "N/A"}`
                ).join("\n\n")
              }`;
            }
          } catch { /* search failed, continue with LLM-only */ }
        }

        const prompt = `你是一个电商市场分析师。请分析以下目标市场的趋势、需求和竞争情况：

目标：${ctx.goal}${searchContext}

请提供：
1. 市场趋势分析
2. 目标用户画像
3. 主要竞争对手
4. 市场规模和增长预期
5. 机会和风险评估

请用JSON格式返回，包含字段：trend, target_users, competitors, market_size, opportunities, risks`;
        const analysis = await ctx.complete(prompt);
        const parsed = parseJsonFromLLMOutput(analysis);
        const marketData = {
          raw: analysis,
          parsed,
          timestamp: new Date().toISOString(),
          source: searchContext ? "llm+search" : "llm"
        };
        ctx.data.set("market", marketData);
        return { success: true, output: marketData };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  },
  {
    id: "select_products",
    name: "选品",
    description: "基于市场分析选品",
    async execute(ctx) {
      try {
        const market = ctx.data.get("market");
        const prompt = `基于以下市场分析结果，请推荐最适合电商销售的产品：

市场分析：${JSON.stringify(market?.analysis || "")}
原始目标：${ctx.goal}

请推荐3-5款产品，每款包含：
1. 产品名称
2. 选品理由
3. 预期利润率
4. 竞争程度（低/中/高）
5. 建议售价区间

请用JSON数组格式返回`;
        const rawOutput = await ctx.complete(prompt);
        const parsed = parseJsonFromLLMOutput(rawOutput);
        const selected = {
          raw: rawOutput,
          recommendations: parsed,
          timestamp: new Date().toISOString()
        };
        ctx.data.set("products", selected);
        ctx.data.set("selected_products", selected);
        return { success: true, output: selected };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  },
  {
    id: "optimize_listing",
    name: "优化Listing",
    description: "创建优化产品 listings",
    async execute(ctx) {
      try {
        const products = ctx.data.get("selected_products");
        const prompt = `请为以下产品生成优化后的电商Listing：

产品信息：${JSON.stringify(products?.recommendations || "")}

请为每款产品生成：
1. 主标题（包含关键词）
2. 五点描述
3. 关键词标签
4. 产品描述

请用JSON数组格式返回，包含字段：product_name, title, bullet_points, keywords, description`;
        const rawOutput = await ctx.complete(prompt);
        const parsed = parseJsonFromLLMOutput(rawOutput);
        const result = {
          raw: rawOutput,
          listings: parsed,
          timestamp: new Date().toISOString()
        };
        ctx.data.set("listings", result);
        return { success: true, output: result };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  },
  {
    id: "plan_marketing",
    name: "营销计划",
    description: "制定营销策略",
    async execute(ctx) {
      try {
        const prompt = `请为以下电商业务制定营销推广计划：

产品：${JSON.stringify(ctx.data.get("selected_products")?.recommendations || "")}
目标：${ctx.goal}

请提供：
1. 推广渠道建议（社交媒体、搜索广告、内容营销等）
2. 预算分配方案
3. 时间节点规划
4. KPI指标设定
5. 差异化竞争策略

请用JSON格式返回，包含字段：channels, budget_allocation, timeline, kpis, differentiation`;
        const rawOutput = await ctx.complete(prompt);
        const parsed = parseJsonFromLLMOutput(rawOutput);
        const result = {
          raw: rawOutput,
          plan: parsed,
          timestamp: new Date().toISOString()
        };
        ctx.data.set("marketing", result);
        return { success: true, output: result };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  },
  {
    id: "setup_customer_service",
    name: "客服配置",
    description: "配置客服工作流",
    async execute(ctx) {
      try {
        const prompt = `请为以下电商业务配置客服系统：

产品：${JSON.stringify(ctx.data.get("selected_products")?.recommendations || "")}
目标：${ctx.goal}

请提供：
1. 客服渠道（在线客服、邮件、电话等）
2. 工作时间设置
3. 常见问题FAQ（至少5个）
4. 响应时间标准
5. 常用话术模板

请用JSON格式返回，包含字段：channels, hours, faq, response_time, templates`;
        const rawOutput = await ctx.complete(prompt);
        const parsed = parseJsonFromLLMOutput(rawOutput);
        const result = {
          raw: rawOutput,
          config: parsed,
          timestamp: new Date().toISOString()
        };
        ctx.data.set("customer_service", result);
        return { success: true, output: result };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  },
  {
    id: "configure_after_sales",
    name: "售后配置",
    description: "设置售后服务政策",
    async execute(ctx) {
      try {
        const prompt = `请为以下电商业务配置售后服务政策：

产品：${JSON.stringify(ctx.data.get("selected_products")?.recommendations || "")}
目标：${ctx.goal}

请提供：
1. 退换货政策
2. 质保期限
3. 退款流程和时间
4. 售后支持渠道
5. 差评预防措施

请用JSON格式返回，包含字段：return_policy, warranty, refund_process, support_channels, prevention`;
        const rawOutput = await ctx.complete(prompt);
        const parsed = parseJsonFromLLMOutput(rawOutput);
        const result = {
          raw: rawOutput,
          config: parsed,
          timestamp: new Date().toISOString()
        };
        ctx.data.set("after_sales", result);
        return { success: true, output: result };
      } catch (e: unknown) {
        return { success: false, error: e instanceof Error ? e.message : String(e) };
      }
    }
  }
];

export class MarketAnalysisWorkflow extends DomainWorkflow {
  id = "market-analysis";
  name = "市场分析";
  steps = MARKET_ANALYSIS_STEPS;
}
