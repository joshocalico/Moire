import type { UiRenderingState, UiSurfaceVisibility } from "./platform";

export type RetainedMotionParticipant = {
  get(): number;
  tick(dt: number): boolean;
  isActive(): boolean;
  reset(): boolean;
};

/** Registration grants no authority to qualify rendering or advance another window. */
export type RetainedMotionAdmission = Readonly<{
  register(participant: RetainedMotionParticipant): () => void;
}>;

/** Bounded wave repainting accepts verified software/virtual output without claiming hardware. */
export type RetainedMotionPolicy = "hardware-only" | "bounded-wave";

/** Window alone supplies actual submission, acceptance and frame observations. */
export class WindowRetainedMotionController {
  private readonly participants = new Set<RetainedMotionParticipant>();
  readonly admission: RetainedMotionAdmission = Object.freeze({
    register: (participant: RetainedMotionParticipant) => {
      if (this.destroyed) return () => {};
      this.participants.add(participant);
      return () => this.participants.delete(participant);
    },
  });
  private rendering: UiRenderingState = { kind: "static", reason: "pending" };
  private visibility: UiSurfaceVisibility = "unknown";
  private submittedToken: number | null = null;
  private frameToken: number | null = null;
  private blocked = false;
  private destroyed = false;
  private lost = false;
  private clock: number | null = null;
  private acceptedToken: number | null = null;
  private lastAdvance: number | null = null;
  private consumedToken: number | null = null;

  constructor(
    private readonly invalidate: (paint: boolean) => void,
    private readonly policy: RetainedMotionPolicy = "hardware-only",
  ) {}

  isActive(): boolean {
    return (
      !this.destroyed &&
      !this.lost &&
      !this.blocked &&
      this.visibility === "visible" &&
      this.submittedToken !== null &&
      this.rendering.commitId === this.submittedToken &&
      (this.rendering.kind === "hardware-retained" ||
        (this.policy === "bounded-wave" &&
          this.rendering.kind === "static" &&
          (this.rendering.reason === "software" || this.rendering.reason === "virtual") &&
          this.acceptedToken === this.submittedToken)) &&
      this.frameToken === this.submittedToken &&
      [...this.participants].some((participant) => participant.isActive())
    );
  }

  private changed(wasActive: boolean): void {
    const active = this.isActive();
    if (!active) this.clock = null;
    else if (!wasActive) {
      this.clock = Date.now();
      this.invalidate(false);
    }
  }

  private reset(): void {
    let changed = false;
    for (const participant of this.participants) changed = participant.reset() || changed;
    if (changed && !this.destroyed) this.invalidate(true);
  }

  renderingChanged(state: UiRenderingState): void {
    const active = this.isActive();
    this.rendering = state;
    if (
      state.kind === "static" &&
      state.reason !== "pending" &&
      state.reason !== "awaiting-output" &&
      !(
        this.policy === "bounded-wave" &&
        (state.reason === "software" || state.reason === "virtual")
      )
    ) {
      this.acceptedToken = null;
      if (state.reason === "backend-loss" || state.reason === "destroyed") this.lost = true;
      this.reset();
    }
    this.changed(active);
  }

  visibilityChanged(visibility: UiSurfaceVisibility): void {
    const active = this.isActive();
    this.visibility = visibility;
    if (visibility === "unknown") {
      this.acceptedToken = null;
      this.reset();
    }
    this.changed(active);
  }

  submitted(token: number): void {
    this.submittedToken = token;
    this.frameToken = null;
    this.consumedToken = null;
    this.acceptedToken = null;
    this.blocked = false;
    this.clock = null;
  }

  outputAccepted(token: number): void {
    if (this.destroyed || this.lost || token !== this.submittedToken) return;
    const active = this.isActive();
    this.acceptedToken = token;
    this.changed(active);
  }

  outputRevoked(token: number): void {
    if (token !== this.submittedToken) return;
    const active = this.isActive();
    const wasAccepted = this.acceptedToken === token;
    this.acceptedToken = null;
    // Each new commit first reports unknown while awaiting output. Hold its phase;
    // demote geometry only when an already accepted output is actually revoked.
    if (this.policy === "bounded-wave" && wasAccepted) this.reset();
    this.changed(active);
  }

  frameReady(token: number): void {
    if (token !== this.submittedToken || token === this.consumedToken) return;
    const active = this.isActive();
    this.frameToken = token;
    this.changed(active);
  }

  /** Pause before attempting a new presentation, even before its submitted event. */
  beforePresent(): void {
    this.blocked = true;
    this.clock = null;
  }

  /** A buffer-release retry may retry the same qualified, unsubmitted scene. */
  retry(): void {
    const active = this.isActive();
    this.blocked = false;
    this.changed(active);
  }

  tick(now: number): boolean {
    if (!this.isActive()) return false;
    if (this.policy === "bounded-wave" && now - (this.lastAdvance ?? this.clock ?? now) < 100)
      return false;
    // Output acceptance restarts `clock` on every SHM handoff. Bounded wave time
    // spans accepted frames so rendering latency does not slow the animation.
    const previous = this.policy === "bounded-wave" ? (this.lastAdvance ?? this.clock) : this.clock;
    const dt = previous === null ? 0 : Math.max(0, Math.min((now - previous) / 1000, 0.1));
    this.clock = now;
    let changed = false;
    for (const participant of this.participants) {
      const previous = participant.get();
      participant.tick(dt);
      changed = previous !== participant.get() || changed;
    }
    if (changed && this.policy === "bounded-wave") {
      this.lastAdvance = now;
      this.consumedToken = this.submittedToken;
      // One paint consumes this accepted frame opportunity, including duplicate callbacks.
      this.frameToken = null;
    }
    return changed;
  }

  destroy(): void {
    this.destroyed = true;
    this.clock = null;
    this.acceptedToken = null;
    this.participants.clear();
  }
}
