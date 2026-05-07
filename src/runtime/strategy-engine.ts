import type { TaskIntent } from "../tasks/task-intent.js";

// ─── Types ────────────────────────────────────────────────────────────────────────

export interface StrategyNode {
  id: string;
  phase: "plan" | "collect" | "execute" | "synthesize" | "verify" | "package";
  label: string;
  description: string;
  preferredTools: string[];
  promptDirectives: string[];
  /** IDs of nodes that must complete before this one */
  dependsOn: string[];
  /** Expected output artifact kind from this node */
  outputKind: "evidence" | "code" | "media" | "document" | "data" | "verdict";
  /** Whether this node can be skipped if dependencies produced sufficient output */
  optional: boolean;
}

export interface ExecutionDAG {
  taskType: string;
  outputFormat: string;
  nodes: StrategyNode[];
  /** Entry points (no dependencies) */
  roots: string[];
  /** Terminal nodes (nothing depends on them) */
  leaves: string[];
}

// ─── Builder ──────────────────────────────────────────────────────────────────────

type Deps = string[];
type Phase = StrategyNode["phase"];
type OutputKind = StrategyNode["outputKind"];

function n(
  id: string,
  phase: Phase,
  label: string,
  description: string,
  tools: string[] = [],
  deps: Deps = [],
  kind: OutputKind = "document",
  optional = false
): StrategyNode {
  return { id, phase, label, description, preferredTools: tools, promptDirectives: [], dependsOn: deps, outputKind: kind, optional };
}

function buildResearchDAG(intent: TaskIntent): ExecutionDAG {
  const nodes: StrategyNode[] = [
    n("scope", "plan", "Define scope", "Clarify research questions, scope boundaries, and success criteria", ["task.planner"]),
    n("search_collect", "collect", "Collect evidence", "Search web and fetch sources; if search quality is poor, use MCP to install better search", ["search", "web.fetch", "mcp.search", "mcp.install"], ["scope"], "evidence"),
    n("chart_data", "synthesize", "Generate charts", "Create visual charts for key data points and comparisons", ["gen.chart"], ["search_collect"], "data"),
    n("analyze", "synthesize", "Analyze findings", "Synthesize evidence, identify patterns, compare sources, draw conclusions", ["task.planner"], ["search_collect", "chart_data"]),
    n("write_report", "synthesize", "Write report", "Write structured report with executive summary, findings, charts, and recommendations", ["fs.write_file"], ["analyze"]),
    n("verify", "verify", "Verify completeness", "Check all deliverables are present, sources are cited, conclusions are supported", ["task.planner"], ["write_report"], "verdict"),
    n("package", "package", "Package artifacts", "Generate final PDF/slides and collect all files for download", ["fs.write_file"], ["verify"]),
  ];
  return buildDAG("research", intent.outputFormat, nodes);
}

function buildCodeDAG(intent: TaskIntent): ExecutionDAG {
  const nodes: StrategyNode[] = [
    n("inspect", "plan", "Inspect codebase", "Read relevant files, understand architecture, identify change points", ["fs.read_file", "fs.enhanced", "shell.exec"], [], "evidence"),
    n("plan", "plan", "Create implementation plan", "Design the change: what files, what edits, what tests to run", ["code.agent", "task.planner"], ["inspect"]),
    n("implement", "execute", "Implement changes", "Apply targeted edits, write new code, refactor as planned", ["code.agent", "fs.write_file", "shell.exec", "code.exec"], ["plan"], "code"),
    n("test", "execute", "Run tests", "Execute test suite and verify changes don't break anything", ["shell.exec", "code.exec"], ["implement"], "verdict"),
    n("verify", "verify", "Verify changes", "Review diff, check edge cases, confirm the fix/feature works", ["task.planner", "code.agent"], ["test"], "verdict"),
    n("summarize", "package", "Summarize changes", "Write change summary, verification notes, remaining risks", ["fs.write_file"], ["verify"]),
    n("self_improve", "verify", "Self-improvement check", "Check if this pattern can be learned for future tasks", ["code.self_improve"], ["summarize"], "verdict", true),
  ];
  return buildDAG("code", intent.outputFormat, nodes);
}

