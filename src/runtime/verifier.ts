import type { ExecutionStep } from "../core/types.js";

// ── Content Quality Types ─────────────────────────────────────────────────────

export interface ContentQualityReport {
  overallScore: number;
  dimensions: {
    factualAccuracy: number;
    completeness: number;
    structure: number;
    dataQuality: number;
    citations: number;
  };
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
}

export interface VerificationResult {
  success: boolean;
  reason: string;
  /** 0-1 confidence from the model-driven critic (only set when model was used) */
  confidence?: number;
  /** 0-10 quality score from the model-driven critic */
  score?: number;
  /** Specific gaps or issues identified by the critic */
  gaps?: string[];
}

export interface CritiqueOutput {
  success: boolean;
  confidence: number;
  score: number;
  reason: string;
  gaps: string[];
}

// ── Rule-based verifier (fallback) ────────────────────────────────────────────

function includesAny(text: string, terms: string[]): boolean {
  const lower = text.toLowerCase();
  return terms.some((term) => lower.includes(term));
}

function hasTool(steps: ExecutionStep[], ...tools: string[]): boolean {
  return steps.some((step) => step.action === "execute" && tools.includes(step.tool!));
}

export function verifyTask(goal: string, steps: ExecutionStep[], doneReason: string): VerificationResult {
  const executedTools = steps.filter((step) => step.action === "execute" && step.tool !== "core.echo");
  const errorSteps = steps.filter((step) => step.action === "error");
  const attemptedTools = steps.filter((step) =>
    (step.action === "execute" || step.action === "error") &&
    step.tool && step.tool !== "core.echo"
  );

  if (errorSteps.length > 0 && attemptedTools.length === 0) {
    return { success: false, reason: "Execution contains errors and no tools were attempted." };
  }

  if (/auto-saved/i.test(doneReason)) {
    return { success: true, reason: doneReason };
  }

  if (includesAny(goal, ["write", "save", "生成文件", "写入", "写", "文档", "创建文件", "新建文件", "输出", "保存"])) {
    return hasTool(steps, "fs.write_file", "fs.enhanced", "shell.exec")
      ? { success: true, reason: doneReason || "Write intent fulfilled." }
      : { success: false, reason: "Goal implies writing, but no write tool (fs.write_file/fs.enhanced/shell.exec) was executed." };
  }

  if (includesAny(goal, ["read", "analyze file", "读取", "读文件"])) {
    return hasTool(steps, "fs.read_file", "fs.enhanced", "shell.exec")
      ? { success: true, reason: doneReason || "Read intent fulfilled." }
      : { success: false, reason: "Goal implies reading, but no read tool was executed." };
  }

  if (includesAny(goal, ["web", "http", "url", "网页", "网站"])) {
    return hasTool(steps, "web.fetch", "search", "shell.exec")
      ? { success: true, reason: doneReason || "Web intent fulfilled." }
      : { success: false, reason: "Goal implies web access, but no web tool was executed." };
  }

  if (doneReason) {
    const onlyEcho = executedTools.length === 0 && attemptedTools.length === 0;
    const noProgress = /no progress|fallback/i.test(doneReason);
    if (onlyEcho && noProgress) {
      return { success: false, reason: "No meaningful tools were executed. The model may not support function calling or tool use." };
    }
    if (/max steps/i.test(doneReason)) {
      return { success: false, reason: `Task hit step limit without completing. ${doneReason}` };
    }
    return { success: true, reason: doneReason };
  }

  return executedTools.length > 0 || attemptedTools.length > 0
    ? { success: true, reason: "Tools were attempted or executed." }
    : { success: false, reason: "No executable progress detected." };
}

// ── Model-driven critic ───────────────────────────────────────────────────────

