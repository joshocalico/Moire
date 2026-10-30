/**
 * The lock screen surface: renders at desktop and narrow sizes, both schemes and UI scales, and
 * dispatches the power menu. Set MOIRE_LOCK_SCREEN_DIR to write PNGs for review (composited over
 * a darkened wallpaper, as the compositor shows them).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { DEFAULT_SETTINGS, themeForSettings } from "@moire/prefs";
import { paintWallpaper, setTheme } from "@moire/theme";
import { installUiFonts, setUiScaleFactor, tickAllMotions } from "@moire/ui";
import { createLockSurface, type LockRaster } from "./lock-surface";
import { LOCK_FOCUS } from "./LockScreen";
import type { LockScreenView } from "./types";

const out = process.env.MOIRE_LOCK_SCREEN_DIR;
if (out) fs.mkdirSync(out, { recursive: true });
await installUiFonts();

const base: LockScreenView = {
  revision: 1,
  user: { name: "Joshua Steele", username: "josh" },
  length: 0,
  phase: "entry",
  retryAtMs: null,
  failures: 0,
  capsLock: false,
  layout: { label: "US", name: "English (US)" },
  power: { suspend: true, powerOff: true, reboot: true },
  reducedMotion: true,
};

function surface(battery = true) {
  return createLockSurface({
    clock: () => "14:20",
    date: () => "Friday, October 9, 2026",
    battery: () => (battery ? { percentage: 82, charging: false } : null),
  });
}

/** Settle motion and return the final raster. */
function settle(lock: ReturnType<typeof surface>, view: LockScreenView, w: number, h: number) {
  let raster: LockRaster | null = null;
  for (let frame = 0; frame < 40; frame++) {
    raster = lock.raster(view, w, h);
    tickAllMotions(0.05);
  }
  raster = lock.raster(view, w, h);
  assert.ok(raster, "the lock surface renders");
  assert.equal(raster.width, w);
  assert.equal(raster.height, h);
  return raster;
}

function writePng(name: string, raster: LockRaster, dark: boolean) {
  if (!out) return;
  const { width, height } = raster;
  const ground = new Uint32Array(width * height);
  paintWallpaper(ground, width, width, height, themeForSettings({ ...DEFAULT_SETTINGS, dark }), 0);
  const png = new PNG({ width, height });
  const src = new Uint32Array(raster.pixels.buffer, raster.pixels.byteOffset, width * height);
  for (let i = 0; i < width * height; i++) {
    const g = ground[i]!;
    const s = src[i]!;
    const a = (s >>> 24) / 255;
    // The compositor's backdrop keeps half the (blurred) wallpaper, toward black or white.
    const under = (shift: number) =>
      dark ? ((g >>> shift) & 255) * 0.5 : 255 - (255 - ((g >>> shift) & 255)) * 0.5;
    const channel = (shift: number) =>
      Math.min(255, Math.round(under(shift) * (1 - a) + ((s >>> shift) & 255)));
    png.data[i * 4] = channel(16);
    png.data[i * 4 + 1] = channel(8);
    png.data[i * 4 + 2] = channel(0);
    png.data[i * 4 + 3] = 255;
  }
  fs.writeFileSync(path.join(out, `${name}.png`), PNG.sync.write(png));
}

let cases = 0;
const sizes = [
  [1020, 700],
  [640, 650],
] as const;
for (const dark of [true, false])
  for (const scale of [1, 1.5])
    for (const [w, h] of sizes) {
      setTheme(themeForSettings({ ...DEFAULT_SETTINGS, dark }));
      setUiScaleFactor(scale);
      const lock = surface();
      lock.setLocked(true);
      const typed = { ...base, revision: 2, length: 7, capsLock: true };
      const raster = settle(lock, typed, w, h);
      writePng(`lock-${dark ? "dark" : "light"}-${w}x${h}-scale${scale}`, raster, dark);
      // Every pixel outside the UI is transparent: the compositor's backdrop shows through.
      const words = new Uint32Array(raster.pixels.buffer, raster.pixels.byteOffset, w * h);
      assert.equal(words[0]! >>> 24, 0, "corners stay transparent");
      cases++;
    }

