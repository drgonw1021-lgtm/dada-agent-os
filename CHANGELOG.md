# DaDa Agent 更新日志

## 2026-04-29

### 短期任务 (Short-Term)

#### 1. 实时暂停中断
- **文件**: `src/runtime/agent-runtime.ts`, `src/tasks/task-queue.ts`, `src/tasks/task-store.ts`, `src/server.ts`
- `checkPause` 回调模式 — 每个规划周期轮询检查
- `AgentStateMachine.toPaused()` + `saveToDisk()` 状态持久化
- `TaskQueue.pause()` / `TaskQueue.resume()` — 暂停/恢复任务
- `TaskStore` 新增 `"paused"` 状态，`markPaused()` / `markResumed()`
- API: `POST /api/tasks/pause` / `POST /api/tasks/resume`

#### 2. 端到端集成测试
- **文件**: `src/tests/agent-runtime.test.ts` (NEW)
- 7 个测试: 完整流水线、文本格式工具、暂停检查点、状态恢复、maxSteps 强制执行、自我进化触发、批评反思
- Mock 依赖工厂 (router, tools, audit, selfEvolver, advisor 等)

#### 3. 工具错误自诊断
- **文件**: `src/tools/tool-diagnostics.ts` (NEW)
- 15+ 错误正则模式匹配
- `Diagnosis` 接口: pattern → cause → fix
- 分类: `missing_dependency` / `network` / `permission` / `config` / `not_found` / `timeout`
- 运行时自动注入 `[DIAGNOSIS]` + `[FIX]` 到错误消息

### 中期任务 (Medium-Term)

#### 4. 工具流式输出
- **文件**: `src/core/types.ts`, `src/tools/tool-registry.ts`, `src/tools/builtin/shell-exec-tool.ts`
- `ToolStreamChunk` 类型: `{ type: "progress" | "output" | "error", content: string, percent?: number }`
- `ToolDefinition.executeStream()` — 可选流式方法
- `shell.exec` 通过 `spawn` 实现实时 stdout/stderr
- `ToolRegistry.executeStream()` — 自动检测 hasStream，回退到 execute()

#### 5. 多 Agent 协作验证
- **文件**: `src/tests/multi-agent.test.ts` (NEW)
- 7 个测试: AgentRegistry 注册/查找/管理、DelegationManager 接受-执行-完成生命周期、拒绝处理、失败重试、超时处理、ContextBus 消息传递、多 Agent 协调联动
- 修复 `AgentStateMachine` 转换: `critic→verify`, `done→self_evolve`

#### 6. RAG 知识库 (L5 记忆层)
- **文件**: `src/knowledge/` (NEW 4个模块)
- **vector-store.ts**: TF-IDF 向量存储 + 余弦相似度检索，支持增删查和 JSON 序列化
- **document-chunker.ts**: 段落感知滑动窗口分块，可配 chunk 大小和重叠
- **workspace-scanner.ts**: 递归文件扫描，可配扩展名/排除目录/排除模式/文件大小上限
- **knowledge-base.ts**: 主协调器 — 扫描→索引→查询→持久化，增量更新，已删除文件清理
- **knowledge-search-tool.ts**: Agent 工具 `knowledge.search`
- **server/routes/knowledge.ts**: API — index/search/stats/reindex/clear
- 集成到 AgentRuntime L5 上下文层，prompt 注入工作区相关文件内容
- **测试**: `src/tests/knowledge-base.test.ts` — 11 个测试全部通过

### 其他修复

- AgentStateMachine 转换修复: `toDone()` 幂等化 (重复调用不报错)
- `checkPause` 在任务暂停后立即返回，跳过后续校验
- 层次化规划器子目标工具步骤暴露到主 steps 数组
- MCP 搜索优化: npm registry HTTP API (15s→0.5s)，14类30个已知MCP
- i18n 模块: 110+ 条目 zh/en，`LOCALE` 环境变量
- Doctor 硬件检测: RAM/GPU/CPU 检测，5级模型推荐

### 测试总计: 65 个 (曾为 45)

---

## 2026-04-28 (上次会话)

### P2 优化 (DaDa 深度优化计划)
- 工具主动可用性检测 (checkCapability 模式)
- MCP 自配置增强 (npm API + 缓存 + 扩展列表)
- i18n 国际化模块
- 本地推理硬件检测 + 模型推荐
- Web UI 增强 (模型管理面板、语言切换、流式输出)

### 升级路线图 (4项全部完成)
1. 本地 GGUF 直接推理 (node-llama-cpp v3)
2. 流式 SSE 输出 (Provider → Router → Runtime → SSE)
3. 多模态输入 (vision/voice/ocr)
4. 状态机暂停/恢复

---

## 2026-04-22 (续2)

### 新工具注册

#### 7个新工具加入系统
- **git-tool**: Git 版本控制（status, log, commit, push, pull, branch, checkout, add, clone, init）
- **database-tool**: SQL 数据库（SQLite/PostgreSQL/MySQL）
- **notify-tool**: 通知服务（Email, Slack, Discord, SMS）
- **excel-tool**: CSV/Excel 操作（读、写、转换、筛选、排序）
- **ssh-tool**: SSH 远程连接（执行命令、上传/下载文件）
- **scheduler-tool**: 任务调度器（定时/循环任务）
- **docker-tool**: Docker 容器管理

#### 修复
- ssh-tool: `createSshTool` → `createSSHTool` 导出
- excel-tool: 空数据检查修复
- scheduler-tool: 默认 action 值为 "manual"

#### 测试结果
- `/api/tools`: 31 tools
- `/api/domain/status`: 2 domains
- `/api/run`: 29 steps 执行完成

---

## 2026-04-22 (续)

### LLM 驱动的领域工作流

- **DomainEngine LLM 集成**: `setCompleter()` 方法
- **市场分析工作流**: 6步骤调用 LLM 进行真实分析
- **产品设计工作流**: 4步骤调用 LLM 进行真实分析
- **工作流结果存储**: `.agent/workflows/{taskId}.json`
- **LLM 输出解析**: 从文本提取 JSON，支持 markdown 代码块
- **自我学习系统**: 从工作流结果中学习，生成 insights

### 多模态能力
- **语音工具**: TTS (edge-tts/系统say) + STT (Whisper)
- **OCR 工具**: Tesseract OCR 多语言图像文字识别
- **视觉分析工具**: GPT-4o API 图像描述、视觉问答

### 浏览器与桌面自动化
- **浏览器自动化**: Playwright 完整控制
- **桌面自动化**: 运行程序、鼠标、键盘、剪贴板、截屏

---

## v0.4.0 完成 - 2026-04-22

- 基础 Agent 框架 + 多模型支持
- 工具系统 (文件/Shell/Web/代码执行)
- 经验学习系统
- 基础 UI 界面
- 24 个工具

---

## v0.3.0 (初始版本)
- 基础 Agent 框架
- 多模型支持 (本地/云端/LM Studio/vLLM)
- 工具系统 (文件系统/Shell/Web/代码执行)
- 经验学习系统
