/**
 * Evening schedules: tzdata coordinates, sunrise and sunset against published times, polar
 * days and nights, custom windows across midnight, the fallback when a zone has no location,
 * night light's colour, and prefs normalisation.
 */
import assert from "node:assert/strict";
import {
  autoDarkState,
  clockMinutes,
  clockTime,
  nightLightScale,
  nightLightState,
  normalizeAutoDark,
  normalizeNightLight,
  parseIso6709,
  scheduleState,
  sunTimes,
  zoneCoordinates,
  type Coordinates,
} from "./daylight";
import { normalizeSettings } from "./store";

const near = (actual: number, expected: number, toleranceMs: number, label: string) =>
  assert.ok(
    Math.abs(actual - expected) <= toleranceMs,
    `${label}: ${new Date(actual).toISOString()} vs ${new Date(expected).toISOString()}`,
  );
const MINUTES = 60_000;

// ---- Coordinates
const nyc = parseIso6709("+404251-0740023")!;
assert.ok(Math.abs(nyc.latitude - 40.7142) < 0.001 && Math.abs(nyc.longitude + 74.0064) < 0.001);
assert.deepEqual(parseIso6709("+5130-00008"), { latitude: 51.5, longitude: -(8 / 60) });
assert.equal(parseIso6709("garbage"), null);
assert.equal(parseIso6709("+9930-00008"), null);
const table = [
  "# comment",
  "GB,GG,IM,JE\t+513030-0000731\tEurope/London",
  "US\t+404251-0740023\tAmerica/New_York\tEastern (most areas)",
].join("\n");
assert.ok(zoneCoordinates(table, "Europe/London"));
assert.equal(zoneCoordinates(table, "Etc/UTC"), null);

// ---- Sunrise and sunset against published times (timeanddate.com), within five minutes.
const london: Coordinates = { latitude: 51.5083, longitude: -0.1253 };
const midsummer = sunTimes({ year: 2026, month: 6, day: 21 }, london);
assert.equal(midsummer.kind, "normal");
if (midsummer.kind === "normal") {
  near(midsummer.sunrise, Date.UTC(2026, 5, 21, 3, 43), 5 * MINUTES, "London sunrise");
  near(midsummer.sunset, Date.UTC(2026, 5, 21, 20, 21), 5 * MINUTES, "London sunset");
}
const winter = sunTimes({ year: 2026, month: 12, day: 21 }, nyc);
if (winter.kind !== "normal") throw new Error("New York has a sunrise in December");
near(winter.sunrise, Date.UTC(2026, 11, 21, 12, 17), 5 * MINUTES, "New York sunrise");
near(winter.sunset, Date.UTC(2026, 11, 21, 21, 32), 5 * MINUTES, "New York sunset");
// East of Greenwich the day's times fall on the right local date.
const sydney = sunTimes(
  { year: 2026, month: 1, day: 15 },
  { latitude: -33.8667, longitude: 151.2167 },
);
if (sydney.kind !== "normal") throw new Error("Sydney has a sunrise");
near(sydney.sunrise, Date.UTC(2026, 0, 14, 19, 0), 6 * MINUTES, "Sydney sunrise (06:00 AEDT)");
const tromso = { latitude: 69.65, longitude: 18.96 };
assert.equal(sunTimes({ year: 2026, month: 12, day: 21 }, tromso).kind, "polar-night");
assert.equal(sunTimes({ year: 2026, month: 6, day: 21 }, tromso).kind, "polar-day");

// ---- Clock times
assert.equal(clockMinutes("07:30"), 450);
assert.equal(clockMinutes("24:00"), null);
assert.equal(clockMinutes("7:30"), null);
assert.equal(clockTime(-30), "23:30");
assert.equal(clockTime(1440 + 61), "01:01");

// ---- Custom windows, across midnight, in the zone's own clock
const utc = { timeZone: "UTC", location: null };
const at = (iso: string) => new Date(iso);
const evening = { kind: "custom", from: "20:00", to: "07:00" } as const;
const fallback = { from: "20:00", to: "07:00" };
assert.deepEqual(scheduleState(evening, at("2026-03-01T23:00:00Z"), utc, fallback), {
  active: true,
  until: "07:00",
  approximate: false,
});
assert.equal(scheduleState(evening, at("2026-03-01T06:59:00Z"), utc, fallback).active, true);
assert.equal(scheduleState(evening, at("2026-03-01T07:00:00Z"), utc, fallback).active, false);
assert.equal(scheduleState(evening, at("2026-03-01T12:00:00Z"), utc, fallback).until, "20:00");
const day = { kind: "custom", from: "09:00", to: "17:00" } as const;
assert.equal(scheduleState(day, at("2026-03-01T12:00:00Z"), utc, fallback).active, true);
assert.equal(scheduleState(day, at("2026-03-01T18:00:00Z"), utc, fallback).active, false);
const never = { kind: "custom", from: "09:00", to: "09:00" } as const;
assert.equal(scheduleState(never, at("2026-03-01T09:00:00Z"), utc, fallback).active, false);
// The same instant in another zone's clock: 23:00 UTC is 18:00 in New York.
const newYork = { timeZone: "America/New_York", location: nyc };
assert.equal(
  scheduleState(evening, at("2026-03-01T23:00:00Z"), { ...newYork, location: null }, fallback)
    .active,
  false,
);

