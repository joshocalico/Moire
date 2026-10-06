/** Continuation of an already authorized session; this does not authenticate anyone. */
export type ContinuationState =
  | { kind: "ready" }
  | { kind: "starting" }
  | { kind: "complete" }
  | { kind: "error"; message: string };

export class SessionContinuation {
  private state: ContinuationState = { kind: "ready" };
  constructor(
    private readonly continueSession: () => Promise<void>,
    private readonly publish: (state: ContinuationState) => void,
  ) {}
  private change(state: ContinuationState): void {
    this.state = state;
    this.publish(state);
  }
  async start(): Promise<void> {
    if (this.state.kind === "starting" || this.state.kind === "complete") return;
    this.change({ kind: "starting" });
    try {
      await this.continueSession();
      this.change({ kind: "complete" });
    } catch (error) {
      this.change({
        kind: "error",
        message:
          error instanceof Error ? error.message : "The session could not continue. Try again.",
      });
    }
  }
}
