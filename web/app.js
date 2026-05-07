// DaDa UI — app.js
'use strict';

// ── i18n translations ─────────────────────────────────────────────────────────────
const T = {
  en: {
    chat: 'Chat',
    plugins: 'Plugins',
    history: 'History',
    projects: 'Projects',
    settings: 'Settings',
    online: 'online',
    offline: 'offline',
    connected: 'connected',
    connecting: 'connecting',
    running: 'running',
    completed: 'completed',
    failed: 'failed',
    cancelled: 'cancelled',
    waitingApproval: 'waiting approval',
    submit: 'Run',
    cancel: 'Cancel',
    retry: 'Retry',
    selfImprove: 'Self-improve',
    steps: 'Steps',
    raw: 'Raw',
    noTasks: 'No tasks yet. Create your first task on the home screen.',
    noModels: 'No local models found. Download one below or add .gguf files to the models/ directory.',
    loadingModels: 'Loading models...',
    load: 'Load',
    unload: 'Unload',
    download: 'Download',
    delete: 'Delete',
    modelConfig: 'Model Configuration',
    plannerModel: 'Planner Model',
    executorModel: 'Executor Model',
    criticModel: 'Critic Model',
    saveModelSettings: 'Save Model Settings',
    apiConfig: 'API Configuration',
    permissions: 'Permissions',
    availableTools: 'Available Tools',
    localModels: 'Local Models',
    downloadModel: 'Download Model',
    recommendedModels: 'Recommended Models',
    language: 'Language / 语言',
    uiLanguage: 'UI Language',
    saveLanguage: 'Save Language',
    environment: 'Environment',
    activeProject: 'Active Project',
    taskQueue: 'Task Queue',
    newTask: 'New Task',
    hardware: 'Hardware',
    ram: 'RAM',
    cpu: 'CPU',
    gpu: 'GPU',
    tier: 'Tier',
    setAsPlanner: 'Use as Planner',
    setAsExecutor: 'Use as Executor',
    setAsCritic: 'Use as Critic',
    saved: 'Saved',
    savedRefresh: 'Saved, refresh to apply',
    allThreeRequired: 'All three models are required',
    downloadStarted: 'Downloading...',
    downloaded: 'Downloaded',
    downloadFailed: 'Failed',
    options: 'Options',
    type: 'Type',
    format: 'Format',
    model: 'Model',
    whatToDo: 'What do you want DaDa to do?',
    knowledgeBase: 'Knowledge Base',
    kbFiles: 'Files',
    kbChunks: 'Chunks',
    kbTerms: 'Terms',
    kbLastIndexed: 'Last Indexed',
    kbIndexNow: 'Index Now',
    kbReindex: 'Reindex',
    kbClear: 'Clear',
    kbSearch: 'Search',
    kbSearchPlaceholder: 'Search knowledge base...',
    kbSearchResults: 'Results',
    kbNever: 'Never',
    kbIndexing: 'Indexing...',
    kbCleared: 'Knowledge base cleared',
    kbIndexed: 'Indexing complete',
  },
  zh: {
    chat: '对话',
    plugins: '插件',
    history: '历史',
    projects: '项目',
    settings: '设置',
    online: '在线',
    offline: '离线',
    connected: '已连接',
    connecting: '连接中',
    running: '运行中',
    completed: '完成',
    failed: '失败',
    cancelled: '已取消',
    waitingApproval: '等待审批',
    submit: '执行',
    cancel: '取消',
    retry: '重试',
    selfImprove: '自我改进',
    steps: '步骤',
    raw: '原始数据',
    noTasks: '暂无任务，在主页创建第一个任务。',
    noModels: '未找到本地模型。请下载模型或将 .gguf 文件放入 models/ 目录。',
    loadingModels: '加载模型中...',
    load: '加载',
    unload: '卸载',
    download: '下载',
    delete: '删除',
    modelConfig: '模型配置',
    plannerModel: '规划模型',
    executorModel: '执行模型',
    criticModel: '评审模型',
    saveModelSettings: '保存模型设置',
    apiConfig: 'API 配置',
    permissions: '权限',
    availableTools: '可用工具',
    localModels: '本地模型',
    downloadModel: '下载模型',
    recommendedModels: '推荐模型',
    language: '语言 / Language',
    uiLanguage: '界面语言',
    saveLanguage: '保存语言',
    environment: '环境变量',
    activeProject: '当前项目',
    taskQueue: '任务队列',
    newTask: '新建任务',
    hardware: '硬件信息',
    ram: '内存',
    cpu: 'CPU',
    gpu: '显卡',
    tier: '推荐档位',
    setAsPlanner: '设为规划器',
    setAsExecutor: '设为执行器',
    setAsCritic: '设为评审器',
    saved: '已保存',
    savedRefresh: '已保存，刷新页面生效',
    allThreeRequired: '三个模型均为必填',
    downloadStarted: '下载中...',
    downloaded: '下载完成',
    downloadFailed: '下载失败',
    options: '选项',
    type: '类型',
    format: '格式',
    model: '模型',
    whatToDo: '你想让 DaDa 做什么？',
    knowledgeBase: '知识库',
    kbFiles: '文件',
    kbChunks: '块',
    kbTerms: '词条',
    kbLastIndexed: '上次索引',
    kbIndexNow: '立即索引',
    kbReindex: '重新索引',
    kbClear: '清空',
    kbSearch: '搜索',
    kbSearchPlaceholder: '搜索知识库...',
    kbSearchResults: '结果',
    kbNever: '从未',
    kbIndexing: '索引中...',
    kbCleared: '知识库已清空',
    kbIndexed: '索引完成',
  }
};

function t(key) {
  const locale = (() => { try { return localStorage.getItem('dada-locale') || 'en'; } catch { return 'en'; } })();
  return (T[locale] && T[locale][key]) ? T[locale][key] : (T.en[key] || key);
}

function applyLocale(locale) {
  // Update all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const translated = (T[locale] && T[locale][key]) ? T[locale][key] : (T.en[key] || key);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      el.placeholder = translated;
    } else if (el.tagName === 'OPTION') {
      el.textContent = translated;
    } else {
      el.textContent = translated;
    }
  });
  // Update placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    el.placeholder = (T[locale] && T[locale][key]) ? T[locale][key] : (T.en[key] || key);
  });
}

const S = {
  progressSource: null,
  taskPollTimer: null,
  currentTask: null,
  attachedFiles: [],
  progressEvents: [],
  config: null,
  modelOptions: [],
  activePanel: 'home',
  terminalHandled: false,
  activeProject: null,
  projects: [],
  tokenCount: 0,
  taskStartTime: 0,
  view: 'chat',
  activeTaskId: null,
  taskMessages: {},
  activeProjectTasks: [],
  dagData: null,         // { nodes, roots, leaves } from dag event
  dagCompletedIds: [],   // node IDs completed so far
};

const PHASE_PCT = { classify: 10, decompose: 18, subgoal: 22, plan: 30, execute: 55, compile: 75, verify: 85, self_evolve: 92, domain: 60, package: 94 };

// ── Cloud provider presets ──────────────────────────────────────────────────────
const CLOUD_PROVIDERS = {
  deepseek: {
    name: "DeepSeek",
    endpoint: "https://api.deepseek.com/v1",
    models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"],
    modelLabel: { "deepseek-v4-pro": "DeepSeek V4 Pro", "deepseek-v4-flash": "DeepSeek V4 Flash", "deepseek-chat": "DeepSeek Chat (V3)", "deepseek-reasoner": "DeepSeek R1 (Reasoner)" }
  },
  openai: {
    name: "OpenAI",
    endpoint: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o3-mini", "o4-mini"],
    modelLabel: {}
  },
  anthropic: {
    name: "Anthropic",
    endpoint: "https://api.anthropic.com/v1",
    models: ["claude-sonnet-4-6", "claude-opus-4-7", "claude-haiku-4-5"],
    modelLabel: {}
  },
  google: {
    name: "Google Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash"],
    modelLabel: {}
  },
  alibaba: {
    name: "通义千问",
    endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-max", "qwen-turbo", "qwen-plus-latest"],
    modelLabel: {}
  },
  zhipu: {
    name: "智谱 GLM",
    endpoint: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-4-plus", "glm-4-flash", "glm-4", "glm-4-air"],
    modelLabel: {}
  },
  moonshot: {
    name: "Moonshot Kimi",
    endpoint: "https://api.moonshot.cn/v1",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    modelLabel: {}
  },
  custom: {
    name: "Custom",
    endpoint: "",
    models: [],
    modelLabel: {}
  }
};

// ── Helpers ─────────────────────────────────────────────────────────────────────
const esc = (s) => {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
};

function extractBodyText(steps) {
  if (!steps || !steps.length) return '';
  const parts = [];
  for (const s of steps) {
    if (!s.result) continue;
    const r = s.result;
    // String result
    if (typeof r === 'string' && r.length > 20) {
      parts.push(r);
    } else if (typeof r === 'object') {
      // Search results
      if (Array.isArray(r.results) && r.results.length > 0) {
        const items = r.results.map((it, i) => {
          const title = it.title || '';
          const snippet = it.snippet || it.content || '';
          return `${i + 1}. ${title}\n   ${snippet}`;
        });
        parts.push(items.join('\n\n'));
      }
      // Web fetch body
      else if (typeof r.body === 'string' && r.body.length > 20) {
        parts.push(r.body);
      }
      // Content/text fields
      else if (typeof r.content === 'string' && r.content.length > 20) {
        parts.push(r.content);
      }
      else if (typeof r.text === 'string' && r.text.length > 20) {
        parts.push(r.text);
      }
      // Code execution stdout
      else if (typeof r.stdout === 'string' && r.stdout.length > 0) {
        parts.push(r.stdout);
      }
      // Generic summary field
      else if (typeof r.summary === 'string' && r.summary.length > 10) {
        parts.push(r.summary);
      }
    }
  }
  return parts.join('\n\n').trim();
}

const timeFmt = (iso) => {
  try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  catch { return esc(iso); }
};

const sizeFmt = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + 'B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + 'KB';
  return (bytes / 1048576).toFixed(1) + 'MB';
};

// ── Toast Notifications ─────────────────────────────────────────────────────────
function showToast(msg, type, detail) {
  type = type || 'info';
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✓', error: '✗', warning: '⚠', info: 'ℹ' };
  const toast = document.createElement('div');
  toast.className = 'toast ' + type;
  toast.innerHTML =
    `<span class="toast-icon">${icons[type] || icons.info}</span>` +
    `<div class="toast-body">` +
      `<div class="toast-msg">${esc(msg)}</div>` +
      (detail ? `<div class="toast-detail">${esc(detail)}</div>` : '') +
    `</div>` +
    `<button class="toast-close" onclick="this.closest('.toast').remove()">✕</button>`;

  container.appendChild(toast);

  // Limit to max 3 visible toasts — remove oldest
  const toasts = container.querySelectorAll('.toast');
  while (toasts.length > 3) {
    const old = toasts[0];
    old.classList.add('removing');
    setTimeout(() => { if (old.parentNode) old.remove(); }, 200);
  }

  // Auto-dismiss after 4s
  setTimeout(() => {
    if (toast.parentNode) {
      toast.classList.add('removing');
      setTimeout(() => { if (toast.parentNode) toast.remove(); }, 200);
    }
  }, 4000);
}

// ── Run Button Loading State ────────────────────────────────────────────────────
const RUN_BTN_HTML = '<span>▶</span> <span data-i18n="submit">Run</span>';
const RUN_BTN_LOADING_HTML = '<span class="btn-spinner"></span> <span>Running...</span>';

function setRunButtonLoading(loading) {
  const btn = document.getElementById('run-btn');
  if (!btn) return;
  btn.disabled = loading;
  btn.innerHTML = loading ? RUN_BTN_LOADING_HTML : RUN_BTN_HTML;
}

// ── Theme ───────────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = (() => { try { return localStorage.getItem('dada-theme'); } catch { return null; } })();
  const select = document.getElementById('settings-theme');
  if (select && saved) select.value = saved;
  applyTheme(saved || 'pearl');

  // Listen for system theme changes when in auto mode
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const current = (() => { try { return localStorage.getItem('dada-theme'); } catch { return null; } })();
      if (current === 'auto') applyTheme('auto');
    });
  }

  // Wire up theme selector
  if (select) {
    select.addEventListener('change', () => {
      applyTheme(select.value);
      try { localStorage.setItem('dada-theme', select.value); } catch {}
    });
  }
}

function applyTheme(theme) {
  if (theme === 'auto') {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'pearl');
  } else if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else if (theme === 'pearl') {
    document.documentElement.setAttribute('data-theme', 'pearl');
  } else {
    document.documentElement.setAttribute('data-theme', 'light');
  }
}

// ── Attachment Chips ────────────────────────────────────────────────────────────
function renderAttachmentChips() {
  const el = document.getElementById('attachment-chips');
  if (!el) return;
  if (!S.attachedFiles.length) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  el.style.display = 'flex';
  el.innerHTML = S.attachedFiles.map((f, i) =>
    `<span class="attachment-chip">` +
      `<span class="attachment-chip-name" title="${esc(f.name)}">${esc(f.name)}</span>` +
      `<span class="attachment-chip-size">${sizeFmt(f.size)}</span>` +
      `<button class="attachment-chip-remove" onclick="removeAttachment(${i})" title="Remove">✕</button>` +
    `</span>`
  ).join('');
}

function removeAttachment(idx) {
  S.attachedFiles.splice(idx, 1);
  renderAttachmentChips();
}

// ── API ────────────────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
    body: opts.body ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`${res.status}: ${txt.slice(0, 200)}`);
  }
  if (opts.noJson) return null;
  const ct = res.headers.get('content-type') || '';
  return ct.includes('json') ? res.json() : res.text();
}

// ── Drawer System ───────────────────────────────────────────────────────────────
function openDrawer(name) {
  closeAllDrawers();
  document.getElementById('drawer-backdrop').style.display = 'block';
  const drawer = document.getElementById('drawer-' + name);
  if (drawer) {
    drawer.classList.add('open');
    // Focus trap: keep Tab within the drawer
    const focusable = drawer.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      drawer.addEventListener('keydown', function trapTab(e) {
        if (e.key !== 'Tab') return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }, { once: true });
      first.focus();
    }
  }
  document.querySelectorAll('.topbar-drawer-btn').forEach(b => b.classList.toggle('active', b.dataset.drawer === name));
  if (name === 'history') loadHistory();
  if (name === 'settings') loadSettings();
  if (name === 'projects') loadProjects();
}

