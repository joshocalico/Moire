/**
 * TTF font engine — opentype.js + per-glyph RGBA cache.
 * OS-agnostic; no Wayland/Linux imports.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";
import type { Font as OtFont, Path as OtPath } from "opentype.js";

export type FontWeight = "regular" | "medium" | "bold";
/** `display` is the brand face (the Newsreader wordmark cut); it falls back to `serif`. */
export type FontFamily = "sans" | "mono" | "serif" | "display";

export type TextStyle = {
  family?: FontFamily;
  weight?: FontWeight;
  size?: number;
  color?: number; // ARGB
  /** Extra advance after each glyph, in pixels. */
  letterSpacing?: number;
};

type FaceKey = `${FontFamily}:${FontWeight}`;

type GlyphCacheKey = string; // face|size|codepoint

type GlyphBitmap = {
  width: number;
  height: number;
  bearingX: number;
  bearingY: number;
  advance: number;
  /** Shape coverage. Color and premultiplication are applied when drawing. */
  alpha: Uint8Array;
};

const DEFAULT_SIZE = 14;

function fontsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../fonts");
}

/** Absolute path of a bundled font file (brand faces such as the Newsreader wordmark cut). */
export function uiFontPath(filename: string): string {
  return path.join(fontsDir(), filename);
}

function faceFile(family: FontFamily, weight: FontWeight): string {
  const dir = fontsDir();
  if (family === "serif") return path.join(dir, "DejaVuSerif.ttf");
  if (family === "display") return path.join(dir, "Newsreader-Display330.ttf");
  if (family === "mono") {
    return path.join(dir, "IBMPlexMono-Regular.ttf");
  }
  if (weight === "bold") return path.join(dir, "IBMPlexSans-Bold.ttf");
  if (weight === "medium") return path.join(dir, "IBMPlexSans-Medium.ttf");
  return path.join(dir, "IBMPlexSans-Regular.ttf");
}

export class FontEngine {
  private faces = new Map<FaceKey, OtFont>();
  private glyphs = new Map<GlyphCacheKey, GlyphBitmap>();
  private ready = false;

  /** Faces that failed to load (missing file or parse error); never retried. */
  private missing = new Set<FaceKey>();

  /**
   * Load the fallback face now; every other face is parsed on first use, so a process that
   * draws one family (the boot scene's wordmark) never pays for the rest.
   */
  async init(): Promise<void> {
    if (this.ready) return;
    this.ready = this.load("sans", "regular") !== null;
  }

  isReady(): boolean {
    return this.ready && this.faces.size > 0;
  }

  private load(family: FontFamily, weight: FontWeight): OtFont | null {
    const key: FaceKey = `${family}:${weight}`;
    const cached = this.faces.get(key);
    if (cached || this.missing.has(key)) return cached ?? null;
    const file = faceFile(family, weight);
    try {
      const buf = fs.readFileSync(file);
      const font = opentype.parse(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      );
      this.faces.set(key, font);
      return font;
    } catch (err) {
      this.missing.add(key);
      // The display face is optional (it falls back to serif); the others ship with the UI.
      if (family !== "display") console.warn(`[ui/font] could not load ${key}:`, err);
      return null;
    }
  }

  private face(style: TextStyle): OtFont | null {
    if (!this.ready) return null;
    const family = style.family ?? "sans";
    const weight = style.weight ?? "regular";
    // Only these weights are bundled; others resolve to the family's regular face.
    const bundled = family === "sans" || weight === "regular" ? weight : "regular";
    return (
      this.load(family, bundled) ??
      this.load(family, "regular") ??
      (family === "display" ? this.load("serif", "regular") : null) ??
      this.load("sans", "regular")
    );
  }

  /** Whether the selected bundled face contains every visible code point. */
  supportsText(text: string, style: TextStyle = {}): boolean {
    const font = this.face(style);
    if (!font) return false;
    return [...text].every(
      (character) => /\s/u.test(character) || font.charToGlyphIndex(character) > 0,
    );
  }

  measure(text: string, style: TextStyle = {}): { width: number; height: number } {
    const font = this.face(style);
    const size = style.size ?? DEFAULT_SIZE;
    if (!font) {
      return { width: text.length * Math.ceil(size * 0.6), height: size };
    }
    const scale = (1 / font.unitsPerEm) * size;
    let width = 0;
    for (const ch of text) {
      const g = font.charToGlyph(ch);
      width += (g.advanceWidth ?? 0) * scale + (style.letterSpacing ?? 0);
    }
    const asc = (font.ascender ?? 0) * scale;
    const desc = Math.abs((font.descender ?? 0) * scale);
    return { width: Math.ceil(width), height: Math.ceil(asc + desc) };
  }

