/**
 * Date & time settings: the system time zone and network time, through the management service,
 * which talks to systemd-timedated (`org.freedesktop.timedate1`) on the system bus.
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

export const TIME_SETTINGS_PATH = "/org/moire/TimeSettings1";
export const TIME_SETTINGS_INTERFACE = "org.moire.TimeSettings1";

// ---------------------------------------------------------------------------------------------
// Zone catalog (pure; shared by the service, which reads tzdata, and the UI, which searches it)

export type TimeZoneEntry = {
  /** IANA identifier, the value `setTimeZone` takes: `America/Argentina/Buenos_Aires`. */
  id: string;
  /** First path element: `America`, `Europe`, `Etc` for UTC. */
  region: string;
  /** Middle element for three-part ids (`Argentina`), else empty. */
  subregion: string;
  /** Last element, readable: `Buenos Aires`. */
  city: string;
  /** ISO 3166 countries using this zone, as tzdata lists them. */
  countries: readonly { code: string; name: string }[];
  /** tzdata's own note, such as `Mountain (most areas)`; often empty. */
  comment: string;
  /** Lower-cased, accent-folded words search matches against. */
  keywords: readonly string[];
};

export const UTC_ZONE: TimeZoneEntry = Object.freeze({
  id: "UTC",
  region: "Etc",
  subregion: "",
  city: "UTC",
  countries: [],
  comment: "Coordinated Universal Time",
  keywords: ["utc", "gmt", "coordinated", "universal", "time", "zulu"],
});

export const ZONE_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;

/** Lower case without diacritics, so "zurich" finds Zürich and "sao" finds São Paulo. */
export function foldSearchText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function words(text: string): string[] {
  return foldSearchText(text)
    .split(/[^\p{L}\p{N}+-]+/u)
    .filter(Boolean);
}

/**
 * Parse tzdata's `zone1970.tab` (one row per zone, countries comma-separated) and
 * `iso3166.tab` (country names). Malformed rows are skipped; UTC is always present.
 */
