/**
 * Weather workflows through a real Window and real keyboard/pointer input: search and pick a place
 * by keyboard, units that persist across restarts, the hourly strip, offline and stale forecasts
 * with retry, the no-cache/no-network empty state, switching and removing saved places. The UI
 * runs on a fake client; WeatherClient's HTTP handling is checked against a local server.
 */
import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { once } from "node:events";
import React from "react";
import { loadAppSettings } from "@moire/app-tools";
import { mountWindow, withFixture, type MountedWindow } from "@moire/app-tools/testing";
import { WeatherApp } from "./main";
import { APP_ID, parseUnits } from "./model";
import { WeatherCache, WeatherClient, WeatherError, type Forecast, type Place } from "./weather";

await import("./model.smoke");

const KEY = { tab: 15, enter: 28, right: 106, del: 111, r: 19 } as const;
const now = Date.now();
const adelaide: Place = {
  id: "adelaide",
  name: "Adelaide",
  country: "Australia",
  latitude: -34.9,
  longitude: 138.6,
  timeZone: "Australia/Adelaide",
};
const perth: Place = { ...adelaide, id: "perth", name: "Perth", latitude: -31.9, longitude: 115.8 };
const forecast = (temperature: number, fetchedAt = Date.now()): Forecast => ({
  fetchedAt,
  timeZone: "Australia/Adelaide",
  time: "2026-10-02T12:00",
  temperature,
  feelsLike: 20,
  wind: 11,
  code: 2,
  days: [{ date: "2026-10-02", min: 12, max: 23, rain: 10, code: 2 }],
  hours: Array.from({ length: 24 }, (_, hour) => ({
    time: `2026-10-02T${String((12 + hour) % 24).padStart(2, "0")}:00`,
    temperature: temperature - (hour % 6),
    rain: hour === 3 ? 40 : 0,
    code: 2,
  })),
});

/** A client whose answers the smoke controls: a forecast, a failure, or one held back. */
class FakeClient {
  mode: "online" | "offline" = "online";
  temperature = 21;
  forecasts = 0;
  async search(query: string): Promise<Place[]> {
    if (this.mode === "offline")
      throw new WeatherError("network", "Can't reach the weather service.");
    return [adelaide, perth].filter((place) =>
      place.name.toLowerCase().startsWith(query.toLowerCase()),
    );
  }
  async forecast(place: Place): Promise<Forecast> {
    this.forecasts++;
    if (this.mode === "offline")
      throw new WeatherError("network", "Can't reach the weather service. Check your connection.");
    return forecast(place.id === "perth" ? 28 : this.temperature);
  }
}

const focusedId = (app: MountedWindow) =>
  (app.window as unknown as { focusedId: string | null }).focusedId;
/** Tab through the window until `focusId` (or an id matching it) holds focus. */
function tabTo(app: MountedWindow, match: string | RegExp) {
  for (let step = 0; step < 60; step++) {
    const id = focusedId(app) ?? "";
    if (typeof match === "string" ? id === match : match.test(id)) return;
    app.key(KEY.tab, "Tab");
  }
  assert.fail(`Tab never reached ${match}`);
}
const has = (app: MountedWindow, text: string) => app.texts().some((item) => item.includes(text));