function buildPresentationDAG(intent: TaskIntent): ExecutionDAG {
  const nodes: StrategyNode[] = [
    n("audience", "plan", "Define audience and narrative", "Identify audience, decision goal, and slide storyline", ["task.planner"]),
    n("collect", "collect", "Gather material", "Collect data, examples, and supporting evidence for slides", ["search", "web.fetch"], ["audience"], "evidence"),
    n("outline", "plan", "Create slide outline", "Structure the deck: title, agenda, core slides, closing", ["task.planner"], ["collect"]),
    n("write_slides", "synthesize", "Write slide content", "Create slide-by-slide content with titles, bullets, and speaker notes", ["task.planner"], ["outline"]),
    n("generate_charts", "synthesize", "Generate slide visuals", "Create charts and visual elements for data-heavy slides", ["gen.chart"], ["collect"], "data", true),
    n("package", "package", "Package presentation", "Generate PPTX and HTML slides, collect all artifacts", ["fs.write_file"], ["write_slides", "generate_charts"]),
  ];
  return buildDAG("presentation", intent.outputFormat, nodes);
}

function buildSocialPublishDAG(intent: TaskIntent): ExecutionDAG {
  const nodes: StrategyNode[] = [
    n("clarify_platform", "plan", "Clarify platform and account", "Identify target platform, account, content format, and constraints", ["task.planner", "browser"]),
    n("search_news", "collect", "Collect source material", "Search for recent news, topics, or source content for the post", ["search", "web.fetch", "uapi.search"], ["clarify_platform"], "evidence"),
    n("create_content", "synthesize", "Write content", "Write spoken script, caption, hashtags, and title for the platform", ["task.planner"], ["search_news"], "document"),
    n("generate_media", "execute", "Generate media assets", "Create or locate required video/image/audio assets for publishing", ["gen.media", "browser"], ["create_content"], "media", true),
    n("open_platform", "execute", "Open creator platform", "Use browser tool to open the platform's creator/publish page; report login status", ["browser"], ["generate_media"], "evidence"),
    n("publish_package", "package", "Create publish package", "Use publish.package to assemble and attempt publishing; report blockers clearly", ["publish.package", "browser"], ["open_platform"]),
    n("verify_publish", "verify", "Verify publication", "Confirm post status — published URL or specific blocker with login instructions", ["browser"], ["publish_package"], "verdict"),
  ];
  return buildDAG("social_publish", intent.outputFormat, nodes);
}

function buildImageGenDAG(intent: TaskIntent): ExecutionDAG {
  const nodes: StrategyNode[] = [
    n("clarify_style", "plan", "Clarify visual spec", "Define subject, style, aspect ratio, resolution, and constraints", ["task.planner"]),
    n("design_prompt", "plan", "Design generation prompt", "Craft a detailed image generation prompt matching the visual spec", ["task.planner"], ["clarify_style"]),
    n("generate", "execute", "Generate image", "Use gen.media to produce the image asset with specified parameters", ["gen.media", "vision"], ["design_prompt"], "media"),
    n("verify_quality", "verify", "Verify image quality", "Check generated image meets requirements — composition, clarity, style match", ["vision"], ["generate"], "verdict"),
    n("export", "package", "Export and deliver", "Save final image to output path and report the file location", ["fs.write_file"], ["verify_quality"]),
  ];
  return buildDAG("image_generation", intent.outputFormat, nodes);
}

function buildAutomationDAG(intent: TaskIntent): ExecutionDAG {
  const nodes: StrategyNode[] = [
    n("clarify_trigger", "plan", "Clarify trigger and scope", "Define what triggers the automation, frequency, and success criteria", ["task.planner"]),
    n("design_workflow", "plan", "Design automation workflow", "Specify trigger conditions, action sequence, error handling, and notifications", ["task.planner"], ["clarify_trigger"]),
    n("implement", "execute", "Implement automation", "Write scripts, schedule cron, or configure webhooks for the automation", ["shell.exec", "code.exec", "fs.write_file"], ["design_workflow"], "code"),
    n("test", "execute", "Test automation", "Run a manual test to verify the automation works end-to-end", ["shell.exec"], ["implement"], "verdict"),
    n("document", "package", "Document runbook", "Write runbook with triggers, steps, safeguards, and rollback procedures", ["fs.write_file"], ["test"]),
  ];
  return buildDAG("automation", intent.outputFormat, nodes);
}

