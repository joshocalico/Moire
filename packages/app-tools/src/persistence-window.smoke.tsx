/* eslint-disable import/no-relative-parent-imports -- Integration fixtures exercise the actual app trees. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { Window, installUiFonts, type WindowSize } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import type { PaletteStore } from "../../../apps/bundled/colors/src/palettes";
import { windowControl } from "./testing";

const fixtureApps = ["calendar", "clock", "colors"] as const;
type FixtureApp = (typeof fixtureApps)[number];
/** Saved-item fields shared by calendar events, clock alarms and color palettes. */
type SavedItem = { title?: string; label?: string; name?: string };
/** Store surface shared by CalendarStore, AlarmStore and PaletteStore. */
type FixtureStore = { read(now?: number): readonly SavedItem[] };
/** Props passed to every app; each app reads only the ones it declares. */
type FixtureAppProps = WindowSize & {
  store: FixtureStore;
  now: () => number;
  wallNow: () => number;
  monotonicNow: () => number;
  onRing: (message: string) => void;
};
function isFixtureApp(value: string | undefined): value is FixtureApp {
  return fixtureApps.some((name) => name === value);
}
const scope = path.dirname(fileURLToPath(import.meta.url)),
  app = process.argv[2];
assert.ok(isFixtureApp(app));
type FixtureSpec = readonly [
  module: string,
  store: string,
  component: string,
  width: number,
  height: number,
];
const spec = (
  {
    calendar: ["events.ts", "CalendarStore", "CalendarApp", 940, 660],
    clock: ["backend.ts", "AlarmStore", "ClockApp", 760, 520],
    colors: ["palettes.ts", "PaletteStore", "ColorsApp", 840, 680],
  } satisfies Record<FixtureApp, FixtureSpec>
)[app];
const folder = path.resolve(scope, "../../..", `apps/bundled/${app}/src`),
  { [spec[1]]: Store }: Record<string, new (file: string) => FixtureStore> = await import(
    path.join(folder, spec[0])
  ),
  { [spec[2]]: App }: Record<string, (props: FixtureAppProps) => React.ReactNode> = await import(
    path.join(folder, "main.tsx")
  );
const temp = fs.mkdtempSync(path.join(os.tmpdir(), `moire-${app}-window-conflict-`)),
  file = path.join(temp, "saved.json");
const backend = new HeadlessPlatform(),
  windows: Window[] = [];
