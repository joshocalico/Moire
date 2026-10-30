/**
 * Power & idle settings for the Settings app: the stored preferences (prefs), power profiles
 * (management service → power-profiles-daemon) and the live idle state (compositor).
 *
 * Each source is optional. A missing compositor or service leaves its part `unavailable`; the
 * preferences still read and write.
 */
import fs from "node:fs";
import { SessionBus } from "@moire/dbus";
import {
  DEFAULT_POWER_SETTINGS,
  POWER_CHOICES,
  applyPowerPatch,
  loadPowerSettings,
  settingsPath,
  updatePowerSettings,
  type LidCloseAction,
  type PowerButtonAction,
  type PowerProfile,
  type PowerSettings,
  type PowerSettingsPatch,
  type PowerSourceTimeouts,
  type SleepBlockerGrant,
} from "@moire/prefs";
import {
  SETTINGS_SERVICE_BUS,
  bounded,
  observeSettingsService,
  remoteSettingsFailure,
  settingsFailure,
  type ServiceClientState,
  type ServiceObserver,
  type SettingsErrorCode,
  type SettingsResult,
} from "./settings-service";

export {
  DEFAULT_POWER_SETTINGS,
  POWER_CHOICES,
  type LidCloseAction,
  type PowerButtonAction,
  type PowerProfile,
  type PowerSettings,
  type PowerSettingsPatch,
  type PowerSourceTimeouts,
  type SleepBlockerGrant,
};

/** The compositor publishes idle state beside its display controls. */
export const IDLE_BUS = "org.moire.Display1";
export const IDLE_PATH = "/org/moire/Idle1";
export const IDLE_INTERFACE = "org.moire.Idle1";
/** The management service wraps power-profiles-daemon. */
export const POWER_BUS = SETTINGS_SERVICE_BUS;
export const POWER_PATH = "/org/moire/Power1";
export const POWER_INTERFACE = "org.moire.Power1";

export type PowerSource = "ac" | "battery";
/** One word for the UI: off wins over locked, locked over dimmed. */
export type IdleState = "active" | "dimmed" | "off" | "locked";

export type IdleCapabilities = {
  /** DPMS reached every output the last time the screen went off; null until it first has. */
  screenOff: boolean | null;
  /** A lock screen exists. False today: "lock after" and "lock on suspend" have no effect yet. */
  lock: boolean;
  /** logind lets this session suspend / power off / restart without asking (CanSuspend = "yes"). */
  suspend: boolean;
  powerOff: boolean;
  reboot: boolean;
  /** UPower reports a lid. */
  lidPresent: boolean;
  /** Moire holds logind's lid inhibitor, so the lid action pref applies. */
  lidAction: boolean;
  /** The compositor handles the power key, so the power button pref applies. */
  powerButton: boolean;
};

/** An app that asked to keep the computer awake (a suspend inhibitor), as the compositor saw it. */
export type SleepBlockerRequest = {
  /**
   * The compositor's identity for the app (`launch:`, `portal:` or `exe:`), derived from the
   * caller's process and never from a name it gave. Null when it could not be identified; such
   * an app cannot be allowed.
   */
  id: string | null;
  name: string;
  /** Appears to run under X11, where every app can drive every other. */
  x11: boolean;
  /** On the user's allowlist (power prefs `sleepBlockers`). */
  allowed: boolean;
  /** Holding a request right now. */
  holding: boolean;
};

export type SleepBlocking = {
  /** Apps holding a request now, then those that asked earlier in this session. */
  requests: readonly SleepBlockerRequest[];
  /** The lid is closed and an allowed app is keeping the computer awake. */
  lidHeld: boolean;
};

export type IdleStatus = {
  state: IdleState;
  phase: "active" | "dimmed" | "off";
  locked: boolean;
  powerSource: PowerSource;
  /** Who keeps the session awake: app ids holding an idle inhibitor; "audio" blocks suspend. */
  inhibitors: { display: readonly string[]; suspend: readonly string[] };
  capabilities: IdleCapabilities;
  sleepBlocking: SleepBlocking;
  /** The last failed action ("suspend: Access denied"), for a status line. */
  lastError: string | null;
};