function buildFinancialDAG(intent: TaskIntent): ExecutionDAG {
  const nodes: StrategyNode[] = [
    n("scope", "plan", "Define financial scope", "Clarify analysis dimensions, time horizon, and output requirements", ["task.planner", "domain.financial-analysis"]),
    n("collect_data", "collect", "Collect financial data", "Search for market data, financial statements, ratios, and benchmarks", ["search", "web.fetch", "uapi.search"], ["scope"], "evidence"),
    n("analyze", "synthesize", "Analyze and model", "Build financial models, compute ratios, identify trends and anomalies", ["domain.financial-analysis", "gen.chart"], ["collect_data"], "data"),
    n("assess_risk", "verify", "Assess risks", "Identify financial risks, sensitivity analysis, and downside scenarios", ["domain.financial-analysis"], ["analyze"], "verdict"),
    n("write_report", "package", "Write financial report", "Produce structured report with data, charts, analysis, and risk assessment", ["fs.write_file", "gen.chart"], ["assess_risk"]),
  ];
  return buildDAG("financial_analysis", intent.outputFormat, nodes);
}

function buildDomainDAG(intent: TaskIntent): ExecutionDAG {
  // Generic domain task DAG for HR, legal, engineering design, content marketing, customer support
  const domainToolMap: Record<string, string> = {
    legal_review: "domain.legal-review",
    hr_recruitment: "domain.hr-recruitment",
    engineering_design: "domain.engineering-design",
    content_marketing: "domain.content-marketing",
    customer_support: "domain.customer-support",
    education: "domain.education",
    healthcare: "domain.healthcare",
    real_estate: "domain.real-estate",
  };
  const domainTool = domainToolMap[intent.taskType] || "task.planner";

  const nodes: StrategyNode[] = [
    n("clarify", "plan", "Clarify requirements", "Define scope, audience, deliverables, and success criteria", ["task.planner", domainTool]),
    n("research", "collect", "Research and collect", "Gather relevant information, best practices, and benchmarks", ["search", "web.fetch"], ["clarify"], "evidence"),
    n("analyze", "synthesize", "Analyze and structure", "Apply domain expertise to structure findings and recommendations", [domainTool, "gen.chart"], ["research"], "data"),
    n("produce", "synthesize", "Produce deliverables", "Create the primary output — report, plan, playbook, or toolkit", ["fs.write_file", domainTool], ["analyze"]),
    n("verify", "verify", "Verify completeness", "Check all required sections are present and meet quality standards", ["task.planner"], ["produce"], "verdict"),
    n("package", "package", "Package for delivery", "Format final artifacts and ensure they're ready for use", ["fs.write_file"], ["verify"]),
  ];
  return buildDAG(intent.taskType, intent.outputFormat, nodes);
}

