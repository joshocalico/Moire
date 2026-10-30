/** A manual clock for idle smokes: timers fire only when the test advances time. */
import type { IdleTimers } from "./idle-policy";

export class FakeClock implements IdleTimers {
  private time = 0;
  private nextId = 0;
  private readonly timers = new Map<number, { at: number; run: () => void }>();
  now(): number {
    return this.time;
  }
  schedule(delayMs: number, run: () => void): () => void {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + Math.max(0, delayMs), run });
    return () => this.timers.delete(id);
  }
  get pending(): number {
    return this.timers.size;
  }
  /** Advance, firing due timers in time order (timers scheduled while firing included). */
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      let due: [number, { at: number; run: () => void }] | null = null;
      for (const entry of this.timers)
        if (entry[1].at <= end && (!due || entry[1].at < due[1].at)) due = entry;
      if (!due) break;
      this.timers.delete(due[0]);
      this.time = due[1].at;
      due[1].run();
    }
    this.time = end;
  }
}
