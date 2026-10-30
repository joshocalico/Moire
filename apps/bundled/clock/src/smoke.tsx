/** Clock: timer/stopwatch/alarm and world-clock models, then each workflow through a real Window. */
process.env.TZ = "UTC";
import assert from "node:assert/strict";
import path from "node:path";
import React from "react";
import { loadAppSettings } from "@moire/app-tools";
import { mountWindow, withFixture } from "@moire/app-tools/testing";
import { ClockApp } from "./main";
import { AlarmStore, CLOCK_APP_ID } from "./backend";
import {
  nextAlarm,
  parseDuration,
  pauseTimer,
  remaining,
  startTimer,
  stopwatchElapsed,
  toggleStopwatch,
} from "./time";
import {
  addCity,
  allZones,
  parseCities,
  relativeDay,
  relativeOffset,
  removeCity,
  searchZones,
  utcOffsetMinutes,
} from "./world";

// Timer, stopwatch and alarm arithmetic.
assert.equal(parseDuration("01:30"), 90000);
assert.equal(parseDuration("01:00:00"), 3600000);
assert.throws(() => parseDuration("00:00"));
const countdown = startTimer({ kind: "idle", durationMs: 1000 }, 100);
assert.equal(remaining(countdown, 500), 600);
assert.equal(remaining(startTimer(pauseTimer(countdown, 500), 1000), 1200), 400);
const watch = toggleStopwatch({ kind: "paused", elapsedMs: 300, laps: [] }, 1000);
assert.equal(stopwatchElapsed(watch, 1500), 800);
assert.equal(stopwatchElapsed(toggleStopwatch(watch, 1500), 2000), 800);

// World clocks: offsets follow daylight saving; search ranks city prefixes first.
const noonUtc = Date.UTC(2026, 9, 10, 12, 0);
assert.equal(utcOffsetMinutes("Asia/Kolkata", noonUtc), 330);
assert.equal(utcOffsetMinutes("America/New_York", noonUtc), -240, "EDT in October");
assert.equal(utcOffsetMinutes("America/New_York", Date.UTC(2026, 0, 10)), -300, "EST in January");
assert.equal(relativeOffset("Asia/Kolkata", noonUtc), "+5:30 h");
assert.equal(relativeOffset("America/New_York", noonUtc), "−4 h");
assert.equal(relativeOffset("Europe/London", Date.UTC(2026, 0, 10)), "Same time");
assert.equal(relativeDay("Pacific/Auckland", noonUtc), "Tomorrow");
assert.equal(relativeDay("Pacific/Honolulu", Date.UTC(2026, 9, 10, 2)), "Yesterday");
assert.equal(relativeDay("Asia/Tokyo", noonUtc), "Today");
const zones = allZones();
assert.ok(zones.length > 300 && !zones.some((zone) => zone.id.startsWith("Etc/")));
assert.equal(searchZones("kolk", zones)[0]?.id, "Asia/Kolkata");
assert.equal(searchZones("york", zones)[0]?.id, "America/New_York", "word prefixes match");
assert.equal(searchZones("argentina", zones)[0]?.region, "America · Argentina");
assert.ok(!searchZones("tokyo", zones, ["Asia/Tokyo"]).length, "shown cities are not offered");
assert.deepEqual(addCity(addCity([], "Asia/Tokyo"), "Asia/Tokyo"), ["Asia/Tokyo"]);
assert.deepEqual(removeCity(["Asia/Tokyo", "Europe/Paris"], "Asia/Tokyo"), ["Europe/Paris"]);
assert.deepEqual(parseCities({ cities: ["Asia/Tokyo", "Mars/Olympus", 3, "Asia/Tokyo"] }), [
  "Asia/Tokyo",
]);
assert.deepEqual(parseCities("garbage"), []);

