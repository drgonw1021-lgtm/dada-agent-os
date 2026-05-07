import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface WorkflowResultRecord {
  id: string;
  domain: string;
  goal: string;
  taskId: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  steps: {
    id: string;
    name: string;
    success: boolean;
    output?: any;
    error?: string;
  }[];
  summary: string;
}

export class WorkflowResultStore {
  private baseDir: string;

  constructor(baseDir: string = "./.agent/workflows") {
    this.baseDir = baseDir;
  }

  private async ensureDir() {
    if (!existsSync(this.baseDir)) {
      await mkdir(this.baseDir, { recursive: true });
    }
  }

  async save(result: WorkflowResultRecord): Promise<string> {
    await this.ensureDir();
    const filename = `${result.taskId}.json`;
    const filepath = join(this.baseDir, filename);
    await writeFile(filepath, JSON.stringify(result, null, 2), "utf-8");
    return filepath;
  }

  async list(): Promise<WorkflowResultRecord[]> {
    const { readdir, readFile } = await import("node:fs/promises");
    try {
      await this.ensureDir();
      const files = await readdir(this.baseDir);
      const results: WorkflowResultRecord[] = [];
      for (const file of files) {
        if (file.endsWith(".json")) {
          try {
            const content = await readFile(join(this.baseDir, file), "utf-8");
            results.push(JSON.parse(content));
          } catch {
            // Skip invalid files
          }
        }
      }
      return results.sort((a, b) => 
        new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime()
      );
    } catch {
      return [];
    }
  }

  async get(taskId: string): Promise<WorkflowResultRecord | null> {
    const { readFile } = await import("node:fs/promises");
    try {
      const filepath = join(this.baseDir, `${taskId}.json`);
      const content = await readFile(filepath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }
}

export const workflowResultStore = new WorkflowResultStore();
