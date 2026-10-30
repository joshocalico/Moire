/* eslint-disable import/no-relative-parent-imports -- Exercise a real app's frames, not a widget fixture. */
/**
 * The damage a window reports must cover every pixel that changed. The output here is rebuilt
 * only from the reported damage rectangles (as a compositor uploads them) and must equal the
 * window's real frame after every frame: through directory navigation, scrolling and hover.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import type { RetainedClip } from "@moire/react-host";
import { installUiFonts, tickAllMotions, Window } from "@moire/ui";
import { HeadlessPlatform } from "../src/platforms/headless/index";
import { FilesApp } from "../../../apps/bundled/files/src/main";

await installUiFonts();
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-damage-contract-"));
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, ".config");
const child = path.join(fixture, "child");
await fs.mkdir(child);
await fs.writeFile(path.join(fixture, "visible-after-up.txt"), "parent");
for (let i = 0; i < 40; i++)
  await fs.writeFile(path.join(child, `item-${String(i).padStart(2, "0")}.txt`), `${i}`);

const width = 1020;
const height = 600;
const backend = new HeadlessPlatform();
await backend.connect();
const win = new Window({ title: "Damage contract", width, height });
win.setContent((size) => <FilesApp {...size} initialPath={child} onQuit={() => {}} />);
win.mount(backend);
await Promise.resolve();
const native = backend.getWindows()[0]!;
// Take the cached-layer path a Wayland SHM client takes.
(native as unknown as { presentScene?: () => boolean }).presentScene = () => false;

let output: Uint8Array | null = null;
let frames = 0;
let checked = 0;
const present = native.present.bind(native);
native.present = (pixels: Uint8Array, w: number, h: number, damage?: readonly RetainedClip[]) => {
  present(pixels, w, h, damage);
  frames++;
  if (!output || output.length !== pixels.length || !damage) {
    output = Uint8Array.from(pixels);
    return;
  }
  for (const rect of damage) {
    const left = Math.max(0, Math.floor(rect.x));
    const top = Math.max(0, Math.floor(rect.y));
    const right = Math.min(w, Math.ceil(rect.x + rect.width));
    const bottom = Math.min(h, Math.ceil(rect.y + rect.height));
    for (let row = top; row < bottom; row++)
      output.set(
        pixels.subarray((row * w + left) * 4, (row * w + right) * 4),
        (row * w + left) * 4,
      );
  }
  checked++;
  if (Buffer.compare(Buffer.from(output), Buffer.from(pixels)) !== 0) {
    let x0 = w,
      y0 = h,
      x1 = -1,
      y1 = -1;
    const view = new Uint32Array(output.buffer),
      real = new Uint32Array(pixels.buffer, pixels.byteOffset, pixels.length / 4);
    for (let p = 0; p < real.length; p++)
      if (view[p] !== real[p]) {
        const x = p % w,
          y = Math.floor(p / w);
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    assert.fail(`frame ${frames}: undamaged change at ${x0},${y0}–${x1},${y1}`);
  }
};

const settle = async (count = 6) => {
  for (let i = 0; i < count; i++) {
    tickAllMotions(1 / 60);
    win.tick();
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
};
const key = (code: number, name: string, alt = false) => {
  for (const type of ["down", "up"] as const)
    native.injectKey({
      type,
      code,
      key: name,
      modifiers: { shift: false, ctrl: false, alt, meta: false },
      timeMs: 1,
    });
};

// Let the directory load and the first frame settle.
for (let i = 0; i < 40 && checked < 3; i++) await settle(2);
await settle(10);
// Scroll the listing and hover across rows.
for (let notch = 0; notch < 8; notch++) {
  native.injectPointer({ type: "wheel", x: 450, y: 320, deltaY: 40, timeMs: notch } as never);
  native.injectPointer({ type: "move", x: 420, y: 200 + notch * 22, timeMs: notch } as never);
  await settle(3);
}
// Navigate to the parent directory, as the native interaction test does.
key(103, "ArrowUp", true);
for (let i = 0; i < 40; i++) await settle(2);
// Files scrolls its page directly (no eased wheel), so each notch is one frame.
assert.ok(checked > 10, `enough frames were checked (${checked})`);
console.log(`[ui/damage-contract] ${checked} frames rebuilt from damage matched the real frames`);
win.destroy?.();
process.exit(0);
