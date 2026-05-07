import { existsSync, mkdirSync } from "node:fs";
import { loadConfig } from "./config.js";
import { t } from "./core/i18n.js";
import { ApprovalStore } from "./governance/approval-store.js";
import { AuditLog } from "./governance/audit-log.js";
import { PermissionGate } from "./governance/permission-gate.js";
import { RiskPolicy } from "./governance/risk-policy.js";
import { SandboxPolicy } from "./governance/sandbox-policy.js";
import { ExperienceStore } from "./memory/experience-store.js";
import { StrategyAdvisor } from "./memory/strategy-advisor.js";
import { MemorySystem } from "./memory/memory-system.js";
import { TaskMemoryStore } from "./memory/task-memory-store.js";
import { SemanticMemory } from "./memory/semantic-memory.js";
import { EmbeddingService } from "./memory/embedding-service.js";
import { MemoryConsolidator } from "./memory/memory-consolidator.js";
import { AutomationRegistry } from "./automation/automation-registry.js";
import { ModelRouter } from "./model/model-router.js";
import { ModelManager, createModelManager } from "./model/model-manager.js";
import { CloudProvider } from "./model/providers/cloud-provider.js";
import { LocalProvider } from "./model/providers/local-provider.js";
import { OpenAICompatibleProvider } from "./model/providers/openai-compatible-provider.js";
import { getDomainEngine, DomainEngine } from "./domains/index.js";
import ProgressManager from "./progress-manager.js";
import { createDomainTool, DOMAIN_TOOL_SPECS } from "./tools/builtin/domain-generic-tool.js";
import { BuiltInModelProvider } from "./model/providers/builtin-provider.js";
import { SkillLoader } from "./skills/skill-loader.js";
import { createClawhubRuntime, ClawhubRuntime } from "./skills/clawhub-runtime.js";
import { createClawhubSearchTool, createClawhubInstallTool } from "./tools/builtin/clawhub-tool.js";
import { AgentRuntime } from "./runtime/agent-runtime.js";
import { createLogger } from "./observability/logger.js";

import { SelfEvolver } from "./runtime/self-evolver.js";
import { SelfImprover } from "./runtime/self-improver.js";
import { CheckpointManager } from "./runtime/checkpoint-manager.js";
import { AgentRegistry } from "./agents/agent-registry.js";
import { DelegationManager } from "./agents/delegation-protocol.js";
import { ContextBus } from "./agents/context-bus.js";
import { AgentHost } from "./agents/agent-host.js";
import { AgentMonitor } from "./agents/agent-monitor.js";
import { StrategyEvaluator } from "./governance/strategy-evaluator.js";
import { createAgentDelegateTool, createAgentListTool } from "./tools/builtin/agent-delegate-tool.js";
import { KnowledgeBase } from "./knowledge/knowledge-base.js";
import { createKnowledgeSearchTool } from "./tools/builtin/knowledge-search-tool.js";
import { BotManager } from "./bots/bot-manager.js";
import { SocialPublishBridge } from "./bots/social-publish-bridge.js";
import type { BotConfig } from "./bots/bot-interface.js";
import { AutonomousEngine } from "./operations/autonomous-engine.js";
import { SmartEscalation } from "./operations/smart-escalation.js";
import { NotificationBridge } from "./operations/notification-bridge.js";
import { ExternalTriggers } from "./operations/external-triggers.js";
import type { NotificationChannel } from "./operations/notification-bridge.js";
import { echoTool } from "./tools/builtin/echo-tool.js";
import { createFileReadTool } from "./tools/builtin/file-read-tool.js";
import { createFileWriteTool } from "./tools/builtin/file-write-tool.js";
import { createShellExecTool } from "./tools/builtin/shell-exec-tool.js";
import { createWebFetchTool } from "./tools/builtin/web-fetch-tool.js";
import { createEnhancedFileTool } from "./tools/builtin/enhanced-file-tool.js";
import { createCodeExecTool } from "./tools/builtin/code-exec-tool.js";
import { createSearchTool } from "./tools/builtin/search-tool.js";
import { createUapiSearchTool } from "./tools/builtin/uapi-search-tool.js";
import { createUapiTranslateTool } from "./tools/builtin/uapi-translate-tool.js";
import { createWeatherTool } from "./tools/builtin/weather-tool.js";
import { createChartTool } from "./tools/builtin/chart-tool.js";
import { createMcpSearchTool } from "./tools/builtin/mcp-search-tool.js";
import { createMcpInstallTool } from "./tools/builtin/mcp-install-tool.js";
import { createMcpListTool } from "./tools/builtin/mcp-list-tool.js";
import { createMcpManager } from "./mcp/mcp-manager.js";
import { createApiRequestTool } from "./tools/builtin/api-request-tool.js";
import { createTaskPlannerTool } from "./tools/builtin/task-planner-tool.js";
import { createModelTool } from "./tools/builtin/model-tool.js";
import { createSkillCreateTool } from "./tools/builtin/skill-create-tool.js";
import { createGenerativeMediaTool } from "./tools/builtin/generative-media-tool.js";
import { createComfyTemplateTool } from "./tools/builtin/comfy-template-tool.js";
import { createCodeAgentTool } from "./tools/builtin/code-agent-tool.js";
import { createPublishPackageTool } from "./tools/builtin/social-publish-tool.js";
import {
  createCodeGeneratorTool,
  createCodeImproverTool
} from "./tools/builtin/code-generator-tool.js";
import { createSelfImproveTool } from "./tools/builtin/self-improve-tool.js";
import { createToolProvisioner } from "./tools/builtin/tool-provisioner.js";
import { createPdfReadTool } from "./tools/builtin/pdf-read-tool.js";
import { ToolRegistry } from "./tools/tool-registry.js";
import type { ModelProvider, ToolDefinition, TaskInput } from "./core/types.js";
import { getProviderNameForModel } from "./model/provider-utils.js";

