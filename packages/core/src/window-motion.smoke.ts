/**
 * Window open, close, minimize and restore motion, frame by frame.
 *
 * A small CPU compositor draws the layers WindowMotion produces (uniform scale, translation and
 * opacity, which is all window motion uses), so the motion is checked as pixels, not only as
 * numbers. With MOIRE_MOTION_STRIP_DIR set, each motion is also written as a timecoded PNG strip.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import type { CompositionLayer, CompositionRect, PixelSurface } from "./composition";
import {
  WINDOW_CLOSE_MS,
  WINDOW_MINIMIZE_MS,
  WINDOW_OPEN_MS,
  WindowMotion,
  type WindowMotionHost,
} from "./window-motion";

const W = 480;
const H = 300;
const GROUND = [0x18, 0x14, 0x12];
const WINDOW: CompositionRect = { x: 120, y: 50, width: 240, height: 160 };
const ANCHOR: CompositionRect = { x: 40, y: 262, width: 90, height: 28 };

function solid(width: number, height: number, bgr: [number, number, number]) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set([...bgr, 255], i);
  let destroyed = 0;
  const surface = {
    pixels,
    width,
    height,
    stride: width * 4,
    revision: 1,
    destroy() {
      destroyed++;
    },
    get destroyed() {
      return destroyed;
    },
  };
  return surface;
}

/** The window as the compositor presents it: a titlebar strip over its content. */
function windowLayers(content: PixelSurface, titlebar: PixelSurface): CompositionLayer[] {
  return [
    {
      id: "content",
      z: 0,
      source: content,
      destination: { ...WINDOW, y: WINDOW.y + 24, height: WINDOW.height - 24 },
    },
    { id: "ssd", z: 1, source: titlebar, destination: { ...WINDOW, height: 24 } },
  ];
}

/** Draw layers in z order, honouring opacity and a uniform scale/translate transform. */
function compose(layers: readonly CompositionLayer[]): Uint8Array {
  const out = new Uint8Array(W * H * 4);
  for (let i = 0; i < out.length; i += 4) out.set([...GROUND, 255], i);
  for (const layer of [...layers].sort((a, b) => a.z - b.z)) {
    const d = layer.destination;
    const m = layer.transform?.matrix;
    const s = m ? m[0] : 1;
    const tx = m ? m[12] : 0;
    const ty = m ? m[13] : 0;
    const ox = layer.transform?.origin?.[0] ?? d.width / 2;
    const oy = layer.transform?.origin?.[1] ?? d.height / 2;
    const alpha = layer.opacity ?? 1;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        // Invert: scene = d + o + s·(local − o) + t.
        const lx = (x + 0.5 - d.x - ox - tx) / s + ox;
        const ly = (y + 0.5 - d.y - oy - ty) / s + oy;
        if (lx < 0 || ly < 0 || lx >= d.width || ly >= d.height) continue;
        const sx = Math.floor((lx / d.width) * layer.source.width);
        const sy = Math.floor((ly / d.height) * layer.source.height);
        const si = sy * layer.source.stride + sx * 4;
        const o = (y * W + x) * 4;
        for (let c = 0; c < 3; c++)
          out[o + c] = Math.round(out[o + c]! * (1 - alpha) + layer.source.pixels[si + c]! * alpha);
      }
  }
  return out;
}

/** Bounding box and mean coverage of pixels that differ from the ground. */
function footprint(pixels: Uint8Array) {
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1,
    lit = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const delta = Math.abs(pixels[o]! - GROUND[0]!) + Math.abs(pixels[o + 2]! - GROUND[2]!);
      if (delta < 24) continue;
      lit++;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return x1 < 0
    ? null
    : {
        x: x0,
        y: y0,
        width: x1 - x0 + 1,
        height: y1 - y0 + 1,
        cx: (x0 + x1) / 2,
        cy: (y0 + y1) / 2,
        lit,
      };
}

type Run = {
  host: WindowMotionHost;
  motion: WindowMotion;
  frame(now: number, shown: boolean): Uint8Array;
};

function run(options: { fate?: "minimized" | "closed"; enabled?: boolean } = {}): Run & {
  content: ReturnType<typeof solid>;
} {
  const content = solid(240, 136, [0xe0, 0xc8, 0xb0]);
  const titlebar = solid(240, 24, [0x60, 0x40, 0x30]);
  const host: WindowMotionHost = {
    enabled: () => options.enabled !== false,
    fate: () => options.fate ?? "closed",
    taskAnchor: () => ANCHOR,
  };
  const motion = new WindowMotion(host);
  return {
    host,
    motion,
    content,
    frame(now, shown) {
      const layers: CompositionLayer[] = [];
      motion.beginFrame();
      if (shown) {
        layers.push(...windowLayers(content, titlebar));
        motion.present("1:10", layers, 0, now);
      }
      motion.endFrame(layers, 10, now);
      return compose(layers);
    },
  };
}

