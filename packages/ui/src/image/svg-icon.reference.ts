/**
 * Test-only reference: the original per-sample rasterizer, kept verbatim so
 * svg-icon.smoke.ts can prove the optimized rasterizer is pixel-identical.
 */
import fs from "node:fs";
import type { ImageData } from "./load";

type Attributes = Record<string, string>;

type Paint = {
  fill: boolean;
  stroke: boolean;
  strokeWidth: number;
};

type VectorShape =
  | (Paint & { kind: "rect"; x: number; y: number; width: number; height: number; radius: number })
  | (Paint & { kind: "circle"; x: number; y: number; radius: number })
  | (Paint & { kind: "polyline"; points: Array<{ x: number; y: number }>; closed: boolean });

type SvgArtwork = {
  minX: number;
  minY: number;
  width: number;
  height: number;
  shapes: VectorShape[];
};

const artworkCache = new Map<string, SvgArtwork>();
const bitmapCache = new Map<string, ImageData>();

function attributes(source: string): Attributes {
  const result: Attributes = {};
  const pattern = /([:\w-]+)\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) result[match[1]!] = match[2]!;
  return result;
}

function numberAttr(attrs: Attributes, name: string, fallback = 0): number {
  const value = Number(attrs[name]);
  return Number.isFinite(value) ? value : fallback;
}

function inherited(attrs: Attributes, root: Attributes, name: string, fallback: string): string {
  return attrs[name] ?? root[name] ?? fallback;
}

function paint(attrs: Attributes, root: Attributes): Paint {
  return {
    fill: inherited(attrs, root, "fill", "currentColor") !== "none",
    stroke: inherited(attrs, root, "stroke", "none") !== "none",
    strokeWidth: numberAttr(attrs, "stroke-width", numberAttr(root, "stroke-width", 1.5)),
  };
}

function parsePoints(source: string): Array<{ x: number; y: number }> {
  const values = source
    .trim()
    .split(/[\s,]+/)
    .map(Number)
    .filter(Number.isFinite);
  const points: Array<{ x: number; y: number }> = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    points.push({ x: values[index]!, y: values[index + 1]! });
  }
  return points;
}

function parseSvg(filePath: string): SvgArtwork {
  const cached = artworkCache.get(filePath);
  if (cached) return cached;
  const source = fs.readFileSync(filePath, "utf8");
  // Reject unsupported artwork instead of silently returning a partial/blank icon.
  if (/<(?:path|ellipse|text|image|use|g)\b|\btransform\s*=/i.test(source))
    throw new Error(`SVG icon uses unsupported geometry: ${filePath}`);
  const rootMatch = source.match(/<svg\b([^>]*)>/i);
  if (!rootMatch) throw new Error(`SVG icon has no root: ${filePath}`);
  const root = attributes(rootMatch[1] ?? "");
  const viewBox = (root.viewBox ?? "0 0 24 24").split(/[\s,]+/).map(Number);
  const artwork: SvgArtwork = {
    minX: viewBox[0] ?? 0,
    minY: viewBox[1] ?? 0,
    width: Math.max(1, viewBox[2] ?? numberAttr(root, "width", 24)),
    height: Math.max(1, viewBox[3] ?? numberAttr(root, "height", 24)),
    shapes: [],
  };
  const elementPattern = /<(rect|circle|line|polyline|polygon)\b([^>]*)\/?\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = elementPattern.exec(source))) {
    const kind = match[1]!.toLowerCase();
    const attrs = attributes(match[2] ?? "");
    const style = paint(attrs, root);
    if (kind === "rect") {
      artwork.shapes.push({
        kind: "rect",
        x: numberAttr(attrs, "x"),
        y: numberAttr(attrs, "y"),
        width: numberAttr(attrs, "width"),
        height: numberAttr(attrs, "height"),
        radius: numberAttr(attrs, "rx", numberAttr(attrs, "ry")),
        ...style,
      });
    } else if (kind === "circle") {
      artwork.shapes.push({
        kind: "circle",
        x: numberAttr(attrs, "cx"),
        y: numberAttr(attrs, "cy"),
        radius: numberAttr(attrs, "r"),
        ...style,
      });
    } else if (kind === "line") {
      artwork.shapes.push({
        kind: "polyline",
        points: [
          { x: numberAttr(attrs, "x1"), y: numberAttr(attrs, "y1") },
          { x: numberAttr(attrs, "x2"), y: numberAttr(attrs, "y2") },
        ],
        closed: false,
        ...style,
      });
    } else {
      artwork.shapes.push({
        kind: "polyline",
        points: parsePoints(attrs.points ?? ""),
        closed: kind === "polygon",
        ...style,
      });
    }
  }
  if (artwork.shapes.length === 0)
    throw new Error(`SVG icon has no supported geometry: ${filePath}`);
  artworkCache.set(filePath, artwork);
  return artwork;
}

