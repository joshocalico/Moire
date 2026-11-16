/**
 * Power, idle and lock preferences (`settings.json` → `power`).
 *
 * Durations are whole seconds; `null` means "never". Each duration only takes the values its
 * choice list offers, so a hand-edited file cannot ask for a 3-second screen-off.
 */

export type PowerProfile = "power-saver" | "balanced" | "performance";
/** What closing the lid does while Moire holds logind's lid inhibitor. */
export type LidCloseAction = "suspend" | "power-off" | "nothing";
/**
 * What the power key does; "ask" opens the session's power menu. No shell provides that menu
 * yet, so "ask" acts as "nothing" and is neither offered nor the default.
 */
export type PowerButtonAction = "suspend" | "power-off" | "nothing" | "ask";
/** A timeout chosen separately for mains power and battery. */
export type PowerSourceTimeouts = { ac: number | null; battery: number | null };

/**
 * An app the user lets keep the computer awake. `id` is the identity the compositor derived for
 * it (from its launch record, the portal frontend or its executable), never a name it reported.
 */
export type SleepBlockerGrant = {
  id: string;
  name: string;
  /** It ran under X11 when allowed: every X11 app can drive it, so the grant covers them all. */
  x11: boolean;
};

export type PowerSettings = {
  /** Dim the screen after this much inactivity (skipped when it would not precede screen off). */
  dimAfterSeconds: number | null;
  /** Turn outputs off (DPMS) after this much inactivity. */
  screenOffAfterSeconds: PowerSourceTimeouts;
  /** Lock this long after the screen turns off; 0 locks as it turns off. */
  lockAfterScreenOffSeconds: number | null;
  /** Lock before the system sleeps, whoever asked for the sleep. */
  lockOnSuspend: boolean;
  /** Suspend through logind after this much inactivity. */
  suspendAfterSeconds: PowerSourceTimeouts;
  lidCloseAction: LidCloseAction;
  powerButtonAction: PowerButtonAction;
  /** Show the battery percentage beside the panel's battery icon. */
  showBatteryPercentage: boolean;
  /** Applied through power-profiles-daemon at login; null leaves the system's choice. */
  powerProfile: PowerProfile | null;
  /**
   * Apps allowed to keep the computer awake through a closed lid. Empty by default: an app may
   * always ask, and the request only stops a lid-close suspend for an app listed here.
   */
  sleepBlockers: readonly SleepBlockerGrant[];
};

/** The choices Settings offers, in display order. */
export const POWER_CHOICES = {
  dimAfterSeconds: [null, 30, 60, 120, 300],
  screenOffAfterSeconds: [null, 60, 120, 300, 600, 900, 1800],
  lockAfterScreenOffSeconds: [0, 60, 300, null],
  suspendAfterSeconds: [null, 900, 1800, 3600],
  lidCloseAction: ["suspend", "power-off", "nothing"],
  powerButtonAction: ["suspend", "power-off", "nothing", "ask"],
  powerProfile: ["power-saver", "balanced", "performance"],
} as const satisfies Record<string, readonly unknown[]>;

export const DEFAULT_POWER_SETTINGS: PowerSettings = Object.freeze({
  dimAfterSeconds: 120,
  screenOffAfterSeconds: Object.freeze({ ac: 600, battery: 300 }),
  lockAfterScreenOffSeconds: 0,
  lockOnSuspend: true,
  suspendAfterSeconds: Object.freeze({ ac: null, battery: 1800 }),
  lidCloseAction: "suspend",
  powerButtonAction: "suspend",
  showBatteryPercentage: false,
  powerProfile: null,
  sleepBlockers: Object.freeze([]),
}) as PowerSettings;

/** A partial update; the per-source timeouts merge field by field. */
export type PowerSettingsPatch = Partial<
  Omit<PowerSettings, "screenOffAfterSeconds" | "suspendAfterSeconds">
