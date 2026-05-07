import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ExecutionStep } from "../core/types.js";

export interface ExperienceRecord {
  taskId: string;
  at: string;
  goal: string;
  summary: string;
  success: boolean;
  toolSequence: string[];
  tags?: string[];
}

export class ExperienceStore {
  constructor(
    private readonly filePath: string,
    private readonly maxRecords: number = 500
  ) {}

  async list(): Promise<ExperienceRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async appendFromTask(params: {
    taskId: string;
    goal: string;
    summary: string;
    success: boolean;
    steps: ExecutionStep[];
  }): Promise<void> {
    const records = await this.list();

    const toolSequence = params.steps
      .filter((step) => step.action === "execute" && step.tool)
      .map((step) => step.tool as string);

    const tags = this.extractTags(params.goal, params.steps);

    records.push({
      taskId: params.taskId,
      at: new Date().toISOString(),
      goal: params.goal,
      summary: params.summary,
      success: params.success,
      toolSequence,
      tags
    });

    const trimmed = records.slice(-this.maxRecords);

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(trimmed, null, 2), "utf8");
  }

  private extractTags(goal: string, steps: ExecutionStep[]): string[] {
    const tags: string[] = [];

    const keywords: Record<string, string> = {
      file: "file-ops",
      write: "file-ops",
      read: "file-ops",
      文件: "file-ops",
      读取: "file-ops",
      写入: "file-ops",
      code: "coding",
      代码: "coding",
      test: "testing",
      测试: "testing",
      bug: "debugging",
      fix: "debugging",
      修复: "debugging",
      排查: "debugging",
      search: "web",
      fetch: "web",
      搜索: "web",
      网页: "web",
      api: "api",
      接口: "api",
      模型: "models",
      自我提升: "self-improvement",
      自优化: "self-improvement",
      improve: "self-improvement",
      install: "dependencies",
      npm: "dependencies",
      git: "version-control"
    };

    const goalLower = goal.toLowerCase();
    for (const [keyword, tag] of Object.entries(keywords)) {
      if (goalLower.includes(keyword.toLowerCase())) {
        tags.push(tag);
      }
    }

    const usedTools = new Set(
      steps.filter((step) => step.action === "execute" && step.tool).map((step) => step.tool!)
    );
    if (usedTools.has("code.exec") || usedTools.has("shell.exec")) {
      tags.push("execution");
    }
    if (usedTools.has("code.self_improve")) {
      tags.push("self-improvement");
    }
    if (usedTools.has("model")) {
      tags.push("models");
    }

    return [...new Set(tags)];
  }

  async search(query: string): Promise<ExperienceRecord[]> {
    const records = await this.list();
    const queryLower = query.toLowerCase();

    return records.filter(
      (record) =>
        record.goal.toLowerCase().includes(queryLower) ||
        record.summary.toLowerCase().includes(queryLower) ||
        record.tags?.some((tag) => tag.toLowerCase().includes(queryLower))
    );
  }

  async getBySuccess(success: boolean): Promise<ExperienceRecord[]> {
    const records = await this.list();
    return records.filter((record) => record.success === success);
  }

  async getStats(): Promise<{
    total: number;
    success: number;
    failed: number;
    successRate: number;
    tags: Record<string, number>;
  }> {
    const records = await this.list();
    const tags: Record<string, number> = {};

    let success = 0;
    let failed = 0;

    for (const record of records) {
      if (record.success) success++;
      else failed++;

      for (const tag of record.tags || []) {
        tags[tag] = (tags[tag] || 0) + 1;
      }
    }

    return {
      total: records.length,
      success,
      failed,
      successRate: records.length > 0 ? Number((success / records.length).toFixed(4)) : 0,
      tags
    };
  }
}
