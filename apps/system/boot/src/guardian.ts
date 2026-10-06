import type { ChildProcess } from "node:child_process";
import type { KmsPresentationFeedback, ManagedBootConsole } from "@moire/sys";

export type ReleaseReason =
  | "escape"
  | "stage-complete"
  | "service-stop"
  | "renderer-failure"
  | "input-unavailable";

/** Owned by the guardian process, never the renderer's event loop. */
export interface RecoveryConsole {
  enterGraphics(): void;
  restore(): void;
  close(): void;
}

export type GuardianResult =
  | { kind: "released"; reason: ReleaseReason; forced: boolean }
  | { kind: "renderer-exited"; reason: ReleaseReason; forced: boolean }
  | { kind: "failed"; reason: ReleaseReason; forced: boolean; errors: readonly Error[] };

export type GuardianOptions = {
  console: RecoveryConsole | ManagedBootConsole;
  /** Must fail if no verified recovery input is available. */
  observeEscape(handler: () => void): () => void;
  /** A fresh child process group, containing only the boot renderer. */
  startRenderer(): ChildProcess;
  /** Process-signal boundary injection for termination failure regression. */
  signalRenderer?: (child: ChildProcess, signal: NodeJS.Signals) => void;
  onScanoutAccepted?: (feedback: KmsPresentationFeedback) => void;
  onEscape?: () => void;
  onDiagnostic?: (error: Error) => void;
  gracefulMs?: number;
  hardStopMs?: number;
};

