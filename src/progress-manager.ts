import { EventEmitter } from "node:events";

export interface ProgressEvent {
  type: string;
  payload?: any;
  at?: string;
}

const MAX_BUFFER = 50;

export class ProgressManager {
  private emitter = new EventEmitter();
  private buffer = new Map<string, ProgressEvent[]>();

  attach(taskId: string, listener: (ev: ProgressEvent) => void) {
    this.emitter.on(`progress:${taskId}`, listener);
  }

  detach(taskId: string, listener: (ev: ProgressEvent) => void) {
    this.emitter.off(`progress:${taskId}`, listener);
  }

  emit(taskId: string, event: ProgressEvent) {
    const ev = { ...event, at: event.at || new Date().toISOString() };
    if (!this.buffer.has(taskId)) {
      this.buffer.set(taskId, []);
    }
    const buf = this.buffer.get(taskId)!;
    buf.push(ev);
    if (buf.length > MAX_BUFFER) buf.shift();
    this.emitter.emit(`progress:${taskId}`, ev);
    this.emitter.emit("progress:*", taskId, ev);
  }

  getHistory(taskId: string): ProgressEvent[] {
    return this.buffer.get(taskId) || [];
  }

  onAll(listener: (taskId: string, ev: ProgressEvent) => void): void {
    this.emitter.on("progress:*", listener);
  }

  // Override emit to also fire wildcard event
}

export default ProgressManager;
