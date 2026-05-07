import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { GenerativeMediaInput, GenerativeMediaOutput } from "../tools/builtin/generative-media-tool.js";

export type MediaJobStatus = "queued" | "running" | "completed" | "failed";

export interface MediaJobRecord {
  id: string;
  action: GenerativeMediaInput["action"];
  prompt?: string;
  text?: string;
  provider?: string;
  promptId?: string;
  status: MediaJobStatus;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  file?: string;
  files?: string[];
  url?: string;
  error?: string;
  result?: GenerativeMediaOutput;
}

export class MediaJobStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<MediaJobRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((item) => this.normalize(item)) : [];
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<MediaJobRecord | undefined> {
    const jobs = await this.list();
    return jobs.find((job) => job.id === id);
  }

  async create(input: Pick<MediaJobRecord, "action" | "prompt" | "text">): Promise<MediaJobRecord> {
    const jobs = await this.list();
    const now = new Date().toISOString();
    const job: MediaJobRecord = {
      id: randomUUID(),
      action: input.action,
      prompt: input.prompt,
      text: input.text,
      status: "queued",
      createdAt: now,
      updatedAt: now
    };
    jobs.push(job);
    await this.save(jobs);
    return job;
  }

  async markRunning(id: string): Promise<MediaJobRecord | null> {
    return this.update(id, (job) => {
      job.status = "running";
      job.error = undefined;
    });
  }

  async markCompleted(id: string, result: GenerativeMediaOutput): Promise<MediaJobRecord | null> {
    return this.update(id, (job) => {
      job.status = result.success ? "completed" : "failed";
      job.completedAt = new Date().toISOString();
      job.provider = result.provider;
      job.promptId = result.promptId;
      job.file = result.file;
      job.files = result.files;
      job.url = result.url;
      job.error = result.error;
      job.result = result;
    });
  }

  async markFailed(id: string, error: string): Promise<MediaJobRecord | null> {
    return this.update(id, (job) => {
      job.status = "failed";
      job.completedAt = new Date().toISOString();
      job.error = error;
    });
  }

  private async update(id: string, mutate: (job: MediaJobRecord) => void): Promise<MediaJobRecord | null> {
    const jobs = await this.list();
    const job = jobs.find((item) => item.id === id);
    if (!job) {
      return null;
    }
    mutate(job);
    job.updatedAt = new Date().toISOString();
    await this.save(jobs);
    return job;
  }

  private async save(jobs: MediaJobRecord[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(jobs, null, 2), "utf8");
  }

  private normalize(item: Partial<MediaJobRecord>): MediaJobRecord {
    const now = new Date().toISOString();
    return {
      id: item.id ?? randomUUID(),
      action: item.action ?? "image",
      prompt: item.prompt,
      text: item.text,
      provider: item.provider,
      promptId: item.promptId,
      status: item.status ?? "queued",
      createdAt: item.createdAt ?? now,
      updatedAt: item.updatedAt ?? item.createdAt ?? now,
      completedAt: item.completedAt,
      file: item.file,
      files: item.files,
      url: item.url,
      error: item.error,
      result: item.result
    };
  }
}