function buildVideoEditingDAG(intent: TaskIntent): ExecutionDAG {
  const nodes: StrategyNode[] = [
    n("clarify_vision", "plan", "Define editing vision", "Clarify target audience, video style, duration, pacing, and platform requirements", ["task.planner"]),
    n("collect_assets", "collect", "Collect source media", "Gather raw footage, audio tracks, images, and reference materials", ["search", "web.fetch", "fs.read_file"], ["clarify_vision"], "evidence"),
    n("design_storyboard", "plan", "Design storyboard", "Create shot-by-shot storyboard with timestamps, transitions, and effects", ["task.planner", "gen.chart"], ["collect_assets"]),
    n("edit_timeline", "execute", "Edit timeline", "Assemble clips on timeline, trim, split, and arrange in sequence", ["shell.exec", "fs.write_file"], ["design_storyboard"], "media"),
    n("add_effects", "execute", "Add effects and transitions", "Apply color grading, transitions, text overlays, and visual effects", ["gen.media", "shell.exec"], ["edit_timeline"], "media", true),
    n("mix_audio", "execute", "Mix audio track", "Adjust levels, add background music, voiceover, and sound effects", ["gen.media", "shell.exec"], ["edit_timeline"], "media", true),
    n("export_video", "package", "Export final video", "Render and export in required format, resolution, and codec settings", ["fs.write_file", "shell.exec"], ["add_effects", "mix_audio"]),
    n("verify_quality", "verify", "Verify video quality", "Check export quality, duration, sync, and all platform requirements", ["vision", "task.planner"], ["export_video"], "verdict"),
  ];
  return buildDAG("video_editing", intent.outputFormat, nodes);
}

function buildPodcastProductionDAG(intent: TaskIntent): ExecutionDAG {
  const nodes: StrategyNode[] = [
    n("define_topic", "plan", "Define podcast topic and format", "Clarify episode topic, format (solo/interview/panel), duration, and tone", ["task.planner"]),
    n("research_content", "collect", "Research content", "Gather facts, statistics, stories, and talking points for the episode", ["search", "web.fetch"], ["define_topic"], "evidence"),
    n("write_script", "synthesize", "Write script and outline", "Create episode structure: intro, segments, talking points, transitions, outro", ["task.planner"], ["research_content"], "document"),
    n("record_voice", "execute", "Generate voiceover", "Use TTS to generate narration and host segments with proper pacing", ["gen.voice", "gen.media"], ["write_script"], "media"),
    n("produce_audio", "execute", "Produce audio mix", "Combine voice tracks, add intro/outro music, adjust EQ and levels", ["gen.media", "shell.exec"], ["record_voice"], "media"),
    n("add_chapters", "synthesize", "Add chapters and metadata", "Create chapter markers, show notes, timestamps, and SEO metadata", ["task.planner"], ["produce_audio"], "data"),
    n("export_podcast", "package", "Export podcast episode", "Export final audio file, generate RSS-ready metadata and cover art", ["fs.write_file", "gen.media"], ["add_chapters"]),
    n("verify_quality", "verify", "Verify audio quality", "Check audio clarity, levels, duration, metadata completeness", ["task.planner"], ["export_podcast"], "verdict"),
  ];
  return buildDAG("podcast_production", intent.outputFormat, nodes);
}

function buildDefaultDAG(intent: TaskIntent): ExecutionDAG {
  const nodes: StrategyNode[] = [
    n("clarify", "plan", "Clarify intent", "Understand the task goal, success criteria, and expected output format", ["task.planner"]),
    n("collect", "collect", "Collect information", "Gather evidence, data, or context needed to complete the task", ["search", "web.fetch", "fs.read_file"], ["clarify"], "evidence"),
    n("execute", "execute", "Execute actions", "Perform the core task operations using available tools", [], ["collect"], "code"),
    n("synthesize", "synthesize", "Synthesize results", "Combine findings into a coherent deliverable", ["task.planner", "fs.write_file"], ["execute"]),
    n("verify", "verify", "Verify result", "Check completeness, correctness, and quality of the output", ["task.planner"], ["synthesize"], "verdict"),
    n("package", "package", "Package for delivery", "Generate final artifacts in the requested output format", ["fs.write_file"], ["verify"]),
  ];
  return buildDAG("general", intent.outputFormat, nodes);
}

function buildDAG(taskType: string, outputFormat: string, nodes: StrategyNode[]): ExecutionDAG {
  const allIds = new Set(nodes.map(n => n.id));
  const roots = nodes.filter(n => n.dependsOn.length === 0).map(n => n.id);
  const leaves = nodes.filter(n => ![...allIds].some(id => nodes.find(x => x.id === id)?.dependsOn.includes(n.id))).map(n => n.id);

  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      if (!allIds.has(dep)) {
        console.warn(`[StrategyEngine] Node "${n.id}" depends on unknown node "${dep}"`);
      }
    }
  }

  return { taskType, outputFormat, nodes, roots, leaves };
}

