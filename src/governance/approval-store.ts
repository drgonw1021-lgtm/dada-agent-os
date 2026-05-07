import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "used";

export interface ApprovalRecord {
  id: string;
  taskId: string;
  lineageTaskId: string;
  goal?: string;
  toolId: string;
  input: unknown;
  fingerprint: string;
  reason: string;
  status: ApprovalStatus;
  createdAt: string;
  resolvedAt?: string;
  decisionNote?: string;
  consumedAt?: string;
}

export interface CreateApprovalInput {
  taskId: string;
  lineageTaskId: string;
  goal?: string;
  toolId: string;
  input: unknown;
  reason: string;
}

function toFingerprint(toolId: string, input: unknown): string {
  return `${toolId}:${JSON.stringify(input)}`;
}

export class ApprovalStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<ApprovalRecord[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  async get(id: string): Promise<ApprovalRecord | undefined> {
    const items = await this.list();
    return items.find((item) => item.id === id);
  }

  async findUsableApproval(params: {
    lineageTaskId: string;
    toolId: string;
    input: unknown;
  }): Promise<ApprovalRecord | undefined> {
    const items = await this.list();
    const fingerprint = toFingerprint(params.toolId, params.input);
    return items.find(
      (item) =>
        item.lineageTaskId === params.lineageTaskId &&
        item.toolId === params.toolId &&
        item.fingerprint === fingerprint &&
        item.status === "approved"
    );
  }

  async ensurePending(input: CreateApprovalInput): Promise<ApprovalRecord> {
    const items = await this.list();
    const fingerprint = toFingerprint(input.toolId, input.input);
    const existing = items.find(
      (item) =>
        item.lineageTaskId === input.lineageTaskId &&
        item.toolId === input.toolId &&
        item.fingerprint === fingerprint &&
        (item.status === "pending" || item.status === "approved")
    );

    if (existing) {
      return existing;
    }

    const now = new Date().toISOString();
    const record: ApprovalRecord = {
      id: `approval_${Date.now()}`,
      taskId: input.taskId,
      lineageTaskId: input.lineageTaskId,
      goal: input.goal,
      toolId: input.toolId,
      input: input.input,
      fingerprint,
      reason: input.reason,
      status: "pending",
      createdAt: now
    };

    items.push(record);
    await this.save(items);
    return record;
  }

  async approve(id: string, note?: string): Promise<ApprovalRecord | null> {
    return this.update(id, (item) => {
      item.status = "approved";
      item.resolvedAt = new Date().toISOString();
      item.decisionNote = note;
    });
  }

  async reject(id: string, note?: string): Promise<ApprovalRecord | null> {
    return this.update(id, (item) => {
      item.status = "rejected";
      item.resolvedAt = new Date().toISOString();
      item.decisionNote = note;
    });
  }

  async consume(id: string): Promise<ApprovalRecord | null> {
    return this.update(id, (item) => {
      item.status = "used";
      item.consumedAt = new Date().toISOString();
    });
  }

  async getStats(): Promise<{
    total: number;
    pending: number;
    approved: number;
    rejected: number;
    used: number;
  }> {
    const items = await this.list();
    return {
      total: items.length,
      pending: items.filter((item) => item.status === "pending").length,
      approved: items.filter((item) => item.status === "approved").length,
      rejected: items.filter((item) => item.status === "rejected").length,
      used: items.filter((item) => item.status === "used").length
    };
  }

  private async update(id: string, mutate: (item: ApprovalRecord) => void): Promise<ApprovalRecord | null> {
    const items = await this.list();
    const item = items.find((entry) => entry.id === id);
    if (!item) {
      return null;
    }
    mutate(item);
    await this.save(items);
    return item;
  }

  private async save(items: ApprovalRecord[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(items, null, 2), "utf8");
  }
}