async function clientOverHttp() {
  let status = 200;
  const requests: string[] = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url ?? "");
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json");
    response.end(
      JSON.stringify(
        request.url?.startsWith("/geo")
          ? { results: [{ ...adelaide, timezone: adelaide.timeZone }] }
          : {
              timezone: "Australia/Adelaide",
              current: {
                time: "2026-10-02T12:00",
                temperature_2m: 21,
                apparent_temperature: 20,
                wind_speed_10m: 11,
                weather_code: 2,
              },
              hourly: {
                time: ["2026-10-02T11:00", "2026-10-02T12:00"],
                temperature_2m: [20, 21],
                precipitation_probability: [0, 5],
                weather_code: [2, 2],
              },
              daily: {
                time: ["2026-10-02"],
                temperature_2m_min: [12],
                temperature_2m_max: [23],
                precipitation_probability_max: [10],
                weather_code: [2],
              },
            },
      ),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const client = new WeatherClient({
      forecastURL: `${base}/forecast`,
      geocodingURL: `${base}/geo`,
    });
    assert.equal((await client.search("Adelaide"))[0]?.name, "Adelaide");
    const result = await client.forecast(adelaide);
    assert.deepEqual(
      result.hours?.map((hour) => hour.temperature),
      [21],
      "hours start now",
    );
    assert.ok(requests.some((url) => url.includes("timezone=auto") && url.includes("hourly=")));
    status = 503;
    await assert.rejects(
      client.forecast(adelaide),
      (error) => error instanceof WeatherError && error.kind === "http",
    );
    await assert.rejects(
      client.search("a"),
      (error) => error instanceof WeatherError && error.kind === "query",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  // Nothing listens on the closed port: a network failure, not a crash.
  const unreachable = new WeatherClient({ forecastURL: `${base}/forecast` });
  await assert.rejects(
    unreachable.forecast(adelaide),
    (error) => error instanceof WeatherError && error.kind === "network",
  );
}

await clientOverHttp();

await withFixture(async (directory) => {
  const cache = new WeatherCache(path.join(directory, "places.json"));
  const client = new FakeClient();
  const mount = () =>
    mountWindow((size) => <WeatherApp {...size} client={client} cache={cache} />, {
      width: 860,
      height: 700,
    });

  // First run, offline, nothing saved: picking a place shows an empty state with a retry.
  let app = await mount();
  assert.ok(has(app, "No place selected"));
  app.press({ focusId: "weather:search" });
  app.type("Ade");
  app.key(KEY.enter, "Enter");
  await app.until(() => has(app, "RESULTS"), "search by Enter shows results");
  client.mode = "offline";
  tabTo(app, "weather:result:0");
  app.key(KEY.enter, "Enter");
  await app.until(() => has(app, "Forecast unavailable"), "no cache + no network is explicit");
  assert.ok(has(app, "Try Again"));
  assert.deepEqual(cache.read(), []);

  // Retry once the network is back.
  client.mode = "online";
  app.press({ focusId: "weather:retry" });
  await app.until(() => cache.read().length === 1, "retry fetches and saves the forecast");
  assert.ok(has(app, "NEXT 24 HOURS") && has(app, "Now"), "hourly strip shows");
  assert.ok(has(app, "21°") && has(app, "11 km/h"));
  assert.ok(has(app, "Updated just now"));

  // Units: °F by pointer, mph by keyboard; the cache stays metric.
  app.press({ text: "°F" });
  assert.ok(has(app, "70°"), "21 °C reads as 70 °F");
  tabTo(app, /^tabs:.*:kmh$/);
  app.key(KEY.right, "ArrowRight");
  assert.ok(has(app, "7 mph"), "11 km/h reads as 7 mph");
  assert.deepEqual(loadAppSettings(APP_ID, parseUnits), { temperature: "fahrenheit", wind: "mph" });
  assert.equal(cache.read()[0]?.forecast.temperature, 21);

  // Offline refresh (Ctrl+R) keeps the saved forecast, says so, and Retry recovers.
  client.mode = "offline";
  app.key(KEY.r, "r", { ctrl: true });
  await app.until(() => has(app, "Offline · showing the saved forecast"), "offline banner");
  assert.ok(has(app, "Last updated just now"));
  assert.ok(has(app, "70°"), "saved forecast still shown");
  client.mode = "online";
  client.temperature = 23;
  app.press({ focusId: "weather:retry" });
  await app.until(() => cache.read()[0]?.forecast.temperature === 23, "retry refreshes");
  assert.ok(!has(app, "Offline"));
  app.destroy();

  // Restart: units persist; a stale saved forecast that cannot refresh is marked with its age.
  cache.write([
    { place: adelaide, forecast: forecast(21, now - 5 * 60 * 60_000) },
    { place: perth, forecast: forecast(28, now - 5 * 60 * 60_000) },
  ]);
  client.mode = "offline";
  app = await mount();
  assert.ok(has(app, "70°"), "°F persisted across restart");
  await app.until(() => has(app, "Offline · showing the saved forecast"), "stale refresh fails");
  assert.ok(has(app, "Last updated 5 h ago"), "the offline forecast shows its age");
  assert.ok(has(app, "Australia · 5 h ago"), "stale saved places are marked in the list");

  // Switch saved places by keyboard, then remove one with Delete and one with its button.
  client.mode = "online";
  tabTo(app, "weather:place:perth");
  app.key(KEY.enter, "Enter");
  await app.until(
    () => cache.read()[0]?.place.id === "perth",
    "switching refreshes the stale place",
  );
  assert.ok(has(app, "82°"), "Perth in °F");
  tabTo(app, "weather:place:perth");
  app.key(KEY.del, "Delete");
  assert.deepEqual(
    cache.read().map((entry) => entry.place.id),
    ["adelaide"],
  );
  await app.until(
    () => has(app, "Adelaide, Australia"),
    "removing the selection selects the next place",
  );
  app.press({ focusId: "weather:place:adelaide:remove" });
  assert.deepEqual(cache.read(), []);
  assert.ok(has(app, "No place selected"));
  app.destroy();
});
console.log(
  "[weather/smoke] keyboard search/pick, units persistence, hourly, offline/stale/retry, empty state, switch and remove passed",
);
