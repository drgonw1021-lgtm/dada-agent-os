# DaDa — 本地优先自主 Agent / Local-First Autonomous Agent

[中文](#中文) | [English](#english)

DaDa is an autonomous AI agent with **built-in GGUF runtime**, multi-model orchestration, automation, and self-learning. No Ollama, no vLLM, no LM Studio required — load local GGUF models directly, or plug into any OpenAI-compatible cloud API.

DaDa 是一个 **本地大模型直载 + 外部大模型接入** 的自主 AI Agent。不依赖 Ollama/vLLM/LM Studio，可直接加载 GGUF 模型运行，也可接入 OpenAI-compatible 云端接口。原生中文支持，全栈覆盖从输入到执行到自进化的完整闭环。

---

## 为什么选择 DaDa / Why DaDa

DaDa 的独特定位：**全栈自主 + 本地优先 + 中文原生 + MCP 自配置**，填补了现有 agent 之间的空白。

### 竞品对比 / Competitor Comparison

| 维度 Dimension | DaDa | Claude Code | OpenClaw | Hermes Agent |
|:---|:---|:---|:---|:---|
| **定位 Positioning** | 本地优先自主Agent | 专业编码助手 | 数字员工平台 | 自进化智能体 |
| **GitHub Stars** | — (个人项目) | — (商业产品) | 280K+ | 90K+ |
| **模型 Models** | DeepSeek-V3 + 本地GGUF | Claude 4.7 | 多模型可插拔(30+) | 多模型可插拔 |
| **架构 Architecture** | 状态机+分层规划+ReAct | 对话驱动+工具 | Hub-spoke+Lane Queue | 学习循环+GEPA |
| **代码能力 Coding** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **搜索 Search** | ⭐⭐ (需 API key) | ⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **流式输出 Streaming** | ✅ SSE | ✅ 原生 | ✅ WebSocket | ✅ |
| **多模态输入 Multimodal** | ✅ 图片/OCR/语音 | ✅ 图片/PDF | ✅ | ✅ |
| **多媒体生成 Gen Media** | ⭐⭐⭐ (ComfyUI) | ❌ | ⭐⭐⭐⭐ (Seedance/视频) | ⭐⭐⭐ |
| **语音 TTS** | ⭐⭐ (系统TTS) | ❌ | ⭐⭐⭐⭐ (13提供商) | ⭐⭐ |
| **工具数量 Tools** | ⭐⭐⭐⭐ (42) | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ (40+) |
| **MCP 支持** | ✅ **自配置(独有)** | ✅ | ❌ 拒绝MCP | ❌ |
| **技能生态 Skill Market** | ⭐⭐ (ClawHub) | ❌ | ⭐⭐⭐⭐⭐ (13700+) | ⭐⭐⭐⭐ (自动生成) |
| **自进化 Self-Evolution** | ✅ (SKILL.md 自动生成) | ❌ | ❌ | ⭐⭐⭐⭐⭐ (GEPA) |
| **多Agent协作 Multi-Agent** | ✅ (Registry+Bus) | ❌ | ⭐⭐⭐⭐ | ❌ |
| **多频道Bot Bots** | ✅ (5平台) | ❌ | ⭐⭐⭐⭐ (8+平台) | ✅ (15+平台) |
| **任务持久化 Persistence** | ✅ (状态机暂停/恢复) | ❌ (单session) | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **分层记忆 Memory** | ⭐⭐⭐ (L2+L4+TF-IDF) | ❌ | ⭐⭐⭐⭐ (ContextEngine) | ⭐⭐⭐⭐ (3层记忆) |
| **可观测性 Observability** | ⭐ (基础日志) | ⭐⭐ | ⭐⭐⭐⭐⭐ (OTEL) | ⭐⭐ |
| **安全 Security** | ⭐⭐⭐ (沙箱+审批) | ⭐⭐⭐⭐ | ⭐⭐ (138漏洞) | ⭐⭐⭐ |
| **PWA/移动端** | ✅ PWA | ❌ | ⭐⭐ (iOS准备中) | ❌ |
| **中文支持 Chinese** | ⭐⭐⭐⭐⭐ (原生) | ⭐⭐⭐ | ⭐⭐ | ⭐⭐ |
| **本地推理 Local Inference** | ✅ (node-llama-cpp) | ❌ (纯云端) | ⭐⭐ | ⭐⭐ |

### DaDa 的护城河 / DaDa's Unique Advantages

1. **MCP 自配置** — 唯一能在运行时自发现缺口 → 搜 npm → 安装 → 注册的 agent
2. **中文原生 + 本地优先** — DeepSeek 中文思维 + node-llama-cpp 本地推理，可完全离线运行
3. **状态机持久化** — 任务可暂停/恢复，长期运行不丢状态（CC 和 Hermes 都不支持）
4. **全栈覆盖** — 多模态输入 → 分层规划 → 工具执行 → 自进化 → 多Agent → Bot → PWA，一条龙


---

## 快速开始 / Quick Start

### 最推荐：一键启动 (Windows)

1. 双击 `install-dada.bat` 安装依赖并构建
2. 双击 `daDa.bat` 启动 DaDa 控制台
3. 浏览器打开 [http://localhost:9877](http://localhost:9877)

### Recommended: One-Click Start (Windows)

1. Double-click `install-dada.bat` to install & build
2. Double-click `daDa.bat` to launch DaDa
3. Open [http://localhost:9877](http://localhost:9877)

---

### 方案 A：本地 GGUF 模型 / Option A: Local GGUF

```bash
# 1. 将 GGUF 模型文件放入 models/ 目录
#    Place GGUF model files in models/

# 2. 安装依赖 / Install
npm install

# 3. 启动 / Start
npm run dev:ui

# 4. 打开 / Open http://localhost:9877
```

```env
PLANNER_MODEL=builtin:default
MODELS_DIR=./models
```

### 方案 B：云端 API / Option B: Cloud API

```env
PLANNER_MODEL=cloud:gpt-4o-mini
CLOUD_MODEL_ENDPOINT=https://api.openai.com/v1
CLOUD_API_KEY=your-api-key
```

```bash
npm run dev:ui
```

### 模型前缀 / Model Prefixes

| 前缀 Prefix | 含义 Meaning | 示例 Example |
|:---|:---|:---|
| `builtin:` | 直接加载本地 GGUF | `builtin:default` |
| `cloud:` | OpenAI-compatible 接口 | `cloud:gpt-4o-mini` |
| `ollama:` | Ollama 兼容 | `ollama:qwen2.5:7b` |
| `lmstudio:` | LM Studio 兼容 | `lmstudio:qwen2.5` |
| `vllm:` | vLLM 兼容 | `vllm:qwen2.5` |
| `llama-cpp:` | llama.cpp server | `llama-cpp:qwen2.5` |

---

## 架构概览 / Architecture

```
用户请求 User Request
  → TaskIntent (意图识别 Intent)
  → CapabilityRouter (能力路由 Routing)
  → AgentRuntime (主循环 Main Loop: 分类→规划→执行→批评→验证→自进化)
      ├── 分层记忆注入 Layered Memory:
      │   L1: 即时上下文 (attachments, skills)
      │   L2: 任务记忆 (TaskMemoryStore)
      │   L3: 经验策略 (StrategyAdvisor + evolved skills)
      │   L4: 语义记忆 (SemanticMemory)
      │   L5: 工作区 RAG 知识库 (KnowledgeBase)
      ├── 工具执行 (ToolRegistry → execute/executeStream)
      └── 暂停检查点 (checkPause per cycle)
  → Verifier (验证 Verify)
  → SelfEvolver (自我进化 → SKILL.md)
```

---

## 核心功能 / Core Features

### 分层记忆 / Layered Memory

| 层级 | 名称 | 说明 |
|:---|:---|:---|
| L1 | 即时上下文 | 附件、技能指令、领域 workflow |
| L2 | 任务记忆 | TaskMemoryStore — 历史任务上下文检索 |
| L3 | 经验策略 | StrategyAdvisor + SelfEvolver 成熟技能 + 陷阱警告 |
| L4 | 语义记忆 | SemanticMemory — 跨任务语义关联 |
| L5 | RAG 知识库 | 工作区文件索引 (TF-IDF + 余弦相似度) |

### 任务暂停/恢复 / Task Pause & Resume

- 每个规划周期检查 checkPause 回调
- 状态机持久化到磁盘
- 恢复时从持久化状态继续，不丢失进度

### 自我进化 / Self-Evolution

- 从成功任务提炼可复用技能 → 生成 SKILL.md
- 成熟技能自动注入后续任务 prompt
- 陷阱警告 (pitfall_warning): 失败模式自动提醒

### 多 Agent 协作 / Multi-Agent Collaboration

- **AgentRegistry**: agent 注册、心跳、按能力/角色查找
- **DelegationManager**: 委托生命周期管理
- **ContextBus**: 消息发布/订阅、共享上下文

### 24 个领域 Agent / 24 Domain Agents

教育、医疗、房地产、视频剪辑、播客制作、软件开发、数据分析、客户支持、金融分析、HR 招聘、市场分析、产品设计、法律审查、工程设计、内容营销等。

Education, Healthcare, Real Estate, Video Editing, Podcast Production, Software Development, Data Analysis, Customer Support, Financial Analysis, HR Recruitment, Market Analysis, Product Design, Legal Review, Engineering Design, Content Marketing, and more.

### MCP 自配置 / MCP Auto-Configuration

- 运行时自发现缺口 → 搜索 npm registry → 安装 → 注册
- 14 类 30 个已知 MCP 服务器
- 5 分钟内存缓存 + 429 降级

### i18n

- 110+ 条目 zh/en，可通过 UI 或 API 动态切换

---

## API 端点 / API Endpoints

| 方法 | 路径 | 说明 |
|:---|:---|:---|
| GET | `/api/health` | 健康检查 Health check |
| GET | `/api/config` | 当前配置 Config |
| GET | `/api/system` | 系统信息 System info |
| GET | `/api/models` | 模型列表 Model list |
| GET | `/api/model-profiles` | 策略模板 Strategy profiles |
| GET | `/api/tools` | 工具列表 Tool list |
| GET | `/api/agents` | Agent 列表 Agent list |
| POST | `/api/run` | 执行任务 Run task |
| POST | `/api/run/stream` | 流式执行 Stream run |
| POST | `/api/run-async` | 异步执行 Async run |
| POST | `/api/tasks/pause` | 暂停 Pause |
| POST | `/api/tasks/resume` | 恢复 Resume |
| POST | `/api/tasks/cancel` | 取消 Cancel |
| POST | `/api/tasks/retry` | 重试 Retry |
| POST | `/api/tasks/replay-failed` | 回放失败 Replay failed |
| POST | `/api/approvals/approve` | 批准 Approve |
| POST | `/api/approvals/reject` | 拒绝 Reject |
| POST | `/api/knowledge/index` | KB 索引 Index KB |
| GET | `/api/knowledge/search?q=&topK=` | KB 搜索 Search KB |
| GET | `/api/knowledge/stats` | KB 统计 KB stats |
| POST | `/api/media/generate` | 生成媒体 Generate media |
| POST | `/api/models/download-stream` | SSE 下载模型 SSE download |
| POST | `/api/learning/think` | 深度推理 Deep think |
| POST | `/api/config/locale` | 切换语言 Switch locale |

---

## 内置工具 / Built-in Tools (42)

| 工具 Tool | 说明 Description |
|:---|:---|
| `fs.read_file` / `fs.write_file` | 文件读写 File I/O |
| `shell.exec` | Shell 命令 (含流式) |
| `web.fetch` | 网页抓取 Web fetch |
| `search` | DDG → SearXNG → Bing |
| `code.exec` / `code.agent` / `code.self_improve` | 代码执行/生成/自改进 |
| `gen.media` | ComfyUI + TTS + 图片生成 |
| `knowledge.search` | RAG 知识库搜索 |
| `agent.delegate` / `agent.list` | Agent 委托/列表 |
| `mcp.search` / `mcp.install` | MCP 搜索/安装 |
| `skill.create` | 技能创建 |
| `git` / `browser` / `desktop` / `vision` / `ocr` | 开发工具链 |
| `pdf.read` / `chart` / `database` / `excel` | 数据处理 |
| `voice.tts` / `voice.stt` | 语音合成/识别 |
| `ssh` / `docker` / `scheduler` / `notify` | 运维工具 |
| `publish.package` | 社媒发布 Social publish |

---

## 开发 / Development

```bash
npm run setup          # 安装依赖 + 构建 / Install + build
npm run doctor         # 硬件检测 + 配置诊断 / Hardware check
npm run check          # TS 类型检查 / Type check
npm run build          # 编译 / Compile
npm run test           # 运行所有测试 (65) / Run all tests
npm run verify         # build + test
npm run dev:ui         # 开发模式 + Web UI / Dev mode
npm run start:ready    # build + 生产启动 / Build + start
npm run electron       # Electron 桌面应用 / Desktop app
npm run pack           # 打包 Electron / Package Electron
npm run dist           # 生成安装包 / Build installer
```

### 测试覆盖 / Test Coverage

65 个测试覆盖：Provider选择、Sandbox策略、Verifier验证、Config加载、Server静态文件、Domain引擎、Model策略、Approval策略、Failure回放、Task意图识别、Capability路由、Skill创建、Code Agent、Generative Media、Social Publish、Artifact生成、Automation注册、Task存储/队列/运行、**Agent Runtime (7)**、**Multi-Agent (7)**、**Knowledge Base (11)**

---

## 环境变量 / Environment Variables

参考 `.env.example`。核心字段：

```env
PLANNER_MODEL=builtin:default    # 规划模型 Planner model
EXECUTOR_MODEL=builtin:default   # 执行模型 Executor model
CRITIC_MODEL=builtin:default     # 批评模型 Critic model
PORT=9877                        # 服务端口 Server port
LOCALE=zh                        # 语言: zh / en
```

完整列表见 `.env.example`。

---

## 路线图 / Roadmap

- [ ] 搜索内置 API 集成 (免配置)
- [ ] OpenTelemetry 可观测性仪表盘
- [ ] 嵌入模型集成 (语义搜索替代 TF-IDF)
- [ ] 长期自治运行器 (计划→执行→复盘→重试独立服务)
- [ ] 社区技能生态
- [ ] 安全审计

---

## 许可证 / License

MIT — 详见 [LICENSE](LICENSE)

Copyright (c) 2026 Orion Wang
