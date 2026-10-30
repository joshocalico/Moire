/**
 * Clearing saved places while a refresh is in flight: the older response must not repopulate the
 * cache, a new explicit refresh still works, and closing the window invalidates late answers too.
 */
import assert from "node:assert/strict";
import path from "node:path";
import React from "react";
import { mountWindow, withFixture } from "@moire/app-tools/testing";
import { WeatherApp } from "./main";
import { WeatherCache, type Forecast, type Place } from "./weather";

const requests: Array<{
  signal: AbortSignal | undefined;
  resolve: (value: Forecast) => void;
}> = [];
const place: Place = {
  id: "fixture-city",
  name: "Fixture City",
  country: "Fixture",
  latitude: 0,
  longitude: 0,
  timeZone: "UTC",
};
const forecast: Forecast = {
  fetchedAt: Date.now(),
  timeZone: "UTC",
  time: "2026-10-03T12:00",
  temperature: 21,
  feelsLike: 20,
  wind: 2,
  code: 0,
  days: [{ date: "2026-10-03", min: 15, max: 21, rain: 0, code: 0 }],
};
await withFixture(async (directory) => {
  const cache = new WeatherCache(path.join(directory, "places.json"));
  cache.write([{ place, forecast }]);
  const client = {
    search: async () => [place],
    // Deliberately ignores abort, like a response already queued for delivery.
    forecast: (_place: Place, signal?: AbortSignal) =>
      new Promise<Forecast>((resolve) => {
        requests.push({ signal, resolve });
      }),
  };
  const app = await mountWindow((size) => <WeatherApp {...size} client={client} cache={cache} />, {
    width: 860,
    height: 700,
  });
  try {
    app.press({ focusId: "weather:refresh" });
    assert.equal(requests.length, 1);
    app.press({ focusId: "weather:clear" });
    assert.deepEqual(cache.read(), []);
    assert.equal(requests[0]?.signal?.aborted, true, "Clear Saved invalidates the older refresh");
    app.press({ focusId: "weather:refresh" });
    assert.equal(requests.length, 2, "clear releases busy state so explicit Refresh works again");
    requests[0]?.resolve({ ...forecast, temperature: 99 });
    await app.settle(4);
    assert.deepEqual(cache.read(), [], "late pre-clear response cannot repopulate saved places");
    requests[1]?.resolve({ ...forecast, temperature: 23 });
    await app.settle(4);
    assert.equal(
      cache.read()[0]?.forecast.temperature,
      23,
      "a new explicit request may save normally",
    );
    app.press({ focusId: "weather:refresh" });
    assert.equal(requests.length, 3);
  } finally {
    app.destroy();
  }
  assert.equal(requests[2]?.signal?.aborted, true);
  requests[2]?.resolve({ ...forecast, temperature: 88 });
  await Promise.resolve();
  assert.equal(cache.read()[0]?.forecast.temperature, 23, "close invalidates late responses too");
});
console.log(
  "Weather actual Window clear/new refresh/late response/close lifecycle passed without HTTP",
);
