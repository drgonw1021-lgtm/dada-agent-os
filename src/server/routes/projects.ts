import type { IncomingMessage } from "node:http";
import { readJsonBody, type ServerContext } from "../util.js";
import { ProjectStore } from "./project-store.js";

let _store: ProjectStore;

function store(): ProjectStore {
  if (!_store) {
    _store = new ProjectStore("./.agent/projects.json");
  }
  return _store;
}

export async function handleGetProjects(_ctx: ServerContext) {
  const projects = await store().list();
  return { projects };
}

export async function handlePostProjects(
  _ctx: ServerContext,
  req: IncomingMessage
) {
  const body = (await readJsonBody(req)) as {
    name?: string;
    description?: string;
    directoryPath?: string;
  };
  const name = body.name?.trim();
  if (!name) {
    return { status: 400, data: { error: "name is required" } };
  }
  const project = await store().create({
    name,
    description: (body.description ?? "").trim(),
    directoryPath: (body.directoryPath ?? "").trim()
  });
  return { status: 201, data: { project } };
}

export async function handleGetProject(ctx: ServerContext, id: string) {
  const project = await store().get(id);
  if (!project) {
    return { status: 404, data: { error: "project not found" } };
  }
  return { status: 200, data: { project } };
}

export async function handleDeleteProject(_ctx: ServerContext, id: string) {
  const deleted = await store().delete(id);
  if (!deleted) {
    return { status: 404, data: { error: "project not found" } };
  }
  return { status: 200, data: { deleted: true } };
}

export async function handleGetProjectTasks(ctx: ServerContext, id: string) {
  const project = await store().get(id);
  if (!project) {
    return { status: 404, data: { error: "project not found" } };
  }
  const tasks = await ctx.taskStore.list();
  const projectTasks = tasks.filter((t) => (t as any).projectId === id);
  return { status: 200, data: { project, tasks: projectTasks } };
}
