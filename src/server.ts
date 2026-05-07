import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";
import { exec } from "node:child_process";
import { createAgentApp } from "./app.js";
import { TaskStore } from "./tasks/task-store.js";
import { MediaJobStore } from "./tasks/media-job-store.js";
import { UploadStore } from "./tasks/upload-store.js";
import { ArtifactGenerator } from "./tasks/artifact-generator.js";
import { TaskQueue } from "./tasks/task-queue.js";
import { TaskChainManager } from "./tasks/task-chain-manager.js";
import { createProjectLaunchTool } from "./tools/builtin/project-launch-tool.js";
import { AutomationRunner } from "./automation/automation-runner.js";
import { resolveTaskIntent } from "./tasks/task-intent.js";
import { buildExecutionDAG, toMermaid } from "./runtime/strategy-engine.js";
import { serveStaticAsset } from "./server-static.js";
import { readJsonBody, json, error, type ServerContext } from "./server/util.js";

import * as configRoutes from "./server/routes/config.js";
import * as systemRoutes from "./server/routes/system.js";
import * as runRoutes from "./server/routes/run.js";
import * as taskRoutes from "./server/routes/tasks.js";
import * as approvalRoutes from "./server/routes/approvals.js";
import * as mediaRoutes from "./server/routes/media.js";
import * as fileRoutes from "./server/routes/files.js";
import * as automationRoutes from "./server/routes/automations.js";
import * as learningRoutes from "./server/routes/learning.js";
import * as projectRoutes from "./server/routes/projects.js";
import * as clawhubRoutes from "./server/routes/clawhub.js";
import * as agentRoutes from "./server/routes/agents.js";
import * as knowledgeRoutes from "./server/routes/knowledge.js";
import { WebSocketServer } from "./server/websocket.js";
import type { ProgressEvent } from "./progress-manager.js";
import { metrics } from "./observability/metrics.js";

type RouteResult = { status: number; data: unknown } | void;

function send(res: ServerResponse, result: RouteResult): void {
  if (result) {
    json(res, result.status, result.data);
  }
}

