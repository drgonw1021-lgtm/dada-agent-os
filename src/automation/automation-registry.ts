import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface AutomationRecord {
  id: string;
  name: string;
  goal: string;
  type: "manual" | "interval";
  intervalMinutes?: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
}

export interface CreateAutomationInput {
  name: string;
  goal: string;
  type?: "manual" | "interval";
  intervalMinutes?: number;
}

export class AutomationRegistry {
  constructor(private readonly filePath: string) {}

  async list(): Promise<AutomationRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<AutomationRecord | undefined> {
    const items = await this.list();
    return items.find((item) => item.id === id);
  }

  async create(input: CreateAutomationInput): Promise<AutomationRecord> {
    const items = await this.list();
    const now = new Date().toISOString();
    const type = input.type ?? (input.intervalMinutes ? "interval" : "manual");

    const record: AutomationRecord = {
      id: `automation_${Date.now()}`,
      name: input.name.trim(),
      goal: input.goal.trim(),
      type,
      intervalMinutes: type === "interval" ? input.intervalMinutes ?? 60 : undefined,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      nextRunAt: type === "interval" ? this.computeNextRun(now, input.intervalMinutes ?? 60) : undefined
    };

    items.push(record);
    await this.save(items);
    return record;
  }

  async remove(id: string): Promise<boolean> {
    const items = await this.list();
    const nextItems = items.filter((item) => item.id !== id);
    if (nextItems.length === items.length) {
      return false;
    }

    await this.save(nextItems);
    return true;
  }

  async setEnabled(id: string, enabled: boolean): Promise<AutomationRecord | null> {
    const items = await this.list();
    const item = items.find((entry) => entry.id === id);
    if (!item) {
      return null;
    }

    item.enabled = enabled;
    item.updatedAt = new Date().toISOString();
    if (item.type === "interval" && enabled) {
      item.nextRunAt = this.computeNextRun(item.lastRunAt ?? item.updatedAt, item.intervalMinutes ?? 60);
    }

    await this.save(items);
    return item;
  }

  async markRun(id: string, at: string = new Date().toISOString()): Promise<AutomationRecord | null> {
    const items = await this.list();
    const item = items.find((entry) => entry.id === id);
    if (!item) {
      return null;
    }

    item.lastRunAt = at;
    item.updatedAt = at;
    item.nextRunAt =
      item.type === "interval" && item.enabled
        ? this.computeNextRun(at, item.intervalMinutes ?? 60)
        : undefined;

    await this.save(items);
    return item;
  }

  async getStats(): Promise<{
    total: number;
    enabled: number;
    interval: number;
    manual: number;
  }> {
    const items = await this.list();
    return {
      total: items.length,
      enabled: items.filter((item) => item.enabled).length,
      interval: items.filter((item) => item.type === "interval").length,
      manual: items.filter((item) => item.type === "manual").length
    };
  }

  private computeNextRun(baseIso: string, intervalMinutes: number): string {
    return new Date(new Date(baseIso).getTime() + intervalMinutes * 60_000).toISOString();
  }

  private async save(items: AutomationRecord[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(items, null, 2), "utf8");
  }
}
