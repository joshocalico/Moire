import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { Window, installUiFonts } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { ClockApp } from "./main";
import {
  AlarmStore,
  nextAlarm,
  parseDuration,
  pauseTimer,
  remaining,
  startTimer,
  stopwatchElapsed,
  toggleStopwatch,
} from "./time";
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-clock-")),
  backend = new HeadlessPlatform(),
  window = new Window({ title: "clock workflows", width: 760, height: 520 });
try {
  await installUiFonts();
  assert.equal(parseDuration("01:30"), 90000);
  assert.equal(parseDuration("01:00:00"), 3600000);
  assert.throws(() => parseDuration("00:00"));
  const timer = startTimer({ kind: "idle", durationMs: 1000 }, 100);
  assert.equal(remaining(timer, 500), 600);
  assert.equal(remaining(startTimer(pauseTimer(timer, 500), 1000), 1200), 400);
  const watch = toggleStopwatch({ kind: "paused", elapsedMs: 300, laps: [] }, 1000);
  assert.equal(stopwatchElapsed(watch, 1500), 800);
  assert.equal(stopwatchElapsed(toggleStopwatch(watch, 1500), 2000), 800);
  let wall = Date.now(),
    mono = 1000;
  const rings: string[] = [];
  const store = new AlarmStore(path.join(fixture, "alarms.json"));
  assert.ok(nextAlarm("07:30", wall) > wall);
  await backend.connect();
  window.setContent((size) => (
    <ClockApp
      {...size}
      store={store}
      wallNow={() => wall}
      monotonicNow={() => mono}
      onRing={(message) => rings.push(message)}
    />
  ));
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
  const text = (x: number, y: number, value: string) => {
    click(x, y);
    native.injectKey({
      type: "down",
      code: 30,
      key: "a",
      modifiers: { ...mods, ctrl: true },
      timeMs: 1,
    });
    native.injectKey({ type: "down", code: 30, key: "a", text: value, modifiers: mods, timeMs: 2 });
    window.tick();
  };
  click(520, 32);
  text(60, 220, "00:01");
  click(80, 280);
  wall += 3600000;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(rings.length, 0, "Wall-clock changes do not complete the countdown");
  mono += 1200;
  await new Promise((resolve) => setTimeout(resolve, 130));
  window.tick();
  assert.deepEqual(rings, ["Timer finished"], "Timer fires once through live app interval");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(rings.length, 1);
  click(712, 32);
  text(200, 140, "Tea alarm");
  click(650, 146);
  assert.equal(store.read(wall)[0]?.label, "Tea alarm");
  wall = store.read(wall)[0]?.nextAtMs ?? wall;
  await new Promise((resolve) => setTimeout(resolve, 120));
  window.tick();
  assert.deepEqual(rings, ["Timer finished", "Tea alarm"]);
  // Timer and alarm receipts are independent. Dismiss the timer explicitly
  // before snoozing the alarm through the visible dialog's persistent footer.
  click(60, 447);
  click(150, 447);
  wall += 300001;
  await new Promise((resolve) => setTimeout(resolve, 120));
  window.tick();
  assert.deepEqual(rings, ["Timer finished", "Tea alarm", "Tea alarm"], "Snooze fires again");
  click(60, 447);
  click(46, 220);
  assert.equal(store.read(wall)[0]?.enabled, false);
  click(680, 220);
  assert.equal(store.read(wall).length, 0);
  assert.ok(native.lastFrame?.some((byte) => byte !== 0));
  console.log(
    "[clock/smoke] timer pause/resume, monotonic stopwatch, alarm persistence and live Window completion passed",
  );
} finally {
  window.destroy();
  backend.disconnect();
  await fs.rm(fixture, { recursive: true, force: true });
}