function buildCritiquePrompt(goal: string, steps: ExecutionStep[], doneReason: string, taskType?: string, outputFormat?: string): string {
  const stepSummary = steps
    .filter(s => s.action !== "note")
    .map(s => {
      const outcome = s.action === "error" ? "FAILED" : s.action === "execute" ? "OK" : s.action;
      return `[${s.step}] ${s.action}${s.tool ? ` ${s.tool}` : ""}${s.reasoning ? ` — ${s.reasoning.substring(0, 120)}` : ""}${s.action === "error" ? ` (${s.reasoning ?? "unknown error"})` : ""}`;
    })
    .join("\n");

  return [
    "You are a rigorous quality evaluator. Judge whether the task was completed successfully.",
    "",
    "Evaluate across these dimensions:",
    "1. **Completion**: Did the agent achieve the stated goal?",
    "2. **Quality**: Is the output well-structured, accurate, and useful?",
    "3. **Coherence**: Do the steps form a logical progression toward the goal?",
    "4. **Correctness**: Were tools used appropriately? Any errors or missteps?",
    "",
    "Respond with ONLY valid JSON (no markdown, no explanation):",
    "{",
    '  "success": true/false,',
    '  "confidence": 0.0-1.0,',
    '  "score": 0-10,',
    '  "reason": "concise verdict (1-2 sentences)",',
    '  "gaps": ["specific issue 1", "specific issue 2"]',
    "}",
    "",
    "---",
    `Goal: ${goal}`,
    `Task type: ${taskType ?? "auto"}`,
    `Output format: ${outputFormat ?? "auto"}`,
    `Done reason: ${doneReason || "(none)"}`,
    "",
    "Execution steps:",
    stepSummary || "(no steps)",
    "",
    "JSON verdict:"
  ].join("\n");
}

