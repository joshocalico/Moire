/**
 * The lock screen's wire from the compositor (core's LockScreenView and LockScreenAction; the
 * shell does not depend on core, so the shapes are restated here and kept structurally equal).
 */
export type LockEntryPhase = "entry" | "checking" | "wrong" | "rate-limited" | "unavailable";

export type LockScreenAction = "suspend" | "reboot" | "power-off";

export type LockScreenView = Readonly<{
  revision: number;
  user: Readonly<{ name: string; username: string }>;
  /** Characters typed; the password itself never leaves the compositor. */
  length: number;
  phase: LockEntryPhase;
  /** With rate-limited: wall-clock ms when the user may try again. */
  retryAtMs: number | null;
  failures: number;
  capsLock: boolean;
  layout: Readonly<{ label: string; name: string }> | null;
  power: Readonly<{ suspend: boolean; powerOff: boolean; reboot: boolean }>;
  reducedMotion: boolean;
}>;
