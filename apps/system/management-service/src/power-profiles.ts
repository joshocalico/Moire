/**
 * Power profiles: power-profiles-daemon (`net.hadess.PowerProfiles`) on the system bus, exported
 * to Settings as org.moire.Power1. The daemon is never activated through D-Bus; when it is not
 * running the status is `unavailable` and Settings hides the power mode row.
 *
 * The user's choice is also kept in prefs (`power.powerProfile`) and applied when the daemon
 * first appears in this session, so it follows the user rather than the machine.
 */
import { isDeepStrictEqual } from "node:util";
import {
  DbusRemoteError,
  SessionBus,
  variant,
  type DbusDisposer,
  type DbusMethodContext,
} from "@moire/dbus";
import { loadPowerSettings, updatePowerSettings } from "@moire/prefs";
import { SettingsServiceError } from "@moire/system-management/settings-service";
import {
  POWER_CHOICES,
  POWER_INTERFACE,
  POWER_PATH,
  parsePowerProfile,
  type PowerProfile,
  type PowerProfilesStatus,
} from "@moire/system-management/power-settings";

export const PPD_BUS = "net.hadess.PowerProfiles";
export const PPD_PATH = "/net/hadess/PowerProfiles";
export const PPD_INTERFACE = "net.hadess.PowerProfiles";
const PROPERTIES = "org.freedesktop.DBus.Properties";
const SYSTEM_BUS_ADDRESS = "unix:path=/run/dbus/system_bus_socket";

export type PowerProfilesAdapter = {
  readonly status: PowerProfilesStatus;
  subscribe(listener: () => void): () => void;
  /** Re-read the daemon's properties. */
  refresh(): Promise<void>;
  /** Throws SettingsServiceError; the daemon's own error text never reaches the UI. */
  setProfile(profile: PowerProfile): Promise<void>;
  dispose(): Promise<void>;
};

export type PowerProfilesOptions = {
  connect?: () => Promise<SessionBus>;
  callTimeoutMs?: number;
};

const UNAVAILABLE_MESSAGE = "Power modes need power-profiles-daemon, which is not running.";
const UNAVAILABLE: PowerProfilesStatus = Object.freeze({
  kind: "unavailable",
  message: UNAVAILABLE_MESSAGE,
});

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Buffer.isBuffer(value))
    throw new Error("Invalid power-profiles-daemon dictionary");
  return value as Record<string, unknown>;
}

function property(raw: Record<string, unknown>, key: string, signature: string): unknown {
  const value = raw[key] as { signature?: unknown; value?: unknown } | undefined;
  if (!value || value.signature !== signature) throw new Error(`Invalid ${key}`);
  return value.value;
}

/** Map the daemon's `GetAll` reply to the status Settings sees; unknown profiles are dropped. */
export function powerProfilesStatus(properties: Record<string, unknown>): PowerProfilesStatus {
  const rawProfiles = property(properties, "Profiles", "aa{sv}");
  if (!Array.isArray(rawProfiles) || rawProfiles.length > 16) throw new Error("Invalid Profiles");
  const listed = new Set<string>();
  for (const entry of rawProfiles) {
    const name = property(record(entry), "Profile", "s");
    if (typeof name === "string") listed.add(name);
  }
  const profiles = POWER_CHOICES.powerProfile.filter((profile) => listed.has(profile));
  const active = parsePowerProfile(property(properties, "ActiveProfile", "s"));
  let degraded: string | null = null;
  if ("PerformanceDegraded" in properties) {
    const reason = property(properties, "PerformanceDegraded", "s");
    if (typeof reason === "string" && reason.length > 0) degraded = reason.slice(0, 256);
  }
  return { kind: "ready", profiles, active, degraded };
}