function closeDrawer(name) {
  const drawer = document.getElementById('drawer-' + name);
  if (drawer) drawer.classList.remove('open');
  document.querySelectorAll('.topbar-drawer-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('drawer-backdrop').style.display = 'none';
}

function closeAllDrawers() {
  document.querySelectorAll('.drawer').forEach(d => d.classList.remove('open'));
  document.querySelectorAll('.topbar-drawer-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('drawer-backdrop').style.display = 'none';
}

window.openDrawer = openDrawer;
window.closeDrawer = closeDrawer;

// ── Persona badge ───────────────────────────────────────────────────────────────
const PERSONA_MAP = {
  general:       { name: '智能助手', icon: '🤖' },
  research:      { name: '专业市场研究员', icon: '🔬' },
  product_research: { name: '产品战略分析师', icon: '📊' },
  code:          { name: '资深软件工程师', icon: '💻' },
  social_publish:{ name: '社交媒体运营', icon: '📱' },
  presentation:  { name: '演示文稿专家', icon: '📽️' },
  automation:    { name: '自动化工程师', icon: '⚙️' },
  data_analysis: { name: '数据分析师', icon: '📈' },
  media_analysis:{ name: '多媒体分析师', icon: '🎬' },
  image_generation: { name: '视觉设计师', icon: '🎨' },
  video_generation: { name: '视频制作人', icon: '🎥' },
  voice_generation: { name: '音频制作人', icon: '🎙️' },
  weather:       { name: '天气查询助手', icon: '🌤️' },
  financial_analysis: { name: '金融分析师', icon: '💰' },
  legal_review:  { name: '法务审查专家', icon: '⚖️' },
  hr_recruitment: { name: 'HR 招聘经理', icon: '👥' },
  engineering_design: { name: '工程设计专家', icon: '🔧' },
  content_marketing: { name: '内容营销经理', icon: '✍️' },
  customer_support: { name: '客服运营经理', icon: '🎧' },
  education:     { name: '教育课程设计师', icon: '📚' },
  healthcare:    { name: '医疗健康顾问', icon: '🏥' },
  real_estate:   { name: '房地产投资顾问', icon: '🏠' },
  video_editing: { name: '视频剪辑师', icon: '🎬' },
  podcast_production: { name: '播客制作人', icon: '🎙️' },
};

function getPersonaBadge(taskType) {
  const p = PERSONA_MAP[taskType];
  if (!p) return '';
  return `<span class="persona-badge" title="DaDa 当前身份：${p.name}">${p.icon} ${p.name}</span>`;
}

// ── Quick task type inference ────────────────────────────────────────────────────
function quickInfer(goal) {
  if (!goal) return {};
  const g = goal.toLowerCase();
  let taskType = 'auto';
  if (/code|代码|程序|写|fix|debug|bug|hello|开发|编程|函数|build|test|refactor/i.test(g)) taskType = 'code';
  else if (/research|调研|研究|分析|竞品|市场|report|报告/i.test(g)) taskType = 'research';
  else if (/ppt|slides|演示|幻灯片|presentation/i.test(g)) taskType = 'presentation';
  else if (/image|图片|画图|生成图|illustration|poster/i.test(g)) taskType = 'image_generation';
  else if (/video|视频|生成视频|视频剪辑|剪辑|editing|edit/i.test(g)) taskType = 'video_editing';
  else if (/podcast|播客|音频节目|电台/i.test(g)) taskType = 'podcast_production';
  else if (/data|数据|csv|excel|报表|统计/i.test(g)) taskType = 'data_analysis';
  else if (/automation|自动化|定时|schedule|cron/i.test(g)) taskType = 'automation';
  else if (/教育|课程|教学|学习|培训|edu/i.test(g)) taskType = 'education';
  else if (/医疗|健康|诊断|治疗|患者|病例|health/i.test(g)) taskType = 'healthcare';
  else if (/房产|房地产|买房|卖房|房价|real.?estate/i.test(g)) taskType = 'real_estate';
  else if (/金融|财务|投资|股票|fund|stock|finance/i.test(g)) taskType = 'financial_analysis';
  else if (/法律|合同|合规|legal|law/i.test(g)) taskType = 'legal_review';
  return { taskType };
}

// ── Drag-and-Drop File Attachment ───────────────────────────────────────────────
let dragCounter = 0;

function initDragDrop() {
  const dropZone = document.getElementById('chat-workspace') || document.body;

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  });

  dropZone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    if (dragCounter === 1) {
      const overlay = document.getElementById('drop-overlay');
      if (overlay) overlay.classList.add('active');
    }
  });

  dropZone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) {
      const overlay = document.getElementById('drop-overlay');
      if (overlay) overlay.classList.remove('active');
    }
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    const overlay = document.getElementById('drop-overlay');
    if (overlay) overlay.classList.remove('active');
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      await handleAttach(files);
      showToast(`Attached ${files.length} file(s)`, 'success');
    }
  });

  // Prevent browser from opening dropped files
  document.addEventListener('dragover', (e) => { e.preventDefault(); });
  document.addEventListener('drop', (e) => { e.preventDefault(); });
}

// ── Attachments ─────────────────────────────────────────────────────────────────
async function handleAttach(files) {
  const maxSize = 50 * 1024 * 1024; // 50MB
  for (const f of files) {
    if (f.size > maxSize) {
      log('[attach] File too large: ' + f.name + ' (' + sizeFmt(f.size) + ')');
      continue;
    }
    try {
      const data = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = e => res(e.target.result);
        r.onerror = rej;
        r.readAsDataURL(f);
      });
      S.attachedFiles.push({ name: f.name, data, size: f.size });
    } catch (err) {
      log('[attach] Failed to read file: ' + f.name);
    }
  }
  renderAttachmentChips();
}

// ── Voice Recording ─────────────────────────────────────────────────────────────
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

async function toggleRecording() {
  const micBtn = document.getElementById('mic-btn');
  if (!micBtn) return;

  if (isRecording) {
    // Stop recording
    mediaRecorder?.stop();
    return;
  }

  // Start recording
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      // Stop all tracks
      stream.getTracks().forEach(t => t.stop());
      isRecording = false;
      micBtn.classList.remove('recording');
      micBtn.textContent = '🎤';

      if (audioChunks.length === 0) return;

      const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType });
      const base64 = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result;
          if (typeof result === 'string') {
            resolve(result.split(',')[1] || '');
          } else {
            resolve('');
          }
        };
        reader.readAsDataURL(audioBlob);
      });

      if (!base64) return;

      // Show recording indicator
      micBtn.textContent = '⏳';
      micBtn.disabled = true;

      try {
        const data = await api('/api/voice/transcribe', {
          method: 'POST',
          body: JSON.stringify({
            dataBase64: base64,
            mimeType: mediaRecorder.mimeType
          })
        });
        if (data.text) {
          const goalEl = document.getElementById('goal');
          goalEl.value = goalEl.value ? goalEl.value + ' ' + data.text : data.text;
          goalEl.dispatchEvent(new Event('input'));
          log('[voice] ' + data.text.slice(0, 80));
        } else {
          log('[voice] Transcription failed: ' + (data.error || 'no text'));
        }
      } catch (err) {
        log('[voice] Error: ' + err.message);
      }

      micBtn.textContent = '🎤';
      micBtn.disabled = false;
      audioChunks = [];
    };

    mediaRecorder.start();
    isRecording = true;
    micBtn.classList.add('recording');
    micBtn.textContent = '🔴';
  } catch (err) {
    log('[voice] Mic error: ' + err.message);
    // Browser doesn't support microphone or user denied
    micBtn.style.opacity = '0.4';
    micBtn.title = 'Microphone not available';
  }
}

// ── Chat Progress Bar ────────────────────────────────────────────────────────────
function showChatProgressBar(visible) {
  const bar = document.getElementById('message-progress');
  if (bar) bar.style.display = visible ? 'block' : 'none';
}

function updateChatProgressBar(pct) {
  const fill = document.getElementById('message-progress-fill');
  if (fill) {
    const v = Math.min(Math.max(pct, 0), 100);
    fill.style.width = v + '%';
    fill.setAttribute('aria-valuenow', String(Math.round(v)));
  }
}

// ── Task Execution ──────────────────────────────────────────────────────────────
function setupTaskUI(reset, goal) {
  if (reset) {
    S.progressEvents = [];
    S.terminalHandled = false;
    S.tokenCount = 0;
    S.taskStartTime = Date.now();
    document.getElementById('title-tokens').textContent = 'TOK: —';
    document.getElementById('timeline').style.display = 'none';
    document.getElementById('streaming-output').style.display = 'none';
    document.getElementById('result-section').style.display = 'none';
    const existingErr = document.getElementById('error-card');
    if (existingErr) existingErr.remove();
    document.getElementById('cancel-bar').style.display = 'flex';
    document.getElementById('task-goal-display').textContent = goal || '';

    // Reset context panel
    resetContextPanel();

    // Processing state indicator
    const chatWs = document.querySelector('.chat-workspace');
    if (chatWs) chatWs.classList.add('processing');

    // Chat mode: show message list, add user bubble + thinking
    document.getElementById('home-view').style.display = 'none';
    document.getElementById('message-list').style.display = 'flex';
    if (goal) {
      const taskId = S.activeTaskId || 'current';
      addMessageToView(taskId, 'user', goal);
    }
    addThinkingIndicator(S.activeTaskId || 'current');
    showChatProgressBar(true);
    addChatSkeletons();
  }
}

function addChatSkeletons() {
  const msgList = document.getElementById('message-list');
  if (!msgList) return;
  for (let i = 0; i < 1; i++) {
    const skel = document.createElement('div');
    skel.className = 'chat-skeleton';
    skel.innerHTML =
      `<div class="chat-skeleton-avatar skeleton"></div>` +
      `<div class="chat-skeleton-body">` +
        `<div class="skeleton skeleton-title" style="width:${60 + Math.random() * 30}%"></div>` +
        `<div class="skeleton skeleton-text" style="width:${80 + Math.random() * 15}%"></div>` +
        `<div class="skeleton skeleton-text" style="width:${40 + Math.random() * 20}%"></div>` +
      `</div>`;
    msgList.appendChild(skel);
    msgList.scrollTop = msgList.scrollHeight;
  }
}

function removeChatSkeletons() {
  document.querySelectorAll('.chat-skeleton').forEach(el => el.remove());
}

function log(msg) {
  S.progressEvents.push(msg);
  if (S.progressEvents.length > 300) S.progressEvents.shift();
  // Timeline replaces the old #task-log; messages go to timeline steps
  console.log('[dada]', msg);
}

// ── SSE Watching ────────────────────────────────────────────────────────────────
function watchTask(taskId) {
  stopWatch();
  const src = new EventSource('/api/progress?taskId=' + encodeURIComponent(taskId));
  S.progressSource = src;
  let streamBuffer = '';
  const streamOut = document.getElementById('streaming-output');
  const streamText = document.getElementById('streaming-text');

  src.addEventListener('open', () => log('[connected]'));

  // Main progress: runtime emits "phase" events (classify/plan/execute/verify/...)
  src.addEventListener('phase', e => handleProgress(JSON.parse(e.data)));

  // Tool-level events for richer timeline
  src.addEventListener('tool.start', e => {
    try { const d = JSON.parse(e.data); log('  ⚙ ' + (d.payload?.tool || d.tool)); } catch {}
  });
  src.addEventListener('domain.tool_error', e => {
    try { const d = JSON.parse(e.data); log('  ⚠ ' + (d.payload?.tool || d.tool) + ': ' + (d.payload?.error || '').slice(0, 120)); } catch {}
  });

  // Listen for model token streaming events
  src.addEventListener('model.token', e => {
    try {
      const data = JSON.parse(e.data);
      const token = data.payload?.token || data.token;
      if (token) {
        S.tokenCount++;
        document.getElementById('title-tokens').textContent = 'TOK: ' + S.tokenCount;
        // In project mode, skip streaming output div — response goes to thread
        if (S.view === 'workspace' || S.activeProject) return;
        if (!streamBuffer) {
          streamOut.style.display = 'block';
          log('[streaming] started');
        }
        streamBuffer += token;
        streamText.textContent = streamBuffer;
        streamOut.scrollTop = streamOut.scrollHeight;
      }
    } catch {}
  });

  // DAG strategy event: received at task start with full DAG structure
  src.addEventListener('dag', e => {
    try {
      const data = JSON.parse(e.data);
      const p = data.payload || data;
      if (p && p.nodes) {
        S.dagData = p;
        S.dagCompletedIds = [];
        renderDagNodes();
      }
    } catch {}
  });

  // DAG progress event: fired each cycle with completed node IDs
  src.addEventListener('dag.progress', e => {
    try {
      const data = JSON.parse(e.data);
      const p = data.payload || data;
      if (p && p.completedNodeIds) {
        S.dagCompletedIds = p.completedNodeIds;
        renderDagNodes();
      }
    } catch {}
  });

  // Listen for model usage events (token counts from API)
  let _totalTokens = 0;
  src.addEventListener('model.usage', e => {
    try {
      const data = JSON.parse(e.data);
      const p = data.payload || data;
      const used = p.totalTokens || (p.promptTokens || 0) + (p.completionTokens || 0);
      if (used > 0) {
        _totalTokens += used;
        S.tokenCount = _totalTokens;
        document.getElementById('title-tokens').textContent = 'TOK: ' + _totalTokens;
      }
    } catch {}
  });

  src.addEventListener('task.completed', e => {
    handleTerminal('completed', JSON.parse(e.data));
    src.close();
  });
  src.addEventListener('task.failed', e => {
    handleTerminal('failed', JSON.parse(e.data));
    src.close();
  });
  src.addEventListener('task.waiting_approval', e => {
    handleWaitingApproval(JSON.parse(e.data));
    src.close();
  });

  // Polling fallback: single poll function, reused on SSE error and by interval
  let pollAttempts = 0;
  const MAX_POLL_ATTEMPTS = 200; // ~5 min at 1.5s interval

  async function pollOnce() {
    if (pollAttempts >= MAX_POLL_ATTEMPTS) {
      clearInterval(S.taskPollTimer);
      S.taskPollTimer = null;
      log('[polling gave up after max attempts]');
      return;
    }
    pollAttempts++;
    try {
      const resp = await api(`/api/tasks/status?taskId=${encodeURIComponent(taskId)}`);
      const data = resp.task || resp;
      const prog = resp.progress;
      const st = data.status || data.state;
      if (st === 'completed' || st === 'failed' || st === 'waiting_approval') {
        clearInterval(S.taskPollTimer);
        S.taskPollTimer = null;
        if (st === 'waiting_approval') handleWaitingApproval(data);
        else handleTerminal(st, data);
      } else {
        handleProgress(prog ? { payload: prog } : data);
      }
    } catch {}
  }

  src.addEventListener('error', () => {
    src.close();
    S.progressSource = null;
    log('[polling fallback]');
    // Only start polling interval if not already running
    if (!S.taskPollTimer) {
      S.taskPollTimer = setInterval(pollOnce, 1500);
    }
    pollOnce(); // immediate first poll
  });

  // Start polling alongside SSE as dual-path safety
  S.taskPollTimer = setInterval(pollOnce, 1500);
}

function stopWatch() {
  if (S.progressSource) { S.progressSource.close(); S.progressSource = null; }
  if (S.taskPollTimer) { clearInterval(S.taskPollTimer); S.taskPollTimer = null; }
}

function handleProgress(data) {
  const p = data.payload || data;
  if (!S.currentTask) S.currentTask = {};
  Object.assign(S.currentTask, p);
  const phase = p.phase || 'running';
  const pct = p.progress != null ? p.progress : (PHASE_PCT[phase] || 0);

  updateChatProgressBar(pct);

  const labels = { classify: 'Analyzing...', decompose: 'Planning...', subgoal: 'Working...', plan: 'Planning...', execute: 'Working...', compile: 'Compiling...', verify: 'Verifying...', package: 'Packaging...' };
  let thinkingText = labels[phase] || (phase + '...');
  if (p.cycle) thinkingText += ' (cycle ' + p.cycle + ')';
  if (p.step) thinkingText += ' step ' + p.step;
  updateThinkingIndicator(thinkingText);
  if (p.message) log(p.message);
  if (p.label) log('  ' + p.label);

  // Update context panel with live stats
  updateContextPanel(p);
}

