/**
 * Date & time: systemd-timedated on the system bus, exported to Settings as
 * org.moire.TimeSettings1. timedated is activated on demand and exits when idle, so it is read
 * when asked (and at most every 15 s), never polled.
 */
import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { DbusRemoteError, SessionBus, type DbusMethodContext } from "@moire/dbus";
import { SettingsServiceError } from "@moire/system-management/settings-service";
import {
  parseZoneCatalog,
  TIME_SETTINGS_INTERFACE,
  TIME_SETTINGS_PATH,
  UTC_ZONE,
  ZONE_ID_PATTERN,
  type TimeStatus,
  type TimeZoneEntry,
} from "@moire/system-management/time-settings";

const TIMEDATE = "org.freedesktop.timedate1";
const TIMEDATE_PATH = "/org/freedesktop/timedate1";
const PROPERTIES = "org.freedesktop.DBus.Properties";
export const SYSTEM_BUS_ADDRESS = "unix:path=/run/dbus/system_bus_socket";
const STALE_MS = 15_000;

export type TimeAdapter = {
  status(options?: { fresh?: boolean }): Promise<TimeStatus>;
  zones(): readonly TimeZoneEntry[];
  setTimeZone(zone: string): Promise<void>;
  setNetworkTime(enabled: boolean): Promise<void>;
  dispose(): Promise<void>;
};

/** Read tzdata's tables from the zoneinfo directory NixOS links at /etc/zoneinfo. */
export function loadZoneCatalog(
  directories = [process.env.TZDIR, "/etc/zoneinfo", "/usr/share/zoneinfo"],
): TimeZoneEntry[] {
  for (const directory of directories) {
    if (!directory) continue;
    try {
      const zones = fs.readFileSync(path.join(directory, "zone1970.tab"), "utf8");
      let countries = "";
      try {
        countries = fs.readFileSync(path.join(directory, "iso3166.tab"), "utf8");
      } catch {
        // Country names only enrich search; codes still match.
      }
      return parseZoneCatalog(zones, countries);
    } catch {
      // Try the next location.
    }
  }
  return [UTC_ZONE];
}

function property(raw: Record<string, unknown>, key: string, signature: string): unknown {
  const value = raw[key] as { signature?: string; value?: unknown } | undefined;
  if (!value || value.signature !== signature) throw new Error(`Invalid timedated ${key}`);
  return value.value;
}

/** Map timedated and polkit refusals to codes; their own text never reaches the UI. */
function timedateFailure(error: unknown): SettingsServiceError {
  if (error instanceof SettingsServiceError) return error;
  const name = error instanceof DbusRemoteError ? error.errorName : "";
  if (
    name === "org.freedesktop.DBus.Error.AccessDenied" ||
    name === "org.freedesktop.DBus.Error.InteractiveAuthorizationRequired"
  )
    return new SettingsServiceError("permission", "System policy does not allow this change.");
  if (name === "org.freedesktop.DBus.Error.InvalidArgs")
    return new SettingsServiceError("invalid", "The system does not know that time zone.");
  if (
    name === "org.freedesktop.DBus.Error.ServiceUnknown" ||
    name === "org.freedesktop.DBus.Error.NameHasNoOwner"
  )
    return new SettingsServiceError("unavailable", "The system time service is not available.");
  if (name === "org.freedesktop.timedate1.NoNTPSupport")
    return new SettingsServiceError("unavailable", "No network time service is installed.");
  return new SettingsServiceError("failed", "The system time service refused the change.");
}

