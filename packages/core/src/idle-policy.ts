/**
 * The session's idle policy as a pure state machine: dim → screen off → lock → suspend, measured
 * from the last user activity. Time and timers are injected, so smokes drive it with a fake clock.
 *
 * Effects go out through one callback; the compositor turns them into a screen fade, DPMS, a lock
 * request and a logind suspend. Input is never consumed here: the activity that wakes the screen
 * is still delivered to its client.
 */
import type { PowerSettings } from "@moire/prefs";

export type IdlePhase = "active" | "dimmed" | "off";
export type IdlePowerSource = "ac" | "battery";
export type IdleLockReason = "idle" | "suspend" | "request";

export type IdlePolicyConfig = {
  dimAfterMs: number | null;
  screenOffAfterMs: number | null;
  /** Measured from screen off; 0 locks as the screen turns off. */
  lockAfterScreenOffMs: number | null;
  suspendAfterMs: number | null;
  lockOnSuspend: boolean;
};

/** Who is holding the session awake, by reason ("application", "audio"). */
export type IdleInhibitors = {
  /** Blocks dimming, screen off, idle lock and suspend (a video or presentation). */
  display: readonly string[];
  /** Blocks only automatic suspend (audio playback). */
  suspend: readonly string[];
};

export type IdleEffect =
  | { kind: "phase"; phase: IdlePhase; previous: IdlePhase }
  | { kind: "lock"; reason: IdleLockReason }
  | { kind: "suspend" };

export type IdleTimers = {
  now(): number;
  schedule(delayMs: number, run: () => void): () => void;
};

export type IdleSnapshot = {
  phase: IdlePhase;
  locked: boolean;
  lockPending: boolean;
  idleMs: number;
  inhibitors: IdleInhibitors;
};

/** A locked, untouched screen goes dark after this even when screen off is "never". */
export const LOCKED_SCREEN_OFF_MS = 60_000;
/** A suspend blocked by audio is reconsidered this often. */
export const SUSPEND_RECHECK_MS = 60_000;

const NO_INHIBITORS: IdleInhibitors = Object.freeze({ display: [], suspend: [] });

function seconds(value: number | null): number | null {
  return value === null ? null : value * 1000;
}

/** The thresholds for one power source. */
export function idlePolicyConfig(
  settings: PowerSettings,
  source: IdlePowerSource,
): IdlePolicyConfig {
  return {
    dimAfterMs: seconds(settings.dimAfterSeconds),
    screenOffAfterMs: seconds(settings.screenOffAfterSeconds[source]),
    lockAfterScreenOffMs: seconds(settings.lockAfterScreenOffSeconds),
    suspendAfterMs: seconds(settings.suspendAfterSeconds[source]),
    lockOnSuspend: settings.lockOnSuspend,
  };
}