const now = Date.parse("2026-10-03T00:00:00Z");
let mono = 1000;
const store = new Store(file);
try {
  await installUiFonts();
  await backend.connect();
  function mount() {
    const window = new Window({ title: `${app} conflict`, width: spec[3], height: spec[4] });
    const rings: string[] = [];
    windows.push(window);
    window.setContent((size) => (
      <App
        {...size}
        store={new Store(file)}
        now={() => now}
        wallNow={() => now}
        monotonicNow={() => mono}
        onRing={(message) => rings.push(message)}
      />
    ));
    window.mount(backend);
    window.tick();
    window.tick();
    const native = backend.getWindows().at(-1);
    assert.ok(native);
    const key = (key: string, text?: string, ctrl = false) => {
      native.injectKey({
        type: "down",
        code: key === "Escape" ? 1 : key === "Enter" ? 28 : 30,
        key,
        text,
        modifiers: { shift: false, ctrl, alt: false, meta: false },
        timeMs: 1,
      });
      window.tick();
      window.tick();
    };
    /** Press the control with this focusId or painted label (layout-independent). */
    const click = (match: { focusId: string } | { text: string }) => {
      const { x, y } = windowControl(window, match);
      native.injectPointer({ type: "down", x, y, button: "left", timeMs: 1 });
      native.injectPointer({ type: "up", x, y, button: "left", timeMs: 2 });
      window.tick();
      window.tick();
    };
    /** Replace the text of the field with this focusId. */
    const text = (focusId: string, value: string) => {
      click({ focusId });
      key("a", undefined, true);
      key("a", value);
    };
    return { window, native, key, click, text, rings };
  }
  type Mounted = ReturnType<typeof mount>;
  const first = mount(),
    second = mount();
  if (app === "clock") {
    first.click({ text: "Timer" });
    first.text("clock:timer-duration", "00:01");
    first.click({ focusId: "clock:timer-toggle" });
  }
  function draft(w: Mounted, title: string) {
    if (app === "calendar") {
      w.key("n", undefined, true);
      w.key("a", title);
    }
    if (app === "clock") {
      w.click({ text: "Alarms" });
      w.text("clock:alarm-label", title);
    }
    if (app === "colors") {
      w.text("colors:palette-name", title);
    }
  }
  function save(w: Mounted) {
    if (app === "calendar") w.key("s", undefined, true);
    else if (app === "clock") w.click({ focusId: "clock:add-alarm" });
    else w.click({ focusId: "colors:new-palette" });
  }
  draft(first, "Draft retained");
  draft(second, "Other window saved");
  save(second);
  assert.equal(store.read(now).length, 1, "independent second Window saves");
  const otherBytes = fs.readFileSync(file);
  save(first);
  assert.deepEqual(fs.readFileSync(file), otherBytes, "stale first Window cannot overwrite second");
  first.key("Escape");
  save(first);
  assert.deepEqual(
    fs.readFileSync(file),
    otherBytes,
    "Keep draft does not silently authorize retry",
  );
  first.key("Enter");
  save(first);
  const final = store.read(now);
  assert.equal(final.length, 2, "explicit reload then deliberate retry retains both actors");
  const names = final.map((x) => x.title ?? x.label ?? x.name).sort();
  assert.deepEqual(
    names,
    ["Draft retained", "Other window saved"],
    "current input survives Keep draft and Reload saved",
  );
  if (app === "clock") {
    mono += 1200;
    await new Promise((resolve) => setTimeout(resolve, 140));
    first.window.tick();
    assert.deepEqual(first.rings, ["Timer finished"], "Reload saved never resets running timer");
  }
  if (app === "colors") {
    first.text("colors:hex", "#FF8800");
    first.text("colors:color-name", "Sunset draft");
    const external = new Store(file) as PaletteStore,
      snapshot = external.load();
    external.write(
      snapshot.items.map((p) =>
        p.name === "Draft retained"
          ? {
              ...p,
              swatches: [...p.swatches, { id: "other-color", name: "Other color", hex: "#010203" }],
            }
          : p,
      ),
      snapshot.revision,
    );
    const beforeColor = fs.readFileSync(file);
    first.click({ focusId: "colors:save-color" });
    assert.deepEqual(fs.readFileSync(file), beforeColor);
    first.key("Escape");
    first.click({ focusId: "colors:save-color" });
    assert.deepEqual(fs.readFileSync(file), beforeColor);
    first.key("Enter");
    first.click({ focusId: "colors:save-color" });
    const swatches = external.read().find((p) => p.name === "Draft retained")!.swatches;
    assert.ok(
      swatches.some((s) => s.name === "Sunset draft" && s.hex === "#FF8800"),
      "HEX and color-name draft survive reload",
    );
    assert.ok(
      swatches.some((s) => s.id === "other-color" && s.hex === "#010203"),
      "reload preserves other instance swatch",
    );
  }
  const original = fs.readFileSync(file);
  fs.writeFileSync(file, "malformed actor data");
  if (app === "calendar") draft(first, "Draft after malformed");
  else draft(first, "Draft after malformed");
  save(first);
  assert.equal(
    fs.readFileSync(file, "utf8"),
    "malformed actor data",
    "malformed current data is not overwritten",
  );
  // Fix the external file, then explicitly reload via the public toolbar.
  fs.writeFileSync(file, original);
  first.key("Enter");
  save(first);
  assert.ok(
    store.read(now).some((x) => (x.title ?? x.label ?? x.name) === "Draft after malformed"),
    "explicit recovery keeps current input",
  );
  draft(first, "Draft after EIO");
  const beforeEio = fs.readFileSync(file),
    rename = fs.renameSync;
  try {
    fs.renameSync = (from, to) => {
      if (to === file) throw new Error("fixture save EIO");
      return rename(from, to);
    };
    save(first);
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(fs.readFileSync(file), beforeEio, "failed publication preserves saved bytes");
  first.key("Escape");
  save(first);
  assert.ok(
    store.read(now).some((x) => (x.title ?? x.label ?? x.name) === "Draft after EIO"),
    "failed save keeps input for deliberate retry",
  );
  assert.ok(first.native.lastFrame?.some((byte) => byte !== 0));
  console.log(
    JSON.stringify(
      {
        app,
        cases: [
          "two real public Windows retain external commit",
          "Keep draft does not permit stale retry",
          "Reload saved retains draft and requires deliberate retry",
          "malformed saved bytes preserved and explicit recovery retains input",
          "failed publication retains input and saved bytes for deliberate retry",
          "Clock timer and Colors HEX/name independence exercised where relevant",
        ],
        scope:
          "actual checkout or installed apps/shared HeadlessPlatform; no installed/native input claim",
      },
      null,
      2,
    ),
  );
} finally {
  for (const w of windows) w.destroy();
  backend.disconnect();
  fs.rmSync(temp, { recursive: true, force: true });
}
