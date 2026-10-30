/**
 * Render shell surfaces offscreen at exact motion timecodes, for review and visual regression.
 *
 *   pnpm --filter @moire/shell preview [scene…] [--at 0,40,80,150,400] [--theme moire:dark] [--out DIR]
 *   pnpm --filter @moire/shell visreg [scene…]            compare against packages/shell/visreg
 *   pnpm --filter @moire/shell visreg --update [scene…]   accept the current renders as baselines
 *   … --list                                             show the available scenes
 *
 * Time is stepped by hand from the moment a scene mounts, so a frame at a timecode is identical
 * on every run. Each scene writes one PNG per timecode plus `<scene>.strip.png`: the frames side
 * by side, labelled, and cropped to the region that moves.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import React from "react";
import { PNG } from "pngjs";
import {
  Group,
  Image,
  Rect,
  Text,
  collectHits,
  createShellRoot,
  rasterize,
  renderShell,
} from "@moire/react-host";
import { DEFAULT_SETTINGS, themeForSettings } from "@moire/prefs";
import { setTheme, THEME_FAMILIES } from "@moire/theme";
import { installUiFonts, tickAllMotions } from "@moire/ui";
import { PREVIEW_SCENES, type PreviewScene } from "./scenes";
import { setFlatGround } from "./wallpaper";

type Frame = { timeMs: number; pixels: Uint8Array };
type Bounds = { x: number; y: number; width: number; height: number };

const BASELINE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../visreg");
const PREVIEW_TIMES = [0, 40, 80, 120, 200, 400];
/** Mid-entrance and settled: enough to catch both motion and layout regressions. */
const VISREG_TIMES = [60, 1000];

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    at: { type: "string" },
    theme: { type: "string", default: "moire:dark" },
    out: { type: "string" },
    check: { type: "boolean", default: false },
    update: { type: "boolean", default: false },
    tolerance: { type: "string", default: "0" },
    list: { type: "boolean", default: false },
  },
});

if (values.list) {
  for (const scene of PREVIEW_SCENES.values())
    console.log(`${scene.name.padEnd(22)} ${scene.description}`);
  process.exit(0);
}

const visreg = values.check || values.update;
setFlatGround(visreg);
const times = (
  values.at
    ? values.at.split(",").map((value) => Number(value.replace(/ms$/, "")))
    : visreg
      ? VISREG_TIMES
      : PREVIEW_TIMES
).sort((a, b) => a - b);
if (times.some((time) => !Number.isFinite(time) || time < 0))
  fail(`--at takes non-negative milliseconds, e.g. --at 0,40,80`);
const tolerance = Number(values.tolerance);
const scenes = positionals.length
  ? positionals.map((name) => PREVIEW_SCENES.get(name) ?? fail(`Unknown scene "${name}" (--list)`))
  : [...PREVIEW_SCENES.values()];

const [family, scheme = "dark"] = values.theme!.split(":");
if (!THEME_FAMILIES.includes(family as never) || (scheme !== "dark" && scheme !== "light"))
  fail(`--theme takes family:dark|light, families: ${THEME_FAMILIES.join(", ")}`);
const themeKey = `${family}-${scheme}`;
// The shipped theme for these settings, never the user's own preferences.
setTheme(
  themeForSettings({
    ...DEFAULT_SETTINGS,
    themeFamily: family as (typeof THEME_FAMILIES)[number],
    dark: scheme === "dark",
  }),
);
await installUiFonts();

const out = path.resolve(values.out ?? path.join(os.tmpdir(), "moire-preview", themeKey));
fs.mkdirSync(out, { recursive: true });