  private rasterGlyph(
    font: OtFont,
    faceKey: FaceKey,
    size: number,
    codepoint: number,
  ): GlyphBitmap {
    const key = `${faceKey}|${size}|${codepoint}`;
    const hit = this.glyphs.get(key);
    if (hit) return hit;

    const glyph = font.charToGlyph(String.fromCodePoint(codepoint));
    const scale = (1 / font.unitsPerEm) * size;
    const advance = (glyph.advanceWidth ?? 0) * scale;

    // Empty / space
    const path = glyph.getPath(0, 0, size);
    const box = path.getBoundingBox();
    const pad = 1;
    const x0 = Math.floor(box.x1) - pad;
    const y0 = Math.floor(box.y1) - pad;
    const x1 = Math.ceil(box.x2) + pad;
    const y1 = Math.ceil(box.y2) + pad;
    const width = Math.max(1, x1 - x0);
    const height = Math.max(1, y1 - y0);
    const alpha = new Uint8Array(width * height);

    // Simple coverage: draw path commands via opentype's getBoundingBox +
    // canvas-less scan using path.toPathData is heavy; use draw into temp via
    // getPath and sample with fill approximation from commands.
    // opentype Path has .commands — use getPath and drawFilled-ish by
    // leveraging getBoundingBox + stroke points... Better: use font.getPath and
    // draw with a crude polygon fill from commands.
    rasterizePathAlpha(path, alpha, width, height, -x0, -y0);

    const bmp: GlyphBitmap = {
      width,
      height,
      bearingX: x0,
      bearingY: -y0, // distance from baseline up to top of bitmap
      advance,
      alpha,
    };
    this.glyphs.set(key, bmp);
    return bmp;
  }

  draw(
    fb: Uint32Array,
    pitchPx: number,
    fbW: number,
    fbH: number,
    x: number,
    y: number,
    text: string,
    style: TextStyle = {},
  ): void {
    const font = this.face(style);
    const size = style.size ?? DEFAULT_SIZE;
    const color = (style.color ?? 0xffffffff) >>> 0;
    if (!font) return;

    const family = style.family ?? "sans";
    const weight = style.weight ?? "regular";
    const faceKey = `${family}:${weight}` as FaceKey;
    const scale = (1 / font.unitsPerEm) * size;
    const baseline = y + Math.round((font.ascender ?? 0) * scale);

    const cr = (color >>> 16) & 0xff;
    const cg = (color >>> 8) & 0xff;
    const cb = color & 0xff;
    const ca = (color >>> 24) & 0xff;

    let penX = x;
    for (const ch of text) {
      const cp = ch.codePointAt(0) ?? 63;
      const g = this.rasterGlyph(font, faceKey, size, cp);
      const destX = Math.round(penX + g.bearingX);
      const destY = Math.round(baseline - g.bearingY);
      for (let gy = 0; gy < g.height; gy++) {
        const py = destY + gy;
        if (py < 0 || py >= fbH) continue;
        const row = py * pitchPx;
        for (let gx = 0; gx < g.width; gx++) {
          const px = destX + gx;
          if (px < 0 || px >= fbW) continue;
          const a = g.alpha[gy * g.width + gx]!;
          if (a === 0) continue;
          const srcA = Math.round((a * ca) / 255);
          if (srcA === 255) {
            fb[row + px] = (0xff000000 | (cr << 16) | (cg << 8) | cb) >>> 0;
            continue;
          }
          const dst = fb[row + px]!;
          const inv = 255 - srcA;
          const dstA = (dst >>> 24) & 0xff;
          // Framebuffer pixels are premultiplied ARGB. Keeping glyph-edge
          // alpha here is essential when TextBlock paints into a transparent
          // clip layer; forcing those pixels opaque turns white AA coverage
          // into a gray fringe when the layer is later composited over a fill.
          const outA = srcA + Math.round((dstA * inv) / 255);
          const outR =
            Math.round((cr * srcA) / 255) + Math.round((((dst >>> 16) & 0xff) * inv) / 255);
          const outG =
            Math.round((cg * srcA) / 255) + Math.round((((dst >>> 8) & 0xff) * inv) / 255);
          const outB = Math.round((cb * srcA) / 255) + Math.round(((dst & 0xff) * inv) / 255);
          fb[row + px] = ((outA << 24) | (outR << 16) | (outG << 8) | outB) >>> 0;
        }
      }
      penX += g.advance + (style.letterSpacing ?? 0);
    }
  }
}

/**
 * Rasterize an opentype Path into an alpha mask with the nonzero winding rule.
 */