> & {
  screenOffAfterSeconds?: Partial<PowerSourceTimeouts>;
  suspendAfterSeconds?: Partial<PowerSourceTimeouts>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function choice<T>(choices: readonly T[], value: unknown, fallback: T): T {
  return choices.includes(value as T) ? (value as T) : fallback;
}

function timeouts(
  choices: readonly (number | null)[],
  value: unknown,
  fallback: PowerSourceTimeouts,
): PowerSourceTimeouts {
  const raw = isRecord(value) ? value : {};
  return {
    ac: choice(choices, raw.ac, fallback.ac),
    battery: choice(choices, raw.battery, fallback.battery),
  };
}

const MAX_SLEEP_BLOCKERS = 64;
/** The identity kinds the compositor produces (apps/system/compositor/src/sleep-blockers.ts). */
const SLEEP_BLOCKER_ID = /^(?:launch|portal|exe):[^\u0000-\u001f\u007f]{1,512}$/;

function sleepBlockers(value: unknown): SleepBlockerGrant[] {
  if (!Array.isArray(value)) return [];
  const grants = new Map<string, SleepBlockerGrant>();
  for (const entry of value) {
    if (grants.size >= MAX_SLEEP_BLOCKERS) break;
    if (!isRecord(entry) || typeof entry.id !== "string" || !SLEEP_BLOCKER_ID.test(entry.id))
      continue;
    const name =
      typeof entry.name === "string"
        ? [...entry.name]
            .filter((character) => (character.codePointAt(0) ?? 0) >= 32)
            .join("")
            .slice(0, 128)
        : "";
    if (!grants.has(entry.id))
      grants.set(entry.id, { id: entry.id, name: name || entry.id, x11: entry.x11 === true });
  }
  return [...grants.values()];
}

/** External JSON is narrowed once; each malformed field falls back on its own. */
export function normalizePowerSettings(value: unknown): PowerSettings {
  const raw = isRecord(value) ? value : {};
  const d = DEFAULT_POWER_SETTINGS;
  return {
    dimAfterSeconds: choice(POWER_CHOICES.dimAfterSeconds, raw.dimAfterSeconds, d.dimAfterSeconds),
    screenOffAfterSeconds: timeouts(
      POWER_CHOICES.screenOffAfterSeconds,
      raw.screenOffAfterSeconds,
      d.screenOffAfterSeconds,
    ),
    lockAfterScreenOffSeconds: choice(
      POWER_CHOICES.lockAfterScreenOffSeconds,
      raw.lockAfterScreenOffSeconds,
      d.lockAfterScreenOffSeconds,
    ),
    lockOnSuspend: typeof raw.lockOnSuspend === "boolean" ? raw.lockOnSuspend : d.lockOnSuspend,
    suspendAfterSeconds: timeouts(
      POWER_CHOICES.suspendAfterSeconds,
      raw.suspendAfterSeconds,
      d.suspendAfterSeconds,
    ),
    lidCloseAction: choice(POWER_CHOICES.lidCloseAction, raw.lidCloseAction, d.lidCloseAction),
    powerButtonAction: choice(
      POWER_CHOICES.powerButtonAction,
      raw.powerButtonAction,
      d.powerButtonAction,
    ),
    showBatteryPercentage: raw.showBatteryPercentage === true,
    powerProfile: choice<PowerProfile | null>(
      POWER_CHOICES.powerProfile,
      raw.powerProfile,
      d.powerProfile,
    ),
    sleepBlockers: sleepBlockers(raw.sleepBlockers),
  };
}

/** Apply a patch to the latest stored power settings; the result is normalized. */
export function applyPowerPatch(current: PowerSettings, patch: PowerSettingsPatch): PowerSettings {
  return normalizePowerSettings({
    ...current,
    ...patch,
    screenOffAfterSeconds: { ...current.screenOffAfterSeconds, ...patch.screenOffAfterSeconds },
    suspendAfterSeconds: { ...current.suspendAfterSeconds, ...patch.suspendAfterSeconds },
  });
}