let failures = 0;
for (const scene of scenes) {
  const frames = await renderFrames(scene, times);
  if (values.update) {
    const dir = path.join(BASELINE_DIR, themeKey);
    fs.mkdirSync(dir, { recursive: true });
    for (const frame of frames)
      writePng(path.join(dir, frameName(scene, frame)), scene.width, scene.height, frame.pixels);
    console.log(`updated ${scene.name} (${frames.length} baselines)`);
  } else if (values.check) {
    failures += checkScene(scene, frames);
  } else {
    for (const frame of frames)
      writePng(path.join(out, frameName(scene, frame)), scene.width, scene.height, frame.pixels);
    const strip = path.join(out, `${scene.name}.strip.png`);
    writeStrip(strip, scene, frames);
    console.log(`${scene.name.padEnd(22)} ${strip}`);
  }
}
if (values.check && !values.update) {
  console.log(
    failures ? `visreg: ${failures} frame(s) differ; see ${out}` : "visreg: all frames match",
  );
  process.exitCode = failures ? 1 : 0;
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function frameName(scene: PreviewScene, frame: Frame): string {
  return `${scene.name}@${String(frame.timeMs).padStart(4, "0")}ms.png`;
}

/** Mount the scene, then step motion to each timecode and capture it. */
async function renderFrames(scene: PreviewScene, timecodes: readonly number[]): Promise<Frame[]> {
  const root = createShellRoot();
  renderShell(root, scene.render());
  // Let mount effects (focus, measured scroll) commit before time starts.
  await new Promise((resolve) => setImmediate(resolve));
  if (scene.then) {
    // Transition scenes start from their settled first state.
    tickAllMotions(10);
    await new Promise((resolve) => setImmediate(resolve));
    renderShell(root, scene.then());
    await new Promise((resolve) => setImmediate(resolve));
  }
  if (scene.hover) {
    tickAllMotions(10);
    await new Promise((resolve) => setImmediate(resolve));
    const hit = collectHits(root.container).find((each) => each.focusId === scene.hover);
    if (!hit) fail(`${scene.name}: no control with focusId ${scene.hover}`);
    const at = { x: hit.x + hit.width / 2, y: hit.y + hit.height / 2 };
    hit.onPointerEnter?.({
      ...at,
      localX: hit.width / 2,
      localY: hit.height / 2,
    });
    // Tooltips wait out their hover delay on a real timer before fading in.
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
  const frames: Frame[] = [];
  let elapsed = 0;
  for (const timeMs of timecodes) {
    if (timeMs > elapsed) tickAllMotions((timeMs - elapsed) / 1000);
    elapsed = timeMs;
    // Animated layout (tweened widths) re-renders React; let that commit land first.
    await new Promise((resolve) => setImmediate(resolve));
    frames.push({
      timeMs,
      pixels: rasterize(root.container, scene.width, scene.height).pixels.slice(),
    });
  }
  renderShell(root, null);
  return frames;
}

function checkScene(scene: PreviewScene, frames: readonly Frame[]): number {
  let failed = 0;
  for (const frame of frames) {
    const name = frameName(scene, frame);
    const baseline = path.join(BASELINE_DIR, themeKey, name);
    if (!fs.existsSync(baseline)) {
      console.log(`MISSING ${name}: run visreg --update ${scene.name}`);
      failed++;
      continue;
    }
    const expected = PNG.sync.read(fs.readFileSync(baseline));
    if (expected.width !== scene.width || expected.height !== scene.height) {
      console.log(`SIZE    ${name}: baseline ${expected.width}×${expected.height}`);
      failed++;
      continue;
    }
    const { count, diff } = compare(frame.pixels, expected.data, scene.width, scene.height);
    if (count === 0) {
      console.log(`ok      ${name}`);
      continue;
    }
    failed++;
    writePng(
      path.join(out, name.replace(".png", ".actual.png")),
      scene.width,
      scene.height,
      frame.pixels,
    );
    writePng(path.join(out, name.replace(".png", ".diff.png")), scene.width, scene.height, diff);
    console.log(`DIFF    ${name}: ${count} pixel(s) differ`);
  }
  return failed;
}

/** Count pixels whose channels differ beyond the tolerance; mark them red over a dimmed frame. */
function compare(actual: Uint8Array, expectedRgba: Uint8Array, width: number, height: number) {
  const diff = new Uint8Array(width * height * 4);
  let count = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    const delta = Math.max(
      Math.abs(actual[o]! - expectedRgba[o + 2]!),
      Math.abs(actual[o + 1]! - expectedRgba[o + 1]!),
      Math.abs(actual[o + 2]! - expectedRgba[o]!),
    );
    const luma = (actual[o]! + actual[o + 1]! + actual[o + 2]!) / 9;
    if (delta > tolerance) {
      count++;
      diff.set([0, 0, 255, 255], o);
    } else diff.set([luma, luma, luma, 255], o);
  }
  return { count, diff };
}

/** The region any frame differs in, padded; the whole frame when nothing moves. */
function motionBounds(frames: readonly Frame[], width: number, height: number): Bounds {
  let minX = width,
    minY = height,
    maxX = -1,
    maxY = -1;
  const settled = frames[frames.length - 1]!.pixels;
  for (const frame of frames.slice(0, -1)) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        if (
          frame.pixels[o] === settled[o] &&
          frame.pixels[o + 1] === settled[o + 1] &&
          frame.pixels[o + 2] === settled[o + 2]
        )
          continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, width, height };
  const pad = 32;
  const x = Math.max(0, minX - pad),
    y = Math.max(0, minY - pad);
  return {
    x,
    y,
    width: Math.min(width, maxX + pad + 1) - x,
    height: Math.min(height, maxY + pad + 1) - y,
  };
}

