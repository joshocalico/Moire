/** Region prefs and the panel's live clock (24-hour pref, live zone changes). */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_REGION_SETTINGS,
  formatCalendarDate,
  formatClockTime,
  normalizeRegionSettings,
  resolveFirstDayOfWeek,
  resolveFormatLocale,
  systemTimeZone,
  type RegionSettings,
} from "./region";
import { createLiveClock } from "./region-settings";
import { normalizeSettings } from "./store";

const env = { LANG: "en_US.UTF-8" };
const at = Date.UTC(2026, 9, 10, 14, 5, 9); // 14:05:09 UTC, Saturday
const region = (patch: Partial<RegionSettings> = {}) => ({ ...DEFAULT_REGION_SETTINGS, ...patch });

// Normalisation: malformed fields fall back independently; the store carries the region.
assert.deepEqual(normalizeRegionSettings(null), DEFAULT_REGION_SETTINGS);
assert.deepEqual(
  normalizeRegionSettings({
    clock: "12h",
    firstDayOfWeek: "noon",
    dateFormat: "iso",
    formatLocale: "en_gb",
  }),
  { clock: "12h", firstDayOfWeek: "locale", dateFormat: "iso", formatLocale: null },
);
assert.equal(normalizeRegionSettings({ formatLocale: "en-gb" }).formatLocale, "en-GB");
assert.deepEqual(normalizeSettings({}).region, DEFAULT_REGION_SETTINGS);
assert.equal(normalizeSettings({ region: { clock: "12h" } }).region.clock, "12h");

// Locale resolution: pref, then LC_ALL / LC_TIME / LANG.
assert.equal(resolveFormatLocale(region(), { LANG: "de_DE.UTF-8" }), "de-DE");
assert.equal(resolveFormatLocale(region(), { LC_TIME: "en_GB.UTF-8", LANG: "de_DE" }), "en-GB");
assert.equal(resolveFormatLocale(region({ formatLocale: "fr-FR" }), { LANG: "de_DE" }), "fr-FR");
assert.equal(typeof resolveFormatLocale(region(), { LANG: "C.UTF-8" }), "string");

// The 24-hour pref decides the clock regardless of locale.
const utc = { timeZone: "UTC", env };
assert.equal(formatClockTime(at, region(), utc), "14:05");
assert.match(formatClockTime(at, region({ clock: "12h" }), utc), /^2:05\s?PM$/);
assert.equal(formatClockTime(at, region(), { ...utc, env: { LANG: "en_US" } }), "14:05");
assert.equal(formatClockTime(at, region(), { ...utc, seconds: true }), "14:05:09");
assert.equal(formatClockTime(at, region(), { timeZone: "Asia/Kolkata", env }), "19:35");
// An unknown zone falls back instead of throwing inside the panel's timer.
assert.equal(typeof formatClockTime(at, region(), { timeZone: "Not/AZone", env }), "string");

// Date order.
assert.equal(formatCalendarDate(at, region({ dateFormat: "iso" }), utc), "2026-10-10");
assert.equal(formatCalendarDate(at, region({ dateFormat: "day-month-year" }), utc), "10/10/2026");
const may = Date.UTC(2026, 4, 3, 12);
assert.equal(formatCalendarDate(may, region({ dateFormat: "day-month-year" }), utc), "03/05/2026");
assert.equal(formatCalendarDate(may, region({ dateFormat: "month-day-year" }), utc), "05/03/2026");
assert.match(formatCalendarDate(may, region(), utc), /5\/3\/26/);
assert.match(formatCalendarDate(may, region(), { ...utc, style: "long" }), /Sunday, May 3, 2026/);

// First day of the week.
assert.equal(resolveFirstDayOfWeek(region({ firstDayOfWeek: "sunday" }), env), 7);
assert.equal(resolveFirstDayOfWeek(region({ firstDayOfWeek: "monday" }), env), 1);
assert.equal(resolveFirstDayOfWeek(region(), { LANG: "en_US.UTF-8" }), 7);
assert.equal(resolveFirstDayOfWeek(region(), { LANG: "de_DE.UTF-8" }), 1);

// /etc/localtime as timedated writes it.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moire-region-smoke-"));
try {
  const link = path.join(dir, "localtime");
  fs.symlinkSync("../etc/zoneinfo/America/Argentina/Buenos_Aires", link);
  assert.equal(systemTimeZone(link), "America/Argentina/Buenos_Aires");
  fs.rmSync(link);
  fs.symlinkSync("/nix/store/abc-tzdata/share/zoneinfo/Europe/Berlin", link);
  assert.equal(systemTimeZone(link), "Europe/Berlin");
  fs.rmSync(link);
  fs.symlinkSync("/somewhere/../../etc/shadow", link);
  assert.equal(systemTimeZone(link), null);
  assert.equal(systemTimeZone(path.join(dir, "missing")), null);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// The panel clock: re-reads prefs only when settings.json changes, follows the zone each tick.
let stored = region();
let stamp = "1";
let zone: string | null = "UTC";
let reads = 0;
const clock = createLiveClock({
  read: () => {
    reads++;
    return stored;
  },
  stamp: () => stamp,
  zone: () => zone,
});
const now = new Date(at);
assert.equal(clock.format(now), "14:05");
assert.equal(clock.format(now), "14:05");
assert.equal(reads, 1, "unchanged settings are not re-read");
stored = region({ clock: "12h", formatLocale: "en-US" });
assert.equal(clock.format(now), "14:05", "a write is noticed through the file stamp");
stamp = "2";
assert.match(clock.format(now), /^2:05\s?PM$/);
assert.equal(reads, 2);
zone = "Europe/Berlin";
assert.match(clock.format(now), /^4:05\s?PM$/, "a timedated zone change shows without restart");

console.log("[region.smoke] ok");