await withFixture(async (home) => {
  let wall = noonUtc,
    mono = 1000;
  const rings: string[] = [];
  const store = new AlarmStore(path.join(home, "alarms.json"));
  assert.ok(nextAlarm("07:30", wall) > wall);
  const mount = () =>
    mountWindow(
      (size) => (
        <ClockApp
          {...size}
          store={store}
          wallNow={() => wall}
          monotonicNow={() => mono}
          onRing={(message) => rings.push(message)}
        />
      ),
      { width: 760, height: 520 },
    );
  const savedCities = () => loadAppSettings(CLOCK_APP_ID, parseCities);

  // World clocks: search by typing, pick with the keyboard, remove, and survive a restart.
  let ui = await mount();
  assert.ok(ui.texts().includes("Add City…"), "the empty world view offers Add City");
  ui.press({ focusId: "clock:add-city" });
  assert.ok(ui.texts().includes("Add World Clock"));
  ui.type("kolk");
  assert.ok(ui.texts().includes("Kolkata"));
  ui.key(28, "Enter");
  assert.ok(!ui.texts().includes("Add World Clock"), "Enter adds the top match and closes");
  assert.ok(ui.texts().includes("Kolkata"));
  assert.ok(ui.texts().includes("Today · +5:30 h · Asia"), "day and offset from local time");
  assert.deepEqual(savedCities(), ["Asia/Kolkata"]);
  ui.press({ focusId: "clock:add-city" });
  ui.type("new");
  assert.ok(ui.texts().includes("New Salem") && ui.texts().includes("New York"));
  ui.key(108, "ArrowDown");
  ui.key(28, "Enter");
  assert.deepEqual(savedCities(), ["Asia/Kolkata", "America/New_York"], "arrow keys pick a match");
  ui.press({ focusId: "clock:add-city" });
  ui.type("Tokyo");
  ui.key(1, "Escape");
  assert.ok(!ui.texts().includes("Add World Clock"), "Escape cancels");
  assert.equal(savedCities().length, 2);
  ui.press({ focusId: "clock:remove-city:Asia/Kolkata" });
  assert.deepEqual(savedCities(), ["America/New_York"]);
  assert.ok(!ui.texts().includes("Kolkata"));
  ui.destroy();
  ui = await mount();
  assert.ok(ui.texts().includes("New York"), "world clocks persist across restarts");
  assert.ok(ui.texts().includes("Today · −4 h · America"));

  // Timer: type a duration, Enter starts it; only the monotonic clock can finish it.
  ui.press({ text: "Timer" });
  ui.press({ focusId: "clock:timer-duration" });
  ui.key(30, "a", { ctrl: true });
  ui.type("00:01");
  ui.key(28, "Enter");
  wall += 3600000;
  await ui.settle(15);
  assert.equal(rings.length, 0, "wall-clock changes do not complete the countdown");
  mono += 1200;
  await ui.until(() => rings.length === 1, "timer rings");
  assert.deepEqual(rings, ["Timer finished"]);
  await ui.settle(15);
  assert.equal(rings.length, 1, "the timer rings once");
  ui.press({ text: "Dismiss" });

  // Stopwatch: start, lap, pause.
  ui.press({ text: "Stopwatch" });
  ui.press({ focusId: "clock:stopwatch-toggle" });
  mono += 1500;
  await ui.settle(15);
  ui.press({ focusId: "clock:lap" });
  assert.ok(ui.texts().includes("Lap 1") && ui.texts().includes("+1.50s"));
  ui.press({ focusId: "clock:stopwatch-toggle" });
  assert.ok(ui.texts().includes("00:00:01.50"));

  // Alarms: add, ring, snooze, ring again, disable, delete.
  ui.press({ text: "Alarms" });
  ui.press({ focusId: "clock:alarm-label" });
  ui.key(30, "a", { ctrl: true });
  ui.type("Tea alarm");
  ui.press({ focusId: "clock:add-alarm" });
  const [tea] = store.read(wall);
  assert.equal(tea?.label, "Tea alarm");
  wall = tea.nextAtMs;
  await ui.until(() => rings.length === 2, "alarm rings");
  assert.deepEqual(rings, ["Timer finished", "Tea alarm"]);
  ui.press({ text: "Snooze 5m" });
  wall += 300001;
  await ui.until(() => rings.length === 3, "snoozed alarm rings again");
  ui.press({ text: "Dismiss" });
  ui.press({ focusId: `clock:enable-alarm:${tea.id}` });
  assert.equal(store.read(wall)[0]?.enabled, false);
  ui.press({ focusId: `clock:delete-alarm:${tea.id}` });
  assert.equal(store.read(wall).length, 0);
  assert.ok(ui.native.lastFrame?.some((byte) => byte !== 0));
  ui.destroy();
});
console.log(
  "[clock/smoke] timer/stopwatch/alarm models, world-clock search/offsets, and world add/remove/persist, timer, stopwatch, alarm ring/snooze/delete through a live Window passed",
);