export function parseZoneCatalog(zone1970: string, iso3166 = ""): TimeZoneEntry[] {
  const names = new Map<string, string>();
  for (const line of iso3166.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [code, name] = line.split("\t");
    if (code && name && /^[A-Z]{2}$/.test(code)) names.set(code, name.trim());
  }
  const entries = new Map<string, TimeZoneEntry>([[UTC_ZONE.id, UTC_ZONE]]);
  for (const line of zone1970.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [codes, , id, comment = ""] = line.split("\t");
    if (!codes || !id || !ZONE_ID_PATTERN.test(id) || entries.has(id) || entries.size > 2048)
      continue;
    const parts = id.split("/");
    const countries = codes
      .split(",")
      .filter((code) => /^[A-Z]{2}$/.test(code))
      .map((code) => ({ code, name: names.get(code) ?? code }));
    const city = parts[parts.length - 1]!.replace(/_/g, " ");
    const region = parts.length > 1 ? parts[0]! : "Etc";
    const subregion = parts.length === 3 ? parts[1]!.replace(/_/g, " ") : "";
    const keywords = new Set([
      ...words(city),
      ...words(region),
      ...words(subregion),
      ...countries.flatMap((country) => [country.code.toLowerCase(), ...words(country.name)]),
      ...words(comment),
    ]);
    entries.set(
      id,
      Object.freeze({
        id,
        region,
        subregion,
        city,
        countries: Object.freeze(countries),
        comment: comment.trim(),
        keywords: Object.freeze([...keywords]),
      }),
    );
  }
  return [...entries.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Rank zones for a search: city prefix, then any word prefix, then substring. Every query word
 * must match. An empty query returns the catalog in order.
 */
export function searchTimeZones(
  entries: readonly TimeZoneEntry[],
  query: string,
  limit = 50,
): TimeZoneEntry[] {
  const terms = words(query);
  if (!terms.length) return entries.slice(0, limit);
  const scored: { entry: TimeZoneEntry; score: number }[] = [];
  for (const entry of entries) {
    const city = foldSearchText(entry.city);
    const id = foldSearchText(entry.id);
    let score = 0;
    for (const term of terms) {
      if (city.startsWith(term)) score += 4;
      else if (entry.keywords.some((word) => word.startsWith(term))) score += 2;
      else if (id.includes(term) || entry.keywords.some((word) => word.includes(term))) score += 1;
      else {
        score = 0;
        break;
      }
    }
    if (score) scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.entry.city.localeCompare(b.entry.city))
    .slice(0, limit)
    .map((item) => item.entry);
}

export function parseTimeZoneEntries(value: unknown): TimeZoneEntry[] {
  if (!Array.isArray(value) || value.length > 4096) throw new Error("Invalid time zone catalog");
  return value.map((raw: Record<string, unknown>) => {
    const id = bounded(raw?.id, 128, "time zone");
    if (!ZONE_ID_PATTERN.test(id)) throw new Error("Invalid time zone");
    if (!Array.isArray(raw.countries) || !Array.isArray(raw.keywords))
      throw new Error("Invalid time zone entry");
    return {
      id,
      region: bounded(raw.region, 64, "time zone region"),
      subregion: bounded(raw.subregion, 64, "time zone region"),
      city: bounded(raw.city, 128, "time zone city"),
      countries: raw.countries.slice(0, 32).map((country: Record<string, unknown>) => ({
        code: bounded(country?.code, 2, "country"),
        name: bounded(country?.name, 128, "country"),
      })),
      comment: bounded(raw.comment, 256, "time zone comment"),
      keywords: raw.keywords.slice(0, 64).map((word) => bounded(word, 128, "keyword")),
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Status

export type TimeStatus =
  | { kind: "unavailable" | "error"; message: string }
  | {
      kind: "ready";
      /** IANA id timedated reports; empty when /etc/localtime is missing (treated as UTC). */
      timeZone: string;
      /** Network time: `available` is false when no NTP service is installed. */
      ntp: { available: boolean; enabled: boolean; synchronized: boolean };
      /** The hardware clock keeps local time (dual boot); shown only, never changed here. */
      localRtc: boolean;
      /** System clock (ms since epoch) when timedated was read; the UI ticks from `Date.now()`. */
      readAtMs: number;
    };

export function parseTimeStatus(value: unknown): TimeStatus {
  if (!value || typeof value !== "object") throw new Error("Invalid time status");
  const raw = value as Record<string, unknown>;
  if (raw.kind === "unavailable" || raw.kind === "error")
    return { kind: raw.kind, message: bounded(raw.message, 512, "time message") };
  if (raw.kind !== "ready") throw new Error("Invalid time status kind");
  const ntp = raw.ntp as Record<string, unknown> | undefined;
  const timeZone = bounded(raw.timeZone, 128, "time zone");
  if (timeZone && !ZONE_ID_PATTERN.test(timeZone)) throw new Error("Invalid time zone");
  if (
    !ntp ||
    typeof ntp.available !== "boolean" ||
    typeof ntp.enabled !== "boolean" ||
    typeof ntp.synchronized !== "boolean" ||
    typeof raw.localRtc !== "boolean" ||
    typeof raw.readAtMs !== "number" ||
    !Number.isFinite(raw.readAtMs)
  )
    throw new Error("Invalid time status");
  return {
    kind: "ready",
    timeZone,
    ntp: { available: ntp.available, enabled: ntp.enabled, synchronized: ntp.synchronized },
    localRtc: raw.localRtc,
    readAtMs: raw.readAtMs,
  };
}

// ---------------------------------------------------------------------------------------------
// Client

export type TimeSettingsState = ServiceClientState<TimeStatus>;

export type TimeSettingsClient = {
  readonly state: TimeSettingsState;
  /** Called at once with the current state, then on every change. Returns the unsubscribe. */
  subscribe(listener: (state: TimeSettingsState) => void): () => void;
  /** Re-read timedated (sync status changes without a signal). */
  refresh(): Promise<SettingsResult>;
  /** The zone catalog, read once from tzdata by the service and cached here. */
  timeZones(): Promise<SettingsResult<readonly TimeZoneEntry[]>>;
  setTimeZone(id: string): Promise<SettingsResult>;
  setNetworkTime(enabled: boolean): Promise<SettingsResult>;
  dispose(): Promise<void>;
};

const FALLBACK = "The date and time change did not complete.";

/** Observe the session service on a bus the caller owns. */
export async function observeTimeSettings(bus: SessionBus): Promise<TimeSettingsClient> {
  const observer = await observeSettingsService(bus, {
    path: TIME_SETTINGS_PATH,
    iface: TIME_SETTINGS_INTERFACE,
    parse: parseTimeStatus,
    label: "date and time settings",
  });
  let zones: readonly TimeZoneEntry[] | null = null;
  const run = async (member: string, signature: string, body: unknown[]) => {
    try {
      await observer.call(member, signature, body);
      return { ok: true as const, value: undefined };
    } catch (error) {
      return remoteSettingsFailure(TIME_SETTINGS_INTERFACE, error, FALLBACK);
    }
  };
  return {
    get state() {
      return observer.state;
    },
    subscribe: observer.subscribe,
    refresh: () => run("Refresh", "", []),
    async timeZones() {
      if (zones) return { ok: true, value: zones };
      try {
        const [raw] = await observer.call("GetTimeZones", "", [], 10000);
        zones = Object.freeze(parseTimeZoneEntries(JSON.parse(bounded(raw, 4 << 20, "zones"))));
        return { ok: true, value: zones };
      } catch (error) {
        return remoteSettingsFailure(TIME_SETTINGS_INTERFACE, error, "Time zones are unavailable.");
      }
    },
    setTimeZone(id) {
      if (!ZONE_ID_PATTERN.test(id))
        return Promise.resolve(settingsFailure("invalid", "That is not a time zone."));
      return run("SetTimeZone", "s", [id]);
    },
    setNetworkTime: (enabled) => run("SetNetworkTime", "b", [enabled]),
    dispose: observer.dispose,
  };
}

/** Settings owns this session-bus connection. */
export async function connectTimeSettings(): Promise<TimeSettingsClient> {
  const bus = await SessionBus.connect();
  try {
    const client = await observeTimeSettings(bus);
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

// ---------------------------------------------------------------------------------------------
// Fake for UI smokes and the gallery

export type FakeTimeSettings = TimeSettingsClient & {
  /** Replace the status and notify subscribers, as the service's `Changed` signal would. */
  emit(status: TimeStatus): void;
  /** The next setter fails with this code (once). */
  failNext(code: SettingsErrorCode): void;
  readonly calls: readonly { member: string; args: readonly unknown[] }[];
};

export function createFakeTimeSettingsClient(
  options: { status?: TimeStatus; zones?: readonly TimeZoneEntry[] } = {},
): FakeTimeSettings {
  let revision = 1;
  let status: TimeStatus = options.status ?? {
    kind: "ready",
    timeZone: "Europe/London",
    ntp: { available: true, enabled: true, synchronized: true },
    localRtc: false,
    readAtMs: Date.now(),
  };
  let state: TimeSettingsState = { kind: "ready", owner: ":fake.1", revision, status };
  let failure: SettingsErrorCode | null = null;
  const listeners = new Set<(state: TimeSettingsState) => void>();
  const calls: { member: string; args: readonly unknown[] }[] = [];
  const zones = options.zones ?? [UTC_ZONE];
  const emit = (next: TimeStatus) => {
    status = next;
    state = { kind: "ready", owner: ":fake.1", revision: ++revision, status };
    for (const listener of [...listeners]) listener(state);
  };
  const mutate = async (
    member: string,
    args: unknown[],
    apply: (ready: Extract<TimeStatus, { kind: "ready" }>) => TimeStatus,
  ): Promise<SettingsResult> => {
    calls.push({ member, args });
    if (failure) {
      const code = failure;
      failure = null;
      return settingsFailure(code, `Fake ${code}`);
    }
    if (status.kind !== "ready") return settingsFailure("unavailable", status.message);
    emit(apply(status));
    return { ok: true, value: undefined };
  };
  return {
    get state() {
      return state;
    },
    calls,
    emit,
    failNext(code) {
      failure = code;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    refresh: () => mutate("Refresh", [], (ready) => ready),
    async timeZones() {
      return { ok: true, value: zones };
    },
    setTimeZone(id) {
      if (!ZONE_ID_PATTERN.test(id))
        return Promise.resolve(settingsFailure("invalid", "That is not a time zone."));
      return mutate("SetTimeZone", [id], (ready) => ({ ...ready, timeZone: id }));
    },
    setNetworkTime: (enabled) =>
      mutate("SetNetworkTime", [enabled], (ready) => ({
        ...ready,
        ntp: { ...ready.ntp, enabled, synchronized: enabled && ready.ntp.synchronized },
      })),
    async dispose() {
      listeners.clear();
    },
  };
}

export type { SettingsErrorCode, SettingsFailure, SettingsResult } from "./settings-service";