export type PowerProfilesStatus =
  | { kind: "unavailable" | "error"; message: string }
  | {
      kind: "ready";
      /** In POWER_CHOICES.powerProfile order. */
      profiles: readonly PowerProfile[];
      active: PowerProfile;
      /** Why performance is degraded ("lap-detected", "high-operating-temperature"), or null. */
      degraded: string | null;
    };

export type PowerSettingsState = {
  /** The stored preferences; always present. */
  settings: PowerSettings;
  /** power-profiles-daemon through the management service. */
  profiles: ServiceClientState<PowerProfilesStatus>;
  /** The compositor's idle state and what it can do. */
  idle: ServiceClientState<IdleStatus>;
};

export type PowerSettingsClient = {
  /** Latest snapshot; replaced (never mutated) on every change. */
  readonly state: PowerSettingsState;
  /** Called at once with the current state, then on every change. Returns the unsubscribe. */
  subscribe(listener: (state: PowerSettingsState) => void): () => void;
  /** Merge into the stored power prefs; resolves with what was stored (normalized). */
  update(patch: PowerSettingsPatch): Promise<PowerSettings>;
  setDimAfter(seconds: number | null): Promise<PowerSettings>;
  setScreenOffAfter(source: PowerSource, seconds: number | null): Promise<PowerSettings>;
  setLockAfterScreenOff(seconds: number | null): Promise<PowerSettings>;
  setLockOnSuspend(enabled: boolean): Promise<PowerSettings>;
  setSuspendAfter(source: PowerSource, seconds: number | null): Promise<PowerSettings>;
  setLidCloseAction(action: LidCloseAction): Promise<PowerSettings>;
  setPowerButtonAction(action: PowerButtonAction): Promise<PowerSettings>;
  setShowBatteryPercentage(show: boolean): Promise<PowerSettings>;
  /** Put an app on, or take it off, the list of apps that may keep the computer awake. */
  setSleepBlockerAllowed(app: SleepBlockerGrant, allowed: boolean): Promise<PowerSettings>;
  /** Switch now and remember it for the next login. Never rejects. */
  setPowerProfile(profile: PowerProfile): Promise<SettingsResult>;
  dispose(): Promise<void>;
};

// ---------------------------------------------------------------------------------------------
// Wire parsing (shared with the compositor and the management service)

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${what}`);
  return value as Record<string, unknown>;
}
function flag(value: unknown, what: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Invalid ${what}`);
  return value;
}
function names(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error("Invalid inhibitor list");
  return value.map((entry) => bounded(entry, 256, "inhibitor"));
}

function sleepBlocking(value: unknown): SleepBlocking {
  // Absent from compositors older than the allowlist: nobody has asked.
  if (value === undefined) return { requests: [], lidHeld: false };
  const raw = record(value, "sleep blocking");
  if (!Array.isArray(raw.requests) || raw.requests.length > 64)
    throw new Error("Invalid sleep blocker list");
  return {
    requests: raw.requests.map((entry) => {
      const request = record(entry, "sleep blocker");
      return {
        id: request.id === null ? null : bounded(request.id, 600, "sleep blocker id"),
        name: bounded(request.name, 256, "sleep blocker name"),
        x11: flag(request.x11, "sleep blocker X11 flag"),
        allowed: flag(request.allowed, "sleep blocker grant"),
        holding: flag(request.holding, "sleep blocker state"),
      };
    }),
    lidHeld: flag(raw.lidHeld, "lid hold"),
  };
}

export function parsePowerProfile(value: unknown): PowerProfile {
  if (!(POWER_CHOICES.powerProfile as readonly unknown[]).includes(value))
    throw new Error("Invalid power profile");
  return value as PowerProfile;
}