function updateContextPanel(p) {
  const cycle = p.cycle;
  const steps = p.steps || (Array.isArray(p.completedSteps) ? p.completedSteps.length : null);
  const phase = p.phase;
  const tokens = S.tokenCount;

  setCtxVal('ctx-cycle', cycle != null ? String(cycle) : null);
  setCtxVal('ctx-steps', steps != null ? String(steps) : null);
  setCtxVal('ctx-phase', phase || null);
  setCtxVal('ctx-tokens', tokens > 0 ? String(tokens) : null);

  // Also update context bar stats
  const cyclesEl = document.getElementById('context-bar-cycles');
  const stepsEl = document.getElementById('context-bar-steps');
  if (cyclesEl && cycle != null) cyclesEl.textContent = '↻ ' + cycle;
  if (stepsEl && steps != null) stepsEl.textContent = '⇢ ' + steps;

  // Activity feed — prepend new message
  if (p.message || p.label) {
    const activityEl = document.getElementById('context-activity');
    if (activityEl) {
      const text = p.message || p.label;
      const line = document.createElement('div');
      line.style.cssText = 'padding:2px 0;border-bottom:1px solid var(--border);font-size:10px;';
      line.textContent = (phase ? '[' + phase + '] ' : '') + text.slice(0, 80);
      activityEl.insertBefore(line, activityEl.firstChild);
      while (activityEl.children.length > 30) {
        activityEl.removeChild(activityEl.lastChild);
      }
    }
  }
}

function resetContextPanel() {
  setCtxVal('ctx-cycle', null);
  setCtxVal('ctx-steps', null);
  setCtxVal('ctx-phase', null);
  setCtxVal('ctx-tokens', null);
  S.dagData = null;
  S.dagCompletedIds = [];
  const dagEl = document.getElementById('context-dag-nodes');
  if (dagEl) dagEl.innerHTML = '<span style="color:var(--text-muted)">Starting task...</span>';
  const dagBtn = document.getElementById('context-dag-diagram-btn');
  if (dagBtn) dagBtn.style.display = 'none';
  const activityEl = document.getElementById('context-activity');
  if (activityEl) activityEl.innerHTML = '<div style="color:var(--text-muted)">Waiting for task...</div>';
}

// ── DAG Node Rendering ──────────────────────────────────────────────────────────
const DAG_PHASE_COLORS = { plan: '#3B82F6', collect: '#10B981', execute: '#F59E0B', synthesize: '#8B5CF6', verify: '#EF4444', package: '#EC4899' };
const DAG_PHASE_LABELS = { plan: 'Plan', collect: 'Collect', execute: 'Execute', synthesize: 'Synthesize', verify: 'Verify', package: 'Package' };

function renderDagNodes() {
  const dagEl = document.getElementById('context-dag-nodes');
  if (!dagEl) return;

  const dagData = S.dagData;
  if (!dagData || !dagData.nodes || dagData.nodes.length === 0) {
    // Fallback: use phase from progress if available
    const phase = S.currentTask?.phase;
    if (phase) {
      const dagPhases = ['classify', 'plan', 'execute', 'verify', 'package'];
      const idx = dagPhases.indexOf(phase);
      dagEl.innerHTML = dagPhases.map((p, i) => {
        if (i < idx) return `<span style="color:var(--success);opacity:0.7">✓ ${p}</span>`;
        if (i === idx) return `<span style="color:var(--run);font-weight:600">▶ ${p}</span>`;
        return `<span style="color:var(--text-muted)">○ ${p}</span>`;
      }).join('<br>');
    }
    return;
  }

  const completed = new Set(S.dagCompletedIds || []);
  const sorted = topoSortNodes(dagData.nodes);
  // Show "Diagram" button
  const dagBtn = document.getElementById('context-dag-diagram-btn');
  if (dagBtn) dagBtn.style.display = '';

  let html = '';
  for (const n of sorted) {
    const isCompleted = completed.has(n.id);
    const isOptional = n.optional;
    const color = DAG_PHASE_COLORS[n.phase] || '#6B7280';
    const check = isCompleted ? '✓ ' : '';
    const opt = isOptional ? ' (opt)' : '';
    const style = isCompleted ? 'opacity:0.6' : '';
    html += `<div class="dag-node" style="${style}">`;
    html += `<span class="dag-node-dot ${n.phase}" style="background:${color}"></span>`;
    html += `<span style="font-size:10.5px">${check}${n.label}${opt}</span>`;
    html += `</div>`;
  }

  // Strategy recommendation
  if (dagData.strategyRecommendation) {
    const rec = dagData.strategyRecommendation;
    html += `<div style="margin-top:6px;padding:4px 6px;background:rgba(59,130,246,0.1);border-radius:4px;font-size:9.5px;color:var(--text-secondary)">`;
    html += `📊 ${escHtml(rec.label || rec.description || '')}`;
    html += `</div>`;
  }

  dagEl.innerHTML = html;
}

function topoSortNodes(nodes) {
  const sorted = [];
  const visited = new Set();
  const temp = new Set();
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  function visit(id) {
    if (visited.has(id)) return;
    if (temp.has(id)) return; // cycle — skip
    temp.add(id);
    const node = nodeMap.get(id);
    if (node) {
      for (const dep of (node.dependsOn || [])) {
        visit(dep);
      }
    }
    temp.delete(id);
    visited.add(id);
    if (node) sorted.push(node);
  }

  for (const n of nodes) {
    visit(n.id);
  }
  return sorted;
}

function escHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

async function encodeMermaidForInk(mermaidText) {
  // mermaid.ink accepts {code: "..."} JSON, UTF-8 encoded, base64
  const json = JSON.stringify({ code: mermaidText });
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function setCtxVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val || '—';
}

function appendAgentResponse(taskData, success, errorMsg) {
  let resultText = taskData.summary || taskData.verificationReason || '';
  const steps = taskData.steps || [];
  let fullOutput = '';
  for (const s of steps) {
    if (s.result) {
      if (typeof s.result === 'string' && s.result.length > 20) {
        fullOutput += s.result + '\n\n';
      } else if (s.result.content && typeof s.result.content === 'string') {
        fullOutput += s.result.content + '\n\n';
      } else if (s.result.text && typeof s.result.text === 'string') {
        fullOutput += s.result.text + '\n\n';
      }
    }
  }
  if (!fullOutput.trim()) {
    fullOutput = resultText || (success ? 'Task completed' : errorMsg || 'Task failed');
  }

  const taskId = S.activeTaskId || 'current';
  addMessageToView(taskId, 'agent', fullOutput.substring(0, 3000));
}

// ══════════════════════════════════════════════════════════════════════
// WORKSPACE MESSAGE RENDERING
// ══════════════════════════════════════════════════════════════════════
function hideWelcome() {
  const w = document.getElementById('chat-welcome');
  if (w) w.classList.add('hidden');
}
function showWelcome() {
  const w = document.getElementById('chat-welcome');
  if (w) w.classList.remove('hidden');
}

function addMessageToView(taskId, role, content, time) {
  if (!taskId) return;
  if (!S.taskMessages[taskId]) S.taskMessages[taskId] = [];
  S.taskMessages[taskId].push({ role, content, time: time || new Date().toISOString() });

  hideWelcome();
  if (role === 'agent') removeChatSkeletons();

  const msgList = document.getElementById('message-list');
  msgList.style.display = 'flex';

  const timeStr = time ? timeFmt(time) : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const bubble = document.createElement('div');
  bubble.className = 'thread-msg thread-msg-' + role;
  bubble.innerHTML = role === 'user'
    ? `<div class="thread-msg-bubble">${esc(content)}</div><div class="thread-msg-time">${esc(timeStr)}</div>`
    : `<div class="thread-msg-bubble"><div class="thread-msg-content">${esc(String(content).substring(0, 3000)).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</div><div class="thread-msg-time">${esc(timeStr)}</div></div>`;
  msgList.appendChild(bubble);
  msgList.scrollTop = msgList.scrollHeight;
  return bubble;
}

function renderTaskConversation(taskId) {
  const msgList = document.getElementById('message-list');
  msgList.innerHTML = '';

  const messages = S.taskMessages[taskId] || [];
  if (messages.length === 0) {
    // Reconstruct from task history
    const task = S.activeProjectTasks.find(t => t.taskId === taskId);
    if (task && task.goal) {
      addMessageToView(taskId, 'user', task.goal, task.createdAt);
    }
    if (task && (task.summary || task.result)) {
      const content = task.summary || (typeof task.result === 'string' ? task.result : '');
      if (content) addMessageToView(taskId, 'agent', content, task.completedAt || task.updatedAt);
    }
  } else {
    messages.forEach(msg => {
      addMessageToView(taskId, msg.role, msg.content, msg.time);
    });
  }

  msgList.style.display = messages.length > 0 || S.taskMessages[taskId]?.length > 0 ? 'flex' : 'none';
  msgList.scrollTop = msgList.scrollHeight;
}

function addThinkingIndicator(taskId) {
  const msgList = document.getElementById('message-list');
  removeThinkingIndicator();
  const bubble = document.createElement('div');
  bubble.className = 'thread-msg thread-msg-agent thread-msg-thinking';
  bubble.id = 'thinking-indicator';
  bubble.innerHTML =
    `<div class="thread-msg-bubble">` +
      `<div class="thinking-dots"><span></span><span></span><span></span></div>` +
      `<span class="thinking-text">DaDa is thinking...</span>` +
    `</div>`;
  msgList.appendChild(bubble);
  msgList.scrollTop = msgList.scrollHeight;
  return bubble;
}

function removeThinkingIndicator() {
  const el = document.getElementById('thinking-indicator');
  if (el) el.remove();
}

function updateThinkingIndicator(text) {
  const el = document.getElementById('thinking-indicator');
  const tb = el?.querySelector('.thinking-text');
  if (tb) tb.textContent = text;
}

function handleTerminal(status, data) {
  stopWatch();
  removeThinkingIndicator();
  removeChatSkeletons();
  document.getElementById('cancel-bar').style.display = 'none';
  setRunButtonLoading(false);
  const chatWs = document.querySelector('.chat-workspace');
  if (chatWs) chatWs.classList.remove('processing');

  const payload = data.payload || data;
  const result = payload.result || payload;
  const taskId = result.taskId || S.activeTaskId;

  if (status === 'completed' || status === 'done') {
    const bodyText = result.content || extractBodyText(result.steps || []);
    const answer = bodyText || result.summary || result.verificationReason || '';

    // Always add agent reply as a chat bubble
    if (taskId && answer) {
      addMessageToView(taskId, 'agent', answer);
    }
    if (result.steps && result.steps.length > 0) {
      log('[task completed] ' + result.steps.length + ' steps, tokens=' + (result.totalTokens || '?'));
    }
  } else if (status === 'failed') {
    const error = result.error || result.verificationReason || 'Task failed.';
    if (taskId) {
      addMessageToView(taskId, 'agent', '❌ ' + esc(String(error).slice(0, 300)));
    }
    if (result.steps && result.steps.length > 0) {
      log('[task failed] ' + result.steps.length + ' steps, error=' + String(error).slice(0, 80));
    }
  }

  // Update task in project task list
  if (S.activeProjectTasks && result.taskId) {
    const t = S.activeProjectTasks.find(t2 => t2.taskId === result.taskId);
    if (t) { t.status = status === 'failed' ? 'failed' : 'completed'; t.result = result; }
    renderProjectTaskList();
  }

  // Reset context panel and progress
  showChatProgressBar(false);
  resetContextPanel();

  S.currentTask = null;
  S.taskStartTime = 0;
  S.activeTaskId = null;
}

function handleWaitingApproval(data) {
  stopWatch();
  const payload = data.payload || data;
  S.currentTask = { ...payload, state: 'waiting_approval' };
  document.getElementById('cancel-bar').style.display = 'none';
  updateThinkingIndicator('Waiting for approval...');
  setRunButtonLoading(false);
}

// ── Start Task ──────────────────────────────────────────────────────────────────
async function startTask() {
  const goal = document.getElementById('goal').value.trim();
  if (!goal) {
    const textarea = document.getElementById('goal');
    textarea.classList.add('shake');
    textarea.addEventListener('animationend', () => textarea.classList.remove('shake'), { once: true });
    textarea.focus();
    showToast('Please enter a goal', 'warning');
    return;
  }

  const taskType = document.getElementById('task-type').value;
  const outputFormat = document.getElementById('output-format').value;
  const modelOverride = document.getElementById('model-select').value;
  const plannerOverride = document.getElementById('planner-model-input')?.value || modelOverride;
  const executionMode = document.getElementById('execution-mode')?.value || 'auto';
  const collaborationMode = document.getElementById('collaboration-mode')?.value || 'dag-pipeline';

  if (!S.activeTaskId) {
    S.activeTaskId = 'new-' + Date.now();
  }

  setupTaskUI(true, goal);
  setRunButtonLoading(true);
  document.getElementById('goal').value = '';
  log('[submitting] ' + goal.slice(0, 80) + (executionMode === 'project' ? ' [project]' : ''));

  try {
    const body = {
      goal, taskType, outputFormat,
      attachments: S.attachedFiles.length ? S.attachedFiles : undefined,
    };
    // Execution mode: "auto" uses server-side detection, others are explicit
    if (executionMode !== 'auto') {
      body.executionMode = executionMode;
    }
    if (executionMode === 'project') {
      body.collaborationMode = collaborationMode;
    }
    if (plannerOverride) {
      body.modelOverrides = { plannerModel: plannerOverride };
    }
    if (S.activeProject?.id) {
      body.projectId = S.activeProject.id;
    }

    const data = await api('/api/run-async', { method: 'POST', body });
    const task = data.task || data;
    const taskId = task?.taskId;

    if (taskId) {
      // Replace temp placeholder with real task ID and migrate messages
      if (S.activeTaskId && S.activeTaskId.startsWith('new-')) {
        const tempId = S.activeTaskId;
        S.activeTaskId = taskId;
        if (S.taskMessages[tempId] && tempId !== taskId) {
          S.taskMessages[taskId] = (S.taskMessages[taskId] || []).concat(S.taskMessages[tempId]);
          delete S.taskMessages[tempId];
        }
      }
      S.currentTask = { taskId, goal };
      log('[task ' + taskId.slice(0, 8) + ']');
      watchTask(taskId);
    } else {
      log('[error: no taskId returned]');
      setRunButtonLoading(false);
    }
  } catch (err) {
    log('[ERROR] ' + err.message);
    setRunButtonLoading(false);
    document.getElementById('cancel-bar').style.display = 'none';
  }
}

async function cancelTask() {
  if (!S.currentTask?.taskId) return;
  try {
    await api('/api/tasks/cancel', { method: 'POST', body: { taskId: S.currentTask.taskId } });
    stopWatch();
    document.getElementById('cancel-bar').style.display = 'none';
    setRunButtonLoading(false);
    if (S.view === 'workspace') {
      removeThinkingIndicator();
    } else {
      addTimelineStep('◼', 'Cancelled', 'Task was cancelled by user', 'done');
    }
  } catch (err) { log('[ERROR] ' + err.message); }
}

// ── Retry / Replay ──────────────────────────────────────────────────────────────
async function retryTask() {
  if (!S.currentTask?.taskId) return;
  try {
    const goal = S.currentTask.goal || '';
    setupTaskUI(true, goal);
    setRunButtonLoading(true);
    log('[retrying]');
    const data = await api('/api/tasks/retry', { method: 'POST', body: { taskId: S.currentTask.taskId } });
    const task = data.task || data;
    S.currentTask = { taskId: task.taskId, goal: task.goal || goal };
    watchTask(task.taskId);
  } catch (err) { log('[ERROR] ' + err.message); setRunButtonLoading(false); }
}

