/**
 * Evening schedules for night light and automatic dark style: clock times, sunset and sunrise
 * from the time zone's approximate location, whether a schedule is on at a moment, and the
 * warm colour night light paints at a strength. Pure, apart from `readZoneLocation`.
 */
import fs from "node:fs";
import path from "node:path";
import { systemTimeZone } from "./region";

/** `HH:MM`, 24-hour. */
export type ClockTime = string;

/** When an evening schedule runs: from sunset to sunrise, or between two clock times. */
export type DaySchedule = { kind: "sunset" } | { kind: "custom"; from: ClockTime; to: ClockTime };

export type NightLightSettings = {
  /** The switch. With `schedule: "off"` night light is on whenever this is. */
  enabled: boolean;
  /** "off" has no schedule (on while switched on). */
  schedule: "off" | "sunset" | "custom";
  from: ClockTime;
  to: ClockTime;
  /** 0 (no change) to 1 (warmest). */
  strength: number;
};

export type AutoDarkSettings = {
  /** "off": the Light or Dark choice stands. Otherwise dark follows this schedule. */
  mode: "off" | "sunset" | "night-light" | "custom";
  from: ClockTime;
  to: ClockTime;
};

export const DEFAULT_NIGHT_LIGHT: NightLightSettings = Object.freeze({
  enabled: false,
  schedule: "sunset",
  from: "20:00",
  to: "07:00",
  strength: 0.5,
});

export const DEFAULT_AUTO_DARK: AutoDarkSettings = Object.freeze({
  mode: "off",
  from: "19:00",
  to: "07:00",
});

export type Coordinates = { latitude: number; longitude: number };

/** What schedules are judged against: the zone clocks are read in, and where it roughly is. */
export type DaylightContext = {
  timeZone: string | null;
  location: Coordinates | null;
};

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes after midnight for `HH:MM`, or null. */
export function clockMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = CLOCK.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

