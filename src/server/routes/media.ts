import type { IncomingMessage } from "node:http";
import { readJsonBody, type ServerContext } from "../util.js";
import {
  createGenerativeMediaTool,
  type GenerativeMediaInput
} from "../../tools/builtin/generative-media-tool.js";

async function executeMediaJob(ctx: ServerContext, input: GenerativeMediaInput) {
  const { app, mediaJobStore } = ctx;
  const job = await mediaJobStore.create({
    action: input.action,
    prompt: input.prompt,
    text: input.text
  });
  await mediaJobStore.markRunning(job.id);

  try {
    const mediaTool = createGenerativeMediaTool({
      comfyuiEndpoint: app.config.comfyuiEndpoint,
      openaiApiKey: app.config.cloudApiKey,
      openaiImageModel: app.config.openaiImageModel,
      openaiTtsModel: app.config.openaiTtsModel,
      openaiTtsVoice: app.config.openaiTtsVoice,
      outputDir: app.config.generatedMediaDir
    });
    const result = await mediaTool.execute(input, {
      now: new Date(),
      taskId: job.id,
      taskLineageId: job.id,
      goal: input.prompt ?? input.text
    });
    const updated = await mediaJobStore.markCompleted(job.id, result);
    return { job: updated ?? job, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = await mediaJobStore.markFailed(job.id, message);
    return {
      job: updated ?? job,
      result: { success: false, action: input.action, error: message }
    };
  }
}

export async function handleGetMediaJobs(ctx: ServerContext, id?: string) {
  if (id) {
    const job = await ctx.mediaJobStore.get(id);
    if (!job) {
      return { status: 404, data: { error: "media job not found" } };
    }
    return { status: 200, data: { job } };
  }
  const jobs = await ctx.mediaJobStore.list();
  return { status: 200, data: { jobs } };
}

export async function handlePostMediaGenerate(
  ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as Partial<GenerativeMediaInput>;
  const action = body.action;
  if (!action || !["image", "video", "speech", "comfy_workflow"].includes(action)) {
    return { status: 400, data: { error: "action must be image, video, speech or comfy_workflow" } };
  }
  if ((action === "image" || action === "speech") && !body.prompt && !body.text && !body.workflow) {
    return { status: 400, data: { error: "prompt, text or workflow is required" } };
  }
  if ((action === "video" || action === "comfy_workflow") && !body.workflow) {
    return { status: 400, data: { error: "workflow is required for video and comfy_workflow actions" } };
  }

  const output = await executeMediaJob(ctx, {
    action,
    prompt: body.prompt,
    text: body.text,
    outputPath: body.outputPath,
    workflow: body.workflow,
    wait: body.wait === true,
    options: body.options
  });
  return { status: output.result.success ? 201 : 502, data: output };
}