async function replayTask() {
  if (!S.currentTask?.taskId) return;
  try {
    const goal = S.currentTask.goal || '';
    setupTaskUI(true, goal);
    setRunButtonLoading(true);
    log('[self-improving]');
    const data = await api('/api/tasks/replay-failed', {
      method: 'POST',
      body: { taskId: S.currentTask.taskId, selfImprove: true },
    });
    const task = data.task || (data.tasks && data.tasks[0]) || data;
    S.currentTask = { taskId: task.taskId, goal: task.goal || goal };
    watchTask(task.taskId);
  } catch (err) { log('[ERROR] ' + err.message); setRunButtonLoading(false); }
}

// ── Render Result ───────────────────────────────────────────────────────────────
function renderResult(data) {
  // SSE emits { result }, so unwrap if needed
  const r = data.result || data;
  const section = document.getElementById('result-section');
  section.style.display = 'block';
  section.className = 'card result-card';

  const success = r.success !== false;
  const stateEl = document.getElementById('result-state');
  stateEl.textContent = success ? 'SUCCESS' : 'FAILED';
  stateEl.className = 'result-state ' + (success ? 'success' : 'failure');

  // Summary
  const summaryEl = document.getElementById('result-summary');
  summaryEl.textContent = r.summary || r.verificationReason || 'Task completed';

  // Meta info
  let metaEl = document.getElementById('result-meta');
  if (!metaEl) {
    metaEl = document.createElement('div');
    metaEl.id = 'result-meta';
    metaEl.className = 'result-meta';
    const headerEl = document.querySelector('.result-header');
    if (headerEl) headerEl.appendChild(metaEl);
  }
  const steps = r.steps || [];
  const artCount = (r.artifacts || []).length;
  const tokenCount = r.totalTokens || S.tokenCount || 0;
  const durationMs = S.taskStartTime ? (Date.now() - S.taskStartTime) : 0;
  const durationStr = durationMs > 0
    ? (durationMs < 60000 ? Math.round(durationMs / 1000) + 's' : (durationMs / 60000).toFixed(1) + 'm')
    : '';
  metaEl.innerHTML =
    `<span class="result-meta-item">◆ ${steps.length} steps</span>` +
    (artCount ? `<span class="result-meta-item">⊟ ${artCount} artifacts</span>` : '') +
    (tokenCount ? `<span class="result-meta-item">⚡ ${tokenCount} tok</span>` : '') +
    (durationStr ? `<span class="result-meta-item">⏱ ${durationStr}</span>` : '');

  // ── Extract content from steps ─────────────────────────────────────
  let bodyText = r.content || extractBodyText(steps);

  if (!bodyText) {
    bodyText = r.verificationReason || r.summary || '';
  }

  // Result body
  let bodyEl = document.getElementById('result-body');
  if (!bodyEl) {
    bodyEl = document.createElement('div');
    bodyEl.id = 'result-body';
    bodyEl.className = 'result-body';
    const resultSection = document.getElementById('result-section');
    const stepsEl = document.getElementById('result-steps');
    resultSection.insertBefore(bodyEl, stepsEl);
  }

  // Copy button — inject into result-actions area
  let copyBtn = document.getElementById('result-copy-btn');
  if (!copyBtn) {
    copyBtn = document.createElement('button');
    copyBtn.id = 'result-copy-btn';
    copyBtn.className = 'result-copy-btn';
    copyBtn.textContent = '❐ Copy';
    copyBtn.addEventListener('click', () => {
      const text = bodyText || r.summary || JSON.stringify(r, null, 2);
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = '✓ Copied';
        copyBtn.classList.add('copied');
        setTimeout(() => { copyBtn.textContent = '❐ Copy'; copyBtn.classList.remove('copied'); }, 2000);
      }).catch(() => { copyBtn.textContent = '✗ Failed'; });
    });
    const actionsEl = document.querySelector('.result-actions');
    if (actionsEl) actionsEl.insertBefore(copyBtn, actionsEl.firstChild);
  }
  copyBtn.style.display = (bodyText || r.summary) ? 'inline-flex' : 'none';

  if (bodyText && bodyText.length > 10) {
    bodyEl.innerHTML = '<p>' + esc(bodyText).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
    bodyEl.style.display = 'block';
  } else if (!success) {
    bodyEl.innerHTML = `<div class="result-empty">${esc(r.error || r.verificationReason || 'Task failed')}</div>`;
    bodyEl.style.display = 'block';
  } else if (r.summary && r.summary.length > 10) {
    bodyEl.innerHTML = esc(r.summary);
    bodyEl.style.display = 'block';
  } else {
    bodyEl.innerHTML = '<div class="result-empty">Task completed. Check Steps or Raw for details.</div>';
    bodyEl.style.display = 'block';
  }

  // Steps
  const stepsEl = document.getElementById('result-steps');
  if (steps.length) {
    const icons = { classify: '❐', plan: '≡', execute: '▶', done: '✓', error: '✗', note: '·', think: '·', reflect: '↻', verify: '✔', approval_required: '🔒' };
    const stepTypes = { execute: 'exec', done: 'done', error: 'err', plan: 'plan' };
    stepsEl.innerHTML = steps.map((s) => {
      const icon = icons[s.action] || '·';
      const cls = stepTypes[s.action] || '';
      let body = '';
      if (s.tool && s.action === 'execute') {
        body = `<strong>${esc(s.tool)}</strong>`;
        const sr = s.result;
        if (sr && typeof sr === 'object') {
          const preview = sr.content || sr.text || JSON.stringify(sr);
          body += ' → ' + esc(String(preview).slice(0, 120));
        } else if (sr && typeof sr === 'string') {
          body += ' → ' + esc(sr.slice(0, 120));
        }
      } else if (s.reasoning) {
        body = esc(s.reasoning.slice(0, 200));
      } else {
        body = esc(s.action || 'step');
      }
      return `<div class="step-item">
        <span class="step-icon ${cls}">${icon}</span>
        <span class="step-content">${body}</span>
      </div>`;
    }).join('');
  } else {
    stepsEl.innerHTML = '';
  }

  // Toggle steps
  const toggleBtn = document.getElementById('toggle-steps-btn');
  toggleBtn.style.display = steps.length ? 'inline-flex' : 'none';
  toggleBtn.textContent = 'Steps ▾';
  stepsEl.style.display = 'none';

  // Raw
  document.getElementById('result-raw').textContent = JSON.stringify(data, null, 2);
  document.getElementById('result-raw').style.display = 'none';
  document.getElementById('toggle-raw-btn').textContent = 'Raw ▸';

  // Artifacts
  const artEl = document.getElementById('artifact-list');
  const arts = r.artifacts || [];
  if (arts.length) {
    artEl.innerHTML = arts.map(a => {
      const icon = getArtIcon(a.type || a.name || '');
      const path = a.path || a.url || '';
      const name = a.name || path || 'artifact';
      return `<div class="artifact-item">
        <span class="artifact-icon">${icon}</span>
        <span class="artifact-name">${esc(name)}</span>
        ${a.size != null ? `<span class="artifact-size">${sizeFmt(a.size)}</span>` : ''}
        ${path ? `<a class="artifact-link" href="/api/artifacts/file?path=${encodeURIComponent(path)}" target="_blank">Open</a>` : ''}
      </div>`;
    }).join('');
    artEl.style.display = 'flex';
  } else {
    artEl.innerHTML = '';
    artEl.style.display = 'none';
  }

  // Retry / Replay buttons
  const retryBtn = document.getElementById('retry-btn');
  const replayBtn = document.getElementById('replay-btn');
  retryBtn.style.display = 'none';
  replayBtn.style.display = 'none';
}

// ── Render Error Card ──────────────────────────────────────────────────────────
function renderErrorCard(taskData, rawData) {
  const oldSection = document.getElementById('result-section');
  if (oldSection) oldSection.style.display = 'none';

  // Remove any existing error card
  const existing = document.getElementById('error-card');
  if (existing) existing.remove();

  const errorMsg = rawData.error || taskData.error || taskData.verificationReason || 'Unknown error';
  const errorType = rawData.errorType || (taskData.verificationReason ? 'Verification Failed' : 'Task Error');
  const stackTrace = rawData.stack || taskData.stack || rawData.errorStack || '';
  const stepCount = (taskData.steps || []).length;

  // Suggest next action based on error type
  let suggestion = 'Check the error details below and try adjusting your task description.';
  if (/timeout|timed out/i.test(errorMsg)) {
    suggestion = '<strong>Timeout</strong> — The task took too long. Try simplifying the request or increasing MAX_STEPS in settings.';
  } else if (/api.*key|auth|unauthorized|401|403/i.test(errorMsg)) {
    suggestion = '<strong>Authentication issue</strong> — Check your API key in Settings > Cloud Provider.';
  } else if (/model.*not found|404.*model/i.test(errorMsg)) {
    suggestion = '<strong>Model not available</strong> — The configured model may not exist. Check your model assignment in Settings.';
  } else if (/network|fetch|ECONNREFUSED|ENOTFOUND/i.test(errorMsg)) {
    suggestion = '<strong>Network error</strong> — Check your internet connection and the API endpoint in Settings.';
  }

  const errorCard = document.createElement('div');
  errorCard.id = 'error-card';
  errorCard.className = 'error-card';
  errorCard.innerHTML =
    `<div class="error-card-header">` +
      `<div class="error-card-icon">✗</div>` +
      `<div class="error-card-info">` +
        `<div class="error-card-type">${esc(errorType)}</div>` +
        `<div class="error-card-message">${esc(errorMsg.slice(0, 300))}</div>` +
        `<div class="error-card-context">Task had ${stepCount} step(s) before failure</div>` +
      `</div>` +
    `</div>` +
    `<div class="error-card-suggestion">${suggestion}</div>` +
    (stackTrace ? `<button class="toggle-details-btn" id="toggle-error-stack" style="margin-top:8px">Show Details ▸</button>` +
     `<div class="error-card-stack" id="error-stack" style="display:none">${esc(stackTrace)}</div>` : '') +
    `<div class="error-card-actions">` +
      `<button class="action-btn" id="error-retry-btn">Retry</button>` +
      `<button class="action-btn" id="error-selfimprove-btn">Self-improve</button>` +
    `</div>`;

  // Insert after timeline
  const timeline = document.getElementById('timeline');
  if (timeline && timeline.parentNode) {
    timeline.parentNode.insertBefore(errorCard, timeline.nextSibling);
  } else {
    const main = document.querySelector('.main');
    if (main) main.appendChild(errorCard);
  }

  // Wire up stack toggle
  const stackToggle = errorCard.querySelector('#toggle-error-stack');
  const stackEl = errorCard.querySelector('#error-stack');
  if (stackToggle && stackEl) {
    stackToggle.addEventListener('click', () => {
      const isHidden = stackEl.style.display === 'none';
      stackEl.style.display = isHidden ? 'block' : 'none';
      stackToggle.textContent = isHidden ? 'Hide Details ▴' : 'Show Details ▸';
    });
  }

  // Wire up action buttons
  errorCard.querySelector('#error-retry-btn').addEventListener('click', retryTask);
  errorCard.querySelector('#error-selfimprove-btn').addEventListener('click', replayTask);

  // Raw data still available in result section (hidden)
  const rawEl = document.getElementById('result-raw');
  if (rawEl) rawEl.textContent = JSON.stringify(rawData, null, 2);
}

function getArtIcon(name) {
  const t = (name || '').toLowerCase();
  if (t.includes('image') || t.includes('png') || t.includes('jpg')) return '⊡';
  if (t.includes('video') || t.includes('mp4')) return '►';
  if (t.includes('audio') || t.includes('mp3') || t.includes('wav')) return '♪';
  if (t.includes('pdf')) return '▯';
  if (t.includes('html')) return '◎';
  if (t.includes('markdown') || t.includes('.md')) return '≡';
  return '·';
}

// ── Load Data ───────────────────────────────────────────────────────────────────
async function loadHistory() {
  // Show skeleton while loading
  const el = document.getElementById('history-list');
  const countEl = document.getElementById('history-count');
  el.innerHTML = Array.from({ length: 3 }, () =>
    `<div class="skeleton skeleton-card"></div>`
  ).join('');
  if (countEl) countEl.textContent = '...';

  try {
    const data = await api('/api/tasks');
    const items = Array.isArray(data) ? data : (data.tasks || []);
    if (countEl) countEl.textContent = items.length;

    if (!items.length) {
      el.innerHTML = '<div class="empty-state">' + esc(t('noTasks')) + '</div>';
      return;
    }

    el.innerHTML = items.slice(0, 80).map(item =>
      `<div class="history-item" data-task-id="${esc(item.taskId)}">
        <span class="history-time">${timeFmt(item.createdAt || item.startedAt)}</span>
        <span class="history-goal">${esc(item.goal || '')}</span>
        <span class="history-badge ${item.status || item.state}">${esc(item.status || item.state)}</span>
      </div>`
    ).join('');

    el.querySelectorAll('.history-item').forEach(row => {
      row.addEventListener('click', () => {
        const tid = row.dataset.taskId;
        if (tid) {
          openTaskDetail(tid);
        }
      });
    });

  } catch (err) {
    console.error('loadHistory failed:', err);
    el.innerHTML = '<div class="empty-state">History load failed: ' + esc(err.message) + '</div>';
    showToast('History load failed', 'error', err.message);
  }
}

async function loadTools() {
  try {
    const data = await api('/api/tools');
    const arr = Array.isArray(data) ? data : (data.tools || []);
    document.getElementById('tools-count').textContent = arr.length;

    const el = document.getElementById('tools-grid');
    if (!arr.length) {
      el.innerHTML = '<div class="empty-state">No tools loaded.</div>';
      return;
    }

    el.innerHTML = arr.map(t => {
      const unavailable = t.available === false;
      const cls = unavailable ? 'tool-card unavailable' : 'tool-card';
      const reason = unavailable ? `<span class="tool-unavailable-reason">${esc(t.unavailableReason || 'unavailable')}</span>` : '';
      return `<div class="${cls}">
        <span class="tool-name">${esc(t.id || t.name)}</span>
        <span class="tool-desc">${esc(t.description || '')}</span>
        ${t.riskLevel ? `<span class="tool-risk ${t.riskLevel}">${t.riskLevel}</span>` : ''}
        ${reason}
      </div>`;
    }).join('');
  } catch (err) {
    console.error('loadTools failed:', err);
    showToast('Tools load failed', 'error', err.message);
  }
}

