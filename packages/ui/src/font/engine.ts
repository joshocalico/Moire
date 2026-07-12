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
export type FontFamily = "sans" | "mono";

export type TextStyle = {
  family?: FontFamily;
  weight?: FontWeight;
  size?: number;
  color?: number; // ARGB
};

type FaceKey = `${FontFamily}:${FontWeight}`;

type GlyphCacheKey = string; // face|size|codepoint

type GlyphBitmap = {
  width: number;
  height: number;
  bearingX: number;
  bearingY: number;
  advance: number;
  /** Premultiplied-ish coverage alpha in R channel; we store A only as grayscale. */
  alpha: Uint8Array;
};

const DEFAULT_SIZE = 14;

function fontsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../fonts");
}

function faceFile(family: FontFamily, weight: FontWeight): string {
  const dir = fontsDir();
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

  async init(): Promise<void> {
    if (this.ready) return;
    const specs: Array<[FontFamily, FontWeight]> = [
      ["sans", "regular"],
      ["sans", "medium"],
      ["sans", "bold"],
      ["mono", "regular"],
    ];
    try {
      for (const [family, weight] of specs) {
        const file = faceFile(family, weight);
        const buf = fs.readFileSync(file);
        const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        this.faces.set(`${family}:${weight}`, font);
      }
      this.ready = true;
    } catch (err) {
      console.warn("[ui/font] TTF load partial failure:", err);
      const file = faceFile("sans", "regular");
      if (fs.existsSync(file)) {
        const buf = fs.readFileSync(file);
        const font = opentype.parse(
          buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        );
        this.faces.set("sans:regular", font);
        this.ready = true;
      }
    }
  }

  isReady(): boolean {
    return this.ready && this.faces.size > 0;
  }

  private face(style: TextStyle): OtFont | null {
    const family = style.family ?? "sans";
    const weight = style.weight ?? "regular";
    return (
      this.faces.get(`${family}:${weight}`) ??
      this.faces.get(`${family}:regular`) ??
      this.faces.get("sans:regular") ??
      null
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
      width += (g.advanceWidth ?? 0) * scale;
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
    this.fillPathAlpha(path, alpha, width, height, -x0, -y0);

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

  /**
   * Rasterize an opentype Path into an alpha mask using even-odd point-in-path
   * on a coarse grid (good enough for UI sizes).
   */
  private fillPathAlpha(
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
            x:
              u * u * u * cx +
              3 * u * u * t * x1 +
              3 * u * t * t * x2 +
              t * t * t * x,
            y:
              u * u * u * cy +
              3 * u * u * t * y1 +
              3 * u * t * t * y2 +
              t * t * t * y,
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

    const inside = (px: number, py: number): boolean => {
      let winding = 0;
      for (const poly of contours) {
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const yi = poly[i]!.y;
          const yj = poly[j]!.y;
          const xi = poly[i]!.x;
          const xj = poly[j]!.x;
          if (yi > py !== yj > py) {
            const xint = ((xj - xi) * (py - yi)) / (yj - yi + 0.0) + xi;
            if (px < xint) winding++;
          }
        }
      }
      return (winding & 1) === 1;
    };

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        // 4×4 coverage AA — softens the binary bitmap look.
        let cover = 0;
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 4; sx++) {
            const px = x - ox + (sx + 0.5) / 4;
            const py = y - oy + (sy + 0.5) / 4;
            if (inside(px, py)) cover++;
          }
        }
        if (cover > 0) {
          // Gamma-ish coverage → alpha so edges look softer than linear 4×4.
          const t = cover / 16;
          alpha[y * width + x] = Math.min(255, (Math.pow(t, 0.75) * 255) | 0);
        }
      }
    }
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
          const srcA = (a * ca) / 255;
          if (srcA >= 254) {
            fb[row + px] = color;
            continue;
          }
          const dst = fb[row + px]!;
          const inv = 255 - srcA;
          const r = ((cr * srcA + ((dst >>> 16) & 0xff) * inv) / 255) | 0;
          const gch = ((cg * srcA + ((dst >>> 8) & 0xff) * inv) / 255) | 0;
          const b = ((cb * srcA + (dst & 0xff) * inv) / 255) | 0;
          fb[row + px] = (0xff000000 | (r << 16) | (gch << 8) | b) >>> 0;
        }
      }
      penX += g.advance;
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
