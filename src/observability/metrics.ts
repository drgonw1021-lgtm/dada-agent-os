// In-memory metrics collector — zero dependencies, minimal overhead.
// Resets on restart; not persisted to disk.

interface RequestRecord {
  path: string;
  method: string;
  statusCode: number;
  durationMs: number;
}

export interface MetricsSnapshot {
  uptimeMs: number;
  requests: {
    total: number;
    avgDurationMs: number;
    p95DurationMs: number;
    byPath: Record<string, number>;
  };
  errors: {
    count4xx: number;
    count5xx: number;
    rate5xx: number;
  };
  activeTaskCount: number;
}

class MetricsCollector {
  private startTime = Date.now();
  private totalRequests = 0;
  private totalDurationMs = 0;
  private count4xx = 0;
  private count5xx = 0;
  private byPath = new Map<string, number>();
  private durations: number[] = []; // ring buffer, last 1000

  recordRequest(method: string, path: string, statusCode: number, durationMs: number): void {
    this.totalRequests++;
    this.totalDurationMs += durationMs;
    if (statusCode >= 400 && statusCode < 500) this.count4xx++;
    if (statusCode >= 500) this.count5xx++;

    const key = `${method} ${path}`;
    this.byPath.set(key, (this.byPath.get(key) || 0) + 1);

    this.durations.push(durationMs);
    if (this.durations.length > 1000) this.durations.splice(0, 100);
  }

  getSnapshot(): MetricsSnapshot {
    const avgDurationMs = this.totalRequests > 0
      ? Math.round(this.totalDurationMs / this.totalRequests)
      : 0;

    const sorted = [...this.durations].sort((a, b) => a - b);
    const p95DurationMs = sorted.length > 0
      ? sorted[Math.floor(sorted.length * 0.95)]!
      : 0;

    const rate5xx = this.totalRequests > 0
      ? Math.round((this.count5xx / this.totalRequests) * 10000) / 10000
      : 0;

    const byPath: Record<string, number> = {};
    for (const [k, v] of this.byPath) byPath[k] = v;

    return {
      uptimeMs: Date.now() - this.startTime,
      requests: { total: this.totalRequests, avgDurationMs, p95DurationMs, byPath },
      errors: { count4xx: this.count4xx, count5xx: this.count5xx, rate5xx },
      activeTaskCount: 0 // updated externally
    };
  }
}

export const metrics = new MetricsCollector();