// ── Local Models ──────────────────────────────────────────────────────────────────
// Fallback recommendations when server hardware data is unavailable
const FALLBACK_MODELS = [
  { id: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf', description: 'Qwen2.5 7B (Q4_K_M) ~4.4GB', tier: 'entry', why: '中文优秀，7B 级别最佳性价比' },
  { id: 'Llama-3.1-8B-Instruct-Q4_K_M.gguf', description: 'Llama 3.1 8B (Q4_K_M) ~4.9GB', tier: 'entry', why: 'Meta 旗舰 8B，工具调用可靠' },
  { id: 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf', description: 'Qwen2.5 1.5B (Q4_K_M) ~1.1GB', tier: 'minimal', why: '最小可用模型' },
  { id: 'Qwen2.5-14B-Instruct-Q4_K_M.gguf', description: 'Qwen2.5 14B (Q4_K_M) ~8.5GB', tier: 'balanced', why: '中文推理优秀' },
  { id: 'Qwen2.5-32B-Instruct-Q4_K_M.gguf', description: 'Qwen2.5 32B (Q4_K_M) ~19GB', tier: 'pro', why: '中文能力接近云端模型' },
];

const MODEL_DOWNLOAD_URLS = {
  'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf': 'https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf',
  'Qwen2.5-7B-Instruct-Q4_K_M.gguf': 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
  'Qwen2.5-14B-Instruct-Q4_K_M.gguf': 'https://huggingface.co/bartowski/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf',
  'Qwen2.5-32B-Instruct-Q4_K_M.gguf': 'https://huggingface.co/bartowski/Qwen2.5-32B-Instruct-GGUF/resolve/main/Qwen2.5-32B-Instruct-Q4_K_M.gguf',
  'Llama-3.2-1B-Instruct-Q4_K_M.gguf': 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
  'Llama-3.1-8B-Instruct-Q4_K_M.gguf': 'https://huggingface.co/bartowski/Llama-3.1-8B-Instruct-GGUF/resolve/main/Llama-3.1-8B-Instruct-Q4_K_M.gguf',
  'Llama-3.3-12B-Instruct-Q4_K_M.gguf': 'https://huggingface.co/bartowski/Llama-3.3-12B-Instruct-GGUF/resolve/main/Llama-3.3-12B-Instruct-Q4_K_M.gguf',
  'Mistral-Small-22B-ArliAI-Q4_K_M.gguf': 'https://huggingface.co/bartowski/Mistral-Small-22B-ArliAI-GGUF/resolve/main/Mistral-Small-22B-ArliAI-Q4_K_M.gguf',
};

function getModelDownloadUrl(modelId) {
  return MODEL_DOWNLOAD_URLS[modelId] || '';
}

async function loadLocalModels() {
  try {
    const [modelData, hwData] = await Promise.allSettled([
      api('/api/models'),
      api('/api/hardware')
    ]);

    const data = modelData.status === 'fulfilled' ? modelData.value : { models: [], status: {} };
    const hw = hwData.status === 'fulfilled' ? hwData.value : null;

    const models = data.models || [];
    const status = data.status || {};
    document.getElementById('local-models-count').textContent = models.length;

    // ── Hardware info card ──────────────────────────────────────────
    const hwEl = document.getElementById('hardware-info');
    if (hwEl && hw) {
      const gpuStr = hw.hardware?.gpu?.detected
        ? `${esc(hw.hardware.gpu.vendor)} ${esc(hw.hardware.gpu.model || '')}${hw.hardware.gpu.vramMB ? ` (${hw.hardware.gpu.vramMB}MB)` : ''}`
        : (t('gpu') + ': N/A');
      hwEl.innerHTML = `<div class="hardware-card">
        <div class="hardware-row"><span class="hw-label">${t('ram')}:</span> ${hw.hardware?.ramTotalGB || '?'}GB (${hw.hardware?.ramFreeGB || '?'}GB free)</div>
        <div class="hardware-row"><span class="hw-label">CPU:</span> ${hw.hardware?.cpuCores || '?'} cores</div>
        <div class="hardware-row"><span class="hw-label">${t('gpu')}:</span> ${gpuStr}</div>
        <div class="hardware-row"><span class="hw-label">${t('tier')}:</span> <span class="tier-badge ${hw.tier || 'entry'}">${hw.tier || 'entry'}</span></div>
      </div>`;
    }

    // ── Detected local providers ────────────────────────────────────
    const providersEl = document.getElementById('local-providers');
    if (providersEl && status.detectedLocalEndpoints && status.detectedLocalEndpoints.length > 0) {
      providersEl.style.display = '';
      providersEl.innerHTML = `<div class="hardware-card" style="border-color: #10B981;">
        <div class="hardware-row"><span class="hw-label">Local Services Detected:</span></div>
        ${status.detectedLocalEndpoints.map(ep => `<div class="hardware-row" style="color:#10B981">✓ ${esc(ep)}</div>`).join('')}
      </div>`;
    }

    // ── Model list ───────────────────────────────────────────────────
    const el = document.getElementById('local-models-list');
    if (!models.length) {
      el.innerHTML = `<div class="empty-state">${t('noModels')}</div>`;
    } else {
      el.innerHTML = models.map(m => {
        const loaded = status.currentModelId === m.id && status.loaded;
        const sizeStr = m.size ? (m.size / 1e9).toFixed(1) + 'GB' : '';
        const cls = loaded ? 'model-card loaded' : 'model-card';
        const mmLabel = m.id.toLowerCase().includes('llava') || m.id.toLowerCase().includes('gemma')
          ? '<span class="model-badge mm">vision</span>' : '';
        return `<div class="${cls}">
          <div class="model-card-info">
            <span class="model-card-name">${esc(m.name || m.id)}</span>
            <span class="model-card-meta">${sizeStr}${m.quantization ? ' | ' + esc(m.quantization) : ''}${m.contextSize ? ' | ' + m.contextSize + ' ctx' : ''}</span>
            ${mmLabel}
          </div>
          <div class="model-card-actions">
            ${loaded
              ? '<button class="model-btn unload" onclick="unloadModel()">' + t('unload') + '</button>'
              : `<button class="model-btn load" onclick="loadModel('${esc(m.id)}')">${t('load')}</button>`
            }
            <button class="model-btn set-model" onclick="setModelAs('${esc(m.id)}', 'planner')" title="${t('setAsPlanner')}">P</button>
            <button class="model-btn set-model" onclick="setModelAs('${esc(m.id)}', 'executor')" title="${t('setAsExecutor')}">E</button>
            <button class="model-btn set-model" onclick="setModelAs('${esc(m.id)}', 'critic')" title="${t('setAsCritic')}">C</button>
            <button class="model-btn delete-model" onclick="deleteModel('${esc(m.id)}')" title="${t('delete')}">✕</button>
          </div>
        </div>`;
      }).join('');
    }

    // ── Recommended models (from server hardware data or fallback) ──
    const recEl = document.getElementById('model-recommendations');
    let recs = [];
    if (hw && hw.recommendations && hw.recommendations.length > 0) {
      recs = hw.recommendations.flatMap(r =>
        (r.models || []).map(m => ({ ...m, tier: r.tier }))
      );
    } else {
      recs = FALLBACK_MODELS;
    }
    // Filter out models already downloaded
    const installedIds = new Set(models.map(m => m.id));
    const newRecs = recs.filter(r => !installedIds.has(r.id));

    recEl.innerHTML = `<p class="model-ram-hint">${t('tier')}: ${hw?.tier || 'entry'} — ${t('recommendedModels')}:</p>` +
      newRecs.slice(0, 6).map(rm => {
        const dlUrl = getModelDownloadUrl(rm.id);
        return `<div class="model-card recommended">
          <div class="model-card-info">
            <span class="model-card-name">${esc(rm.description || rm.id)}</span>
            <span class="model-card-meta">${esc(rm.tier || '')} · ${esc(rm.why || '')}</span>
          </div>
          <div class="model-card-actions">
            ${dlUrl ? `<button class="model-btn download" onclick="downloadRecommended('${esc(dlUrl)}', '${esc(rm.id)}')">${t('download')}</button>` : ''}
          </div>
        </div>`;
      }).join('');

    if (newRecs.length === 0) {
      recEl.innerHTML += '<div class="empty-state" style="padding:8px;font-size:12px">All recommended models are already installed.</div>';
    }
  } catch (e) {
    console.error('Failed to load models:', e);
  }
}

async function loadModel(id) {
  try {
    const res = await api('/api/models/load', { method: 'POST', body: JSON.stringify({ modelId: id }) });
    if (res.loaded) {
      log('[model] Loaded: ' + id);
      await loadLocalModels();
      await loadModelOptions();
    } else {
      log('[model] Failed to load: ' + (res.error || id));
    }
  } catch (e) {
    log('[model] Error loading: ' + e.message);
  }
}

async function unloadModel() {
  try {
    await api('/api/models/unload', { method: 'POST' });
    log('[model] Unloaded');
    await loadLocalModels();
  } catch (e) {
    log('[model] Error unloading: ' + e.message);
  }
}

async function downloadRecommended(url, filename) {
  document.getElementById('model-download-url').value = url;
  document.getElementById('model-download-name').value = filename;
  downloadModel();
}

async function setModelAs(modelId, role) {
  const fieldMap = { planner: 'settings-planner-model', executor: 'settings-executor-model', critic: 'settings-critic-model' };
  const fieldId = fieldMap[role];
  if (!fieldId) return;
  const modelValue = 'builtin:' + modelId;
  const selectEl = document.getElementById(fieldId);
  if (!selectEl) return;
  // Add the option if not present
  if (![...selectEl.options].some(o => o.value === modelValue)) {
    const opt = document.createElement('option');
    opt.value = modelValue;
    opt.textContent = 'builtin:' + modelId;
    selectEl.appendChild(opt);
  }
  selectEl.value = modelValue;
  // Also update config
  if (S.config) {
    if (role === 'planner') S.config.plannerModel = modelValue;
    if (role === 'executor') S.config.executorModel = modelValue;
    if (role === 'critic') S.config.criticModel = modelValue;
  }
  await saveModelSettings();
  log('[model] Set ' + role + ' → ' + modelId);
}

async function deleteModel(modelId) {
  if (!confirm('Delete model: ' + modelId + '?')) return;
  try {
    const res = await api('/api/models/delete', { method: 'POST', body: JSON.stringify({ modelId }) });
    if (res.deleted) {
      log('[model] Deleted: ' + modelId);
      await loadLocalModels();
      await loadModelOptions();
    } else {
      log('[model] Failed to delete: ' + (res.error || 'unknown error'));
    }
  } catch (e) {
    log('[model] Error deleting: ' + e.message);
  }
}

async function downloadModel() {
  const url = document.getElementById('model-download-url').value.trim();
  const filename = document.getElementById('model-download-name').value.trim();
  if (!url) { showToast('Enter a model URL', 'warning'); return; }

  const progressEl = document.getElementById('model-download-progress');
  const fillEl = document.getElementById('model-download-fill');
  const statusEl = document.getElementById('model-download-status');
  const btn = document.getElementById('model-download-btn');

  progressEl.style.display = 'block';
  fillEl.style.width = '0%';
  fillEl.classList.add('downloading');
  statusEl.textContent = 'Connecting...';
  statusEl.innerHTML = '<span class="dl-label">Connecting...</span>';
  btn.disabled = true;

  const formatSpeed = (bytesPerSec) => {
    if (bytesPerSec < 1024) return bytesPerSec.toFixed(0) + ' B/s';
    if (bytesPerSec < 1048576) return (bytesPerSec / 1024).toFixed(1) + ' KB/s';
    return (bytesPerSec / 1048576).toFixed(1) + ' MB/s';
  };

  const formatSize = (bytes) => {
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  };

  try {
    const res = await fetch('/api/models/download-stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url, filename: filename || undefined })
    });

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      let eventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            if (eventType === 'progress') {
              const pct = data.percent || 0;
              fillEl.style.width = pct + '%';
              let status = pct + '%';
              if (data.speed > 0) status += ' · ' + formatSpeed(data.speed);
              if (data.total > 0) status += ' · ' + formatSize(data.loaded) + ' / ' + formatSize(data.total);
              statusEl.innerHTML = '<span class="dl-label">' + status + '</span>';
            } else if (eventType === 'complete') {
              fillEl.style.width = '100%';
              fillEl.classList.remove('downloading');
              fillEl.classList.add('done');
              statusEl.innerHTML = '<span class="dl-label dl-done">Downloaded: ' + data.filename + '</span>';
              log('[model] Downloaded: ' + data.filename);
              await loadLocalModels();
              await loadModelOptions();
            } else if (eventType === 'error') {
              fillEl.classList.remove('downloading');
              fillEl.classList.add('error');
              statusEl.innerHTML = '<span class="dl-label dl-error">Error: ' + data.message + '</span>';
            }
          } catch { /* skip malformed JSON */ }
          eventType = '';
        }
      }
    }
  } catch (e) {
    fillEl.classList.remove('downloading');
    fillEl.classList.add('error');
    statusEl.innerHTML = '<span class="dl-label dl-error">Error: ' + e.message + '</span>';
  }
  btn.disabled = false;
}

// Wire up model download button listener
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('model-download-btn');
  if (btn) btn.addEventListener('click', downloadModel);
});

function detectProviderFromEndpoint(endpoint) {
  if (!endpoint) return 'custom';
  for (const [key, p] of Object.entries(CLOUD_PROVIDERS)) {
    if (key === 'custom') continue;
    if (endpoint.includes(new URL(p.endpoint).hostname)) return key;
  }
  return 'custom';
}

function populateModelSelects(providerKey) {
  const provider = CLOUD_PROVIDERS[providerKey] || CLOUD_PROVIDERS.custom;
  const cloudModels = provider.models.map(m => ({
    value: 'cloud:' + m,
    label: provider.modelLabel[m] || m
  }));
  const localOpts = S.modelOptions.filter(m => m.value && !m.value.startsWith('cloud:'));
  const allOpts = [
    { value: '', label: 'default (.env)' },
    ...cloudModels,
    ...localOpts
  ];

  ['settings-planner-model', 'settings-executor-model', 'settings-critic-model', 'model-select'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = allOpts.map(m =>
      `<option value="${esc(m.value)}">${esc(m.label)}</option>`
    ).join('');
    if (cur) sel.value = cur;
  });
}

async function loadConfig() {
  try {
    const data = await api('/api/config');
    S.config = data;

    // Topbar model badge
    const modelName = data.plannerModel || 'unknown';
    const topbarModel = document.getElementById('topbar-model-name');
    if (topbarModel) topbarModel.textContent = modelName.length > 24 ? modelName.slice(0, 24) + '...' : modelName;

    // Detect provider from endpoint
    const providerKey = detectProviderFromEndpoint(data.cloudModelEndpoint);
    const provSel = document.getElementById('settings-cloud-provider');
    if (provSel && provSel.options.length > 0) provSel.value = providerKey;

    // Populate model dropdowns
    populateModelSelects(providerKey);

    // Set current model values
    setSelectVal('settings-planner-model', data.plannerModel || '');
    setSelectVal('settings-executor-model', data.executorModel || '');
    setSelectVal('settings-critic-model', data.criticModel || '');
    if (data.plannerModel) setSelectVal('model-select', data.plannerModel);

    // API endpoints
    setInputVal('settings-cloud-endpoint', data.cloudModelEndpoint);
    setInputVal('settings-cloud-api-key', data.cloudApiKey || '');
    setInputVal('settings-ollama-endpoint', data.localModelEndpoint);
    setInputVal('settings-lmstudio-endpoint', data.lmstudioEndpoint);
    setInputVal('settings-vllm-endpoint', data.vllmEndpoint);
    setInputVal('settings-llamacpp-endpoint', data.llamaCppEndpoint);

    // Permissions
    setCheckbox('settings-allow-high-risk', data.allowHighRiskTools);
    setCheckbox('settings-require-approval', data.requireApprovalForHighRisk);
    setSelectVal('settings-approval-policy', data.approvalPolicyPreset);

    // Locale
    const savedLocale = (() => { try { return localStorage.getItem('dada-locale'); } catch { return null; } })();
    setSelectVal('settings-locale', savedLocale || data.locale || 'en');

    // Env list
    renderEnvList(data);
  } catch (err) {
    console.error('loadConfig failed:', err);
    showToast('Config load failed', 'error', err.message);
  }
}

function setInputVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || '';
}

function setCheckbox(id, val) {
  const el = document.getElementById(id);
  if (el) el.checked = !!val;
}

function setSelectVal(id, val) {
  const el = document.getElementById(id);
  if (el && val) el.value = val;
}

