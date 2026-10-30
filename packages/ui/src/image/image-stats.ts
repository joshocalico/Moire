/**
 * A picture's luminance histogram and dominant colours, from one pass over a small (thumbnail
 * sized) copy of it. The Files inspector draws them beside a photo.
 */
import type { ImageData } from "./load";

export type ImageStats = {
  /** Luminance bins, darkest first, normalised so the fullest is 1. */
  histogram: number[];
  /** Up to six dominant colours, `0xffRRGGBB`, most common first and mutually distinct. */
  colours: number[];
};

export const HISTOGRAM_BINS = 48;
const MAX_COLOURS = 6;
/** Colours closer than this (Euclidean, in RGB) count as the same swatch. */
const DISTINCT_DISTANCE = 60;
/** Pixels this transparent say nothing about the picture's colours. */
const MIN_ALPHA = 128;

type Bucket = { count: number; r: number; g: number; b: number };

export function imageStats(image: ImageData): ImageStats {
  const { rgba } = image;
  // Colours are tallied in 3-bit-per-channel buckets; a bucket's swatch is its pixels' mean.
  const buckets = new Map<number, Bucket>();
  const histogram = Array.from({ length: HISTOGRAM_BINS }, () => 0);
  for (let at = 0; at + 3 < rgba.length; at += 4) {
    if (rgba[at + 3]! < MIN_ALPHA) continue;
    const r = rgba[at]!;
    const g = rgba[at + 1]!;
    const b = rgba[at + 2]!;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, (bucket = { count: 0, r: 0, g: 0, b: 0 }));
    bucket.count++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    histogram[Math.min(HISTOGRAM_BINS - 1, Math.floor((luminance / 256) * HISTOGRAM_BINS))]!++;
  }
  const picked: Array<[number, number, number]> = [];
  for (const bucket of [...buckets.values()].sort((a, b) => b.count - a.count)) {
    if (picked.length >= MAX_COLOURS) break;
    const colour: [number, number, number] = [
      bucket.r / bucket.count,
      bucket.g / bucket.count,
      bucket.b / bucket.count,
    ];
    const distinct = picked.every(
      (other) =>
        Math.hypot(colour[0] - other[0], colour[1] - other[1], colour[2] - other[2]) >
        DISTINCT_DISTANCE,
    );
    if (distinct) picked.push(colour);
  }
  const max = Math.max(...histogram);
  return {
    histogram: histogram.map((value) => (max ? value / max : 0)),
    colours: picked.map(
      ([r, g, b]) =>
        (0xff000000 | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)) >>> 0,
    ),
  };
}
