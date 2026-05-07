import type { OutputFormat, TaskAttachment, TaskInput, TaskType } from "../core/types.js";
import type { TaskRecord } from "./task-store.js";

export type DeliveryKind =
  | "research_report"
  | "decision_brief"
  | "slide_deck"
  | "implementation_patch"
  | "workflow_spec"
  | "data_pack"
  | "media_brief"
  | "image_asset"
  | "video_asset"
  | "voice_asset"
  | "social_publication"
  | "chat_response";

export interface TaskDeliveryContract {
  kind: DeliveryKind;
  audience: "decision" | "execution" | "analysis" | "operations" | "general";
  primaryArtifact: OutputFormat;
  artifactBundle: OutputFormat[];
  resultLabel: string;
  completionDefinition: string;
}

export type TaskComplexity = "simple" | "normal" | "complex";

export interface Persona {
  name: string;
  expertise: string;
  tone: string;
}

export interface TaskIntent {
  taskType: Exclude<TaskType, "auto">;
  outputFormat: OutputFormat;
  complexity?: TaskComplexity;
  workflowLabel: string;
  routingReason: string;
  preferredTools: string[];
  workflowSteps: string[];
  deliverables: string[];
  promptDirectives: string[];
  delivery: TaskDeliveryContract;
  persona: Persona;
}

const chinese = {
  presentation: /\u6f14\u793a|\u6c47\u62a5|\u8def\u6f14/,
  code: /\u4ee3\u7801|\u4fee\u590d|\u8c03\u8bd5|\u6784\u5efa|\u7a0b\u5e8f|\u51fd\u6570|\u811a\u672c|\u5f00\u53d1|\u7f16\u5199|\u524d\u7aef|\u540e\u7aef|\u63a5\u53e3|\u6a21\u5757|\u7ec4\u4ef6|\u5b9e\u73b0|\u5217\u51fa\u6587\u4ef6|\u8bfb\u53d6\u6587\u4ef6|\u67e5\u770b\u6587\u4ef6|\u76ee\u5f55|\u65b0\u5efa|\u521b\u5efa|\u6587\u4ef6\u5939|\u6587\u4ef6|\u5220\u9664|\u79fb\u52a8|\u590d\u5236|\u91cd\u547d\u540d|\u684c\u9762/,
  automation: /\u81ea\u52a8\u5316|\u5b9a\u65f6|\u6d41\u7a0b/,
  productResearch: /\u8c03\u7814|\u7ade\u54c1|\u5e02\u573a|\u7528\u6237\u7814\u7a76|\u4ea7\u54c1\u7814\u7a76|\u673a\u4f1a|\u7ba1\u7406\u5c42|\u51b3\u7b56/,
  productDecision: /\u4ea7\u54c1|\u5e02\u573a|\u673a\u4f1a|\u7ba1\u7406\u5c42|\u51b3\u7b56/,
  media: /\u56fe\u7247|\u56fe\u50cf|\u97f3\u9891|\u89c6\u9891/,
  imageGeneration: /\u751f\u56fe|\u753b\u56fe|\u63d2\u753b|\u56fe\u6807|\u751f\u6210.*\u5c01\u9762|\u505a.*\u5c01\u9762|\u8bbe\u8ba1.*\u5c01\u9762|\u5c01\u9762.*(\u56fe|\u8bbe\u8ba1|\u751f\u6210|\u5236\u4f5c)|generate.*(image|cover|icon|logo|illustration|poster)/,
  videoGeneration: /\u751f\u6210\u89c6\u9891|\u89c6\u9891\u751f\u6210|\u89c6\u9891\u811a\u672c|\u52a8\u753b/,
  voiceGeneration: /\u8bed\u97f3\u5408\u6210|\u914d\u97f3|\u6717\u8bfb|\u7535\u53f0\u97f3/,
  socialPublish: /\u53d1\u5e03|\u6296\u97f3|\u5feb\u624b|\u5c0f\u7ea2\u4e66|\u89c6\u9891\u53f7|\u516c\u4f17\u53f7|\u5934\u6761|\u53e3\u64ad|\u811a\u672c|\u6587\u6848/,
  recentNews: /\u6700\u8fd1|\u8fd1\u4e00\u5468|\u8fd17\u5929|\u65b0\u95fb|\u5927\u4e8b\u4ef6|\u70ed\u70b9/,
  weather: /\u5929\u6c14|\u6c14\u6e29|\u6e29\u5ea6|\u9884\u62a5|\u98ce\u5411|\u6e7f\u5ea6|\u964d\u6c34|\u66b4\u96e8|\u96ea|\u96fe|\u5929\u6c14\u9884\u62a5/,
  data: /\u6570\u636e|\u62a5\u8868|\u6307\u6807|\u5206\u6790|\u8868\u683c/,
  report: /\u62a5\u544a|\u8c03\u7814|\u7814\u7a76|\u6536\u96c6.*\u65b0\u95fb|\u65b0\u95fb.*\u6458\u8981|\u6c47\u603b|\u6574\u7406.*\u8d44\u6599|\u6536\u96c6.*\u4fe1\u606f/,
  // Simple search/lookup \u2014 NOT research (no report-writing intent)
  quickLookup: /\u641c\u7d22|\u67e5\u627e|\u67e5\u8be2|\u4e86\u89e3.*\u60c5\u51b5/,

  deck: /\u6f14\u793a|\u6c47\u62a5|\u8def\u6f14/,
  structuredData: /\u7ed3\u6784\u5316|\u6570\u636e\u96c6|\u8868\u683c/
} as const;

