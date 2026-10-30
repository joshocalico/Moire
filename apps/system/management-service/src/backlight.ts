/**
 * Screen brightness: the session's backlight, read from `/sys/class/backlight` and set through
 * logind's `Session.SetBrightness`, which lets a session's owner change it without root or
 * polkit. Exported to Settings as org.moire.Brightness1. Without a backlight the status is
 * `unavailable` with a sentence Settings shows as is.
 */
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { DbusRemoteError, SessionBus, type DbusMethodContext } from "@moire/dbus";
import { SettingsServiceError } from "@moire/system-management/settings-service";
import {
  BACKLIGHT_TYPES,
  BRIGHTNESS_INTERFACE,
  BRIGHTNESS_PATH,
  MIN_BRIGHTNESS,
  type BacklightType,
  type BrightnessStatus,
} from "@moire/system-management/brightness";

export const BACKLIGHT_ROOT = "/sys/class/backlight";
const LOGIN1 = "org.freedesktop.login1";
const SYSTEM_BUS_ADDRESS = "unix:path=/run/dbus/system_bus_socket";
/** Brightness keys change the backlight behind our back; follow them this often. */
const POLL_MS = 3000;

export const NO_BACKLIGHT =
  "This display has no adjustable backlight. Virtual machines and most desktop monitors don't; use the monitor's own buttons.";

export type Backlight = { name: string; type: BacklightType; max: number; current: number };

function readNumber(file: string): number | null {
  try {
    const value = Number(fs.readFileSync(file, "utf8").trim());
    return Number.isInteger(value) && value >= 0 ? value : null;
  } catch {
    return null;
  }
}

/** Every usable backlight under `root`, in the order to prefer them. */
export function readBacklights(root = BACKLIGHT_ROOT): Backlight[] {
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return [];
  }
  const found: Backlight[] = [];
  for (const name of names.slice(0, 32)) {
    if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(name)) continue;
    const directory = path.join(root, name);
    let type: string;
    try {
      type = fs.readFileSync(path.join(directory, "type"), "utf8").trim();
    } catch {
      continue;
    }
    if (!BACKLIGHT_TYPES.includes(type as BacklightType)) continue;
    const max = readNumber(path.join(directory, "max_brightness"));
    const current =
      readNumber(path.join(directory, "actual_brightness")) ??
      readNumber(path.join(directory, "brightness"));
    if (!max || current == null) continue;
    found.push({ name, type: type as BacklightType, max, current: Math.min(current, max) });
  }
  // Firmware interfaces know the panel best; raw ones are a driver's register.
  return found.sort(
    (a, b) =>
      BACKLIGHT_TYPES.indexOf(a.type) - BACKLIGHT_TYPES.indexOf(b.type) ||
      a.name.localeCompare(b.name),
  );
}

export function backlightStatus(backlights: readonly Backlight[]): BrightnessStatus {
  const chosen = backlights[0];
  if (!chosen) return { kind: "unavailable", message: NO_BACKLIGHT };
  return {
    kind: "ready",
    device: chosen.name,
    type: chosen.type,
    level: Math.round((chosen.current / chosen.max) * 1000) / 1000,
  };
}

/** The raw value for a level: never zero, which turns some panels fully off. */
export function rawBrightness(level: number, max: number): number {
  const clamped = Math.min(1, Math.max(MIN_BRIGHTNESS, level));
  return Math.max(1, Math.min(max, Math.round(clamped * max)));
}

/** Sets a backlight's raw value; throws SettingsServiceError. */
export type BrightnessSetter = (device: string, raw: number) => Promise<void>;

/**
 * logind's setter. The session is `XDG_SESSION_ID`'s, else the user's display session, else
 * the caller's own (`session/auto`).
 */
