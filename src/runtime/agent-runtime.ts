import { randomUUID } from "node:crypto";
import type { FunctionDefinition, ToolCall } from "../core/types.js";
import type { ExecutionStep, TaskInput, TaskResult } from "../core/types.js";
import { ApprovalRequiredError, TaskPausedForApprovalError } from "../core/errors.js";
import { AuditLog } from "../governance/audit-log.js";
import { buildCapabilityRoutePlan } from "../capabilities/capability-router.js";
import { resolveTaskIntent } from "../tasks/task-intent.js";
import { buildExecutionDAG, topologicalSort } from "./strategy-engine.js";
import { parsePlanActions, type ParsedAction } from "./plan-parser.js";
import { critiqueAndVerify, verifyTask, deepContentVerify, formatContentQualityForReason, type VerificationResult } from "./verifier.js";
import type { LoadedSkill } from "../skills/skill-loader.js";
import type { MemorySystem } from "../memory/memory-system.js";
import type { TaskMemoryStore } from "../memory/task-memory-store.js";
import type { SemanticMemory } from "../memory/semantic-memory.js";
import { AgentStateMachine } from "./agent-state-machine.js";

import { SelfEvolver, type EvolutionCandidate } from "./self-evolver.js";
import type { SelfImprover } from "./self-improver.js";
import type { Logger } from "../observability/logger.js";
import { diagnoseToolError, formatDiagnosis, type Diagnosis } from "../tools/tool-diagnostics.js";
import type { SmartEscalation } from "../operations/smart-escalation.js";
import type { KnowledgeBase } from "../knowledge/knowledge-base.js";
import { ThoughtTreePlanner, buildBranchingPrompt, parseBranchEvaluations, scoreBranches, type BranchEvaluation, type ThoughtNode } from "./thought-tree-planner.js";
import { HierarchicalPlanner } from "./hierarchical-planner.js";
import { ProgressDetector, type CycleSnapshot } from "../tasks/progress-detector.js";
import { CheckpointManager } from "./checkpoint-manager.js";
import type { StrategyEvaluator } from "../governance/strategy-evaluator.js";
import { detectExecutionMode } from "../tasks/mode-detector.js";
import { DagPipelineOrchestrator, phaseToRole } from "./dag-pipeline-orchestrator.js";
import { MasterWorkerOrchestrator } from "./master-worker-orchestrator.js";

// ─── Deps Interface ────────────────────────────────────────────────────────────
// Matches what app.ts actually constructs

interface ToolSummary { id: string; description: string; inputSchema?: import("../core/types.js").ToolParam; riskLevel?: string; available?: boolean; hasStream?: boolean; }

export interface AgentRuntimeDeps {
  router: {
    complete(request: {
      model: string;
      messages: { role: string; content: string; tool_call_id?: string; name?: string }[];
      tools?: FunctionDefinition[];
    }): Promise<{ content: string; toolCalls?: ToolCall[]; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }>;
    completeStream(request: {
      model: string;
      messages: { role: string; content: string; tool_call_id?: string; name?: string }[];
      tools?: FunctionDefinition[];
    }): AsyncIterable<{ content: string; toolCalls?: ToolCall[]; done: boolean; error?: string }>;
  };
  tools: {
    list(): ToolSummary[];
    execute(name: string, args: unknown, ctx: { now: Date; taskId: string; taskLineageId: string; goal?: string }): Promise<unknown>;
    executeStream?(name: string, args: unknown, ctx: { now: Date; taskId: string; taskLineageId: string; goal?: string }, onProgress: (chunk: import("../core/types.js").ToolStreamChunk) => void): Promise<unknown>;
  };
  audit: AuditLog;
  plannerModel: string;
  memory?: MemorySystem;
  taskMemory?: TaskMemoryStore;
  semanticMemory?: SemanticMemory;
  executorModel: string;
  criticModel: string;
  maxPlanningCycles: number;
  maxSteps: number;
  maxToolCalls: number;
  experiences: { list(): Promise<unknown[]>; appendFromTask(t: unknown): Promise<void> };
  advisor: { suggest(goal: string, records: unknown[]): unknown[]; suggestEnhanced(ctx: unknown, records: unknown[]): unknown[]; learnFromOutcome(goal: string, success: boolean, errors: string[]): void };
  skills: { list(): unknown[]; get(name: string): { instructions?: string } | undefined; loadFromDirectory(dir: string): Promise<void> };
  domainEngine: { plan(goal: string, memoryContext: string): Promise<string>; getInsights(domain: string, goal: string): string; learn(domain: string, goal: string, outcome: "success" | "failure", insight: string): Promise<unknown>; think?(domain: string, goal: string): Promise<string> };
  progress?: {
    emit(taskId: string, event: { type: string; payload?: unknown; at: string }): void;
  };
  progressDetector?: ProgressDetector;
  disableVerifier: boolean;