export const systemIdleTimers: IdleTimers = {
  now: () => performance.now(),
  schedule(delayMs, run) {
    const timer = setTimeout(run, Math.max(0, delayMs));
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

export type IdlePolicyOptions = {
  config: IdlePolicyConfig;
  /** False until a lock provider exists; lock steps are then skipped, never faked. */
  lockSupported: boolean;
  effect(effect: IdleEffect): void;
  /** Read at every evaluation, including wake-ups; keep it cheap. */
  displayInhibitors?: () => readonly string[];
  /** Read only when a suspend is due (it may touch the filesystem). */
  suspendInhibitors?: () => readonly string[];
  timers?: IdleTimers;
};

export class IdlePolicy {
  private config: IdlePolicyConfig;
  private lockSupported: boolean;
  private readonly timers: IdleTimers;
  private lastActivityMs: number;
  private phase: IdlePhase = "active";
  private locked = false;
  private lockRequested = false;
  private suspendRequested = false;
  private suspendRecheckAtMs = 0;
  private displayInhibited = false;
  private inhibitors: IdleInhibitors = NO_INHIBITORS;
  private cancelTimer: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly options: IdlePolicyOptions) {
    this.config = options.config;
    this.lockSupported = options.lockSupported;
    this.timers = options.timers ?? systemIdleTimers;
    this.lastActivityMs = this.timers.now();
    this.evaluate();
  }

  /**
   * Any key, pointer or touch input. Wakes a dimmed or dark screen. Called for every input event,
   * so while already active it only moves the clock; the pending timer re-measures when it fires.
   */
  activity(): void {
    if (this.disposed) return;
    this.lastActivityMs = this.timers.now();
    this.suspendRecheckAtMs = 0;
    if (this.phase === "active" && !this.suspendRequested && (this.cancelTimer || !this.timed()))
      return;
    this.suspendRequested = false;
    this.evaluate();
  }

  setConfig(config: IdlePolicyConfig): void {
    this.config = config;
    this.evaluate();
  }

  setLockSupported(supported: boolean): void {
    this.lockSupported = supported;
    if (!supported) this.lockRequested = false;
    this.evaluate();
  }

  /** An inhibitor appeared, went away or changed visibility. */
  inhibitorsChanged(): void {
    this.evaluate();
  }

  /** The lock provider reports the session's actual lock state. */
  setLocked(locked: boolean): void {
    if (this.disposed) return;
    this.lockRequested = false;
    if (this.locked === locked) return;
    this.locked = locked;
    // Unlocking is user activity; locking keeps the idle clock so a locked screen still sleeps.
    if (!locked) this.activity();
    else this.evaluate();
  }

  /** A lock request failed or was refused; a later threshold or request may retry. */
  lockFailed(): void {
    this.lockRequested = false;
  }

  /** Lock now (logind's Lock signal, a "Lock" command). */
  requestLock(reason: IdleLockReason = "request"): boolean {
    if (this.disposed || !this.lockSupported || this.locked || this.lockRequested) return false;
    this.lockRequested = true;
    this.options.effect({ kind: "lock", reason });
    return true;
  }

  /** logind's PrepareForSleep(true): lock first if asked to. True when a lock was requested. */
  prepareForSleep(): boolean {
    return this.config.lockOnSuspend ? this.requestLock("suspend") : false;
  }

  /** logind's PrepareForSleep(false). Waking from sleep counts as activity. */
  resumed(): void {
    this.activity();
  }

  snapshot(): IdleSnapshot {
    return {
      phase: this.phase,
      locked: this.locked,
      lockPending: this.lockRequested,
      idleMs: Math.max(0, this.timers.now() - this.lastActivityMs),
      inhibitors: this.inhibitors,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private timed(): boolean {
    const c = this.config;
    return (
      this.locked ||
      c.dimAfterMs !== null ||
      c.screenOffAfterMs !== null ||
      c.suspendAfterMs !== null
    );
  }

  private screenOffAt(): number | null {
    const configured = this.config.screenOffAfterMs;
    if (!this.locked) return configured;
    return configured === null ? LOCKED_SCREEN_OFF_MS : Math.min(configured, LOCKED_SCREEN_OFF_MS);
  }

  private evaluate(): void {
    if (this.disposed) return;
    this.cancelTimer?.();
    this.cancelTimer = null;
    const now = this.timers.now();
    const display = this.options.displayInhibitors?.() ?? [];
    this.inhibitors = { display, suspend: this.inhibitors.suspend };
    const displayInhibited = display.length > 0;
    // Held awake counts as continuous activity, and releasing restarts every timer from now.
    if (displayInhibited || this.displayInhibited) this.lastActivityMs = now;
    this.displayInhibited = displayInhibited;
    const idle = now - this.lastActivityMs;
    const c = this.config;
    const offAt = this.screenOffAt();
    const dimAt =
      c.dimAfterMs !== null && (offAt === null || c.dimAfterMs < offAt) ? c.dimAfterMs : null;
    const lockAt =
      this.lockSupported &&
      !this.locked &&
      !this.lockRequested &&
      c.screenOffAfterMs !== null &&
      c.lockAfterScreenOffMs !== null
        ? c.screenOffAfterMs + c.lockAfterScreenOffMs
        : null;
    const suspendAt = !this.suspendRequested ? c.suspendAfterMs : null;

    const phase: IdlePhase =
      offAt !== null && idle >= offAt
        ? "off"
        : dimAt !== null && idle >= dimAt
          ? "dimmed"
          : "active";
    if (phase !== this.phase) {
      const previous = this.phase;
      this.phase = phase;
      this.options.effect({ kind: "phase", phase, previous });
    }
    if (lockAt !== null && idle >= lockAt) this.requestLock("idle");

    let recheckIn: number | null = null;
    if (suspendAt !== null && idle >= suspendAt) {
      this.inhibitors = { display, suspend: this.options.suspendInhibitors?.() ?? [] };
      if (this.inhibitors.suspend.length > 0) {
        if (this.suspendRecheckAtMs <= now) this.suspendRecheckAtMs = now + SUSPEND_RECHECK_MS;
        recheckIn = this.suspendRecheckAtMs - now;
      } else {
        this.suspendRequested = true;
        this.options.effect({ kind: "suspend" });
      }
    }

    const upcoming = [dimAt, offAt, lockAt, this.suspendRequested ? null : suspendAt]
      .filter((at): at is number => at !== null && at > idle)
      .map((at) => at - idle);
    if (recheckIn !== null) upcoming.push(recheckIn);
    if (upcoming.length === 0 || this.disposed) return;
    this.cancelTimer = this.timers.schedule(Math.min(...upcoming), () => {
      this.cancelTimer = null;
      this.evaluate();
    });
  }
}

/** Smoothstepped opacity ramp for the dim overlay; duration 0 jumps. */
export class ScreenFade {
  private from = 0;
  private to = 0;
  private startedMs = 0;
  private durationMs = 0;

  get target(): number {
    return this.to;
  }

  set(target: number, nowMs: number, durationMs: number): void {
    this.from = this.value(nowMs);
    this.to = Math.max(0, Math.min(1, target));
    this.startedMs = nowMs;
    this.durationMs = Math.max(0, durationMs);
  }

  value(nowMs: number): number {
    if (this.durationMs <= 0 || nowMs >= this.startedMs + this.durationMs) return this.to;
    const u = Math.max(0, (nowMs - this.startedMs) / this.durationMs);
    return this.from + (this.to - this.from) * u * u * (3 - 2 * u);
  }

  animating(nowMs: number): boolean {
    return this.durationMs > 0 && nowMs < this.startedMs + this.durationMs;
  }
}
