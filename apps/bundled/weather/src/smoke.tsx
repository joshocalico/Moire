import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import React from "react";
import { Window, installUiFonts } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { WeatherApp } from "./main";
import { WeatherCache, WeatherClient, parseForecast } from "./weather";
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-weather-")),
  backend = new HeadlessPlatform(),
  window = new Window({ title: "weather workflows", width: 860, height: 700 });
let offline = false;
const requests: string[] = [];
const response = {
  timezone: "Australia/Adelaide",
  current: {
    time: "2026-10-02T12:00",
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
const server = http.createServer((request, responseStream) => {
  requests.push(request.url ?? "");
  responseStream.setHeader("Content-Type", "application/json");
  if (offline) {
    responseStream.statusCode = 503;
    responseStream.end("{}");
  } else
    responseStream.end(
      JSON.stringify(
        request.url?.startsWith("/geo")
          ? {
              results: [
                {
                  id: 1,
                  name: "Adelaide",
                  country: "Australia",
                  latitude: -34.9,
                  longitude: 138.6,
                  timezone: "Australia/Adelaide",
                },
              ],
            }
          : response,
      ),
    );
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  await installUiFonts();
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const client = new WeatherClient({
      forecastURL: `http://127.0.0.1:${address.port}/forecast`,
      geocodingURL: `http://127.0.0.1:${address.port}/geo`,
      now: () => Date.parse("2026-10-02T02:00:00Z"),
    }),
    cache = new WeatherCache(path.join(fixture, "cache.json"));
  assert.throws(() => parseForecast({}), /invalid/);
  assert.equal((await client.search("Adelaide"))[0]?.name, "Adelaide");
  await backend.connect();
  window.setContent((size) => <WeatherApp {...size} client={client} cache={cache} />);
  window.mount(backend);
  await Promise.resolve();
  window.tick();
  const native = backend.getWindows()[0];
  assert.ok(native);
  const mods = { shift: false, ctrl: false, alt: false, meta: false };
  const click = (x: number, y: number) => {
    native.injectPointer({ type: "down", x, y, button: "left", timeMs: 1 });
    native.injectPointer({ type: "up", x, y, button: "left", timeMs: 2 });
    window.tick();
  };
  click(90, 102);
  native.injectKey({
    type: "down",
    code: 30,
    key: "a",
    text: "Adelaide",
    modifiers: mods,
    timeMs: 1,
  });
  click(90, 148);
  const wait = async (predicate: () => boolean) => {
    for (let i = 0; i < 50; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      window.tick();
      if (predicate()) return;
    }
    assert.fail("Weather app did not complete its request");
  };
  await wait(() => requests.filter((url) => url.startsWith("/geo")).length >= 2);
  await new Promise((resolve) => setTimeout(resolve, 30));
  window.tick();
  click(90, 218);
  await wait(() => cache.read().length === 1);
  assert.equal(cache.read()[0]?.forecast.temperature, 21);
  assert.ok(requests.some((url) => url.includes("timezone=auto")));
  offline = true;
  click(790, 34);
  await new Promise((resolve) => setTimeout(resolve, 40));
  window.tick();
  assert.equal(
    cache.read()[0]?.forecast.temperature,
    21,
    "offline refresh retains the actual saved forecast",
  );
  click(100, 618);
  assert.equal(cache.read().length, 0, "Clear saved places persists through Window input");
  assert.ok(native.lastFrame?.some((byte) => byte !== 0));
  console.log(
    "[weather/smoke] real HTTP parsing, location selection, forecast cache, offline fallback and Window clear passed",
  );
} finally {
  window.destroy();
  backend.disconnect();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fs.rm(fixture, { recursive: true, force: true });
}
