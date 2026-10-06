import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { Window, installUiFonts, readClipboardText } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { ColorsApp } from "./main";
import { PaletteStore, parseHex, rgbHex } from "./palettes";
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-colors-")),
  backend = new HeadlessPlatform(),
  window = new Window({ title: "colors workflows", width: 840, height: 680 });
try {
  await installUiFonts();
  assert.deepEqual(parseHex("#F80"), { r: 255, g: 136, b: 0 });
  assert.equal(rgbHex({ r: 1, g: 2, b: 3 }), "#010203");
  assert.throws(() => parseHex("#nope"));
  assert.throws(() => rgbHex({ r: 256, g: 0, b: 0 }));
  const store = new PaletteStore(path.join(fixture, "palettes.json"));
  await fs.writeFile(
    store.file,
    JSON.stringify([
      { id: "duplicate", name: "One", swatches: [] },
      { id: "duplicate", name: "Two", swatches: [] },
    ]),
  );
  assert.throws(() => store.read(), /duplicate palette IDs/);
  await fs.writeFile(store.file, "[]");
  await backend.connect();
  window.setContent((size) => <ColorsApp {...size} store={store} />);
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
  click(100, 175);
  assert.equal(store.read()[0]?.name, "My palette");
  click(750, 382);
  assert.equal(store.read()[0]?.swatches[0]?.hex, "#BF5AF2");
  text(430, 265, "#FF8800");
  click(750, 382);
  assert.equal(store.read()[0]?.swatches.length, 1);
  assert.equal(store.read()[0]?.swatches[0]?.hex, "#FF8800");
  click(770, 35);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    await readClipboardText(),
    "#FF8800",
    "Copy uses the real headless clipboard backend",
  );
  text(120, 132, "Warm colors");
  click(66, 592);
  assert.equal(store.read()[0]?.name, "Warm colors");
  click(455, 428);
  assert.equal(store.read()[0]?.swatches.length, 0);
  assert.ok(native.lastFrame?.some((byte) => byte !== 0));
  console.log(
    "[colors/smoke] HEX/RGB validation, palette/swatch create/update/delete and Window clipboard passed",
  );
} finally {
  window.destroy();
  backend.disconnect();
  await fs.rm(fixture, { recursive: true, force: true });
}