async function main() {
  const app = await createAgentApp(process.env);
  const port = Number(process.env.PORT ?? "9877");
  const webRoot = join(process.cwd(), "web");
  const taskStore = new TaskStore(app.config.taskStorePath);
  const mediaJobStore = new MediaJobStore(app.config.mediaJobStorePath);
  const uploadStore = new UploadStore(app.config.uploadsDir, app.config.maxUploadBytes);
  const artifactGenerator = new ArtifactGenerator(app.config.artifactsDir);

  // ── Project Task Chain Manager ──────────────────────────────────────
  // When a task completes, auto-spawn dependent child tasks in the same project chain.
  // Created before taskQueue so the onCompleted closure can reference it.
  const taskChainManager = new TaskChainManager({
    enqueue: async (input) => {
      return taskQueue.enqueue(input);
    },
  });

  // Register project chain tool so the LLM can launch multi-task projects
  app.tools.register(createProjectLaunchTool(taskChainManager));

  const taskQueue = new TaskQueue(
    taskStore,
    async ({ goal, taskId, taskLineageId, taskType, outputFormat, attachments, modelOverrides, checkPause, projectId, projectDirectory, assignedRole }) => {
      // Build project context from recent tasks in the same project
      let projectContext: string | undefined;
      if (projectId) {
        try {
          const allTasks = await taskStore.list();
          const projectTasks = allTasks
            .filter(t => t.projectId === projectId && t.taskId !== taskId)
            .sort((a, b) => (b.completedAt || b.createdAt).localeCompare(a.completedAt || a.createdAt));
          const recent = projectTasks.slice(0, 5);
          if (recent.length > 0) {
            const parts: string[] = [];
            parts.push(`你正在项目 "${projectId}" 中工作。以下是该项目最近的任务记录：`);
            for (const t of recent) {
              const status = t.status === "completed" ? "✓" : t.status === "failed" ? "✗" : "·";
              const summary = t.summary ? ` — ${t.summary.substring(0, 150)}` : "";
              parts.push(`- ${status} ${t.goal.substring(0, 120)}${summary}`);
            }
            const lastCompleted = projectTasks.find(t => t.status === "completed");
            if (lastCompleted?.summary) {
              parts.push(`\n上一个完成任务的摘要：${lastCompleted.summary.substring(0, 300)}`);
            }
            projectContext = parts.join("\n");
          }
        } catch { /* non-critical */ }
      }

      return app.runtime.runTask({
        goal,
        taskId,
        taskLineageId,
        taskType,
        outputFormat,
        attachments,
        modelOverrides,
        checkPause,
        projectContext,
        projectDirectory
      });
    },
    {
      concurrency: app.config.maxConcurrentTasks,
      maxConcurrentPerProject: app.config.maxConcurrentPerProject,
      defaultMaxRetries: app.config.maxTaskRetries,
      checkpointManager: app.checkpointManager,
      onRecovered: (originalTaskId, newTask, resumeGoal) => {
        console.log(`[TaskQueue] Recovered task ${originalTaskId} → ${newTask.taskId}`);
      },
      onCompleted: async (task, result) => {
        app.progressManager.emit(task.taskId, {
          type: "phase",
          payload: { phase: "package", label: "Packaging artifacts" },
          at: new Date().toISOString()
        });
        const artifacts = await artifactGenerator.generate(task, result);
        app.progressManager.emit(task.taskId, {
          type: "artifacts.ready",
          payload: { count: artifacts.length, artifacts },
          at: new Date().toISOString()
        });

        // Auto-spawn dependent child tasks in project chains
        if (task.projectId) {
          taskChainManager
            .onTaskCompleted(task, result.summary || "")
            .catch(err => console.warn(`[TaskChain] Spawn error: ${err instanceof Error ? err.message : String(err)}`));
        }

        return artifacts;
      }
    }
  );
  await taskQueue.initialize();

  const automationRunner = new AutomationRunner(
    app.automationRegistry,
    async (automation) => {
      await taskQueue.enqueue({
        goal: automation.goal,
        source: "automation",
        automationId: automation.id,
        automationName: automation.name
      });
    },
    { pollMs: app.config.automationPollMs }
  );
  automationRunner.start();

  // WebSocket server for real-time bidirectional communication
  const wss = new WebSocketServer({
    onCancelTask: async (taskId) => {
      await taskQueue.cancel(taskId);
    },
    onPauseTask: async (taskId) => {
      await taskQueue.pause(taskId);
    },
    onResumeTask: async (taskId) => {
      await taskQueue.resume(taskId);
    },
    onApprove: async (approvalId) => {
      const store = app.approvalStore;
      if (store) await store.approve(approvalId);
    },
    onReject: async (approvalId) => {
      const store = app.approvalStore;
      if (store) await store.reject(approvalId);
    },
    onSubmitTask: async (goal) => {
      const task = await taskQueue.enqueue({ goal, source: "manual" });
      app.runtime.runTask({ goal, taskId: task.taskId }).catch(() => {});
      return { taskId: task.taskId };
    },
  });

  // Bridge progress events to WebSocket broadcasts
  app.progressManager.onAll((taskId: string, event: ProgressEvent) => {
    wss.broadcast(event, taskId);
  });

  const ctx: ServerContext = {
    app,
    port,
    webRoot,
    locale: app.config.locale,
    taskStore,
    mediaJobStore,
    uploadStore,
    artifactGenerator,
    taskQueue,
    wss,
    botManager: app.botManager
  };

  const server = createServer(async (req, res) => {
    // Request timing middleware
    const startTime = Date.now();
    const origEnd = res.end.bind(res);
    res.end = function (...args: any[]) {
      const durationMs = Date.now() - startTime;
      metrics.recordRequest(
        (req.method ?? "GET").toUpperCase(),
        (() => { try { return new URL(req.url ?? "/", `http://localhost:${port}`).pathname; } catch { return req.url ?? "/"; }})(),
        res.statusCode,
        durationMs
      );
      return origEnd(...args);
    } as typeof res.end;

    try {
      const url = new URL(req.url ?? "/", `http://localhost:${port}`);
      const path = url.pathname;
      const method = (req.method ?? "GET").toUpperCase();

      // ── Config ──────────────────────────────────────────────────────
      if (method === "GET" && path === "/api/config") {
        return send(res, { status: 200, data: await configRoutes.handleGetConfig(ctx) });
      }
      if (method === "GET" && path === "/api/models") {
        return send(res, { status: 200, data: await configRoutes.handleGetModels(ctx) });
      }
      if (method === "GET" && path === "/api/model-profiles") {
        return send(res, { status: 200, data: await configRoutes.handleGetModelProfiles(ctx) });
      }
      if (method === "GET" && path === "/api/model-options") {
        return send(res, { status: 200, data: await configRoutes.handleGetModelOptions(ctx) });
      }
      if (method === "POST" && path === "/api/models/load") {
        return send(res, await configRoutes.handlePostModelLoad(ctx, req));
      }
      if (method === "POST" && path === "/api/models/unload") {
        return send(res, await configRoutes.handlePostModelUnload(ctx));
      }
      if (method === "POST" && path === "/api/models/download") {
        return send(res, await configRoutes.handlePostModelDownload(ctx, req));
      }
      if (method === "POST" && path === "/api/models/download-stream") {
        await configRoutes.handlePostModelDownloadStream(ctx, req, res);
        return;
      }
      if (method === "POST" && path === "/api/models/delete") {
        return send(res, await configRoutes.handlePostModelDelete(ctx, req));
      }
      if (method === "POST" && path === "/api/config/model-settings") {
        return send(res, await configRoutes.handlePostModelSettings(ctx, req));
      }
      if (method === "POST" && path === "/api/config/settings") {
        return send(res, await configRoutes.handlePostConfig(ctx, req));
      }
      if (method === "POST" && path === "/api/config/locale") {
        return send(res, await configRoutes.handlePostLocale(ctx, req));
      }
      if (method === "POST" && path === "/api/capabilities/route") {
        return send(res, await configRoutes.handlePostCapabilitiesRoute(ctx, req));
      }
      if (method === "GET" && path === "/api/product/capabilities") {
        return send(res, { status: 200, data: await configRoutes.handleGetProductCapabilities(ctx) });
      }

      // ── System ──────────────────────────────────────────────────────
      if (method === "GET" && path === "/api/hardware") {
        return send(res, { status: 200, data: await systemRoutes.handleGetHardware(ctx) });
      }
      if (method === "GET" && path === "/api/health") {
        return send(res, { status: 200, data: await systemRoutes.handleGetHealth(ctx) });
      }
      if (method === "GET" && path === "/api/system") {
        return send(res, { status: 200, data: await systemRoutes.handleGetSystem(ctx) });
      }
      if (method === "GET" && path === "/api/metrics") {
        const snap = metrics.getSnapshot();
        const taskStats = await ctx.taskStore.getStats();
        snap.activeTaskCount = taskStats.running + taskStats.pending;
        return send(res, {
          status: 200,
          data: {
            ...snap,
            tasks: {
              completed: taskStats.completed,
              failed: taskStats.failed,
              cancelled: taskStats.cancelled,
              pending: taskStats.pending,
              running: taskStats.running,
              waitingApproval: taskStats.waitingApproval,
            }
          }
        });
      }
      if (method === "GET" && path === "/api/tools") {
        return send(res, { status: 200, data: await systemRoutes.handleGetTools(ctx) });
      }
      if (method === "GET" && path === "/api/experiences") {
        return send(res, { status: 200, data: await systemRoutes.handleGetExperiences(ctx) });
      }
      if (method === "GET" && path === "/api/audit") {
        const taskId = url.searchParams.get("taskId") ?? undefined;
        return send(res, { status: 200, data: await systemRoutes.handleGetAudit(ctx, taskId) });
      }
      if (method === "POST" && path === "/api/voice/transcribe") {
        return send(res, await systemRoutes.handlePostVoiceTranscribe(ctx, req));
      }

      // ── Run ─────────────────────────────────────────────────────────
      if (method === "POST" && path === "/api/run") {
        return send(res, await runRoutes.handlePostRun(ctx, req));
      }
      if (method === "POST" && path === "/api/run-async") {
        return send(res, await runRoutes.handlePostRunAsync(ctx, req));
      }
      if (method === "POST" && path === "/api/run/stream") {
        runRoutes.handlePostRunStream(ctx, req, res);
        return;
      }
      if (method === "GET" && path === "/api/progress") {
        const taskId = url.searchParams.get("taskId") ?? undefined;
        if (!taskId) {
          return error(res, 400, "taskId is required");
        }
        runRoutes.handleGetProgress(ctx, req, res, taskId);
        return;
      }

      // ── Tasks ───────────────────────────────────────────────────────
      if (method === "GET" && path === "/api/tasks") {
        return send(res, { status: 200, data: await taskRoutes.handleGetTasks(ctx) });
      }
      if (method === "GET" && path === "/api/tasks/status") {
        const taskId = url.searchParams.get("taskId") ?? "";
        if (!taskId) return error(res, 400, "taskId is required");
        return send(res, await taskRoutes.handleGetTaskStatus(ctx, taskId));
      }
      if (method === "POST" && path === "/api/tasks/cancel") {
        return send(res, await taskRoutes.handlePostTaskCancel(ctx, req));
      }
      if (method === "POST" && path === "/api/tasks/retry") {
        return send(res, await taskRoutes.handlePostTaskRetry(ctx, req));
      }
      if (method === "POST" && path === "/api/tasks/replay-failed") {
        return send(res, await taskRoutes.handlePostTaskReplayFailed(ctx, req));
      }
      if (method === "POST" && path === "/api/tasks/pause") {
        return send(res, await taskRoutes.handlePostTaskPause(ctx, req));
      }
      if (method === "POST" && path === "/api/tasks/resume") {
        return send(res, await taskRoutes.handlePostTaskResume(ctx, req));
      }

      // ── Approvals ───────────────────────────────────────────────────
      if (method === "GET" && path === "/api/approvals") {
        return send(res, { status: 200, data: await approvalRoutes.handleGetApprovals(ctx) });
      }
      if (method === "GET" && path === "/api/approval-policy") {
        return send(res, { status: 200, data: await approvalRoutes.handleGetApprovalPolicy(ctx) });
      }
      if (method === "POST" && path === "/api/approvals/approve") {
        return send(res, await approvalRoutes.handlePostApprove(ctx, req));
      }
      if (method === "POST" && path === "/api/approvals/reject") {
        return send(res, await approvalRoutes.handlePostReject(ctx, req));
      }

      // ── Media ───────────────────────────────────────────────────────
      if (method === "GET" && path === "/api/media/jobs") {
        const id = url.searchParams.get("id")?.trim();
        return send(res, await mediaRoutes.handleGetMediaJobs(ctx, id));
      }
      if (method === "POST" && path === "/api/media/generate") {
        return send(res, await mediaRoutes.handlePostMediaGenerate(ctx, req));
      }

      // ── Files ───────────────────────────────────────────────────────
      if (method === "GET" && path === "/api/artifacts/file") {
        const filePath = url.searchParams.get("path");
        if (!filePath) return error(res, 400, "path is required");
        await fileRoutes.handleGetArtifactFile(res, ctx, filePath);
        return;
      }
      if (method === "GET" && path === "/api/uploads/file") {
        const filePath = url.searchParams.get("path");
        if (!filePath) return error(res, 400, "path is required");
        await fileRoutes.handleGetUploadFile(res, ctx, filePath);
        return;
      }
      if (method === "POST" && path === "/api/uploads") {
        return send(res, await fileRoutes.handlePostUpload(ctx, req));
      }

      // ── Automations ─────────────────────────────────────────────────
      if (method === "GET" && path === "/api/automations") {
        return send(res, { status: 200, data: await automationRoutes.handleGetAutomations(ctx) });
      }
      if (method === "POST" && path === "/api/automations") {
        return send(res, await automationRoutes.handlePostAutomations(ctx, req));
      }
      if (method === "POST" && path === "/api/automations/run") {
        return send(res, await automationRoutes.handlePostAutomationRun(ctx, req));
      }

      // ── Learning / Domain ───────────────────────────────────────────
      if (method === "GET" && path === "/api/domain/status") {
        return send(res, { status: 200, data: await learningRoutes.handleGetDomainStatus(ctx) });
      }
      if (method === "POST" && path === "/api/domain/plan") {
        return send(res, await learningRoutes.handlePostDomainPlan(ctx, req));
      }
      if (method === "GET" && path === "/api/learning/stats") {
        return send(res, { status: 200, data: await learningRoutes.handleGetLearningStats(ctx) });
      }
      if (method === "POST" && path === "/api/learning/think") {
        return send(res, await learningRoutes.handlePostLearningThink(ctx, req));
      }

      // ── Projects ────────────────────────────────────────────────────
      if (method === "GET" && path === "/api/projects") {
        return send(res, { status: 200, data: await projectRoutes.handleGetProjects(ctx) });
      }
      if (method === "POST" && path === "/api/projects") {
        return send(res, await projectRoutes.handlePostProjects(ctx, req));
      }
      if (method === "GET" && path.startsWith("/api/projects/") && !path.includes("/tasks")) {
        const projId = path.replace("/api/projects/", "");
        return send(res, await projectRoutes.handleGetProject(ctx, projId));
      }
      if (method === "DELETE" && path.startsWith("/api/projects/")) {
        const projId = path.replace("/api/projects/", "");
        return send(res, await projectRoutes.handleDeleteProject(ctx, projId));
      }
      const projectTasksMatch = path.match(/^\/api\/projects\/([^/]+)\/tasks$/);
      if (method === "GET" && projectTasksMatch) {
        return send(res, await projectRoutes.handleGetProjectTasks(ctx, projectTasksMatch[1]));
      }

      // ── ClaWHub ─────────────────────────────────────────────────────
      if (method === "GET" && path === "/api/clawhub/skills") {
        return send(res, { status: 200, data: await clawhubRoutes.handleGetClawhubSkills(ctx) });
      }
      if (method === "GET" && path.startsWith("/api/clawhub/skill/")) {
        const name = path.replace("/api/clawhub/skill/", "");
        return send(res, await clawhubRoutes.handleGetClawhubSkill(ctx, name));
      }
      if (method === "POST" && path === "/api/clawhub/search") {
        return send(res, await clawhubRoutes.handlePostClawhubSearch(ctx, req));
      }
      if (method === "POST" && path === "/api/clawhub/install") {
        return send(res, await clawhubRoutes.handlePostClawhubInstall(ctx, req));
      }
      if (method === "POST" && path === "/api/clawhub/uninstall") {
        return send(res, await clawhubRoutes.handlePostClawhubUninstall(ctx, req));
      }

      // ── Bots (Multi-Channel) ─────────────────────────────────────────
      if (method === "GET" && path === "/api/bots") {
        return send(res, { status: 200, data: ctx.botManager?.getStatus() || [] });
      }
      // Lark/Feishu webhook
      if (method === "POST" && path === "/api/bots/lark") {
        const body = await readJsonBody(req);
        const larkBot = ctx.botManager?.getBot("lark") as any;
        if (larkBot?.processWebhook) {
          const result = await larkBot.processWebhook(body);
          return send(res, result);
        }
        return send(res, { status: 200, data: {} });
      }
      // DingTalk webhook
      if (method === "POST" && path === "/api/bots/dingtalk") {
        const body = await readJsonBody(req);
        const dtBot = ctx.botManager?.getBot("dingtalk") as any;
        if (dtBot?.processWebhook) {
          const result = await dtBot.processWebhook(body);
          return send(res, result);
        }
        return send(res, { status: 200, data: {} });
      }
      // WeChat callback (GET=verification, POST=messages)
      if ((method === "GET" || method === "POST") && path === "/api/bots/wechat") {
        const wxBot = ctx.botManager?.getBot("wechat") as any;
        if (method === "GET") {
          // Server verification
          const signature = url.searchParams.get("signature") || "";
          const timestamp = url.searchParams.get("timestamp") || "";
          const nonce = url.searchParams.get("nonce") || "";
          const echostr = url.searchParams.get("echostr") || "";
          if (wxBot?.verifySignature?.(signature, timestamp, nonce)) {
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end(echostr);
          } else {
            res.writeHead(403);
            res.end("Forbidden");
          }
          return;
        } else {
          const body = await new Promise<string>((resolve) => {
            const chunks: Buffer[] = [];
            req.on("data", (c: Buffer) => chunks.push(c));
            req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          });
          if (wxBot?.processCallback) {
            const reply = await wxBot.processCallback(body);
            res.writeHead(200, { "Content-Type": "text/plain" });
            res.end(reply);
            return;
          }
          return send(res, { status: 200, data: "ok" });
        }
      }

      // ── Knowledge Base (RAG) ────────────────────────────────────────
      if (method === "POST" && path === "/api/knowledge/index") {
        return send(res, await knowledgeRoutes.handlePostIndex(ctx));
      }
      if (method === "POST" && path === "/api/knowledge/reindex") {
        return send(res, await knowledgeRoutes.handlePostReindex(ctx));
      }
      if (method === "GET" && path === "/api/knowledge/search") {
        const q = url.searchParams.get("q") ?? "";
        const topK = Number(url.searchParams.get("topK") ?? "5");
        return send(res, await knowledgeRoutes.handleGetSearch(ctx, q, topK));
      }
      if (method === "GET" && path === "/api/knowledge/stats") {
        return send(res, await knowledgeRoutes.handleGetStats(ctx));
      }
      if (method === "POST" && path === "/api/knowledge/clear") {
        return send(res, await knowledgeRoutes.handlePostClear(ctx));
      }

      // ── Strategy DAG ────────────────────────────────────────────────
      if (method === "GET" && path === "/api/strategy/dag") {
        const taskType = (url.searchParams.get("type") || "research") as any;
        const outputFormat = (url.searchParams.get("format") || "markdown") as any;
        const intent = resolveTaskIntent({ goal: "", taskType, outputFormat, attachments: [] });
        const dag = buildExecutionDAG(intent);
        const format = url.searchParams.get("viz");
        if (format === "mermaid") {
          return send(res, { status: 200, data: { mermaid: toMermaid(dag) } });
        }
        return send(res, { status: 200, data: dag });
      }

      // ── Agents (Multi-Agent Collaboration) ──────────────────────────
      if (method === "GET" && path === "/api/agents") {
        return send(res, { status: 200, data: await agentRoutes.handleGetAgents(ctx) });
      }
      if (method === "GET" && path === "/api/agents/context-bus") {
        return send(res, { status: 200, data: await agentRoutes.handleGetContextBus(ctx) });
      }
      if (method === "GET" && path === "/api/agents/delegations") {
        return send(res, { status: 200, data: await agentRoutes.handleGetDelegations(ctx) });
      }

      // ── ComfyUI Templates ──────────────────────────────────────────
      if (method === "GET" && path === "/api/comfyui/templates") {
        const { listTemplates, searchTemplates, getTemplate } = await import("./tools/comfyui-templates.js");
        const q = url.searchParams.get("q");
        if (q) return send(res, { status: 200, data: searchTemplates(q).map(s => ({ id: s.id, name: s.name, description: s.description, category: s.category, tags: s.tags, requiredModels: s.requiredModels, params: s.params })) });
        return send(res, { status: 200, data: listTemplates().map(s => ({ id: s.id, name: s.name, description: s.description, category: s.category, tags: s.tags, requiredModels: s.requiredModels, params: s.params })) });
      }

      // ── Social Publishing ──────────────────────────────────────────
      if (method === "GET" && path === "/api/publish/drafts") {
        const platform = url.searchParams.get("platform") as any;
        return send(res, { status: 200, data: await app.publishBridge.listDrafts(platform || undefined) });
      }
      if (method === "POST" && path === "/api/publish/publish") {
        const body = await readJsonBody(req) as { draftId?: string };
        if (!body.draftId) return send(res, { status: 400, data: { error: "draftId required" } });
        const result = await app.publishBridge.publish(body.draftId);
        return send(res, { status: 200, data: result });
      }
      if (method === "POST" && path === "/api/publish/session") {
        const body = await readJsonBody(req) as { platform?: string; cookies?: unknown[]; localStorage?: Record<string, string> };
        if (!body.platform || !body.cookies) return send(res, { status: 400, data: { error: "platform and cookies required" } });
        await app.publishBridge.saveSession(body.platform as any, body.cookies, body.localStorage || {});
        return send(res, { status: 200, data: { saved: true, platform: body.platform } });
      }
      if (method === "GET" && path === "/api/publish/session") {
        const platform = url.searchParams.get("platform") as any;
        if (!platform) return send(res, { status: 400, data: { error: "platform query param required" } });
        const session = await app.publishBridge.getSession(platform);
        return send(res, { status: 200, data: { platform, hasSession: session !== null } });
      }

      // ── Self-Improvement ───────────────────────────────────────────
      if (method === "GET" && path === "/api/self-improve/metrics") {
        return send(res, { status: 200, data: app.selfImprover.getMetrics() });
      }
      if (method === "GET" && path === "/api/self-improve/clusters") {
        return send(res, { status: 200, data: app.selfImprover.getActiveClusters() });
      }
      if (method === "GET" && path === "/api/self-improve/suggestions") {
        return send(res, { status: 200, data: app.selfImprover.getImprovementSuggestions() });
      }
      if (method === "POST" && path === "/api/self-improve/benchmarks") {
        const results = await app.selfImprover.runAllBenchmarks();
        return send(res, { status: 200, data: results });
      }

      // ── External Triggers (Webhook Receiver) ───────────────────────
      if (method === "GET" && path === "/api/triggers") {
        return send(res, { status: 200, data: app.externalTriggers.listTriggers() });
      }
      if (method === "POST" && path === "/api/triggers") {
        const body = await readJsonBody(req) as {
          name?: string; path?: string; secret?: string;
          goalTemplate?: string; taskType?: string; source?: string;
        };
        if (!body.name || !body.path || !body.goalTemplate) {
          return send(res, { status: 400, data: { error: "name, path, goalTemplate required" } });
        }
        const trigger = app.externalTriggers.createTrigger(body as { name: string; path: string; goalTemplate: string; secret?: string; taskType?: string; source?: string });
        return send(res, { status: 201, data: trigger });
      }
      if (method === "DELETE" && path.startsWith("/api/triggers/")) {
        const triggerId = path.slice("/api/triggers/".length);
        const deleted = app.externalTriggers.deleteTrigger(triggerId);
        return send(res, { status: deleted ? 200 : 404, data: { deleted } });
      }
      if (method === "GET" && path.startsWith("/api/triggers/") && path.endsWith("/events")) {
        const triggerId = path.slice("/api/triggers/".length, -"/events".length);
        return send(res, { status: 200, data: app.externalTriggers.getEvents(triggerId) });
      }
      // Dynamic webhook endpoint: /api/hooks/<trigger-path>
      if (method === "POST" && path.startsWith("/api/hooks/")) {
        const hookPath = path.slice("/api/hooks/".length);
        const body = await readJsonBody(req).catch(() => req);
        const clientIp = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
          || req.socket.remoteAddress || "";
        const result = await app.externalTriggers.handleWebhook(
          hookPath,
          req.headers as Record<string, string>,
          body,
          clientIp
        );
        return send(res, {
          status: result.accepted ? 202 : 400,
          data: result
        });
      }

      // ── Static files ────────────────────────────────────────────────
      if (method === "GET" || method === "HEAD") {
        try {
          const file = await serveStaticAsset(webRoot, path);
          res.writeHead(file.status, {
            "content-type": file.type,
            "cache-control": "no-cache, no-store, must-revalidate"
          });
          if (method === "HEAD") {
            res.end();
          } else {
            res.end(file.body);
          }
          return;
        } catch {
          return error(res, 404, "Not found");
        }
      }

      error(res, 405, "method not allowed");
    } catch (err) {
      error(res, 500, err instanceof Error ? err.message : String(err));
    }
  });

  // Handle WebSocket upgrade requests
  server.on("upgrade", (req: IncomingMessage, socket: any, head: Buffer) => {
    wss.handleUpgrade(req, socket, head);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n Port ${port} is already in use.`);
      console.error(`  Run: npx kill-port ${port}`);
      console.error(`  Or set PORT=XXXX to use a different port.\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log(`DaDa UI running at ${url}`);

    // Auto-open browser on Windows
    const noBrowser = process.env.NO_BROWSER === "1";
    if (!noBrowser && process.platform === "win32") {
      exec(`start "" "${url}"`, () => {});
    } else if (!noBrowser) {
      const cmd = process.platform === "darwin" ? "open" : "xdg-open";
      exec(`${cmd} "${url}"`, () => {});
    }
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
