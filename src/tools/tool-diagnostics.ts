// ─── Tool error diagnostics — root cause detection + fix suggestions ──────────────

export interface Diagnosis {
  /** Human-readable root cause */
  cause: string;
  /** Actionable fix suggestion for the user */
  fix: string;
  /** Category for routing/logging */
  category: "missing_dependency" | "network" | "permission" | "config" | "not_found" | "timeout" | "unknown";
  /** Can the agent self-fix this? */
  selfFixable: boolean;
}

type ToolDiagnoser = (errorMessage: string, toolId: string, toolArgs?: unknown) => Diagnosis | null;

// ── Pattern library ────────────────────────────────────────────────────────────────

const PATTERNS: Array<{ match: (msg: string) => boolean; diagnose: ToolDiagnoser }> = [
  // Generic command/tool not found — suggest tool.provision
  {
    match: (m) => /(not recognized|command not found|is not allowed|not found in PATH|Cannot find|no such file or directory)/i.test(m),
    diagnose: (m) => {
      const cmdMatch = m.match(/(?:Command ["']|")([^"']+)(?:["']|" is not)/i) || m.match(/^([^\s:]+)/);
      const tool = cmdMatch ? cmdMatch[1] : "the command";
      return {
        cause: `Command or tool "${tool}" is not available`,
        fix: `Try tool.provision ensure tool="${tool}" to check availability and get install instructions. Or tool.provision suggest goal="<task>" to find alternative tools. If the command exists but is blocked, adjust SHELL_ALLOWLIST.`,
        category: "missing_dependency",
        selfFixable: true
      };
    }
  },
  // Python / pip missing
  {
    match: (m) => /\b(python|pip|pip3)\b.*(not found|not recognized|command not found|no such file)/i.test(m),
    diagnose: () => ({
      cause: "Python is not installed or not on PATH",
      fix: "Install Python 3.10+ from https://python.org/downloads and ensure it's on PATH. On Windows: check 'Add Python to PATH' during install.",
      category: "missing_dependency",
      selfFixable: false
    })
  },
  // Python library missing (pdfplumber, PyPDF2, etc.)
  {
    match: (m) => /No module named ['"](\w+)['"]/.test(m),
    diagnose: (m) => {
      const lib = m.match(/No module named ['"](\w+)['"]/)![1];
      return {
        cause: `Python library "${lib}" is not installed`,
        fix: `pip install ${lib}`,
        category: "missing_dependency",
        selfFixable: true
      };
    }
  },
  // __NO_PYTHON_PDF__ or PDF extraction failure
  {
    match: (m) => /__NO_PYTHON_PDF__|Could not extract text from PDF|pdfplumber/i.test(m),
    diagnose: () => ({
      cause: "PDF extraction requires a Python PDF library",
      fix: "pip install pdfplumber  (recommended: better text extraction) or pip install PyPDF2",
      category: "missing_dependency",
      selfFixable: true
    })
  },
  // node-llama-cpp / native module issues
  {
    match: (m) => /\b(node-llama-cpp|llama\.cpp|\.node\b.*not a valid|Cannot find module.*llama)/i.test(m),
    diagnose: () => ({
      cause: "The node-llama-cpp native binding is missing or corrupted",
      fix: "npm rebuild node-llama-cpp  (may require C++ build tools: npm install -g windows-build-tools on Windows)",
      category: "missing_dependency",
      selfFixable: true
    })
  },
  // Playwright / browser missing
  {
    match: (m) => /\b(playwright|browser.*not found|Executable doesn't exist|BrowserType\.launch)/i.test(m),
    diagnose: () => ({
      cause: "Playwright browser is not installed",
      fix: "npx playwright install chromium",
      category: "missing_dependency",
      selfFixable: true
    })
  },
  // Tesseract / OCR
  {
    match: (m) => /\b(tesseract|ocr|tesseract\.js.*worker)/i.test(m) && /not found|failed|error/i.test(m),
    diagnose: () => ({
      cause: "OCR via tesseract.js WASM engine failed (worker or language data issue)",
      fix: "tesseract.js auto-downloads workers and language data on first use. Check network connectivity for the initial download. If behind a proxy, set HTTP_PROXY / HTTPS_PROXY.",
      category: "missing_dependency",
      selfFixable: true
    })
  },
  // FFmpeg missing (voice/media)
  {
    match: (m) => /\b(ffmpeg|ffprobe)\b.*(not found|not recognized|command not found)/i.test(m),
    diagnose: () => ({
      cause: "FFmpeg is not installed",
      fix: "Install FFmpeg: winget install ffmpeg (Windows) / brew install ffmpeg (macOS) / apt install ffmpeg (Linux)",
      category: "missing_dependency",
      selfFixable: false
    })
  },
  // Network errors
  {
    match: (m) => /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|network|connect ECONNREFUSED|getaddrinfo)\b/i.test(m),
    diagnose: (m) => {
      const urlMatch = m.match(/(?:https?:\/\/|host\s+)([^\s,]+)/i);
      const target = urlMatch ? urlMatch[1] : "the target service";
      return {
        cause: `Cannot connect to ${target} — network unreachable or service is down`,
        fix: `Check: 1) Is ${target} accessible from this machine? 2) Firewall/proxy settings. 3) Service status page. If using a local service (SearXNG, ComfyUI), ensure it's running.`,
        category: "network",
        selfFixable: false
      };
    }
  },
  // Permission denied
  {
    match: (m) => /\b(EACCES|EPERM|permission denied|access denied|not permitted)\b/i.test(m),
    diagnose: (m) => {
      const pathMatch = m.match(/(?:'|")([^'"]+)(?:'|")/);
      const target = pathMatch ? pathMatch[1] : "the target";
      return {
        cause: `Permission denied accessing "${target}"`,
        fix: `Check file/directory permissions. On Windows: run terminal as Administrator. On Linux/macOS: chmod/chown as needed.`,
        category: "permission",
        selfFixable: false
      };
    }
  },
  // API key / authentication missing
  {
    match: (m) => /\b(api[_\s]?key|unauthorized|401|403|auth|apikey|API key|token.*invalid|not configured)\b/i.test(m),
    diagnose: (toolId) => {
      const envVarMap: Record<string, string> = {
        "search": "无（DDG免费无需Key），或设置 SEARXNG_ENDPOINT",
        "web.fetch": "无",
        "vision": "本地模型无需Key。云模型需 CLOUD_API_KEY (OpenAI兼容) 或 ANTHROPIC_API_KEY",
        "voice": "本地TTS无需Key。云TTS需 CLOUD_API_KEY",
        "gen.chart": "无（本地生成）",
        "mcp.search": "无",
      };
      const envInfo = envVarMap[toolId] || "CLOUD_API_KEY 或 ANTHROPIC_API_KEY";
      return {
        cause: `API key or authentication is missing for tool "${toolId}"`,
        fix: `配置环境变量: ${envInfo}。在 .env.local 中设置。`,
        category: "config",
        selfFixable: false
      };
    }
  },
  // File not found
  {
    match: (m) => /\b(ENOENT|no such file|file not found|cannot find.*path)\b/i.test(m),
    diagnose: (m) => {
      const pathMatch = m.match(/(?:'|"|\s)([^\s"']*(?:\.[a-z]{1,6}))(?:\s|'|"|$)/i);
      const target = pathMatch ? pathMatch[1] : "the specified file";
      return {
        cause: `File not found: "${target}"`,
        fix: `Check that the file path is correct and the file exists. Use fs.read_file or fs.list_files to verify.`,
        category: "not_found",
        selfFixable: true
      };
    }
  },
  // Timeout
  {
    match: (m) => /\b(timeout|timed out|ETIMEDOUT|exceeded.*time)\b/i.test(m),
    diagnose: (toolId) => ({
      cause: `Tool "${toolId}" timed out`,
      fix: "The operation took too long. Try: reduce scope, use smaller inputs, or check network connectivity.",
      category: "timeout",
      selfFixable: true
    })
  },
  // npm / npx not found
  {
    match: (m) => /\b(npm|npx|node)\b.*(not found|not recognized|command not found)/i.test(m),
    diagnose: () => ({
      cause: "Node.js / npm is not installed or not on PATH",
      fix: "Install Node.js 18+ from https://nodejs.org",
      category: "missing_dependency",
      selfFixable: false
    })
  },
  // ComfyUI not running
  {
    match: (m) => /\b(comfyui|comfy)\b/i.test(m) && /(not running|refused|not found|ECONNREFUSED)/i.test(m),
    diagnose: () => ({
      cause: "ComfyUI is not running or not accessible",
      fix: "Start ComfyUI first: python main.py --cpu (or use ComfyUI desktop). Ensure COMFYUI_ENDPOINT points to the correct URL (default: http://127.0.0.1:8188).",
      category: "network",
      selfFixable: true
    })
  },
  // GPU/CUDA missing (for local models)
  {
    match: (m) => /\b(cuda|vulkan|metal|gpu.*not.*available|no.*gpu)\b/i.test(m),
    diagnose: () => ({
      cause: "GPU acceleration is not available — falling back to CPU",
      fix: "This is a warning, not an error. For faster local inference: install CUDA (NVIDIA) or Vulkan SDK. Otherwise, CPU inference will work but slower.",
      category: "config",
      selfFixable: false
    })
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────────

export function diagnoseToolError(errorMessage: string, toolId: string, toolArgs?: unknown): Diagnosis {
  for (const pattern of PATTERNS) {
    if (pattern.match(errorMessage)) {
      const diag = pattern.diagnose(errorMessage, toolId, toolArgs);
      if (diag) return diag;
    }
  }

  // Fallback: wrap the error as-is
  return {
    cause: truncate(errorMessage, 200),
    fix: "Check the tool documentation or retry with different parameters.",
    category: "unknown",
    selfFixable: false
  };
}

export function formatDiagnosis(diag: Diagnosis): string {
  const lines = [
    `## 工具错误诊断`,
    ``,
    `**原因**: ${diag.cause}`,
    `**分类**: ${diag.category}`,
    `**修复**: ${diag.fix}`,
    `**可自修复**: ${diag.selfFixable ? "是（agent 可尝试自动修复）" : "否（需要用户操作）"}`,
  ];
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.substring(0, max - 3) + "...";
}