  selfEvolver?: SelfEvolver;
  selfImprover?: SelfImprover;
  logger?: Logger;
  knowledgeBase?: KnowledgeBase;
  thoughtTreeEnabled?: boolean;
  checkpointManager?: CheckpointManager;
  subgoalExecutor?: (goal: string, parentTaskId: string) => Promise<import("./hierarchical-planner.js").ExecutionResult>;
  smartEscalation?: SmartEscalation;
  strategyEvaluator?: StrategyEvaluator;
  /** Timeout for individual LLM API calls in ms. Default 120000 (2 min). */
  llmTimeoutMs?: number;
  /** Timeout for individual tool executions in ms. Default 300000 (5 min). */
  toolTimeoutMs?: number;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

function currentDateTimeContext(): string {
  const now = new Date();
  const iso = now.toISOString();
  const human = now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
  const time = now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
  return `## 当前时间\n${human} ${time}（ISO: ${iso}）\n**重要**：这是当前的真实时间。所有搜索、数据查询、报告都必须基于这个时间。不要使用过时的数据。搜索时要在查询中加入"2026"等当前年份确保结果时效性。`;
}

function buildSystemPrompt(): string {
  return currentDateTimeContext() + "\n\n" + CORE_SYSTEM_PROMPT;
}

const CORE_SYSTEM_PROMPT = `你是 DaDa，一个自主 AI Agent。你的唯一目标是产出**可交付的成果**。

## 编码行为准则（Karpathy Guidelines）

你是LLM，容易犯以下错误：做错误假设、过度复杂化、乱改无关代码、没有验证标准。以下4条原则专门解决这些问题：

### 1. 编码前先思考
- 明确陈述你的假设。如果不确定，**问**，不要猜。
- 存在多种理解时，**呈现出来**让用户选，不要默默挑一个。
- 有更简单方案就说。该质疑时就质疑。
- 有不清楚的地方就停下来，说出困惑，请求澄清。

### 2. 简洁优先
- 不做需求之外的功能。不为一次性代码建抽象。
- 不做未被要求的"灵活性"或"可配置性"。
- 不为不可能的场景做错误处理。
- 200行能写成的不要写1000行。写完后问自己：资深工程师会觉得过度复杂吗？

### 3. 精准修改（手术式）
- **只改必须改的**。不要"顺便优化"相邻代码、注释、格式。
- 不要重构没坏的东西。匹配现有风格。
- 注意到无关的死代码 → 提一下就好，**不要删**。
- 你改动造成的孤儿代码（未使用的import/变量）→ 清理掉。
- 检验标准：diff中每一行改动都能追溯到用户请求。

### 4. 目标驱动执行
- "加个验证" → 写成"为无效输入写测试，让测试通过"
- "修个bug" → 写成"写能复现bug的测试，修好让测试通过"
- 多步骤任务给出简短计划，每步带验证标准

## 核心规则

1. **任务主题不可修改**：用户给你的任务主题是锁定的。禁止替换、扩展或重新解释任务中的关键名词。如果发现自己在处理不同的主题，立刻停止并回到正确主题。
2. **先确认再行动**：每轮开始用一句话复述任务关键词，确认你没跑偏。
3. **task.planner 最多调一次**，获取计划后自己执行。不要重复调用。
4. **搜索限3次**：整个任务最多3轮搜索，超过就必须写文件。搜索时一次只搜一个关键词。
5. **步数过半就写文件**：不要一直搜索。数据不够就用你的知识补充，标注"基于模型知识估算"。
6. **产出交付物**：用 fs.write_file 写文件。不要输出执行日志当结果。
7. **缺能力自己补**：
   - 缺工具 → mcp.search 搜索 MCP 服务器 → mcp.install 安装
   - mcp.search 找不到 → clawhub:search 搜索 Skill
   - 也找不到 Skill → code.self_improve 或 code.generator 自己写代码实现
   - 缺 API Key → 告诉用户去哪申请、多少钱、怎么配置
   - 永远不要因为缺能力而放弃，自己找到或创造所需的能力
8. **需要登录/账号的任务**：如果要操作小红书、微博、淘宝等需要账号密码的第三方平台，你必须先停下来告诉用户：你需要什么权限、需要用户提供什么（cookie/token/账号）、哪些步骤你可以做（内容策划、文案撰写）、哪些步骤必须用户手动完成（登录、发布）。不要假装执行或创建虚假的"自动化脚本"来糊弄。
9. **不要生成空子目标**：分解任务时每个子目标必须有明确的、非空的描述。如果一个步骤不需要做，就不要列为子目标。

## 出问题时的处理

- 搜索不相关 → 换关键词。搜了3轮还不行 → 用知识写，标注"基于模型知识估算"
- 工具失败 → 换工具达到同样目的，不重试同一工具超过2次
- 需要 Key/权限 → 主动告诉用户：需要什么、去哪申请（给网址）、怎么配置、费用

## 任务类型速查

- **调研/报告**：搜索→收集数据→gen.chart生成图表→fs.write_file写Markdown→完成
- **写代码**：读文件→改代码→验证→写回
- **自动化**：明确定时规则→手动测试→设置cron
- **媒体生成**：确认参数→生成→验证

## 工具格式

TOOL <工具名> <JSON参数>

示例：
TOOL search {"query":"latest developments in AI","maxResults":5}
TOOL gen.chart {"type":"bar","labels":["A","B"],"datasets":[{"data":[10,20]}],"outputPath":"charts/c.png"}
TOOL fs.write_file {"path":"report.md","content":"# 报告\\n内容..."}
TOOL mcp.search {"query":"web search"}
TOOL mcp.install {"packageName":"@brave/brave-search-mcp-server"}
TOOL clawhub:search {"query":"web scraper"}
TOOL code.self_improve {"goal":"write a web scraper that extracts article text","outputPath":"tools/scraper.ts"}

你在真实系统中运行，工具调用会实际执行。产出成果，不要废话。`;

const MINIMAL_SYSTEM_PROMPT = `你是 DaDa，一个自主 AI Agent。直接回答用户问题，不要过度规划。

## 核心规则
1. **直接回答**：简单问题直接回答，不要调用 task.planner。
2. **搜索限1次**：最多搜索1次，搜完直接回答。
3. **不要写文件**：除非用户明确要求，否则不要创建文件。
4. **简短输出**：用中文回答，简洁直接。`;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Race a promise against a timeout, clearing the timer on settle. */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000}s`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    clearTimeout(timer!);
  }
}

// ─── Runtime ─────────────────────────────────────────────────────────────────

export class AgentRuntime {
  constructor(private readonly deps: AgentRuntimeDeps) {}
  private get _llmTimeout(): number { return this.deps.llmTimeoutMs ?? 120_000; }

  private get _toolTimeout(): number { return this.deps.toolTimeoutMs ?? 300_000; }

  private _timedComplete(request: Parameters<AgentRuntimeDeps["router"]["complete"]>[0]): Promise<Awaited<ReturnType<AgentRuntimeDeps["router"]["complete"]>>> {
    return withTimeout(this.deps.router.complete(request), this._llmTimeout, "LLM call");
  }

  private _timedExecute(name: string, args: unknown, ctx: { now: Date; taskId: string; taskLineageId: string; goal?: string }): Promise<unknown> {
    return withTimeout(this.deps.tools.execute(name, args, ctx), this._toolTimeout, `Tool "${name}"`);
  }

  private _timedExecuteStream(name: string, args: unknown, ctx: { now: Date; taskId: string; taskLineageId: string; goal?: string }, onProgress: (chunk: import("../core/types.js").ToolStreamChunk) => void): Promise<unknown> {
    return withTimeout(this.deps.tools.executeStream!(name, args, ctx, onProgress), this._toolTimeout, `Tool "${name}" stream`);
  }

  private _currentTaskId: string | null = null;
  private thoughtTree: ThoughtTreePlanner | null = null;
  private thoughtTreeNode: ThoughtNode | null = null;

  private _emitUsage(usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }) {
    if (!this._currentTaskId || !this.deps.progress || !usage) return;
    this.deps.progress.emit(this._currentTaskId, {
      type: "model.usage",
      payload: {
        promptTokens: usage.promptTokens || 0,
        completionTokens: usage.completionTokens || 0,
        totalTokens: usage.totalTokens || 0
      },
      at: new Date().toISOString()
    });
  }

  async completeWithModel(
    model: string,
    messages: { role: string; content: string }[],
    onToken?: (token: string) => void
  ): Promise<string> {
    if (onToken) {
      const timeout = this._llmTimeout;
      const streamPromise = (async () => {
        let fullContent = "";
        for await (const chunk of this.deps.router.completeStream({ model, messages })) {
          if (chunk.error) throw new Error(chunk.error);
          if (chunk.content) {
            fullContent += chunk.content;
            onToken(chunk.content);
          }
        }
        return fullContent;
      })();
      return withTimeout(streamPromise, timeout, "LLM stream");
    }
    const response = await this._timedComplete({ model, messages });
    this._emitUsage(response.usage);
    return response.content;
  }

  /** Build OpenAI-compatible tool definitions from the tool registry, optionally filtered */
  buildToolDefinitions(filter?: string[]): FunctionDefinition[] {
    const all = this.deps.tools.list().filter(t => t.available !== false);
    const keep = filter ? new Set(filter) : null;
    const candidates = keep ? all.filter((t) => keep.has(t.id)) : all;
    // Always include essential tools: basic I/O + infrastructure (self-help, delegation, discovery)
    const essentials = new Set([
      "core.echo", "fs.read_file", "fs.write_file", "shell.exec",
      // Only include discovery tools when the task might need them
    ]);
    // Always-include prefixes: tools from these ecosystems are auto-visible to LLM
    const alwaysPrefixes: string[] = []; // MCP/clawhub now opt-in via preferredTools
    // Research/complex tasks get planner + search discovery
    const taskNeedsDiscovery = keep && (
      keep.has("uapi.search") || keep.has("search") || keep.has("mcp.search") ||
      keep.has("task.planner") || keep.has("web.fetch") || keep.has("api.request") ||
      keep.has("gen.chart") || keep.has("agent.delegate")
    );
    if (taskNeedsDiscovery) {
      essentials.add("mcp.list").add("mcp.search").add("mcp.install");
      essentials.add("clawhub:search").add("clawhub:install");
      essentials.add("agent.delegate").add("agent.list");
      essentials.add("skill.create").add("tool.provision");
    }
    // Merge essentials into candidates when a filter is active
    const isAlwaysVisible = (t: { id: string }) => essentials.has(t.id);
    const merged = keep
      ? candidates.concat(all.filter((t) => isAlwaysVisible(t) && !keep.has(t.id)))
      : candidates;
    // Deduplicate by id
    const seen = new Set<string>();
    const unique = merged.filter((t) => seen.has(t.id) ? false : (seen.add(t.id), true));
    return unique.map((tool) => ({
      name: tool.id,
      description: tool.riskLevel === "high"
        ? `[HIGH RISK] ${tool.description}`
        : tool.description,
      parameters: tool.inputSchema ?? { type: "object" as const, properties: {}, required: [] }
    }));
  }

  /**
   * Structured tool calling: calls the model with tool definitions, executes
   * any tool_calls returned. Falls back to returning raw text if no tool calls.
   */
  async completeWithTools(
    model: string,
    messages: { role: string; content: string }[],
    tools: FunctionDefinition[],
    context: { taskId: string; taskLineageId: string; goal?: string; step: { value: number } },
    history?: { role: string; content: string; tool_call_id?: string; name?: string }[],
    maxToolCallsOverride?: number
  ): Promise<{ planText: string; executedTools: number; toolSteps: ExecutionStep[]; history: { role: string; content: string; tool_call_id?: string; name?: string }[] }> {
    const maxToolCalls = maxToolCallsOverride ?? this.deps.maxToolCalls;
    let toolCallCount = 0;
    // OpenAIDeepSeek require assistant(tool_calls) → tool results interleaved in order.
    // Use a single array to preserve correct ordering across multiple follow-up rounds.
    const followUpMsgs: { role: string; content: string; tool_call_id?: string; name?: string; toolCalls?: ToolCall[]; reasoning_content?: string }[] = [];
    const lastToolSignatures: string[] = [];
    const calledTools = new Set<string>();
    const toolSteps: ExecutionStep[] = [];

    const MAX_MSG_CHARS = 36000; // ~9K tokens target, 30-45% of prior 22K
    const trimMessages = (msgs: { role: string; content: string; tool_call_id?: string; name?: string }[]) => {
      let total = 0;
      for (const m of msgs) total += (m.content?.length || 0);
      if (total <= MAX_MSG_CHARS) return msgs;
      // Trim old tool results from the front, keep system + recent intact
      const result = msgs.slice();
      let trimmed = 0;
      for (let i = 1; i < result.length - 6 && total - trimmed > MAX_MSG_CHARS; i++) {
        if (result[i].role === "tool" && (result[i].content?.length || 0) > 300) {
          const originalLen = result[i].content?.length || 0;
          const cut = Math.min(originalLen - 300, total - trimmed - MAX_MSG_CHARS + 1000);
          if (cut > 0) {
            result[i] = { ...result[i], content: (result[i].content?.slice(0, 300) || "") + `...[trimmed ${cut} of ${originalLen} chars]` };
            trimmed += cut;
          }
        }
      }
      return result;
    };
    const buildMessages = () => trimMessages([
      ...messages,
      ...(history || []),
      ...followUpMsgs
    ] as { role: string; content: string; tool_call_id?: string; name?: string }[]);

    let response = await this._timedComplete({ model, messages: buildMessages(), tools });
    this._emitUsage(response.usage);
    console.log(`[completeWithTools] model=${model}, hasToolCalls=${!!response.toolCalls}, toolCallCount=${response.toolCalls?.length ?? 0}, contentLen=${(response.content || "").length}`);
    let planText = response.content || "";
    // Build pending assistant — defer push until after ThoughtTree (may mutate tool_call IDs)
    let pendingAssistant: any = { role: "assistant", content: response.content, reasoning_content: (response as any).reasoning_content, toolCalls: response.toolCalls };

    while (response.toolCalls && response.toolCalls.length > 0 && toolCallCount < maxToolCalls) {
      const toolSignatures = response.toolCalls.map(tc => `${tc.function.name}:${tc.function.arguments}`);
      console.log(`[completeWithTools] Entering tool loop, toolCalls=${response.toolCalls.map(tc => tc.function.name).join(",")}`);

      // Detect same-tool-set repetition — compare name+args, not just names
      const prevSet = new Set(lastToolSignatures);
      const currSet = new Set(toolSignatures);
      const sameAsLast = prevSet.size === currSet.size && [...prevSet].every(t => currSet.has(t));
      if (sameAsLast) {
        console.log(`[completeWithTools] Same-tool-set repetition detected (${response.toolCalls.map(tc => tc.function.name).join(",")}), breaking with text-only follow-up`);
        // One final call without tools to get a text summary
        try {
          const finalResponse = await this._timedComplete({ model, messages: buildMessages() });
          this._emitUsage(finalResponse.usage);
          if (finalResponse.content) {
            planText += "\n" + finalResponse.content;
          }
        } catch (err) { console.warn("[RUNTIME] Plan continuation failed: " + (err instanceof Error ? err.message : String(err))); }
        break;
      }

      // Thought-Tree branching: generate alternatives and select best
      if (this.deps.thoughtTreeEnabled) {
        const branched = await this.branchWithTree(
          model,
          context.goal ?? "Unknown task",
          response.toolCalls,
          planText,
          calledTools,
          context.taskId
        );
        if (branched !== response.toolCalls) {
          console.log(`[completeWithTools] ThoughtTree selected different branch: ${branched.map(tc => tc.function.name).join(",")}`);
          response.toolCalls = branched;
          pendingAssistant.toolCalls = branched; // sync after branching
        }
      }

      // Push AFTER branching — tool_call_ids now match what we execute
      followUpMsgs.push(pendingAssistant);

      for (const toolCall of response.toolCalls) {
        toolCallCount++;
        context.step.value++;
        const stepNum = context.step.value;

        // Guard: task.planner should only be called once per planning cycle.
        // Repeated calls mean the model is stuck planning instead of executing.
        if (toolCall.function.name === "task.planner" && calledTools.has("task.planner")) {
          followUpMsgs.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: "STOP. You already received a plan from task.planner. You do NOT need to plan again. Instead, execute the plan steps NOW. Use search to find data, web.fetch to read pages, fs.write_file to save results. Output your next action as: TOOL <tool_name> {\"param\":\"value\"}"
          });
          continue;
        }
        calledTools.add(toolCall.function.name);

        this.deps.progress?.emit(context.taskId, {
          type: "tool.start",
          payload: { tool: toolCall.function.name, args: toolCall.function.arguments, step: stepNum },
          at: new Date().toISOString()
        });

        let errorMsg: string | undefined;

        try {
          let rawArgs = toolCall.function.arguments;
          let args: any;
          try {
            args = JSON.parse(rawArgs);
          } catch (parseErr) {
            // Recovery: try to salvage malformed JSON (common with long content strings)
            const errMsg = (parseErr as Error).message;
            const posMatch = errMsg.match(/position (\d+)/);
            if (posMatch) {
              const errPos = parseInt(posMatch[1]);
              // Truncate at last complete key-value pair before error, close JSON
              const before = rawArgs.substring(0, errPos);
              const lastComma = before.lastIndexOf(',"');
              const lastBrace = before.lastIndexOf('{"');
              const cutPos = Math.max(lastComma, lastBrace);
              if (cutPos > 0) {
                rawArgs = before.substring(0, cutPos) + '}';
                try { args = JSON.parse(rawArgs); } catch { console.warn("[RUNTIME] JSON recovery still failed for args: " + rawArgs.slice(0, 80)); }
              }
            }
            if (!args) throw parseErr; // re-throw if recovery failed
          }
          const toolCtx = {
            now: new Date(),
            taskId: context.taskId,
            taskLineageId: context.taskLineageId,
            goal: context.goal
          };
          const toolSummary = this.deps.tools.list().find(t => t.id === toolCall.function.name);
          const useStream = toolSummary?.hasStream && this.deps.tools.executeStream;

          let result: unknown;
          let toolError: Error | null = null;
          try {
            result = useStream
              ? await this._timedExecuteStream(toolCall.function.name, args, toolCtx, (chunk) => {
                  this.deps.progress?.emit(context.taskId, {
                    type: "tool.stream",
                    payload: { tool: toolCall.function.name, chunk, step: context.step.value },
                    at: new Date().toISOString()
                  });
                })
              : await this._timedExecute(toolCall.function.name, args, toolCtx);
          } catch (err) {
            toolError = err instanceof Error ? err : new Error(String(err));
          }

          // —— Unified error detection: thrown errors AND {success:false} returns ——
          errorMsg = undefined;
          let diag: Diagnosis | null = null;
          if (toolError) {
            errorMsg = toolError.message;
            diag = diagnoseToolError(errorMsg, toolCall.function.name);
          } else if (result && typeof result === "object" && "success" in result && (result as any).success === false && "error" in result) {
            errorMsg = String((result as any).error);
            diag = diagnoseToolError(errorMsg, toolCall.function.name);
          }

          // —— Auto-retry for selfFixable transient errors (timeout/network) ——
          const isTransient = diag && diag.selfFixable && (diag.category === "timeout" || diag.category === "network");
          if (isTransient && toolError) {
            for (let retryAttempt = 0; retryAttempt < 2; retryAttempt++) {
              const delay = 1000 * (retryAttempt + 1); // 1s, 2s exponential backoff
              console.log(`[completeWithTools] Auto-retry ${retryAttempt + 1}/2 for ${toolCall.function.name} (${diag!.category}) in ${delay}ms`);
              await new Promise(r => setTimeout(r, delay));
              try {
                result = useStream
                  ? await this._timedExecuteStream(toolCall.function.name, args, toolCtx, (chunk) => {
                      this.deps.progress?.emit(context.taskId, {
                        type: "tool.stream",
                        payload: { tool: toolCall.function.name, chunk, step: context.step.value },
                        at: new Date().toISOString()
                      });
                    })
                  : await this._timedExecute(toolCall.function.name, args, toolCtx);
                toolError = null;
                errorMsg = undefined;
                diag = null;
                console.log(`[completeWithTools] Auto-retry ${retryAttempt + 1} succeeded for ${toolCall.function.name}`);
                break;
              } catch (retryErr) {
                toolError = retryErr instanceof Error ? retryErr : new Error(String(retryErr));
                console.log(`[completeWithTools] Auto-retry ${retryAttempt + 1} failed for ${toolCall.function.name}: ${toolError.message.slice(0, 100)}`);
              }
            }
          }

          // —— SelfFixable auto-execution for missing dependencies (1.4) ——
          if (diag?.selfFixable && diag.category === "missing_dependency" && errorMsg) {
            console.log(`[completeWithTools] SelfFixable missing dependency for ${toolCall.function.name}, attempting auto-install...`);
            try {
              // Get install instructions via tool.provision
              const provisionResult = await this.deps.tools.execute("tool.provision", {
                action: "ensure",
                tool: toolCall.function.name
              }, toolCtx);
              const installCmd = (provisionResult as any)?.installCommand || (provisionResult as any)?.command;
              if (installCmd) {
                console.log(`[completeWithTools] Auto-installing: ${installCmd}`);
                try {
                  await this.deps.tools.execute("shell.exec", { command: installCmd, timeoutMs: 60000 }, toolCtx);
                  console.log(`[completeWithTools] Auto-install succeeded, retrying ${toolCall.function.name}`);
                  // Retry the original tool
                  try {
                    result = useStream
                      ? await this._timedExecuteStream(toolCall.function.name, args, toolCtx, (chunk) => {
                          this.deps.progress?.emit(context.taskId, {
                            type: "tool.stream",
                            payload: { tool: toolCall.function.name, chunk, step: context.step.value },
                            at: new Date().toISOString()
                          });
                        })
                      : await this._timedExecute(toolCall.function.name, args, toolCtx);
                    toolError = null;
                    errorMsg = undefined;
                    diag = null;
                    console.log(`[completeWithTools] SelfFixable retry succeeded for ${toolCall.function.name}`);
                  } catch (retryErr) {
                    console.log(`[completeWithTools] SelfFixable retry still failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`);
                  }
                } catch (installErr) {
                  console.log(`[completeWithTools] Auto-install failed: ${installErr instanceof Error ? installErr.message : String(installErr)}`);
                }
              }
            } catch (provErr) {
              console.log(`[completeWithTools] tool.provision failed: ${provErr instanceof Error ? provErr.message : String(provErr)}`);
            }
          }

          // —— SelfFixable not_found: verify path and suggest correction (1.4) ——
          if (diag?.selfFixable && diag.category === "not_found" && errorMsg) {
            try {
              const pathHint = errorMsg.match(/([^\s"']+(?:\.[a-z]{1,8}))(?:\s|$|'|")/i);
              if (pathHint) {
                await this.deps.tools.execute("fs.list_files", { path: ".", depth: 1 }, toolCtx);
              }
            } catch (err) { console.warn("[RUNTIME] Tool error path hint lookup failed: " + (err instanceof Error ? err.message : String(err))); }
          }

          if (errorMsg) {
            const enrichedError = diag
              ? `${errorMsg}\n\n[DIAGNOSIS] ${diag.cause}\n[FIX] ${diag.fix}`
              : errorMsg;
            followUpMsgs.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: `ERROR: ${enrichedError}` });
            this.deps.audit.append(context.taskId, { step: stepNum, action: "error", tool: toolCall.function.name, reasoning: enrichedError });
            toolSteps.push({ step: stepNum, action: "error", tool: toolCall.function.name, reasoning: enrichedError });
            // Track failure for SmartEscalation
            this.deps.smartEscalation?.trackFailure(context.taskId);
          } else {
            this.deps.audit.append(context.taskId, { step: stepNum, action: "execute", tool: toolCall.function.name, result });
            toolSteps.push({ step: stepNum, action: "execute", tool: toolCall.function.name, result });
            followUpMsgs.push({
              role: "tool",
              tool_call_id: toolCall.id,
              name: toolCall.function.name,
              content: typeof result === "string" ? (result.length > 800 ? result.slice(0, 800) + `...[${result.length - 800} chars]` : result) : (() => { const s = JSON.stringify(result); return s.length > 800 ? s.slice(0, 800) + `...[${s.length - 800} chars]` : s; })()
            });
            // Track success for SmartEscalation
            this.deps.smartEscalation?.trackSuccess(context.taskId);
          }

        } catch (parseThrowErr) {
          // JSON parse recovery failure or unexpected error in tool execution
          errorMsg = parseThrowErr instanceof Error ? parseThrowErr.message : String(parseThrowErr);
          const pDiag = diagnoseToolError(errorMsg, toolCall.function.name);
          const enrichedParseError = `${errorMsg}\n\n[DIAGNOSIS] ${pDiag.cause}\n[FIX] ${pDiag.fix}`;
          followUpMsgs.push({ role: "tool", tool_call_id: toolCall.id, name: toolCall.function.name, content: `ERROR: ${enrichedParseError}` });
          this.deps.audit.append(context.taskId, { step: stepNum, action: "error", tool: toolCall.function.name, reasoning: enrichedParseError });
          toolSteps.push({ step: stepNum, action: "error", tool: toolCall.function.name, reasoning: enrichedParseError });
          this.deps.smartEscalation?.trackFailure(context.taskId);
        }

        this.deps.progress?.emit(context.taskId, {
          type: "tool",
          payload: { tool: toolCall.function.name, success: !errorMsg, error: errorMsg, step: stepNum },
          at: new Date().toISOString()
        });
      }

      // Record execution outcome in thought-tree for cross-cycle learning
      if (this.thoughtTreeNode && !this.thoughtTreeNode.executed) {
        this.thoughtTree?.recordExecution(
          this.thoughtTreeNode,
          toolSteps.filter(s => s.action === "error").length === 0,
          toolSteps.slice(-5),
          toolSteps.filter(s => s.action === "error").map(s => s.reasoning).filter(Boolean).join("; ") || undefined
        );
      }

      // Save tool names for repetition detection, then follow up WITH tools
      // so the model can continue making native tool calls if needed.
      // Text-format tool calls (XML <invoke>, TOOL, etc.) are caught by parsePlanActions below.
      lastToolSignatures.splice(0, lastToolSignatures.length, ...toolSignatures);
      response = await this._timedComplete({ model, messages: buildMessages(), tools });
      this._emitUsage(response.usage);
      planText += "\n" + (response.content || "");
      // New object — next iteration's ThoughtTree will sync before push
      pendingAssistant = { role: "assistant" as const, content: response.content, reasoning_content: (response as any).reasoning_content, toolCalls: response.toolCalls };
    }

    const finalHistory = buildMessages().slice(messages.length);
    return toolCallCount === 0
      ? { planText: response.content || planText, executedTools: 0, toolSteps, history: finalHistory }
      : { planText, executedTools: toolCallCount, toolSteps, history: finalHistory };
  }

  summarizeRecentSteps(steps: ExecutionStep[], limit = 8): string {
    return steps
      .slice(-limit)
      .map((s) => {
        const parts = [`step=${s.step}`, `action=${s.action}`];
        if (s.tool) parts.push(`tool=${s.tool}`);
        if (s.reasoning) parts.push(`reasoning=${s.reasoning.substring(0, 180)}`);
        if (s.result) parts.push(`result=${JSON.stringify(s.result).substring(0, 180)}`);
        return parts.join("; ");
      })
      .join("\n");
  }

  /**
   * DAG Pipeline mode: execute DAG phases sequentially with role-specific agents.
   * Each phase runs as an independent completeWithTools call with role-tuned prompts.
   */
  private async runDagPipeline(
    input: TaskInput,
    intent: import("../tasks/task-intent.js").TaskIntent,
    plannerModel: string,
    executorModel: string,
    criticModel: string,
    taskId: string,
    emit: (type: string, payload?: unknown) => void
  ): Promise<TaskResult> {
    const dag = buildExecutionDAG(intent);
    const sorted = topologicalSort(dag);
    const allSteps: ExecutionStep[] = [];
    let accumulatedContext = `Project goal: ${input.goal}`;

    for (let i = 0; i < sorted.length; i++) {
      const node = sorted[i]!;
      const role = phaseToRole(node.phase);
      emit("phase", { phase: `dag.${node.phase}`, label: `${node.label} (${role})`, nodeId: node.id, role });
      console.log(`[DAG-Pipeline] Phase ${i + 1}/${sorted.length}: ${node.phase} [${role}] — ${node.label}`);

      const phasePrompt = [
        `You are the **${role}** agent. Your role is "${node.phase}".`,
        `Task: ${node.description}`,
        node.promptDirectives.length > 0 ? `Directives:\n${node.promptDirectives.map(d => `- ${d}`).join("\n")}` : "",
        `Output: ${node.outputKind}`,
        "",
        `## Full Project Goal`,
        input.goal,
        "",
        accumulatedContext ? `## Context from Previous Phases\n${accumulatedContext}` : "",
        "",
        `Focus ONLY on your phase: ${node.label}. Do not try to do other phases' work.`,
        `Produce a concrete ${node.outputKind} deliverable.`,
      ].filter(Boolean).join("\n");

      const phaseMessages: { role: string; content: string }[] = [
        { role: "user", content: phasePrompt }
      ];

      // Filter tools to those preferred for this phase
      const phaseTools = node.preferredTools.length > 0
        ? this.buildToolDefinitions(node.preferredTools)
        : this.buildToolDefinitions();

      try {
        const phaseResult = await this.completeWithTools(
          executorModel,
          phaseMessages,
          phaseTools,
          { taskId, taskLineageId: input.taskLineageId ?? taskId, goal: input.goal, step: { value: allSteps.length } }
        );

        // completeWithTools returns { planText, executedTools, toolSteps, history }
        const phaseSummary = phaseResult.planText || `Phase ${node.phase} completed`;
        accumulatedContext += `\n\n## Phase: ${node.phase} (${node.label})\n${phaseSummary}`;
        allSteps.push({ step: allSteps.length + 1, action: `[${node.phase}] ${node.label}`, tool: role, result: phaseSummary, reasoning: `Phase executed by ${role} agent` });
        allSteps.push(...phaseResult.toolSteps);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[DAG-Pipeline] Phase ${node.phase} failed: ${msg}`);
        accumulatedContext += `\n\n## Phase: ${node.phase} (FAILED)\nError: ${msg}`;
        allSteps.push({ step: allSteps.length + 1, action: `[${node.phase}] ${node.label}`, tool: role, result: `Failed: ${msg}`, reasoning: `Phase failed: ${msg}` });
        // Continue with remaining phases
      }
    }

    // Final verification
    const finalSummary = await this.completeWithModel(criticModel, [
      { role: "user", content: `You are the reviewer. Summarize the project results:\n\n${accumulatedContext}\n\nProvide a concise final summary of what was accomplished and any issues.` }
    ]);

    return {
      taskId,
      success: true,
      summary: finalSummary || accumulatedContext,
      steps: allSteps,
    };
  }

  /**
   * Master-Worker mode: Coordinator decomposes, dispatches subgoals to workers, aggregates.
   */
  private async runMasterWorker(
    input: TaskInput,
    intent: import("../tasks/task-intent.js").TaskIntent,
    plannerModel: string,
    executorModel: string,
    taskId: string,
    emit: (type: string, payload?: unknown) => void
  ): Promise<TaskResult> {
    const orchestrator = new MasterWorkerOrchestrator({
      strategicPlanner: async (prompt) => {
        const resp = await this._timedComplete({ model: plannerModel, messages: [{ role: "user", content: prompt }] });
        this._emitUsage(resp.usage);
        return resp.content;
      },
      subgoalExecutor: async (params) => {
        emit("phase", { phase: "subgoal.execute", label: params.goal.slice(0, 100), role: params.assignedRole });
        const ctResult = await this.completeWithTools(
          executorModel,
          [{ role: "user", content: params.goal }],
          this.buildToolDefinitions(),
          { taskId, taskLineageId: input.taskLineageId ?? taskId, goal: input.goal, step: { value: 0 } }
        );
        return {
          taskId,
          success: true,
          summary: ctResult.planText || "",
          steps: ctResult.toolSteps,
        };
      },
      aggregator: async (goal, results) => {
        const resultList = results.map(r =>
          `- [${r.role}] ${r.description}: ${r.success ? "OK" : "FAILED"} — ${r.summary.slice(0, 200)}`
        ).join("\n");
        const summary = `# ${goal}\n\n## Sub-task Results\n${resultList}`;
        emit("phase", { phase: "project.aggregate", label: "Aggregating results" });
        return summary;
      },
    });

    const result = await orchestrator.execute(input.goal, input.projectContext ?? "", taskId);

    const allSteps: ExecutionStep[] = result.subTasks.map((st, i) => ({
      step: i + 1,
      action: st.description,
      tool: st.role,
      result: st.summary,
      reasoning: st.error,
    }));

    return {
      taskId,
      success: result.success,
      summary: result.summary,
      steps: allSteps,
    };
  }

  /**
   * Simple-task fast path: one LLM call, no heavy pipeline.
   * For weather queries, general chat, simple lookups — tasks that need
   * a direct answer rather than a multi-cycle planning workflow.
   */
  private async runSimpleTask(input: TaskInput, intent: import("../tasks/task-intent.js").TaskIntent): Promise<TaskResult> {
    const taskId = input.taskId ?? randomUUID();
    this._currentTaskId = taskId;
    this.deps.logger?.info("simple task started", { taskId, goal: input.goal.slice(0, 120), taskType: intent.taskType });
    console.log(`[RUNTIME] Simple task: ${input.goal.slice(0, 80)}`);

    const steps: ExecutionStep[] = [];
    let stepCounter = 1;
    const emit = (type: string, payload?: unknown) =>
      this.deps.progress?.emit(taskId, { type, payload: payload as object, at: new Date().toISOString() });

    emit("task.started", { taskType: intent.taskType, complexity: "simple" });

    try {
      const messages = [
        { role: "system", content: currentDateTimeContext() + "\n\n" + MINIMAL_SYSTEM_PROMPT },
        { role: "user", content: `你现在的身份：${intent.persona.name}。专业领域：${intent.persona.expertise}。沟通风格：${intent.persona.tone}\n\n${input.goal}` }
      ];

      const tools = this.buildToolDefinitions(intent.preferredTools)
        .filter(t => t.name !== "task.planner");

      const stepRef = { value: stepCounter };
      const { planText, executedTools, toolSteps, history } = await this.completeWithTools(
        input.modelOverrides?.plannerModel ?? this.deps.plannerModel,
        messages, tools,
        { taskId, taskLineageId: input.taskLineageId ?? taskId, goal: input.goal, step: stepRef },
        undefined, // no prior history
        3 // max 3 tool calls for simple tasks
      );

      stepCounter = stepRef.value;
      steps.push({ step: stepCounter++, action: "plan", reasoning: planText });
      for (const ts of toolSteps) steps.push(ts);

      // If model only made tool calls without text synthesis, do one final completion
      let finalSummary = planText.trim();
      if (executedTools > 0 && (!finalSummary || finalSummary.length < 20)) {
        try {
          // Build context from tool results
          const toolCtxLines: string[] = [];
          for (const ts of toolSteps) {
            if (ts.action === "execute" && ts.tool) {
              const resultStr = typeof ts.result === "string" ? ts.result : JSON.stringify(ts.result);
              const short = resultStr.length > 800 ? resultStr.slice(0, 800) + "..." : resultStr;
              toolCtxLines.push(`[${ts.tool}]: ${short}`);
            }
          }
          const toolContext = toolCtxLines.join("\n");
          const synthMessages = [
            { role: "user", content: `你是一个助手。请基于以下工具执行结果，用中文简洁地总结回答用户的问题。

用户问题：${input.goal}

工具执行结果：
${toolContext}

请直接输出2-4句话的中文总结。只输出总结文字，不要有任何标记或格式。` }
          ];
          const synthText = await this.completeWithModel(
            input.modelOverrides?.plannerModel ?? this.deps.plannerModel,
            synthMessages
          );
          // Filter out any tool-call markup that the model might leak
          const cleaned = synthText?.replace(/<[^>]+>/g, "").replace(/DSML|dsml|invoke|function_calls/gi, "").trim();
          finalSummary = cleaned || finalSummary;
          steps.push({ step: stepCounter++, action: "synthesize", reasoning: finalSummary });
        } catch (err) {
          console.warn("[RUNTIME] Best-effort synthesis failed: " + (err instanceof Error ? err.message : String(err)));
        }
      }

      // If model wrote a file, note it
      const wroteFile = toolSteps.some(s => s.tool === "fs.write_file");
      if (wroteFile) {
        steps.push({ step: stepCounter++, action: "done", reasoning: "Deliverable written" });
      }

      const result: TaskResult = {
        taskId,
        success: true,
        summary: finalSummary.slice(0, 500) || input.goal,
        steps
      };

      this._currentTaskId = null;
      emit("task.completed", { result });
      this.deps.logger?.info("simple task completed", { taskId, steps: steps.length });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[RUNTIME] Simple task failed: ${msg}`);
      steps.push({ step: stepCounter++, action: "error", reasoning: msg });
      const result: TaskResult = { taskId, success: false, summary: msg, steps };
      this._currentTaskId = null;
      emit("task.failed", { result });
      return result;
    }
  }

  async runTask(input: TaskInput): Promise<TaskResult> {
    const taskId = input.taskId ?? randomUUID();
    this._currentTaskId = taskId;
    this.thoughtTree = null;
    this.thoughtTreeNode = null;
    const plannerModel = input.modelOverrides?.plannerModel ?? this.deps.plannerModel;
    const executorModel = input.modelOverrides?.executorModel ?? this.deps.executorModel;
    const criticModel = input.modelOverrides?.criticModel ?? this.deps.criticModel;
    const taskStartTime = Date.now();

    // StrategyEvaluator: create comparison before first attempt so both
    // "default" and "retry" variants accumulate runs and isConfident() works.
    let strategyComparisonId: string | null = null;
    let strategyVariantId = "default";
    if (this.deps.strategyEvaluator) {
      try {
        const comparison = this.deps.strategyEvaluator.createComparison(input.goal, [
          { id: "default", label: "Default Strategy", model: plannerModel, description: `Planner: ${plannerModel}, Executor: ${executorModel}, Critic: ${criticModel}` },
          { id: "retry", label: "Retry Strategy (Phase 1)", model: plannerModel, description: `Same models, targeted repair with gap analysis` },
        ]);
        strategyComparisonId = comparison.comparisonId;
      } catch (err) {
        console.warn(`[RUNTIME] StrategyEvaluator comparison creation failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.deps.logger?.info("task started", { taskId, goal: input.goal.slice(0, 120), taskType: input.taskType });
    console.log(`[RUNTIME] modelOverrides=${JSON.stringify(input.modelOverrides)}, deps.planner=${this.deps.plannerModel}, resolved planner=${plannerModel}`);

    // SmartEscalation: track task start for timeout/failure detection
    this.deps.smartEscalation?.trackTaskStart(taskId);

    // State machine: new or resume from disk
    let sm = new AgentStateMachine(taskId, input.goal, input.taskLineageId ?? taskId);
    const savedMachine = await AgentStateMachine.loadFromDisk(taskId);
    let resumeGoal: string | null = null;
    if (savedMachine) {
      sm = savedMachine;
      console.log(`[RUNTIME] Resuming task ${taskId} from saved state: ${sm.getState()}`);
      this.deps.progress?.emit(taskId, {
        type: "task.resumed",
        payload: { state: sm.getState(), savedAt: savedMachine.serialize().savedAt },
        at: new Date().toISOString()
      });
      // Enrich resume with checkpoint context (completed tools, errors, progress)
      if (this.deps.checkpointManager) {
        resumeGoal = await this.deps.checkpointManager.buildResumeGoal(taskId);
        if (resumeGoal) {
          console.log(`[RUNTIME] Built checkpoint resume context for task ${taskId}`);
        }
      }
    }

    const emit = (type: string, payload?: unknown) =>
      this.deps.progress?.emit(taskId, { type, payload: payload as object, at: new Date().toISOString() });

    const intent = resolveTaskIntent(input);

    // Simple tasks: direct response, skip the heavy planning pipeline.
    // Use full pipeline when the task needs pause support, is a resume, or has
    // a tight maxSteps limit that requires cycle-level enforcement + auto-compile.
    const tightMaxSteps = this.deps.maxSteps <= 8;
    const needsFullPipeline = input.checkPause || savedMachine || tightMaxSteps;
    if (intent.complexity === "simple" && !needsFullPipeline) {
      return this.runSimpleTask(input, intent);
    }

    // ── Mode detection: task (single agent) vs project (multi-agent pipeline) ──
    const modeTrigger = input.modeTrigger ?? "auto";
    const executionMode = input.executionMode ??
      (modeTrigger === "manual" ? "task" : detectExecutionMode(input.goal, input.taskType).executionMode);
    const collaborationMode = input.collaborationMode ?? "dag-pipeline";

    if (executionMode === "project") {
      this.deps.logger?.info("project mode", { taskId, collaborationMode, goal: input.goal.slice(0, 120) });
      console.log(`[RUNTIME] Project mode: ${collaborationMode}, goal=${input.goal.slice(0, 100)}`);
      emit("phase", { phase: "project.init", label: `Project mode: ${collaborationMode}` });

      try {
        if (collaborationMode === "dag-pipeline") {
          return await this.runDagPipeline(input, intent, plannerModel, executorModel, criticModel, taskId, emit);
        } else {
          return await this.runMasterWorker(input, intent, plannerModel, executorModel, taskId, emit);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.deps.logger?.error("project mode failed", { taskId, error: msg });
        // Fall through to standard mode if project mode fails
        console.warn(`[RUNTIME] Project mode failed, falling back to standard mode: ${msg}`);
        emit("phase", { phase: "project.fallback", label: `Project mode failed, falling back: ${msg}` });
      }
    }

    // Initialize thought-tree for cross-cycle MCTS learning
    if (this.deps.thoughtTreeEnabled) {
      this.thoughtTree = new ThoughtTreePlanner({ numBranches: 3, maxDepth: 4, maxNodes: 50 });
      this.thoughtTree.initTree(input.goal);
      this.thoughtTreeNode = this.thoughtTree.getState()!.root;
    }

    // Complex tasks: use HierarchicalPlanner to decompose goal into subgoal tree,
    // then execute subgoals via delegation to worker agents (company model).
    let hierarchicalPlan: string | null = null;
    let subgoalExecutionSummary: string | null = null;
    if (intent.complexity === "complex") {
      try {
        const hp = new HierarchicalPlanner({
          strategicPlanner: async (prompt: string) => {
            const resp = await this._timedComplete({ model: plannerModel, messages: [{ role: "user", content: prompt }] });
            this._emitUsage(resp.usage);
            return resp.content;
          },
          subgoalExecutor: this.deps.subgoalExecutor || (async (goal: string) => {
            console.warn(`[RUNTIME] No subgoalExecutor configured; subgoal "${goal.slice(0, 80)}" will always fail`);
            return { subgoalId: "", success: false, output: "No subgoal executor configured" };
          }),
          maxRetries: 1,
        });
        const decomposition = await hp.decompose(input.goal, input.projectContext);
        if (decomposition.subgoals.length > 0) {
          // Build subgoal plan text for the coordinator LLM prompt
          const subgoalLines = decomposition.subgoals.map((sg, i) => {
            const icon = sg.children.length > 0 ? "📁" : "📋";
            return `${i + 1}. ${icon} ${sg.description}`;
          });
          hierarchicalPlan = [
            "## 🎯 层次化任务分解 (Hierarchical Plan)",
            `将主任务拆分为 ${decomposition.subgoals.length} 个子目标，按顺序执行：`,
            ...subgoalLines,
            "",
            "按子目标顺序逐一完成。每个子目标产出阶段性成果后再进入下一个。",
            decomposition.reasoning ? `\n规划理由: ${decomposition.reasoning.slice(0, 300)}` : "",
          ].join("\n");
          console.log(`[RUNTIME] HierarchicalPlanner decomposed into ${decomposition.subgoals.length} subgoals`);

          // Execute subgoals via delegation to worker agents (real multi-agent delegation)
          if (this.deps.subgoalExecutor) {
            try {
              emit("phase", { phase: "subgoal.execution", label: `Delegating ${decomposition.subgoals.length} subgoals to worker agents` });
              const executedSubgoals = await hp.execute(decomposition.subgoals, taskId, (sg) => {
                this.deps.progress?.emit(taskId, {
                  type: "subgoal.progress",
                  payload: { subgoalId: sg.id, description: sg.description, status: sg.status },
                  at: new Date().toISOString()
                });
              });
              subgoalExecutionSummary = hp.aggregate(executedSubgoals);
              console.log(`[RUNTIME] Subgoal execution complete: ${executedSubgoals.filter(s => s.status === "done").length}/${executedSubgoals.length} done`);
            } catch (execErr) {
              console.warn(`[RUNTIME] Subgoal execution error (non-fatal): ${execErr instanceof Error ? execErr.message : String(execErr)}`);
              subgoalExecutionSummary = `## ⚠️ 子目标执行出错\n${execErr instanceof Error ? execErr.message : String(execErr)}`;
            }
          }
        }
      } catch (err) {
        const hpErrMsg = err instanceof Error ? err.message : String(err);
        console.warn(`[RUNTIME] HierarchicalPlanner decomposition failed, falling back to standard plan: ${hpErrMsg}`);
        emit("phase", { phase: "planner.fallback", label: `Hierarchical planner failed, using flat plan: ${hpErrMsg}` });
        hierarchicalPlan = `## ⚠️ 层次化规划失败，降级为标准规划\n错误: ${hpErrMsg}\n\n请使用标准执行策略继续推进。`;
      }
    }

    // ── StrategyEvaluator: use historical best variant to influence DAG ──
    let strategyRec: { variantId: string; label: string; description: string } | null = null;
    if (this.deps.strategyEvaluator) {
      try {
        const comparisons = this.deps.strategyEvaluator.listComparisons();
        const relevant = comparisons.filter(c =>
          c.goal.includes(intent.taskType) || c.goal.includes(intent.outputFormat)
        );
        if (relevant.length > 0) {
          const lastComp = relevant[relevant.length - 1]!;
          if (this.deps.strategyEvaluator.isConfident(lastComp.comparisonId)) {
            const best = this.deps.strategyEvaluator.getBestVariant(lastComp.comparisonId);
            if (best) {
              strategyRec = { variantId: best.variantId, label: best.label, description: `Best strategy for ${intent.taskType}: ${best.label} (success=${(best.successRate*100).toFixed(0)}%, quality=${best.avgQualityScore.toFixed(2)})` };
            }
          }
        }
      } catch (err) { console.warn("[RUNTIME] Non-critical operation failed: " + (err instanceof Error ? err.message : String(err))); }
    }

    const dag = buildExecutionDAG(intent);
    const dagPhases = topologicalSort(dag);
    const dagGuidance = dagPhases.length > 0
      ? ["## 执行策略 DAG（按拓扑序执行）",
         ...dagPhases.map((n, i) => {
           const marker = dag.roots.includes(n.id) ? "▶ 入口" : dag.leaves.includes(n.id) ? "🏁 终端" : "";
           const deps = n.dependsOn.length > 0 ? ` [依赖: ${n.dependsOn.join(", ")}]` : "";
           const tools = n.preferredTools.length > 0 ? ` | 推荐工具: ${n.preferredTools.join(", ")}` : "";
           const directives = n.promptDirectives.length > 0 ? `\n    指令: ${n.promptDirectives.map(d => `「${d}」`).join("; ")}` : "";
           return `${i + 1}. [${n.phase}] ${n.label}${deps}${tools}${directives} ${marker}`.trim();
         }),
         ...(strategyRec ? [`\n📊 策略推荐: ${strategyRec.description}`, ""] : []),
         "", "按顺序推进，每个阶段完成后再进入下一个依赖项就绪的阶段。",
         ""]
      : [];
    // DAG 程序化约束 — 追踪每个节点的完成状态
    const dagCompletion = new Map<string, boolean>();
    for (const node of dag.nodes) {
      dagCompletion.set(node.id, false);
    }
    // Skip DAG enforcement for simple tasks (general chat, weather, etc.)
    const dagEnforce = intent.taskType !== "general" && intent.taskType !== "weather" && intent.outputFormat !== "chat";

    // Emit DAG to the frontend so it can render the strategy in the context panel
    emit("dag", {
      taskType: dag.taskType,
      outputFormat: dag.outputFormat,
      nodes: dag.nodes.map(n => ({ id: n.id, phase: n.phase, label: n.label, description: n.description, dependsOn: n.dependsOn, optional: n.optional, outputKind: n.outputKind })),
      roots: dag.roots,
      leaves: dag.leaves,
      strategyRecommendation: strategyRec,
    });

    const capabilityPlan = buildCapabilityRoutePlan({
      goal: input.goal,
      intent,
      availableTools: this.deps.tools.list().filter(t => t.available !== false).map((t) => t.id),
      skills: this.deps.skills.list() as LoadedSkill[],
    });

    // ── MCP Auto-Completion: programmatically fill capability gaps ────
    // When missing tools are detected, search MCP and auto-install instead of
    // relying on the LLM to do it via text suggestions alone.
    let mcpAutoFillLog = "";
    if (capabilityPlan.missingTools.length > 0) {
      try {
        const installedTools: string[] = [];
        const failedTools: string[] = [];
        const MAX_AUTO_INSTALL = 5;
        for (const missingTool of capabilityPlan.missingTools.slice(0, MAX_AUTO_INSTALL)) {
          try {
            const searchResult = await this.deps.tools.execute("mcp.search", {
              query: missingTool
            }, { now: new Date(), taskId, taskLineageId: input.taskLineageId ?? taskId, goal: input.goal });
            const results = (searchResult as any)?.results;
            if (results && results.length > 0) {
              const best = results[0];
              console.log(`[MCP-AUTO] Found ${best.packageName} for "${missingTool}", installing...`);
              const installResult = await this.deps.tools.execute("mcp.install", {
                packageName: best.packageName
              }, { now: new Date(), taskId, taskLineageId: input.taskLineageId ?? taskId, goal: input.goal });
              if ((installResult as any)?.success) {
                const toolList = (installResult as any).installedTools?.join(", ") || "installed";
                installedTools.push(`${best.packageName} → ${toolList}`);
              } else {
                failedTools.push(`${missingTool}: ${(installResult as any)?.error || "install failed"}`);
              }
            } else {
              failedTools.push(`${missingTool}: no MCP results`);
            }
          } catch (e) {
            failedTools.push(`${missingTool}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (installedTools.length > 0 || failedTools.length > 0) {
          if (installedTools.length > 0) {
            // Rebuild capability plan so new tools show as matched
            const refreshedTools = this.deps.tools.list().filter(t => t.available !== false).map(t => t.id);
            const updatedPlan = buildCapabilityRoutePlan({
              goal: input.goal, intent,
              availableTools: refreshedTools,
              skills: this.deps.skills.list() as LoadedSkill[],
            });
            capabilityPlan.matchedTools = updatedPlan.matchedTools;
            capabilityPlan.missingTools = updatedPlan.missingTools;
            mcpAutoFillLog = `## 🔧 MCP 自动补全\n已自动安装: ${installedTools.join("; ")}\n`;
            if (failedTools.length > 0) mcpAutoFillLog += `未能安装: ${failedTools.join("; ")}\n`;
            console.log(`[MCP-AUTO] Auto-installed ${installedTools.length} MCP server(s), ${failedTools.length} failed`);
          }
        }
      } catch (err) {
        console.warn(`[MCP-AUTO] Auto-fill error (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const skillInstructions = capabilityPlan.matchedSkills
      .map((skill) => this.deps.skills.get(skill.name)?.instructions)
      .filter(Boolean)
      .join("\n\n---\n\n");

    const attachmentContext =
      (input.attachments ?? []).length
        ? (input.attachments ?? [])
            .map((item, index) => `#${index + 1} ${item.kind} ${item.name} (${item.mimeType}, ${item.size} bytes) path=${item.path}`)
            .join("\n")
        : "No attachments.";

    const records = await this.deps.experiences.list();

    // Enhanced strategy suggestions with evolved skills, pitfalls, and tools
    const evolvedSkills = this.deps.selfEvolver?.getMatureSkills().map(s => ({
      name: s.name,
      description: s.description,
      triggers: s.triggers,
      successCount: s.successCount
    })) || [];

    const enhancedSuggestions = this.deps.advisor.suggestEnhanced({
      goal: input.goal,
      taskType: intent.taskType,
      availableTools: this.deps.tools.list().filter(t => t.available !== false).map(t => t.id),
      evolvedSkills
    }, records) as Array<{ type: string; priority: number; content: string; source: string }>;

    const suggestions = this.deps.advisor.suggest(input.goal, records);

    // L2/L4: Enrich context with task memory and semantic memory
    let layeredMemoryContext = "";
    if (this.deps.taskMemory) {
      const taskCtx = await this.deps.taskMemory.getRelevantContext(input.goal, 3);
      if (taskCtx) layeredMemoryContext += taskCtx + "\n\n";
    }
    if (this.deps.semanticMemory) {
      const semCtx = await this.deps.semanticMemory.getRelevantContext(input.goal, 3);
      if (semCtx) layeredMemoryContext += semCtx + "\n\n";
    }
    // L5: RAG knowledge base context from workspace files
    if (this.deps.knowledgeBase) {
      try {
        const kbCtx = await this.deps.knowledgeBase.getContextString(input.goal, 5, 1500);
        if (kbCtx) layeredMemoryContext += kbCtx + "\n\n";
      } catch { console.warn("[RUNTIME] KB unavailable — not critical"); }
    }

    // Add evolved skill suggestions and pitfalls to layered memory context
    if (enhancedSuggestions.length > 0) {
      const skillTips = enhancedSuggestions
        .filter(s => s.type === "evolved_skill" || s.type === "pitfall_warning")
        .map(s => `- [${s.type}] ${s.content}`)
        .join("\n");
      if (skillTips) {
        layeredMemoryContext += `## Evolved Strategies & Warnings\n\n${skillTips}\n\n`;
      }
    }

    // Inject failure avoidance patterns from past failures
    const failurePatterns = this.deps.selfEvolver?.getFailurePatterns() || [];
    if (failurePatterns.length > 0) {
      const fpLines = failurePatterns
        .slice(0, 3)
        .map(fp => `### ${fp.name}\n${fp.description}\n${fp.instructions.substring(0, 500)}`)
        .join("\n\n");
      if (fpLines) {
        layeredMemoryContext += `## ⚠️ Failure Avoidance Patterns (learned from past mistakes)\n\n${fpLines}\n\n`;
      }
    }

    // Inject SelfImprover improvement suggestions from benchmarks
    if (this.deps.selfImprover) {
      try {
        const impSuggestions = this.deps.selfImprover.getImprovementSuggestions();
        if (impSuggestions.length > 0) {
          layeredMemoryContext += `## 📈 Benchmark Improvement Suggestions\n\n${impSuggestions.slice(0, 3).map(s => `- ${s}`).join("\n")}\n\n`;
        }
      } catch (err) { console.warn("[RUNTIME] Non-critical operation failed: " + (err instanceof Error ? err.message : String(err))); }
    }

    // Inject DomainLearner insights for domain-specific tasks
    try {
      const domainInsights = this.deps.domainEngine.getInsights(intent.taskType, input.goal);
      if (domainInsights) {
        layeredMemoryContext += `## 📚 Domain Insights (from past domain tasks)\n\n${domainInsights}\n\n`;
      }
    } catch (err) { console.warn("[RUNTIME] Non-critical op failed: " + (err instanceof Error ? err.message : String(err))); }

    // Read state from machine context into local mutable refs
    const ctx = sm.getContext() as any; // writable internally
    const steps: ExecutionStep[] = ctx.steps;
    let stepCounter = ctx.stepCounter;
    let doneReason = ctx.doneReason;
    let executedAnyTool = ctx.executedAnyTool;
    let taskPlannerUsed = ctx.taskPlannerUsed;
    const observationNotes: string[] = ctx.observationNotes;
    let consecutiveSearchCycles = ctx.consecutiveSearchCycles;
    let consecutiveSameToolCycles = ctx.consecutiveSameToolCycles;
    let previousCycleToolSet = ctx.previousCycleToolSet;
    let searchLockedOut = ctx.searchLockedOut;
    let calledDomainTools: Set<string>;

    // Sync helper: flush local state into machine context
    const syncContext = () => sm.updateContext({
      stepCounter, doneReason, executedAnyTool, taskPlannerUsed,
      consecutiveSearchCycles, consecutiveSameToolCycles, previousCycleToolSet, searchLockedOut,
      observationNotes: [...observationNotes],
    });

    // Auto-checkpoint: save task state periodically for crash recovery
    let lastCheckpointStep = 0;
    const saveCheckpoint = async () => {
      if (!this.deps.checkpointManager) return;
      if (stepCounter - lastCheckpointStep < 3) return; // throttle: every 3+ new steps
      lastCheckpointStep = stepCounter;
      syncContext();
      await sm.saveToDisk().catch(() => {});
      const currentCycle = sm.getContext().cycle || 0;
      await this.deps.checkpointManager.save({
        taskId,
        cycle: currentCycle,
        stepCounter,
        steps: [...steps],
        state: sm.getState(),
        goal: input.goal,
        taskType: input.taskType,
        outputFormat: input.outputFormat,
        context: { doneReason, observationNotes: observationNotes.slice(-10), cycle: currentCycle },
      }).catch(() => {});
    };

    // On resume: restore domain tools guard from steps
    if (savedMachine) {
      calledDomainTools = new Set(
        steps.filter(s => s.action === "execute" && s.tool?.startsWith("domain.")).map(s => s.tool!)
      );
    } else {
      calledDomainTools = new Set();
    }

    const emitPhase = (phase: string, label: string, extra?: object) => emit("phase", { phase, label, ...extra });

    // Deep reasoning for non-trivial domain tasks (think before act)
    if (intent.taskType !== "general" && intent.taskType !== "weather" && intent.outputFormat !== "chat" && this.deps.domainEngine.think) {
      try {
        emitPhase("think", "Running deep reasoning loop (DomainLearner.think)");
        const deepThoughts = await this.deps.domainEngine.think(intent.taskType, input.goal);
        if (deepThoughts) {
          layeredMemoryContext += deepThoughts;
        }
      } catch (err) { console.warn("[RUNTIME] Deep reasoning failed: " + (err instanceof Error ? err.message : String(err))); }
    }

    // Initialize progress detector (Phase 3)
    const progressDetector = this.deps.progressDetector ?? new ProgressDetector({
      emit,
      maxCycles: this.deps.maxPlanningCycles,
    });
    progressDetector.reset();

    // Transition to classify
    if (!savedMachine || sm.getState() === "idle") {
      sm.toClassify();
    }
    sm.updateContext({ capabilityPlan: capabilityPlan as any });

    emit("state.change", { state: sm.getState(), taskId });
    emitPhase("classify", `Routed to ${intent.taskType}`, {
      taskType: intent.taskType,
      outputFormat: intent.outputFormat,
      workflowLabel: intent.workflowLabel,
      deliveryKind: intent.delivery.kind,
      resultLabel: intent.delivery.resultLabel,
      matchedTools: capabilityPlan.matchedTools,
      matchedSkills: capabilityPlan.matchedSkills.map((s) => s.name),
      missingCapabilities: capabilityPlan.missingCapabilities
    });

    const classifyStep: ExecutionStep = {
      step: stepCounter++,
      action: "classify",
      reasoning: [
        `Workflow: ${intent.workflowLabel}`,
        `Task type: ${intent.taskType}`,
        `Output format: ${intent.outputFormat}`,
        `Delivery kind: ${intent.delivery.kind}`,
        `Final result: ${intent.delivery.resultLabel}`,
        `Reason: ${intent.routingReason}`,
        `Deliverables: ${intent.deliverables.join("; ")}`,
        `Completion: ${intent.delivery.completionDefinition}`,
        `Matched tools: ${capabilityPlan.matchedTools.join(", ") || "none"}`,
        `Matched skills: ${capabilityPlan.matchedSkills.map((s) => s.name).join(", ") || "none"}`,
        `Missing capabilities: ${capabilityPlan.missingCapabilities.join("; ") || "none"}`
      ].join("\n")
    };
    steps.push(classifyStep);
    this.deps.audit.append(taskId, classifyStep);

    // ── Retry loop with phased degradation (1.3) + targeted repair (2.1) ──
    // Phase 0: Normal execution
    // Phase 1: Targeted repair with critic analysis
    // Phase 2: MCP search for missing tools → install → retry
    // Phase 3: Delegate to sub-agent
    // Phase 4: Graceful failure with actionable suggestions
    const DEGRADATION_PHASES = 5;
    let verification: VerificationResult = { success: false, reason: "", score: 0 };
    let result: TaskResult = { taskId, success: false, summary: "", steps: [] };
    let wasPaused = false;
    let outputContent = "";
    let failureAvoidancePatterns: string[] = [];
    let previousGaps: string[] = []; // Track gaps across retries for escalation

    for (let retryCount = 0; retryCount < DEGRADATION_PHASES; retryCount++) {
      let contextHistory: { role: string; content: string; tool_call_id?: string; name?: string }[] = [];
      if (retryCount > 0) {
        const phase = retryCount;

        // ── StrategyEvaluator: switch to retry variant on first retry ──
        if (retryCount === 1) {
          strategyVariantId = "retry";
        }

        // —— Noise reduction (M4): summarize previous attempt for clean context ——
        const prevExecSteps = steps.filter(s => s.action === "execute" && s.tool);
        const prevErrors = steps.filter(s => s.action === "error");
        const prevTools = [...new Set(prevExecSteps.map(s => s.tool))];
        observationNotes.push(
          `\n## ═══ 上一次尝试总结（第${retryCount}次）═══\n` +
          `执行步骤: ${prevExecSteps.length} | 错误: ${prevErrors.length} | 工具: ${prevTools.join(", ") || "无"}\n` +
          `验证结果: ${verification.success ? "通过" : "失败"} — ${verification.reason}\n` +
          (verification.gaps?.length ? `待修复: ${verification.gaps.join("; ")}\n` : "") +
          `══════════════════════════════════════`
        );

        // ── Self-evolution: synchronously learn from failure (2.2) ──
        if (this.deps.selfEvolver && retryCount < DEGRADATION_PHASES - 1) {
          try {
            const failToolSeq = steps
              .filter(s => s.action === "execute" && s.tool)
              .map(s => s.tool as string);
            if (failToolSeq.length >= 2) {
              const failEvoResult = await this.deps.selfEvolver.evolveFromFailure({
                goal: input.goal,
                taskType: intent.taskType,
                steps,
                toolSequence: failToolSeq,
                success: false,
                summary: verification.reason || result.summary
              });
              if (failEvoResult.skill && !failEvoResult.skipped) {
                failureAvoidancePatterns.push(
                  `[Learned from failure] ${failEvoResult.skill.name}: ${failEvoResult.skill.description}\nAvoid: ${failEvoResult.skill.triggers?.join(", ") || "same approach"}`
                );
                emit("skill.evolved", {
                  skillName: failEvoResult.skill.name,
                  description: failEvoResult.skill.description,
                  triggers: failEvoResult.skill.triggers
                });
                try { await this.deps.skills.loadFromDirectory("./.agent/skills"); } catch (err) { console.warn("[RUNTIME] Skill directory reload failed: " + (err instanceof Error ? err.message : String(err))); }
              }
            }
          } catch (e: any) {
            console.log(`[RUNTIME] Failure evolution during retry skipped: ${e.message}`);
          }
        }

        if (phase === 1) {
          // Phase 1: Targeted repair — extract gaps, keep previous steps, inject critic analysis
          const gaps = verification.gaps || [];
          // Detect repeated gaps (same issues as last retry → escalate)
          const repeatedGaps = previousGaps.length > 0
            ? gaps.filter(g => previousGaps.some(p => p === g || g.includes(p) || p.includes(g)))
            : [];
          const isRepeated = repeatedGaps.length > 0 && repeatedGaps.length >= Math.min(gaps.length, previousGaps.length) * 0.5;
          const escalationNote = isRepeated
            ? `\n\n## ⚠️ 重复缺陷检测 — 这些问题在第${retryCount}次尝试中仍未修复！\n${repeatedGaps.map((g: string, i: number) => `${i + 1}. 🔴 ${g}`).join("\n")}\n\n你必须在新计划中**显式处理**上述每一项。不处理就跳过将导致任务彻底失败。`
            : "";
          const targetedGuidance = gaps.length > 0
            ? `\n\n## 🎯 定向修复（第 ${phase} 阶段）\n以下具体问题需要修复，不要重做已完成的工作：\n${gaps.map((g: string, i: number) => `${i + 1}. ❌ ${g}`).join("\n")}\n\n只修复上述问题。已完成的部分保持不变。${escalationNote}`
            : `\n\n## 🎯 定向修复（第 ${phase} 阶段）\n上次验证失败: ${verification.reason}\n请采用不同的策略。只修复失败的部分，不要重做已完成的工作。${escalationNote}`;
          // Keep steps but mark them (don't reset)
          doneReason = undefined;
          wasPaused = false;
          outputContent = "";
          executedAnyTool = false;
          consecutiveSearchCycles = 0;
          consecutiveSameToolCycles = 0;
          previousCycleToolSet = new Set();
          searchLockedOut = false;
          calledDomainTools = new Set();
          contextHistory = [];
          observationNotes.push(`[Retry ${retryCount}/${DEGRADATION_PHASES - 1}] Previous attempt failed verification: ${verification.reason}${targetedGuidance}`);
          if (failureAvoidancePatterns.length > 0) {
            observationNotes.push(`## ⚠️ 失败规避模式（从上一次尝试学到）\n${failureAvoidancePatterns.join("\n")}`);
          }
          previousGaps = gaps;
        } else if (phase === 2) {
          // Phase 2: MCP search for missing tools
          const missingToolHints = verification.reason || "";
          observationNotes.push(`[Retry ${retryCount}/${DEGRADATION_PHASES - 1}] Phase 2 — searching for missing capabilities before retry. Last failure: ${verification.reason}`);
          try {
            const searchResult = await this.deps.tools.execute("mcp.search", {
              query: missingToolHints.substring(0, 200)
            }, { now: new Date(), taskId, taskLineageId: input.taskLineageId ?? taskId, goal: input.goal });
            const results = (searchResult as any)?.results;
            if (results && results.length > 0) {
              const best = results[0];
              observationNotes.push(`MCP search found: ${best.packageName}. Attempting install...`);
              const installResult = await this.deps.tools.execute("mcp.install", {
                packageName: best.packageName
              }, { now: new Date(), taskId, taskLineageId: input.taskLineageId ?? taskId, goal: input.goal });
              if ((installResult as any)?.success) {
                observationNotes.push(`✅ Installed ${best.packageName} — new tools available for this retry.`);
              } else {
                observationNotes.push(`⚠️ Failed to install ${best.packageName}: ${(installResult as any)?.error || "unknown"}`);
              }
            } else {
              observationNotes.push(`No MCP results found for capability gap. Try alternative approach.`);
            }
          } catch (e) {
            observationNotes.push(`MCP search/install error: ${e instanceof Error ? e.message : String(e)}`);
          }
          // Reset execution state for retry
          doneReason = undefined;
          wasPaused = false;
          outputContent = "";
          executedAnyTool = false;
          consecutiveSearchCycles = 0;
          consecutiveSameToolCycles = 0;
          previousCycleToolSet = new Set();
          searchLockedOut = false;
          calledDomainTools = new Set();
          contextHistory = [];
          if (failureAvoidancePatterns.length > 0) {
            observationNotes.push(`## ⚠️ 失败规避模式\n${failureAvoidancePatterns.join("\n")}`);
          }
        } else if (phase === 3) {
          // Phase 3: Delegate to sub-agent
          observationNotes.push(`[Retry ${retryCount}/${DEGRADATION_PHASES - 1}] Phase 3 — attempting delegation to sub-agent. Last failure: ${verification.reason}`);
          if (this.deps.subgoalExecutor) {
            try {
              const delegationResult = await this.deps.subgoalExecutor(
                `[DELEGATED from failed task ${taskId}] ${input.goal}`,
                taskId
              );
              if (delegationResult.success) {
                observationNotes.push(`✅ Sub-agent delegation succeeded: ${delegationResult.output.substring(0, 300)}`);
                steps.push({ step: stepCounter++, action: "execute", tool: "agent.delegate", result: delegationResult });
                doneReason = `Task completed via delegation: ${delegationResult.output.substring(0, 200)}`;
                sm.toDone(); syncContext();
                // Skip re-execution — delegation succeeded
                result = {
                  taskId,
                  success: true,
                  summary: doneReason || "Task completed via delegation",
                  content: delegationResult.output,
                  steps
                };
                this.deps.smartEscalation?.trackTaskEnd(taskId);
                return result;
              } else {
                observationNotes.push(`⚠️ Sub-agent delegation failed: ${delegationResult.output.substring(0, 200)}`);
              }
            } catch (e) {
              observationNotes.push(`Sub-agent delegation error: ${e instanceof Error ? e.message : String(e)}`);
            }
          } else {
            observationNotes.push(`No subgoal executor available for delegation.`);
          }
          // Continue with full retry
          doneReason = undefined;
          wasPaused = false;
          outputContent = "";
          executedAnyTool = false;
          consecutiveSearchCycles = 0;
          consecutiveSameToolCycles = 0;
          previousCycleToolSet = new Set();
          searchLockedOut = false;
          calledDomainTools = new Set();
          contextHistory = [];
          if (failureAvoidancePatterns.length > 0) {
            observationNotes.push(`## ⚠️ 失败规避模式\n${failureAvoidancePatterns.join("\n")}`);
          }
        } else if (phase >= 4) {
          // Phase 4: Graceful failure — don't retry, give user actionable feedback
          const triedApproaches = [
            "正常执行",
            "定向修复（critic反馈）",
            "MCP搜索并安装新工具",
            "委托子Agent"
          ].slice(0, phase);
          observationNotes.push(`## 🛑 渐进降级最终阶段`);
          observationNotes.push(`已尝试 ${triedApproaches.length} 种方法均未通过验证。不会再次重试。`);
          observationNotes.push(`尝试的方法：${triedApproaches.join(" → ")}`);
          // Don't reset — break out to return the best effort result
          break;
        }

        syncContext();
        sm.toPaused();
        emit("state.change", { state: sm.getState(), taskId });
        emitPhase("retry", `Phase ${phase}/${DEGRADATION_PHASES - 1} — ${["Normal", "Targeted repair", "MCP search+install", "Delegate", "Graceful failure"][phase] || "Unknown"}`);
      }

      // ── Main planning cycle ─────────────────────────────────────────────────
      let consecutivePlannerFailures = 0;
      for (let cycle = 1; cycle <= this.deps.maxPlanningCycles; cycle += 1) {
        // Check for cancel request before each cycle
        if (input.checkCancel) {
          const shouldCancel = await input.checkCancel().catch(() => false);
          if (shouldCancel) {
            doneReason = "Task cancelled by user";
            const cancelStep: ExecutionStep = { step: stepCounter++, action: "done", reasoning: doneReason };
            steps.push(cancelStep);
            this.deps.audit.append(taskId, cancelStep);
            sm.toDone(); syncContext();
            emit("task.cancelled", { reason: doneReason, cycle });
            break;
          }
        }
        // Check for pause request before each cycle
        if (input.checkPause) {
          const shouldPause = await input.checkPause().catch(() => false);
          if (shouldPause) {
            syncContext();
            sm.toPaused();
            await sm.saveToDisk().catch(() => {});
            emit("task.paused", { state: sm.getState(), cycle });
            wasPaused = true;
            break;
          }
        }

        // Transition to strategic_plan on each cycle
        if (sm.getState() !== "strategic_plan") {
          sm.toStrategicPlan();
          sm.updateContext({ cycle });
        }
        emit("state.change", { state: sm.getState(), cycle, taskId });

        // Global step limit — prevent infinite loops
        if (stepCounter > this.deps.maxSteps) {
          doneReason = `Max steps (${this.deps.maxSteps}) reached. Forcing completion.`;
          const limitStep: ExecutionStep = { step: stepCounter++, action: "done", reasoning: doneReason };
          steps.push(limitStep);
          this.deps.audit.append(taskId, limitStep);
          emit("task.max_steps_reached", { maxSteps: this.deps.maxSteps, stepCount: stepCounter });
          sm.toDone();
          syncContext();
          break;
        }

        const toolCatalog = this.deps.tools.list().map((t) => `- ${t.id}: ${t.description}`).join("\n");
        const memoryContext = suggestions.length > 0
          ? suggestions.map((item: unknown, idx: number) => {
              const it = item as { goal: string; success: boolean; toolSequence: string[]; summary: string };
              return `#${idx + 1} goal=${it.goal}; success=${it.success}; tools=${it.toolSequence.join("->")}; summary=${it.summary}`;
            }).join("\n")
          : "No prior similar experience.";
        const observeContext = observationNotes.length ? observationNotes.slice(-8).join("\n") : "No observations yet.";

        // ── Compile trigger: cycle-based + step-based ────────────────────────
        const compileThreshold = Math.floor(this.deps.maxSteps * 0.5);
        const urgentThreshold = Math.floor(this.deps.maxSteps * 0.75);
        const cycleCompileThreshold = Math.floor(this.deps.maxPlanningCycles * 0.5);
        const hasWrittenFile = steps.some(s => s.action === "execute" && s.tool === "fs.write_file");
        let compileNudge = "";
        if (!hasWrittenFile) {
          const remaining = this.deps.maxSteps - stepCounter;
          const shouldCompile = stepCounter >= compileThreshold || cycle >= cycleCompileThreshold;
          if (shouldCompile) {
            if (stepCounter >= urgentThreshold || cycle >= this.deps.maxPlanningCycles - 1) {
              compileNudge = `\n\n## 🛑 紧急：立刻写文件\n\n还剩 ${remaining} 步，你已经在第 ${cycle}/${this.deps.maxPlanningCycles} 个规划周期。搜索只是手段，写文件才是目的。现在调用 fs.write_file 产出交付物。`;
            } else {
              compileNudge = `\n\n## ⚠️ 阶段二：开始编译\n\n你已完成研究阶段（第 ${cycle}/${this.deps.maxPlanningCycles} 周期，${remaining} 步剩余）。停止搜索，整理已有数据，用 fs.write_file 写出报告。`;
            }
          }
        }

        emitPhase("plan", `Planning cycle ${cycle}`, { cycle, maxCycles: this.deps.maxPlanningCycles });

        // ── Phase-gate: adjust system prompt based on step budget ──────────
        let platformNote: string;
        if (process.platform === "win32") {
          platformNote = `当前运行在 Windows 系统，但 shell 为 Git Bash（类 Unix 环境）。桌面路径: /c/Users/<用户名>/Desktop 或 $USERPROFILE/Desktop。不要用 %VAR% 语法，用 $VAR 或 ~。`;
        } else {
          platformNote = process.platform === "darwin"
            ? "当前运行在 macOS 系统。shell.exec 使用 zsh/bash。"
            : "当前运行在 Linux 系统。shell.exec 使用 bash。";
        }
        const phaseSystemPrompt = (compileNudge
          ? buildSystemPrompt() + "\n\n" + platformNote + compileNudge
          : buildSystemPrompt() + "\n\n" + platformNote);

        // Build a prominent capability gaps warning if there are missing tools
        const gapWarning = (capabilityPlan.missingCapabilities.length > 0 || mcpAutoFillLog)
          ? [
              mcpAutoFillLog ? mcpAutoFillLog : "",
              capabilityPlan.missingCapabilities.length > 0 ? "## ⚠️ 能力缺口 — 你缺少以下能力，请主动用 mcp.search 寻找方案" : "",
              ...capabilityPlan.missingCapabilities.map(c => `  ❌ ${c}`),
              capabilityPlan.missingTools.length > 0 ? `  💡 行动：mcp.search 搜索这些缺失工具 → mcp.install 安装` : "",
              ""
            ].filter(Boolean).join("\n")
          : "";

        const planReqMessages = [
          { role: "system", content: phaseSystemPrompt },
          {
            role: "user",
            content: [
              `【你的任务 — 不要修改、不要替换、不要重新解释】`,
              `${input.goal}`,
              ``,
              `⚠️ 上述任务主题是锁定的。禁止替换、扩展或重新解释任务中的关键名词。如果发现自己在处理不同的主题，立刻停止并回到原任务。`,
              `第一句话复述任务关键词，确认你没改主题。如果你正在做的和任务主题不符，立刻停止。`,
              ``,
              `🎭 你现在的身份：${intent.persona.name} | 专业：${intent.persona.expertise} | 风格：${intent.persona.tone}`,
              ``,
              resumeGoal && cycle === 1 ? `## 🔄 恢复上下文 — 之前的执行进度\n${resumeGoal}\n` : "",
              input.projectContext ? `## 📂 项目上下文 — 之前在这个项目中做了什么\n${input.projectContext}\n` : "",
              `任务类型：${intent.taskType} | 输出格式：${intent.outputFormat} | 第${cycle}/${this.deps.maxPlanningCycles}轮`,
              `task.planner: ${taskPlannerUsed ? '已用' : '可用(仅一次)'} | 已写文件: ${hasWrittenFile ? '是' : '否'}`,
              "",
              "## 工作流", intent.workflowLabel,
              "", "## 执行清单", intent.workflowSteps.map((item, idx) => `${idx + 1}. ${item}`).join("\n"),
              ...(intent.promptDirectives.length > 0 ? ["", "## ⚡ 关键指令 — 必须遵守", ...intent.promptDirectives.map((d) => `- ${d}`)] : []),
              ...(hierarchicalPlan && cycle === 1 ? [hierarchicalPlan] : []),
              ...(subgoalExecutionSummary && cycle === 1 ? [subgoalExecutionSummary] : []),
              ...dagGuidance,
              "## 交付物", intent.deliverables.map((d) => `- ${d}`).join("\n"),
              `主交付格式: ${intent.delivery.primaryArtifact} | 类型: ${intent.delivery.kind}`,
              "", gapWarning,
              capabilityPlan.missingCapabilities.length > 0 ? capabilityPlan.routingPrompt.split("\n").filter(l => l.includes("Missing") || l.includes("mcp") || l.includes("missing")).join("\n") : "",
              "", "## 可用工具", toolCatalog,
              "", "## 当前状态", observeContext,
              layeredMemoryContext ? "## 历史经验 (L2/L4 Memory)\n" + layeredMemoryContext.substring(0, 800) : "",
              skillInstructions ? "## 匹配技能\n" + skillInstructions.substring(0, 500) : ""
            ].filter(line => line !== "").join("\n")
          }
        ];

        let tools = this.buildToolDefinitions(intent.preferredTools);
        // General conversation: don't offer task.planner — respond directly
        if (intent.taskType === "general") {
          tools = tools.filter(t => t.name !== "task.planner");
        }
        // After task.planner has been used once, remove it to force real tool usage
        if (taskPlannerUsed) {
          const idx = tools.findIndex(t => t.name === "task.planner");
          if (idx >= 0) tools.splice(idx, 1);
        }
        // After urgent compile threshold, or if search loop was detected, remove search tools
        if ((stepCounter >= urgentThreshold && !hasWrittenFile) || searchLockedOut) {
          tools = tools.filter(t => t.name !== "search" && t.name !== "web.fetch");
        }

        // Research tasks need more tool calls (search→fetch→analyze→write chain)
        const adaptiveMaxToolCalls = intent.taskType === "research" || intent.taskType === "product_research"
          ? Math.max(this.deps.maxToolCalls, 10)
          : this.deps.maxToolCalls;

        const { planText: rawPlanText, executedTools, toolSteps, history } = await this.completeWithTools(
          plannerModel, planReqMessages, tools,
          { taskId, taskLineageId: input.taskLineageId ?? taskId, goal: input.goal, step: { value: stepCounter } },
          contextHistory,
          adaptiveMaxToolCalls
        ).catch(async (error) => {
          const msg = error instanceof Error ? error.message : String(error);
          const safeMsg = msg.replace(/"/g, "'").replace(/\n/g, " ").slice(0, 200);
          console.log(`[RUNTIME] Planner FAILED with error: ${safeMsg}`);
          // 400 Bad Request = message format error, not a model issue — skip retry
          const isBadRequest = msg.includes("400") || msg.includes("Bad Request");
          if (!isBadRequest && !plannerModel.startsWith("builtin:")) {
            try {
              const fallbackModel = "builtin:default";
              console.log(`[RUNTIME] Planner failed (${safeMsg}), trying fallback model: ${fallbackModel}`);
              return await this.completeWithTools(
                fallbackModel, planReqMessages, tools,
                { taskId, taskLineageId: input.taskLineageId ?? taskId, goal: input.goal, step: { value: stepCounter } },
                contextHistory,
                adaptiveMaxToolCalls
              );
            } catch (fbErr) {
              const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
              console.log(`[RUNTIME] Fallback model also failed: ${fbMsg.slice(0, 200)}`);
            }
          }
          return {
            planText: `THINK: Planner unavailable - ${safeMsg}. Using fallback.\nTOOL core.echo {"text":"Planner error: ${safeMsg}"}`,
            executedTools: 0,
            toolSteps: [],
            history: []
          };
        }).catch(() => {
          // Absolute last resort — if even the fallback fails
          return {
            planText: `THINK: All models unavailable.\nTOOL core.echo {"text":"All model providers failed for this task."}`,
            executedTools: 0,
            toolSteps: [],
            history: []
          };
        });

        console.log(`[RUNTIME] Cycle ${cycle}: executedTools=${executedTools}, planTextLen=${rawPlanText.length}, toolSteps=${toolSteps.length}, historyLen=${history.length}`);
        contextHistory = history; // carry assistant+tool messages to next cycle
        steps.push({ step: stepCounter++, action: "plan", reasoning: rawPlanText });
        this.deps.audit.append(taskId, { step: stepCounter - 1, action: "plan", reasoning: rawPlanText });
        // Add tool execution steps into the main step log
        for (const ts of toolSteps) {
          steps.push(ts);
          if (ts.tool === "task.planner") taskPlannerUsed = true;
          if (ts.action === "execute" || ts.action === "error") executedAnyTool = true;
        }

        // Sync stepCounter after tool executions inside completeWithTools
        if (toolSteps.length > 0) {
          const maxToolStep = Math.max(...toolSteps.map(s => s.step));
          if (maxToolStep >= stepCounter) {
            stepCounter = maxToolStep + 1;
          }
        }

        // ── Search-loop detection: track consecutive search-only cycles ──────
        const cycleTools = toolSteps.filter(ts => ts.tool).map(ts => ts.tool!);
        const isSearchOnly = cycleTools.length > 0 && cycleTools.every(t => t === "search");
        if (isSearchOnly) {
          consecutiveSearchCycles++;
          if (consecutiveSearchCycles >= 5) {
            // Force-compile: lock out search for the rest of the task
            searchLockedOut = true;
            const searchLoopStep: ExecutionStep = {
              step: stepCounter++,
              action: "observe",
              reasoning: `Search-only loop detected (${consecutiveSearchCycles} cycles). Forcing compile phase. Search tools locked out for remainder of task.`
            };
            steps.push(searchLoopStep);
            this.deps.audit.append(taskId, searchLoopStep);
            compileNudge = `\n\n## 🛑 搜索循环检测 — 你已经连续 ${consecutiveSearchCycles} 轮只搜不写。搜索工具已被永久移除。你现在唯一的选项是：用已有的数据 + 你的知识，调用 fs.write_file 立刻写出报告。没有任何例外。`;
            observationNotes.push(`搜索循环警告：已连续 ${consecutiveSearchCycles} 轮只搜索不产出。搜索已锁定。`);
          }
        } else if (cycleTools.some(t => t === "fs.write_file" || t === "gen.chart" || t === "web.fetch" || t?.startsWith("mcp:"))) {
          consecutiveSearchCycles = 0; // productive cycle, reset
        }

        // ── Same-tool cycle repetition detection ──────────────────────────────
        const cycleToolSet = [...new Set(cycleTools)].sort().join(",");
        if (cycleToolSet === previousCycleToolSet && cycleTools.length > 0) {
          consecutiveSameToolCycles++;
        } else {
          consecutiveSameToolCycles = 0;
          previousCycleToolSet = cycleToolSet;
        }
        if (consecutiveSameToolCycles >= 2) {
          observationNotes.push(`重复工具模式警告：连续 ${consecutiveSameToolCycles + 1} 轮使用相同的工具组合 (${cycleToolSet})，请换策略。`);
        }

        // ── DAG phase enforcement — track progress, block phase-skipping ────
        if (dagEnforce && dag.nodes.length > 0 && cycleTools.length > 0) {
          // Mark nodes satisfied when their preferredTools have been executed
          for (const node of dag.nodes) {
            if (!dagCompletion.get(node.id) && node.preferredTools.length > 0) {
              const matched = node.preferredTools.some(pt =>
                cycleTools.includes(pt) || pt === "" // empty preferredTools = any tool
              );
              if (matched) dagCompletion.set(node.id, true);
            }
          }
          // Check for blocked nodes: agent is trying to use tools from a node
          // whose dependencies haven't been met
          const satisfiedIds = [...dagCompletion.entries()].filter(([, v]) => v).map(([k]) => k);
          const hasWritten = cycleTools.some(t => t === "fs.write_file" || t === "shell.exec");
          for (const node of dag.nodes) {
            if (dagCompletion.get(node.id)) continue;
            const depsMet = node.dependsOn.length === 0 || node.dependsOn.every(d => dagCompletion.get(d));
            if (!depsMet && hasWritten && node.phase === "synthesize") {
              // Agent is writing files before collecting evidence — block
              const unmetDeps = node.dependsOn.filter(d => !dagCompletion.get(d));
              const unmetLabels = unmetDeps.map(d => dag.nodes.find(n => n.id === d)?.label || d).join("、");
              observationNotes.push(`## ⛔ DAG 阶段约束 — 以下前置阶段未完成：${unmetLabels}\n你必须先完成这些阶段再进入「${node.label}」。如果确实无法推进，说明原因而不是跳过。`);
              break; // one blocker per cycle is enough
            }
          }
          // Progress report
          const completedCount = [...dagCompletion.values()].filter(Boolean).length;
          if (completedCount > 0) {
            const completedStages = dag.nodes.filter(n => dagCompletion.get(n.id)).map(n => n.label).join(" → ");
            observationNotes.push(`[DAG进度] ${completedCount}/${dag.nodes.length} 阶段完成 | 已完成: ${completedStages}`);
          }
          // Emit DAG progress to frontend
          emit("dag.progress", {
            completedNodeIds: dag.nodes.filter(n => dagCompletion.get(n.id)).map(n => n.id),
            totalNodes: dag.nodes.length,
            completedCount,
          });
        }

        // Early exit when planner consistently fails (M1: circuit breaker)
        // Detects: regex text patterns + actual model/router errors from catch handlers
        const plannerFailed = /planner unavailable/i.test(rawPlanText) || /all models unavailable/i.test(rawPlanText) || /model (error|failure|failed|unreachable|returned empty)/i.test(rawPlanText) || /no (response|output|completion) from/i.test(rawPlanText) || /^(THINK|PLAN):\s*(Planner|All models|Model|Error)/m.test(rawPlanText);
        const modelThrewError = /^THINK: (Planner|All models) unavailable/.test(rawPlanText);
        const isModelError = plannerFailed || modelThrewError;
        if (isModelError) {
          consecutivePlannerFailures++;
          if (consecutivePlannerFailures >= 3) {
            doneReason = `Circuit breaker: model/router failed ${consecutivePlannerFailures} consecutive times. Task cannot proceed.`;
            const failStep: ExecutionStep = { step: stepCounter++, action: "error", reasoning: doneReason };
            steps.push(failStep);
            this.deps.audit.append(taskId, failStep);
            emit("task.planner_unavailable", { failures: consecutivePlannerFailures, circuitBreaker: true });
            sm.toDone(); syncContext();
            break;
          }
        } else if (executedTools > 0) {
          consecutivePlannerFailures = 0;
          // Early success: if tools were executed and plan indicates DONE, exit the loop
          const doneMatch = /^DONE\b|DONE\s/i.test(rawPlanText);
          if (doneMatch) {
            doneReason = rawPlanText.replace(/^[\s\S]*?DONE\s*/i, "").trim() || "Task completed.";
            const doneStep: ExecutionStep = { step: stepCounter++, action: "done", reasoning: doneReason };
            steps.push(doneStep);
            this.deps.audit.append(taskId, doneStep);
            sm.toDone(); syncContext();
            break;
          }
        }

        // General conversation: text output without tools = done
        if (executedTools === 0 && intent.taskType === "general" && rawPlanText.length > 100) {
          doneReason = rawPlanText;
          const doneStep: ExecutionStep = { step: stepCounter++, action: "done", reasoning: "Conversation response" };
          steps.push(doneStep);
          this.deps.audit.append(taskId, doneStep);
          sm.toDone(); syncContext();
          break;
        }

        // Parse text for tool actions even when native tool calls were already made.
        // Models may interleave native calls with text-format tool invocations (XML, TOOL, etc.)
        const actions: ParsedAction[] = parsePlanActions(rawPlanText);

        let cycleExecutedTool = executedTools > 0;
        let cycleDone = false;

        // ── Domain engine (cycle 1 only — reuse cached result thereafter) ───
        const domainAlreadyExecuted = calledDomainTools.size > 0;
        if (!domainAlreadyExecuted) {
          try {
            const domainPlan = await this.deps.domainEngine.plan(input.goal, memoryContext);
            const domStep: ExecutionStep = { step: stepCounter++, action: "plan", reasoning: domainPlan };
            steps.push(domStep);
            this.deps.audit.append(taskId, domStep);
            emit("domain.plan", { domain: domainPlan });

            for (const action of parsePlanActions(domainPlan)) {
            if (action.type === "tool") {
              // Skip domain tools already called in this task
              if (calledDomainTools.has(action.tool)) {
                observationNotes.push(`Skipping redundant domain tool: ${action.tool}`);
                continue;
              }
              calledDomainTools.add(action.tool);
              emit("tool.start", { tool: action.tool, args: action.input, source: "domain" });
              try {
                const result = await this.deps.tools.execute(action.tool, action.input, {
                  now: new Date(), taskId, taskLineageId: input.taskLineageId ?? taskId, goal: input.goal
                });
                const execStep: ExecutionStep = { step: stepCounter++, action: "execute", tool: action.tool, result };
                steps.push(execStep);
                this.deps.audit.append(taskId, execStep);
                cycleExecutedTool = true;
                executedAnyTool = true;
                const domResultSummary = typeof result === "string" ? result.substring(0, 300) : JSON.stringify(result).substring(0, 300);
                observationNotes.push(`[Tool: ${action.tool}] Input: ${JSON.stringify(action.input).slice(0, 100)}\nResult: ${domResultSummary}`);
                emit("domain.tool", { tool: action.tool, input: action.input, result });
              } catch (error) {
                if (error instanceof ApprovalRequiredError) {
                  const apStep: ExecutionStep = { step: stepCounter++, action: "approval_required", tool: action.tool, reasoning: `Approval: ${error.approvalId}` };
                  steps.push(apStep);
                  this.deps.audit.append(taskId, apStep);
                  emit("domain.approval_required", { tool: action.tool, approvalId: error.approvalId });
                  emit("task.waiting_approval", { approvalId: error.approvalId, tool: action.tool });
                  throw new TaskPausedForApprovalError(error.approvalId, action.tool);
                }
                const errMsg = error instanceof Error ? error.message : String(error);
                const diag = diagnoseToolError(errMsg, action.tool);
                const failStep: ExecutionStep = { step: stepCounter++, action: "error", tool: action.tool, reasoning: `${errMsg}\n[DIAGNOSIS] ${diag.cause}\n[FIX] ${diag.fix}` };
                steps.push(failStep);
                this.deps.audit.append(taskId, failStep);
                emit("domain.tool_error", { tool: action.tool, error: errMsg, diagnosis: diag });
              }
            } else if (action.type === "done") {
              // If domain was already executed in a previous cycle, skip stale replay
              if (domainAlreadyExecuted) {
                observationNotes.push(`Domain plan replay skipped (already executed)`);
                break;
              }
              const ds: ExecutionStep = { step: stepCounter++, action: "done", reasoning: action.text || "Domain done" };
              steps.push(ds);
              this.deps.audit.append(taskId, ds);
              doneReason = action.text || "Domain work completed";
              break;
            } else if (action.type === "note") {
              const ns: ExecutionStep = { step: stepCounter++, action: "note", reasoning: action.text };
              steps.push(ns);
              this.deps.audit.append(taskId, ns);
              observationNotes.push(`Domain note: ${action.text}`);
            }
          }
        } catch (error) {
          if (error instanceof TaskPausedForApprovalError) throw error;
          observationNotes.push(`Domain engine: ${error instanceof Error ? error.message : String(error)}`);
        }
        } // end if !domainAlreadyExecuted

        // ── Planner text actions ──────────────────────────────────────────────
        for (const action of actions) {
          if (action.type === "tool") {
            // Guard: skip task.planner in text form if already used
            if (action.tool === "task.planner" && taskPlannerUsed) {
              observationNotes.push(`Skipping redundant task.planner call - already planned. Use real tools.`);
              continue;
            }
            if (action.tool === "task.planner") taskPlannerUsed = true;
            cycleExecutedTool = true;
            executedAnyTool = true;
            emit("tool.start", { tool: action.tool, args: action.input, source: "planner" });
            try {
              const result = await this.deps.tools.execute(action.tool, action.input, {
                now: new Date(), taskId, taskLineageId: input.taskLineageId ?? taskId, goal: input.goal
              });
              const execStep: ExecutionStep = { step: stepCounter++, action: "execute", tool: action.tool, result };
              steps.push(execStep);
              this.deps.audit.append(taskId, execStep);
              const resultSummary = typeof result === "string" ? result.substring(0, 300) : JSON.stringify(result).substring(0, 300);
              observationNotes.push(`[Tool: ${action.tool}] Input: ${JSON.stringify(action.input).substring(0, 100)}\nResult: ${resultSummary}`);
            } catch (error) {
              if (error instanceof ApprovalRequiredError) {
                const apStep: ExecutionStep = { step: stepCounter++, action: "approval_required", tool: action.tool, reasoning: `Approval: ${error.approvalId}` };
                steps.push(apStep);
                this.deps.audit.append(taskId, apStep);
                emit("approval_required", { tool: action.tool, approvalId: error.approvalId });
                emit("task.waiting_approval", { approvalId: error.approvalId, tool: action.tool });
                throw new TaskPausedForApprovalError(error.approvalId, action.tool);
              }
              const tErrMsg = error instanceof Error ? error.message : String(error);
              const tDiag = diagnoseToolError(tErrMsg, action.tool);
              const failStep: ExecutionStep = { step: stepCounter++, action: "error", tool: action.tool, reasoning: `${tErrMsg}\n[DIAGNOSIS] ${tDiag.cause}\n[FIX] ${tDiag.fix}` };
              steps.push(failStep);
              this.deps.audit.append(taskId, failStep);
              observationNotes.push(`Error on ${action.tool}: ${tErrMsg}\nDiagnosis: ${tDiag.cause} → ${tDiag.fix}`);
            }
            continue;
          }
          if (action.type === "done") {
            cycleDone = true;
            doneReason = action.text || "Goal completed";
            const ds: ExecutionStep = { step: stepCounter++, action: "done", reasoning: doneReason };
            steps.push(ds);
            this.deps.audit.append(taskId, ds);
            break;
          }
          if (action.type === "think") {
            const ts: ExecutionStep = { step: stepCounter, action: "think", reasoning: action.text };
            steps.push(ts);
            this.deps.audit.append(taskId, ts);
            continue;
          }
          if (action.type === "plan") {
            const ps: ExecutionStep = { step: stepCounter, action: "plan", reasoning: action.text };
            steps.push(ps);
            this.deps.audit.append(taskId, ps);
            continue;
          }
          // note / ask — treat as note (don't consume step budget)
          const ns: ExecutionStep = { step: stepCounter, action: "note", reasoning: action.text };
          steps.push(ns);
          this.deps.audit.append(taskId, ns);
        }

        if (cycleDone) { sm.toDone(); syncContext(); void saveCheckpoint(); break; }

        // ── Critic reflection (every other cycle to reduce LLM round-trips) ──
        sm.toCritic();
        void saveCheckpoint();
        if (cycleExecutedTool && cycle % 2 === 1) {
          try {
            const reflection = await this.completeWithModel(criticModel, [
              { role: "system", content: "You are the critic model. Review progress, identify the biggest gap, and suggest the next best action in 3 concise bullets." },
              { role: "user", content: [
                `Task: ${input.goal}`, `Task type: ${intent.taskType}`,
                `Requested output: ${intent.outputFormat}`, `Cycle: ${cycle}/${this.deps.maxPlanningCycles}`,
                "", "Recent steps:", this.summarizeRecentSteps(steps),
                "", "Respond as short plain text bullets."
              ].join("\n") }
            ]);
            const rs: ExecutionStep = { step: stepCounter++, action: "reflect", reasoning: reflection };
            steps.push(rs);
            this.deps.audit.append(taskId, rs);
            observationNotes.push(`Critic: ${reflection.substring(0, 200)}`);
          } catch (error) {
            observationNotes.push(`Critic unavailable: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        // ── Smart Escalation checks (1.2) ─────────────────────────────────
        if (this.deps.smartEscalation) {
          const repeatedFailureEvent = this.deps.smartEscalation.checkRepeatedFailure(taskId);
          if (repeatedFailureEvent) {
            observationNotes.push(`⚠️ ESCALATION [${repeatedFailureEvent.level}]: ${repeatedFailureEvent.reason}\n${repeatedFailureEvent.context}\nACTION REQUIRED: Change your approach immediately. Do NOT retry what just failed. Use a different tool, search for alternatives, or delegate.`);
            emit("escalation", { event: repeatedFailureEvent, cycle });
          }
          const timeoutEvent = this.deps.smartEscalation.checkTimeout(taskId);
          if (timeoutEvent) {
            observationNotes.push(`⏰ ESCALATION [${timeoutEvent.level}]: ${timeoutEvent.reason}\n${timeoutEvent.context}\nACTION REQUIRED: Compile your best result now. Do not start new research or new tool chains. Write output immediately.`);
            emit("escalation", { event: timeoutEvent, cycle });
          }
          if (this.deps.smartEscalation.shouldPause(taskId)) {
            observationNotes.push("Task paused by SmartEscalation — too many unresolved escalations.");
            syncContext();
            sm.toPaused();
            await sm.saveToDisk().catch(() => {});
            emit("task.paused", { state: sm.getState(), cycle, reason: "smart_escalation" });
            wasPaused = true;
            break;
          }
        }

        // Record cycle snapshot for progress detector
        const pdCycleTools = steps
          .filter(s => s.action === "execute" && s.step! > (ctx.lastRecordedStep || 0))
          .map(s => s.tool!);
        const cycleSnapshot: CycleSnapshot = {
          cycle,
          stepCount: stepCounter,
          toolsExecuted: pdCycleTools,
          hasProductiveWork: (() => {
            const result = pdCycleTools.some(t => {
              if (["fs.write_file", "fs.append_file", "shell.exec", "core.echo",
                   "gen.chart", "gen.media", "code.exec", "code.self_improve",
                   "code.improver", "web.fetch", "search"].includes(t)) return true;
              if (t.startsWith("mcp.") || t.startsWith("domain.")) return true;
              return false;
            });
            console.log(`[CYCLE-SNAP] cycle=${cycle} tools=[${pdCycleTools.join(",")}] hasProductiveWork=${result} lastRecorded=${ctx.lastRecordedStep || 0} stepCounter=${stepCounter}`);
            return result;
          })(),
        };
        progressDetector.recordCycle(cycleSnapshot);
        sm.updateContext({ lastRecordedStep: stepCounter } as any);

        console.log(`[STALL-CHECK] cycle=${cycle} cycleExecutedTool=${cycleExecutedTool} executedAnyTool=${executedAnyTool} stepsWithExec=${steps.filter(s => s.action === "execute").length}`);
        if (!cycleExecutedTool && cycle >= 2) {
          console.log(`[STALL-CHECK] Running progressDetector.evaluate, cycles recorded=${progressDetector.getSummary().totalCycles}`);
          const evaluation = progressDetector.evaluate(cycle);
          if (evaluation.warning) {
            console.warn(`[PROGRESS] Cycle ${cycle}: ${evaluation.warning}`);
          }
          // Inject progress detector suggestion as hard instruction to the agent (2.3)
          if (evaluation.suggestion) {
            observationNotes.push(evaluation.suggestion);
          }
          if (evaluation.shouldAbort) {
            doneReason = evaluation.reason || "Progress detector abort";
            sm.toDone(); syncContext(); break;
          }
          // Check if goal was already achieved in previous cycles
          const hasProductiveWork = steps.some(s => {
            if (s.action !== "execute" || !s.tool) return false;
            if (["fs.write_file", "fs.append_file", "shell.exec", "core.echo",
                 "gen.chart", "gen.media", "code.exec", "code.self_improve",
                 "code.improver", "web.fetch", "search"].includes(s.tool)) return true;
            if (s.tool.startsWith("mcp.") || s.tool.startsWith("domain.")) return true;
            return false;
          });
          if (hasProductiveWork && executedAnyTool) {
            doneReason = "Goal appears completed — productive work found in earlier cycles";
          } else {
            doneReason = "No progress in consecutive cycles";
          }
          sm.toDone(); syncContext(); break;
        }

        if (!executedAnyTool) {
          const fallbackResult = await this.deps.tools.execute("core.echo", { text: `Task: ${input.goal}` }, {
            now: new Date(), taskId, taskLineageId: input.taskLineageId ?? taskId, goal: input.goal
          });
          const fs: ExecutionStep = { step: stepCounter++, action: "execute", tool: "core.echo", result: fallbackResult };
          steps.push(fs);
          this.deps.audit.append(taskId, fs);
          doneReason = doneReason || "Fallback execution completed";
        }
      }

      // ── Auto-save report if no file was written ───────────────────────────
      const hasWriteFile = steps.some(s => s.action === "execute" && s.tool === "fs.write_file");
      if (!hasWriteFile) {
        const trunc = (s: string, max: number) => s.length > max ? s.substring(0, max) + `...[truncated ${s.length - max} chars]` : s;
        // Collect all tool output data gathered during execution
        const gatheredData = steps
          .filter(s => s.action === "execute" && s.result && (s.tool === "search" || s.tool === "web.fetch" || s.tool === "shell.exec" || s.tool === "code.exec" || s.tool === "code.self_improve" || s.tool === "api.request" || s.tool?.startsWith("mcp.")))
          .map(s => {
            const result = s.result as any;
            if (s.tool === "search" && result?.results) {
              return result.results.map((r: any) =>
                `[source: ${r.url || "search"}] ${r.title}\n${r.content || r.snippet || ""}`
              ).join("\n\n");
            }
            if (s.tool === "web.fetch" && result?.content) {
              return `[source: web.fetch] ${trunc(result.content as string, 2000)}`;
            }
            if (s.tool === "shell.exec") {
              const out = result?.stdout || result?.output || "";
              if (out.length > 50) return `[source: shell.exec] ${trunc(typeof out === "string" ? out : JSON.stringify(out), 2000)}`;
            }
            if (s.tool === "code.exec" && result?.output) {
              return `[source: code.exec] ${trunc(typeof result.output === "string" ? result.output : JSON.stringify(result.output), 2000)}`;
            }
            if (s.tool === "api.request" && result?.data) {
              return `[source: api.request] ${trunc(JSON.stringify(result.data), 2000)}`;
            }
            if (s.tool?.startsWith("mcp.") && result) {
              return `[source: ${s.tool}] ${trunc(typeof result === "string" ? result : JSON.stringify(result), 2000)}`;
            }
            return "";
          })
          .filter(Boolean)
          .join("\n\n---\n\n");

        // Use LLM to compile a proper report from gathered data
        let reportContent = "";
        if (gatheredData.length > 100) {
          try {
            emitPhase("compile", "Generating report from gathered data via LLM");
            reportContent = await this.completeWithModel(executorModel, [
              {
                role: "system",
                content: `You are a professional report writer. Compile the provided research data into a comprehensive, well-structured markdown report.

Structure:
- Executive Summary (3-5 bullet highlights)
- Table of Contents
- Market Analysis (with data tables and specific numbers)
- Competitive Landscape (with comparison tables)
- Consumer Insights
- Trends and Future Outlook
- Strategic Recommendations
- Appendix (data sources, methodology)

For each data table you include, also describe what chart would visualize it (e.g., "[CHART:pie|Market Share|label1:val1,label2:val2,...]"). This helps the system generate actual charts later.
Write in a professional, report-ready tone. Output ONLY the markdown report, no meta-commentary.`
              },
              {
                role: "user",
                content: [
                  `Task: ${input.goal}`,
                  `Task type: ${intent.taskType}`,
                  `Requested output: ${intent.outputFormat}`,
                  "",
                  "## Gathered Research Data",
                  gatheredData.length > 8000 ? gatheredData.substring(0, 8000) + `...[truncated ${gatheredData.length - 8000} chars]` : gatheredData,
                  "",
                  "Compile this into a professional markdown report. Include:",
                  "1. Executive Summary with key data highlights",
                  "2. Market Size & Growth Data (with numbers in markdown tables)",
                  "3. Competitive Analysis (with comparison tables)",
                  "4. Consumer/User Analysis",
                  "5. Trends and Future Outlook",
                  "6. Strategic Recommendations",
                  "",
                  "Use markdown tables for data. Include [CHART:...] markers where charts would add value.",
                  "If specific data is missing, use reasonable estimates based on available information and your knowledge.",
                  "Output the complete report in markdown format."
                ].join("\n")
              }
            ]);
            reportContent = reportContent || "";
          } catch (err) {
            observationNotes.push(`LLM report compilation failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Fallback: if LLM compilation failed or no data, build a basic report
        if (!reportContent || reportContent.length < 200) {
          reportContent = [
            `# ${input.goal}`,
            "",
            "## Executive Summary",
            doneReason || "Task completed",
            "",
            "## Key Findings",
            ...observationNotes.filter(n => n.includes("search") || n.includes("fetch") || n.includes("result")).map(n => `- ${n}`),
            "",
            "## Data Collected",
            gatheredData ? (gatheredData.length > 5000 ? gatheredData.substring(0, 5000) + `...[truncated ${gatheredData.length - 5000} chars]` : gatheredData) : "No data was gathered during execution.",
            "",
            "## Execution Notes",
 `- Steps executed: ${steps.filter(s => s.action === "execute").length}`,
            `- Tools used: ${[...new Set(steps.filter(s => s.action === "execute" && s.tool).map(s => s.tool))].join(", ")}`,
          ].join("\n");
        }

        try {
          const writeResult = await this.deps.tools.execute("fs.write_file", {
            path: `./.agent/reports/report-${taskId.slice(0, 8)}.md`,
            content: reportContent
          }, {
            now: new Date(), taskId, taskLineageId: input.taskLineageId ?? taskId, goal: input.goal
          });
          const ws: ExecutionStep = { step: stepCounter++, action: "execute", tool: "fs.write_file", result: writeResult };
          steps.push(ws);
          this.deps.audit.append(taskId, ws);
          if (/max steps/i.test(doneReason)) {
            doneReason = "Report auto-compiled and saved after step limit";
          } else {
            doneReason = doneReason || "Report compiled and saved";
          }
          outputContent = reportContent;
        } catch (err) {
          observationNotes.push(`Auto-save failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }


      // ── Handle pause ─────────────────────────────────────────────────────────
      if (wasPaused) {
        const pauseResult: TaskResult = {
          taskId,
          success: false,
          summary: "Task paused — resume to continue",
          steps
        };
        return pauseResult;
      }

      // ── Verification ────────────────────────────────────────────────────────
      if (sm.getState() !== "verify" && !sm.isTerminal()) {
        sm.toVerify();
      }
      sm.updateContext({ doneReason, stepCounter });
      emit("state.change", { state: sm.getState(), taskId });

      if (!this.deps.disableVerifier) {
        emitPhase("verify", "Verifying task outcome (model-driven critic)", { taskType: intent.taskType });
        verification = await critiqueAndVerify(
          (model, messages) => this.completeWithModel(model, messages),
          criticModel,
          input.goal,
          steps,
          doneReason,
          intent.taskType,
          intent.outputFormat
        );
      } else {
        emitPhase("verify", "Fast verify (DISABLE_VERIFIER=true)", { taskType: intent.taskType });
        verification = verifyTask(input.goal, steps, doneReason);
      }

      const criticDetail = verification.confidence !== undefined
        ? ` [critic: score=${verification.score}/10, confidence=${(verification.confidence * 100).toFixed(0)}%]`
        : " [rule-based]";
      const gapsDetail = verification.gaps?.length
        ? `\nGaps: ${verification.gaps.join("; ")}`
        : "";

      // ── Deep content verification (only for research reports with substantial content) ──
      let contentQualityStr = "";
      const needsDeepVerify = intent.taskType === "research" || intent.taskType === "product_research";
      if (!this.deps.disableVerifier && needsDeepVerify && outputContent && outputContent.length > 1000) {
        emitPhase("verify", "Deep content quality check", { taskType: intent.taskType });
        try {
          const contentReport = await deepContentVerify(
            (model, messages) => this.completeWithModel(model, messages),
            criticModel,
            input.goal,
            outputContent,
            intent.taskType,
            intent.outputFormat
          );
          if (contentReport) {
            contentQualityStr = "\n" + formatContentQualityForReason(contentReport);
          }
        } catch { console.warn("[RUNTIME] Deep content check unavailable"); }
      }

      const verifyStep: ExecutionStep = {
        step: stepCounter,
        action: "verify",
        reasoning: verification.success
          ? `Verified: ${verification.reason}${criticDetail}${gapsDetail}${contentQualityStr}`
          : `Verification failed: ${verification.reason}${criticDetail}${gapsDetail}${contentQualityStr}`
      };
      steps.push(verifyStep);
      this.deps.audit.append(taskId, verifyStep);

      result = {
        taskId,
        success: verification.success,
        summary: doneReason || `${intent.workflowLabel} completed`,
        content: outputContent || undefined,
        verificationReason: verification.reason,
        steps
      };

      // ── StrategyEvaluator: record this attempt's run for A/B comparison ──
      if (this.deps.strategyEvaluator && strategyComparisonId) {
        try {
          const durationMs = Date.now() - taskStartTime;
          const execSteps = steps.filter(s => s.action === "execute");
          const errorSteps = steps.filter(s => s.action === "error");
          const qualityScore = verification.success ? (verification.gaps?.length ? 0.6 : 0.9) : 0.2;
          this.deps.strategyEvaluator.recordRun(strategyComparisonId, strategyVariantId, {
            goal: input.goal,
            startedAt: new Date(taskStartTime).toISOString(),
            completedAt: new Date().toISOString(),
            success: verification.success,
            summary: doneReason || verification.reason,
            qualityScore,
            durationMs,
            stepCount: execSteps.length,
            tokenCost: 0, // approximate — not tracked at this level
            errors: errorSteps.map(s => s.reasoning || "unknown error"),
          });
        } catch (err) { console.warn("[RUNTIME] StrategyEvaluator recordRun failed: " + (err instanceof Error ? err.message : String(err))); }
      }

      if (verification.success) break;
    } // end retry loop

    // ── Post-task storage (fire-and-forget, don't block result) ──
    void Promise.allSettled([
      this.deps.experiences.appendFromTask({
        taskId: result.taskId, goal: input.goal, summary: result.summary,
        success: result.success, steps: result.steps
      }),
      // DomainLearner: learn from outcomes for future domain tasks
      (async () => {
        const domain = intent.taskType;
        const insight = result.summary.substring(0, 500);
        try {
          await this.deps.domainEngine.learn(domain, input.goal, result.success ? "success" : "failure", insight);
        } catch (err) { console.warn("[RUNTIME] Domain learning failed: " + (err instanceof Error ? err.message : String(err))); }
      })(),
      // Persist to long-term memory
      (async () => {
        if (this.deps.memory) {
          const toolSeq = steps.filter(s => s.action === "execute" && s.tool).map(s => s.tool as string);
          await this.deps.memory.addMemory(
            `Task: ${input.goal}\nResult: ${result.summary}\nSuccess: ${result.success}\nTools used: ${toolSeq.join(" -> ")}`,
            result.success ? "short_term" : "short_term",
            [intent.taskType, "task"]
          );
        }
      })(),
      // Self-improver
      (async () => {
        if (this.deps.selfImprover) {
          const toolSeq = steps.filter(s => s.action === "execute" && s.tool).map(s => s.tool as string);
          const candidate: EvolutionCandidate = {
            goal: input.goal, taskType: intent.taskType, steps, toolSequence: toolSeq,
            success: result.success, summary: result.summary,
          };
          await this.deps.selfImprover.recordTask(candidate);
        }
      })(),
      // L2 task memory
      this.deps.taskMemory?.extractFromSteps(taskId, input.goal, steps) ?? Promise.resolve(),
      // L4 semantic memory
      (async () => {
        if (this.deps.semanticMemory) {
          const memText = `Goal: ${input.goal}. Result: ${result.summary}. Success: ${result.success}. Steps: ${steps.filter(s => s.action === "execute").length} tools executed.`;
          await this.deps.semanticMemory.addEntry(memText, [intent.taskType, result.success ? "success" : "failure"]);
        }
      })(),
    ]).catch(() => {/* non-critical */});

    // ── Self-evolution (Phase 3) — kept synchronous: writes to result.steps ──
    if (this.deps.selfEvolver && result.success && verification.success) {
      sm.toSelfEvolve();
      syncContext();
      emit("state.change", { state: sm.getState(), taskId });
      emitPhase("self_evolve", "Extracting reusable skill pattern");

      try {
        const toolSequence = steps
          .filter(s => s.action === "execute" && s.tool)
          .map(s => s.tool as string);

        const evolutionResult = await this.deps.selfEvolver.evolveFromTask({
          goal: input.goal,
          taskType: intent.taskType,
          steps,
          toolSequence,
          success: result.success,
          summary: result.summary
        });

        if (evolutionResult.skill && !evolutionResult.skipped) {
          emit("skill.evolved", {
            skillName: evolutionResult.skill.name,
            description: evolutionResult.skill.description,
            triggers: evolutionResult.skill.triggers
          });
          try {
            await this.deps.skills.loadFromDirectory("./.agent/skills");
          } catch { console.warn("[RUNTIME] Skill evolution extraction non-critical"); }
        }

        const evolveStep: ExecutionStep = {
          step: stepCounter++,
          action: "self_evolve",
          reasoning: evolutionResult.reason
        };
        steps.push(evolveStep);
        this.deps.audit.append(taskId, evolveStep);
      } catch (e: any) {
        console.log(`[RUNTIME] Self-evolution skipped: ${e.message}`);
      }
    }

    // Close the feedback loop: learn from outcome for future strategy
    if (result.success) {
      const errors = steps
        .filter(s => s.action === "error" && s.reasoning)
        .map(s => s.reasoning!);
      this.deps.advisor.learnFromOutcome(input.goal, result.success, errors);
    } else if (this.deps.selfEvolver) {
      // ── Failure evolution: extract failure avoidance patterns ──────
      try {
        const toolSequence = steps
          .filter(s => s.action === "execute" && s.tool)
          .map(s => s.tool as string);

        if (toolSequence.length >= 2) {
          const failResult = await this.deps.selfEvolver.evolveFromFailure({
            goal: input.goal,
            taskType: intent.taskType,
            steps,
            toolSequence,
            success: false,
            summary: result.summary || verification.reason
          });

          if (failResult.skill && !failResult.skipped) {
            emit("skill.evolved", {
              skillName: failResult.skill.name,
              description: failResult.skill.description,
              triggers: failResult.skill.triggers
            });
            try {
              await this.deps.skills.loadFromDirectory("./.agent/skills");
            } catch { console.warn("[RUNTIME] Skill directory loading non-critical"); }
          }
        }
      } catch (e: any) {
        console.log(`[RUNTIME] Failure evolution skipped: ${e.message}`);
      }
    }

    // SmartEscalation: track task end
    this.deps.smartEscalation?.trackTaskEnd(taskId);

    // Finalize state machine
    sm.toDone();
    syncContext();
    sm.deletePersisted().catch(() => {});

    // Attach thought-tree summary for observability
    if (this.thoughtTree) {
      try {
        (result as any).thoughtTreeSummary = this.thoughtTree.summarize();
        (result as any).thoughtTreeBestPath = this.thoughtTree.getBestPathSteps();
      } catch (err) { console.warn("[RUNTIME] Thought tree summary failed: " + (err instanceof Error ? err.message : String(err))); }
      this.thoughtTree = null;
      this.thoughtTreeNode = null;
    }

    emit("state.change", { state: sm.getState(), taskId });

    // Emit SSE completion event so web UI stops polling
    emit(result.success ? "task.completed" : "task.failed", { result });
    this.deps.logger?.info("task completed", {
      taskId: result.taskId,
      success: result.success,
      steps: result.steps.length,
      tokens: result.totalTokens,
      summary: result.summary.slice(0, 200),
    });
    return result;
  }

  /**
   * Thought-Tree branching: Given the current state and the model's proposed tool calls,
   * generate alternative candidate actions, evaluate all via model-as-judge, and return
   * the best branch's tool calls. Falls back to original if tree planner fails.
   */
  async branchWithTree(
    model: string,
    goal: string,
    originalToolCalls: ToolCall[],
    currentState: string,
    executedToolNames: Set<string>,
    taskId: string
  ): Promise<ToolCall[]> {
    if (!this.deps.thoughtTreeEnabled) return originalToolCalls;
    if (originalToolCalls.length === 0) return originalToolCalls;

    try {
      const tree = this.thoughtTree;
      const parentNode = this.thoughtTreeNode;
      const numBranches = 3;
      const prompt = buildBranchingPrompt(goal, currentState, "", numBranches);

      const response = await this._timedComplete({ model, messages: [{ role: "user", content: prompt }] });
      this._emitUsage(response.usage);
      const branches = parseBranchEvaluations(response.content, numBranches);

      if (branches.length === 0) return originalToolCalls;

      // Include original as a candidate
      const allCandidates: BranchEvaluation[] = [
        ...branches,
        {
          planText: "Original model plan",
          toolCalls: originalToolCalls,
          reasoning: "Model's direct choice",
          expectedQuality: 5,
          riskLevel: "medium"
        }
      ];

      const scored = scoreBranches(allCandidates, executedToolNames);

      // Register branches in the MCTS tree for cross-cycle learning
      if (tree && parentNode && !tree.isAtMaxDepth(parentNode) && !tree.shouldStop()) {
        for (const branch of scored) {
          tree.addBranch(parentNode, branch.planText, branch.toolCalls);
        }
        // Use UCB1 selection (balances exploitation + exploration across cycles)
        const selected = tree.selectBestChild(parentNode);
        if (selected && selected.toolCalls.length > 0) {
          this.thoughtTreeNode = selected;
          console.log(`[ThoughtTree] UCB1 selected: tools=${selected.toolCalls.map(tc => tc.function.name).join(",")}, depth=${selected.depth}, visits=${selected.visits}`);
          this.deps.progress?.emit(taskId, {
            type: "thought.branch",
            payload: { selected: selected.toolCalls.map(tc => tc.function.name), depth: selected.depth, candidates: scored.map(s => ({ tools: s.toolCalls.map(tc => tc.function.name), score: s.expectedQuality })) },
            at: new Date().toISOString()
          });
          return selected.toolCalls;
        }
      }

      // Fallback: stateless scoring (no tree or tree exhausted)
      scored.sort((a, b) => b.expectedQuality - a.expectedQuality);
      const best = scored[0]!;
      console.log(`[ThoughtTree] Best branch (stateless): score=${best.expectedQuality}, tools=${best.toolCalls.map(tc => tc.function.name).join(",")}`);

      if (best.toolCalls.length > 0 && best.expectedQuality > 0.6) {
        return best.toolCalls;
      }

      // All branches scored poorly — notify the main loop
      console.log(`[ThoughtTree] All branches scored poorly (best=${best.expectedQuality}), falling back to original`);
      this.deps.progress?.emit(taskId, {
        type: "thought.all_branches_bad",
        payload: {
          reason: "All generated branches scored below quality threshold",
          bestScore: best.expectedQuality,
          candidates: scored.map(s => ({ tools: s.toolCalls.map(tc => tc.function.name), score: s.expectedQuality }))
        },
        at: new Date().toISOString()
      });

      return originalToolCalls;
    } catch (err) {
      console.log(`[ThoughtTree] Branching failed, using original: ${err instanceof Error ? err.message : String(err)}`);
      return originalToolCalls;
    }
  }

  updateDefaults(models: { plannerModel?: string; executorModel?: string; criticModel?: string }): void {
    if (models.plannerModel) this.deps.plannerModel = models.plannerModel;
    if (models.executorModel) this.deps.executorModel = models.executorModel;
    if (models.criticModel) this.deps.criticModel = models.criticModel;
  }
}