const strips = process.env.MOIRE_MOTION_STRIP_DIR;
function strip(name: string, frames: Array<[number, Uint8Array]>) {
  if (!strips) return;
  fs.mkdirSync(strips, { recursive: true });
  const gap = 12;
  const png = new PNG({ width: frames.length * (W + gap) + gap, height: H + gap * 2 });
  png.data.fill(0x10);
  frames.forEach(([, pixels], index) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const s = (y * W + x) * 4;
        const o = ((y + gap) * png.width + gap + index * (W + gap) + x) * 4;
        png.data.set([pixels[s + 2]!, pixels[s + 1]!, pixels[s]!, 255], o);
      }
  });
  fs.writeFileSync(path.join(strips, `${name}.png`), PNG.sync.write(png));
  console.log(`${name}: ${frames.map(([t]) => `${t}ms`).join(" · ")}`);
}

// Open: fades in and rises into place.
{
  const r = run();
  const at = [0, 45, 90, 135, WINDOW_OPEN_MS];
  const frames = at.map((t) => [t, r.frame(1000 + t, true)] as [number, Uint8Array]);
  const first = footprint(frames[1]![1])!;
  const settled = footprint(frames.at(-1)![1])!;
  assert.equal(footprint(frames[0]![1]), null, "a window opens from fully transparent");
  assert.ok(first.y > settled.y, "an opening window rises into place");
  assert.deepEqual(
    [settled.x, settled.y, settled.width, settled.height],
    [WINDOW.x, WINDOW.y, WINDOW.width, WINDOW.height],
    "an opened window lands exactly where the client put it",
  );
  assert.equal(r.motion.active, false, "nothing moves once the window has settled");
  strip("window-open", frames);
}

// Close: fades back and away from its last frame, then releases the client's pixels.
{
  const r = run({ fate: "closed" });
  r.frame(0, true);
  r.frame(WINDOW_OPEN_MS, true);
  const frames: Array<[number, Uint8Array]> = [[0, r.frame(1000, true)]];
  // The client destroys its surface: the compositor would retire this content now.
  assert.ok(r.motion.retains(r.content), "the last presented frame is kept for the exit");
  r.motion.defer(r.content);
  for (const t of [1, 40, 80, 120]) frames.push([t, r.frame(1000 + t, false)]);
  const leaving = footprint(frames[2]![1])!;
  assert.ok(leaving.width < WINDOW.width, "a closing window settles back");
  assert.ok(leaving.cy > WINDOW.y + WINDOW.height / 2, "and drops slightly as it goes");
  assert.equal(r.content.destroyed, 0, "its pixels survive while the exit draws them");
  frames.push([WINDOW_CLOSE_MS + 1, r.frame(1001 + WINDOW_CLOSE_MS, false)]);
  assert.equal(footprint(frames.at(-1)![1]), null, "a closed window is gone when its exit ends");
  assert.equal(r.content.destroyed, 1, "and its pixels are released exactly once");
  strip("window-close", frames);
}

// Minimize: travels into its taskbar button; restore: grows back out of it.
{
  const r = run({ fate: "minimized" });
  r.frame(0, true);
  r.frame(WINDOW_OPEN_MS, true);
  const frames: Array<[number, Uint8Array]> = [[0, r.frame(1000, true)]];
  for (const t of [1, 60, 120, 180]) frames.push([t, r.frame(1000 + t, false)]);
  const mid = footprint(frames[2]![1])!;
  const late = footprint(frames[4]![1])!;
  const anchorCx = ANCHOR.x + ANCHOR.width / 2;
  const anchorCy = ANCHOR.y + ANCHOR.height / 2;
  assert.ok(late.width < mid.width && mid.width < WINDOW.width, "it shrinks as it goes");
  assert.ok(
    Math.hypot(late.cx - anchorCx, late.cy - anchorCy) <
      Math.hypot(mid.cx - anchorCx, mid.cy - anchorCy),
    "towards its taskbar button",
  );
  assert.ok(late.width <= ANCHOR.width + 12, "arriving about the size of the button");
  frames.push([WINDOW_MINIMIZE_MS + 1, r.frame(1001 + WINDOW_MINIMIZE_MS, false)]);
  assert.equal(footprint(frames.at(-1)![1]), null, "a minimized window is gone once it lands");
  strip("window-minimize", frames);

  const restore: Array<[number, Uint8Array]> = [];
  for (const t of [0, 60, 120, 180, WINDOW_MINIMIZE_MS]) restore.push([t, r.frame(2000 + t, true)]);
  const growing = footprint(restore[1]![1])!;
  const settled = footprint(restore.at(-1)![1])!;
  assert.ok(growing.width < settled.width, "a restore grows out of the button");
  assert.ok(growing.cy > settled.cy, "rising from the taskbar");
  assert.deepEqual(
    [settled.x, settled.y, settled.width, settled.height],
    [WINDOW.x, WINDOW.y, WINDOW.width, WINDOW.height],
    "and lands exactly where it was",
  );
  strip("window-restore", restore);
}

// Reduced motion and stages without a desktop: windows appear and vanish at once.
{
  const r = run({ enabled: false });
  const shown = footprint(r.frame(0, true))!;
  assert.deepEqual([shown.x, shown.y, shown.width], [WINDOW.x, WINDOW.y, WINDOW.width]);
  r.motion.defer(r.content);
  assert.equal(footprint(r.frame(16, false)), null, "no exit is drawn");
  assert.equal(r.content.destroyed, 1, "and pixels are released on the next frame");
  assert.equal(r.motion.active, false);
}

console.log("[core/window-motion] open, close, minimize, restore and reduced motion passed");
