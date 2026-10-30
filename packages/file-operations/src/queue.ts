/**
 * File operations run here, off the view: one at a time, in order, each
 * with progress and cancellation. Views enqueue intent and render state.
 */
import type { Progress } from "./operations";

export type OperationContext = {
  readonly signal: AbortSignal;
  report(progress: Progress): void;
};

export type OperationRequest<T> = {
  /** Present-tense description while running, e.g. "Moving 3 items to Trash". */
  readonly label: string;
  run(context: OperationContext): Promise<T>;
  /** Past-tense outcome for the toast, e.g. "3 items moved to Trash". */
  done?(value: T): string;
  /** Whether the finished operation can be undone from its toast. */
  undoable?: boolean | ((value: T) => boolean);
};

export type RunningOperation = {
  readonly id: number;
  readonly label: string;
  readonly progress: Progress | null;
  readonly cancelling: boolean;
};

export type OperationOutcome = {
  readonly id: number;
  readonly label: string;
  readonly state: "done" | "cancelled" | "failed";
  readonly message: string;
  readonly undoable: boolean;
};

export type OperationQueueState = {
  readonly running: RunningOperation | null;
  readonly pending: number;
  /** The latest finished operation, until it is dismissed or replaced. */
  readonly outcome: OperationOutcome | null;
};

/** How an enqueued operation ended. Failures are values, never rejections. */
export type OperationResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly cancelled: boolean;
      readonly error: unknown;
    };

type Entry = {
  id: number;
  request: OperationRequest<unknown>;
  controller: AbortController;
  settle(result: OperationResult<unknown>): void;
};

export class OperationCancelledError extends Error {
  override name = "OperationCancelledError";
}

const isCancellation = (error: unknown, signal: AbortSignal) =>
  signal.aborted ||
  (error instanceof Error &&
    (error.name === "TransferCancelledError" ||
      error.name === "OperationCancelledError" ||
      error.name === "AbortError"));

export class OperationQueue {
  private nextId = 1;
  private queue: Entry[] = [];
  private active: Entry | null = null;
  private stateValue: OperationQueueState = {
    running: null,
    pending: 0,
    outcome: null,
  };
  private listeners = new Set<() => void>();

  constructor(private readonly describeError: (error: unknown) => string = String) {}

  get state(): OperationQueueState {
    return this.stateValue;
  }
  get busy(): boolean {
    return this.active !== null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Queue an operation; its outcome is also published for the view. */
  enqueue<T>(request: OperationRequest<T>): Promise<OperationResult<T>> {
    return new Promise((resolve) => {
      const entry: Entry = {
        id: this.nextId++,
        request: request as OperationRequest<unknown>,
        controller: new AbortController(),
        settle: (result) => resolve(result as OperationResult<T>),
      };
      this.queue.push(entry);
      this.publish({ pending: this.queue.length });
      void this.pump();
    });
  }

  /** Cancel the running operation, or a queued one by id. */
  cancel(id = this.active?.id): void {
    const queued = this.queue.findIndex((entry) => entry.id === id);
    if (queued >= 0) {
      const [entry] = this.queue.splice(queued, 1);
      entry!.settle({
        ok: false,
        cancelled: true,
        error: new OperationCancelledError("Cancelled before it started."),
      });
      this.publish({ pending: this.queue.length });
      return;
    }
    if (!this.active || this.active.id !== id) return;
    this.active.controller.abort();
    if (this.stateValue.running)
      this.publish({
        running: { ...this.stateValue.running, cancelling: true },
      });
  }

  dismissOutcome(): void {
    if (this.stateValue.outcome) this.publish({ outcome: null });
  }

  private publish(change: Partial<OperationQueueState>): void {
    this.stateValue = { ...this.stateValue, ...change };
    // Copied: a listener may unsubscribe while being notified.
    for (const listener of Array.from(this.listeners)) listener();
  }

  private async pump(): Promise<void> {
    if (this.active) return;
    const entry = this.queue.shift();
    if (!entry) return;
    this.active = entry;
    const { request, controller } = entry;
    this.publish({
      pending: this.queue.length,
      running: {
        id: entry.id,
        label: request.label,
        progress: null,
        cancelling: false,
      },
    });
    try {
      const value = await request.run({
        signal: controller.signal,
        report: (progress) => {
          if (this.active === entry && this.stateValue.running)
            this.publish({ running: { ...this.stateValue.running, progress } });
        },
      });
      const undoable =
        typeof request.undoable === "function" ? request.undoable(value) : !!request.undoable;
      this.finish({
        id: entry.id,
        label: request.label,
        state: "done",
        message: request.done?.(value) ?? `${request.label} finished`,
        undoable,
      });
      entry.settle({ ok: true, value });
    } catch (error) {
      const cancelled = isCancellation(error, controller.signal);
      this.finish({
        id: entry.id,
        label: request.label,
        state: cancelled ? "cancelled" : "failed",
        message: cancelled ? `${request.label} cancelled` : this.describeError(error),
        undoable: false,
      });
      entry.settle({ ok: false, cancelled, error });
    }
  }

  private finish(outcome: OperationOutcome): void {
    this.active = null;
    this.publish({ running: null, outcome });
    void this.pump();
  }
}
