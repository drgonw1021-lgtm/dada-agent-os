/**
 * Lightweight i18n module. Supports zh and en locales.
 * Used for user-facing strings: tool descriptions, system prompts, UI messages.
 * Set via LOCALE env var (default: "en").
 */

export type Locale = "zh" | "en";

// ─── Translation maps ────────────────────────────────────────────────────────────

const translations: Record<string, Record<Locale, string>> = {
  // ── Core messages ──
  "startup.capability_report": { zh: "工具能力报告", en: "Tool Capability Report" },
  "startup.total": { zh: "总计", en: "Total" },
  "startup.available": { zh: "可用", en: "Available" },
  "startup.unavailable": { zh: "不可用", en: "Unavailable" },
  "startup.no_api_key": { zh: "未检测到云 API key，仅使用本地模型。设置 CLOUD_API_KEY 以启用云端推理。", en: "No cloud API key detected, using local models only. Set CLOUD_API_KEY to enable cloud inference." },
  "startup.api_key_found": { zh: "云 API key 已配置 ({provider})", en: "Cloud API key configured ({provider})" },
  "startup.tools_loaded": { zh: "已加载 {count} 个工具", en: "{count} tools loaded" },
  "startup.mcp_loaded": { zh: "已加载 {count} 个 MCP 服务器", en: "{count} MCP servers loaded" },
  "startup.agents_loaded": { zh: "已加载 {count} 个 Agent", en: "{count} agents loaded" },
  "startup.skills_loaded": { zh: "已加载 {count} 个技能", en: "{count} skills loaded" },
  "startup.models_found": { zh: "发现 {count} 个本地模型", en: "{count} local models found" },
  "startup.server_started": { zh: "服务器已启动: {url}", en: "Server started: {url}" },
  "startup.web_ui": { zh: "Web 界面: {url}", en: "Web UI: {url}" },

  // ── Tool category labels ──
  "tool.cat.filesystem": { zh: "文件系统", en: "Filesystem" },
  "tool.cat.shell": { zh: "命令行", en: "Shell" },
  "tool.cat.web": { zh: "网络", en: "Web" },
  "tool.cat.search": { zh: "搜索", en: "Search" },
  "tool.cat.ai": { zh: "AI / 推理", en: "AI / Reasoning" },
  "tool.cat.media": { zh: "媒体", en: "Media" },
  "tool.cat.automation": { zh: "自动化", en: "Automation" },
  "tool.cat.developer": { zh: "开发者", en: "Developer" },
  "tool.cat.enterprise": { zh: "企业", en: "Enterprise" },
  "tool.cat.other": { zh: "其他", en: "Other" },

  // ── Risk labels ──
  "risk.low": { zh: "低风险", en: "Low Risk" },
  "risk.medium": { zh: "中风险", en: "Medium Risk" },
  "risk.high": { zh: "高风险", en: "High Risk" },

  // ── Agent runtime messages ──
  "agent.planning": { zh: "规划中...", en: "Planning..." },
  "agent.executing": { zh: "执行中...", en: "Executing..." },
  "agent.verifying": { zh: "验证中...", en: "Verifying..." },
  "agent.delegating": { zh: "委派子 Agent...", en: "Delegating to sub-agent..." },
  "agent.completed": { zh: "任务完成", en: "Task completed" },
  "agent.failed": { zh: "任务失败", en: "Task failed" },
  "agent.steps": { zh: "步骤", en: "Steps" },
  "agent.result": { zh: "结果", en: "Result" },
  "agent.error": { zh: "错误", en: "Error" },
  "agent.tools_used": { zh: "使用的工具", en: "Tools used" },

  // ── Tool unavailability reasons ──
  "unavail.no_api_key": { zh: "未配置 API key", en: "No API key configured" },
  "unavail.no_cloud_key": { zh: "未配置云 API key 且无本地模型支持", en: "No cloud API key and no local model support" },
  "unavail.no_model": { zh: "无可用模型", en: "No model available" },
  "unavail.no_binary": { zh: "缺少依赖程序", en: "Missing required binary" },
  "unavail.no_endpoint": { zh: "未配置端点", en: "No endpoint configured" },
  "unavail.no_system_tts": { zh: "系统无 TTS 支持且无云 API key", en: "No system TTS available and no cloud API key" },
  "unavail.no_whisper": { zh: "whisper.cpp 未安装。安装: brew install whisper-cpp 或 pip install openai-whisper", en: "whisper.cpp not found. Install: brew install whisper-cpp or pip install openai-whisper" },
  "unavail.no_tesseract": { zh: "OCR 引擎加载失败，检查网络连接（首次使用需下载语言包）", en: "OCR engine failed to load — check network for initial language data download" },
  "unavail.no_comfyui": { zh: "未配置 ComfyUI 端点或云 API key。设置 COMFYUI_ENDPOINT 或 CLOUD_API_KEY", en: "No ComfyUI endpoint or cloud API key configured. Set COMFYUI_ENDPOINT or CLOUD_API_KEY" },

  // ── Verification messages ──
  "verify.write_ok": { zh: "写入意图已满足", en: "Write intent fulfilled" },
  "verify.read_ok": { zh: "读取意图已满足", en: "Read intent fulfilled" },
  "verify.web_ok": { zh: "网络意图已满足", en: "Web intent fulfilled" },
  "verify.no_tools": { zh: "未执行有效工具。模型可能不支持 function calling。", en: "No meaningful tools were executed. The model may not support function calling or tool use." },
  "verify.max_steps": { zh: "任务达到步骤上限", en: "Task hit step limit without completing" },
  "verify.no_progress": { zh: "未检测到可执行的进展", en: "No executable progress detected" },
  "verify.errors_no_tools": { zh: "执行包含错误且未尝试任何工具", en: "Execution contains errors and no tools were attempted" },

  // ── Self-evolution ──
  "evolve.skill_generated": { zh: "已生成技能文件: {path}", en: "Skill generated: {path}" },
  "evolve.insufficient_steps": { zh: "工具步骤不足 ({count} < {min})，跳过进化", en: "Insufficient tool steps ({count} < {min}), skipping evolution" },
  "evolve.generating": { zh: "正在生成技能...", en: "Generating skill..." },

  // ── Delegation ──
  "delegation.creating_agent": { zh: "正在创建 Agent: {name}", en: "Creating agent: {name}" },
  "delegation.agent_done": { zh: "Agent {name} 已完成", en: "Agent {name} completed" },
  "delegation.agent_failed": { zh: "Agent {name} 失败", en: "Agent {name} failed" },

  // ── UI ──
  "ui.title": { zh: "DaDa — 本地智能助手", en: "DaDa — Local AI Assistant" },
  "ui.subtitle": { zh: "自主 AI Agent 工作台", en: "Autonomous AI Agent Workbench" },
  "ui.new_task": { zh: "新建任务", en: "New Task" },
  "ui.task_history": { zh: "任务历史", en: "Task History" },
  "ui.settings": { zh: "设置", en: "Settings" },
  "ui.models": { zh: "模型", en: "Models" },
  "ui.tools": { zh: "工具", en: "Tools" },
  "ui.language": { zh: "语言", en: "Language" },
  "ui.send": { zh: "发送", en: "Send" },
  "ui.stop": { zh: "停止", en: "Stop" },
  "ui.clear": { zh: "清空", en: "Clear" },
  "ui.no_tasks": { zh: "暂无任务", en: "No tasks yet" },
  "ui.loading": { zh: "加载中...", en: "Loading..." },
  "ui.error": { zh: "出错了", en: "Error" },
};

// ─── Public API ──────────────────────────────────────────────────────────────────

export function t(key: string, locale: Locale, vars?: Record<string, string | number>): string {
  const entry = translations[key];
  let text = entry ? (entry[locale] ?? entry["en"]) : key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, String(v));
    }
  }
  return text;
}

/**
 * Detect locale from environment, defaulting to "en".
 */
export function detectLocale(env: NodeJS.ProcessEnv): Locale {
  const raw = (env.LOCALE || "en").toLowerCase();
  if (raw === "zh" || raw === "zh-cn" || raw === "zh-tw" || raw === "chinese") return "zh";
  return "en";
}

/**
 * Translate a tool description. If the description starts with a known key prefix,
 * translate it; otherwise return as-is. This allows gradual i18n adoption.
 */
export function translateDescription(desc: string, locale: Locale): string {
  // Direct key match
  if (translations[desc]) return translations[desc][locale] ?? desc;
  return desc;
}