/** Daemon and polkit refusals become codes; their own text never reaches the UI. */
function profileFailure(error: unknown): SettingsServiceError {
  if (error instanceof SettingsServiceError) return error;
  const name = error instanceof DbusRemoteError ? error.errorName : "";
  if (
    name === "org.freedesktop.DBus.Error.AccessDenied" ||
    name === "org.freedesktop.DBus.Error.InteractiveAuthorizationRequired"
  )
    return new SettingsServiceError(
      "permission",
      "System policy does not allow changing power mode.",
    );
  if (name === "org.freedesktop.DBus.Error.InvalidArgs")
    return new SettingsServiceError("invalid", "That power mode is not available here.");
  if (
    name === "org.freedesktop.DBus.Error.ServiceUnknown" ||
    name === "org.freedesktop.DBus.Error.NameHasNoOwner"
  )
    return new SettingsServiceError("unavailable", UNAVAILABLE_MESSAGE);
  return new SettingsServiceError("failed", "The power mode did not change.");
}

export async function createPowerProfilesAdapter(
  options: PowerProfilesOptions = {},
): Promise<PowerProfilesAdapter> {
  const timeoutMs = options.callTimeoutMs ?? 3000;
  let status: PowerProfilesStatus = UNAVAILABLE;
  let bus: SessionBus | null = null;
  let owner: string | null = null;
  let generation = 0;
  let disposed = false;
  let removeOwner: DbusDisposer | null = null;
  let removeSignal: DbusDisposer | null = null;
  let removeDisconnect = () => {};
  const listeners = new Set<() => void>();
  const publish = (next: PowerProfilesStatus) => {
    if (disposed || isDeepStrictEqual(next, status)) return;
    status = next;
    for (const listener of [...listeners]) listener();
  };
  const read = async (expected: string, ticket: number) => {
    if (!bus) return;
    try {
      const reply = await bus.call(
        {
          destination: expected,
          path: PPD_PATH,
          interface: PROPERTIES,
          member: "GetAll",
          signature: "s",
          body: [PPD_INTERFACE],
        },
        { timeoutMs },
      );
      if (ticket !== generation) return;
      if (reply.signature !== "a{sv}" || reply.body?.length !== 1)
        throw new Error("Invalid power-profiles-daemon reply");
      publish(powerProfilesStatus(record(reply.body[0])));
    } catch {
      if (ticket === generation)
        publish({ kind: "error", message: "Unable to read power-profiles-daemon." });
    }
  };
  const adapter: PowerProfilesAdapter = {
    get status() {
      return status;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async refresh() {
      if (owner) await read(owner, generation);
    },
    async setProfile(profile) {
      parsePowerProfile(profile);
      if (!bus || !owner || status.kind !== "ready")
        throw new SettingsServiceError("unavailable", UNAVAILABLE_MESSAGE);
      if (!status.profiles.includes(profile))
        throw new SettingsServiceError("invalid", "That power mode is not available here.");
      const expected = owner;
      try {
        await bus.call(
          {
            destination: expected,
            path: PPD_PATH,
            interface: PROPERTIES,
            member: "Set",
            signature: "ssv",
            body: [PPD_INTERFACE, "ActiveProfile", variant("s", profile)],
          },
          { timeoutMs },
        );
      } catch (error) {
        throw profileFailure(error);
      } finally {
        await read(expected, generation);
      }
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      listeners.clear();
      removeDisconnect();
      await Promise.allSettled([removeOwner?.(), removeSignal?.()]);
      bus?.close();
      bus = null;
    },
  };
  if (!options.connect && process.platform !== "linux") return adapter;
  try {
    bus = await (options.connect
      ? options.connect()
      : SessionBus.connect(SYSTEM_BUS_ADDRESS, { timeoutMs }));
  } catch {
    publish({ kind: "unavailable", message: "The system bus is unavailable." });
    return adapter;
  }
  const connected = bus;
  removeDisconnect = connected.onDisconnect(() => {
    generation++;
    owner = null;
    publish({ kind: "unavailable", message: "The system bus disconnected." });
  });
  try {
    removeOwner = await connected.watchName(
      PPD_BUS,
      (next) => {
        const ticket = ++generation;
        owner = next;
        const previous = removeSignal;
        removeSignal = null;
        void previous?.().catch(() => {});
        if (!next) {
          publish(UNAVAILABLE);
          return;
        }
        void (async () => {
          const remove = await connected.subscribeSignal(
            {
              sender: next,
              path: PPD_PATH,
              interface: PROPERTIES,
              member: "PropertiesChanged",
              arg0: PPD_INTERFACE,
            },
            () => {
              if (ticket === generation) void read(next, ticket);
            },
            { timeoutMs },
          );
          if (ticket !== generation || disposed) {
            await remove();
            return;
          }
          removeSignal = remove;
          await read(next, ticket);
        })().catch(() => {
          if (ticket === generation)
            publish({ kind: "error", message: "Unable to watch power-profiles-daemon." });
        });
      },
      { timeoutMs },
    );
  } catch {
    publish({ kind: "error", message: "Unable to watch power-profiles-daemon." });
  }
  return adapter;
}

export type PowerControlsOptions = {
  adapter: PowerProfilesAdapter;
  /** The stored preference, read when the daemon becomes ready. */
  preferred(): PowerProfile | null;
  /** Remember a successful user choice. */
  savePreferred(profile: PowerProfile): void;
  onError?: (error: unknown) => void;
};

function argumentsFor(context: DbusMethodContext, signature: string): unknown[] {
  if ((context.message.signature ?? "") !== signature)
    throw new SettingsServiceError("invalid", "Unexpected arguments.");
  return context.body;
}

/** Adds org.moire.Power1 to the already-owned management service name. */
export function attachPowerControls(bus: SessionBus, options: PowerControlsOptions) {
  const { adapter } = options;
  let revision = 0;
  let published: PowerProfilesStatus = adapter.status;
  let applied = false;
  let busy = false;
  const snapshot = () => JSON.stringify({ revision, status: published });
  const changed = () => {
    const next = adapter.status;
    if (next.kind !== "ready") applied = false;
    else if (!applied) {
      applied = true;
      const preferred = options.preferred();
      if (preferred && preferred !== next.active && next.profiles.includes(preferred))
        void adapter.setProfile(preferred).catch((error) => options.onError?.(error));
    }
    if (isDeepStrictEqual(next, published)) return;
    published = next;
    revision++;
    bus.emitSignal({
      path: POWER_PATH,
      interface: POWER_INTERFACE,
      member: "Changed",
      signature: "s",
      body: [snapshot()],
    });
  };
  const unsubscribe = adapter.subscribe(changed);
  changed();
  const guard =
    (handler: (context: DbusMethodContext) => Promise<{ body?: unknown[] }>) =>
    async (context: DbusMethodContext) => {
      try {
        return await handler(context);
      } catch (error) {
        throw (
          error instanceof SettingsServiceError
            ? error
            : new SettingsServiceError("failed", "The power mode did not change.")
        ).remote(POWER_INTERFACE);
      }
    };
  const unexport = bus.exportObject(POWER_PATH, {
    name: POWER_INTERFACE,
    methods: {
      GetStatus: {
        inSignature: "",
        outSignature: "s",
        handler: guard(async (context) => {
          argumentsFor(context, "");
          return { body: [snapshot()] };
        }),
      },
      SetProfile: {
        inSignature: "s",
        outSignature: "",
        handler: guard(async (context) => {
          const [raw] = argumentsFor(context, "s");
          let profile: PowerProfile;
          try {
            profile = parsePowerProfile(raw);
          } catch {
            throw new SettingsServiceError("invalid", "That is not a power mode.");
          }
          if (busy) throw new SettingsServiceError("busy", "Another power mode change is running.");
          busy = true;
          try {
            await adapter.setProfile(profile);
            options.savePreferred(profile);
          } finally {
            busy = false;
          }
          return {};
        }),
      },
    },
  });
  return {
    async dispose() {
      unsubscribe();
      unexport();
      await adapter.dispose();
    },
  };
}

/** The installed service: the system daemon, with the preference kept in the user's prefs. */
export async function attachSessionPowerControls(bus: SessionBus) {
  return attachPowerControls(bus, {
    adapter: await createPowerProfilesAdapter(),
    preferred: () => loadPowerSettings().powerProfile,
    savePreferred: (powerProfile) => {
      updatePowerSettings({ powerProfile });
    },
    onError: (error) =>
      console.warn(
        "[system-management] power profile:",
        error instanceof Error ? error.message : error,
      ),
  });
}
