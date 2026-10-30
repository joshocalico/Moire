/** Weather's pure model and forecast parsing, checked without a window or a network. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_UNITS,
  STALE_AFTER_MS,
  formatTemperature,
  formatWind,
  freshness,
  hourlySlots,
  initialState,
  needsRefresh,
  parseUnits,
  reduce,
  selectedForecast,
  statusText,
} from "./model";
import { WeatherCache, WeatherError, parseForecast, type Forecast, type Place } from "./weather";

const now = Date.parse("2026-10-02T02:00:00Z");
const place = (id: string): Place => ({
  id,
  name: id,
  country: "Testland",
  latitude: 0,
  longitude: 0,
  timeZone: "UTC",
});
const forecast = (fetchedAt = now, temperature = 21): Forecast => ({
  fetchedAt,
  timeZone: "UTC",
  time: "2026-10-02T12:00",
  temperature,
  feelsLike: 20,
  wind: 11,
  code: 2,
  days: [{ date: "2026-10-02", min: 12, max: 23, rain: 10, code: 2 }],
});

// Units: stored metric values convert at display time; bad settings fall back per field.
assert.deepEqual(parseUnits(undefined), DEFAULT_UNITS);
assert.deepEqual(parseUnits({ temperature: "fahrenheit", wind: "knots" }), {
  temperature: "fahrenheit",
  wind: "kmh",
});
const imperial = { temperature: "fahrenheit", wind: "mph" } as const;
assert.equal(formatTemperature(21, DEFAULT_UNITS), "21°");
assert.equal(formatTemperature(21, imperial), "70°");
assert.equal(formatTemperature(-40, imperial), "-40°");
assert.equal(formatTemperature(-0.3, DEFAULT_UNITS), "0°", "no negative zero");
assert.equal(formatWind(11, DEFAULT_UNITS), "11 km/h");
assert.equal(formatWind(11, imperial), "7 mph");

// Transitions: a finished load saves the place first and caps the list.
let state = initialState([]);
for (let index = 0; index < 10; index++) {
  state = reduce(state, { type: "select", place: place(`p${index}`) });
  state = reduce(state, {
    type: "load-finished",
    place: place(`p${index}`),
    forecast: forecast(),
  });
}
assert.equal(state.entries.length, 8);
assert.equal(state.entries[0]?.place.id, "p9");
assert.equal(state.sync.kind, "updated");

// A failed refresh with a saved forecast is offline; without one it is unavailable.
const failure = { kind: "network", message: "No connection." } as const;
assert.equal(reduce(state, { type: "load-failed", failure }).sync.kind, "offline");
const unsaved = reduce(state, { type: "select", place: place("new") });
assert.equal(selectedForecast(unsaved), null);
assert.equal(reduce(unsaved, { type: "load-failed", failure }).sync.kind, "unavailable");

// Removing the selected place selects the next saved one; removing another keeps the selection.
const removed = reduce(state, { type: "remove", id: "p9" });
assert.equal(removed.selected?.id, "p8");
assert.equal(reduce(state, { type: "remove", id: "p3" }).selected?.id, "p9");
assert.equal(reduce(state, { type: "clear" }).entries.length, 0);

// Freshness: offline and stale forecasts say how old they are; a current one says nothing.
const fresh = initialState([{ place: place("a"), forecast: forecast(now - 5 * 60_000) }]);
assert.equal(freshness(fresh, now), null);
assert.equal(statusText(fresh, now), "Updated 5 min ago · UTC");
assert.equal(needsRefresh(selectedForecast(fresh), now), false);
const offline = reduce(fresh, { type: "load-failed", failure });
assert.match(freshness(offline, now)?.title ?? "", /Offline/);
assert.match(freshness(offline, now)?.message ?? "", /5 min ago.*No connection/);
assert.match(statusText(offline, now), /^Offline · showing the forecast from 5 min ago/);
const old = initialState([{ place: place("a"), forecast: forecast(now - STALE_AFTER_MS - 1) }]);
assert.match(freshness(old, now)?.title ?? "", /out of date/);
assert.equal(needsRefresh(selectedForecast(old), now), true);
assert.equal(freshness(reduce(old, { type: "load-started" }), now), null, "quiet while updating");

// Hourly parsing: starts at the current hour, keeps a day, tolerates null rain chances.
const hourly = {
  time: Array.from(
    { length: 48 },
    (_, hour) => `2026-10-0${2 + Math.floor(hour / 24)}T${String(hour % 24).padStart(2, "0")}:00`,
  ),
  temperature_2m: Array.from({ length: 48 }, (_, hour) => hour),
  precipitation_probability: Array.from({ length: 48 }, (_, hour) => (hour === 13 ? null : 20)),
  weather_code: Array.from({ length: 48 }, () => 61),
};
const response = {
  timezone: "UTC",
  current: {
    time: "2026-10-02T12:15",
    temperature_2m: 21,
    apparent_temperature: 20,
    wind_speed_10m: 11,
    weather_code: 2,
  },
  daily: {
    time: ["2026-10-02"],
    temperature_2m_min: [12],
    temperature_2m_max: [23],
    precipitation_probability_max: [10],
    weather_code: [2],
  },
};
const parsed = parseForecast({ ...response, hourly }, now);
assert.equal(parsed.hours?.length, 24);
assert.equal(parsed.hours?.[0]?.time, "2026-10-02T12:00");
assert.equal(parsed.hours?.[1]?.rain, 0);
assert.deepEqual(
  hourlySlots(parsed).map((hour) => hour.temperature),
  [12, 15, 18, 21, 24, 27, 30, 33],
);
assert.equal("hours" in parseForecast(response, now), false, "hourly data stays optional");
assert.throws(
  () => parseForecast({ ...response, hourly: { ...hourly, weather_code: [1] } }),
  (error) => error instanceof WeatherError && error.kind === "invalid",
);

// The cache accepts entries written before hourly data existed, and round-trips new ones.
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-weather-model-"));
try {
  const cache = new WeatherCache(path.join(directory, "places.json"));
  cache.write([
    { place: place("old"), forecast: forecast() },
    { place: place("new"), forecast: parsed },
  ]);
  const [legacy, current] = cache.read();
  assert.equal(legacy?.forecast.hours, undefined);
  assert.equal(current?.forecast.hours?.length, 24);
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
console.log("[weather/model] units, transitions, freshness, hourly parsing and cache passed");