function insideRoundedRect(
  x: number,
  y: number,
  shape: Extract<VectorShape, { kind: "rect" }>,
  inset = 0,
): boolean {
  const left = shape.x + inset;
  const top = shape.y + inset;
  const right = shape.x + shape.width - inset;
  const bottom = shape.y + shape.height - inset;
  if (x < left || y < top || x > right || y > bottom || right <= left || bottom <= top)
    return false;
  const radius = Math.max(
    0,
    Math.min(shape.radius - inset, (right - left) / 2, (bottom - top) / 2),
  );
  if (radius === 0) return true;
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function insidePolygon(x: number, y: number, points: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function contains(shape: VectorShape, x: number, y: number): boolean {
  if (shape.kind === "rect") {
    const outer = insideRoundedRect(x, y, shape);
    if (shape.fill && outer) return true;
    return shape.stroke && outer && !insideRoundedRect(x, y, shape, shape.strokeWidth);
  }
  if (shape.kind === "circle") {
    const distance = Math.hypot(x - shape.x, y - shape.y);
    if (shape.fill && distance <= shape.radius) return true;
    return shape.stroke && Math.abs(distance - shape.radius) <= shape.strokeWidth / 2;
  }
  if (shape.fill && shape.closed && insidePolygon(x, y, shape.points)) return true;
  if (!shape.stroke || shape.points.length < 2) return false;
  const segmentCount = shape.closed ? shape.points.length : shape.points.length - 1;
  for (let index = 0; index < segmentCount; index++) {
    const a = shape.points[index]!;
    const b = shape.points[(index + 1) % shape.points.length]!;
    if (distanceToSegment(x, y, a.x, a.y, b.x, b.y) <= shape.strokeWidth / 2) return true;
  }
  return false;
}

/** Rasterize Moire's intentionally small symbolic-SVG subset with 4x4 AA. */
export function loadSvgIconSync(filePath: string, size: number, color: number): ImageData {
  const pixelSize = Math.max(1, Math.round(size));
  const key = `${filePath}:${pixelSize}:${color >>> 0}`;
  const cached = bitmapCache.get(key);
  if (cached) return cached;
  const artwork = parseSvg(filePath);
  const rgba = new Uint8Array(pixelSize * pixelSize * 4);
  const samples = 4;
  const totalSamples = samples * samples;
  const baseAlpha = (color >>> 24) & 0xff;
  const red = (color >>> 16) & 0xff;
  const green = (color >>> 8) & 0xff;
  const blue = color & 0xff;
  for (let py = 0; py < pixelSize; py++) {
    for (let px = 0; px < pixelSize; px++) {
      let covered = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = artwork.minX + ((px + (sx + 0.5) / samples) / pixelSize) * artwork.width;
          const y = artwork.minY + ((py + (sy + 0.5) / samples) / pixelSize) * artwork.height;
          if (artwork.shapes.some((shape) => contains(shape, x, y))) covered += 1;
        }
      }
      const offset = (py * pixelSize + px) * 4;
      rgba[offset] = red;
      rgba[offset + 1] = green;
      rgba[offset + 2] = blue;
      rgba[offset + 3] = Math.round((baseAlpha * covered) / totalSamples);
    }
  }
  const result = { rgba, width: pixelSize, height: pixelSize };
  bitmapCache.set(key, result);
  return result;
}

export function clearSvgIconCache(): void {
  artworkCache.clear();
  bitmapCache.clear();
}
