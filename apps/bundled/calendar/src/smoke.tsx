import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { Window, installUiFonts } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { CalendarApp } from "./main";
import {
  CalendarStore,
  dayEvents,
  eventFromDraft,
  localDateTime,
  monthDays,
  moveMonth,
  zonedTimestamp,
} from "./events";

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-calendar-")),
  backend = new HeadlessPlatform(),
  window = new Window({ title: "calendar workflows", width: 940, height: 660 });
try {
  await installUiFonts();
  assert.equal(monthDays("2024-02").length, 42);
  assert.equal(moveMonth("2024-12", 1), "2025-01");
  assert.throws(() => zonedTimestamp("2024-03-10", "02:30", "America/New_York"), /does not exist/);
  assert.equal(
    new Date(zonedTimestamp("2024-11-03", "01:30", "America/New_York")).toISOString(),
    "2024-11-03T05:30:00.000Z",
  );
  assert.equal(
    localDateTime(zonedTimestamp("2026-10-02", "09:00", "Australia/Adelaide"), "Australia/Adelaide")
      .time,
    "09:00",
  );
  const store = new CalendarStore(path.join(fixture, "events.json"));
  const seeded = eventFromDraft({
    title: "Fixture",
    date: "2026-10-02",
    start: "09:00",
    end: "10:00",
    timeZone: "Australia/Adelaide",
    notes: "",
  });
  store.write([seeded], store.load().revision);
  assert.equal(dayEvents(store.read(), "2026-10-02", "Australia/Adelaide").length, 1);
  store.write([], store.load().revision);
  await backend.connect();
  window.setContent((size) => (
    <CalendarApp {...size} store={store} now={() => Date.parse("2026-10-02T00:00:00Z")} />
  ));
  window.mount(backend);
  await Promise.resolve();
  window.tick();
  const native = backend.getWindows()[0];
  assert.ok(native);
  const mods = { shift: false, ctrl: false, alt: false, meta: false };
  const key = (code: number, key: string, text?: string, ctrl = false) => {
    native.injectKey({ type: "down", code, key, text, modifiers: { ...mods, ctrl }, timeMs: 1 });
    window.tick();
    window.tick();
  };
  const click = (x: number, y: number) => {
    native.injectPointer({ type: "down", x, y, button: "left", timeMs: 1 });
    native.injectPointer({ type: "up", x, y, button: "left", timeMs: 2 });
    window.tick();
  };
  key(49, "n", undefined, true);
  key(30, "a", "Team planning");
  key(31, "s", undefined, true);
  assert.equal(
    store.read()[0]?.title,
    "Team planning",
    "New event saves through actual focused fields and shortcut",
  );
  click(500, 217);
  key(30, "a", undefined, true);
  key(30, "a", "Revised planning");
  key(31, "s", undefined, true);
  assert.equal(store.read()[0]?.title, "Revised planning", "Edit keeps the same persisted event");
  assert.equal(store.read().length, 1);
  const before = await fs.readFile(store.file, "utf8");
  await fs.writeFile(store.file, "broken");
  assert.throws(() => store.read());
  assert.equal(await fs.readFile(store.file, "utf8"), "broken");
  await fs.writeFile(store.file, before);
  assert.ok(native.lastFrame?.some((byte) => byte !== 0));
  console.log(
    "[calendar/smoke] timezone/DST, persistence and real Window create/edit workflows passed",
  );
} finally {
  window.destroy();
  backend.disconnect();
  await fs.rm(fixture, { recursive: true, force: true });
}
