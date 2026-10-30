/**
 * Screen brightness for Settings: the management service reads the session's backlight from
 * `/sys/class/backlight` and sets it through logind (`Session.SetBrightness`), published as
 * org.moire.Brightness1. A computer without a backlight (a VM, most desktops) is `unavailable`
 * with a sentence saying so, and Settings shows that instead of a slider.
 */
import { SessionBus } from "@moire/dbus";
import {
  bounded,
  observeSettingsService,
  remoteSettingsFailure,
  settingsFailure,
  type ServiceClientState,
  type SettingsErrorCode,
  type SettingsResult,
} from "./settings-service";

export const BRIGHTNESS_PATH = "/org/moire/Brightness1";
export const BRIGHTNESS_INTERFACE = "org.moire.Brightness1";

/** sysfs backlight types, most preferred first (the order systemd uses). */
export const BACKLIGHT_TYPES = ["firmware", "platform", "raw"] as const;
export type BacklightType = (typeof BACKLIGHT_TYPES)[number];

/** The lowest level offered, so the slider can't turn the screen black. */
export const MIN_BRIGHTNESS = 0.05;

export type BrightnessStatus =
  | {
      kind: "ready";
      /** The sysfs device name, such as `intel_backlight`. */
      device: string;
      type: BacklightType;
      /** 0–1 of the device's maximum. */
      level: number;
    }
  | { kind: "unavailable" | "error"; message: string };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid brightness status");
  return value as Record<string, unknown>;
}

/** The `status` of `org.moire.Brightness1.GetStatus`. */
export function parseBrightnessStatus(value: unknown): BrightnessStatus {
  const raw = record(value);
  if (raw.kind === "unavailable" || raw.kind === "error")
    return { kind: raw.kind, message: bounded(raw.message, 512, "brightness message") };
  if (raw.kind !== "ready") throw new Error("Invalid brightness status");
  const level = raw.level;
  if (typeof level !== "number" || !Number.isFinite(level) || level < 0 || level > 1)
    throw new Error("Invalid brightness level");
  const type = raw.type;
  if (!BACKLIGHT_TYPES.includes(type as BacklightType)) throw new Error("Invalid backlight type");
  const device = bounded(raw.device, 128, "backlight device");
  if (!/^[A-Za-z0-9_.:-]+$/.test(device)) throw new Error("Invalid backlight device");
  return { kind: "ready", device, type: type as BacklightType, level };
}

export type BrightnessClient = {
  readonly state: ServiceClientState<BrightnessStatus>;
  subscribe(listener: (state: ServiceClientState<BrightnessStatus>) => void): () => void;
  /** Set the level (0–1, raised to MIN_BRIGHTNESS). Never rejects. */
  setLevel(level: number): Promise<SettingsResult>;
  dispose(): Promise<void>;
};

/** Observe brightness on a session bus the caller owns. */
export async function observeBrightness(
  bus: SessionBus,
  options: { readTimeoutMs?: number } = {},
): Promise<BrightnessClient> {
  const service = await observeSettingsService(bus, {
    path: BRIGHTNESS_PATH,
    iface: BRIGHTNESS_INTERFACE,
    parse: parseBrightnessStatus,
    label: "screen brightness",
    readTimeoutMs: options.readTimeoutMs,
  });
  return {
    get state() {
      return service.state;
    },
    subscribe: (listener) => service.subscribe(listener),
    async setLevel(level) {
      if (!Number.isFinite(level)) return settingsFailure("invalid", "That is not a brightness.");
      try {
        await service.call("SetLevel", "d", [Math.min(1, Math.max(MIN_BRIGHTNESS, level))], 5000);
        return { ok: true, value: undefined };
      } catch (error) {
        return remoteSettingsFailure(BRIGHTNESS_INTERFACE, error, "The brightness did not change.");
      }
    },
    dispose: () => service.dispose(),
  };
}

/** Settings owns this session-bus connection. */
export async function connectBrightness(): Promise<BrightnessClient> {
  const bus = await SessionBus.connect();
  try {
    const client = await observeBrightness(bus);
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

export type FakeBrightness = BrightnessClient & {
  emit(status: BrightnessStatus): void;
  /** The next setLevel fails with this code (once). */
  failNext(code: SettingsErrorCode): void;
  readonly levels: readonly number[];
};

/** An in-memory client for UI smokes and the gallery. */
export function createFakeBrightnessClient(
  status: BrightnessStatus = { kind: "ready", device: "intel_backlight", type: "raw", level: 0.6 },
): FakeBrightness {
  let revision = 1;
  let state: ServiceClientState<BrightnessStatus> = {
    kind: "ready",
    owner: ":fake.1",
    revision,
    status,
  };
  let failure: SettingsErrorCode | null = null;
  const levels: number[] = [];
  const listeners = new Set<(state: ServiceClientState<BrightnessStatus>) => void>();
  const emit = (next: BrightnessStatus) => {
    state = { kind: "ready", owner: ":fake.1", revision: ++revision, status: next };
    for (const listener of [...listeners]) listener(state);
  };
  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    async setLevel(level) {
      levels.push(level);
      if (failure) {
        const code = failure;
        failure = null;
        return settingsFailure(code, "The brightness did not change.");
      }
      const current = state.kind === "ready" ? state.status : null;
      if (current?.kind !== "ready")
        return settingsFailure("unavailable", "This computer has no adjustable backlight.");
      emit({ ...current, level: Math.min(1, Math.max(MIN_BRIGHTNESS, level)) });
      return { ok: true, value: undefined };
    },
    emit,
    failNext(code) {
      failure = code;
    },
    levels,
    async dispose() {
      listeners.clear();
    },
  };
}
