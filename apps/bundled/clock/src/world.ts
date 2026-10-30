/** World clocks: IANA time-zone search, names and offsets, as pure functions of an instant. */
import { isTimeZone, localTimeZone } from "@moire/app-tools";

export type Zone = {
  /** IANA identifier, e.g. "America/Argentina/Buenos_Aires". */
  readonly id: string;
  /** The city part: "Buenos Aires". */
  readonly city: string;
  /** The regions above it: "America · Argentina". */
  readonly region: string;
};

const MAX_MATCHES = 60;

export function zoneOf(id: string): Zone {
  const parts = id.split("/").map((part) => part.replace(/_/g, " "));
  return {
    id,
    city: parts.at(-1) ?? id,
    region: parts.slice(0, -1).join(" · ") || "World",
  };
}

/**
 * ICU still lists some zones under names their cities have since dropped; people search for the
 * current name ("Kolkata", not "Calcutta"), and Intl accepts both.
 */
const CURRENT_NAMES: Readonly<Record<string, string>> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/** Every place-named IANA zone this runtime knows (no "Etc/GMT+3" style aliases). */
export function allZones(): Zone[] {
  return Intl.supportedValuesOf("timeZone")
    .filter((id) => id.includes("/") && !id.startsWith("Etc/"))
    .map((id) => {
      const current = CURRENT_NAMES[id];
      return zoneOf(current && isTimeZone(current) ? current : id);
    });
}

/**
 * Zones matching a typed query, best first: city-name prefix, then word prefix, then anywhere in
 * the identifier. Zones already shown are left out.
 */
export function searchZones(
  query: string,
  zones: readonly Zone[],
  exclude: readonly string[] = [],
): Zone[] {
  const needle = query.trim().toLowerCase().replace(/_/g, " ");
  const candidates = zones.filter((zone) => !exclude.includes(zone.id));
  if (!needle) return candidates.slice(0, MAX_MATCHES);
  const rank = (zone: Zone) => {
    const city = zone.city.toLowerCase();
    if (city.startsWith(needle)) return 0;
    if (city.split(" ").some((word) => word.startsWith(needle))) return 1;
    if (`${zone.region} ${zone.city}`.toLowerCase().includes(needle)) return 2;
    if (zone.id.toLowerCase().replace(/_/g, " ").includes(needle)) return 3;
    return -1;
  };
  return candidates
    .map((zone) => ({ zone, rank: rank(zone) }))
    .filter((match) => match.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.zone.city.localeCompare(b.zone.city))
    .slice(0, MAX_MATCHES)
    .map((match) => match.zone);
}

/** Minutes east of UTC for a zone at an instant (daylight saving included). */
export function utcOffsetMinutes(zone: string, at: number): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" })
      .formatToParts(at)
      .find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

/** "Same time", "+9:30 h" or "−3 h" relative to `from` (the local zone by default). */
export function relativeOffset(zone: string, at: number, from = localTimeZone()): string {
  const difference = utcOffsetMinutes(zone, at) - utcOffsetMinutes(from, at);
  if (difference === 0) return "Same time";
  const hours = Math.floor(Math.abs(difference) / 60),
    minutes = Math.abs(difference) % 60;
  return `${difference > 0 ? "+" : "−"}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} h`;
}

/** Whether it is yesterday, today or tomorrow in `zone` compared with `from`. */
export function relativeDay(zone: string, at: number, from = localTimeZone()): string {
  const day = (timeZone: string) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(at);
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(value("year"), value("month") - 1, value("day"));
  };
  const days = Math.round((day(zone) - day(from)) / 86_400_000);
  return days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : "";
}

/** Wall time in a zone, in the user's locale: "9:41 PM". */
export function zoneTime(zone: string, at: number): string {
  return new Date(at).toLocaleTimeString(undefined, {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
  });
}

export function addCity(cities: readonly string[], zone: string): string[] {
  return cities.includes(zone) ? [...cities] : [...cities, zone];
}

export function removeCity(cities: readonly string[], zone: string): string[] {
  return cities.filter((city) => city !== zone);
}

/** Validate a stored `{ cities: string[] }` preference, dropping zones this runtime lacks. */
export function parseCities(data: unknown): string[] {
  if (typeof data !== "object" || !data || !("cities" in data) || !Array.isArray(data.cities))
    return [];
  return [
    ...new Set(
      data.cities.filter((zone): zone is string => typeof zone === "string" && isTimeZone(zone)),
    ),
  ];
}
