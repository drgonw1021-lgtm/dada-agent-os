import { AutomationRegistry, type AutomationRecord } from "./automation-registry.js";

export interface AutomationRunnerOptions {
  pollMs?: number;
}

export class AutomationRunner {
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly registry: AutomationRegistry,
    private readonly enqueue: (automation: AutomationRecord) => Promise<void>,
    private readonly options: AutomationRunnerOptions = {}
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }

    const pollMs = Math.max(5_000, this.options.pollMs ?? 30_000);
    this.timer = setInterval(() => {
      void this.tick();
    }, pollMs);
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(nowIso: string = new Date().toISOString()): Promise<number> {
    if (this.ticking) {
      return 0;
    }

    this.ticking = true;
    let triggered = 0;
    try {
      const items = await this.registry.list();
      const dueItems = items.filter(
        (item) =>
          item.enabled &&
          item.type === "interval" &&
          item.nextRunAt &&
          item.nextRunAt <= nowIso
      );

      for (const item of dueItems) {
        await this.registry.markRun(item.id, nowIso);
        await this.enqueue(item);
        triggered += 1;
      }
    } finally {
      this.ticking = false;
    }

    return triggered;
  }
}
