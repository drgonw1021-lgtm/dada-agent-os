import type { CollaborationMode, ExecutionMode, TaskType } from "../core/types.js";

export interface ModeDetection {
  executionMode: ExecutionMode;
  recommendedCollaboration: CollaborationMode;
  confidence: "high" | "medium" | "low";
  reasons: string[];
}

const PROJECT_KEYWORDS_CN = [
  "搭建", "构建", "开发", "系统", "平台", "项目",
  "重构", "架构", "从零", "全套", "完整", "工程",
  "全栈", "端到端", "上线", "部署", "发布",
];

const PROJECT_KEYWORDS_EN = [
  "build a", "create a", "develop a", "system", "platform",
  "project", "full-stack", "fullstack", "end-to-end", "end to end",
  "from scratch", "deploy", "launch",
];

const MULTI_PHASE_PAIRS: Array<[string, string]> = [
  ["设计", "实现"], ["设计", "开发"], ["设计", "编码"],
  ["调研", "开发"], ["调研", "实现"], ["分析", "实现"],
  ["规划", "执行"], ["规划", "开发"],
  ["开发", "测试"], ["实现", "测试"],
  ["开发", "部署"], ["实现", "部署"],
  ["代码", "文档"], ["实现", "文档"],
];

const EXPLORATORY_KEYWORDS = [
  "调研", "探索", "分析", "评估", "对比", "竞品",
  "research", "explore", "analyze", "compare", "evaluate",
  "调查", "排查", "诊断", "审计", "审核",
];

function countMatches(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  let count = 0;
  for (const kw of keywords) {
    if (lower.includes(kw.toLowerCase())) count++;
  }
  return count;
}

function hasMultiPhaseSignal(goal: string): boolean {
  let pairs = 0;
  const lower = goal.toLowerCase();
  for (const [a, b] of MULTI_PHASE_PAIRS) {
    if (lower.includes(a) && lower.includes(b)) pairs++;
  }
  return pairs >= 2;
}

function hasMixedOutputs(goal: string, taskType?: TaskType): boolean {
  // Code + docs + tests
  const hasCode = /\b(code|代码|程序|应用|app|application|服务|server|api|接口)\b/i.test(goal);
  const hasDocs = /\b(doc|文档|说明|readme|报告|report)\b/i.test(goal);
  const hasTests = /\b(test|测试|验证|verify)\b/i.test(goal);
  const codeTypes = new Set<TaskType>(["code", "automation", "engineering_design"]);
  if (taskType && codeTypes.has(taskType)) return true;
  return (hasCode && hasDocs) || (hasCode && hasTests) || (hasDocs && hasTests);
}

function isStructuredGoal(goal: string): boolean {
  // Structured = clear deliverable, specific steps → dag-pipeline
  const structured = [
    "开发", "搭建", "构建", "创建", "生成", "实现",
    "build", "create", "develop", "generate", "implement",
  ];
  return countMatches(goal, structured) > 0 && !isExploratoryGoal(goal);
}

function isExploratoryGoal(goal: string): boolean {
  return countMatches(goal, EXPLORATORY_KEYWORDS) >= 1;
}

export function detectExecutionMode(
  goal: string,
  taskType?: TaskType
): ModeDetection {
  const reasons: string[] = [];

  // 1. Check project keywords
  const cnHits = countMatches(goal, PROJECT_KEYWORDS_CN);
  const enHits = countMatches(goal, PROJECT_KEYWORDS_EN);
  if (cnHits >= 2 || enHits >= 2) {
    reasons.push(`Matched ${cnHits + enHits} project keywords`);
  }

  // 2. Multi-phase signal
  if (hasMultiPhaseSignal(goal)) {
    reasons.push("Goal spans multiple phases (design+implement+test)");
  }

  // 3. Mixed outputs
  if (hasMixedOutputs(goal, taskType)) {
    reasons.push("Goal requires mixed outputs (code+docs+tests)");
  }

  // 4. TaskType hint
  if (taskType === "engineering_design" || taskType === "automation") {
    reasons.push(`Task type "${taskType}" suggests project scope`);
  }

  const mode: ExecutionMode = reasons.length >= 2 ? "project" : "task";
  const confidence: ModeDetection["confidence"] =
    reasons.length >= 3 ? "high" : reasons.length >= 2 ? "medium" : "low";

  const collab: CollaborationMode = isStructuredGoal(goal) && !isExploratoryGoal(goal)
    ? "dag-pipeline"
    : "master-worker";

  return { executionMode: mode, recommendedCollaboration: collab, confidence, reasons };
}