export function clockTime(minutes: number): ClockTime {
  const whole = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const clockOr = (value: unknown, fallback: ClockTime) =>
  clockMinutes(value) == null ? fallback : (value as ClockTime);

export function normalizeNightLight(value: unknown): NightLightSettings {
  const raw = isRecord(value) ? value : {};
  const strength =
    typeof raw.strength === "number" && Number.isFinite(raw.strength)
      ? Math.min(1, Math.max(0, raw.strength))
      : DEFAULT_NIGHT_LIGHT.strength;
  return {
    enabled: raw.enabled === true,
    schedule:
      raw.schedule === "off" || raw.schedule === "sunset" || raw.schedule === "custom"
        ? raw.schedule
        : DEFAULT_NIGHT_LIGHT.schedule,
    from: clockOr(raw.from, DEFAULT_NIGHT_LIGHT.from),
    to: clockOr(raw.to, DEFAULT_NIGHT_LIGHT.to),
    strength,
  };
}

export function normalizeAutoDark(value: unknown): AutoDarkSettings {
  const raw = isRecord(value) ? value : {};
  return {
    mode:
      raw.mode === "sunset" || raw.mode === "night-light" || raw.mode === "custom"
        ? raw.mode
        : "off",
    from: clockOr(raw.from, DEFAULT_AUTO_DARK.from),
    to: clockOr(raw.to, DEFAULT_AUTO_DARK.to),
  };
}

// ---------------------------------------------------------------------------------------------
// Where a time zone is

/** ISO 6709 `±DDMM±DDDMM` or `±DDMMSS±DDDMMSS`, as tzdata writes coordinates. */
export function parseIso6709(value: string): Coordinates | null {
  const match = /^([+-])(\d{2})(\d{2})(\d{2})?([+-])(\d{3})(\d{2})(\d{2})?$/.exec(value.trim());
  if (!match) return null;
  const part = (sign: string, degrees: string, minutes: string, seconds = "0") =>
    (sign === "-" ? -1 : 1) * (Number(degrees) + Number(minutes) / 60 + Number(seconds) / 3600);
  const latitude = part(match[1]!, match[2]!, match[3]!, match[4]);
  const longitude = part(match[5]!, match[6]!, match[7]!, match[8]);
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

/** A zone's coordinates from tzdata's `zone1970.tab` or `zone.tab` text, or null. */
export function zoneCoordinates(table: string, zone: string): Coordinates | null {
  for (const line of table.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [, coordinates, id] = line.split("\t");
    if (id === zone && coordinates) return parseIso6709(coordinates);
  }
  return null;
}

const locations = new Map<string, Coordinates | null>();

/**
 * The system time zone and its approximate location (the city tzdata names it after). The
 * location is null for zones without one (UTC, Etc/…) or when tzdata's tables are missing.
 */
export function readZoneLocation(
  zone = systemTimeZone() ?? process.env.TZ ?? null,
  directories = [process.env.TZDIR, "/etc/zoneinfo", "/usr/share/zoneinfo"],
): DaylightContext {
  if (!zone) return { timeZone: null, location: null };
  if (!locations.has(zone)) {
    let found: Coordinates | null = null;
    search: for (const directory of directories) {
      if (!directory) continue;
      for (const table of ["zone1970.tab", "zone.tab"]) {
        try {
          found = zoneCoordinates(fs.readFileSync(path.join(directory, table), "utf8"), zone);
        } catch {
          continue;
        }
        if (found) break search;
      }
    }
    locations.set(zone, found);
  }
  return { timeZone: zone, location: locations.get(zone) ?? null };
}

// ---------------------------------------------------------------------------------------------
// Sunrise and sunset

const DAY_MS = 86_400_000;
const UNIX_EPOCH_JULIAN = 2440587.5;
const J2000 = 2451545;
const rad = Math.PI / 180;

export type SunTimes =
  | { kind: "normal"; sunrise: number; sunset: number }
  | { kind: "polar-day" | "polar-night" };

/**
 * Sunrise and sunset (epoch ms) on a calendar date at a place, by the sunrise equation; good
 * to a minute or two, which is plenty for a schedule.
 */
export function sunTimes(
  date: { year: number; month: number; day: number },
  where: Coordinates,
): SunTimes {
  const julian = Date.UTC(date.year, date.month - 1, date.day) / DAY_MS + UNIX_EPOCH_JULIAN;
  const n = Math.ceil(julian - J2000 + 0.0008);
  const meanNoon = n - where.longitude / 360;
  const anomaly = (357.5291 + 0.98560028 * meanNoon) % 360;
  const centre =
    1.9148 * Math.sin(anomaly * rad) +
    0.02 * Math.sin(2 * anomaly * rad) +
    0.0003 * Math.sin(3 * anomaly * rad);
  const ecliptic = (anomaly + centre + 180 + 102.9372) % 360;
  const transit =
    J2000 + meanNoon + 0.0053 * Math.sin(anomaly * rad) - 0.0069 * Math.sin(2 * ecliptic * rad);
  const declination = Math.asin(Math.sin(ecliptic * rad) * Math.sin(23.4397 * rad));
  const latitude = where.latitude * rad;
  const cosHour =
    (Math.sin(-0.833 * rad) - Math.sin(latitude) * Math.sin(declination)) /
    (Math.cos(latitude) * Math.cos(declination));
  if (cosHour > 1) return { kind: "polar-night" };
  if (cosHour < -1) return { kind: "polar-day" };
  const half = Math.acos(cosHour) / rad / 360;
  const ms = (julianDay: number) => Math.round((julianDay - UNIX_EPOCH_JULIAN) * DAY_MS);
  return { kind: "normal", sunrise: ms(transit - half), sunset: ms(transit + half) };
}

/** The calendar date and minutes after midnight of `now` in a zone (the process zone if null). */
export function localClock(
  now: Date,
  timeZone: string | null,
): { year: number; month: number; day: number; minutes: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone ?? undefined,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    // An unknown zone reads in the process zone.
    return localClock(now, null);
  }
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    minutes: (part("hour") % 24) * 60 + part("minute"),
  };
}

/** Where a schedule stands at a moment, with the clock time it next changes for the UI. */
export type ScheduleState = {
  active: boolean;
  /** `HH:MM` of the next start or end in the zone, when known. */
  until: ClockTime | null;
  /** Sunset was asked for but the zone has no location, so `fallback` times are used. */
  approximate: boolean;
};

function inWindow(minutes: number, from: number, to: number): boolean {
  if (from === to) return false;
  return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
}

/**
 * Whether an evening schedule is on at `now`. Sunset to sunrise without a location falls back
 * to `fallback`'s clock times; in polar day it never runs and in polar night always does.
 */
