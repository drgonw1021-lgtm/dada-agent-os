import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  directoryPath: string;
  createdAt: string;
}

export interface CreateProjectInput {
  name: string;
  description: string;
  directoryPath: string;
}

export class ProjectStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ProjectRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<ProjectRecord | undefined> {
    const items = await this.list();
    return items.find((p) => p.id === id);
  }

  async create(input: CreateProjectInput): Promise<ProjectRecord> {
    const items = await this.list();
    const record: ProjectRecord = {
      id: randomUUID(),
      name: input.name,
      description: input.description,
      directoryPath: input.directoryPath,
      createdAt: new Date().toISOString()
    };
    items.push(record);
    await this.save(items);
    return record;
  }

  async delete(id: string): Promise<boolean> {
    const items = await this.list();
    const idx = items.findIndex((p) => p.id === id);
    if (idx === -1) return false;
    items.splice(idx, 1);
    await this.save(items);
    return true;
  }

  private async save(items: ProjectRecord[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(items, null, 2), "utf8");
  }
}