// ─── Engine ───────────────────────────────────────────────────────────────────────

const dagBuilders: Record<string, (intent: TaskIntent) => ExecutionDAG> = {
  research: buildResearchDAG,
  product_research: buildResearchDAG,
  code: buildCodeDAG,
  presentation: buildPresentationDAG,
  data_analysis: buildResearchDAG,
  media_analysis: buildResearchDAG,
  social_publish: buildSocialPublishDAG,
  image_generation: buildImageGenDAG,
  video_generation: buildImageGenDAG,  // similar pipeline: clarify → prompt → generate → verify → export
  voice_generation: buildImageGenDAG,  // similar pipeline
  automation: buildAutomationDAG,
  financial_analysis: buildFinancialDAG,
  legal_review: buildDomainDAG,
  hr_recruitment: buildDomainDAG,
  engineering_design: buildDomainDAG,
  content_marketing: buildDomainDAG,
  customer_support: buildDomainDAG,
  education: buildDomainDAG,
  healthcare: buildDomainDAG,
  real_estate: buildDomainDAG,
  video_editing: buildVideoEditingDAG,
  podcast_production: buildPodcastProductionDAG,
};

export function buildExecutionDAG(intent: TaskIntent): ExecutionDAG {
  const builder = dagBuilders[intent.taskType];
  const dag = builder ? builder(intent) : buildDefaultDAG(intent);

  // Propagate task intent prompt directives into DAG nodes
  if (intent.promptDirectives.length > 0) {
    for (const node of dag.nodes) {
      // Planning nodes get the full intent directives
      if (node.phase === "plan") {
        node.promptDirectives = [...intent.promptDirectives];
      }
      // Execution nodes get the publish/action-specific directives
      if (node.phase === "execute" || node.phase === "synthesize") {
        const actionDirectives = intent.promptDirectives.filter(
          d => d.includes("发布") || d.includes("post") || d.includes("publish") ||
               d.includes("生成") || d.includes("generate") || d.includes("create") ||
               d.includes("写") || d.includes("write") || d.includes("produce")
        );
        if (actionDirectives.length > 0) {
          node.promptDirectives = actionDirectives;
        }
      }
    }
  }

  return dag;
}

/** Sort nodes in topological order for execution */
export function topologicalSort(dag: ExecutionDAG): StrategyNode[] {
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  for (const n of dag.nodes) {
    inDegree.set(n.id, n.dependsOn.length);
    for (const dep of n.dependsOn) {
      const list = adj.get(dep) || [];
      list.push(n.id);
      adj.set(dep, list);
    }
  }

  const queue = dag.roots.slice();
  const sorted: StrategyNode[] = [];
  const nodeMap = new Map(dag.nodes.map(n => [n.id, n]));

  while (queue.length > 0) {
    const id = queue.shift()!;
    const n = nodeMap.get(id);
    if (n) sorted.push(n);

    for (const next of (adj.get(id) || [])) {
      const deg = (inDegree.get(next) || 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) queue.push(next);
    }
  }

  return sorted;
}

/** Export DAG as Mermaid diagram for visualization */
export function toMermaid(dag: ExecutionDAG): string {
  const lines = ["graph TD"];
  const colors: Record<string, string> = {
    plan: "#3B82F6", collect: "#10B981", execute: "#F59E0B",
    synthesize: "#8B5CF6", verify: "#EF4444", package: "#EC4899"
  };

  for (const n of dag.nodes) {
    const optional = n.optional ? " (optional)" : "";
    lines.push(`  ${n.id}["${n.label}${optional}"]:::${n.phase}`);
  }

  for (const n of dag.nodes) {
    for (const dep of n.dependsOn) {
      lines.push(`  ${dep} --> ${n.id}`);
    }
  }

  for (const [phase, color] of Object.entries(colors)) {
    lines.push(`  classDef ${phase} fill:${color},stroke:${color},color:#fff`);
  }

  return lines.join("\n");
}
