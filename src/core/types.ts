export type ModelKind = "local" | "cloud";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** OpenAI-compatible: maps to tool_call_id in API */
  toolCallId?: string;
  name?: string;
  /** DeepSeek thinking mode: must be passed back to API if present */
  reasoning_content?: string;
  /** Native tool calls from assistant messages */
  toolCalls?: ToolCall[];
}

export interface ModelRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Function definitions for structured tool calling */
  tools?: FunctionDefinition[];
}

export interface ModelResponse {
  model: string;
  content: string;
  /** DeepSeek thinking mode: must be passed back as reasoning_content in subsequent messages */
  reasoning_content?: string;
  toolCalls?: ToolCall[];
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  metadata?: Record<string, unknown>;
}

// ─── Function Calling ──────────────────────────────────────────────────────────

export interface ToolParamProperty {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  enum?: string[];
  items?: ToolParamProperty;
  properties?: Record<string, ToolParamProperty>;
  required?: string[];
  additionalProperties?: boolean | ToolParamProperty;
  default?: unknown;
}

export interface ToolParam {
  type: "object";
  properties: Record<string, ToolParamProperty>;
  required?: string[];
}

export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters: ToolParam;
}

export interface ToolCall {
  id: string;
  function: { name: string; arguments: string };
}

export interface ToolCallResult {
  toolCallId: string;
  functionName: string;
  output: unknown;
  error?: string;
}

export interface ToolCallResponse {
  toolCalls: ToolCall[];
}

export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  toolCalls?: ToolCall[];
}

export interface ModelStreamChunk {
  /** Content delta (incremental text) */
  content: string;
  /** Tool calls accumulated during streaming (only present when stream is done or tool call is complete) */
  toolCalls?: ToolCall[];
  /** Whether this is the final chunk */
  done: boolean;
  /** Error message if streaming failed */
  error?: string;
}

export interface ModelProvider {
  readonly kind: ModelKind;
  readonly name: string;
  complete(request: ModelRequest): Promise<ModelResponse>;
  /** Stream completion results as async iterable. Default implementation falls back to non-streaming. */
  completeStream?(request: ModelRequest): AsyncIterable<ModelStreamChunk>;
}

export type PermissionScope =
  | "filesystem.read"
  | "filesystem.write"
  | "shell.exec"
  | "web.fetch"
  | "code.exec";

export interface ToolContext {
  now: Date;
  taskId: string;
  taskLineageId: string;
  goal?: string;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  description: string;
  requiredScopes: PermissionScope[];
  riskLevel?: "low" | "medium" | "high";
  /** JSON Schema describing the input shape, used for structured function calling */
  inputSchema?: ToolParam;
  execute(input: TInput, context: ToolContext): Promise<TOutput>;
  /** Optional streaming variant — yields progress chunks during long execution */
  executeStream?(input: TInput, context: ToolContext, onProgress: (chunk: ToolStreamChunk) => void): Promise<TOutput>;
}

export interface ToolStreamChunk {
  type: "progress" | "output" | "error";
  content: string;
  percent?: number;
}

export interface TaskInput {
  goal: string;
  taskId?: string;
  taskLineageId?: string;
  taskType?: TaskType;
  outputFormat?: OutputFormat;
  attachments?: TaskAttachment[];
  modelOverrides?: TaskModelOverrides;
  /** Optional callback — runtime polls this to check if a pause was requested */
  checkPause?: () => Promise<boolean>;
  /** Optional callback — runtime polls this to check if cancellation was requested */
  checkCancel?: () => Promise<boolean>;
  /** Execution mode: single task or multi-agent project */
  executionMode?: ExecutionMode;
  /** Multi-agent collaboration strategy (project mode only) */
  collaborationMode?: CollaborationMode;
  /** How the execution mode is determined */
  modeTrigger?: ModeTrigger;
  /** Project context: previous task summaries, key files, project goal */
  projectContext?: string;
  projectDirectory?: string;
}

export type TaskType =
  | "auto"
  | "general"
  | "research"
  | "product_research"
  | "presentation"
  | "code"
  | "automation"
  | "data_analysis"
  | "media_analysis"
  | "image_generation"
  | "video_generation"
  | "voice_generation"
  | "social_publish"
  | "weather"
  | "financial_analysis"
  | "legal_review"
  | "hr_recruitment"
  | "engineering_design"
  | "content_marketing"
  | "customer_support"
  | "education"
  | "healthcare"
  | "real_estate"
  | "video_editing"
  | "podcast_production";

export type OutputFormat =
  | "auto"
  | "chat"
  | "markdown"
  | "pdf"
  | "slides"
  | "data"
  | "image"
  | "video"
  | "audio"
  | "publish_package";

export type ExecutionMode = "task" | "project";
export type CollaborationMode = "dag-pipeline" | "master-worker";
export type ModeTrigger = "auto" | "manual";

export interface TaskModelOverrides {
  plannerModel?: string;
  executorModel?: string;
  criticModel?: string;
}

export interface TaskAttachment {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "audio" | "video" | "document" | "data" | "other";
  path: string;
  size: number;
}

export interface ExecutionStep {
  step: number;
  action: string;
  tool?: string;
  result?: unknown;
  reasoning?: string;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  summary: string;
  content?: string;
  verificationReason?: string;
  steps: ExecutionStep[];
  artifacts?: TaskArtifact[];
  totalTokens?: number;
}

export interface TaskArtifact {
  id: string;
  name: string;
  kind: "markdown" | "pdf" | "slides" | "data" | "html" | "image" | "video" | "audio" | "publish_package" | "file";
  path: string;
  url?: string;
  mimeType: string;
  size?: number;
}
