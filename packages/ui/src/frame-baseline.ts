/** Opt-in, per-surface observations. This module performs no I/O or clock reads. */
import type { UiFrameEvent } from "./platform";

export const TRANSFER_OPERATIONS = [
  "dmabufImport",
  "cpuMap",
  "gpuReadback",
  "cpuCopy",
  "textureUpload",
] as const;
export type TransferOperation = (typeof TRANSFER_OPERATIONS)[number];
export type TransferCounter = { count: number; bytes: number };
export type CpuPhase =
  | "submit"
  | "dmabufImport"
  | "cpuMap"
  | "gpuReadback"
  | "cpuCopy"
  | "textureUpload"
  | "completionWait";

export type BaselineIdentity = {
  appId: string;
  clientPid: number;
  surfaceId: number;
  renderer: string;
  transport: string;
  renderNode?: string;
  glVendor?: string;
  glVersion?: string;
  capabilities: readonly string[];
};
export type DurationSummary = {
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  /** Quantiles cover only the bounded recent sample window. */
  recentSampleCount: number;
  recentP50Ms: number;
  recentP95Ms: number;
};

class Durations {
  private count = 0;
  private total = 0;
  private minimum = Number.POSITIVE_INFINITY;
  private maximum = 0;
  private recent: number[] = [];
  add(ms: number): void {
    finiteNonnegative(ms, "duration");
    this.recent[this.count % 256] = ms;
    this.count++;
    this.total += ms;
    this.minimum = Math.min(this.minimum, ms);
    this.maximum = Math.max(this.maximum, ms);
  }
  snapshot(): DurationSummary | null {
    if (this.count === 0) return null;
    const sorted = [...this.recent].sort((a, b) => a - b);
    const percentile = (share: number) => sorted[Math.ceil(sorted.length * share) - 1]!;
    return {
      count: this.count,
      totalMs: this.total,
      minMs: this.minimum,
      maxMs: this.maximum,
      recentSampleCount: sorted.length,
      recentP50Ms: percentile(0.5),
      recentP95Ms: percentile(0.95),
    };
  }
}
function finiteNonnegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be nonnegative`);
}

export type BaselineOptions = {
  enabled: boolean;
  identity: BaselineIdentity;
  /** Declare only boundaries that are actually instrumented; others remain null. */
  measuredTransfers?: readonly TransferOperation[];
  maxTrackedCommits?: number;
};

/** Disabled creation allocates no collector; callers can use optional chaining. */
export function createFrameBaseline(options: BaselineOptions): FrameBaseline | null {
  return options.enabled ? new FrameBaseline(options) : null;
}

export class FrameBaseline {
  private readonly identity: BaselineIdentity;
  private readonly transfers = new Map<TransferOperation, TransferCounter>();
  private readonly cpu = new Map<CpuPhase, Durations>();
  private readonly gpu = new Durations();
  private readonly hold = new Durations();
  private readonly receipt = new Durations();
  private readonly cadence = new Durations();
  private readonly commits = new Map<
    number,
    { submittedAtMs: number; released: boolean; settled: boolean }
  >();
  private readonly limit: number;
  private previousPresentationNs: bigint | null = null;
  private frames = {
    submitted: 0,
    compositorCallbacks: 0,
    presented: 0,
    discarded: 0,
    releases: 0,
  };
  private unmatchedReleases = 0;
  private droppedCommitRecords = 0;
  private invalidPresentationOrder = 0;
  private rejectedGpuQueries = 0;

  constructor(options: BaselineOptions) {
    this.identity = {
      ...options.identity,
      capabilities: [...options.identity.capabilities].sort(),
    };
    this.limit = options.maxTrackedCommits ?? 512;
    if (!Number.isSafeInteger(this.limit) || this.limit < 1)
      throw new RangeError("Invalid commit limit");
    for (const operation of options.measuredTransfers ?? [])
      this.transfers.set(operation, { count: 0, bytes: 0 });
  }

  /**
   * Count completed boundary operations, not attempts/cache hits.
   * Import bytes are referenced extent; map bytes mapped extent, including padding.
   * Copy/upload/readback bytes are the actual payload moved, excluding padding skipped.
   * Import/map do not imply a CPU copy. These categories must never be added together.
   */
  transfer(operation: TransferOperation, bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new RangeError("Invalid transfer byte count");
    const counter = this.transfers.get(operation) ?? { count: 0, bytes: 0 };
    counter.count++;
    counter.bytes += bytes;
    this.transfers.set(operation, counter);
  }

  /** Monotonic CPU-side elapsed call duration, possibly including driver/GPU waits. */
  cpuElapsed(phase: CpuPhase, milliseconds: number): void {
    const durations = this.cpu.get(phase) ?? new Durations();
    durations.add(milliseconds);
    this.cpu.set(phase, durations);
  }

  /** GPU execution duration requires an actual timer query, never performance.now/glFinish. */
  gpuTimerQuery(sample: {
    source: "gl-timer-query";
    nanoseconds: number;
    disjoint: boolean;
  }): void {
    if (sample.disjoint) {
      this.rejectedGpuQueries++;
      return;
    }
    if (!Number.isSafeInteger(sample.nanoseconds) || sample.nanoseconds < 0)
      throw new RangeError("Invalid GPU timer result");
    this.gpu.add(sample.nanoseconds / 1_000_000);
  }

  observeFrame(event: UiFrameEvent): void {
    switch (event.type) {
      case "submitted": {
        if (this.commits.has(event.commitId)) throw new Error("Duplicate submitted commit");
        finiteNonnegative(event.submittedAtMs, "submission timestamp");
        if (this.commits.size >= this.limit) {
          this.commits.delete(this.commits.keys().next().value!);
          this.droppedCommitRecords++;
        }
        this.commits.set(event.commitId, {
          submittedAtMs: event.submittedAtMs,
          released: event.transport === "headless",
          settled: false,
        });
        this.frames.submitted++;
        break;
      }
      case "compositor-frame":
        this.frames.compositorCallbacks++;
        break;
      case "presented": {
        this.frames.presented++;
        const commit = this.commits.get(event.commitId);
        if (commit && event.receivedAtMs >= commit.submittedAtMs)
          this.receipt.add(event.receivedAtMs - commit.submittedAtMs);
        if (this.previousPresentationNs !== null) {
          const interval = event.timestampNs - this.previousPresentationNs;
          if (interval > 0n && interval <= BigInt(Number.MAX_SAFE_INTEGER))
            this.cadence.add(Number(interval) / 1_000_000);
          else this.invalidPresentationOrder++;
        }
        if (this.previousPresentationNs === null || event.timestampNs > this.previousPresentationNs)
          this.previousPresentationNs = event.timestampNs;
        this.settle(event.commitId);
        break;
      }
      case "discarded":
        this.frames.discarded++;
        this.settle(event.commitId);
        break;
      case "buffer-release": {
        this.frames.releases++;
        const commit = this.commits.get(event.commitId);
        if (!commit || commit.released || event.receivedAtMs < commit.submittedAtMs) {
          this.unmatchedReleases++;
          break;
        }
        this.hold.add(event.receivedAtMs - commit.submittedAtMs);
        commit.released = true;
        if (commit.settled) this.commits.delete(event.commitId);
        break;
      }
    }
  }

  private settle(commitId: number): void {
    const commit = this.commits.get(commitId);
    if (!commit) return;
    commit.settled = true;
    if (commit.released) this.commits.delete(commitId);
  }

  snapshot() {
    return {
      schema: "moire.frame-baseline.v1" as const,
      identity: { ...this.identity, capabilities: [...this.identity.capabilities] },
      transfers: Object.fromEntries(
        TRANSFER_OPERATIONS.map((operation) => [
          operation,
          this.transfers.has(operation) ? { ...this.transfers.get(operation)! } : null,
        ]),
      ),
      cpuElapsedMs: Object.fromEntries(
        [...this.cpu].map(([phase, durations]) => [phase, durations.snapshot()]),
      ),
      gpuExecutionMs: this.gpu.snapshot(),
      rejectedGpuQueries: this.rejectedGpuQueries,
      frames: { ...this.frames },
      /** Receipt latency and hold time use client monotonic time; neither is GPU duration. */
      presentationReceiptLatencyMs: this.receipt.snapshot(),
      /** Differences within wp_presentation's clock, never mixed with performance.now. */
      presentationCadenceMs: this.cadence.snapshot(),
      bufferHoldMs: this.hold.snapshot(),
      trackedHeldCommits: [...this.commits.values()].filter((commit) => !commit.released).length,
      unmatchedReleases: this.unmatchedReleases,
      droppedCommitRecords: this.droppedCommitRecords,
      invalidPresentationOrder: this.invalidPresentationOrder,
    };
  }
}

/** JSON-compatible record emitted on demand, rather than on each frame. */
export type FrameBaselineRecord = ReturnType<FrameBaseline["snapshot"]>;
