/**
 * What the compositor itself draws while locked: the obscured wallpaper every locked output
 * shows, and a minimal password prompt for when the shell's lock UI is missing or has failed.
 *
 * Both are plain pixel code with no shell, font or React dependency, so a broken lock UI can
 * never leave the screen unlocked or unusable: the fallback still shows a padlock, the typed
 * length as dots and the check's state as the field's colour, and keys keep reaching the lock.
 * Nothing here reads client buffers.
 */
import type { LockEntryPhase } from "./session-lock";

export type LockRect = { x: number; y: number; width: number; height: number };

/** How much of the wallpaper survives under the lock (the rest is black, or white when light). */
const BACKDROP_KEEP = 0.5;
/** Downsampled backdrop size: the blur runs on about this many pixels across the short side. */
const BACKDROP_DETAIL = 72;

/**
 * Heavily blurred and darkened copy of `wallpaper` (opaque ARGB, `width` × `height`). Built by
 * box-downsampling, blurring the small image and scaling it back up, so it costs a few
 * milliseconds even for a 4K output; callers cache it per size and theme.
 */
export function lockBackdrop(
  wallpaper: Uint32Array,
  width: number,
  height: number,
  light = false,
): Uint32Array {
  const factor = Math.max(1, Math.round(Math.min(width, height) / BACKDROP_DETAIL));
  const sw = Math.max(1, Math.ceil(width / factor));
  const sh = Math.max(1, Math.ceil(height / factor));
  const channels = [
    new Float32Array(sw * sh),
    new Float32Array(sw * sh),
    new Float32Array(sw * sh),
  ];
  const counts = new Float32Array(sw * sh);
  for (let y = 0; y < height; y++) {
    const row = ((y / factor) | 0) * sw;
    for (let x = 0; x < width; x++) {
      const p = wallpaper[y * width + x]!;
      const index = row + ((x / factor) | 0);
      channels[0]![index]! += (p >>> 16) & 255;
      channels[1]![index]! += (p >>> 8) & 255;
      channels[2]![index]! += p & 255;
      counts[index]!++;
    }
  }
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index++) channel[index]! /= counts[index] || 1;
    // Three box passes each way approximate a wide Gaussian.
    for (let pass = 0; pass < 3; pass++) {
      boxBlur(channel, sw, sh, 2, true);
      boxBlur(channel, sw, sh, 2, false);
    }
  }
  const out = new Uint32Array(width * height);
  for (let y = 0; y < height; y++) {
    const fy = Math.max(0, Math.min(sh - 1, (y + 0.5) / factor - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(sh - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.max(0, Math.min(sw - 1, (x + 0.5) / factor - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(sw - 1, x0 + 1);
      const tx = fx - x0;
      const sample = (channel: Float32Array) => {
        const top = channel[y0 * sw + x0]! * (1 - tx) + channel[y0 * sw + x1]! * tx;
        const bottom = channel[y1 * sw + x0]! * (1 - tx) + channel[y1 * sw + x1]! * tx;
        return top * (1 - ty) + bottom * ty;
      };
      const r = sample(channels[0]!);
      const g = sample(channels[1]!);
      const b = sample(channels[2]!);
      // Pull toward grey, then toward black (or white for a light theme's dark text), so the
      // lock UI reads on any wallpaper.
      const grey = (r + g + b) / 3;
      const mix = (value: number) => {
        const toned = value * 0.7 + grey * 0.3;
        const shaded = light ? 255 - (255 - toned) * BACKDROP_KEEP : toned * BACKDROP_KEEP;
        return Math.max(0, Math.min(255, Math.round(shaded)));
      };
      out[y * width + x] = 0xff000000 | (mix(r) << 16) | (mix(g) << 8) | mix(b);
    }
  }
  return out;
}

function boxBlur(
  channel: Float32Array,
  width: number,
  height: number,
  radius: number,
  horizontal: boolean,
): void {
  const lines = horizontal ? height : width;
  const length = horizontal ? width : height;
  const line = new Float32Array(length);
  const at = (l: number, i: number) => (horizontal ? l * width + i : i * width + l);
  const span = radius * 2 + 1;
  for (let l = 0; l < lines; l++) {
    for (let i = 0; i < length; i++) line[i] = channel[at(l, i)]!;
    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += line[Math.max(0, Math.min(length - 1, i))]!;
    for (let i = 0; i < length; i++) {
      channel[at(l, i)] = sum / span;
      sum += line[Math.min(length - 1, i + radius + 1)]! - line[Math.max(0, i - radius)]!;
    }
  }
}

/** Copy an opaque backdrop into `fb` at `rect` (same size as the backdrop). */
export function blitLockBackdrop(
  fb: Uint32Array,
  pitch: number,
  fbWidth: number,
  fbHeight: number,
  rect: LockRect,
  backdrop: Uint32Array,
): void {
  for (let y = 0; y < rect.height; y++) {
    const ty = rect.y + y;
    if (ty < 0 || ty >= fbHeight) continue;
    const x0 = Math.max(0, rect.x);
    const x1 = Math.min(fbWidth, rect.x + rect.width);
    if (x1 <= x0) continue;
    fb.set(
      backdrop.subarray(y * rect.width + (x0 - rect.x), y * rect.width + (x1 - rect.x)),
      ty * pitch + x0,
    );
  }
}

const FIELD_COLOURS: Record<LockEntryPhase, number> = {
  entry: 0xff7aa2f7,
  checking: 0xffe0af68,
  wrong: 0xfff7768e,
  "rate-limited": 0xffff9e64,
  unavailable: 0xfff7768e,
};
const MAX_DOTS = 24;

/**
 * The compositor's own lock prompt, centred in `rect`: a padlock, then a field with one dot per
 * typed character whose outline shows the state (blue ready, amber checking, red wrong or
 * unavailable, orange rate limited). Deliberately text-free: it must draw with no fonts.
 */
export function paintLockFallback(
  fb: Uint32Array,
  pitch: number,
  fbWidth: number,
  fbHeight: number,
  rect: LockRect,
  entry: { length: number; phase: LockEntryPhase },
): void {
  const s = Math.max(1, Math.min(3, Math.min(rect.width, rect.height) / 700));
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const paint = { fb, pitch, fbWidth, fbHeight };
  const glyph = 0xe6ffffff;
  // Padlock: a shackle ring above a rounded body.
  const bodyW = 56 * s;
  const bodyH = 42 * s;
  const bodyY = cy - 70 * s;
  ring(paint, cx, bodyY - 2 * s, 17 * s, 6 * s, glyph, true);
  roundRect(paint, cx - bodyW / 2, bodyY, bodyW, bodyH, 9 * s, glyph);
  circle(paint, cx, bodyY + bodyH * 0.45, 5 * s, 0xff1a1b26);
  // Field.
  const fieldW = Math.min(rect.width - 40 * s, 300 * s);
  const fieldH = 46 * s;
  const fieldX = cx - fieldW / 2;
  const fieldY = cy + 6 * s;
  const colour = FIELD_COLOURS[entry.phase];
  roundRect(paint, fieldX - 2 * s, fieldY - 2 * s, fieldW + 4 * s, fieldH + 4 * s, 13 * s, colour);
  roundRect(paint, fieldX, fieldY, fieldW, fieldH, 11 * s, 0xf0161720);
  const dots = Math.min(entry.length, MAX_DOTS);
  const gap = Math.min(16 * s, (fieldW - 24 * s) / Math.max(1, dots));
  const first = cx - ((dots - 1) * gap) / 2;
  for (let index = 0; index < dots; index++)
    circle(paint, first + index * gap, fieldY + fieldH / 2, 4.5 * s, 0xffe6e6ef);
  if (dots === 0) roundRect(paint, cx - 1 * s, fieldY + 12 * s, 2 * s, fieldH - 24 * s, s, colour);
}

export type Paint = { fb: Uint32Array; pitch: number; fbWidth: number; fbHeight: number };

/** Fill pixels whose coverage(px, py) is > 0 inside the box, blending `colour` (ARGB). */
export function fill(
  paint: Paint,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colour: number,
  coverage: (px: number, py: number) => number,
): void {
  const alpha = (colour >>> 24) / 255;
  const r = (colour >>> 16) & 255;
  const g = (colour >>> 8) & 255;
  const b = colour & 255;
  const left = Math.max(0, Math.floor(x0));
  const right = Math.min(paint.fbWidth, Math.ceil(x1));
  const top = Math.max(0, Math.floor(y0));
  const bottom = Math.min(paint.fbHeight, Math.ceil(y1));
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++) {
      const a = Math.max(0, Math.min(1, coverage(x + 0.5, y + 0.5))) * alpha;
      if (a <= 0) continue;
      const index = y * paint.pitch + x;
      const p = paint.fb[index]!;
      const blend = (shift: number, value: number) =>
        Math.round(((p >>> shift) & 255) * (1 - a) + value * a) << shift;
      paint.fb[index] = (0xff000000 | blend(16, r) | blend(8, g) | blend(0, b)) >>> 0;
    }
}

export function roundRect(
  paint: Paint,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  colour: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  fill(paint, x, y, x + width, y + height, colour, (px, py) => {
    const dx = Math.max(x + r - px, 0, px - (x + width - r));
    const dy = Math.max(y + r - py, 0, py - (y + height - r));
    return r + 0.5 - Math.hypot(dx, dy);
  });
}

export function circle(paint: Paint, cx: number, cy: number, radius: number, colour: number): void {
  fill(
    paint,
    cx - radius - 1,
    cy - radius - 1,
    cx + radius + 1,
    cy + radius + 1,
    colour,
    (px, py) => radius + 0.5 - Math.hypot(px - cx, py - cy),
  );
}

/** A ring of `thickness`; `upper` keeps only the top half (the shackle). */
function ring(
  paint: Paint,
  cx: number,
  cy: number,
  radius: number,
  thickness: number,
  colour: number,
  upper: boolean,
): void {
  const outer = radius + thickness / 2;
  fill(
    paint,
    cx - outer - 1,
    cy - outer - 1,
    cx + outer + 1,
    upper ? cy + 1 : cy + outer + 1,
    colour,
    (px, py) => {
      if (upper && py > cy) return 0;
      return thickness / 2 + 0.5 - Math.abs(Math.hypot(px - cx, py - cy) - radius);
    },
  );
}
