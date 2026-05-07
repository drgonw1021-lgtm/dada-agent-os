import { z } from "zod";
import type { PermissionScope } from "./core/types.js";
import type { ApprovalPolicyPreset } from "./governance/approval-policy.js";
import { loadEnvironmentFiles } from "./env.js";

const EnvSchema = z.object({
  LOCAL_MODEL_ENDPOINT: z.string().default("http://127.0.0.1:11434"),
  LMSTUDIO_ENDPOINT: z.string().default("http://127.0.0.1:1234/v1"),
  VLLM_ENDPOINT: z.string().default("http://127.0.0.1:8000/v1"),
  LLAMA_CPP_ENDPOINT: z.string().default("http://127.0.0.1:8080/v1"),
  CLOUD_MODEL_ENDPOINT: z.string().default("https://integrate.api.nvidia.com/v1"),
  CLOUD_API_KEY: z.string().optional(),
  COMFYUI_ENDPOINT: z.string().default("http://127.0.0.1:8188"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  OPENAI_TTS_MODEL: z.string().default("gpt-4o-mini-tts"),
  OPENAI_TTS_VOICE: z.string().default("alloy"),
  PLANNER_MODEL: z.string().default("builtin:default"),
  EXECUTOR_MODEL: z.string().optional(),
  CRITIC_MODEL: z.string().optional(),
  MODELS_DIR: z.string().default("./models"),
  BUILTIN_GPU: z
    .enum(["auto", "false", "metal", "cuda", "vulkan"])
    .default("false")
    .transform((value) => (value === "false" ? false : value)),
  AUTO_DETECT_MODELS: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() === "true"),
  GRANTED_SCOPES: z.string().default("filesystem.read,filesystem.write,shell.exec,web.fetch,code.exec"),
  ALLOW_HIGH_RISK_TOOLS: z
    .string()
    .default("false")
    .transform((value) => value.toLowerCase() === "true"),
  MAX_PLANNING_CYCLES: z.coerce.number().int().min(1).max(20).default(3),
  MAX_STEPS: z.coerce.number().int().min(1).max(100).default(12),
  MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(30).default(4),
  EXPERIENCE_STORE_PATH: z.string().default("./.agent/experiences.json"),
  AUTOMATION_STORE_PATH: z.string().default("./.agent/automations.json"),
  TASK_STORE_PATH: z.string().default("./.agent/tasks.json"),
  MEDIA_JOB_STORE_PATH: z.string().default("./.agent/media-jobs.json"),
  APPROVAL_STORE_PATH: z.string().default("./.agent/approvals.json"),
  UPLOADS_DIR: z.string().default("./.agent/uploads"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().min(1).default(10_485_760),
  ARTIFACTS_DIR: z.string().default("./.agent/artifacts"),
  GENERATED_MEDIA_DIR: z.string().default("./.agent/generated"),
  AUTOMATION_POLL_MS: z.coerce.number().int().min(5000).default(30000),
  MAX_CONCURRENT_TASKS: z.coerce.number().int().min(1).max(4).default(1),
  MAX_CONCURRENT_PER_PROJECT: z.coerce.number().int().min(0).max(4).default(3),
  MAX_TASK_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  FAILURE_REPLAY_LIMIT: z.coerce.number().int().min(1).max(20).default(3),
  REQUIRE_APPROVAL_FOR_HIGH_RISK: z
    .string()
    .default("true")
    .transform((value) => value.toLowerCase() === "true"),
  APPROVAL_POLICY_PRESET: z.enum(["strict", "balanced", "permissive"]).default("balanced"),
  APPROVAL_AUTO_ALLOW_COMMANDS: z.string().default(""),
  READ_ROOTS: z.string().default("."),
  WRITE_ROOTS: z.string().default("."),
  SHELL_ALLOWLIST: z.string().default("node,npm,pnpm,npx,yarn,git,python,python3,pip,pip3,pytest,ls,dir,cat,type,echo,pwd,cd,head,tail,wc,find,findstr,grep,rg,mkdir,md,rmdir,rd,del,copy,move,xcopy,ren,rename,touch,cp,mv,rm,curl,wget,tar,zip,unzip,powershell,pwsh,where,which,whoami,hostname,set,uname,tee,sort,uniq,cut,tr,diff,du,df,chmod,chown,ln,printenv,env,ipconfig,ping,netstat,tasklist,taskkill,systeminfo,xdg-user-dir,date,cal,awk,sed,gcc,g++,make,cmake"),
  WEB_ALLOWLIST: z.string().default("*"),
  DISABLE_VERIFIER: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
  /** 启用 Thought-Tree 规划器 (MCTS 深度推理，默认关闭，实验性) */
  THOUGHT_TREE_ENABLED: z
    .string()
    .default("false")
    .transform((v) => v.toLowerCase() === "true"),
  /** 多平台 Bot 配置: JSON array of {platform, enabled, token?, appId?, appSecret?, webhookPath?} */
  BOTS_JSON: z.string().default("[]"),
  /** ClaWHub 技能安装目录 */
  SKILLHUB_DIR: z.string().default("./.agent/skillhub"),
  MCP_DATA_DIR: z.string().default("./.agent/mcp"),
  /** skillhub CLI 路径，默认自动检测 npx */
  SKILLHUB_CLI_PATH: z.string().default("npx"),
  /** UI 和提示语言: zh 或 en */
  LOCALE: z.enum(["zh", "en"]).default("en"),
  /** Brave Search API key (2000 free queries/month at https://brave.com/search/api/) */
  BRAVE_SEARCH_API_KEY: z.string().optional(),
  /** Serper.dev Google Search API key (2500 free queries/month at https://serper.dev) */
  SERPER_API_KEY: z.string().optional(),
  /** SearXNG self-hosted meta-search endpoint (e.g. http://192.168.1.100:8888). Only used when set. */
  SEARXNG_ENDPOINT: z.string().optional()
});

export interface AppConfig {
  envFiles: string[];
  localModelEndpoint: string;
  lmstudioEndpoint: string;
  vllmEndpoint: string;
  llamaCppEndpoint: string;
  cloudModelEndpoint: string;
  cloudApiKey?: string;
  comfyuiEndpoint: string;
  openaiImageModel: string;
  openaiTtsModel: string;
  openaiTtsVoice: string;
  plannerModel: string;
  executorModel: string;
  criticModel: string;
  modelsDir: string;
  builtinGpu: false | "auto" | "metal" | "cuda" | "vulkan";
  autoDetectModels: boolean;
  grantedScopes: Set<PermissionScope>;
  allowHighRiskTools: boolean;
  maxPlanningCycles: number;
  maxSteps: number;
  maxToolCalls: number;
  experienceStorePath: string;
  automationStorePath: string;
  taskStorePath: string;
  mediaJobStorePath: string;
  approvalStorePath: string;
  uploadsDir: string;
  maxUploadBytes: number;
  artifactsDir: string;
  generatedMediaDir: string;
  automationPollMs: number;
  maxConcurrentTasks: number;
  maxConcurrentPerProject: number;
  maxTaskRetries: number;
  failureReplayLimit: number;
  requireApprovalForHighRisk: boolean;
  approvalPolicyPreset: ApprovalPolicyPreset;
  approvalAutoAllowCommands: string[];
  readRoots: string[];
  writeRoots: string[];
  shellAllowlist: string[];
  webAllowlist: string[];
  disableVerifier: boolean;
  thoughtTreeEnabled: boolean;
  skillhubDir: string;
  skillhubCliPath: string;
  bots: Array<{ platform: string; enabled: boolean; token?: string; appId?: string; appSecret?: string; webhookPath?: string }>;
  mcpDataDir: string;
  locale: "zh" | "en";
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const envFiles = loadEnvironmentFiles(env);
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const parsed = result.data;
  return {
    envFiles,
    localModelEndpoint: parsed.LOCAL_MODEL_ENDPOINT,
    lmstudioEndpoint: parsed.LMSTUDIO_ENDPOINT,
    vllmEndpoint: parsed.VLLM_ENDPOINT,
    llamaCppEndpoint: parsed.LLAMA_CPP_ENDPOINT,
    cloudModelEndpoint: parsed.CLOUD_MODEL_ENDPOINT,
    cloudApiKey: parsed.CLOUD_API_KEY,
    comfyuiEndpoint: parsed.COMFYUI_ENDPOINT,
    openaiImageModel: parsed.OPENAI_IMAGE_MODEL,
    openaiTtsModel: parsed.OPENAI_TTS_MODEL,
    openaiTtsVoice: parsed.OPENAI_TTS_VOICE,
    plannerModel: parsed.PLANNER_MODEL,
    executorModel: parsed.EXECUTOR_MODEL ?? parsed.PLANNER_MODEL,
    criticModel: parsed.CRITIC_MODEL ?? parsed.EXECUTOR_MODEL ?? parsed.PLANNER_MODEL,
    modelsDir: parsed.MODELS_DIR,
    builtinGpu: parsed.BUILTIN_GPU,
    autoDetectModels: parsed.AUTO_DETECT_MODELS,
    grantedScopes: new Set(
      parsed.GRANTED_SCOPES.split(",").map((scope) => scope.trim() as PermissionScope)
    ),
    allowHighRiskTools: parsed.ALLOW_HIGH_RISK_TOOLS,
    maxPlanningCycles: parsed.MAX_PLANNING_CYCLES,
    maxSteps: parsed.MAX_STEPS,
    maxToolCalls: parsed.MAX_TOOL_CALLS,
    experienceStorePath: parsed.EXPERIENCE_STORE_PATH,
    automationStorePath: parsed.AUTOMATION_STORE_PATH,
    taskStorePath: parsed.TASK_STORE_PATH,
    mediaJobStorePath: parsed.MEDIA_JOB_STORE_PATH,
    approvalStorePath: parsed.APPROVAL_STORE_PATH,
    uploadsDir: parsed.UPLOADS_DIR,
    maxUploadBytes: parsed.MAX_UPLOAD_BYTES,
    artifactsDir: parsed.ARTIFACTS_DIR,
    generatedMediaDir: parsed.GENERATED_MEDIA_DIR,
    automationPollMs: parsed.AUTOMATION_POLL_MS,
    maxConcurrentTasks: parsed.MAX_CONCURRENT_TASKS,
    maxConcurrentPerProject: parsed.MAX_CONCURRENT_PER_PROJECT,
    maxTaskRetries: parsed.MAX_TASK_RETRIES,
    failureReplayLimit: parsed.FAILURE_REPLAY_LIMIT,
    requireApprovalForHighRisk: parsed.REQUIRE_APPROVAL_FOR_HIGH_RISK,
    approvalPolicyPreset: parsed.APPROVAL_POLICY_PRESET,
    approvalAutoAllowCommands: parsed.APPROVAL_AUTO_ALLOW_COMMANDS.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    readRoots: parsed.READ_ROOTS.split(",").map((value) => value.trim()).filter(Boolean),
    writeRoots: parsed.WRITE_ROOTS.split(",").map((value) => value.trim()).filter(Boolean),
    shellAllowlist: parsed.SHELL_ALLOWLIST.split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    webAllowlist: parsed.WEB_ALLOWLIST.split(",").map((value) => value.trim()).filter(Boolean),
    disableVerifier: parsed.DISABLE_VERIFIER,
    thoughtTreeEnabled: parsed.THOUGHT_TREE_ENABLED,
    skillhubDir: parsed.SKILLHUB_DIR,
    mcpDataDir: parsed.MCP_DATA_DIR,
    skillhubCliPath: parsed.SKILLHUB_CLI_PATH,
    bots: JSON.parse(parsed.BOTS_JSON || "[]"),
    locale: parsed.LOCALE,
  };
}