/** The `status` of `org.moire.Idle1.GetStatus`. */
export function parseIdleStatus(value: unknown): IdleStatus {
  const raw = record(value, "idle status");
  const state = raw.state;
  if (state !== "active" && state !== "dimmed" && state !== "off" && state !== "locked")
    throw new Error("Invalid idle state");
  const phase = raw.phase;
  if (phase !== "active" && phase !== "dimmed" && phase !== "off")
    throw new Error("Invalid idle phase");
  if (raw.powerSource !== "ac" && raw.powerSource !== "battery")
    throw new Error("Invalid power source");
  const inhibitors = record(raw.inhibitors, "idle inhibitors");
  const c = record(raw.capabilities, "idle capabilities");
  return {
    state,
    phase,
    locked: flag(raw.locked, "lock state"),
    powerSource: raw.powerSource,
    inhibitors: { display: names(inhibitors.display), suspend: names(inhibitors.suspend) },
    capabilities: {
      screenOff: c.screenOff === null ? null : flag(c.screenOff, "screen off capability"),
      lock: flag(c.lock, "lock capability"),
      suspend: flag(c.suspend, "suspend capability"),
      powerOff: flag(c.powerOff, "power off capability"),
      // Absent from compositors older than the restart action: not allowed.
      reboot: c.reboot === undefined ? false : flag(c.reboot, "restart capability"),
      lidPresent: flag(c.lidPresent, "lid presence"),
      lidAction: flag(c.lidAction, "lid capability"),
      powerButton: flag(c.powerButton, "power button capability"),
    },
    sleepBlocking: sleepBlocking(raw.sleepBlocking),
    lastError: raw.lastError === null ? null : bounded(raw.lastError, 1024, "idle error"),
  };
}

/** The `status` of `org.moire.Power1.GetStatus`. */
export function parsePowerProfilesStatus(value: unknown): PowerProfilesStatus {
  const raw = record(value, "power profile status");
  if (raw.kind === "unavailable" || raw.kind === "error")
    return { kind: raw.kind, message: bounded(raw.message, 512, "power profile message") };
  if (raw.kind !== "ready") throw new Error("Invalid power profile status");
  if (!Array.isArray(raw.profiles) || raw.profiles.length > 8)
    throw new Error("Invalid power profiles");
  const listed = new Set(raw.profiles.map(parsePowerProfile));
  return {
    kind: "ready",
    profiles: POWER_CHOICES.powerProfile.filter((profile) => listed.has(profile)),
    active: parsePowerProfile(raw.active),
    degraded: raw.degraded === null ? null : bounded(raw.degraded, 256, "degraded reason"),
  };
}

// ---------------------------------------------------------------------------------------------
// Live client

export type PowerSettingsStore = {
  load(): PowerSettings;
  update(patch: PowerSettingsPatch): PowerSettings;
  /** Changes made by another process (another Settings window, the service saving a profile). */
  watch?(listener: () => void): () => void;
};

export const filePowerSettingsStore: PowerSettingsStore = {
  load: loadPowerSettings,
  update: updatePowerSettings,
  watch(listener) {
    const file = settingsPath();
    const onChange = () => listener();
    fs.watchFile(file, { interval: 1000, persistent: false }, onChange);
    return () => fs.unwatchFile(file, onChange);
  },
};

const PROFILE_FALLBACK = "The power mode did not change.";