const english = {
  presentation: /\b(ppt|pptx|slides?|deck|presentation)\b/,
  code: /\b(code|build|compile|debug|bug\s*fix|hotfix|refactor|typescript|tsc|npm|write.*function|write.*program|write.*script|write.*code|implement|hello[ .]world|console\.log|print\(|function\s+\w+\s*\(|list.*file|list.*dir|show.*file|read.*file|show.*dir|\bls\b|\bdir\b|cat\s|list\s+files|create.*file|write.*file|make.*file|touch.*file|new.*file|save.*file|generate.*file|create.*folder|create.*dir|new.*folder|mkdir|file.*create|folder.*create|run.*test|write.*test|unit.*test|pytest|jest|mocha|(create|write|touch|save|make|new|generate)\s+\S+\.\w+|\w+\.(tsx?|jsx?|py|json|html?|css|ya?ml|toml|sh|bat|xml|csv|sql|log|env|cfg|ini)\b)\b/,
  automation: /\b(automation|schedule|cron|workflow)\b/,
  productResearch: /\b(research|benchmark|competitor|market|user study|product strategy|opportunity)\b/,
  productDecision: /\b(product|competitor|market|opportunity|strategy)\b/,
  media: /\b(image|photo|audio|video|ocr|speech)\b/,
  imageGeneration: /\b(generate image|image generation|illustration|cover image|poster|icon|logo|render)\b/,
  videoGeneration: /\b(generate video|video generation|animate|storyboard video|trailer)\b/,
  voiceGeneration: /\b(text to speech|tts|voiceover|narration|speech generation)\b/,
  socialPublish: /\b(publish|post|douyin|tiktok|kuaishou|rednote|xiaohongshu|youtube|shorts|account|voice script|spoken script|caption)\b/,
  recentNews: /\b(recent|latest|last week|past week|news|headlines|breaking|trend|hot topics)\b/,
  data: /\b(csv|excel|json|sql|dataset|analysis|dashboard|table)\b/,
  report: /\b(report|brief|research|collect.*news|collect.*information|news.*summary|news.*digest|summar(y|ize)|gather.*information|find.*news|find.*information)\b/,
  // Simple search/lookup — NOT research (no report-writing intent)
  quickLookup: /\b(search.*for|look\s*up|learn\s*about|find.*out\s+about|what\s+is|who\s+is|tell\s+me\s+about)\b/,
  deck: /\b(ppt|pptx|slides?|deck|presentation)\b/,
  structuredData: /\b(json|csv|table|dataset|data)\b/,
  weather: /\b(weather|forecast|temperature|humidity|rain|snow|wind|storm|climate|sunny|cloudy|rainy)\b/
} as const;

function hasAttachmentKind(
  attachments: TaskAttachment[] | undefined,
  kind: TaskAttachment["kind"]
): boolean {
  return Boolean(attachments?.some((item) => item.kind === kind));
}

function inferTaskType(
  goal: string,
  attachments: TaskAttachment[] | undefined,
  explicitType?: TaskType
): Exclude<TaskType, "auto"> {
  if (explicitType && explicitType !== "auto") {
    return explicitType;
  }

  const text = goal.toLowerCase();

  // Content-planning and media-gen context: must be defined before routing checks
  const isContentPlanning = /策划|选题|文案|内容运营|脚本.*策划|口播|短视频|账号运营|content\s*(plan|strategy|calendar)/i.test(text);
  const isMediaGenIntent = /生成.*(封面|图|图像|图片|海报|视频)|画图|生图|做.*(封面|图|海报)|(封面|图|图像|图片|海报|视频).*生成|generate.*(image|cover|poster|video)/i.test(text);

  if (
    (english.socialPublish.test(text) || chinese.socialPublish.test(text)) &&
    (english.recentNews.test(text) || chinese.recentNews.test(text) || /publish|post|发布/.test(text)) &&
    !isMediaGenIntent
  ) {
    return "social_publish";
  }

  if (english.presentation.test(text) || chinese.presentation.test(text)) {
    return "presentation";
  }
  if (english.imageGeneration.test(text) || (chinese.imageGeneration.test(text) && !isContentPlanning)) {
    return "image_generation";
  }

  if (english.videoGeneration.test(text) || (chinese.videoGeneration.test(text) && !isContentPlanning)) {
    return "video_generation";
  }

  if (english.voiceGeneration.test(text) || chinese.voiceGeneration.test(text)) {
    return "voice_generation";
  }

  if (english.automation.test(text) || chinese.automation.test(text)) {
    return "automation";
  }

  // Quick search/lookup without report-writing intent → general (fast, 1 cycle)
  // Only trigger when the user just wants to search/look up, not write a report
  const hasReportWriteIntent = /写.*(报告|文章|简报|文件|文档|摘要|总结|汇总|整理)|(报告|文章|简报|文件|文档|摘要|总结|汇总|整理).*写|创建.*(报告|文件|文档)|生成.*(报告|文件|文档|简报)|制作.*(报告|文件|文档)|保存.*文件|write.*(report|file|brief|summary|article)|create.*(report|file|document|brief)|generate.*(report|file|document|brief)|save.*(file|report)/i.test(text);
  const isQuickLookup = (english.quickLookup.test(text) || chinese.quickLookup.test(text));
  if (isQuickLookup && !hasReportWriteIntent && !english.report.test(text) && !chinese.report.test(text)) {
    return "general";
  }

  // "写一份报告" / "调研" / "研究AI趋势" → research, not general (check before code)
  if (english.report.test(text) || chinese.report.test(text) || (isQuickLookup && hasReportWriteIntent)) {
    return "research";
  }

  if (
    english.productResearch.test(text) ||
    chinese.productResearch.test(text)
  ) {
    return english.productDecision.test(text) || chinese.productDecision.test(text)
      ? "product_research"
      : "research";
  }

  if (english.code.test(text) || chinese.code.test(text)) {
    return "code";
  }

  if (
    hasAttachmentKind(attachments, "image") ||
    hasAttachmentKind(attachments, "audio") ||
    hasAttachmentKind(attachments, "video") ||
    english.media.test(text) ||
    chinese.media.test(text)
  ) {
    return "media_analysis";
  }

  if (
    hasAttachmentKind(attachments, "data") ||
    english.data.test(text) ||
    chinese.data.test(text)
  ) {
    return "data_analysis";
  }

  if (english.weather.test(text) || chinese.weather.test(text)) {
    return "weather";
  }

  // Domain-specific task types
  if (/财务|投资|估值|营收|现金流|财报|金融|理财|利润|成本分析/.test(text) ||
      /\b(financial|investment|valuation|revenue|cash\s*flow|balance\s*sheet|profit|loss|equity|ROI|NPV|IRR|portfolio|asset)\b/i.test(text)) {
    return "financial_analysis";
  }

  if (/法律|合同|合规|法务|法规|诉讼|条款|审查|版权|专利|商标/.test(text) ||
      /\b(legal|contract|compliance|law|litigation|clause|patent|copyright|trademark|GDPR|regulatory)\b/i.test(text)) {
    return "legal_review";
  }

  if (/招聘|面试|入职|人事|职位描述|人才|薪资|绩效|员工|培训/.test(text) ||
      /\b(recruit|hire|HR|human\s*resource|job\s*description|onboard|salary|compensation|performance\s*review|talent)\b/i.test(text)) {
    return "hr_recruitment";
  }

  if (/工程设计|架构设计|技术方案|系统设计|需求分析|模块划分|接口设计|数据流/.test(text) ||
      /\b(engineering\s*design|architecture\s*design|system\s*design|tech\s*stack|module\s*design|API\s*design|data\s*flow|deployment\s*plan)\b/i.test(text)) {
    return "engineering_design";
  }

  if (/内容营销|自媒体|内容策略|涨粉|受众|内容日历|内容规划|内容运营/.test(text) ||
      /\b(content\s*marketing|content\s*strategy|content\s*calendar|audience\s*growth|SEO\s*content|blog\s*strategy)\b/i.test(text)) {
    return "content_marketing";
  }

  if (/客服|知识库|话术|质检|投诉|售后|客户服务/.test(text) ||
      /\b(customer\s*support|customer\s*service|FAQ|knowledge\s*base|call\s*center|help\s*desk|quality\s*assurance|SLA)\b/i.test(text)) {
    return "customer_support";
  }

  return "general";
}

function inferComplexity(
  goal: string,
  taskType: Exclude<TaskType, "auto">
): TaskComplexity {
  // Weather and general tasks are always simple (fast path)
  if (taskType === "weather" || taskType === "general") return "simple";

  const text = goal.toLowerCase();

  // Multi-phase indicators: chain of actions across research → produce → publish
  const multiPhaseCN = /(?:搜索|查找|收集|调研|研究|分析).*(?:然后|之后|接着|并|并且|再|同时).*(?:写|创建|制作|生成|发布|推送|上传)/;
  const multiPhaseEN = /(?:search|research|find|collect|analyze|gather).*(?:then|after|and\s+(?:also\s+)?|finally).*(?:write|create|make|generate|publish|post|upload|produce)/;
  const closedLoopCN = /(?:制作|生成|发布|推送).*(?:视频|图片|文章|报告|新闻|内容|帖子)/;
  const closedLoopEN = /(?:publish|post|upload|produce|create).*(?:video|image|article|report|news|content)/;
  const multiDeliverable = /(?:both|and\s+also).*(?:and|&)/;

  if (multiPhaseCN.test(text) || multiPhaseEN.test(text)) return "complex";
  if (closedLoopCN.test(text) || closedLoopEN.test(text)) return "complex";
  // Research tasks that also require writing/producing output
  if ((taskType === "research" || taskType === "product_research") && multiDeliverable.test(text)) return "complex";
  // Code tasks that involve multiple steps across the full SDLC
  if (taskType === "code" && /(?:build|deploy|publish|release|dockerize|ci.cd|test.*and.*deploy)/.test(text)) return "complex";
  // Social publish with research component
  if (taskType === "social_publish" && /(?:research|search|find|collect|调研).*(?:then|然后|and)/.test(text)) return "complex";

  return "normal";
}

function inferOutputFormat(
  goal: string,
  taskType: Exclude<TaskType, "auto">,
  explicit?: OutputFormat
): OutputFormat {
  if (explicit && explicit !== "auto") {
    return explicit;
  }

  const text = goal.toLowerCase();

  if (/\b(pdf)\b|pdf/.test(text)) {
    return "pdf";
  }

  if (english.deck.test(text) || chinese.deck.test(text)) {
    return "slides";
  }

  if (english.structuredData.test(text) || chinese.structuredData.test(text)) {
    return "data";
  }

  switch (taskType) {
    case "presentation":
      return "slides";
    case "image_generation":
      return "image";
    case "video_generation":
      return "video";
    case "voice_generation":
      return "audio";
    case "social_publish":
      return "publish_package";
    case "product_research":
    case "research":
    case "weather":
      return "markdown";
    case "data_analysis":
      return "data";
    case "general":
      return "chat";
    case "automation":
    case "media_analysis":
    case "code":
    default:
      return "markdown";
  }
}

function inferDeliveryContract(params: {
  goal: string;
  taskType: Exclude<TaskType, "auto">;
  outputFormat: OutputFormat;
}): TaskDeliveryContract {
  const text = params.goal.toLowerCase();

  if (params.taskType === "presentation" || params.outputFormat === "slides" || english.deck.test(text) || chinese.deck.test(text)) {
    return {
      kind: "slide_deck",
      audience: "decision",
      primaryArtifact: "slides",
      artifactBundle: ["markdown", "slides", "pdf"],
      resultLabel: "presentation deck",
      completionDefinition: "Provide a slide-structured result with a storyline, key points, and downloadable presentation artifacts."
    };
  }

  if (params.taskType === "image_generation") {
    return {
      kind: "image_asset",
      audience: "analysis",
      primaryArtifact: "image",
      artifactBundle: ["image"],
      resultLabel: "generated image asset",
      completionDefinition: "Provide a usable generated image file or image job result."
    };
  }

  if (params.taskType === "video_generation") {
    return {
      kind: "video_asset",
      audience: "analysis",
      primaryArtifact: "video",
      artifactBundle: ["video"],
      resultLabel: "generated video asset",
      completionDefinition: "Provide a usable generated video file or queued generation job result."
    };
  }

  if (params.taskType === "voice_generation") {
    return {
      kind: "voice_asset",
      audience: "analysis",
      primaryArtifact: "audio",
      artifactBundle: ["audio"],
      resultLabel: "generated voice asset",
      completionDefinition: "Provide a usable speech audio file."
    };
  }

  if (params.taskType === "social_publish") {
    return {
      kind: "social_publication",
      audience: "operations",
      primaryArtifact: "publish_package",
      artifactBundle: ["markdown", "data", "publish_package"],
      resultLabel: "platform-ready publishing package",
      completionDefinition: "Provide sourced news notes, a spoken script, caption/tags, publishing checklist, and only publish after platform login/session and explicit approval are available."
    };
  }

  if (params.taskType === "media_analysis") {
    return {
      kind: "media_brief",
      audience: "analysis",
      primaryArtifact: "markdown",
      artifactBundle: ["markdown", "data"],
      resultLabel: "multimodal analysis brief",
      completionDefinition: "Provide extracted evidence, key observations, confidence notes, and a usable summary from the uploaded media."
    };
  }

  if (params.taskType === "weather") {
    return {
      kind: "research_report",
      audience: "analysis",
      primaryArtifact: "markdown",
      artifactBundle: ["markdown"],
      resultLabel: "weather report",
      completionDefinition: "Provide current weather conditions and forecast with source attribution."
    };
  }

  if (params.taskType === "product_research" || params.taskType === "research" || english.report.test(text) || chinese.report.test(text)) {
    return {
      kind: params.taskType === "product_research" ? "decision_brief" : "research_report",
      audience: "decision",
      primaryArtifact: "pdf",
      artifactBundle: params.taskType === "product_research" ? ["markdown", "pdf", "slides"] : ["markdown", "pdf"],
      resultLabel: params.taskType === "product_research" ? "decision-ready product brief" : "research report",
      completionDefinition: "Provide a structured report with conclusions, evidence, and recommendations, not just raw notes."
    };
  }

  if (params.taskType === "data_analysis" || params.outputFormat === "data") {
    return {
      kind: "data_pack",
      audience: "analysis",
      primaryArtifact: "data",
      artifactBundle: ["data", "markdown"],
      resultLabel: "data analysis pack",
      completionDefinition: "Provide structured data output plus a short narrative explaining key findings."
    };
  }

  if (params.taskType === "general") {
    return {
      kind: "chat_response",
      audience: "general",
      primaryArtifact: "markdown",
      artifactBundle: [],
      resultLabel: "direct conversational response",
      completionDefinition: "Respond directly and concisely. Do NOT create files, plans, or workflows unless explicitly asked."
    };
  }

  if (params.taskType === "automation") {
    return {
      kind: "workflow_spec",
      audience: "operations",
      primaryArtifact: "markdown",
      artifactBundle: ["markdown"],
      resultLabel: "automation workflow specification",
      completionDefinition: "Provide a repeatable workflow spec including trigger, steps, safeguards, and expected outputs."
    };
  }

  if (params.taskType === "code") {
    return {
      kind: "implementation_patch",
      audience: "execution",
      primaryArtifact: "markdown",
      artifactBundle: ["markdown"],
      resultLabel: "implementation and verification summary",
      completionDefinition: "Provide concrete changes, verification status, and remaining engineering risks."
    };
  }

  return {
    kind: "research_report",
    audience: "decision",
    primaryArtifact: "markdown",
    artifactBundle: ["markdown"],
    resultLabel: "structured task result",
    completionDefinition: "Provide a structured outcome that a human can directly use."
  };
}

export function resolveTaskIntent(
  input: Pick<TaskInput, "goal" | "taskType" | "outputFormat" | "attachments">
): TaskIntent {
  const taskType = inferTaskType(input.goal, input.attachments, input.taskType);
  const outputFormat = inferOutputFormat(input.goal, taskType, input.outputFormat);
  const delivery = inferDeliveryContract({
    goal: input.goal,
    taskType,
    outputFormat
  });

  const shared = {
    complexity: "normal" as TaskComplexity,
    workflowLabel: "General mission flow",
    routingReason: "Use a general structured workflow with planning, execution, verification, and packaging.",
    preferredTools: ["task.planner", "uapi.search", "search", "web.fetch", "api.request"],
    workflowSteps: [
      "Clarify the task intent and success criteria",
      "Collect evidence or operate tools",
      "Synthesize findings into a usable deliverable",
      "Verify completeness and consistency",
      "Package artifacts for download"
    ],
    deliverables: ["A concise executive summary", "A traceable execution log"],
    promptDirectives: [
      "Adapt the workflow to the task type instead of giving a generic chat answer.",
      "Produce a final deliverable that can be packaged as a file artifact.",
      "Choose the final result shape based on the mission outcome, not only on format keywords."
    ],
    persona: { name: "智能助手" as const, expertise: "通用任务处理", tone: "专业务实，直接高效" }
  } satisfies Omit<TaskIntent, "taskType" | "outputFormat" | "delivery">;

  const byType: Record<Exclude<TaskType, "auto">, Omit<TaskIntent, "taskType" | "outputFormat" | "delivery">> = {
    general: {
      workflowLabel: "General conversation",
      routingReason: "Simple conversational query — respond directly without over-planning.",
      preferredTools: ["uapi.search", "uapi.search", "search", "web.fetch", "fs.write_file"],
      workflowSteps: [
        "Understand what the user is asking",
        "Respond directly and helpfully"
      ],
      deliverables: ["Direct conversational response"],
      promptDirectives: [
        "This is a SIMPLE conversational query — respond in 1 cycle.",
        "Do NOT call task.planner for a simple conversation.",
        "Do NOT create files or run shell commands unless explicitly asked.",
        "Answer directly in a helpful, conversational tone.",
        "Keep your response brief and to the point."
      ],
      persona: { name: "智能助手", expertise: "快速准确地回答各类问题", tone: "简洁直接，友好务实" }
    },
    research: {
      workflowLabel: "Research workflow",
      routingReason: "Prioritize evidence gathering, comparison, synthesis, and a readable report with visual elements.",
      preferredTools: ["uapi.search", "uapi.search", "search", "web.fetch", "api.request", "task.planner", "fs.write_file", "gen.chart", "mcp.search", "mcp.install"],
      workflowSteps: [
        "Define the scope and research questions",
        "Check if search quality is adequate; if not, use mcp.search/mcp.install to get better search tools",
        "Collect and compare sources or evidence (use search, web.fetch)",
        "Generate charts for key data points using gen.chart",
        "Write findings to a report file using fs.write_file",
        "Package the result as report artifacts"
      ],
      deliverables: ["Executive summary", "Data tables with charts", "Findings by theme", "Recommendations", "Source citations"],
      promptDirectives: [
        "Write in report structure, not casual chat.",
        "Generate charts for market data, comparisons, and trends using gen.chart.",
        "If search results are poor, install a real search MCP (Brave/Serper) via mcp.search → mcp.install.",
        "Explicitly separate findings, evidence, and recommendations."
      ],
      persona: { name: "专业市场研究员", expertise: "数据收集、竞品分析、趋势研判、报告撰写", tone: "专业严谨，数据驱动，结论明确" }
    },
    product_research: {
      workflowLabel: "Product research workflow",
      routingReason: "Prioritize market landscape, user value, competitors, positioning, and recommendations.",
      preferredTools: ["uapi.search", "search", "web.fetch", "api.request", "task.planner", "domain.market-analysis", "domain.product-design", "gen.chart", "mcp.search", "mcp.install"],
      workflowSteps: [
        "Clarify product scope, audience, and business question",
        "Check if search quality is adequate; upgrade via MCP if needed",
        "Collect market, competitor, and positioning signals",
        "Generate comparison charts and market share visuals",
        "Summarize opportunities, risks, pricing, and GTM implications",
        "Produce a decision-ready brief and presentation-ready output"
      ],
      deliverables: [
        "Executive summary",
        "Market/competitor analysis with charts",
        "User needs and positioning",
        "Product recommendations",
        "A presentation-ready outline"
      ],
      promptDirectives: [
        "Behave like a product strategy analyst.",
        "Generate visual charts (market share, competitor comparison) using gen.chart.",
        "Make the result presentation-ready with clear section headings and bullet points.",
        "Do not stop at raw notes; convert them into a decision document."
      ],
      persona: { name: "产品战略分析师", expertise: "市场格局洞察、用户价值分析、竞品定位、GTM 建议", tone: "战略视角，数据支撑，结论可执行" }
    },
    presentation: {
      workflowLabel: "Presentation workflow",
      routingReason: "Prioritize a slide narrative, executive storyline, and concise visual-friendly bullets.",
      preferredTools: ["task.planner", "uapi.search", "search", "web.fetch", "model"],
      persona: { name: "演示文稿专家", expertise: "结构化叙事、视觉呈现、信息提炼", tone: "清晰有逻辑，每页一个核心观点" },
      workflowSteps: [
        "Define the audience, decision goal, and slide narrative",
        "Turn material into a slide-by-slide outline",
        "Write concise content per slide with titles and bullets",
        "Package as slide-friendly artifacts"
      ],
      deliverables: ["Cover/title slide", "Agenda/storyline", "Core insights slides", "Closing recommendations"],
      promptDirectives: [
        "Return slide-structured content with slide titles.",
        "Favor concise bullets and speaker-friendly phrasing."
      ]
    },
    social_publish: {
      workflowLabel: "Social publishing workflow",
      routingReason: "This is an ACTION workflow: the user wants content actually PUBLISHED to a platform, not just copy written. Attempt browser automation first; fall back to manual instructions only when tools are unavailable.",
      preferredTools: ["browser", "publish.package", "uapi.search", "search", "web.fetch", "gen.media", "task.planner"],
      persona: { name: "社交媒体运营", expertise: "热点追踪、文案撰写、平台规则、受众分析、浏览器自动化发布", tone: "行动导向，尽力执行发布操作，遇到障碍给出明确的解决路径" },
      workflowSteps: [
        "Clarify platform, account, and what kind of content to post",
        "Search and collect source material if needed (news, topics, etc.)",
        "Write the spoken script, caption, and hashtags",
        "Generate or locate any required media (image/video) using gen.media",
        "Use the browser tool to open the target platform's creator/publish page",
        "If login is required: open the login page in browser so user can scan QR code",
        "Use publish.package to create a publish-ready package with publishRequested=true",
        "Report exactly what happened: posted successfully, or exactly what blocker prevents posting"
      ],
      deliverables: [
        "Published content URL (if successful)",
        "Platform-ready spoken script with captions and hashtags",
        "Publishing package with browser automation details",
        "Clear blocker report with specific login URLs if posting was not possible"
      ],
      promptDirectives: [
        "This is a PUBLISHING ACTION task, NOT a copywriting task. The user wants content POSTED to the platform.",
        "ALWAYS attempt to use the browser tool first to open the creator platform and interact with the publish page.",
        "If gen.media is available, generate required video/image assets instead of skipping publishing.",
        "Use publish.package with publishRequested=true when the user explicitly wants to publish.",
        "If the browser opens a login page, tell the user to scan the QR code — then they can approve the actual publish click.",
        "Only fall back to text-only copywriting when browser automation is completely unavailable (e.g., Playwright not installed).",
        "Never claim the content was published unless a publishing tool or browser automation returns a success proof or URL."
      ]
    },
    image_generation: {
      workflowLabel: "Image generation workflow",
      routingReason: "Prioritize prompt design, style constraints, generator selection, and final asset export.",
      preferredTools: ["gen.media", "vision", "media"],
      persona: { name: "视觉设计师", expertise: "风格设计、构图画质、生成参数优化", tone: "创意驱动，注重细节和一致性" },
      workflowSteps: [
        "Clarify the visual goal, style, subject, and aspect ratio",
        "Choose the image generation engine or ComfyUI workflow",
        "Generate the asset and verify the result matches the prompt"
      ],
      deliverables: ["Prompt specification", "Generated image asset"],
      promptDirectives: [
        "Return a usable image asset or a generator job result, not a text-only description."
      ]
    },
    video_generation: {
      workflowLabel: "Video generation workflow",
      routingReason: "Prioritize storyboard, motion constraints, generator workflow, and final render output.",
      preferredTools: ["gen.media", "media", "vision"],
      persona: { name: "视频制作人", expertise: "分镜设计、动效约束、渲染管线", tone: "视觉叙事，注重节奏和转场" },
      workflowSteps: [
        "Clarify the scene, duration, style, and motion requirements",
        "Choose the video generation workflow or ComfyUI job",
        "Submit or generate the video asset and report status"
      ],
      deliverables: ["Storyboard/prompt", "Generated video asset or job id"],
      promptDirectives: [
        "Return a render artifact or queued generation job details, not only prose."
      ]
    },
    voice_generation: {
      workflowLabel: "Voice generation workflow",
      routingReason: "Prioritize script, tone, voice selection, and final audio delivery.",
      preferredTools: ["gen.media", "voice"],
      persona: { name: "音频制作人", expertise: "语音合成、脚本打磨、音色选择", tone: "自然流畅，注重语气和停顿" },
      workflowSteps: [
        "Clarify the script, language, tone, and speaker style",
        "Select the speech generation engine",
        "Produce the final audio asset and describe the output"
      ],
      deliverables: ["Speech script", "Generated audio asset"],
      promptDirectives: [
        "Return a speech file when possible, not just a written script."
      ]
    },
    code: {
      workflowLabel: "Engineering workflow",
      routingReason: "Prioritize inspection, reproduction, targeted edits, verification, and self-improvement loops.",
      preferredTools: ["code.agent", "code.generator", "fs.read_file", "shell.exec", "code.exec", "code.improver", "code.self_improve"],
      persona: { name: "资深软件工程师", expertise: "代码审查、架构设计、测试驱动、安全编程", tone: "务实精准，改动最小化，验证优先" },
      workflowSteps: [
        "Inspect the codebase and constraints",
        "Create an architecture-aware coding plan",
        "Reproduce or understand the issue",
        "Apply targeted edits",
        "Run checks/tests when available",
        "Summarize changes and remaining risks"
      ],
      deliverables: ["Change summary", "Verification notes", "Remaining risks or TODOs"],
      promptDirectives: [
        "Prefer concrete code actions over generic advice.",
        "Include verification status and next recommended action."
      ]
    },
    weather: {
      complexity: "simple",
      persona: { name: "天气查询助手", expertise: "快速获取当前天气和预报信息", tone: "简洁直接，给出温度和预报即可" },
      workflowLabel: "Weather query workflow",
      routingReason: "Simple lookup: search for weather data and answer directly. Do NOT over-plan.",
      preferredTools: ["uapi.search", "search", "web.fetch"],
      workflowSteps: [
        "Search for current weather data for the requested location",
        "Answer immediately with the weather information found"
      ],
      deliverables: ["Weather conditions with temperature and forecast"],
      promptDirectives: [
        "This is a SIMPLE weather lookup — answer in 1-2 cycles maximum.",
        "Search once for weather data, then respond directly without further planning.",
        "Include temperature, conditions, and a brief forecast.",
        "Do NOT create files, presentations, or long reports for a weather query.",
        "If search fails, use your training data and clearly state the data may not be current."
      ]
    },
    automation: {
      workflowLabel: "Automation workflow",
      routingReason: "Prioritize trigger design, execution steps, guardrails, and repeatable outputs.",
      preferredTools: ["task.planner", "scheduler", "shell.exec", "api.request"],
      persona: { name: "自动化工程师", expertise: "流程设计、定时调度、安全边栏、幂等性", tone: "精确规范，每步可重复可验证" },
      workflowSteps: [
        "Clarify trigger, frequency, and success criteria",
        "Design the repeatable action sequence",
        "Describe safeguards, approvals, and notifications",
        "Package a workflow spec and runbook"
      ],
      deliverables: ["Workflow definition", "Trigger conditions", "Guardrails and approvals", "Runbook"],
      promptDirectives: [
        "Structure the answer as an automation spec, not free-form prose."
      ]
    },
    data_analysis: {
      workflowLabel: "Data analysis workflow",
      routingReason: "Prioritize dataset understanding, metric extraction, analysis, and structured outputs.",
      preferredTools: ["fs.read_file", "api.request", "code.exec", "task.planner"],
      persona: { name: "数据分析师", expertise: "数据处理、指标提取、趋势发现、可视化建议", tone: "客观数据说话，异常重点关注" },
      workflowSteps: [
        "Inspect available datasets and fields",
        "Compute or extract key metrics",
        "Summarize patterns, anomalies, and implications",
        "Package analysis plus structured data output"
      ],
      deliverables: ["Key metrics", "Observed trends", "Anomalies", "Actionable conclusions"],
      promptDirectives: [
        "When possible, keep analysis machine-readable and narrative-ready."
      ]
    },
    financial_analysis: {
      workflowLabel: "Financial analysis workflow",
      routingReason: "Prioritize financial data collection, modeling, valuation, and investment recommendations.",
      preferredTools: ["domain.financial-analysis", "uapi.search", "search", "web.fetch", "gen.chart", "task.planner"],
      persona: { name: "财务分析师", expertise: "财务报表分析、估值建模、投资建议", tone: "数据严谨，风险意识强，结论有依据" },
      workflowSteps: [
        "Collect financial data and market context",
        "Build financial models and forecasts",
        "Generate valuation and investment recommendations",
        "Package as a professional financial report"
      ],
      deliverables: ["Financial data summary", "Forecast models", "Investment recommendation", "Risk assessment"],
      promptDirectives: [
        "Structure output as a professional financial report.",
        "Include data sources, assumptions, and risk factors.",
        "Use gen.chart for financial visualizations when helpful."
      ]
    },
    legal_review: {
      workflowLabel: "Legal review workflow",
      routingReason: "Prioritize legal research, contract review, risk assessment, and compliance reporting.",
      preferredTools: ["domain.legal-review", "uapi.search", "search", "web.fetch", "task.planner"],
      persona: { name: "法务审查师", expertise: "法律法规研究、合同审查、合规评估", tone: "严谨细致，风险导向，条款逐条分析" },
      workflowSteps: [
        "Research applicable laws and regulations",
        "Review key contract clauses and identify risks",
        "Generate compliance report with recommendations",
        "Package as a legal review document"
      ],
      deliverables: ["Legal research summary", "Risk clause analysis", "Compliance report", "Action recommendations"],
      promptDirectives: [
        "Always include a disclaimer that this is AI-assisted analysis, not legal advice.",
        "Clearly separate factual findings from interpretive analysis.",
        "Reference specific laws and regulations when possible."
      ]
    },
    hr_recruitment: {
      workflowLabel: "HR recruitment workflow",
      routingReason: "Prioritize job analysis, candidate screening design, and onboarding planning.",
      preferredTools: ["domain.hr-recruitment", "uapi.search", "search", "task.planner"],
      persona: { name: "HR招聘专家", expertise: "职位分析、面试设计、入职培训规划", tone: "专业亲和，结构化，注重匹配度" },
      workflowSteps: [
        "Analyze the role and create a job description",
        "Design screening criteria and interview questions",
        "Create an onboarding and training plan",
        "Package as a complete recruitment package"
      ],
      deliverables: ["Job description", "Screening rubric", "Interview question bank", "Onboarding plan"],
      promptDirectives: [
        "Structure output as a ready-to-use recruitment toolkit.",
        "Include practical, actionable templates and rubrics.",
        "Consider both technical skills and culture fit."
      ]
    },
    engineering_design: {
      workflowLabel: "Engineering design workflow",
      routingReason: "Prioritize requirements analysis, architecture design, tech stack selection, and implementation planning.",
      preferredTools: ["domain.engineering-design", "uapi.search", "search", "web.fetch", "code.agent", "task.planner"],
      persona: { name: "工程架构师", expertise: "系统架构设计、技术选型、工程实施规划", tone: "技术务实，方案可落地，考虑可维护性" },
      workflowSteps: [
        "Analyze functional and non-functional requirements",
        "Design system architecture and select tech stack",
        "Create module breakdown and interface design",
        "Produce an implementation roadmap with milestones"
      ],
      deliverables: ["Requirements document", "Architecture diagram/description", "Tech stack rationale", "Implementation plan"],
      promptDirectives: [
        "Consider scalability, security, and maintainability from the start.",
        "Provide concrete technology choices with rationale.",
        "Include risk identification and contingency plans."
      ]
    },
    content_marketing: {
      workflowLabel: "Content marketing workflow",
      routingReason: "Prioritize audience analysis, content planning, calendar creation, and performance measurement.",
      preferredTools: ["domain.content-marketing", "uapi.search", "search", "web.fetch", "gen.chart", "task.planner"],
      persona: { name: "内容营销经理", expertise: "受众洞察、内容策略、SEO、数据分析", tone: "创意驱动，数据导向，注重ROI" },
      workflowSteps: [
        "Analyze target audience and content preferences",
        "Create content themes and monthly calendar",
        "Design distribution strategy across channels",
        "Define KPIs and optimization framework"
      ],
      deliverables: ["Audience profile", "Content calendar", "Distribution plan", "KPI dashboard outline"],
      promptDirectives: [
        "Focus on actionable content plans, not just theory.",
        "Include SEO keywords and channel-specific recommendations.",
        "Provide concrete metrics for success measurement."
      ]
    },
    customer_support: {
      workflowLabel: "Customer support workflow",
      routingReason: "Prioritize support analysis, FAQ knowledge base, quality assurance, and team configuration.",
      preferredTools: ["domain.customer-support", "uapi.search", "search", "task.planner"],
      persona: { name: "客服运营经理", expertise: "客服体系搭建、知识库构建、质检标准制定", tone: "服务导向，流程清晰，关注客户体验" },
      workflowSteps: [
        "Analyze customer support needs and issue categories",
        "Build FAQ knowledge base and response templates",
        "Design quality assurance system and KPIs",
        "Produce a complete customer support playbook"
      ],
      deliverables: ["Issue category framework", "FAQ knowledge base", "Quality standards", "Team configuration plan"],
      promptDirectives: [
        "Structure output as an operational playbook.",
        "Include concrete templates and scoring rubrics.",
        "Balance efficiency with customer satisfaction."
      ]
    },
    media_analysis: {
      workflowLabel: "Multimodal analysis workflow",
      routingReason: "Prioritize attachment-aware understanding, OCR/vision/audio extraction, and evidence summaries.",
      preferredTools: ["vision", "ocr", "voice", "media", "fs.read_file"],
      persona: { name: "多媒体分析师", expertise: "图像识别、语音转录、视频分析、证据提纯", tone: "细致全面，明确标注置信度" },
      workflowSteps: [
        "Inspect attachments by media type",
        "Extract text, speech, or visual evidence when possible",
        "Summarize key signals and confidence",
        "Package a usable report for humans"
      ],
      deliverables: ["Attachment inventory", "Extracted evidence", "Summary of key findings", "Confidence/limitations"],
      promptDirectives: [
        "Explicitly reference the uploaded attachments when they are relevant.",
        "If attachments exist, prefer multimodal tools over text-only speculation."
      ]
    },
    education: {
      workflowLabel: "Education workflow",
      routingReason: "Prioritize curriculum design, teaching methodology, learning assessment, and educational content creation.",
      preferredTools: ["domain.education", "search", "web.fetch", "task.planner", "fs.write_file", "gen.chart"],
      persona: { name: "教育课程设计师", expertise: "课程设计、教学方法、学习评估、教学内容开发", tone: "专业严谨，以学习者为中心，循循善诱" },
      workflowSteps: [
        "Analyze learner profile, objectives and prerequisites",
        "Design curriculum outline and course structure",
        "Develop teaching materials and learning activities",
        "Create assessment rubrics and evaluation methods",
        "Package complete education package with course plan"
      ],
      deliverables: ["Learner profile analysis", "Course curriculum outline", "Teaching materials", "Assessment framework", "Learning schedule"],
      promptDirectives: [
        "Structure content with clear learning objectives and outcomes.",
        "Include practical exercises and real-world applications.",
        "Design multi-level assessment with rubrics."
      ]
    },
    healthcare: {
      workflowLabel: "Healthcare workflow",
      routingReason: "Prioritize medical analysis, treatment planning, health management, and patient education.",
      preferredTools: ["domain.healthcare", "search", "web.fetch", "task.planner", "fs.write_file"],
      persona: { name: "医疗健康顾问", expertise: "病例分析、诊疗方案、健康管理、患者教育", tone: "专业谨慎，以循证医学为基础，强调安全" },
      workflowSteps: [
        "Collect symptom and medical history information",
        "Analyze differential diagnosis possibilities",
        "Recommend evidence-based treatment plan",
        "Design follow-up and health management schedule",
        "Package comprehensive healthcare report"
      ],
      deliverables: ["Clinical analysis summary", "Differential diagnosis", "Treatment recommendations", "Health management plan"],
      promptDirectives: [
        "Always include disclaimer about consulting healthcare professionals.",
        "Base recommendations on evidence-based medicine.",
        "Clearly distinguish between confirmed facts and possibilities."
      ]
    },
    real_estate: {
      workflowLabel: "Real estate workflow",
      routingReason: "Prioritize property market analysis, valuation, investment strategy, and transaction support.",
      preferredTools: ["domain.real-estate", "search", "web.fetch", "task.planner", "gen.chart", "fs.write_file"],
      persona: { name: "房地产投资顾问", expertise: "市场分析、物业估值、投资策略、交易支持", tone: "数据驱动，务实稳健，关注投资回报" },
      workflowSteps: [
        "Analyze regional market data and policy environment",
        "Evaluate property value and investment ROI",
        "Assess market cycle and risk factors",
        "Develop investment strategy and transaction plan",
        "Package complete real estate analysis report"
      ],
      deliverables: ["Market data analysis", "Property valuation report", "Investment ROI calculation", "Risk assessment", "Transaction strategy"],
      promptDirectives: [
        "Use concrete data and market comparables.",
        "Include sensitivity analysis for different scenarios.",
        "Consider policy and regulatory risk factors."
      ]
    },
    video_editing: {
      workflowLabel: "Video editing workflow",
      routingReason: "Prioritize storyboard design, timeline editing, effects application, and final export.",
      preferredTools: ["task.planner", "gen.media", "vision", "shell.exec", "fs.write_file"],
      persona: { name: "视频剪辑师", expertise: "剪辑叙事、色彩调校、音频混音、视觉特效", tone: "创意导向，注重节奏和叙事流畅" },
      workflowSteps: [
        "Define editing vision and target audience",
        "Design shot-by-shot storyboard",
        "Assemble timeline with transitions and effects",
        "Mix audio tracks and finalize export",
        "Verify quality and platform compliance"
      ],
      deliverables: ["Storyboard document", "Edited video file", "Export settings report", "Quality verification notes"],
      promptDirectives: [
        "Pay attention to pacing, transitions, and narrative flow.",
        "Consider platform-specific aspect ratios and duration limits.",
        "Use shell.exec for ffmpeg or video processing CLI tools when needed."
      ]
    },
    podcast_production: {
      workflowLabel: "Podcast production workflow",
      routingReason: "Prioritize script writing, voice generation, audio production, and metadata packaging.",
      preferredTools: ["task.planner", "gen.voice", "gen.media", "shell.exec", "fs.write_file", "search"],
      persona: { name: "播客制作人", expertise: "播客策划、脚本写作、音频制作、发布管理", tone: "内容驱动，注重听众体验和叙事节奏" },
      workflowSteps: [
        "Define episode topic, format, and audience",
        "Research content and write episode script",
        "Generate voiceover and produce audio mix",
        "Add chapters, show notes, and SEO metadata",
        "Export final audio and verify quality"
      ],
      deliverables: ["Episode script", "Final audio file", "Show notes with chapters", "Cover art", "RSS metadata"],
      promptDirectives: [
        "Structure episodes with clear intro, segments, and outro.",
        "Optimize audio for voice clarity and consistent levels.",
        "Include SEO-friendly show notes and chapter markers."
      ]
    }
  };

  const profile = byType[taskType] ?? shared;
  const defaultPersona: Persona = { name: "智能助手", expertise: "通用任务处理", tone: "专业务实，直接高效" };
  return {
    taskType,
    outputFormat,
    complexity: profile.complexity ?? inferComplexity(input.goal, taskType),
    workflowLabel: profile.workflowLabel,
    routingReason: profile.routingReason,
    preferredTools: profile.preferredTools,
    workflowSteps: profile.workflowSteps,
    deliverables: profile.deliverables,
    promptDirectives: [
      ...shared.promptDirectives,
      ...profile.promptDirectives,
      `The final deliverable should be a ${delivery.resultLabel}.`,
      `Completion rule: ${delivery.completionDefinition}`
    ],
    delivery,
    persona: (profile as any).persona ?? defaultPersona
  };
}

export function resolveArtifactFormats(
  task: Pick<TaskRecord, "goal" | "taskType" | "outputFormat" | "attachments">
): OutputFormat[] {
  const intent = resolveTaskIntent({
    goal: task.goal,
    taskType: task.taskType,
    outputFormat: task.outputFormat,
    attachments: task.attachments
  });

  if (intent.outputFormat === "chat") {
    return [];
  }

  return intent.delivery.artifactBundle;
}