export async function createTimedatedAdapter(
  options: {
    connect?: () => Promise<SessionBus>;
    zones?: () => readonly TimeZoneEntry[];
    timeoutMs?: number;
    now?: () => number;
  } = {},
): Promise<TimeAdapter> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const now = options.now ?? Date.now;
  let catalog: readonly TimeZoneEntry[] | null = null;
  const zones = () => (catalog ??= Object.freeze((options.zones ?? loadZoneCatalog)()));
  let bus: SessionBus | null = null;
  let cached: { at: number; status: TimeStatus } | null = null;
  let reading: Promise<TimeStatus> | null = null;
  const connection = async () => {
    if (bus) return bus;
    bus = await (options.connect
      ? options.connect()
      : SessionBus.connect(SYSTEM_BUS_ADDRESS, { timeoutMs }));
    bus.onDisconnect(() => {
      bus = null;
    });
    return bus;
  };
  const read = async (): Promise<TimeStatus> => {
    try {
      const system = await connection();
      const reply = await system.call(
        {
          destination: TIMEDATE,
          path: TIMEDATE_PATH,
          interface: PROPERTIES,
          member: "GetAll",
          signature: "s",
          body: [TIMEDATE],
        },
        { timeoutMs },
      );
      const raw = reply.body?.[0];
      if (reply.signature !== "a{sv}" || !raw || typeof raw !== "object")
        throw new Error("Invalid timedated reply");
      const props = raw as Record<string, unknown>;
      const zone = property(props, "Timezone", "s");
      if (typeof zone !== "string" || (zone && !ZONE_ID_PATTERN.test(zone)))
        throw new Error("Invalid timedated zone");
      const flag = (key: string) => {
        const value = property(props, key, "b");
        if (typeof value !== "boolean") throw new Error(`Invalid timedated ${key}`);
        return value;
      };
      return {
        kind: "ready",
        timeZone: zone,
        ntp: {
          available: flag("CanNTP"),
          enabled: flag("NTP"),
          synchronized: flag("NTPSynchronized"),
        },
        localRtc: flag("LocalRTC"),
        readAtMs: now(),
      };
    } catch (error) {
      const failure = timedateFailure(error);
      return {
        kind: failure.code === "unavailable" ? "unavailable" : "error",
        message:
          failure.code === "unavailable"
            ? failure.message
            : "Unable to read the system time settings.",
      };
    }
  };
  const status = async (request: { fresh?: boolean } = {}) => {
    if (!request.fresh && cached && now() - cached.at < STALE_MS) return cached.status;
    reading ??= read().finally(() => {
      reading = null;
    });
    const next = await reading;
    cached = { at: now(), status: next };
    return next;
  };
  const invoke = async (member: string, signature: string, body: unknown[]) => {
    try {
      const system = await connection();
      // interactive=false: no agent is registered, so polkit must decide from rules alone.
      await system.call(
        {
          destination: TIMEDATE,
          path: TIMEDATE_PATH,
          interface: TIMEDATE,
          member,
          signature,
          body,
        },
        { timeoutMs: 30_000 },
      );
    } catch (error) {
      throw timedateFailure(error);
    } finally {
      cached = null;
    }
  };
  return {
    status,
    zones,
    async setTimeZone(zone) {
      const known = zones();
      if (
        !ZONE_ID_PATTERN.test(zone) ||
        (known.length > 1 && !known.some((entry) => entry.id === zone))
      )
        throw new SettingsServiceError("invalid", "That is not a known time zone.");
      await invoke("SetTimezone", "sb", [zone, false]);
    },
    async setNetworkTime(enabled) {
      await invoke("SetNTP", "bb", [enabled, false]);
    },
    async dispose() {
      bus?.close();
      bus = null;
    },
  };
}

function argumentsFor(context: DbusMethodContext, signature: string): unknown[] {
  if ((context.message.signature ?? "") !== signature)
    throw new SettingsServiceError("invalid", "Invalid arguments.");
  return context.body;
}

/** Export org.moire.TimeSettings1 on the already-owned session name. */
export function attachTimeSettings(bus: SessionBus, adapter: TimeAdapter) {
  let revision = 0;
  let published: TimeStatus | null = null;
  let busy = false;
  const publish = (status: TimeStatus) => {
    if (published && isDeepStrictEqual({ ...published, readAtMs: 0 }, { ...status, readAtMs: 0 }))
      return;
    published = status;
    revision++;
    bus.emitSignal({
      path: TIME_SETTINGS_PATH,
      interface: TIME_SETTINGS_INTERFACE,
      member: "Changed",
      signature: "s",
      body: [JSON.stringify({ revision, status })],
    });
  };
  const snapshot = async (fresh: boolean) => {
    const status = await adapter.status({ fresh });
    publish(status);
    return JSON.stringify({ revision, status });
  };
  const mutate = async (run: () => Promise<void>) => {
    if (busy)
      throw new SettingsServiceError("busy", "Another date and time change is running.").remote(
        TIME_SETTINGS_INTERFACE,
      );
    busy = true;
    try {
      await run();
    } catch (error) {
      throw (
        error instanceof SettingsServiceError
          ? error
          : new SettingsServiceError("failed", "The change did not complete.")
      ).remote(TIME_SETTINGS_INTERFACE);
    } finally {
      busy = false;
      await snapshot(true).catch(() => {});
    }
    return {};
  };
  const guard =
    <T>(handler: (context: DbusMethodContext) => Promise<T>) =>
    async (context: DbusMethodContext) => {
      try {
        return await handler(context);
      } catch (error) {
        if (error instanceof SettingsServiceError) throw error.remote(TIME_SETTINGS_INTERFACE);
        throw error;
      }
    };
  const unexport = bus.exportObject(TIME_SETTINGS_PATH, {
    name: TIME_SETTINGS_INTERFACE,
    methods: {
      GetStatus: {
        inSignature: "",
        outSignature: "s",
        handler: guard(async (context) => {
          argumentsFor(context, "");
          return { body: [await snapshot(false)] };
        }),
      },
      Refresh: {
        inSignature: "",
        outSignature: "",
        handler: guard(async (context) => {
          argumentsFor(context, "");
          await snapshot(true);
          return {};
        }),
      },
      GetTimeZones: {
        inSignature: "",
        outSignature: "s",
        handler: guard(async (context) => {
          argumentsFor(context, "");
          return { body: [JSON.stringify(adapter.zones())] };
        }),
      },
      SetTimeZone: {
        inSignature: "s",
        outSignature: "",
        handler: guard(async (context) => {
          const [zone] = argumentsFor(context, "s");
          return mutate(() => adapter.setTimeZone(String(zone)));
        }),
      },
      SetNetworkTime: {
        inSignature: "b",
        outSignature: "",
        handler: guard(async (context) => {
          const [enabled] = argumentsFor(context, "b");
          return mutate(() => adapter.setNetworkTime(enabled === true));
        }),
      },
    },
  });
  return {
    async dispose() {
      unexport();
      await adapter.dispose();
    },
  };
}
