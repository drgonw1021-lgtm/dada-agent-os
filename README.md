# DaDa - 本地直载 / 云端接入的自主 Agent

`DaDa` 是一个面向"本地大模型直载 + 外部大模型接入"的自主 Agent。

核心能力：
- 不依赖 `ollama` / `vllm` / `lmstudio`，可直接加载本地 `GGUF` 模型运行
- 可接入 OpenAI-compatible 大模型接口
- 多工具能力，朝类似 OpenClaw 的多功能 Agent 方向演进
- "经验记录 -> 策略建议 -> 自我改进工具" 的闭环
- 分层记忆系统 (L1-L5) + RAG 知识库
- 多 Agent 协作 (AgentRegistry + DelegationManager + ContextBus)
- 流式输出 + 暂停/恢复 + 失败自诊断

## 当前主路线

推荐优先级：
1. `builtin:default`
   直接通过 `node-llama-cpp` 加载 `models/` 下的本地 GGUF 模型，不依赖额外推理服务
2. `cloud:<model>`
   直接接入 OpenAI-compatible 接口，例如 OpenAI、兼容网关、自建兼容服务
3. 兼容模式
   如果你已经有现成服务，也仍然支持 `ollama:`、`lmstudio:`、`vllm:`、`llama-cpp:`

## 快速开始

### 最推荐：一键启动

Windows 下：

1. 双击 `install-dada.bat` 安装依赖并构建
2. 双击 `daDa.bat` 启动 DaDa 控制台

它会自动检查 Node.js、加载环境变量、构建项目、打开浏览器并启动 DaDa 控制台。

详细使用说明见 `USAGE.md`。

### 方案 A：直接使用本地 GGUF 模型

1. 准备一个 GGUF 模型文件，放到 `models/` 目录
2. 安装依赖

```bash
npm install
```

如果你在 Windows PowerShell 中遇到 `npm.ps1` 执行策略限制，可以改用：

```bash
npm.cmd install
```

3. 使用推荐配置启动

```bash
npm run dev:ui
```