/** Observe power settings on a session bus the caller owns. */
export async function observePowerSettings(
  bus: SessionBus,
  options: { store?: PowerSettingsStore; readTimeoutMs?: number } = {},
): Promise<PowerSettingsClient> {
  const store = options.store ?? filePowerSettingsStore;
  const idle = await observeSettingsService(bus, {
    name: IDLE_BUS,
    path: IDLE_PATH,
    iface: IDLE_INTERFACE,
    parse: parseIdleStatus,
    label: "idle state",
    readTimeoutMs: options.readTimeoutMs,
  });
  let profiles: ServiceObserver<PowerProfilesStatus>;
  try {
    profiles = await observeSettingsService(bus, {
      path: POWER_PATH,
      iface: POWER_INTERFACE,
      parse: parsePowerProfilesStatus,
      label: "power profiles",
      readTimeoutMs: options.readTimeoutMs,
    });
  } catch (error) {
    await idle.dispose();
    throw error;
  }
  let disposed = false;
  let state: PowerSettingsState = {
    settings: store.load(),
    profiles: profiles.state,
    idle: idle.state,
  };
  const listeners = new Set<(state: PowerSettingsState) => void>();
  const publish = (next: Partial<PowerSettingsState>) => {
    if (disposed) return;
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener(state);
  };
  const stopIdle = idle.subscribe((next) => publish({ idle: next }));
  const stopProfiles = profiles.subscribe((next) => publish({ profiles: next }));
  const reloadSettings = () => {
    const settings = store.load();
    if (JSON.stringify(settings) !== JSON.stringify(state.settings)) publish({ settings });
  };
  const unwatch = store.watch?.(reloadSettings);
  const update = async (patch: PowerSettingsPatch) => {
    const settings = store.update(patch);
    publish({ settings });
    return settings;
  };
  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    ...setters(update, () => store.load()),
    async setPowerProfile(profile) {
      try {
        parsePowerProfile(profile);
      } catch {
        return settingsFailure("invalid", "That is not a power mode.");
      }
      try {
        await profiles.call("SetProfile", "s", [profile], 10_000);
        // The service saved the preference; reread it rather than guessing.
        reloadSettings();
        return { ok: true, value: undefined };
      } catch (error) {
        return remoteSettingsFailure(POWER_INTERFACE, error, PROFILE_FALLBACK);
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      unwatch?.();
      stopIdle();
      stopProfiles();
      await Promise.allSettled([idle.dispose(), profiles.dispose()]);
    },
  };
}

/** Settings owns this session-bus connection. */
export async function connectPowerSettings(): Promise<PowerSettingsClient> {
  const bus = await SessionBus.connect();
  try {
    const client = await observePowerSettings(bus);
    let disposal: Promise<void> | null = null;
    return {
      ...client,
      get state() {
        return client.state;
      },
      dispose() {
        disposal ??= client.dispose().finally(() => bus.close());
        return disposal;
      },
    };
  } catch (error) {
    bus.close();
    throw error;
  }
}

type PreferenceSetters = Omit<
  PowerSettingsClient,
  "state" | "subscribe" | "update" | "setPowerProfile" | "dispose"
>;

function setters(
  update: (patch: PowerSettingsPatch) => Promise<PowerSettings>,
  /** The stored prefs now, so a list edit starts from what is on disk, not a UI snapshot. */
  current: () => PowerSettings,
): PreferenceSetters {
  return {
    setSleepBlockerAllowed: (app, allowed) => {
      const others = current().sleepBlockers.filter((grant) => grant.id !== app.id);
      return update({
        sleepBlockers: allowed ? [...others, { id: app.id, name: app.name, x11: app.x11 }] : others,
      });
    },
    setDimAfter: (seconds) => update({ dimAfterSeconds: seconds }),
    setScreenOffAfter: (source, seconds) =>
      update({ screenOffAfterSeconds: { [source]: seconds } }),
    setLockAfterScreenOff: (seconds) => update({ lockAfterScreenOffSeconds: seconds }),
    setLockOnSuspend: (enabled) => update({ lockOnSuspend: enabled }),
    setSuspendAfter: (source, seconds) => update({ suspendAfterSeconds: { [source]: seconds } }),
    setLidCloseAction: (action) => update({ lidCloseAction: action }),
    setPowerButtonAction: (action) => update({ powerButtonAction: action }),
    setShowBatteryPercentage: (show) => update({ showBatteryPercentage: show }),
  };
}

// ---------------------------------------------------------------------------------------------
// Fake for UI smokes and the gallery

