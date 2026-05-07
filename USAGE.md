# DaDa 使用说明

这份文档面向日常使用者。推荐直接双击一键启动，不需要记命令。

## 1. 一键启动

在项目根目录双击：

```text
DaDa-OneClick.bat
```

它会自动完成：

1. 检查 Node.js
2. 无 `.env` 时从 `.env.example` 创建
3. 无依赖时自动安装
4. 自动构建项目
5. 打开浏览器访问 `http://localhost:9877`
6. 启动 DaDa 服务

只检查环境、不启动服务：

```powershell
.\DaDa-OneClick.bat --check
```

## 2. 配置模型

### 方案 A：本地 GGUF

把 `.gguf` 模型文件放到：

```text
models/
```

然后在 `.env` 或 Web 设置页使用：

```env
PLANNER_MODEL=builtin:default
EXECUTOR_MODEL=builtin:default
CRITIC_MODEL=builtin:default
MODELS_DIR=./models
```

### 方案 B：云端 / OpenAI-compatible 接口

在 Web 界面的“设置”页填写：

- `planner / executor / critic` 模型名
- 云端接口地址
- API Key

常见配置：

```env
PLANNER_MODEL=cloud:gpt-4o-mini
EXECUTOR_MODEL=cloud:gpt-4o-mini
CRITIC_MODEL=cloud:gpt-4o-mini
CLOUD_MODEL_ENDPOINT=https://api.openai.com/v1
CLOUD_API_KEY=your-key
```

保存后会写入 `.env.local`，并立即应用到当前服务。

## 3. 界面怎么用

打开：

```text
http://localhost:9877
```

主要工作区：

- `任务编排`：输入目标、选择任务类型/输出格式/模型，并上传附件。
- `执行监控`：查看阶段进度、日志、取消/重试/回放和最终产物。
- `媒体生成`：生成图片、语音，或提交 ComfyUI 图片/视频工作流。
- `模型与技能`：查看模型健康、策略模板、能力矩阵。
- `审批与自动化`：处理高风险审批，创建定时/手动自动化任务。
- `历史与回放`：查看经验记录，回放失败任务或触发自我改进。
- `设置`：配置本地模型、云端接口、ComfyUI 和 OpenAI 图片/TTS 参数、语言切换。

## 4. 任务控制

### 暂停与恢复

在"执行监控"页可以随时暂停正在运行的任务。恢复时从断点继续，不丢失进度。

### 流式输出

shell 等长耗时工具的实时输出会逐行推送到 Web 界面，无需等待命令结束。

## 5. 工作区知识库

DaDa 启动后会自动索引工作区的文本文件（代码、文档、配置等）。执行任务时，与目标相关的文件内容会被自动检索并注入为 prompt 上下文。

你也可以直接在任务中让 DaDa 搜索知识库：

```text
搜索项目里和模型配置相关的文件，告诉我当前配置是什么
```

## 6. 语言切换

## 6. 语言切换

在"设置"页切换中文/英文。也可通过环境变量 `LOCALE=zh` 或 `LOCALE=en` 设置默认语言。

## 7. 典型任务

产品调研：

```text
调研 2026 年 AI Agent 产品市场，分析竞品、定价、用户价值，并自动选择最终交付格式。
```

代码任务：

```text
检查当前项目为什么无法一键启动，修复问题，补充使用说明，并验证构建和测试。
```

多模态分析：

```text
分析我上传的图片、音频和视频，提取重点信息，并整理成汇报材料。
```

媒体生成：

```text
生成一个适合 DaDa 的科技感应用图标。
```

## 8. 自动判断交付物

当任务类型和输出格式选择 `auto` 时，DaDa 会自动判断：

- 是调研、演示、代码、自动化、数据分析、多媒体分析，还是生成图片/视频/语音。
- 最终应交付 PDF、Slides、Markdown、JSON、图片、视频或音频。
- 是否需要调用搜索、文件、代码、媒体生成、技能创建或自我改进工具。

典型自动产物：