export interface AgentAppResult {
  config: ReturnType<typeof loadConfig>;
  runtime: AgentRuntime;
  experiences: ExperienceStore;
  memory: MemorySystem;
  taskMemory: TaskMemoryStore;
  semanticMemory: SemanticMemory;
  audit: AuditLog;
  skills: SkillLoader;
  clawhubRuntime: ClawhubRuntime;
  modelManager: ModelManager;
  selfEvolver: SelfEvolver;
  selfImprover: SelfImprover;
  checkpointManager: CheckpointManager;
  agentRegistry: AgentRegistry;
  agentMonitor: AgentMonitor;
  strategyEvaluator: StrategyEvaluator;
  delegationManager: DelegationManager;
  contextBus: ContextBus;
  knowledgeBase: KnowledgeBase;
  mainAgentHost: AgentHost;
  publishBridge: SocialPublishBridge;
  botManager: BotManager;
  autonomousEngine: AutonomousEngine;
  smartEscalation: SmartEscalation;
  notificationBridge: NotificationBridge;
  externalTriggers: ExternalTriggers;
  embeddingService: EmbeddingService;
  memoryConsolidator: MemoryConsolidator;
  tools: ToolRegistry;
  availableTools: string[];
  availableToolsDetailed: Array<{ id: string; description: string; riskLevel?: string; available: boolean; unavailableReason?: string }>;
  capabilityReport: { total: number; available: number; unavailable: Array<{ id: string; reason: string }> };
  providers: ModelProvider[];
  domainEngine: DomainEngine;
  progressManager: ProgressManager;
  automationRegistry: AutomationRegistry;
  approvalStore: ApprovalStore;
  riskPolicy: RiskPolicy;
  reconfigureModels: (input: {
    plannerModel?: string;
    executorModel?: string;
    criticModel?: string;
    cloudModelEndpoint?: string;
    cloudApiKey?: string;
    localModelEndpoint?: string;
    lmstudioEndpoint?: string;
    vllmEndpoint?: string;
    llamaCppEndpoint?: string;
    comfyuiEndpoint?: string;
  }) => void;
}