export function rasterizePathAlpha(
  path: OtPath,
  alpha: Uint8Array,
  width: number,
  height: number,
  ox: number,
  oy: number,
): void {
  // Flatten to polylines
  type Pt = { x: number; y: number };
  const contours: Pt[][] = [];
  let cur: Pt[] = [];
  let cx = 0;
  let cy = 0;
  const cmds = path.commands as Array<{
    type: string;
    x?: number;
    y?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
  }>;
  for (const c of cmds) {
    if (c.type === "M") {
      if (cur.length) contours.push(cur);
      cur = [];
      cx = c.x ?? 0;
      cy = c.y ?? 0;
      cur.push({ x: cx, y: cy });
    } else if (c.type === "L") {
      cx = c.x ?? cx;
      cy = c.y ?? cy;
      cur.push({ x: cx, y: cy });
    } else if (c.type === "Q") {
      // Approximate quadratic with 4 segments
      const x1 = c.x1 ?? cx;
      const y1 = c.y1 ?? cy;
      const x = c.x ?? cx;
      const y = c.y ?? cy;
      for (let i = 1; i <= 8; i++) {
        const t = i / 8;
        const u = 1 - t;
        cur.push({
          x: u * u * cx + 2 * u * t * x1 + t * t * x,
          y: u * u * cy + 2 * u * t * y1 + t * t * y,
        });
      }
      cx = x;
      cy = y;
    } else if (c.type === "C") {
      const x1 = c.x1 ?? cx;
      const y1 = c.y1 ?? cy;
      const x2 = c.x2 ?? cx;
      const y2 = c.y2 ?? cy;
      const x = c.x ?? cx;
      const y = c.y ?? cy;
      for (let i = 1; i <= 10; i++) {
        const t = i / 10;
        const u = 1 - t;
        cur.push({
          x: u * u * u * cx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x,
          y: u * u * u * cy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y,
        });
      }
      cx = x;
      cy = y;
    } else if (c.type === "Z") {
      if (cur.length) {
        contours.push(cur);
        cur = [];
      }
    }
  }
  if (cur.length) contours.push(cur);

  // Nonzero scanline fill (TrueType's rule; overlapping contours from instanced variable
  // fonts must not cancel). Each of ROWS sub-rows per pixel adds exact horizontal span
  // coverage, so cost scales with edges per row rather than samples × edges.
  const ROWS = 8;
  type Edge = { x0: number; y0: number; x1: number; y1: number; dir: number };
  const edges: Edge[] = [];
  for (const poly of contours) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j]!;
      const b = poly[i]!;
      if (a.y === b.y) continue;
      edges.push(
        a.y < b.y
          ? { x0: a.x + ox, y0: a.y + oy, x1: b.x + ox, y1: b.y + oy, dir: 1 }
          : { x0: b.x + ox, y0: b.y + oy, x1: a.x + ox, y1: a.y + oy, dir: -1 },
      );
    }
  }
  const coverage = new Float32Array(width * height);
  const crossings: Array<{ x: number; dir: number }> = [];
  const addSpan = (row: number, from: number, to: number) => {
    const left = Math.max(0, from);
    const right = Math.min(width, to);
    if (right <= left) return;
    const first = Math.floor(left);
    const last = Math.min(width - 1, Math.ceil(right) - 1);
    for (let x = first; x <= last; x++) {
      coverage[row + x]! += (Math.min(right, x + 1) - Math.max(left, x)) / ROWS;
    }
  };
  for (let y = 0; y < height; y++) {
    for (let sub = 0; sub < ROWS; sub++) {
      const py = y + (sub + 0.5) / ROWS;
      crossings.length = 0;
      for (const e of edges) {
        if (py < e.y0 || py >= e.y1) continue;
        crossings.push({ x: e.x0 + ((py - e.y0) * (e.x1 - e.x0)) / (e.y1 - e.y0), dir: e.dir });
      }
      if (crossings.length < 2) continue;
      crossings.sort((a, b) => a.x - b.x);
      let winding = 0;
      for (let k = 0; k < crossings.length - 1; k++) {
        winding += crossings[k]!.dir;
        if (winding !== 0) addSpan(y * width, crossings[k]!.x, crossings[k + 1]!.x);
      }
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Nearly covered pixels render solid, as point sampling did: keeps small text crisp.
      const raw = coverage[y * width + x]!;
      const t = raw >= 0.9 ? 1 : raw;
      if (t > 1e-3) {
        // Gamma-ish coverage → alpha so edges look softer than linear coverage.
        alpha[y * width + x] = Math.min(255, (Math.pow(t, 0.75) * 255) | 0);
      }
    }
  }
}

let shared: FontEngine | null = null;

export async function getFontEngine(): Promise<FontEngine> {
  if (!shared) {
    shared = new FontEngine();
    await shared.init();
  }
  return shared;
}

export function getFontEngineSync(): FontEngine | null {
  return shared;
}