function parseCritiqueOutput(raw: string): CritiqueOutput | null {
  try {
    // Extract JSON block — handle both raw JSON and ```-wrapped
    let json = raw.trim();
    const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) json = fenceMatch[1]!.trim();

    // Find the first { and last }
    const start = json.indexOf("{");
    const end = json.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    json = json.substring(start, end + 1);

    const parsed = JSON.parse(json);
    if (typeof parsed.success !== "boolean") return null;

    return {
      success: parsed.success,
      confidence: clamp(Number(parsed.confidence) || 0.7, 0, 1),
      score: clamp(Number(parsed.score) || 5, 0, 10),
      reason: String(parsed.reason ?? (parsed.success ? "Task completed" : "Task incomplete")),
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps.map(String).slice(0, 5) : [],
    };
  } catch {
    return null;
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export async function modelDrivenCritique(
  complete: (model: string, messages: { role: string; content: string }[]) => Promise<string>,
  criticModel: string,
  goal: string,
  steps: ExecutionStep[],
  doneReason: string,
  taskType?: string,
  outputFormat?: string
): Promise<CritiqueOutput | null> {
  const prompt = buildCritiquePrompt(goal, steps, doneReason, taskType, outputFormat);
  try {
    const raw = await complete(criticModel, [
      { role: "system", content: "You are a rigorous quality evaluator. Output only valid JSON." },
      { role: "user", content: prompt }
    ]);
    return parseCritiqueOutput(raw);
  } catch {
    return null;
  }
}

/** Orchestrator: run rule-based first (fast + reliable for clear cases), use model critic for second opinion on failures */
export async function critiqueAndVerify(
  complete: ((model: string, messages: { role: string; content: string }[]) => Promise<string>) | undefined,
  criticModel: string | undefined,
  goal: string,
  steps: ExecutionStep[],
  doneReason: string,
  taskType?: string,
  outputFormat?: string
): Promise<VerificationResult> {
  // Run rule-based verifier first — it's fast and doesn't hallucinate
  const ruleResult = verifyTask(goal, steps, doneReason);

  // If rule-based clearly says success, trust it over the LLM critic
  // (the critic model sometimes hallucinates failures for successful tasks)
  // Only skip the critic if actual tools were executed — prevents false positives
  const executedTools = steps.filter(s => s.action === "execute" && s.tool);
  if (ruleResult.success && executedTools.length > 0) {
    return { ...ruleResult, confidence: 0.9 };
  }

  // Rule-based says failure — try model critic for a second opinion
  if (complete && criticModel) {
    const critique = await modelDrivenCritique(complete, criticModel, goal, steps, doneReason, taskType, outputFormat);
    if (critique && critique.success) {
      return {
        success: true,
        reason: critique.reason,
        confidence: critique.confidence,
        score: critique.score,
        gaps: critique.gaps.length > 0 ? critique.gaps : undefined,
      };
    }
    // If critic also says failure, return the critic's detailed reason
    if (critique) {
      return {
        success: false,
        reason: critique.reason,
        confidence: critique.confidence,
        score: critique.score,
        gaps: critique.gaps.length > 0 ? critique.gaps : undefined,
      };
    }
  }

  // No model critic available — return rule-based failure
  return ruleResult;
}

// ── Deep Content Verification ────────────────────────────────────────────────

function buildContentQualityPrompt(goal: string, content: string, taskType?: string, outputFormat?: string): string {
  // Truncate content to avoid token overflow
  const truncated = content.length > 6000
    ? content.substring(0, 3000) + "\n\n... [truncated] ...\n\n" + content.substring(content.length - 3000)
    : content;

  return [
    "You are an expert content reviewer. Evaluate the quality of this AI-generated output.",
    "",
    "Score each dimension on a 0-10 scale. Be critical and precise.",
    "",
    "Dimensions:",
    "1. **factualAccuracy**: Are claims backed by data? Any obvious factual errors?",
    "2. **completeness**: Does it cover all aspects of the goal? Any missing critical info?",
    "3. **structure**: Is the organization logical? Are sections well-proportioned?",
    "4. **dataQuality**: Are numbers/tables specific and meaningful? Or vague and hand-wavy?",
    "5. **citations**: Are sources referenced? Could a reader verify the information?",
    "",
    "Respond with ONLY valid JSON (no markdown, no explanation):",
    "{",
    '  "overallScore": 0-10,',
    '  "factualAccuracy": 0-10,',
    '  "completeness": 0-10,',
    '  "structure": 0-10,',
    '  "dataQuality": 0-10,',
    '  "citations": 0-10,',
    '  "strengths": ["strength 1", "strength 2"],',
    '  "weaknesses": ["weakness 1", "weakness 2"],',
    '  "recommendation": "1-2 sentence overall improvement suggestion"',
    "}",
    "",
    "---",
    `Goal: ${goal}`,
    `Task type: ${taskType ?? "auto"}`,
    `Output format: ${outputFormat ?? "auto"}`,
    "",
    "Output content:",
    truncated,
    "",
    "JSON evaluation:"
  ].join("\n");
}

function parseContentQualityReport(raw: string): ContentQualityReport | null {
  try {
    let json = raw.trim();
    const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) json = fenceMatch[1]!.trim();

    const start = json.indexOf("{");
    const end = json.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    json = json.substring(start, end + 1);

    const parsed = JSON.parse(json);
    if (typeof parsed.overallScore !== "number") return null;

    const clamp10 = (v: unknown) => clamp(Number(v) || 0, 0, 10);
    return {
      overallScore: clamp10(parsed.overallScore),
      dimensions: {
        factualAccuracy: clamp10(parsed.factualAccuracy),
        completeness: clamp10(parsed.completeness),
        structure: clamp10(parsed.structure),
        dataQuality: clamp10(parsed.dataQuality),
        citations: clamp10(parsed.citations),
      },
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.map(String).slice(0, 5) : [],
      weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses.map(String).slice(0, 5) : [],
      recommendation: String(parsed.recommendation ?? ""),
    };
  } catch {
    return null;
  }
}

export async function deepContentVerify(
  complete: (model: string, messages: { role: string; content: string }[]) => Promise<string>,
  criticModel: string,
  goal: string,
  content: string,
  taskType?: string,
  outputFormat?: string
): Promise<ContentQualityReport | null> {
  if (!content || content.trim().length < 50) return null;

  const prompt = buildContentQualityPrompt(goal, content, taskType, outputFormat);
  try {
    const raw = await complete(criticModel, [
      { role: "system", content: "You are an expert content reviewer. Output only valid JSON." },
      { role: "user", content: prompt }
    ]);
    return parseContentQualityReport(raw);
  } catch {
    return null;
  }
}

function formatContentQualityForReason(report: ContentQualityReport): string {
  const dims = Object.entries(report.dimensions)
    .map(([k, v]) => `${k}=${v}/10`)
    .join(", ");
  const weak = report.weaknesses.length > 0
    ? ` | Weaknesses: ${report.weaknesses.slice(0, 2).join("; ")}`
    : "";
  return `[Content: ${report.overallScore}/10 (${dims})${weak}]`;
}

export { formatContentQualityForReason };