export async function createAgentApp(env: NodeJS.ProcessEnv): Promise<AgentAppResult> {
  const config = loadConfig(env);
  const locale = config.locale;

  const modelManager = createModelManager({
    modelsDir: config.modelsDir,
    builtinGpu: config.builtinGpu
  });
  await modelManager.initialize();

  const builtinProvider = new BuiltInModelProvider({ modelManager });
  const localProvider = new LocalProvider({ endpoint: config.localModelEndpoint });
  const lmstudioProvider = new OpenAICompatibleProvider({ providerName: "lmstudio", endpoint: config.lmstudioEndpoint, includeTools: true });
  const vllmProvider = new OpenAICompatibleProvider({ providerName: "vllm", endpoint: config.vllmEndpoint, includeTools: true });
  const llamaCppProvider = new OpenAICompatibleProvider({ providerName: "llama-cpp", endpoint: config.llamaCppEndpoint, includeTools: true });

  const localProviders: ModelProvider[] = [
    localProvider,
    lmstudioProvider,
    vllmProvider,
    llamaCppProvider,
    builtinProvider
  ];

  const cloudProvider = new CloudProvider({
    endpoint: config.cloudModelEndpoint,
    apiKey: config.cloudApiKey
  });

  const allProviders = [...localProviders, cloudProvider];
  // Domain engine and domain tool for vertical tasks
  const domainEngine = getDomainEngine();
  domainEngine.register({ id: "market-analysis", name: "Market Analysis", keywords: ["market", "分析"] });
  domainEngine.register({ id: "product-design", name: "Product Design", keywords: ["设计", "调研"] });
  domainEngine.register({ id: "financial-analysis", name: "Financial Analysis", keywords: ["财务", "投资"] });
  domainEngine.register({ id: "legal-review", name: "Legal Review", keywords: ["法务", "合同"] });
  domainEngine.register({ id: "hr-recruitment", name: "HR Recruitment", keywords: ["招聘", "HR"] });
  domainEngine.register({ id: "engineering-design", name: "Engineering Design", keywords: ["工程", "架构"] });
  domainEngine.register({ id: "content-marketing", name: "Content Marketing", keywords: ["内容", "营销"] });
  domainEngine.register({ id: "customer-support", name: "Customer Support", keywords: ["客服", "售后"] });
  const modelStatus = modelManager.getStatus();

  const router = new ModelRouter(allProviders, [
    { match: (r) => r.model.startsWith("builtin:"), providerName: "builtin" },
    {
      match: (r) => r.model.startsWith("ollama:") || r.model.startsWith("local:"),
      providerName: "ollama-compatible"
    },
    { match: (r) => r.model.startsWith("lmstudio:"), providerName: "lmstudio" },
    { match: (r) => r.model.startsWith("vllm:"), providerName: "vllm" },
    { match: (r) => r.model.startsWith("llama-cpp:") || r.model.startsWith("llamacpp:"), providerName: "llama-cpp" },
    { match: (r) => r.model.startsWith("cloud:"), providerName: "openai-compatible" },
    {
      match: () => true,
      providerName: getProviderNameForModel(config.plannerModel, {
        builtinAvailable: modelStatus.builtinReady,
        cloudAvailable: Boolean(config.cloudApiKey)
      })
    }
  ]);

  const gate = new PermissionGate(config.grantedScopes);
  const riskPolicy = new RiskPolicy({
    allowHighRisk: config.allowHighRiskTools,
    requireApprovalForHighRisk: config.requireApprovalForHighRisk,
    approvalPolicyPreset: config.approvalPolicyPreset,
    approvalAutoAllowCommands: config.approvalAutoAllowCommands
  });
  const sandboxPolicy = new SandboxPolicy({
    readRoots: config.readRoots,
    writeRoots: config.writeRoots,
    shellAllowlist: config.shellAllowlist,
    webAllowlist: config.webAllowlist
  });

  const approvalStore = new ApprovalStore(config.approvalStorePath);
  const tools = new ToolRegistry(gate, riskPolicy, approvalStore);
  tools.register(echoTool);
  tools.register(createFileReadTool(sandboxPolicy, modelManager));
  tools.register(createPdfReadTool());
  tools.register(createFileWriteTool(sandboxPolicy));
  tools.register(createShellExecTool(sandboxPolicy));
  tools.register(createWebFetchTool(sandboxPolicy));
  // Register all 8 domain workflow tools from specs
  for (const spec of DOMAIN_TOOL_SPECS) {
    tools.register(createDomainTool(spec));
  }

  const { createVoiceTool } = await import("./tools/builtin/voice-tool.js");
  tools.register(createVoiceTool());

  const { createOcrTool } = await import("./tools/builtin/ocr-tool.js");
  tools.register(createOcrTool());

  const { createVisionTool } = await import("./tools/builtin/vision-tool.js");
  tools.register(createVisionTool(modelManager));

  const progress = new ProgressManager();
  tools.register(createEnhancedFileTool(config.readRoots, config.writeRoots));
  tools.register(createCodeExecTool(sandboxPolicy));
  tools.register(createApiRequestTool(config.webAllowlist));

  const createModelCompleter = (getModel: () => string) => async (prompt: string): Promise<string> => {
    const response = await router.complete({
      model: getModel(),
      messages: [{ role: "user", content: prompt }]
    });
    return response.content;
  };

  const plannerCompleter = createModelCompleter(() => config.plannerModel);
  const executorCompleter = createModelCompleter(() => config.executorModel);

  // Search tool with AI relevance filter
  tools.register(createSearchTool(executorCompleter));

  // UAPI aggregated search (multi-engine: Bing + Baidu + etc.)
  tools.register(createUapiSearchTool());

  // UAPI AI translation
  tools.register(createUapiTranslateTool());

  // Weather tool (Open-Meteo free API)
  tools.register(createWeatherTool());

  // Chart generation tool (QuickChart.io — no headless browser needed)
  tools.register(createChartTool());

  // ── MCP Dynamic Loading (self-configuration) ─────────────────────
  // DaDa can discover, install, and use MCP servers at runtime.
  // This is how it fills its own capability gaps.
  const mcpManager = createMcpManager(config.mcpDataDir || "./.agent/mcp");
  tools.setMcpManager(mcpManager);
  tools.register(createMcpSearchTool());
  tools.register(createMcpInstallTool(mcpManager));
  tools.register(createMcpListTool(mcpManager));
  tools.register(createToolProvisioner());

  // Set domain engine completer for LLM-powered workflows
  domainEngine.setCompleter(plannerCompleter);

  // Wire search into domain engine so workflows can pull real data
  domainEngine.setSearchFunction(async (query, maxResults = 5) => {
    const result = await tools.execute("search", { query, maxResults, type: "web" }, {
      now: new Date(), taskId: "domain-search", taskLineageId: "domain-search", goal: query
    }) as { results?: Array<{ title: string; url?: string; content: string; snippet?: string; relevance?: number }> };
    return result.results || [];
  });

  tools.register(createTaskPlannerTool(plannerCompleter));
  tools.register(createCodeGeneratorTool(config.writeRoots, executorCompleter));
  tools.register(createCodeImproverTool(config.readRoots, config.writeRoots, executorCompleter));
  tools.register(createSelfImproveTool(config.writeRoots, executorCompleter));
  tools.register(createCodeAgentTool(process.cwd(), plannerCompleter));
  tools.register(createModelTool(modelManager));
  tools.register(createSkillCreateTool());
  tools.register(createPublishPackageTool("./.agent/publish-packages", () => publishBridge));
  tools.register(createComfyTemplateTool());
  tools.register(
    createGenerativeMediaTool({
      comfyuiEndpoint: config.comfyuiEndpoint,
      cloudModelEndpoint: config.cloudModelEndpoint,
      openaiApiKey: config.cloudApiKey,
      openaiImageModel: config.openaiImageModel,
      openaiTtsModel: config.openaiTtsModel,
      openaiTtsVoice: config.openaiTtsVoice,
      outputDir: config.generatedMediaDir
    })
  );

  // Optional tools — each may be unavailable depending on platform / optional deps
  const optionalTools: Array<{
    module: string;
    factory: string;
    label: string;
    args?: unknown[];
  }> = [
    { module: "./tools/builtin/browser-tool.js", factory: "createBrowserTool", label: "Browser automation" },
    { module: "./tools/builtin/desktop-tool.js", factory: "createDesktopTool", label: "Desktop automation" },
    { module: "./tools/builtin/system-tool.js", factory: "createSystemTool", label: "System tool" },
    { module: "./tools/builtin/network-tool.js", factory: "createNetworkTool", label: "Network tool" },
    { module: "./tools/builtin/media-tool.js", factory: "createMediaTool", label: "Media tool" },
    { module: "./tools/builtin/git-tool.js", factory: "createGitTool", label: "Git tool" },
    { module: "./tools/builtin/database-tool.js", factory: "createDatabaseTool", label: "Database tool" },
    { module: "./tools/builtin/notify-tool.js", factory: "createNotifyTool", label: "Notify tool" },
    { module: "./tools/builtin/excel-tool.js", factory: "createExcelTool", label: "Excel tool" },
    { module: "./tools/builtin/ssh-tool.js", factory: "createSSHTool", label: "SSH tool" },
    { module: "./tools/builtin/docker-tool.js", factory: "createDockerTool", label: "Docker tool" }
  ];

  for (const opt of optionalTools) {
    try {
      const mod = await import(opt.module);
      const factoryFn = mod[opt.factory] as (...a: unknown[]) => ToolDefinition;
      tools.register(factoryFn(...(opt.args ?? [])));
    } catch {
      const reason = `${opt.label} not available`;
      console.log(`[Tools] ${reason}`);
      tools.markUnavailable(opt.label.replace(/\s+/g, "-").toLowerCase(), reason);
    }
  }

  // ── Run capability checks on registered tools ────────────────────────
  const capResults = await tools.runCapabilityChecks([
    { id: "vision", check: async () => {
      const { checkVisionCapability } = await import("./tools/builtin/vision-tool.js");
      return checkVisionCapability(modelManager);
    }},
    { id: "voice", check: async () => {
      const { checkVoiceCapability } = await import("./tools/builtin/voice-tool.js");
      return checkVoiceCapability();
    }},
    { id: "ocr", check: async () => {
      const { checkOcrCapability } = await import("./tools/builtin/ocr-tool.js");
      return checkOcrCapability();
    }},
    { id: "gen.media", check: async () => {
      const { checkGenerativeMediaCapability } = await import("./tools/builtin/generative-media-tool.js");
      return checkGenerativeMediaCapability({
        comfyuiEndpoint: config.comfyuiEndpoint,
        cloudModelEndpoint: config.cloudModelEndpoint,
        openaiApiKey: config.cloudApiKey,
        openaiImageModel: config.openaiImageModel,
        openaiTtsModel: config.openaiTtsModel,
        openaiTtsVoice: config.openaiTtsVoice,
        outputDir: config.generatedMediaDir
      });
    }},
    { id: "browser", check: async () => {
      const { checkBrowserCapability } = await import("./tools/builtin/browser-tool.js");
      return checkBrowserCapability();
    }},
    { id: "docker", check: async () => {
      const { checkDockerCapability } = await import("./tools/builtin/docker-tool.js");
      return checkDockerCapability();
    }},
    { id: "git", check: async () => {
      const { checkGitCapability } = await import("./tools/builtin/git-tool.js");
      return checkGitCapability();
    }},
    { id: "database", check: async () => {
      const { checkDatabaseCapability } = await import("./tools/builtin/database-tool.js");
      return checkDatabaseCapability();
    }}
  ]);
  for (const r of capResults) {
    if (!r.available) console.log(`[Tools] ${r.id}: ${r.reason}`);
  }
  console.log(`[Tools] Capability check: ${capResults.filter(r => r.available).length}/${capResults.length} tools available`);

  const audit = new AuditLog();
  await audit.initialize();
  const experiences = new ExperienceStore(config.experienceStorePath);
  const automationRegistry = new AutomationRegistry(config.automationStorePath);
  const memory = new MemorySystem("./.agent/memory");
  await memory.initialize();

  // Phase 2: Task memory (L2) and Semantic memory (L4)
  const taskMemory = new TaskMemoryStore("./.agent/task-memory.json");
  await taskMemory.initialize();
  const semanticMemory = new SemanticMemory("./.agent/semantic-memory.json");
  await semanticMemory.initialize();

  // Phase 5: RAG knowledge base (L5) — workspace file indexing
  const workspaceDir = config.writeRoots[0] ?? process.cwd();
  const knowledgeBase = new KnowledgeBase({
    workspaceDir,
    scan: { includeExtensions: [".ts", ".tsx", ".js", ".jsx", ".md", ".json", ".yaml", ".yml", ".py", ".html", ".css", ".env", ".toml", ".cfg"] }
  });
  // Load existing index if available, does not block startup
  knowledgeBase.load().catch(() => {});
  // Auto-index workspace files on first run or when index is stale (non-blocking)
  void (async () => {
    try {
      const stats = knowledgeBase.getStats();
      if (stats.indexedFiles === 0) {
        console.log("[APP] Knowledge base empty, indexing workspace...");
        const result = await knowledgeBase.index();
        console.log(`[APP] Knowledge base indexed: ${result.filesIndexed} files, ${result.chunksCreated} chunks`);
      }
    } catch { /* non-critical */ }
  })();

  const advisor = new StrategyAdvisor();

  const skills = new SkillLoader();
  await skills.loadFromDirectory("./skills");
  await skills.loadFromDirectory("./.agent/skills");

  // ClaWHub skill ecosystem
  const clawhubRuntime = createClawhubRuntime(config.skillhubDir, config.skillhubCliPath);
  await clawhubRuntime.initialize();
  // Load ClaWHub skills into SkillLoader so capability router can see them
  await skills.loadFromClawhub(clawhubRuntime.listSkills());
  tools.register(createClawhubSearchTool(clawhubRuntime));
  tools.register(createClawhubInstallTool(clawhubRuntime));
  // Register all clawhub skill scripts as tools
  for (const toolDef of clawhubRuntime.getToolDefinitions()) {
    tools.register(toolDef);
  }

  console.log(`[APP] config.plannerModel = ${config.plannerModel}, executor = ${config.executorModel}, critic = ${config.criticModel}`);

  const selfEvolver = new SelfEvolver({
    reflector: plannerCompleter,
    skillsDir: "./.agent/skills",
    minToolSteps: 3,
    minSuccessCount: 2
  });

  // ── Multi-Agent Collaboration (Phase 4) ──────────────────────────────
  const agentRegistry = new AgentRegistry(30000);
  agentRegistry.start();
  const delegationManager = new DelegationManager(2);
  const contextBus = new ContextBus();

  // Main agent host — can delegate subtasks to worker agents
  const makeTaskExecutor = (defaultTaskType: string) => async (task: any) => {
    try {
      const result = await runtime.runTask({
        goal: task.goal,
        taskType: (task.taskType || defaultTaskType) as TaskInput["taskType"],
        outputFormat: task.outputFormat as TaskInput["outputFormat"],
      });
      return {
        delegationId: "",
        status: result.success ? "completed" as const : "failed" as const,
        result: result.summary,
        error: result.success ? undefined : result.verificationReason,
        steps: result.steps.map((s: any) => ({
          action: s.action,
          tool: s.tool,
          output: s.reasoning?.substring(0, 200)
        })),
        retries: 0,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString()
      };
    } catch (e: any) {
      return { delegationId: "", status: "failed" as const, error: e.message, retries: 0 };
    }
  };

  const mainAgentHost = new AgentHost({
    name: "dada-main",
    role: "coordinator",
    capabilities: ["planning", "research", "code", "file_operations", "media", "web"],
    maxConcurrency: 3,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("general")
  });

  // ── Multi-Agent Workers ──────────────────────────────────────────
  // Each worker specializes in a different company function.
  // The coordinator delegates to them based on task type and required capabilities.

  const researcherHost = new AgentHost({
    name: "dada-researcher",
    role: "worker",
    capabilities: ["search", "web-fetch", "data-analysis", "research", "reporting", "market-analysis"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("research")
  });

  const engineerHost = new AgentHost({
    name: "dada-engineer",
    role: "worker",
    capabilities: ["code", "shell", "file-write", "testing", "debugging", "git", "deployment"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("code")
  });

  const mediaHost = new AgentHost({
    name: "dada-media",
    role: "worker",
    capabilities: ["image-generation", "video-generation", "voice", "chart", "design", "visual", "media-editing"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("image_generation")
  });

  const reviewerHost = new AgentHost({
    name: "dada-reviewer",
    role: "critic",
    capabilities: ["verification", "quality-check", "proofreading", "audit", "approval", "code-review"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("general")
  });

  const financeHost = new AgentHost({
    name: "dada-finance",
    role: "worker",
    capabilities: ["financial-analysis", "data-analysis", "valuation", "forecasting", "investment", "chart"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("financial_analysis")
  });

  const legalHost = new AgentHost({
    name: "dada-legal",
    role: "worker",
    capabilities: ["legal-research", "contract-review", "compliance", "risk-assessment", "regulatory"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("legal_review")
  });

  const hrHost = new AgentHost({
    name: "dada-hr",
    role: "worker",
    capabilities: ["recruitment", "job-analysis", "screening", "onboarding", "training", "compensation"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("hr_recruitment")
  });

  const designerHost = new AgentHost({
    name: "dada-designer",
    role: "worker",
    capabilities: ["architecture", "system-design", "tech-stack", "api-design", "deployment", "requirements"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("engineering_design")
  });

  const marketerHost = new AgentHost({
    name: "dada-marketer",
    role: "worker",
    capabilities: ["content-strategy", "audience-analysis", "seo", "content-calendar", "distribution", "analytics"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("content_marketing")
  });

  const supportHost = new AgentHost({
    name: "dada-support",
    role: "worker",
    capabilities: ["customer-support", "faq", "quality-assurance", "knowledge-base", "sla", "training"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("customer_support")
  });

  const educationHost = new AgentHost({
    name: "dada-education",
    role: "worker",
    capabilities: ["education", "curriculum-design", "teaching", "assessment", "pedagogy", "e-learning"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("education")
  });

  const healthcareHost = new AgentHost({
    name: "dada-healthcare",
    role: "worker",
    capabilities: ["healthcare", "diagnosis", "treatment-planning", "health-management", "medical-research", "patient-education"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("healthcare")
  });

  const realEstateHost = new AgentHost({
    name: "dada-real-estate",
    role: "worker",
    capabilities: ["real-estate", "property-valuation", "market-analysis", "investment-strategy", "property-management", "transaction-support"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("real_estate")
  });

  const videoEditorHost = new AgentHost({
    name: "dada-video-editor",
    role: "worker",
    capabilities: ["video-editing", "storyboard", "color-grading", "audio-mixing", "motion-graphics", "export-rendering"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("video_editing")
  });

  const podcastHost = new AgentHost({
    name: "dada-podcast-producer",
    role: "worker",
    capabilities: ["podcast-production", "script-writing", "voice-generation", "audio-production", "rss-management", "show-notes"],
    maxConcurrency: 2,
    heartbeatIntervalMs: 10000,
    registry: agentRegistry,
    delegationManager,
    contextBus,
    taskExecutor: makeTaskExecutor("podcast_production")
  });

  // Register agent collaboration tools (now wired to the full mesh)
  tools.register(createAgentDelegateTool(mainAgentHost, agentRegistry));
  tools.register(createAgentListTool(agentRegistry));

  // AgentMonitor — health checks, stale detection, auto-recovery
  const agentMonitor = new AgentMonitor({
    registry: agentRegistry,
    contextBus,
    staleThresholdMs: 30000,
    checkIntervalMs: 10000,
    onStaleAgent: (agent, duration) => {
      console.warn(`[AgentMonitor] Stale agent: ${agent.name} (${agent.id}) offline ${(duration / 1000).toFixed(0)}s`);
    },
    onRecovered: (agent) => {
      console.log(`[AgentMonitor] Agent recovered: ${agent.name} (${agent.id})`);
    },
  });
  agentMonitor.start();

  // StrategyEvaluator — A/B compare execution strategies across task retries
  const strategyEvaluator = new StrategyEvaluator({ minRunsPerVariant: 2, qualityWeight: 0.7 });

  // Register knowledge base search tool
  tools.register(createKnowledgeSearchTool(knowledgeBase));

  const checkpointManager = new CheckpointManager("./.agent/checkpoints", 20);
  await checkpointManager.initialize();

  const logger = createLogger("runtime");

  // Forward-declare for closures (assigned below)
  let runtime: AgentRuntime;
  let autonomousEngine: AutonomousEngine;
  let smartEscalation: SmartEscalation;
  let notificationBridge: NotificationBridge;
  let externalTriggers: ExternalTriggers;
  let embeddingService: EmbeddingService;
  let memoryConsolidator: MemoryConsolidator;

  // ── Self-Improvement Loop (Phase 3) — created before runtime so runtime can feed it ─
  const selfImprover = new SelfImprover({
    evolver: selfEvolver,
    dataDir: "./.agent/self-improve",
    runBenchmarkTask: async (task) => {
      const result = await runtime.runTask({
        goal: task.goal,
        taskType: task.taskType as TaskInput["taskType"],
      });
      return {
        success: result.success,
        steps: result.steps.map(s => ({
          action: s.action,
          tool: s.tool,
          error: s.reasoning?.substring(0, 200),
        })),
        output: result.summary || "",
        stepCount: result.steps.length,
        toolCallCount: result.steps.filter(s => s.tool).length,
        totalTokens: result.totalTokens || 0,
        durationMs: 0,
      };
    },
  });
  selfImprover.registerDefaultBenchmarks();
  selfImprover.initialize().catch(() => {});

  // Start auto benchmark cycle: run 10min after startup, then every 24 hours
  // When regressions are detected, auto-attempt fixes via SelfEvolver (max 2 attempts per regression)
  selfImprover.startAutoMode({
    initialDelayMs: 600_000, // 10 min — let user tasks finish first
    intervalMs: 24 * 3_600_000, // 24 hours
    autoFix: true,
    maxFixAttempts: 2,
  });

  // ── Smart Escalation ──────────────────────────────────────────────────
  smartEscalation = new SmartEscalation({
    minToolConfidence: 0.6,
    maxConsecutiveFailures: 3,
    maxTaskDurationMs: 30 * 60_000,
    maxEstimatedCost: 0.5,
    levels: {
      lowConfidence: "confirm",
      repeatedFailure: "notify",
      timeout: "notify",
      highCost: "confirm",
    },
  });

  runtime = new AgentRuntime({
    router,
    tools,
    audit,
    plannerModel: config.plannerModel,
    executorModel: config.executorModel,
    criticModel: config.criticModel,
    maxPlanningCycles: config.maxPlanningCycles,
    maxSteps: config.maxSteps,
    maxToolCalls: config.maxToolCalls,
    experiences,
    advisor,
    skills,
    domainEngine,
    progress,
    disableVerifier: config.disableVerifier,
    taskMemory,
    semanticMemory,
    selfEvolver,
    selfImprover,
    logger,
    knowledgeBase,
    thoughtTreeEnabled: config.thoughtTreeEnabled,
    checkpointManager,
    smartEscalation,
    strategyEvaluator,
    // Subgoal executor: delegates subgoals to worker agents (company model)
    subgoalExecutor: async (subgoal: string, _parentTaskId: string) => {
      try {
        const result = await mainAgentHost.delegateTask(
          { goal: subgoal, context: subgoal },
          { timeoutMs: 120000 }
        );
        const output: string = typeof result.result === "string" ? result.result : String(result.error ?? "");
        return {
          subgoalId: "",
          success: result.status === "completed",
          output,
          toolSteps: result.steps?.map((s, i) => ({
            step: i,
            action: s.action || "execute",
            tool: s.tool,
            result: s.output || "",
          })),
        };
      } catch (e: any) {
        const errMsg: string = e.message || "unknown error";
        return { subgoalId: "", success: false, output: errMsg };
      }
    },
  });

  // Detect local model endpoints for accurate readiness reporting (non-blocking, best-effort)
  void (async () => {
    try {
      const { detectAvailableProviders } = await import("./model/local-model-auto.js");
      const available = await detectAvailableProviders();
      const names = available.map(e => e.name);
      modelManager.setDetectedEndpoints(names);
      if (names.length > 0) {
        console.log(`[APP] Detected local model endpoints: ${names.join(", ")}`);
      }
    } catch { /* local detection is best-effort */ }
  })();

  // Warmup: prime the model connection at startup (non-blocking, best-effort)
  void runtime.completeWithModel(config.plannerModel, [
    { role: "user", content: "ping" }
  ]).catch(() => {});

  // Wire scheduler tool to also feed into autonomous engine (forward-refs runtime + autonomousEngine)
  const autonomousSchedulerExecutor = async (name: string, _actionName: string, _input: Record<string, unknown>) => {
    if (name.includes(":")) {
      const [objName] = name.split(":");
      const objectives = autonomousEngine.listObjectives();
      const obj = objectives.find(o => o.name === objName);
      if (obj) {
        const result = await runtime.runTask({ goal: `[Autonomous:${obj.name}] ${(_input as any)?.goal || name}` });
        if (result.taskId) {
          await autonomousEngine.recordTaskResult(obj.id, name, result.success, result.summary);
        }
        return result;
      }
    }
    return runtime.runTask({ goal: `[Scheduled] ${name}` });
  };

  // Register scheduler with runtime executor so cron/interval tasks actually fire
  try {
    const { createSchedulerTool } = await import("./tools/builtin/scheduler-tool.js");
    tools.register(
      createSchedulerTool(autonomousSchedulerExecutor)
    );
  } catch {
    console.log("[Tools] Scheduler tool not available");
  }

  // ── Social Publishing Bridge ───────────────────────────────────────
  const publishBridge = new SocialPublishBridge({
    sessionsDir: "./.agent/sessions",
    draftsDir: "./.agent/drafts",
    headless: false,
    timeoutMs: 300000,
  });
  await publishBridge.initialize();

  // ── Multi-Channel Bots (Phase 4A) ─────────────────────────────────────
  const botManager = new BotManager({
    bots: (config.bots || []) as BotConfig[],
    onMessage: async (msg) => {
      // Run bot messages through the DaDa runtime
      const goal = `[${msg.platform}] ${msg.userName}: ${msg.text}`;
      try {
        const result = await runtime.runTask({
          goal,
          taskType: "general" as TaskInput["taskType"],
          taskLineageId: `bot-${msg.platform}-${msg.chatId}`
        });
        return {
          text: result.summary || "Task processed",
          markdown: true
        };
      } catch (e: any) {
        return { text: `Error: ${e.message}` };
      }
    }
  });
  // Initialize bots (non-blocking — bots connect in background)
  botManager.initialize().catch(err => {
    console.error(`[Bots] Initialization error: ${err.message}`);
  });

  // ── Notification Bridge ───────────────────────────────────────────────
  notificationBridge = new NotificationBridge({
    defaultChannels: ((config as any).notificationChannels as NotificationChannel[]) || ["system"],
    botManager,
    systemNotify: async (title, body) => {
      // Use the built-in system notification via child_process
      const { exec } = await import("node:child_process");
      const msg = `${title}: ${body}`;
      if (process.platform === "win32") {
        exec(`powershell -Command "Add-Type -AssemblyName System.Windows.Forms; (New-Object System.Windows.Forms.NotifyIcon){New-Object System.Windows.Forms.NotifyIcon}.Visible = $true; (New-Object System.Windows.Forms.NotifyIcon).ShowBalloonTip(5000, 'DaDa', '${msg.replace(/'/g, "''")}', 'Info')"`);
      } else if (process.platform === "darwin") {
        exec(`osascript -e 'display notification "${msg.replace(/"/g, "\\\"")}" with title "DaDa"'`);
      } else {
        exec(`notify-send "DaDa" "${msg.replace(/"/g, "\\\"")}"`);
      }
    },
  });

  // ── Autonomous Engine ─────────────────────────────────────────────────
  autonomousEngine = new AutonomousEngine({
    dataDir: "./.agent/autonomous",
    runTask: async (goal, taskType) => {
      const result = await runtime.runTask({ goal, taskType: taskType as TaskInput["taskType"] });
      return { taskId: result.taskId, success: result.success, summary: result.summary };
    },
    scheduleTask: async (name, cron, goal) => {
      // Use the SchedulerTool executor directly
      return `scheduled:${name}`;
    },
    removeScheduledTask: async (_name) => {
      // No-op if scheduler hasn't been registered yet
    },
  });
  await autonomousEngine.load();
  autonomousEngine.start();

  // ── Embedding Service ─────────────────────────────────────────────────
  embeddingService = new EmbeddingService({
    hashDimensions: 256,
    localEmbeddingEndpoint: config.localModelEndpoint || undefined,
  });

  // Try to enable local HTTP embeddings if an endpoint is available
  if (config.localModelEndpoint) {
    embeddingService.enableLocalHttp(config.localModelEndpoint);
  }

  // ── Memory Consolidator ───────────────────────────────────────────────
  memoryConsolidator = new MemoryConsolidator(embeddingService, {
    minClusterSize: 3,
    similarityThreshold: 0.75,
    maxAgeMs: 7 * 24 * 3600_000,
    maxInsights: 200,
  });

  // Load existing insights
  try {
    const { readFile } = await import("node:fs/promises");
    const insightsPath = "./.agent/memory/insights.json";
    const raw = await readFile(insightsPath, "utf8");
    memoryConsolidator.load(JSON.parse(raw));
  } catch { /* no insights yet */ }

  // ── External Triggers (Webhook Receiver) ──────────────────────────────
  externalTriggers = new ExternalTriggers({
    dataDir: "./.agent/triggers",
    onTrigger: async (goal, taskType, metadata) => {
      const result = await runtime.runTask({
        goal,
        taskType: taskType as TaskInput["taskType"],
      });
      return { taskId: result.taskId };
    },
  });
  await externalTriggers.initialize();

  const reconfigureModels: AgentAppResult["reconfigureModels"] = (input) => {
    if (typeof input.plannerModel === "string" && input.plannerModel.trim()) {
      config.plannerModel = input.plannerModel.trim();
    }
    if (typeof input.executorModel === "string" && input.executorModel.trim()) {
      config.executorModel = input.executorModel.trim();
    }
    if (typeof input.criticModel === "string" && input.criticModel.trim()) {
      config.criticModel = input.criticModel.trim();
    }
    if (typeof input.cloudModelEndpoint === "string" && input.cloudModelEndpoint.trim()) {
      config.cloudModelEndpoint = input.cloudModelEndpoint.trim();
      cloudProvider.configure({ endpoint: config.cloudModelEndpoint });
    }
    if ("cloudApiKey" in input) {
      config.cloudApiKey = input.cloudApiKey?.trim() || undefined;
      cloudProvider.configure({ apiKey: config.cloudApiKey });
    }
    if (typeof input.localModelEndpoint === "string" && input.localModelEndpoint.trim()) {
      config.localModelEndpoint = input.localModelEndpoint.trim();
      localProvider.configure({ endpoint: config.localModelEndpoint });
    }
    if (typeof input.lmstudioEndpoint === "string" && input.lmstudioEndpoint.trim()) {
      config.lmstudioEndpoint = input.lmstudioEndpoint.trim();
      lmstudioProvider.configure({ endpoint: config.lmstudioEndpoint });
    }
    if (typeof input.vllmEndpoint === "string" && input.vllmEndpoint.trim()) {
      config.vllmEndpoint = input.vllmEndpoint.trim();
      vllmProvider.configure({ endpoint: config.vllmEndpoint });
    }
    if (typeof input.llamaCppEndpoint === "string" && input.llamaCppEndpoint.trim()) {
      config.llamaCppEndpoint = input.llamaCppEndpoint.trim();
      llamaCppProvider.configure({ endpoint: config.llamaCppEndpoint });
    }
    if (typeof input.comfyuiEndpoint === "string" && input.comfyuiEndpoint.trim()) {
      config.comfyuiEndpoint = input.comfyuiEndpoint.trim();
    }

    runtime.updateDefaults({
      plannerModel: config.plannerModel,
      executorModel: config.executorModel,
      criticModel: config.criticModel
    });
  };

  // ── Proactive tool capability detection ────────────────────────────
  // Check conditional tools and mark unavailable if prerequisites are missing

  // Vision: needs multimodal GGUF loaded OR cloud API key
  const multimodalModels = modelManager.listModels().filter(m =>
    /llava|bakllava|llama.v|cogvlm|minicpm.v|phi.vision|fuyu|qwen.vl|paligemma|florence|internvl|gemma.3/i.test(m.id)
  );
  if (multimodalModels.length === 0 && !config.cloudApiKey) {
    tools.markUnavailable("vision", t("unavail.no_cloud_key", locale));
  }

  // Voice TTS: needs system TTS (say/espeak/SAPI) or cloud
  const hasSystemTts = process.platform === "darwin" // macOS say
    || process.platform === "linux" // espeak-ng
    || process.platform === "win32"; // Windows SAPI
  if (!hasSystemTts && !config.cloudApiKey) {
    tools.markUnavailable("voice.tts", t("unavail.no_system_tts", locale));
  }

  // Voice STT: needs whisper.cpp binary + model, or Python whisper
  let hasStt = false;
  try {
    const { execSync } = await import("node:child_process");
    execSync("whisper-cli --help 2>&1 || whisper --help 2>&1 || python -c \"import whisper\" 2>&1", {
      timeout: 5000, stdio: "pipe"
    });
    hasStt = true;
  } catch { hasStt = false; }
  if (!hasStt && !config.cloudApiKey) {
    tools.markUnavailable("voice.stt", t("unavail.no_whisper", locale));
  }

  // OCR: built-in tesseract.js WASM engine (auto-downloads language data)
  try {
    const { checkOcrCapability } = await import("./tools/builtin/ocr-tool.js");
    const ocrResult = await checkOcrCapability();
    if (!ocrResult.available) {
      tools.markUnavailable("ocr", ocrResult.reason ?? t("unavail.no_tesseract", locale));
    }
  } catch {
    tools.markUnavailable("ocr", t("unavail.no_tesseract", locale));
  }

  // Generative media: needs ComfyUI endpoint OR cloud API key
  const hasMediaBackend = config.comfyuiEndpoint || config.cloudApiKey;
  if (!hasMediaBackend) {
    tools.markUnavailable("gen.media", t("unavail.no_comfyui", locale));
  }

  // Print startup capability report
  const capabilityReport = tools.getCapabilityReport();
  console.log(`\n[APP] ====== ${t("startup.capability_report", locale)} ======`);
  console.log(`[APP]   ${t("startup.total", locale)}: ${capabilityReport.total} | ${t("startup.available", locale)}: ${capabilityReport.available} | ${t("startup.unavailable", locale)}: ${capabilityReport.unavailable.length}`);
  if (capabilityReport.unavailable.length > 0) {
    for (const u of capabilityReport.unavailable) {
      console.log(`[APP]   ✘ ${u.id} — ${u.reason}`);
    }
  }
  console.log(`[APP] ======================================\n`);

  return {
    config,
    runtime,
    experiences,
    memory,
    taskMemory,
    semanticMemory,
    audit,
    skills,
    clawhubRuntime,
    modelManager,
    selfEvolver,
    selfImprover,
    checkpointManager,
    agentRegistry,
    agentMonitor,
    strategyEvaluator,
    delegationManager,
    contextBus,
    knowledgeBase,
    mainAgentHost,
    publishBridge,
    botManager,
    autonomousEngine,
    smartEscalation,
    notificationBridge,
    externalTriggers,
    embeddingService,
    memoryConsolidator,
    tools,
    availableTools: tools.list().filter(t => t.available !== false).map((tool) => tool.id),
    availableToolsDetailed: tools.list(),
    providers: allProviders,
    domainEngine,
    capabilityReport,
    progressManager: progress,
    automationRegistry,
    approvalStore,
    riskPolicy,
    reconfigureModels
  };
}