async function loadModelOptions() {
  try {
    const data = await api('/api/model-options');
    S.modelOptions = Array.isArray(data) ? data : (data.options || data.models || []);
    // Repopulate with local models
    const providerKey = document.getElementById('settings-cloud-provider')?.value || 'custom';
    populateModelSelects(providerKey);
    if (S.config?.plannerModel) {
      setSelectVal('settings-planner-model', S.config.plannerModel);
    }
  } catch (err) {
    console.error('loadModelOptions failed:', err);
    showToast('Model options load failed', 'error', err.message);
  }
}

async function loadSystemStatus() {
  try {
    const health = await api('/api/health');
    const titleDot = document.getElementById('topbar-status-dot');
    const titleText = document.getElementById('topbar-status-text');
    if (health?.health?.ok) {
      if (titleDot) titleDot.className = 'topbar-status-dot';
      if (titleText) titleText.textContent = 'ONLINE';
    } else {
      if (titleDot) titleDot.className = 'topbar-status-dot offline';
      if (titleText) titleText.textContent = 'OFFLINE';
    }

    // Model dot
    const modelDot = document.getElementById('topbar-model-dot');
    if (health?.health && modelDot) {
      const h = health.health;
      if (h.mode === 'cloud-api' && h.apiKeyConfigured) {
        modelDot.className = 'topbar-model-dot';
      } else if (h.modelRuntime?.builtinReady) {
        modelDot.className = 'topbar-model-dot';
      } else {
        modelDot.className = 'topbar-model-dot offline';
      }
    }
  } catch (err) { console.warn('loadSystemStatus failed:', err.message); }
}

// ── Settings ───────────────────────────────────────────────────────────────────
async function loadSettings() {
  await loadConfig();
  await loadModelOptions();
  await Promise.allSettled([loadTools(), loadLocalModels(), loadPlugins(), loadKbStats()]);
}

async function saveModelSettings() {
  const body = {
    plannerModel: document.getElementById('settings-planner-model')?.value || '',
    executorModel: document.getElementById('settings-executor-model')?.value || '',
    criticModel: document.getElementById('settings-critic-model')?.value || '',
    cloudModelEndpoint: getInputVal('settings-cloud-endpoint'),
    cloudApiKey: getInputVal('settings-cloud-api-key')
  };
  if (!body.plannerModel || !body.executorModel || !body.criticModel) {
    showFeedback('model-save-feedback', false, 'All three models are required');
    return;
  }
  try {
    await api('/api/config/model-settings', { method: 'POST', body });
    showFeedback('model-save-feedback', true, 'Saved — restart required for model changes');
    await loadConfig();
  } catch (err) {
    showFeedback('model-save-feedback', false, err.message);
  }
}

async function saveApiSettings() {
  const body = {
    plannerModel: S.config?.plannerModel || '',
    executorModel: S.config?.executorModel || '',
    criticModel: S.config?.criticModel || '',
    cloudModelEndpoint: getInputVal('settings-cloud-endpoint'),
    cloudApiKey: getInputVal('settings-cloud-api-key'),
    localModelEndpoint: getInputVal('settings-ollama-endpoint'),
    lmstudioEndpoint: getInputVal('settings-lmstudio-endpoint'),
    vllmEndpoint: getInputVal('settings-vllm-endpoint'),
    llamaCppEndpoint: getInputVal('settings-llamacpp-endpoint'),
    comfyuiEndpoint: ''
  };
  try {
    await api('/api/config/model-settings', { method: 'POST', body });
    showFeedback('api-save-feedback', true, 'Saved');
    await loadConfig();
  } catch (err) {
    showFeedback('api-save-feedback', false, err.message);
  }
}

async function savePermissionSettings() {
  const body = {
    allowHighRiskTools: document.getElementById('settings-allow-high-risk')?.checked,
    requireApprovalForHighRisk: document.getElementById('settings-require-approval')?.checked,
    approvalPolicyPreset: document.getElementById('settings-approval-policy')?.value
  };
  try {
    await api('/api/config/settings', { method: 'POST', body });
    showFeedback('permission-save-feedback', true, 'Saved');
    await loadConfig();
  } catch (err) {
    showFeedback('permission-save-feedback', false, err.message);
  }
}

async function saveLocale() {
  const locale = document.getElementById('settings-locale')?.value || 'en';
  try {
    await api('/api/config/locale', { method: 'POST', body: { locale } });
    showFeedback('locale-save-feedback', true, t('savedRefresh'));
    // Persist to localStorage for immediate UI effect
    try { localStorage.setItem('dada-locale', locale); } catch {}
    // Apply translations immediately
    applyLocale(locale);
    // Refresh model display and tools with new locale
    await Promise.allSettled([loadLocalModels(), loadTools()]);
  } catch (err) {
    showFeedback('locale-save-feedback', false, err.message);
  }
}

function getInputVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function showFeedback(id, ok, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = ok ? '✓ ' + msg : '✗ ' + msg;
  el.style.color = ok ? 'var(--success)' : 'var(--error)';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

function renderEnvList(data) {
  const el = document.getElementById('env-list');
  if (!el) return;
  const keys = [
    'plannerModel', 'executorModel', 'criticModel',
    'cloudModelEndpoint', 'localModelEndpoint', 'lmstudioEndpoint', 'vllmEndpoint', 'llamaCppEndpoint',
    'comfyuiEndpoint', 'openaiImageModel', 'openaiTtsModel', 'openaiTtsVoice',
    'allowHighRiskTools', 'requireApprovalForHighRisk', 'approvalPolicyPreset',
    'maxPlanningCycles', 'maxSteps', 'maxConcurrentTasks', 'maxTaskRetries',
    'readRoots', 'writeRoots', 'shellAllowlist', 'webAllowlist',
    'envFiles'
  ];
  el.innerHTML = keys.map(k => {
    const val = data[k];
    const display = Array.isArray(val) ? val.join(', ') : (val != null ? String(val) : '—');
    return `<div class="env-row"><span class="env-key">${esc(k)}</span><span class="env-value">${esc(display)}</span></div>`;
  }).join('');
}

// ── Projects ───────────────────────────────────────────────────────────────────
async function loadProjects() {
  try {
    const data = await api('/api/projects');
    S.projects = data.projects || data || [];
    renderProjectList();
    renderHomeView();
  } catch (err) {
    console.error('loadProjects failed:', err);
    showToast('Projects load failed', 'error', err.message);
  }
}

function renderProjectList() {
  const el = document.getElementById('project-list');
  if (!el) return;
  if (!S.projects.length) {
    el.innerHTML = '<div class="empty-state">No projects yet. Create your first project above.</div>';
    return;
  }
  el.innerHTML = S.projects.map(p => {
    const isActive = S.activeProject?.id === p.id;
    return `<div class="project-card${isActive ? ' active' : ''}" data-project-id="${esc(p.id)}">
      <div class="project-card-name">${esc(p.name)}</div>
      <div class="project-card-desc">${esc(p.description || 'No description')}</div>
      <div class="project-card-meta">${esc(p.directoryPath || '')} &middot; ${timeFmt(p.createdAt)}</div>
    </div>`;
  }).join('');

  el.querySelectorAll('.project-card').forEach(card => {
    card.addEventListener('click', () => {
      const pid = card.dataset.projectId;
      if (pid) showProjectDetail(pid);
    });
  });
}

async function createProject() {
  const name = getInputVal('project-name-input').trim();
  if (!name) return;
  try {
    await api('/api/projects', {
      method: 'POST',
      body: {
        name,
        description: getInputVal('project-desc-input').trim(),
        directoryPath: getInputVal('project-dir-input').trim()
      }
    });
    document.getElementById('project-create-form').style.display = 'none';
    document.getElementById('project-name-input').value = '';
    document.getElementById('project-desc-input').value = '';
    document.getElementById('project-dir-input').value = '';
    await loadProjects();
  } catch (err) {
    showToast('Failed to create project: ' + err.message, 'error');
  }
}

async function showProjectDetail(projectId) {
  try {
    const data = await api('/api/projects/' + encodeURIComponent(projectId));
    const project = data.project || data;
    if (!project) return;

    document.getElementById('project-list').style.display = 'none';
    const detail = document.getElementById('project-detail');
    detail.style.display = 'block';
    detail.dataset.projectId = project.id;
    document.getElementById('project-detail-name').textContent = project.name;
    document.getElementById('project-detail-desc').textContent = project.description || '';

    // Load tasks for this project
    const tasksData = await api('/api/projects/' + encodeURIComponent(projectId) + '/tasks');
    const tasks = tasksData.tasks || [];
    const tasksEl = document.getElementById('project-detail-tasks');
    if (!tasks.length) {
      tasksEl.innerHTML = '<div class="empty-state">No tasks in this project yet.</div>';
    } else {
      tasksEl.innerHTML = tasks.slice(0, 50).map(t =>
        `<div class="history-item" data-task-id="${esc(t.taskId)}">
          <span class="history-time">${timeFmt(t.createdAt)}</span>
          <span class="history-goal">${esc(t.goal || '')}</span>
          <span class="history-badge ${t.status}">${esc(t.status)}</span>
        </div>`
      ).join('');
    }
  } catch (err) {
    showToast('Failed to load project: ' + err.message, 'error');
  }
}

function setActiveProject(project) {
  enterProjectWorkspace(project);
}

function clearActiveProject() {
  leaveProjectWorkspace();
}

function updateActiveProjectBar() {
  const bar = document.getElementById('active-project-bar');
  const nameEl = document.getElementById('active-project-name');
  if (!bar || !nameEl) return;
  if (S.activeProject) {
    bar.style.display = 'flex';
    nameEl.textContent = S.activeProject.name;
  } else {
    bar.style.display = 'none';
    nameEl.textContent = '';
  }
}

// ── Plugins ────────────────────────────────────────────────────────────────────
async function loadPlugins() {
  try {
    // Load MCP tools
    const toolsData = await api('/api/tools');
    const tools = Array.isArray(toolsData) ? toolsData : (toolsData.tools || []);
    const mcpTools = tools.filter(t => (t.id || t.name || '').startsWith('mcp:'));

    const el = document.getElementById('plugins-list');
    document.getElementById('plugins-count').textContent = mcpTools.length;

    const items = mcpTools.map(t => ({ kind: 'mcp', name: t.id || t.name, desc: t.description || 'MCP tool' }));

    if (!items.length) {
      el.innerHTML = '<div class="empty-state">No plugins loaded. Use <code>mcp.search</code> and <code>mcp.install</code> to add capabilities.</div>';
      return;
    }

    el.innerHTML = items.map(item =>
      `<div class="history-item">
        <span style="font-size:11px;color:var(--text-muted);width:40px;flex-shrink:0">[${item.kind}]</span>
        <span style="flex:1;font-size:13px;font-weight:500">${esc(item.name)}</span>
        <span style="font-size:11px;color:var(--text-secondary);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(item.desc)}</span>
      </div>`
    ).join('');
  } catch (err) {
    console.error('loadPlugins failed:', err);
    showToast('Plugins load failed', 'error', err.message);
  }
}

async function deleteProject(projectId, e) {
  if (e) { e.preventDefault(); e.stopPropagation(); }
  if (!confirm('Delete this project? Tasks will not be deleted.')) return;
  try {
    await api('/api/projects/' + encodeURIComponent(projectId), { method: 'DELETE' });
    if (S.activeProject?.id === projectId) {
      leaveProjectWorkspace();
    }
    // Hide drawer detail if visible
    const detail = document.getElementById('project-detail');
    if (detail) detail.style.display = 'none';
    const list = document.getElementById('project-list');
    if (list) list.style.display = '';
    await loadProjects();
  } catch (err) {
    showToast('Failed to delete project: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════════════
// WORKSPACE NAVIGATION (project-driven AI workspace)
// ══════════════════════════════════════════════════════════════════════
function enterProjectWorkspace(project) {
  stopWatch();
  S.activeProject = project;
  S.view = 'workspace';
  S.activeTaskId = null;
  S.activeProjectTasks = [];
  try { localStorage.setItem('dada-active-project', JSON.stringify(project)); } catch {}

  // Toggle visibility
  document.getElementById('home-view').style.display = 'none';
  document.getElementById('project-panel').style.display = 'flex';
  document.getElementById('chat-workspace').style.display = 'flex';
  document.getElementById('context-bar').style.display = 'none';
  document.getElementById('message-list').style.display = 'none';
  document.getElementById('message-list').innerHTML = '';
  showWelcome();

  // Clear standalone UI
  showChatProgressBar(false);
  document.getElementById('result-section').style.display = 'none';
  document.getElementById('streaming-output').style.display = 'none';
  document.getElementById('cancel-bar').style.display = 'none';
  document.getElementById('goal').value = '';

  // Update panel header
  document.getElementById('panel-project-name').textContent = project.name;

  // Remove standalone class from main
  document.querySelector('.main').classList.remove('standalone');

  // Load tasks and render home/project list
  loadProjectTasks(project.id);
  updateActiveProjectBar();
  renderProjectList();
  closeAllDrawers();
}

function leaveProjectWorkspace() {
  stopWatch();
  S.activeProject = null;
  S.activeTaskId = null;
  S.view = 'home';
  S.activeProjectTasks = [];
  try { localStorage.removeItem('dada-active-project'); } catch {}

  document.getElementById('project-panel').style.display = 'none';
  document.getElementById('chat-workspace').style.display = '';
  document.getElementById('context-bar').style.display = 'none';
  document.getElementById('message-list').style.display = 'none';
  document.getElementById('message-list').innerHTML = '';
  document.getElementById('home-view').style.display = '';

  showChatProgressBar(false);
  document.getElementById('result-section').style.display = 'none';
  document.getElementById('cancel-bar').style.display = 'none';
  document.getElementById('goal').value = '';

  // Add standalone class back to main for centered layout
  document.querySelector('.main').classList.add('standalone');

  updateActiveProjectBar();
  renderProjectList();
  renderHomeView();
}

function selectTask(taskId) {
  S.activeTaskId = taskId;
  S.currentTask = { ...S.currentTask, taskId };
  stopWatch();

  // Update sidebar highlighting
  document.querySelectorAll('.panel-task-item').forEach(el => {
    el.classList.toggle('active', el.dataset.taskId === taskId);
  });

  // Show context bar
  const task = S.activeProjectTasks.find(t => t.taskId === taskId);
  if (task) {
    showContextBar(task);
  }

  // Render conversation for this task
  renderTaskConversation(taskId);

  // Show message list, hide home view
  document.getElementById('home-view').style.display = 'none';
  document.getElementById('message-list').style.display = 'flex';

  // Clear other UI
  showChatProgressBar(false);
  document.getElementById('result-section').style.display = 'none';
  document.getElementById('cancel-bar').style.display = 'none';
}

function showContextBar(task) {
  const bar = document.getElementById('context-bar');
  bar.style.display = 'flex';
  document.getElementById('context-bar-task-name').textContent = task.goal || 'Task';
  const badge = document.getElementById('context-bar-status-badge');
  badge.textContent = task.status || 'pending';
  badge.className = 'context-bar-status-badge ' + (task.status || 'pending');
  // Update stats
  const cyclesEl = document.getElementById('context-bar-cycles');
  const stepsEl = document.getElementById('context-bar-steps');
  if (task.cycles != null) cyclesEl.textContent = '↻ ' + task.cycles;
  else cyclesEl.textContent = '';
  if (task.steps != null) stepsEl.textContent = '⇢ ' + task.steps;
  else stepsEl.textContent = '';
}

// ── Project Panel Rendering ─────────────────────────────────────────────
async function loadProjectTasks(projectId) {
  try {
    const data = await api('/api/projects/' + encodeURIComponent(projectId) + '/tasks');
    const tasks = (data.tasks || []).sort((a, b) =>
      (b.createdAt || '').localeCompare(a.createdAt || '')
    );
    S.activeProjectTasks = tasks;
    document.getElementById('panel-task-count').textContent = tasks.length + ' tasks';
    renderProjectTaskList(tasks);
  } catch (err) {
    console.error('loadProjectTasks:', err);
  }
}

function renderProjectTaskList(tasks) {
  const el = document.getElementById('panel-task-list');
  if (!tasks.length) {
    el.innerHTML = '<div class="empty-state" style="padding:24px;text-align:center;color:var(--text-muted);font-size:13px">No tasks yet.<br>Click "+ New Task" to start.</div>';
    return;
  }

  el.innerHTML = tasks.slice(0, 100).map(t => {
    const status = t.status || 'pending';
    return `<div class="panel-task-item${t.taskId === S.activeTaskId ? ' active' : ''}" data-task-id="${esc(t.taskId)}">
      <span class="panel-task-goal">${esc(t.goal || '(untitled)')}</span>
      <span class="panel-task-status ${esc(status)}">${esc(status)}</span>
    </div>`;
  }).join('');

  el.querySelectorAll('.panel-task-item').forEach(item => {
    item.addEventListener('click', () => {
      const tid = item.dataset.taskId;
      if (tid) selectTask(tid);
    });
  });
}

function refreshTaskInPanel(taskId, status, summary) {
  const task = S.activeProjectTasks.find(t => t.taskId === taskId);
  if (task) {
    task.status = status || task.status;
    if (summary) task.summary = summary;
  }
  renderProjectTaskList(S.activeProjectTasks);
  if (taskId === S.activeTaskId) {
    showContextBar(task || { goal: '', status: status || 'completed' });
    // Refresh conversation with new data
    renderTaskConversation(taskId);
  }
}

// ── Home View Rendering ────────────────────────────────────────────────
function renderHomeView() {
  const grid = document.getElementById('home-project-grid');
  if (!grid) return;
  if (!S.projects || !S.projects.length) {
    grid.innerHTML = '<div class="home-empty-state"><p>No projects yet. Create one to start.</p></div>';
    return;
  }
  grid.innerHTML = S.projects.map(p =>
    `<div class="home-project-card" data-project-id="${esc(p.id)}">
      <div class="home-project-card-name">${esc(p.name)}</div>
      <div class="home-project-card-desc">${esc(p.description || 'No description')}</div>
      <div class="home-project-card-meta">${esc(p.directoryPath || '')} · ${timeFmt(p.createdAt)}</div>
      <button class="home-project-card-del" data-delete-id="${esc(p.id)}" title="Delete project">✕</button>
    </div>`
  ).join('');

  grid.querySelectorAll('.home-project-card').forEach(card => {
    card.addEventListener('click', () => {
      const pid = card.dataset.projectId;
      const project = S.projects.find(p => p.id === pid);
      if (project) enterProjectWorkspace(project);
    });
  });

  // Delete button handlers
  grid.querySelectorAll('.home-project-card-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      deleteProject(btn.dataset.deleteId, e);
    });
  });

  // Card tilt effect
  grid.querySelectorAll('.home-project-card').forEach(card => {
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `translateY(-3px) scale(1.006) rotateX(${-y * 5}deg) rotateY(${x * 5}deg)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = '';
    });
  });
}

// ── Init ────────────────────────────────────────────────────────────────────────
async function init() {
  // Theme (must be first to avoid flash)
  initTheme();

  // Drawer buttons in topbar
  document.querySelectorAll('.topbar-drawer-btn').forEach(el => {
    el.addEventListener('click', () => {
      const name = el.dataset.drawer;
      const drawer = document.getElementById('drawer-' + name);
      if (drawer?.classList.contains('open')) {
        closeDrawer(name);
      } else {
        openDrawer(name);
      }
    });
  });

  // Drawer backdrop click to close
  document.getElementById('drawer-backdrop').addEventListener('click', () => closeAllDrawers());

  // Drawer close buttons
  document.querySelectorAll('.drawer-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.dataset.drawer;
      if (name) closeDrawer(name);
    });
  });

  // Escape key closes drawers
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAllDrawers();
  });

  // Workspace panel buttons
  const panelBackBtn = document.getElementById('panel-back-btn');
  if (panelBackBtn) panelBackBtn.addEventListener('click', leaveProjectWorkspace);
  const panelDelBtn = document.getElementById('panel-delete-btn');
  if (panelDelBtn) panelDelBtn.addEventListener('click', () => {
    if (S.activeProject?.id) deleteProject(S.activeProject.id);
  });
  const panelNewTaskBtn = document.getElementById('panel-new-task-btn');
  if (panelNewTaskBtn) panelNewTaskBtn.addEventListener('click', () => {
    if (!S.activeProject) return;
    S.activeTaskId = null;
    S.currentTask = {};
    document.querySelectorAll('.panel-task-item').forEach(el => el.classList.remove('active'));
    document.getElementById('context-bar').style.display = 'none';
    document.getElementById('home-view').style.display = 'none';
    document.getElementById('result-section').style.display = 'none';
    document.getElementById('cancel-bar').style.display = 'none';
    showChatProgressBar(false);
    document.getElementById('goal').value = '';
    document.getElementById('goal').focus();
  });
  const homeNewProjectBtn = document.getElementById('home-new-project-btn');
  if (homeNewProjectBtn) homeNewProjectBtn.addEventListener('click', () => {
    openDrawer('projects');
    document.getElementById('project-create-form').style.display = 'block';
  });

  // Goal input
  const goalEl = document.getElementById('goal');

  goalEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      startTask();
    }
  });

  // Toggle advanced options
  document.getElementById('toggle-advanced').addEventListener('click', () => {
    const el = document.getElementById('advanced-options');
    const btn = document.getElementById('toggle-advanced');
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? 'block' : 'none';
    btn.querySelector('span').textContent = isHidden ? '−' : '+';
    btn.setAttribute('aria-expanded', String(isHidden));
  });

  // Mode selector: show collaboration options when Project is selected
  const modeSelect = document.getElementById('execution-mode');
  const collabSelect = document.getElementById('collaboration-mode');
  if (modeSelect && collabSelect) {
    modeSelect.addEventListener('change', () => {
      collabSelect.style.display = modeSelect.value === 'project' ? '' : 'none';
    });
  }

  // Attachments
  document.getElementById('attachments-input').addEventListener('change', e => {
    handleAttach(Array.from(e.target.files || []));
    e.target.value = '';
  });

  // Drag-and-drop file attachment
  initDragDrop();

  // Microphone
  document.getElementById('mic-btn').addEventListener('click', toggleRecording);

  // Run button
  document.getElementById('run-btn').addEventListener('click', startTask);

  // Cancel button
  document.getElementById('cancel-btn').addEventListener('click', cancelTask);

  // Retry / Replay
  document.getElementById('retry-btn').addEventListener('click', retryTask);
  document.getElementById('replay-btn').addEventListener('click', replayTask);

  // Toggle steps
  document.getElementById('toggle-steps-btn').addEventListener('click', () => {
    const el = document.getElementById('result-steps');
    const btn = document.getElementById('toggle-steps-btn');
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? 'flex' : 'none';
    btn.textContent = isHidden ? 'Steps ▴' : 'Steps ▾';
  });

  // Toggle raw
  document.getElementById('toggle-raw-btn').addEventListener('click', () => {
    const el = document.getElementById('result-raw');
    const btn = document.getElementById('toggle-raw-btn');
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? 'block' : 'none';
    btn.textContent = isHidden ? 'Raw ▴' : 'Raw ▸';
  });

  // DAG Diagram button — fetch Mermaid from API and render as image
  document.getElementById('context-dag-diagram-btn').addEventListener('click', async () => {
    const diagramDiv = document.getElementById('context-dag-diagram');
    if (!diagramDiv) return;
    // Toggle off
    if (diagramDiv.style.display === 'block') {
      diagramDiv.style.display = 'none';
      return;
    }
    // Fetch Mermaid from backend
    try {
      const goal = S.currentTask?.goal || document.getElementById('goal')?.value || '';
      const taskType = document.getElementById('task-type')?.value || 'auto';
      const resp = await fetch('/api/strategy/dag?goal=' + encodeURIComponent(goal) +
        '&type=' + encodeURIComponent(taskType) + '&viz=mermaid');
      const json = await resp.json();
      if (json.mermaid) {
        // Use explicit dimensions for mermaid.ink to avoid truncation
        const encoded = await encodeMermaidForInk(json.mermaid);
        diagramDiv.innerHTML = `<div style="text-align:center">
          <img src="https://mermaid.ink/img/${encoded}?type=png" alt="DAG Diagram"
               style="max-width:100%;border-radius:8px;background:#1e293b;padding:8px"
               onerror="this.parentElement.innerHTML='<p style=color:var(--err)>Diagram render failed</p>'" />
          <div style="font-size:9px;color:var(--text-muted);margin-top:4px">DAG: ${escHtml(json.mermaid).split('\n')[0]?.replace(/^graph TD/, '') || ''}</div>
        </div>`;
        diagramDiv.style.display = 'block';
      }
    } catch {
      diagramDiv.innerHTML = '<p style="color:var(--err)">Failed to load DAG diagram</p>';
      diagramDiv.style.display = 'block';
    }
  });

  // Context panel toggle
  document.getElementById('context-bar-toggle').addEventListener('click', () => {
    const panel = document.getElementById('context-panel');
    const btn = document.getElementById('context-bar-toggle');
    const visible = panel.classList.toggle('visible');
    btn.classList.toggle('active', visible);
  });

  // Context panel close button
  document.getElementById('context-panel-close').addEventListener('click', () => {
    const panel = document.getElementById('context-panel');
    const btn = document.getElementById('context-bar-toggle');
    panel.classList.remove('visible');
    btn.classList.remove('active');
  });

  // ── Settings accordion ────────────────────────────────────────────────────
  document.querySelectorAll('.settings-section h3').forEach(h3 => {
    h3.addEventListener('click', () => {
      h3.parentElement.classList.toggle('collapsed');
    });
  });

  // ── Settings events ────────────────────────────────────────────────────────
  // Provider preset change → update endpoint + model dropdowns
  document.getElementById('settings-cloud-provider').addEventListener('change', function () {
    const provider = CLOUD_PROVIDERS[this.value];
    if (!provider || this.value === 'custom') return;
    setInputVal('settings-cloud-endpoint', provider.endpoint);
    populateModelSelects(this.value);
    if (provider.models.length >= 2) {
      setSelectVal('settings-planner-model', 'cloud:' + provider.models[0]);
      setSelectVal('settings-executor-model', 'cloud:' + provider.models[1]);
      setSelectVal('settings-critic-model', 'cloud:' + (provider.models[1] || provider.models[0]));
    } else if (provider.models.length === 1) {
      ['settings-planner-model', 'settings-executor-model', 'settings-critic-model'].forEach(id => {
        setSelectVal(id, 'cloud:' + provider.models[0]);
      });
    }
  });

  document.getElementById('save-model-settings').addEventListener('click', saveModelSettings);
  document.getElementById('save-api-settings').addEventListener('click', saveApiSettings);
  document.getElementById('save-permission-settings').addEventListener('click', savePermissionSettings);
  document.getElementById('save-locale-settings').addEventListener('click', saveLocale);

  // ── Knowledge Base events ──────────────────────────────────────────────────
  document.getElementById('kb-index-btn')?.addEventListener('click', triggerKbIndex);
  document.getElementById('kb-reindex-btn')?.addEventListener('click', triggerKbReindex);
  document.getElementById('kb-clear-btn')?.addEventListener('click', triggerKbClear);
  document.getElementById('kb-search-btn')?.addEventListener('click', searchKb);
  document.getElementById('kb-search-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') searchKb();
  });

  // ── Marketplace events ────────────────────────────────────────────────────
  initMarketplaceTabs();
  initTaskDetailTabs();
  // Load installed skills when marketplace drawer opens
  const marketplaceOpen = document.querySelector('[data-drawer="marketplace"]');
  if (marketplaceOpen) {
    marketplaceOpen.addEventListener('click', () => loadMarketplaceInstalled());
  }

  // ── Projects events ────────────────────────────────────────────────────────
  document.getElementById('project-new-btn').addEventListener('click', () => {
    document.getElementById('project-create-form').style.display = 'block';
  });
  document.getElementById('project-create-submit').addEventListener('click', createProject);
  document.getElementById('project-create-cancel').addEventListener('click', () => {
    document.getElementById('project-create-form').style.display = 'none';
  });
  document.getElementById('project-detail-back').addEventListener('click', () => {
    document.getElementById('project-detail').style.display = 'none';
    document.getElementById('project-list').style.display = '';
  });
  document.getElementById('project-detail-set-active').addEventListener('click', () => {
    const detail = document.getElementById('project-detail');
    const pid = detail.dataset.projectId;
    const project = S.projects.find(p => p.id === pid);
    if (project) setActiveProject(project);
  });
  document.getElementById('project-detail-delete').addEventListener('click', () => {
    const detail = document.getElementById('project-detail');
    const pid = detail.dataset.projectId;
    if (pid) deleteProject(pid);
  });
  document.getElementById('active-project-clear')?.addEventListener('click', clearActiveProject);

  // ── Title bar window controls ────────────────────────────────────────────────
  // Hide custom buttons inside Electron — native title bar provides them
  if (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent)) {
    document.getElementById('title-minimize')?.remove();
    document.getElementById('title-maximize')?.remove();
    document.getElementById('title-close')?.remove();
  } else {
    document.getElementById('title-minimize')?.addEventListener('click', () => {
      document.body.classList.toggle('minimized');
    });

    document.getElementById('title-maximize')?.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      } else {
        document.exitFullscreen?.().catch(() => {});
      }
    });

    document.getElementById('title-close')?.addEventListener('click', () => {
      window.close();
      setTimeout(() => {
        if (!document.hidden && document.body.classList.contains('minimized') === false) {
          document.body.classList.add('minimized');
        }
      }, 300);
    });
  }

  await loadConfig();
  await loadModelOptions();
  await Promise.allSettled([
    loadSystemStatus(),
    loadHistory(),
    loadTools(),
    loadProjects(),
  ]);

  // Apply locale from saved preference
  try {
    const savedLocale = localStorage.getItem('dada-locale') || (S.config?.locale) || 'en';
    document.getElementById('settings-locale').value = savedLocale;
    applyLocale(savedLocale);
  } catch (err) { console.warn('applyLocale failed:', err.message); }

  // Restore workspace state from localStorage
  try {
    const saved = localStorage.getItem('dada-active-project');
    if (saved) {
      const project = JSON.parse(saved);
      const found = S.projects.find(p => p.id === project.id);
      if (found) {
        enterProjectWorkspace(found);
      } else {
        S.activeProject = null;
        localStorage.removeItem('dada-active-project');
        document.querySelector('.main').classList.add('standalone');
        renderHomeView();
      }
    } else {
      document.querySelector('.main').classList.add('standalone');
      renderHomeView();
    }
  } catch (err) {
    console.warn('Restore workspace failed:', err.message);
    document.querySelector('.main').classList.add('standalone');
    renderHomeView();
  }

  // Periodic status check
  setInterval(loadSystemStatus, 30000);
}

// ── PWA: Install Prompt ──────────────────────────────────────────────────────────
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Show install button in title bar
  const installBtn = document.getElementById('pwa-install-btn');
  if (installBtn) installBtn.style.display = 'inline-block';
});

async function pwaInstall() {
  if (!deferredInstallPrompt) {
    showToast('Install not available. You can install manually via browser menu.', 'info');
    return;
  }
  deferredInstallPrompt.prompt();
  const result = await deferredInstallPrompt.userChoice;
  console.log('[PWA] Install choice:', result.outcome);
  deferredInstallPrompt = null;
  const installBtn = document.getElementById('pwa-install-btn');
  if (installBtn) installBtn.style.display = 'none';
}

// ── PWA: Push Notifications ──────────────────────────────────────────────────────
async function pwaSubscribePush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.log('[PWA] Push notifications not supported');
    return;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        // VAPID public key — replace with your own in production
        'BEl62iGHYtTpLGQVWqCmFdJmfBG-7y0nYhRXHWDnkUuDYhoc1K3qJqLpXZqOq0wLZqK0oXqJqLpXZqOq0wLZqK'
      )
    });
    console.log('[PWA] Push subscribed:', sub);
  } catch (err) {
    console.warn('[PWA] Push subscription failed:', err.message);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return new Uint8Array([...rawData].map(c => c.charCodeAt(0)));
}

// ── Task Detail ─────────────────────────────────────────────────────────────────
async function openTaskDetail(taskId) {
  const drawer = document.getElementById('drawer-task-detail');
  const loading = document.getElementById('task-detail-loading');
  const content = document.getElementById('task-detail-content');
  loading.style.display = '';
  content.style.display = 'none';
  openDrawer('task-detail');

  try {
    // Fetch task status, audit, approvals, and artifacts in parallel
    const [taskRes, auditRes, approvalsRes, artifactsRes] = await Promise.all([
      api('/api/tasks/status?taskId=' + encodeURIComponent(taskId)),
      api('/api/audit?taskId=' + encodeURIComponent(taskId)).catch(() => []),
      api('/api/approvals').catch(() => []),
      api('/api/artifacts/file?taskId=' + encodeURIComponent(taskId)).catch(() => []),
    ]);

    const task = taskRes.task || taskRes;
    const audits = Array.isArray(auditRes) ? auditRes : (auditRes.records || []);
    const approvals = Array.isArray(approvalsRes) ? approvalsRes : (approvalsRes.approvals || []);
    const taskApprovals = approvals.filter(a => a.taskId === taskId);

    // Meta
    document.getElementById('task-detail-meta').innerHTML =
      `<div class="task-detail-header-row">
        <span class="task-detail-goal">${esc(task.goal || 'Unknown')}</span>
        <span class="history-badge ${task.status || task.state}">${esc(task.status || task.state)}</span>
      </div>
      <div class="task-detail-meta-row">
        <span>Type: ${esc(task.taskType || 'auto')}</span>
        ${getPersonaBadge(task.taskType)}
        ${task.complexity ? `<span class="complexity-badge ${task.complexity}">${task.complexity}</span>` : ''}
        <span>ID: ${taskId.slice(0, 8)}</span>
        <span>${timeFmt(task.createdAt || task.startedAt)}</span>
      </div>
      ${task.error ? `<div class="task-detail-error">Error: ${esc(task.error)}</div>` : ''}`;

    // Steps
    const steps = task.steps || [];
    const stepEl = document.getElementById('task-detail-steps');
    if (steps.length > 0) {
      stepEl.innerHTML = steps.map(s =>
        `<div class="detail-step ${s.action || ''}">
          <span class="detail-step-num">#${s.step}</span>
          <span class="detail-step-action">${esc(s.action || '')}</span>
          ${s.tool ? `<span class="detail-step-tool">${esc(s.tool)}</span>` : ''}
          ${s.reasoning ? `<span class="detail-step-reason">${esc(s.reasoning.substring(0, 200))}</span>` : ''}
        </div>`
      ).join('');
    } else {
      stepEl.innerHTML = '<div class="marketplace-empty">No execution steps recorded.</div>';
    }

    // Audit
    const auditEl = document.getElementById('task-detail-audit');
    if (audits.length > 0) {
      auditEl.innerHTML = audits.map(a =>
        `<div class="detail-step ${a.step?.action || ''}">
          <span class="detail-step-num">#${a.step?.step || '-'}</span>
          <span class="detail-step-action">${esc(a.step?.action || '')}</span>
          ${a.step?.tool ? `<span class="detail-step-tool">${esc(a.step.tool)}</span>` : ''}
          <span class="detail-step-time">${timeFmt(a.at)}</span>
        </div>`
      ).join('');
    } else {
      auditEl.innerHTML = '<div class="marketplace-empty">No audit records.</div>';
    }

    // Approvals
    const apprEl = document.getElementById('task-detail-approvals');
    if (taskApprovals.length > 0) {
      apprEl.innerHTML = taskApprovals.map(a =>
        `<div class="detail-step approval">
          <span class="detail-step-num">${esc(a.status || 'pending')}</span>
          <span class="detail-step-action">${esc(a.tool || a.scope || '')}</span>
          ${a.reason ? `<span class="detail-step-reason">${esc(a.reason)}</span>` : ''}
        </div>`
      ).join('');
    } else {
      apprEl.innerHTML = '<div class="marketplace-empty">No approvals required.</div>';
    }

    // Artifacts (from task result)
    const artEl = document.getElementById('task-detail-artifacts');
    const artifacts = task.artifacts || [];
    if (artifacts.length > 0) {
      artEl.innerHTML = artifacts.map(a =>
        `<div class="detail-step">
          <span class="detail-step-num">${esc(a.kind || 'file')}</span>
          <a class="detail-step-action" href="${esc(a.url || '#')}" target="_blank">${esc(a.name)}</a>
          ${a.size ? `<span class="detail-step-time">${(a.size / 1024).toFixed(1)} KB</span>` : ''}
        </div>`
      ).join('');
    } else {
      artEl.innerHTML = '<div class="marketplace-empty">No artifacts generated.</div>';
    }

    // Retry / Replay buttons
    const canRetry = (task.status === 'failed' || task.state === 'failed');
    document.getElementById('task-detail-retry').style.display = canRetry ? '' : 'none';
    document.getElementById('task-detail-replay').style.display = canRetry ? '' : 'none';
    document.getElementById('task-detail-retry').onclick = () => {
      closeAllDrawers();
      retryTask(taskId);
    };
    document.getElementById('task-detail-replay').onclick = () => {
      closeAllDrawers();
      retryTask(taskId);
    };

    loading.style.display = 'none';
    content.style.display = '';
    document.getElementById('task-detail-title').textContent = 'Task ' + taskId.slice(0, 8);
  } catch (err) {
    loading.innerHTML = '<div class="marketplace-empty">Failed to load: ' + esc(err.message) + '</div>';
  }
}

function initTaskDetailTabs() {
  document.querySelectorAll('[data-dtab]').forEach(tab => {
    tab.addEventListener('click', () => {
      const parent = tab.parentElement;
      parent.querySelectorAll('.marketplace-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.dtab;
      document.querySelectorAll('.task-detail-panel').forEach(p => p.style.display = 'none');
      const panel = document.getElementById('task-detail-' + name);
      if (panel) panel.style.display = '';
    });
  });
}

// ── Knowledge Base ──────────────────────────────────────────────────────────────
async function loadKbStats() {
  try {
    const data = await api('/api/knowledge/stats');
    document.getElementById('kb-stat-files').textContent = data.files ?? data.fileCount ?? '-';
    document.getElementById('kb-stat-chunks').textContent = data.chunks ?? data.chunkCount ?? '-';
    document.getElementById('kb-stat-terms').textContent = data.terms ?? data.termCount ?? '-';
    const last = data.lastIndexed || data.lastIndexedAt;
    if (last) {
      const d = new Date(last);
      document.getElementById('kb-stat-last').textContent = d.toLocaleString();
    } else {
      document.getElementById('kb-stat-last').textContent = t('kbNever');
    }
  } catch (e) {
    console.warn('loadKbStats failed:', e.message);
  }
}

async function triggerKbIndex() {
  const btn = document.getElementById('kb-index-btn');
  btn.disabled = true;
  btn.textContent = t('kbIndexing');
  try {
    await api('/api/knowledge/index', { method: 'POST' });
    showToast(t('kbIndexed'), 'success');
    await loadKbStats();
  } catch (e) {
    showToast('Index failed: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.textContent = t('kbIndexNow');
}

async function triggerKbReindex() {
  const btn = document.getElementById('kb-reindex-btn');
  btn.disabled = true;
  btn.textContent = t('kbIndexing');
  try {
    await api('/api/knowledge/reindex', { method: 'POST' });
    showToast(t('kbIndexed'), 'success');
    await loadKbStats();
  } catch (e) {
    showToast('Reindex failed: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.textContent = t('kbReindex');
}

async function triggerKbClear() {
  if (!confirm(t('kbClear') + '?')) return;
  try {
    await api('/api/knowledge/clear', { method: 'POST' });
    showToast(t('kbCleared'), 'success');
    await loadKbStats();
    document.getElementById('kb-results').style.display = 'none';
  } catch (e) {
    showToast('Clear failed: ' + e.message, 'error');
  }
}

async function searchKb() {
  const q = document.getElementById('kb-search-input').value.trim();
  if (!q) return;
  try {
    const data = await api('/api/knowledge/search?q=' + encodeURIComponent(q) + '&topK=5');
    const resultsEl = document.getElementById('kb-results');
    const listEl = document.getElementById('kb-results-list');
    const countEl = document.getElementById('kb-results-count');

    resultsEl.style.display = 'block';
    countEl.textContent = data.resultCount ?? data.results?.length ?? 0;

    if (!data.results || data.results.length === 0) {
      listEl.innerHTML = '<div class="kb-result-empty">No results found</div>';
      return;
    }

    listEl.innerHTML = data.results.map((r, i) => {
      const content = r.content || r.text || r.snippet || '';
      const source = r.source || r.metadata?.source || r.file || '';
      const score = r.score != null ? (r.score * 100).toFixed(0) + '%' : '';
      return `<div class="kb-result-item">
        <div class="kb-result-header">
          <span class="kb-result-index">#${i + 1}</span>
          ${score ? `<span class="kb-result-score">${score}</span>` : ''}
          ${source ? `<span class="kb-result-source">${source}</span>` : ''}
        </div>
        <div class="kb-result-content">${escapeHtml(content.substring(0, 300))}</div>
      </div>`;
    }).join('');
  } catch (e) {
    showToast('Search failed: ' + e.message, 'error');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ── PWA: Online/Offline detection ────────────────────────────────────────────────
function updateOnlineStatus() {
  const dot = document.getElementById('topbar-status-dot');
  const text = document.getElementById('topbar-status-text');
  if (!navigator.onLine) {
    if (dot) dot.className = 'topbar-status-dot offline';
    if (text) text.textContent = 'OFFLINE';
  } else {
    if (dot) dot.className = 'topbar-status-dot';
    if (text) text.textContent = 'ONLINE';
  }
}
window.addEventListener('online', updateOnlineStatus);
window.addEventListener('offline', updateOnlineStatus);

document.addEventListener('DOMContentLoaded', init);

// ── Marketplace ──────────────────────────────────────────────────────────────────
async function marketplaceSearch() {
  const q = document.getElementById('marketplace-search-input').value.trim();
  if (!q) { showToast('Enter a search query', 'warning'); return; }
  showToast('Searching marketplace...', 'info');
  try {
    const res = await fetch('/api/clawhub/search', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q })
    });
    const data = await res.json();
    if (!data.results || data.results.length === 0) {
      document.getElementById('marketplace-results').innerHTML = '<div class="marketplace-empty">No results found. Try a different keyword like "PDF", "PPTX", "news", or "git".</div>';
    } else {
      document.getElementById('marketplace-results').innerHTML = data.results.map(r =>
        `<div class="marketplace-item">
          <div class="marketplace-item-header">
            <span class="marketplace-item-name">${esc(r.name)}</span>
          </div>
          <div class="marketplace-item-desc">${esc(r.description || 'No description')}</div>
          <div class="marketplace-item-actions">
            <button class="marketplace-btn" onclick="marketplaceInstall('${esc(r.name)}')">Install</button>
          </div>
        </div>`
      ).join('');
    }
    document.querySelectorAll('.marketplace-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('[data-tab="results"]').classList.add('active');
    document.getElementById('marketplace-installed').style.display = 'none';
    document.getElementById('marketplace-results').style.display = '';
  } catch (e) { showToast('Search failed: ' + e.message, 'error'); }
}

async function marketplaceInstall(name) {
  showToast('Installing ' + name + '...', 'info');
  try {
    const res = await fetch('/api/clawhub/install', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    const s = document.getElementById('marketplace-status');
    if (data.success) {
      s.className = 'marketplace-status success';
      s.textContent = 'Installed ' + name + ' successfully. Restart DaDa if needed.';
      setTimeout(() => { s.className = 'marketplace-status'; }, 5000);
      await loadMarketplaceInstalled();
    } else {
      s.className = 'marketplace-status error';
      s.textContent = 'Failed: ' + (data.error || 'unknown');
      setTimeout(() => { s.className = 'marketplace-status'; }, 5000);
    }
  } catch (e) { showToast('Install failed: ' + e.message, 'error'); }
}

async function marketplaceUninstall(name) {
  if (!confirm('Uninstall ' + name + '?')) return;
  showToast('Uninstalling ' + name + '...', 'info');
  try {
    const res = await fetch('/api/clawhub/uninstall', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    const s = document.getElementById('marketplace-status');
    if (data.success) {
      s.className = 'marketplace-status success';
      s.textContent = 'Uninstalled ' + name;
      setTimeout(() => { s.className = 'marketplace-status'; }, 3000);
      await loadMarketplaceInstalled();
    } else {
      s.className = 'marketplace-status error';
      s.textContent = 'Failed: ' + (data.error || 'unknown');
      setTimeout(() => { s.className = 'marketplace-status'; }, 5000);
    }
  } catch (e) { showToast('Uninstall failed: ' + e.message, 'error'); }
}

async function loadMarketplaceInstalled() {
  try {
    const res = await fetch('/api/clawhub/skills');
    const data = await res.json();
    const skills = data.skills || [];
    const el = document.getElementById('marketplace-installed');
    if (skills.length === 0) {
      el.innerHTML = '<div class="marketplace-empty">No skills installed. Search above to discover skills and MCP servers.</div>';
    } else {
      el.innerHTML = skills.map(s =>
        `<div class="marketplace-item">
          <div class="marketplace-item-header">
            <span class="marketplace-item-name">${esc(s.name)}</span>
            <span style="font-size:10px;color:var(--text-muted)">v${esc(s.version || '1.0.0')}</span>
          </div>
          <div class="marketplace-item-desc">${esc(s.description || 'No description')}</div>
          <div class="marketplace-item-actions">
            <button class="marketplace-btn danger" onclick="marketplaceUninstall('${esc(s.name)}')">Uninstall</button>
          </div>
        </div>`
      ).join('');
    }
  } catch (e) { /* ignore */ }
}

// Wire up marketplace tab switching
function initMarketplaceTabs() {
  document.querySelectorAll('.marketplace-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.marketplace-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById('marketplace-installed').style.display = target === 'installed' ? '' : 'none';
      document.getElementById('marketplace-results').style.display = target === 'results' ? '' : 'none';
    });
  });
  document.getElementById('marketplace-search-btn').addEventListener('click', marketplaceSearch);
  document.getElementById('marketplace-search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') marketplaceSearch();
  });
}

