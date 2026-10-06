import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { Window, installUiFonts } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { WeatherApp } from "./main";
import { WeatherCache, type Forecast, type Place } from "./weather";

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-weather-clear-"));
const platform = new HeadlessPlatform();
const window = new Window({ title: "weather clear lifecycle", width: 860, height: 700 });
const requests: Array<{ signal: AbortSignal | undefined; resolve: (value: Forecast) => void }> = [];
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
try {
  await installUiFonts();
  const cache = new WeatherCache(path.join(fixture, "places.json"));
  cache.write([{ place, forecast }]);
  const client = {
    search: async () => [place],
    // Deliberately ignores abort, like a response already queued for delivery.
    forecast: (_place: Place, signal?: AbortSignal) =>
      new Promise<Forecast>((resolve) => {
        requests.push({ signal, resolve });
      }),
  };
  await platform.connect();
  window.setContent((size) => <WeatherApp {...size} client={client} cache={cache} />);
  window.mount(platform);
  await Promise.resolve();
  window.tick();
  const native = platform.getWindows()[0];
  assert.ok(native);
  const click = (x: number, y: number) => {
    native.injectPointer({ type: "down", button: "left", x, y, timeMs: 1 });
    native.injectPointer({ type: "up", button: "left", x, y, timeMs: 2 });
    window.tick();
  };
  const settle = async () => {
    for (let frame = 0; frame < 4; frame++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      window.tick();
    }
  };
  click(790, 34);
  assert.equal(requests.length, 1);
  click(100, 618);
  assert.deepEqual(cache.read(), []);
  assert.equal(requests[0]?.signal?.aborted, true, "Clear Saved invalidates the older refresh");
  click(790, 34);
  assert.equal(requests.length, 2, "clear releases busy state so explicit Refresh works again");
  requests[0]?.resolve({ ...forecast, temperature: 99 });
  await settle();
  assert.deepEqual(cache.read(), [], "late pre-clear response cannot repopulate saved places");
  requests[1]?.resolve({ ...forecast, temperature: 23 });
  await settle();
  assert.equal(
    cache.read()[0]?.forecast.temperature,
    23,
    "a new explicit request may save normally",
  );
  click(790, 34);
  assert.equal(requests.length, 3);
  window.destroy();
  assert.equal(requests[2]?.signal?.aborted, true);
  requests[2]?.resolve({ ...forecast, temperature: 88 });
  await Promise.resolve();
  assert.equal(cache.read()[0]?.forecast.temperature, 23, "close invalidates late responses too");
  console.log(
    "Weather actual Window clear/new refresh/late response/close lifecycle passed without HTTP",
  );
} finally {
  window.destroy();
  platform.disconnect();
  await fs.rm(fixture, { recursive: true, force: true });
}
