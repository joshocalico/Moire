/**
 * Clock and date formatting preferences. The system time zone is not a preference: it belongs to
 * timedated (see `@moire/system-management/time-settings`). These only change how times and
 * dates are written, so the panel clock and apps agree.
 */
import fs from "node:fs";

export type ClockFormat = "24h" | "12h";
export type FirstDayOfWeek = "locale" | "monday" | "sunday" | "saturday";
/** `locale` follows the format locale; the rest are fixed numeric orders. */
export type DateFormat = "locale" | "iso" | "day-month-year" | "month-day-year";

export type RegionSettings = {
  /** BCP 47 tag used for formats (`en-GB`); null follows LC_ALL, LC_TIME or LANG. */
  formatLocale: string | null;
  clock: ClockFormat;
  firstDayOfWeek: FirstDayOfWeek;
  dateFormat: DateFormat;
};

export const DEFAULT_REGION_SETTINGS: RegionSettings = Object.freeze({
  formatLocale: null,
  // The panel clock has always been 24-hour; keep that as the default.
  clock: "24h",
  firstDayOfWeek: "locale",
  dateFormat: "locale",
});

function canonicalLocale(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 64) return null;
  try {
    return Intl.getCanonicalLocales(value)[0] ?? null;
  } catch {
    return null;
  }
}

/** External JSON is narrowed once; malformed fields fall back independently. */
export function normalizeRegionSettings(value: unknown): RegionSettings {
  const raw =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    formatLocale: canonicalLocale(raw.formatLocale),
    clock: raw.clock === "12h" ? "12h" : "24h",
    firstDayOfWeek:
      raw.firstDayOfWeek === "monday" ||
      raw.firstDayOfWeek === "sunday" ||
      raw.firstDayOfWeek === "saturday"
        ? raw.firstDayOfWeek
        : "locale",
    dateFormat:
      raw.dateFormat === "iso" ||
      raw.dateFormat === "day-month-year" ||
      raw.dateFormat === "month-day-year"
        ? raw.dateFormat
        : "locale",
  };
}

/** `en_GB.UTF-8@euro` → `en-GB`; `C` and `POSIX` carry no region. */
function posixLocale(value: string | undefined): string | null {
  if (!value || value === "C" || value === "POSIX" || value.startsWith("C.")) return null;
  return canonicalLocale(value.split(/[.@]/)[0]!.replace(/_/g, "-"));
}

/** The locale formats use: the pref, else the POSIX environment, else the runtime default. */
export function resolveFormatLocale(
  region: RegionSettings,
  env: Record<string, string | undefined> = process.env,
): string {
  return (
    region.formatLocale ??
    posixLocale(env.LC_ALL) ??
    posixLocale(env.LC_TIME) ??
    posixLocale(env.LANG) ??
    new Intl.DateTimeFormat().resolvedOptions().locale
  );
}

/** Regions whose weeks start on Sunday, for runtimes without `Intl.Locale#getWeekInfo`. */
const SUNDAY_REGIONS = new Set(["US", "CA", "MX", "BR", "JP", "KR", "IL", "PH", "IN", "ZA", "AU"]);

/** ISO weekday the week starts on: 1 is Monday, 6 Saturday, 7 Sunday. */
export function resolveFirstDayOfWeek(
  region: RegionSettings,
  env: Record<string, string | undefined> = process.env,
): 1 | 6 | 7 {
  if (region.firstDayOfWeek === "monday") return 1;
  if (region.firstDayOfWeek === "saturday") return 6;
  if (region.firstDayOfWeek === "sunday") return 7;
  try {
    const locale = new Intl.Locale(resolveFormatLocale(region, env)) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    if (firstDay === 1 || firstDay === 6 || firstDay === 7) return firstDay;
    if (firstDay !== undefined) return 1;
    return SUNDAY_REGIONS.has(locale.maximize().region ?? "") ? 7 : 1;
  } catch {
    return 1;
  }
}

export type FormatOptions = {
  /** IANA zone; omitted uses the process zone. Pass `systemTimeZone()` to follow live changes. */
  timeZone?: string | null;
  seconds?: boolean;
  env?: Record<string, string | undefined>;
};

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (!found) {
    try {
      found = new Intl.DateTimeFormat(locale, options);
    } catch {
      // An unknown zone (tzdata older than timedated's) falls back to the process zone.
      const { timeZone: _ignored, ...rest } = options;
      found = new Intl.DateTimeFormat(locale, rest);
    }
    if (formatters.size > 64) formatters.clear();
    formatters.set(key, found);
  }
  return found;
}

/** A wall-clock time such as `14:05` or `2:05 PM`, honouring the 24-hour pref. */
export function formatClockTime(
  date: Date | number,
  region: RegionSettings,
  options: FormatOptions = {},
): string {
  return formatter(resolveFormatLocale(region, options.env), {
    hour: region.clock === "24h" ? "2-digit" : "numeric",
    minute: "2-digit",
    ...(options.seconds ? { second: "2-digit" } : {}),
    hourCycle: region.clock === "24h" ? "h23" : "h12",
    ...(options.timeZone ? { timeZone: options.timeZone } : {}),
  }).format(date);
}

/** A calendar date in the chosen order; `long` spells the month for headings. */
export function formatCalendarDate(
  date: Date | number,
  region: RegionSettings,
  options: FormatOptions & { style?: "short" | "long" } = {},
): string {
  const locale = resolveFormatLocale(region, options.env);
  const zone = options.timeZone ? { timeZone: options.timeZone } : {};
  if (options.style === "long")
    return formatter(locale, { dateStyle: "full", ...zone }).format(date);
  if (region.dateFormat === "locale")
    return formatter(locale, { dateStyle: "short", ...zone }).format(date);
  const parts = formatter("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...zone,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  const [y, m, d] = [part("year"), part("month"), part("day")];
  if (region.dateFormat === "iso") return `${y}-${m}-${d}`;
  if (region.dateFormat === "day-month-year") return `${d}/${m}/${y}`;
  return `${m}/${d}/${y}`;
}

/**
 * The system zone as timedated last wrote it. Node fixes its zone at startup, so long-lived
 * processes (the shell) pass this to the formatters to follow a change without restarting.
 */
export function systemTimeZone(localtime = "/etc/localtime"): string | null {
  try {
    const target = fs.readlinkSync(localtime);
    const at = target.lastIndexOf("zoneinfo/");
    const zone = at >= 0 ? target.slice(at + "zoneinfo/".length) : "";
    return /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(zone) ? zone : null;
  } catch {
    return null;
  }
}