- `product_research` -> `Markdown + PDF + Slides`
- `presentation` -> `Slides + PDF + Markdown`
- `data_analysis` -> `JSON + Markdown`
- `image_generation` -> 图片资产
- `video_generation` -> 视频资产或 ComfyUI 任务
- `voice_generation` -> 音频文件
- `social_publish` -> 新闻/素材整理、口播稿、标题文案、标签、发布包和平台发布前置检查
- `code` -> 实现与验证说明

特别注意：如果你输入类似：

```text
打开网页 搜索最近一周的新闻大事件 整理成一个口播稿 并发布在我的抖音号
```

DaDa 会把它识别为 `social_publish`，而不是普通调研。它会先生成“可发布内容包”，包括新闻摘要、口播稿、标题、文案、标签、来源和发布检查清单。

真正点击发布到抖音属于不可逆账号操作，需要满足：

- 已连接登录过的浏览器会话或平台 API/自动化桥接。
- 已配置目标账号。
- 你明确批准最终发布动作。
- 平台工具返回发布成功证明或链接。

在这些条件缺失时，DaDa 不会假装已经发布，而是输出阻塞原因和可手动发布的内容包。

## 9. 上传图片 / 音频 / 视频 / 文档

在“任务编排”的“附件输入”中直接选择文件。

支持：

- 图片：`jpg`、`jpeg`、`png`
- 音频：`mp3`、`wav`
- 视频：`mp4`
- 文档/数据：`txt`、`md`、`pdf`、`json`、`csv`

上传后可预览和移除。DaDa 会把附件元信息注入任务规划。

## 10. 媒体生成怎么用

进入“媒体生成”页：

- `生成图片`：填写提示词；有 OpenAI Key 时走 OpenAI 图片接口，粘贴 ComfyUI workflow 时走 ComfyUI。
- `文字转语音`：填写要朗读的文案；使用 OpenAI TTS。
- `生成视频`：粘贴 ComfyUI API workflow JSON。
- `提交 ComfyUI 工作流`：粘贴任意 ComfyUI API workflow JSON。

相关配置在“设置”页：

```env
COMFYUI_ENDPOINT=http://127.0.0.1:8188
OPENAI_IMAGE_MODEL=gpt-image-1
OPENAI_TTS_MODEL=gpt-4o-mini-tts
OPENAI_TTS_VOICE=alloy
```

如果勾选“等待 ComfyUI 完成并下载结果”，DaDa 会轮询 `/history/{prompt_id}`，并把生成文件保存到 `.agent/generated`。

## 11. 如何看任务是否真的在执行

“执行监控”页会显示：

- 当前阶段：`classify / plan / execute / verify / package`
- 进度条
- 事件日志
- 最终产物下载链接

行为型任务重点看进度条、日志和当前状态；内容型任务重点看产物列表。

## 12. 审批是什么

高风险能力默认不会静默执行，例如：

- shell 命令
- 代码执行
- Docker / SSH / 桌面操作
- 某些自我改进行为

这些动作会进入审批队列。你可以“批准并继续”或“拒绝”。

相关配置：

```env
REQUIRE_APPROVAL_FOR_HIGH_RISK=true
APPROVAL_POLICY_PRESET=balanced
```

## 13. 自动化任务

在“审批与自动化”页填写：

- 任务名称
- 任务目标
- 间隔分钟，可留空

示例：

```text
名称：daily-project-review
目标：每天检查当前项目状态，总结风险、变更和下一步建议。
间隔：1440
```

## 14. 常见问题

### 双击没反应

在 PowerShell 中执行：

```powershell
cd C:\path\to\local-agent-os
.\DaDa-OneClick.bat --check
```

### 模型不可用

检查：

- `models/` 是否有 `.gguf`
- 模型前缀是否正确
- 云端是否配置 `CLOUD_API_KEY`
- 云端 endpoint 是否是 OpenAI-compatible

### 为什么窗口不能关

DaDa 是本地服务，启动窗口就是服务进程。关闭窗口会停止服务。

## 15. 开发 / 排障命令

```powershell
npm.cmd run doctor
npm.cmd run check
npm.cmd run build
npm.cmd run test
npm.cmd run verify
npm.cmd run start:ui
```

普通用户日常优先使用：

```text
DaDa-OneClick.bat
```