4. 打开 [http://localhost:9877](http://localhost:9877)

默认推荐配置：

```env
PLANNER_MODEL=builtin:default
MODELS_DIR=./models
```

项目现在会自动加载当前目录下的 `.env` 与 `.env.local`，不需要手动 `set` 环境变量。

### 方案 B：接入云端或兼容接口

```env
PLANNER_MODEL=cloud:gpt-4o-mini
CLOUD_MODEL_ENDPOINT=https://api.openai.com/v1
CLOUD_API_KEY=your-api-key
```

然后启动：

```bash
npm run dev:ui
```

## 环境变量

参考 `.env.example`。

核心字段：

```env
# 推荐：直接本地直载 GGUF
PLANNER_MODEL=builtin:default
MODELS_DIR=./models

# 推荐：OpenAI-compatible 云接口
# PLANNER_MODEL=cloud:gpt-4o-mini
# CLOUD_MODEL_ENDPOINT=https://api.openai.com/v1
# CLOUD_API_KEY=your-api-key

# 多模型角色
EXECUTOR_MODEL=builtin:default
CRITIC_MODEL=builtin:default

# 兼容已有推理服务（非必需）
LOCAL_MODEL_ENDPOINT=http://127.0.0.1:11434
LMSTUDIO_ENDPOINT=http://127.0.0.1:1234/v1
VLLM_ENDPOINT=http://127.0.0.1:8000/v1
LLAMA_CPP_ENDPOINT=http://127.0.0.1:8080/v1

# 生成媒体（可选）
COMFYUI_ENDPOINT=http://127.0.0.1:8188
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=alloy

# 搜索（可选）
SEARXNG_ENDPOINT=http://127.0.0.1:8888

# 语言
LOCALE=zh
```

## 模型前缀

| 前缀 | 含义 | 示例 |
| --- | --- | --- |
| `builtin:` | 直接加载本地 GGUF 模型 | `builtin:default` |
| `cloud:` | OpenAI-compatible 接口 | `cloud:gpt-4o-mini` |
| `ollama:` | Ollama 兼容模式 | `ollama:qwen2.5:7b` |
| `lmstudio:` | LM Studio 兼容模式 | `lmstudio:qwen2.5` |
| `vllm:` | vLLM 兼容模式 | `vllm:qwen2.5` |
| `llama-cpp:` | llama.cpp server 兼容模式 | `llama-cpp:qwen2.5` |

## 架构概览

```
用户请求 → TaskIntent(意图识别)
         → CapabilityRouter(能力路由)
         → AgentRuntime(主循环: 分类→规划→执行→批评→验证→自我进化)
            ├── 分层记忆注入:
            │   L1: 即时上下文 (attachments, skills)
            │   L2: 任务记忆 (TaskMemoryStore)
            │   L3: 经验策略 (StrategyAdvisor + evolved skills)
            │   L4: 语义记忆 (SemanticMemory)
            │   L5: 工作区 RAG 知识库 (KnowledgeBase)
            ├── 工具执行 (ToolRegistry → execute/executeStream)
            └── 暂停检查点 (每周期 checkPause)
         → Verifier(验证)
         → SelfEvolver(自我进化 → SKILL.md)
```

## 核心功能

### 分层记忆系统

| 层级 | 名称 | 说明 |
|------|------|------|
| L1 | 即时上下文 | 附件、技能指令、领域 workflow |
| L2 | 任务记忆 | TaskMemoryStore — 历史任务上下文检索 |
| L3 | 经验策略 | StrategyAdvisor + SelfEvolver 成熟技能 + 陷阱警告 |
| L4 | 语义记忆 | SemanticMemory — 跨任务语义关联 |
| L5 | RAG 知识库 | 工作区文件索引 (TF-IDF + 余弦相似度检索) |

### RAG 知识库 (L5)

工作区文件自动索引和上下文检索：

- **扫描**: 递归扫描工作区文本文件 (.ts/.md/.json/.py/.yaml 等)
- **分块**: 段落感知滑动窗口分块，支持重叠
- **检索**: TF-IDF 向量化 + 余弦相似度排序
- **持久化**: JSON 索引文件，支持增量更新
- **Agent 工具**: `knowledge.search` — agent 可主动查询工作区知识
- **API 端点**:
  - `POST /api/knowledge/index` — 触发索引
  - `GET /api/knowledge/search?q=...&topK=5` — 搜索
  - `GET /api/knowledge/stats` — 统计
  - `POST /api/knowledge/reindex` — 重建索引
  - `POST /api/knowledge/clear` — 清空

### 任务暂停/恢复

- 每个规划周期检查 `checkPause` 回调
- 状态机持久化到磁盘 (`AgentStateMachine.saveToDisk()`)
- `POST /api/tasks/pause` / `POST /api/tasks/resume`
- 恢复时从持久化状态继续，不丢失进度

### 工具流式输出

- `ToolDefinition.executeStream()` — 可选流式方法
- `shell.exec` 通过 `spawn` 实现实时 stdout/stderr 输出
- `ToolRegistry.executeStream()` — 自动检测 `hasStream`，回退到 `execute()`
- 进度通过 `ProgressManager` 实时推送到 Web UI

### 工具错误自诊断

- `tool-diagnostics.ts` — 15+ 错误模式匹配
- 自动分类: `missing_dependency` / `network` / `permission` / `config` / `not_found` / `timeout`
- Agent 执行失败时自动注入 `[DIAGNOSIS]` 和 `[FIX]` 建议到错误消息中

### 多 Agent 协作

- **AgentRegistry**: agent 注册、心跳、按能力/角色查找、统计
- **DelegationManager**: 创建委托 → 接受/拒绝 → 执行 → 完成/失败/重试/超时
- **ContextBus**: 消息发布/订阅、共享上下文、话题分组

### 自我进化 (SelfEvolver)

- 从成功任务中提炼可复用技能
- 生成 SKILL.md 到 `./.agent/skills/`
- 成熟技能自动注入到后续任务的 prompt 上下文
- 陷阱警告 (pitfall_warning): 失败模式自动提醒

### 层次化规划器 (HierarchicalPlanner)

- 复杂任务自动分解为子目标
- 战略规划 → 子目标分解 → 并行/顺序执行
- 子目标工具步骤暴露到主验证器，避免误报

### i18n 国际化

- `src/core/i18n.ts` — 110+ 条目 zh/en
- `LOCALE` 环境变量控制语言
- `POST /api/config/locale` 动态切换

### MCP 自配置增强

- npm registry HTTP API 替代 CLI (搜索 15s → 0.5s)
- 14 类 30 个已知 MCP 服务器
- 5 分钟内存缓存 + 429 降级处理

### 工具主动可用性检测

- 启动时检测可选依赖 (Playwright, Tesseract, FFmpeg, ComfyUI 等)
- 不可用工具标注具体原因 (`tools.markUnavailable()`)
- 能力报告中显示每个工具的前置条件

### 本地推理硬件检测

- `npm run doctor` — RAM/GPU/CPU 检测
- 5 级模型推荐 (基于硬件 + 任务需求)

## Web 面板与接口

Web UI 展示：
- 当前 planner/executor/critic 模型
- 实际命中的 provider
- built-in runtime 是否可用
- 本地模型数量、当前加载模型
- 经验记录统计与成功率
- 最近执行历史
- 持久化任务状态、取消、重试、暂停、恢复
- 多模型策略模板
- 高风险操作审批队列
- 任务阶段进度条（分类 / 规划 / 执行 / 校验 / 打包）
- 流式输出实时显示
- 上传附件预览与最终产物下载
- 模型候选列表、策略模板一键回填、云端接口配置
- 媒体生成台：图片、语音、ComfyUI 工作流
- 语言切换 (zh/en)

主要接口：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/config` | 当前配置 |
| GET | `/api/health` | 健康检查 |
| GET | `/api/system` | 系统信息 |
| GET | `/api/models` | 模型列表 |
| GET | `/api/model-profiles` | 模型策略模板 |
| GET | `/api/model-options` | 模型候选列表 |
| POST | `/api/capabilities/route` | 能力路由 |
| GET | `/api/tools` | 工具列表 |
| GET | `/api/experiences` | 经验记录 |
| GET | `/api/tasks` | 任务列表 |
| GET | `/api/tasks/status` | 任务状态 |
| POST | `/api/tasks/cancel` | 取消任务 |
| POST | `/api/tasks/retry` | 重试任务 |
| POST | `/api/tasks/pause` | 暂停任务 |
| POST | `/api/tasks/resume` | 恢复任务 |
| POST | `/api/tasks/replay-failed` | 回放失败任务 |
| GET | `/api/approvals` | 审批列表 |
| GET | `/api/approval-policy` | 审批策略 |
| POST | `/api/approvals/approve` | 批准 |
| POST | `/api/approvals/reject` | 拒绝 |
| POST | `/api/run` | 执行任务 |
| POST | `/api/run/stream` | 流式执行 |
| POST | `/api/run-async` | 异步执行 |
| POST | `/api/uploads` | 上传附件 |
| GET | `/api/artifacts/file` | 下载产物 |
| POST | `/api/media/generate` | 生成媒体 |
| GET | `/api/media/jobs` | 媒体任务列表 |
| GET | `/api/automations` | 自动化列表 |
| POST | `/api/automations` | 创建自动化 |
| POST | `/api/automations/run` | 运行自动化 |
| GET | `/api/learning/stats` | 学习统计 |
| POST | `/api/learning/think` | 深度推理 |
| GET | `/api/domain/status` | 领域状态 |
| POST | `/api/domain/plan` | 领域规划 |
| GET | `/api/agents` | Agent 列表 |
| GET | `/api/agents/context-bus` | 上下文总线 |
| GET | `/api/agents/delegations` | 委托列表 |
| POST | `/api/knowledge/index` | 触发 KB 索引 |
| GET | `/api/knowledge/search?q=&topK=` | 搜索知识库 |
| GET | `/api/knowledge/stats` | KB 统计 |
| POST | `/api/knowledge/reindex` | 重建 KB 索引 |
| POST | `/api/knowledge/clear` | 清空 KB |
| POST | `/api/config/locale` | 切换语言 |

## Agent 能力

当前已接入的工具：

| 工具 | 说明 |
|------|------|
| `core.echo` | 回显测试 |
| `fs.read_file` | 读取文件 |
| `fs.write_file` | 写入文件 |
| `fs.enhanced` | 增强文件操作 |
| `shell.exec` | Shell 命令执行 (含流式) |
| `web.fetch` | 网页抓取 |
| `search` | 搜索 (DDG → SearXNG → Bing) |
| `code.exec` | 代码执行 |
| `api.request` | API 请求 |
| `task.planner` | 任务规划 |
| `model` | 模型管理 |
| `gen.media` | 生成媒体 (图片/TTS/ComfyUI) |
| `code.agent` | 编码 Agent |
| `code.generator` | 代码生成 |
| `code.improver` | 代码改进 |
| `code.self_improve` | 自改进循环 |
| `skill.create` | 技能创建 |
| `publish.package` | 社媒发布包 |
| `knowledge.search` | 知识库搜索 |
| `agent.delegate` | Agent 委托 |
| `agent.list` | Agent 列表 |
| `mcp.search` | MCP 搜索 |
| `mcp.install` | MCP 安装 |
| `git` | Git 操作 |
| `browser` | 浏览器自动化 |
| `desktop` | 桌面自动化 |
| `vision` | 视觉分析 |
| `voice.tts` / `voice.stt` | 语音合成/识别 |
| `ocr` | 文字识别 |
| `pdf.read` | PDF 阅读 |
| `chart` | 图表生成 |
| `database` | 数据库操作 |
| `notify` | 通知服务 |
| `excel` | Excel/CSV 操作 |
| `ssh` | SSH 远程连接 |
| `scheduler` | 任务调度 |
| `docker` | Docker 管理 |

## 自我提升体系

当前版本的五层闭环：

1. **经验记录**: 每次任务执行后，自动记录目标、结果、工具序列、标签
2. **策略建议**: 新任务参考历史相似任务，优先借鉴成功路径 (含进化技能 + 陷阱警告)
3. **自改进工具**: `code.self_improve` — 生成代码 → 跑测试 → 根据报错修复 → 再验证
4. **自我进化**: `SelfEvolver` — 从成功任务提炼 SKILL.md，自动注入后续任务
5. **失败诊断**: 工具错误自动模式匹配 → 提供修复建议

## 开发命令

```bash
npm run setup         # 安装依赖 + 首次构建
npm run doctor        # 硬件检测 + 模型推荐 + 配置诊断
npm run check         # TypeScript 类型检查
npm run build         # 编译
npm run test          # 运行所有测试 (65个)
npm run verify        # build + test
npm run dev           # 开发模式 (tsx)
npm run dev:ui        # 开发模式 + Web UI
npm run start         # 生产启动
npm run start:ui      # 生产启动 + Web UI
npm run start:ready   # build + start:ui
```

`npm run doctor` 输出：环境文件、模型路由、模型目录状态、硬件配置、推荐模型、常见配置问题。

## 测试覆盖

65 个测试覆盖以下模块：

- Provider选择、Sandbox策略、Verifier验证、Config加载
- Server静态文件、Domain引擎、Model策略、Approval策略
- Approval存储、Tool注册审批、Failure回放
- Task意图识别、Capability路由、Skill创建
- Code Agent、Generative Media、Social Publish
- Artifact生成、Automation注册、Task存储、Task队列、Automation运行
- **Agent Runtime** (7): 完整流水线、文本格式工具、暂停/恢复、maxSteps、自我进化、批评反思
- **Multi-Agent** (7): 注册/查找、委托生命周期、拒绝、重试、超时、ContextBus、多Agent协调
- **Knowledge Base** (11): 向量存储、文档分块、工作区扫描、KB集成、空工作区

## 建议的下一步演进

- 文档自动化：基于 KB 自动生成/更新项目文档
- RAG 增强：嵌入模型集成 + 语义搜索（当前 TF-IDF 可升级为 embedding）
- 长期自治运行器：计划、执行、复盘、重试拆成独立服务
- 更细粒度审批策略：按路径、命令参数、项目目录自动放行
- 经验蒸馏：从经验库自动生成技能模板

