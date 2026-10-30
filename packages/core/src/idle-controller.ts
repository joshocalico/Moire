/**
 * Runs the idle policy against the outputs: fades, DPMS, lock and suspend requests, and the
 * status the Settings app shows. logind, prefs and D-Bus stay with the caller (the compositor
 * session), which passes plain hooks in.
 */
import type { PowerSettings } from "@moire/prefs";
import {
  IdlePolicy,
  idlePolicyConfig,
  systemIdleTimers,
  type IdleEffect,
  type IdleInhibitors,
  type IdleLockReason,
  type IdlePhase,
  type IdlePowerSource,
  type IdleTimers,
} from "./idle-policy";

/** Overlay opacity for a dimmed screen. */
export const DIM_LEVEL = 0.55;
export const DIM_FADE_MS = 700;
/** The screen fades to black over this before DPMS turns it off. */
export const SCREEN_OFF_FADE_MS = 450;
export const UNDIM_FADE_MS = 160;

export type IdleOutputs = {
  setDim(level: number, durationMs: number): void;
  setPowered(on: boolean): Promise<boolean>;
};

export type IdleControllerHooks = {
  /** Show the lock screen; resolves true once locked. Absent: locking is unsupported. */
  lock?: (reason: IdleLockReason) => Promise<boolean>;
  /** Ask logind to suspend. Failures are reported, not retried until the next idle period. */
  suspend: () => Promise<void>;
  /** Mirror the idle state into logind's IdleHint. */
  idleHint?: (idle: boolean) => void;
  /** The status changed (phase, lock, inhibitors, power source). */
  changed?: () => void;
  /** An action failed; message only, for logs and the status. */
  failed?: (action: "lock" | "suspend" | "screen-off", error: unknown) => void;
};

export type IdleControllerOptions = {
  settings: PowerSettings;
  source: IdlePowerSource;
  outputs: IdleOutputs;
  hooks: IdleControllerHooks;
  displayInhibitors?: () => readonly string[];
  suspendInhibitors?: () => readonly string[];
  reducedMotion?: () => boolean;
  timers?: IdleTimers;
};

export type IdleSummary = "active" | "dimmed" | "off" | "locked";

export type IdleControllerStatus = {
  /** One word for the UI: off wins over locked, locked over dimmed. */
  state: IdleSummary;
  phase: IdlePhase;
  locked: boolean;
  powerSource: IdlePowerSource;
  inhibitors: IdleInhibitors;
  /** null until the screen has been turned off once. */
  screenOffSupported: boolean | null;
  lockSupported: boolean;
  lastError: string | null;
};

export class IdleController {
  private readonly policy: IdlePolicy;
  private readonly timers: IdleTimers;
  private settings: PowerSettings;
  private source: IdlePowerSource;
  private cancelPowerOff: (() => void) | null = null;
  private screenOffSupported: boolean | null = null;
  private lastError: string | null = null;
  private pendingLock: Promise<boolean> | null = null;

  constructor(private readonly options: IdleControllerOptions) {
    this.timers = options.timers ?? systemIdleTimers;
    this.settings = options.settings;
    this.source = options.source;
    this.policy = new IdlePolicy({
      config: idlePolicyConfig(this.settings, this.source),
      lockSupported: !!options.hooks.lock,
      displayInhibitors: options.displayInhibitors,
      suspendInhibitors: options.suspendInhibitors,
      timers: this.timers,
      effect: (effect) => this.apply(effect),
    });
  }

  activity(): void {
    this.policy.activity();
  }

  setSettings(settings: PowerSettings): void {
    this.settings = settings;
    this.policy.setConfig(idlePolicyConfig(settings, this.source));
    this.options.hooks.changed?.();
  }

  setPowerSource(source: IdlePowerSource): void {
    if (source === this.source) return;
    this.source = source;
    this.policy.setConfig(idlePolicyConfig(this.settings, source));
    this.options.hooks.changed?.();
  }

  inhibitorsChanged(): void {
    const before = JSON.stringify(this.policy.snapshot().inhibitors);
    this.policy.inhibitorsChanged();
    if (JSON.stringify(this.policy.snapshot().inhibitors) !== before)
      this.options.hooks.changed?.();
  }

  /** The lock provider reports lock and unlock. */
  setLocked(locked: boolean): void {
    this.policy.setLocked(locked);
    this.options.hooks.changed?.();
  }

  requestLock(): boolean {
    return this.policy.requestLock("request");
  }

  /** Lock (when asked to) before logind sleeps; resolves when it is safe to sleep. */
  async prepareForSleep(): Promise<void> {
    this.policy.prepareForSleep();
    await this.pendingLock?.catch(() => false);
  }

  resumed(): void {
    this.policy.resumed();
  }

  status(): IdleControllerStatus {
    const snapshot = this.policy.snapshot();
    return {
      state: snapshot.phase === "off" ? "off" : snapshot.locked ? "locked" : snapshot.phase,
      phase: snapshot.phase,
      locked: snapshot.locked,
      powerSource: this.source,
      inhibitors: snapshot.inhibitors,
      screenOffSupported: this.screenOffSupported,
      lockSupported: !!this.options.hooks.lock,
      lastError: this.lastError,
    };
  }

  dispose(): void {
    this.cancelPowerOff?.();
    this.cancelPowerOff = null;
    this.policy.dispose();
  }

  private duration(ms: number): number {
    return this.options.reducedMotion?.() ? 0 : ms;
  }

  private fail(action: "lock" | "suspend" | "screen-off", error: unknown): void {
    this.lastError = `${action}: ${error instanceof Error ? error.message : String(error)}`;
    this.options.hooks.failed?.(action, error);
    this.options.hooks.changed?.();
  }

  private apply(effect: IdleEffect): void {
    const { outputs, hooks } = this.options;
    switch (effect.kind) {
      case "phase": {
        this.cancelPowerOff?.();
        this.cancelPowerOff = null;
        if (effect.phase === "dimmed") {
          outputs.setDim(DIM_LEVEL, this.duration(DIM_FADE_MS));
        } else if (effect.phase === "off") {
          const fade = this.duration(SCREEN_OFF_FADE_MS);
          outputs.setDim(1, fade);
          this.cancelPowerOff = this.timers.schedule(fade, () => {
            this.cancelPowerOff = null;
            void outputs.setPowered(false).then(
              (ok) => {
                if (this.policy.snapshot().phase !== "off") return;
                this.screenOffSupported = ok;
                hooks.changed?.();
              },
              (error: unknown) => this.fail("screen-off", error),
            );
          });
        } else {
          // Waking: power first so the very next composite reaches the screen.
          if (effect.previous === "off") void outputs.setPowered(true).catch(() => {});
          outputs.setDim(0, this.duration(UNDIM_FADE_MS));
        }
        hooks.idleHint?.(effect.phase !== "active");
        hooks.changed?.();
        return;
      }
      case "lock": {
        const lock = hooks.lock;
        if (!lock) {
          this.policy.lockFailed();
          return;
        }
        const pending = lock(effect.reason).then(
          (locked) => {
            if (locked) this.policy.setLocked(true);
            else this.policy.lockFailed();
            hooks.changed?.();
            return locked;
          },
          (error: unknown) => {
            this.policy.lockFailed();
            this.fail("lock", error);
            return false;
          },
        );
        this.pendingLock = pending;
        void pending.finally(() => {
          if (this.pendingLock === pending) this.pendingLock = null;
        });
        return;
      }
      case "suspend":
        void hooks.suspend().catch((error: unknown) => this.fail("suspend", error));
        return;
    }
  }
}
