import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { Rect, SoftwareRenderer, createShellRoot, renderShell } from "@moire/react-host";
import { Window, installUiFonts } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { ScreenshotApp } from "./main";
import { applyEdits, cropImage, readPNG, savePNG } from "./capture";
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-screenshot-")),
  backend = new HeadlessPlatform(),
  window = new Window({ title: "screenshot workflows", width: 980, height: 720 }),
  root = createShellRoot();
try {
  await installUiFonts();
  renderShell(root, <Rect width={100} height={100} fill={0xff336699} />);
  const frame = new SoftwareRenderer().render(root.container, { width: 100, height: 100 });
  const rgba = new Uint8Array(frame.pixels.length);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = frame.pixels[i + 2] ?? 0;
    rgba[i + 1] = frame.pixels[i + 1] ?? 0;
    rgba[i + 2] = frame.pixels[i] ?? 0;
    rgba[i + 3] = frame.pixels[i + 3] ?? 0;
  }
  const source = { width: 100, height: 100, rgba };
  const crop = cropImage(source, { x: 10, y: 20, width: 30, height: 40 });
  assert.equal(crop.width, 30);
  assert.equal(crop.height, 40);
  assert.deepEqual(crop.rgba.slice(0, 4), new Uint8Array([51, 102, 153, 255]));
  assert.throws(() => cropImage(source, { x: 0, y: 0, width: 0, height: 0 }));
  const annotated = applyEdits(crop, [
    {
      kind: "pen",
      points: [
        { x: 2, y: 2 },
        { x: 20, y: 2 },
      ],
      width: 2,
      color: [255, 0, 0, 255],
    },
    {
      kind: "rectangle",
      bounds: { x: 2, y: 10, width: 20, height: 20 },
      width: 2,
      color: [0, 255, 0, 255],
    },
  ]);
  assert.deepEqual(
    annotated.rgba.slice((2 * 30 + 4) * 4, (2 * 30 + 4) * 4 + 4),
    new Uint8Array([255, 0, 0, 255]),
  );
  const file = path.join(fixture, "actual-render.png");
  await savePNG(annotated, file);
  assert.deepEqual((await readPNG(file)).rgba, annotated.rgba);
  await assert.rejects(
    () => savePNG(source, file),
    (error) => error instanceof Error && "code" in error && error.code === "EEXIST",
  );
  await savePNG(source, file, true);
  assert.equal((await readPNG(file)).width, 100);
  await backend.connect();
  window.setContent((size) => <ScreenshotApp {...size} initialImage={source} />);
  window.mount(backend);
  await Promise.resolve();
  window.tick();
  const native = backend.getWindows()[0];
  assert.ok(native);
  const mods = { shift: false, ctrl: false, alt: false, meta: false };
  native.injectPointer({ type: "down", x: 350, y: 210, button: "left", timeMs: 1 });
  native.injectPointer({ type: "move", x: 520, y: 420, button: "left", timeMs: 2 });
  native.injectPointer({ type: "up", x: 520, y: 420, button: "left", timeMs: 3 });
  window.tick();
  const click = (x: number, y: number) => {
    native.injectPointer({ type: "down", x, y, button: "left", timeMs: 1 });
    native.injectPointer({ type: "up", x, y, button: "left", timeMs: 2 });
    window.tick();
  };
  const output = path.join(fixture, "window-crop.png");
  click(140, 650);
  native.injectKey({
    type: "down",
    code: 30,
    key: "a",
    modifiers: { ...mods, ctrl: true },
    timeMs: 1,
  });
  native.injectKey({ type: "down", code: 30, key: "a", text: output, modifiers: mods, timeMs: 2 });
  click(900, 650);
  for (let i = 0; i < 50; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    window.tick();
    try {
      if ((await fs.stat(output)).isFile()) break;
    } catch {}
  }
  const edited = await readPNG(output);
  assert.ok(
    edited.width < 100 && edited.height < 100,
    "Window drag crop changes actual saved PNG dimensions",
  );
  assert.deepEqual(edited.rgba.slice(0, 4), new Uint8Array([51, 102, 153, 255]));
  assert.ok(native.lastFrame?.some((byte) => byte !== 0));
  console.log(
    "[screenshot/smoke] real renderer PNG pixels, crop/pen/box/save/overwrite and Window crop-to-save passed",
  );
} finally {
  window.destroy();
  backend.disconnect();
  renderShell(root, null);
  await fs.rm(fixture, { recursive: true, force: true });
}