/** Cut a region out of a BGRA frame as the RGBA an Image node draws. */
function cropToRgba(pixels: Uint8Array, width: number, bounds: Bounds): Uint8Array {
  const cropped = new Uint8Array(bounds.width * bounds.height * 4);
  for (let row = 0; row < bounds.height; row++) {
    for (let col = 0; col < bounds.width; col++) {
      const from = ((bounds.y + row) * width + bounds.x + col) * 4;
      const to = (row * bounds.width + col) * 4;
      cropped[to] = pixels[from + 2]!;
      cropped[to + 1] = pixels[from + 1]!;
      cropped[to + 2] = pixels[from]!;
      cropped[to + 3] = pixels[from + 3]!;
    }
  }
  return cropped;
}

/** Lay the cropped frames out with timecodes, drawn by Moire's own renderer. */
function writeStrip(file: string, scene: PreviewScene, frames: readonly Frame[]): void {
  const bounds = scene.crop ?? motionBounds(frames, scene.width, scene.height);
  // Thin regions (a taskbar, a toggle) are enlarged so their motion stays legible.
  const zoom = Math.max(1, Math.min(3, Math.floor(240 / bounds.height)));
  const shown = { width: bounds.width * zoom, height: bounds.height * zoom };
  const gap = 24,
    label = 28;
  const columns = Math.max(1, Math.min(frames.length, Math.floor(3600 / (shown.width + gap))));
  const rows = Math.ceil(frames.length / columns);
  const width = gap + columns * (shown.width + gap);
  const height = gap + rows * (label + shown.height + gap);
  const root = createShellRoot();
  renderShell(
    root,
    <Group width={width} height={height}>
      <Rect width={width} height={height} fill={0xff101014} />
      {frames.map((frame, index) => {
        const x = gap + (index % columns) * (shown.width + gap);
        const y = gap + Math.floor(index / columns) * (label + shown.height + gap);
        return (
          <Group key={frame.timeMs} x={x} y={y} width={shown.width} height={label + shown.height}>
            <Text
              x={0}
              y={4}
              text={zoom > 1 ? `${frame.timeMs} ms · ${zoom}×` : `${frame.timeMs} ms`}
              color={0xffd8d8e0}
              fontSize={14}
            />
            <Image
              y={label}
              width={shown.width}
              height={shown.height}
              imagePixels={cropToRgba(frame.pixels, scene.width, bounds)}
              imageWidth={bounds.width}
              imageHeight={bounds.height}
            />
            <Rect
              y={label}
              width={shown.width}
              height={shown.height}
              fill={0x00000000}
              stroke={0xff3a3a46}
              strokeWidth={1}
            />
          </Group>
        );
      })}
    </Group>,
  );
  writePng(file, width, height, rasterize(root.container, width, height).pixels);
  renderShell(root, null);
}

function writePng(file: string, width: number, height: number, bgra: Uint8Array): void {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height * 4; i += 4) {
    png.data[i] = bgra[i + 2]!;
    png.data[i + 1] = bgra[i + 1]!;
    png.data[i + 2] = bgra[i]!;
    png.data[i + 3] = 255;
  }
  fs.writeFileSync(file, PNG.sync.write(png));
}