function errorOf(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function scanoutFeedback(message: unknown): KmsPresentationFeedback | null {
  if (
    typeof message !== "object" ||
    message === null ||
    !("kind" in message) ||
    message.kind !== "scanout-accepted" ||
    !("feedback" in message)
  )
    return null;
  const feedback = message.feedback;
  if (
    typeof feedback !== "object" ||
    feedback === null ||
    !("sequence" in feedback) ||
    typeof feedback.sequence !== "number" ||
    !Number.isInteger(feedback.sequence) ||
    feedback.sequence < 0 ||
    !("seconds" in feedback) ||
    typeof feedback.seconds !== "number" ||
    !Number.isInteger(feedback.seconds) ||
    feedback.seconds < 0 ||
    !("nanoseconds" in feedback) ||
    typeof feedback.nanoseconds !== "number" ||
    !Number.isInteger(feedback.nanoseconds) ||
    feedback.nanoseconds < 0 ||
    feedback.nanoseconds >= 1_000_000_000 ||
    !("vsync" in feedback) ||
    typeof feedback.vsync !== "boolean" ||
    !("hardwareClock" in feedback) ||
    typeof feedback.hardwareClock !== "boolean" ||
    !("hardwareCompletion" in feedback) ||
    typeof feedback.hardwareCompletion !== "boolean"
  )
    return null;
  return {
    sequence: feedback.sequence,
    seconds: feedback.seconds,
    nanoseconds: feedback.nanoseconds,
    vsync: feedback.vsync,
    hardwareClock: feedback.hardwareClock,
    hardwareCompletion: feedback.hardwareCompletion,
  };
}

/** One renderer. Managed mode delegates display restoration to external cleanup. */
export class BootGuardian {
  private state:
    | "waiting"
    | "presenting"
    | "releasing"
    | "termination-failed"
    | "released"
    | "renderer-exited" = "waiting";
  private child: ChildProcess | null = null;
  private removeEscape: (() => void) | null = null;
  private reason: ReleaseReason = "renderer-failure";
  private forced = false;
  private firstFrame = false;
  private readonly errors: Error[] = [];
  private gracefulTimer: ReturnType<typeof setTimeout> | null = null;
  private hardTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly complete: (result: GuardianResult) => void;
  readonly result: Promise<GuardianResult>;
  get phase() {
    return this.state;
  }

  constructor(private readonly options: GuardianOptions) {
    const gracefulMs = options.gracefulMs ?? 100;
    const hardMs = options.hardStopMs ?? 1000;
    if (
      !Number.isFinite(gracefulMs) ||
      gracefulMs < 0 ||
      !Number.isFinite(hardMs) ||
      hardMs <= gracefulMs
    )
      throw new Error("Invalid boot release deadlines");
    let resolveResult: (result: GuardianResult) => void = () => {};
    this.result = new Promise((resolve) => {
      resolveResult = resolve;
    });
    this.complete = resolveResult;
  }

  start(): void {
    if (this.state !== "waiting") return;
    try {
      this.removeEscape = this.options.observeEscape(() => {
        if (this.isFinished() || this.state === "releasing" || this.state === "termination-failed")
          return;
        try {
          this.options.onEscape?.();
        } catch (error) {
          this.record(error);
        }
        this.release("escape");
      });
    } catch (error) {
      this.record(error);
      this.release("input-unavailable");
      return;
    }
    // An input source may report Escape synchronously while registering.
    if (this.state !== "waiting") {
      this.removeEscape?.();
      this.removeEscape = null;
      return;
    }
    try {
      this.options.console.enterGraphics();
      if (this.state !== "waiting") return;
      const child = this.options.startRenderer();
      this.child = child;
      this.state = "presenting";
      child.on("message", (message: unknown) => {
        if (this.state !== "presenting") return;
        const feedback = scanoutFeedback(message);
        if (!feedback) {
          this.record(new Error("Invalid boot renderer lifecycle message"));
          this.release("renderer-failure");
          return;
        }
        if (!this.firstFrame) {
          this.firstFrame = true;
          try {
            this.options.onScanoutAccepted?.(feedback);
          } catch (error) {
            this.record(error);
            this.release("renderer-failure");
          }
        }
      });
      child.once("error", (error) => {
        this.record(error);
        this.release("renderer-failure");
      });
      child.once("exit", (code, signal) => {
        if (this.isFinished()) return;
        if (this.state !== "releasing" && this.state !== "termination-failed") {
          this.record(
            new Error(`Boot renderer exited before release (${signal ?? code ?? "unknown"})`),
          );
          this.reason = "renderer-failure";
          this.state = "releasing";
        }
        this.finish();
      });
      // An ENOENT launch has no exit event, but does close its child handle.
      child.once("close", () => {
        if (!child.pid && this.state === "releasing") this.finish();
      });
    } catch (error) {
      this.record(error);
      this.release("renderer-failure");
    }
  }

  release(reason: ReleaseReason): Promise<GuardianResult> {
    if (this.isFinished() || this.state === "releasing" || this.state === "termination-failed")
      return this.result;
    this.reason = reason;
    this.state = "releasing";
    if (!this.child?.pid) {
      this.finish();
      return this.result;
    }
    // SIGTERM is processed by a healthy child immediately. It is not a delay
    // or animation completion requirement. A stalled child gets SIGKILL.
    this.signalChild("SIGTERM");
    this.gracefulTimer = setTimeout(() => {
      this.forced = true;
      this.signalChild("SIGKILL");
    }, this.options.gracefulMs ?? 100);
    this.hardTimer = setTimeout(() => {
      this.forced = true;
      this.signalChild("SIGKILL");
      this.state = "termination-failed";
      this.record(
        new Error(
          "Boot renderer did not exit within the release deadline; display ownership is unconfirmed",
        ),
      );
      // Keep ownership and recovery listeners. A deadline is not evidence that
      // a kernel-stalled child has closed DRM FDs. Managed mode additionally
      // requires external proof for every descendant before restoration.
    }, this.options.hardStopMs ?? 1000);
    return this.result;
  }

  private signalChild(signal: NodeJS.Signals): void {
    const pid = this.child?.pid;
    if (!pid) return;
    try {
      if (this.options.signalRenderer && this.child)
        this.options.signalRenderer(this.child, signal);
      else process.kill(-pid, signal);
    } catch (error) {
      if (
        !(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH")
      )
        this.record(error);
    }
  }

  private record(error: unknown): void {
    const parsed = errorOf(error);
    this.errors.push(parsed);
    this.options.onDiagnostic?.(parsed);
  }

  private isFinished(): boolean {
    return this.state === "released" || this.state === "renderer-exited";
  }

  private finish(): void {
    if (this.isFinished()) return;
    const managed = "closeHandle" in this.options.console;
    this.state = managed ? "renderer-exited" : "released";
    if (this.gracefulTimer) clearTimeout(this.gracefulTimer);
    if (this.hardTimer) clearTimeout(this.hardTimer);
    try {
      this.removeEscape?.();
    } catch (error) {
      this.record(error);
    }
    this.removeEscape = null;
    if ("closeHandle" in this.options.console) {
      try {
        this.options.console.closeHandle();
      } catch (error) {
        this.record(error);
      }
    } else {
      try {
        this.options.console.restore();
      } catch (error) {
        this.record(error);
      }
      try {
        this.options.console.close();
      } catch (error) {
        this.record(error);
      }
    }
    this.complete(
      this.errors.length
        ? { kind: "failed", reason: this.reason, forced: this.forced, errors: this.errors.slice() }
        : {
            kind: managed ? "renderer-exited" : "released",
            reason: this.reason,
            forced: this.forced,
          },
    );
  }
}