// States, for review: wrong, rate limited, checking, unavailable, the power menu, no power.
{
  setTheme(themeForSettings({ ...DEFAULT_SETTINGS, dark: true }));
  setUiScaleFactor(1);
  const states: [string, Partial<LockScreenView>][] = [
    ["wrong", { phase: "wrong", failures: 1, length: 0 }],
    ["rate-limited", { phase: "rate-limited", retryAtMs: Date.now() + 60_000, failures: 5 }],
    ["checking", { phase: "checking", length: 0 }],
    ["unavailable", { phase: "unavailable", layout: null }],
    [
      "long-name",
      {
        user: { name: "Maximiliana Wolfeschlegelsteinhausen-Bergerdorff", username: "max" },
        length: 64,
      },
    ],
  ];
  for (const [name, patch] of states) {
    const lock = surface();
    lock.setLocked(true);
    const raster = settle(lock, { ...base, revision: 3, ...patch }, 1020, 700);
    writePng(`lock-state-${name}`, raster, true);
    cases++;
  }
}

// Pointer: the power button opens the menu, a row returns its action once, outside closes it.
{
  setTheme(themeForSettings({ ...DEFAULT_SETTINGS, dark: true }));
  setUiScaleFactor(1);
  const lock = surface();
  lock.setLocked(true);
  const w = 1020,
    h = 700;
  const first = settle(lock, base, w, h);
  const before = first.revision;
  assert.equal(lock.raster(base, w, h)?.revision, before, "an unchanged view keeps its revision");
  const click = (rect: { x: number; y: number; width: number; height: number }) => {
    const x = rect.x + rect.width / 2;
    const y = rect.y + rect.height / 2;
    lock.pointer({ x, y });
    assert.equal(lock.pointer({ x, y, button: 0x110, value: 1 }), null, "press never acts");
    return lock.pointer({ x, y, button: 0x110, value: 0 });
  };
  const power = lock.control(LOCK_FOCUS.power);
  assert.ok(power, "the power button is there");
  assert.ok(power.x + power.width <= w && power.y + power.height <= h, "inside the output");
  assert.equal(click(power), null, "the power button only opens the menu");
  const menu = settle(lock, base, w, h);
  assert.notEqual(menu.revision, before, "the menu redraws");
  writePng("lock-state-power-menu", menu, true);
  const suspend = lock.control(LOCK_FOCUS.suspend);
  const reboot = lock.control(LOCK_FOCUS.reboot);
  const powerOff = lock.control(LOCK_FOCUS.powerOff);
  assert.ok(suspend && reboot && powerOff, "every allowed action is listed");
  assert.ok(suspend.y < reboot.y && reboot.y < powerOff.y, "suspend, restart, shut down");
  assert.ok(suspend.y + suspend.height <= power.y, "the menu opens above the button");
  assert.equal(click(reboot), "reboot");
  settle(lock, base, w, h);
  click(lock.control(LOCK_FOCUS.power)!);
  settle(lock, base, w, h);
  assert.equal(click(lock.control(LOCK_FOCUS.suspend)!), "suspend");
  settle(lock, base, w, h);
  assert.equal(lock.control(LOCK_FOCUS.suspend), null, "choosing closes the menu");
  // Only allowed actions appear.
  click(lock.control(LOCK_FOCUS.power)!);
  const suspendOnly = {
    ...base,
    revision: 9,
    power: { suspend: true, powerOff: false, reboot: false },
  };
  settle(lock, suspendOnly, w, h);
  assert.ok(lock.control(LOCK_FOCUS.suspend));
  assert.equal(lock.control(LOCK_FOCUS.powerOff), null);
  assert.equal(lock.control(LOCK_FOCUS.reboot), null);
  // A press elsewhere closes it without acting.
  assert.equal(click({ x: 10, y: 10, width: 1, height: 1 }), null);
  settle(lock, suspendOnly, w, h);
  assert.equal(lock.control(LOCK_FOCUS.suspend), null);
  cases++;

  // Without power actions there is no power button at all.
  const bare = surface(false);
  bare.setLocked(true);
  const none = { ...base, power: { suspend: false, powerOff: false, reboot: false } };
  const raster = settle(bare, none, w, h);
  assert.ok(raster);
  assert.equal(bare.control(LOCK_FOCUS.power), null, "nothing to open");
  cases++;

  // Unlocking unmounts; the next lock renders afresh.
  lock.setLocked(false);
  assert.equal(lock.needsRepaint(false), false, "an unmounted lock asks for no frames");
  cases++;
}

console.log(`[lock-screen] ${cases} cases PASS${out ? ` (PNGs in ${out})` : ""}`);
