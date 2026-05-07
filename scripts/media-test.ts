// Functional test: image generation via gen.media
import { createAgentApp } from "../src/app.js";

async function main() {
  const goal = process.argv[2] || "Generate an illustration of a cute orange tabby cat wearing a wizard hat and casting a spell, save the image";
  console.log(`[MediaTest] Goal: ${goal}`);

  const app = await createAgentApp(process.env);
  console.log(`[MediaTest] Tools (${app.availableTools.length}): ${app.availableTools.join(", ")}`);
  console.log(`[MediaTest] Planner: ${app.config.plannerModel}, Executor: ${app.config.executorModel}`);

  const startTime = Date.now();
  const result = await app.runtime.runTask({
    goal,
    taskId: `media-test-${Date.now()}`
  });

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n[MediaTest] Completed in ${elapsed}s`);
  console.log(`[MediaTest] Success: ${result.success}`);
  console.log(`[MediaTest] Summary: ${result.summary || "no summary"}`);
  console.log(`[MediaTest] Steps: ${result.steps?.length || 0}`);

  if (result.steps) {
    for (const step of result.steps) {
      if (step.action === "execute") {
        console.log(`  [${step.action}] ${step.tool} -> ${step.result?.success ?? "?"}`);
        if (step.result?.error) console.log(`    Error: ${step.result.error}`);
        if (step.result?.file) console.log(`    File: ${step.result.file}`);
        if (step.result?.url) console.log(`    URL: ${step.result.url}`);
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
  console.error("[MediaTest] Fatal error:", err);
  process.exit(1);
});