export function createLogindBrightnessSetter(
  options: { connect?: () => Promise<SessionBus>; sessionId?: string; timeoutMs?: number } = {},
): BrightnessSetter & { dispose(): void } {
  const timeoutMs = options.timeoutMs ?? 3000;
  let bus: SessionBus | null = null;
  let session: string | null = null;
  const connect = async () =>
    (bus ??= await (options.connect
      ? options.connect()
      : SessionBus.connect(SYSTEM_BUS_ADDRESS, { timeoutMs })));
  const findSession = async (system: SessionBus): Promise<string> => {
    const id = options.sessionId ?? process.env.XDG_SESSION_ID;
    if (id) {
      const reply = await system.call(
        {
          destination: LOGIN1,
          path: "/org/freedesktop/login1",
          interface: "org.freedesktop.login1.Manager",
          member: "GetSession",
          signature: "s",
          body: [id],
        },
        { timeoutMs },
      );
      if (typeof reply.body?.[0] === "string") return reply.body[0];
    }
    try {
      const reply = await system.call(
        {
          destination: LOGIN1,
          path: "/org/freedesktop/login1/user/self",
          interface: "org.freedesktop.DBus.Properties",
          member: "Get",
          signature: "ss",
          body: ["org.freedesktop.login1.User", "Display"],
        },
        { timeoutMs },
      );
      const display = (reply.body?.[0] as { value?: unknown } | undefined)?.value;
      const objectPath = Array.isArray(display) ? display[1] : null;
      if (typeof objectPath === "string" && objectPath !== "/") return objectPath;
    } catch {
      // Fall through to the caller's own session.
    }
    return "/org/freedesktop/login1/session/auto";
  };
  const setter = async (device: string, raw: number) => {
    let system: SessionBus;
    try {
      system = await connect();
    } catch {
      throw new SettingsServiceError("unavailable", "The system bus is unavailable.");
    }
    try {
      session ??= await findSession(system);
      await system.call(
        {
          destination: LOGIN1,
          path: session,
          interface: "org.freedesktop.login1.Session",
          member: "SetBrightness",
          signature: "ssu",
          body: ["backlight", device, raw],
        },
        { timeoutMs },
      );
    } catch (error) {
      session = null;
      const name = error instanceof DbusRemoteError ? error.errorName : "";
      if (name === "org.freedesktop.DBus.Error.AccessDenied")
        throw new SettingsServiceError(
          "permission",
          "Only the person signed in at this screen can change its brightness.",
        );
      if (name.endsWith("UnknownMethod") || name.endsWith("NoSuchSession"))
        throw new SettingsServiceError(
          "unavailable",
          "This system's logind can't set brightness for the session.",
        );
      throw new SettingsServiceError("failed", "The brightness did not change.");
    }
  };
  return Object.assign(setter, {
    dispose() {
      bus?.close();
      bus = null;
    },
  });
}

function argumentsFor(context: DbusMethodContext, signature: string): unknown[] {
  if ((context.message.signature ?? "") !== signature)
    throw new SettingsServiceError("invalid", "Unexpected arguments.");
  return context.body;
}

export type BrightnessControlsOptions = {
  root?: string;
  set?: BrightnessSetter;
  pollMs?: number;
  onError?: (error: unknown) => void;
};

/** Export org.moire.Brightness1 on the session service. */
export function attachBrightnessControls(
  bus: SessionBus,
  options: BrightnessControlsOptions = {},
): { dispose(): Promise<void> } {
  const root = options.root ?? BACKLIGHT_ROOT;
  const logind = options.set ? null : createLogindBrightnessSetter();
  const set = options.set ?? logind!;
  let revision = 1;
  let backlights = readBacklights(root);
  let status = backlightStatus(backlights);
  let busy = false;
  const snapshot = () => JSON.stringify({ revision, status });
  const refresh = () => {
    backlights = readBacklights(root);
    const next = backlightStatus(backlights);
    if (isDeepStrictEqual(next, status)) return;
    status = next;
    revision++;
    try {
      bus.emitSignal({
        path: BRIGHTNESS_PATH,
        interface: BRIGHTNESS_INTERFACE,
        member: "Changed",
        signature: "s",
        body: [snapshot()],
      });
    } catch (error) {
      options.onError?.(error);
    }
  };
  // Without a backlight there is nothing to follow.
  const timer = backlights.length ? setInterval(refresh, options.pollMs ?? POLL_MS) : null;
  timer?.unref();
  const guard =
    (handler: (context: DbusMethodContext) => Promise<{ body?: unknown[] }>) =>
    async (context: DbusMethodContext) => {
      try {
        return await handler(context);
      } catch (error) {
        throw (
          error instanceof SettingsServiceError
            ? error
            : new SettingsServiceError("failed", "The brightness did not change.")
        ).remote(BRIGHTNESS_INTERFACE);
      }
    };
  const unexport = bus.exportObject(BRIGHTNESS_PATH, {
    name: BRIGHTNESS_INTERFACE,
    methods: {
      GetStatus: {
        inSignature: "",
        outSignature: "s",
        handler: guard(async (context) => {
          argumentsFor(context, "");
          return { body: [snapshot()] };
        }),
      },
      SetLevel: {
        inSignature: "d",
        outSignature: "",
        handler: guard(async (context) => {
          const [level] = argumentsFor(context, "d");
          if (typeof level !== "number" || !Number.isFinite(level) || level < 0 || level > 1)
            throw new SettingsServiceError("invalid", "That is not a brightness.");
          const chosen = backlights[0];
          if (!chosen) throw new SettingsServiceError("unavailable", NO_BACKLIGHT);
          if (busy) throw new SettingsServiceError("busy", "Another brightness change is running.");
          busy = true;
          try {
            await set(chosen.name, rawBrightness(level, chosen.max));
          } finally {
            busy = false;
            refresh();
          }
          return {};
        }),
      },
    },
  });
  return {
    async dispose() {
      if (timer) clearInterval(timer);
      unexport();
      logind?.dispose();
    },
  };
}
