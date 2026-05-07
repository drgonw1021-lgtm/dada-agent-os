import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExecutionStep } from "../core/types.js";

export interface MemoryRecord {
  id: string;
  type: "long_term" | "short_term" | "ephemeral";
  content: string;
  timestamp: string;
  tags?: string[];
  importance?: number;
}

export interface ExperienceRecord {
  taskId: string;
  at: string;
  goal: string;
  summary: string;
  success: boolean;
  toolSequence: string[];
}

export class MemorySystem {
  private readonly memoryDir: string;
  private readonly maxEphemeralAge: number;

  constructor(memoryDir: string = "./.agent/memory", maxEphemeralAge: number = 24 * 60 * 60 * 1000) {
    this.memoryDir = memoryDir;
    this.maxEphemeralAge = maxEphemeralAge;
  }

  async initialize(): Promise<void> {
    await mkdir(this.memoryDir, { recursive: true });
    await mkdir(join(this.memoryDir, "long_term"), { recursive: true });
    await mkdir(join(this.memoryDir, "short_term"), { recursive: true });
    await mkdir(join(this.memoryDir, "ephemeral"), { recursive: true });
  }

  async addMemory(
    content: string,
    type: MemoryRecord["type"] = "short_term",
    tags: string[] = []
  ): Promise<string> {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const record: MemoryRecord = {
      id,
      type,
      content,
      timestamp: new Date().toISOString(),
      tags,
      importance: this.calculateImportance(content)
    };

    const dir = join(this.memoryDir, type);
    await writeFile(
      join(dir, `${id}.json`),
      JSON.stringify(record, null, 2),
      "utf8"
    );

    return id;
  }

  private calculateImportance(content: string): number {
    const importantKeywords = ["error", "fix", "important", "critical", "solution", "成功", "失败"];
    let score = 5;
    for (const kw of importantKeywords) {
      if (content.toLowerCase().includes(kw)) {
        score += 2;
      }
    }
    return Math.min(score, 10);
  }

  async searchMemories(query: string, type?: MemoryRecord["type"]): Promise<MemoryRecord[]> {
    const results: MemoryRecord[] = [];
    const types = type ? [type] : ["long_term", "short_term", "ephemeral"];

    for (const t of types) {
      const dir = join(this.memoryDir, t);
      try {
        const files = await readdir(dir);
        for (const file of files) {
          if (!file.endsWith(".json")) continue;
          try {
            const content = await readFile(join(dir, file), "utf8");
            const record = JSON.parse(content) as MemoryRecord;
            if (
              record.content.toLowerCase().includes(query.toLowerCase()) ||
              record.tags?.some((tag) => tag.toLowerCase().includes(query.toLowerCase()))
            ) {
              results.push(record);
            }
          } catch {
            // Skip invalid files
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }

    return results.sort((a, b) => (b.importance || 0) - (a.importance || 0));
  }

  async getRelevantMemories(context: string, limit: number = 5): Promise<string> {
    const memories = await this.searchMemories(context);

    if (memories.length === 0) {
      return "";
    }

    return memories
      .slice(0, limit)
      .map((m) => `[${m.type}] ${m.content}`)
      .join("\n");
  }

  async consolidateMemories(): Promise<void> {
    const now = Date.now();
    const shortTermDir = join(this.memoryDir, "short_term");
    const longTermDir = join(this.memoryDir, "long_term");
    const ephemeralDir = join(this.memoryDir, "ephemeral");

    try {
      const shortTermFiles = await readdir(shortTermDir);
      for (const file of shortTermFiles) {
        try {
          const content = await readFile(join(shortTermDir, file), "utf8");
          const record = JSON.parse(content) as MemoryRecord;

          if (record.importance && record.importance >= 7) {
            await writeFile(
              join(longTermDir, file),
              JSON.stringify({ ...record, type: "long_term" }, null, 2),
              "utf8"
            );
          }
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Directory doesn't exist
    }

    try {
      const ephemeralFiles = await readdir(ephemeralDir);
      for (const file of ephemeralFiles) {
        try {
          const content = await readFile(join(ephemeralDir, file), "utf8");
          const record = JSON.parse(content) as MemoryRecord;
          const age = now - new Date(record.timestamp).getTime();

          if (age > this.maxEphemeralAge) {
            const { unlink } = await import("node:fs/promises");
            await unlink(join(ephemeralDir, file));
          }
        } catch {
          // Skip invalid files
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  async getStats(): Promise<{
    longTerm: number;
    shortTerm: number;
    ephemeral: number;
  }> {
    const stats = { longTerm: 0, shortTerm: 0, ephemeral: 0 };
    const types: Array<keyof typeof stats> = ["longTerm", "shortTerm", "ephemeral"];

    for (const t of types) {
      const dir = join(this.memoryDir, t);
      try {
        const files = await readdir(dir);
        stats[t] = files.filter((f) => f.endsWith(".json")).length;
      } catch {
        // Directory doesn't exist
      }
    }

    return stats;
  }
}