export const FAKE_IDLE_STATUS: IdleStatus = Object.freeze({
  state: "active",
  phase: "active",
  locked: false,
  powerSource: "battery",
  inhibitors: Object.freeze({ display: [], suspend: [] }),
  capabilities: Object.freeze({
    screenOff: true,
    lock: false,
    suspend: true,
    powerOff: true,
    reboot: true,
    lidPresent: true,
    lidAction: true,
    powerButton: true,
  }),
  sleepBlocking: Object.freeze({ requests: Object.freeze([]), lidHeld: false }),
  lastError: null,
});

export const FAKE_POWER_PROFILES: PowerProfilesStatus = Object.freeze({
  kind: "ready",
  profiles: Object.freeze(["power-saver", "balanced", "performance"] as const),
  active: "balanced",
  degraded: null,
});

export type FakePowerSettings = PowerSettingsClient & {
  /** Replace the idle state as the compositor's `Changed` signal would. */
  emitIdle(status: IdleStatus): void;
  /** Replace the profile status as the service's `Changed` signal would. */
  emitProfiles(status: PowerProfilesStatus): void;
  /** Show a service as gone (`unavailable`) or broken (`error`). */
  setServiceState(service: "idle" | "profiles", kind: "loading" | "unavailable" | "error"): void;
  /** The next setPowerProfile fails with this code (once). */
  failNext(code: SettingsErrorCode): void;
  readonly calls: readonly { member: string; args: readonly unknown[] }[];
};

/** An in-memory client with the live client's behaviour; nothing touches disk or D-Bus. */
export function createFakePowerSettingsClient(
  options: { settings?: PowerSettings; idle?: IdleStatus; profiles?: PowerProfilesStatus } = {},
): FakePowerSettings {
  let revision = 1;
  const ready = <S>(status: S): ServiceClientState<S> => ({
    kind: "ready",
    owner: ":fake.1",
    revision: ++revision,
    status,
  });
  let state: PowerSettingsState = {
    settings: options.settings ?? DEFAULT_POWER_SETTINGS,
    profiles: ready(options.profiles ?? FAKE_POWER_PROFILES),
    idle: ready(options.idle ?? FAKE_IDLE_STATUS),
  };
  let failure: SettingsErrorCode | null = null;
  const calls: { member: string; args: readonly unknown[] }[] = [];
  const listeners = new Set<(state: PowerSettingsState) => void>();
  const publish = (next: Partial<PowerSettingsState>) => {
    state = { ...state, ...next };
    for (const listener of [...listeners]) listener(state);
  };
  const update = async (patch: PowerSettingsPatch) => {
    calls.push({ member: "update", args: [patch] });
    const settings = applyPowerPatch(state.settings, patch);
    publish({ settings });
    return settings;
  };
  return {
    get state() {
      return state;
    },
    calls,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    ...setters(update, () => state.settings),
    async setPowerProfile(profile) {
      calls.push({ member: "SetProfile", args: [profile] });
      if (failure) {
        const code = failure;
        failure = null;
        return settingsFailure(code, PROFILE_FALLBACK);
      }
      const current = state.profiles;
      if (current.kind !== "ready" || current.status.kind !== "ready")
        return settingsFailure("unavailable", "Power modes are unavailable.");
      if (!current.status.profiles.includes(profile))
        return settingsFailure("invalid", "That power mode is not available here.");
      publish({
        profiles: ready({ ...current.status, active: profile }),
        settings: applyPowerPatch(state.settings, { powerProfile: profile }),
      });
      return { ok: true, value: undefined };
    },
    emitIdle: (status) => publish({ idle: ready(status) }),
    emitProfiles: (status) => publish({ profiles: ready(status) }),
    setServiceState(service, kind) {
      const value = { kind, message: `${service} ${kind}` } as const;
      publish(service === "idle" ? { idle: value } : { profiles: value });
    },
    failNext(code) {
      failure = code;
    },
    async dispose() {
      listeners.clear();
    },
  };
}