export function scheduleState(
  schedule: DaySchedule,
  now: Date,
  context: DaylightContext,
  fallback: { from: ClockTime; to: ClockTime },
): ScheduleState {
  const local = localClock(now, context.timeZone);
  const custom = (from: ClockTime, to: ClockTime, approximate: boolean): ScheduleState => {
    const active = inWindow(local.minutes, clockMinutes(from) ?? 0, clockMinutes(to) ?? 0);
    return { active, until: active ? to : from, approximate };
  };
  if (schedule.kind === "custom") return custom(schedule.from, schedule.to, false);
  if (!context.location) return custom(fallback.from, fallback.to, true);
  const sun = sunTimes(local, context.location);
  if (sun.kind !== "normal")
    return { active: sun.kind === "polar-night", until: null, approximate: false };
  const at = now.getTime();
  const active = at < sun.sunrise || at >= sun.sunset;
  const next = at < sun.sunrise ? sun.sunrise : at < sun.sunset ? sun.sunset : null;
  const until =
    next == null
      ? // After today's sunset the next change is tomorrow's sunrise, near today's.
        clockTime(localClock(new Date(sun.sunrise), context.timeZone).minutes)
      : clockTime(localClock(new Date(next), context.timeZone).minutes);
  return { active, until, approximate: false };
}

/** Night light's schedule as a `DaySchedule`, or null when it has none. */
export function nightLightSchedule(settings: NightLightSettings): DaySchedule | null {
  if (settings.schedule === "sunset") return { kind: "sunset" };
  if (settings.schedule === "custom")
    return { kind: "custom", from: settings.from, to: settings.to };
  return null;
}

/** Whether night light is on at `now`: the switch, then its schedule. */
export function nightLightState(
  settings: NightLightSettings,
  now: Date,
  context: DaylightContext,
): ScheduleState {
  if (!settings.enabled) return { active: false, until: null, approximate: false };
  const schedule = nightLightSchedule(settings);
  if (!schedule) return { active: true, until: null, approximate: false };
  return scheduleState(schedule, now, context, settings);
}

/**
 * Whether automatic dark style wants dark at `now`, or null when it is off. Following night
 * light uses night light's schedule (sunset to sunrise when night light has none).
 */
export function autoDarkState(
  auto: AutoDarkSettings,
  nightLight: NightLightSettings,
  now: Date,
  context: DaylightContext,
): ScheduleState | null {
  if (auto.mode === "off") return null;
  if (auto.mode === "custom")
    return scheduleState({ kind: "custom", from: auto.from, to: auto.to }, now, context, auto);
  if (auto.mode === "night-light")
    return scheduleState(
      nightLightSchedule(nightLight) ?? { kind: "sunset" },
      now,
      context,
      nightLight,
    );
  return scheduleState({ kind: "sunset" }, now, context, auto);
}

// ---------------------------------------------------------------------------------------------
// Colour

/** Neutral white; strength 0. */
export const NEUTRAL_KELVIN = 6500;
/** The warmest night light, at strength 1. */
export const WARMEST_KELVIN = 2500;

export function nightLightKelvin(strength: number): number {
  const s = Math.min(1, Math.max(0, strength));
  return NEUTRAL_KELVIN - s * (NEUTRAL_KELVIN - WARMEST_KELVIN);
}

/** A black body's colour at `kelvin` (Helland's fit), 0–255 per channel. */
function blackBody(kelvin: number): [number, number, number] {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  const red = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const green =
    t <= 66
      ? 99.4708025861 * Math.log(t) - 161.1195681661
      : 288.1221695283 * (t - 60) ** -0.0755148492;
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const clamp = (value: number) => Math.min(255, Math.max(0, value));
  return [clamp(red), clamp(green), clamp(blue)];
}

/**
 * Per-channel multipliers (red, green, blue in 0–1) night light applies at a strength. White at
 * 6500 K maps to exactly 1, 1, 1 so strength 0 changes nothing.
 */
export function nightLightScale(strength: number): [number, number, number] {
  if (strength <= 0) return [1, 1, 1];
  const neutral = blackBody(NEUTRAL_KELVIN);
  const warm = blackBody(nightLightKelvin(strength));
  return [0, 1, 2].map((channel) => Math.min(1, warm[channel]! / neutral[channel]!)) as [
    number,
    number,
    number,
  ];
}