// ---- Sunset to sunrise
const sunset = { kind: "sunset" } as const;
const londonZone = { timeZone: "Europe/London", location: london };
assert.equal(scheduleState(sunset, at("2026-06-21T12:00:00Z"), londonZone, fallback).active, false);
const night = scheduleState(sunset, at("2026-06-21T22:00:00Z"), londonZone, fallback);
assert.equal(night.active, true);
assert.match(night.until ?? "", /^04:4\d$/, "until sunrise, in BST");
assert.equal(scheduleState(sunset, at("2026-06-21T02:00:00Z"), londonZone, fallback).active, true);
// No location: the fallback times, flagged approximate.
const guessed = scheduleState(sunset, at("2026-06-21T21:00:00Z"), utc, fallback);
assert.deepEqual(guessed, { active: true, until: "07:00", approximate: true });
const polar = { timeZone: "Europe/Oslo", location: tromso };
assert.equal(scheduleState(sunset, at("2026-12-21T12:00:00Z"), polar, fallback).active, true);
assert.equal(scheduleState(sunset, at("2026-06-21T23:00:00Z"), polar, fallback).active, false);

// ---- Night light and automatic dark
const light = normalizeNightLight({ enabled: true, schedule: "off", strength: 0.7 });
assert.equal(nightLightState(light, at("2026-06-21T12:00:00Z"), londonZone).active, true);
assert.equal(
  nightLightState({ ...light, enabled: false }, at("2026-06-21T23:00:00Z"), londonZone).active,
  false,
);
const scheduled = { ...light, schedule: "custom" as const, from: "21:00", to: "06:00" };
assert.equal(nightLightState(scheduled, at("2026-06-21T22:00:00Z"), utc).active, true);
assert.equal(nightLightState(scheduled, at("2026-06-21T12:00:00Z"), utc).active, false);
assert.equal(autoDarkState(normalizeAutoDark({}), light, at("2026-06-21T22:00:00Z"), utc), null);
const followLight = normalizeAutoDark({ mode: "night-light" });
assert.equal(autoDarkState(followLight, scheduled, at("2026-06-21T22:00:00Z"), utc)?.active, true);
assert.equal(autoDarkState(followLight, scheduled, at("2026-06-21T12:00:00Z"), utc)?.active, false);
// Following a night light without a schedule means sunset to sunrise.
assert.equal(
  autoDarkState(followLight, light, at("2026-06-21T22:00:00Z"), londonZone)?.active,
  true,
);
const custom = normalizeAutoDark({ mode: "custom", from: "18:30", to: "06:15" });
assert.equal(autoDarkState(custom, light, at("2026-06-21T18:45:00Z"), utc)?.active, true);

// ---- Colour: neutral at 0, warmer (less blue, then less green) as strength rises.
assert.deepEqual(nightLightScale(0), [1, 1, 1]);
const half = nightLightScale(0.5);
const full = nightLightScale(1);
assert.equal(half[0], 1);
assert.ok(half[2] < half[1] && half[1] < 1, `half ${half}`);
assert.ok(full[2] < half[2] && full[1] < half[1], `full ${full}`);
assert.ok(full[2] > 0.2, "the warmest still shows blue");

// ---- Normalisation: bad values fall back independently.
const prefs = normalizeSettings({
  nightLight: { enabled: true, schedule: "weekly", from: "25:00", to: "06:00", strength: 9 },
  autoDark: { mode: "always", from: "x" },
});
assert.deepEqual(prefs.nightLight, {
  enabled: true,
  schedule: "sunset",
  from: "20:00",
  to: "06:00",
  strength: 1,
});
assert.deepEqual(prefs.autoDark, { mode: "off", from: "19:00", to: "07:00" });

console.log("[daylight] coordinates, sun times, schedules, colour and prefs passed");
