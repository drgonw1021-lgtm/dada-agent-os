import { createAgentApp } from "./app.js";

async function main(): Promise<void> {
  const app = await createAgentApp(process.env);

  const goal = process.argv.slice(2).join(" ").trim();
  if (!goal) {
    console.log("[APP] No task specified. DaDa is idle. Use: npx tsx src/index.ts \"your task here\"");
    console.log("[APP] Or start the web UI to submit tasks interactively.");
    // Keep process alive for SelfImprover and monitoring
    await new Promise(() => {}); // never resolve — keep alive
  }
  const result = await app.runtime.runTask({ goal: goal! });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("Fatal runtime error:", error);
  process.exitCode = 1;
});
