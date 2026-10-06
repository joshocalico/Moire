import type { UiRenderingState } from "#ui/platform";

export type ClientSubmission = Readonly<{
  token: number;
  path: "retained-dmabuf" | "flat-dmabuf" | "retained-readback" | "software";
  execution: "hardware" | "software" | "virtual" | "unknown";
}>;
export type AcceptedRendering =
  | "unknown"
  | "software"
  | "virtual"
  | "retainedUnknown"
  | "hardwareRetained";

/** A successful commit is distinct from drawing, backpressure and frame callbacks. */
export class WindowRenderingTracker {
  private submission: ClientSubmission | null = null;
  private accepted: AcceptedRendering = "unknown";
  private state: UiRenderingState = { kind: "static", reason: "pending" };
  private readonly listeners = new Set<(state: UiRenderingState) => void>();
  private lost = false;
  private closed = false;

  get(): UiRenderingState {
    return this.state;
  }
  subscribe(callback: (state: UiRenderingState) => void): () => void {
    if (!this.closed) this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }
  submitted(submission: ClientSubmission): void {
    if (this.closed) return;
    this.submission = submission;
    this.accepted = "unknown";
    this.update();
  }
  observe(token: number, accepted: AcceptedRendering): boolean {
    if (this.closed || this.lost || token !== this.submission?.token) return false;
    this.accepted = accepted;
    this.update();
    return true;
  }
  backendLost(): void {
    if (this.closed) return;
    this.lost = true;
    this.accepted = "unknown";
    this.update();
  }
  destroy(): void {
    if (this.closed) return;
    this.closed = true;
    this.submission = null;
    this.accepted = "unknown";
    this.publish({ kind: "static", reason: "destroyed" });
    this.listeners.clear();
  }
  private update(): void {
    const s = this.submission;
    const reason = this.lost
      ? "backend-loss"
      : !s
        ? "pending"
        : s.path === "software"
          ? "software"
          : s.path === "flat-dmabuf"
            ? "flat"
            : s.path === "retained-readback"
              ? "readback"
              : s.execution === "software" || this.accepted === "software"
                ? "software"
                : s.execution === "virtual" || this.accepted === "virtual"
                  ? "virtual"
                  : s.execution === "unknown" || this.accepted === "retainedUnknown"
                    ? "unknown-execution"
                    : this.accepted !== "hardwareRetained"
                      ? "awaiting-output"
                      : null;
    this.publish(
      reason || !s
        ? { kind: "static", reason: reason ?? "pending", commitId: s?.token }
        : { kind: "hardware-retained", commitId: s.token },
    );
  }
  private publish(state: UiRenderingState): void {
    if (
      state.kind === this.state.kind &&
      state.commitId === this.state.commitId &&
      (state.kind !== "static" ||
        (this.state.kind === "static" && state.reason === this.state.reason))
    )
      return;
    this.state = Object.freeze(state);
    for (const listener of this.listeners) listener(this.state);
  }
}
