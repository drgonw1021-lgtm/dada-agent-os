// Functional test: run a task against the real agent
import { createAgentApp } from "../src/app.js";

async function main() {
  const goal = process.argv[2] || "做一份宠物用品市场调研报告，包含市场规模、主要品类、品牌竞争格局、消费者画像和未来趋势";
  console.log(`[Test] Goal: ${goal}`);

  const app = await createAgentApp(process.env);
  console.log(`[Test] Tools (${app.availableTools.length}): ${app.availableTools.join(", ")}`);
  console.log(`[Test] Planner: ${app.config.plannerModel}, Executor: ${app.config.executorModel}`);

  const startTime = Date.now();
  const result = await app.runtime.runTask({
    goal,
    taskId: `func-test-${Date.now()}`
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[Test] Completed in ${elapsed}s`);
  console.log(`[Test] Success: ${result.success}`);
  console.log(`[Test] Summary: ${result.summary || "no summary"}`);
  console.log(`[Test] Steps: ${result.steps?.length || 0}`);

  if (result.steps) {
    for (const step of result.steps) {
      if (step.action === "execute") {
        console.log(`  [${step.action}] ${step.tool} -> ${step.result?.success ?? "?"}`);
        if (step.result?.error) console.log(`    Error: ${step.result.error}`);
      } else if (step.action === "error") {
        console.log(`  [${step.action}] ${step.tool || "?"}: ${step.reasoning || step.error || "?"}`);
      } else if (step.action === "done") {
        console.log(`  [${step.action}] ${step.reasoning || step.reason || "?"}`);
      } else if (step.action === "plan") {
        console.log(`  [${step.action}] ${(step.reasoning || step.plan || "").substring(0, 200)}`);
      }
    }
  }

  if (result.output) {
    console.log(`\n[Output]\n${result.output.substring(0, 2000)}`);
  }

  process.exit(result.success ? 0 : 1);
}

main().catch((err) => {
  console.error("[Test] Fatal error:", err);
  process.exit(1);
});
