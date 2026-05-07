// Smoke test: search tool quality
import { createAgentApp } from "../src/app.js";

async function main() {
  const app = await createAgentApp(process.env);

  const testQueries = [
    "2025年宠物用品市场规模",
    "pet supplies market size 2025",
    "中国宠物行业白皮书 消费趋势",
    "AI agent framework comparison"
  ];

  for (const query of testQueries) {
    console.log(`\n=== Query: ${query} ===`);
    const start = Date.now();
    const result = await app.runtime["deps"].tools.execute("search", { query, maxResults: 5 }, {
      now: new Date(), taskId: "smoke", taskLineageId: "smoke", goal: query
    });
    const elapsed = Date.now() - start;
    console.log(`  Time: ${elapsed}ms, Provider: ${result.provider || "?"}, Success: ${result.success}`);
    if (result.results) {
      for (const r of result.results) {
        const rel = r.relevance !== undefined ? ` [rel:${r.relevance.toFixed(2)}]` : "";
        console.log(`  - ${r.title}${rel}`);
        console.log(`    ${r.content.substring(0, 150)}...`);
      }
    }
    if (result.error) console.log(`  Error: ${result.error}`);
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
