/**
 * Image statistics: the pure pixel pass on synthetic pictures (two flat halves give two colours, a
 * gradient spreads the histogram), then a real request through the worker pool and its memory hit.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HISTOGRAM_BINS, imageStats } from "./image-stats";
import { cachedImageStats, requestImageStats, setThumbnailDiskCache } from "./thumbnails";
import type { ImageData } from "./load";

setThumbnailDiskCache(false);
const here = path.dirname(fileURLToPath(import.meta.url));

function picture(width: number, height: number, colour: (x: number, y: number) => number[]) {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) rgba.set([...colour(x, y), 255], (y * width + x) * 4);
  return { rgba, width, height } satisfies ImageData;
}

// Red and blue halves: exactly those two colours, red first when it covers more.
const halves = imageStats(picture(64, 32, (x) => (x < 36 ? [255, 0, 0] : [0, 0, 255])));
assert.deepEqual(halves.colours, [0xffff0000, 0xff0000ff]);
assert.equal(halves.histogram.length, HISTOGRAM_BINS);
assert.equal(Math.max(...halves.histogram), 1);
assert.equal(halves.histogram.filter((value) => value > 0).length, 2);

// A grey ramp fills every luminance bin; its swatches stay at least the distinct distance apart.
const ramp = imageStats(picture(256, 8, (x) => [x, x, x]));
assert.equal(ramp.histogram.length, HISTOGRAM_BINS);
assert.ok(
  ramp.histogram.every((value) => value > 0),
  "every bin has pixels",
);
assert.ok(ramp.colours.length > 1 && ramp.colours.length <= 6);
const channels = (colour: number) => [(colour >>> 16) & 0xff, (colour >>> 8) & 0xff, colour & 0xff];
for (const [index, colour] of ramp.colours.entries())
  for (const other of ramp.colours.slice(index + 1)) {
    const [a, b] = [channels(colour), channels(other)];
    assert.ok(Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!) > 60, "distinct swatches");
  }

// Transparent pixels are ignored; a blank picture has an empty histogram and no colours.
const blank = imageStats({ rgba: new Uint8Array(16 * 16 * 4), width: 16, height: 16 });
assert.deepEqual(blank.colours, []);
assert.ok(blank.histogram.every((value) => value === 0));

// A real photo through the worker pool, then the same stats from memory.
const photo = path.resolve(here, "../../../../apps/bundled/files/src/fixtures/lisbon-tram.jpg");
const stat = fs.statSync(photo);
const request = { file: photo, mtimeMs: stat.mtimeMs, size: stat.size };
assert.equal(cachedImageStats(request), null);
const stats = await requestImageStats(request);
assert.ok(stats, "a photo has stats");
assert.equal(stats.histogram.length, HISTOGRAM_BINS);
assert.equal(Math.max(...stats.histogram), 1);
assert.ok(stats.colours.length >= 1 && stats.colours.length <= 6);
assert.ok(stats.colours.every((colour) => colour >>> 24 === 0xff));
assert.equal(cachedImageStats(request), stats, "the second ask is a memory hit");

// A file without a picture has no stats.
const text = path.resolve(here, "image-stats.ts");
const textStat = fs.statSync(text);
assert.equal(
  await requestImageStats({ file: text, mtimeMs: textStat.mtimeMs, size: textStat.size }),
  null,
);

console.log(
  `image-stats: halves, ramp, blank, photo (${stats.colours.length} colours), cache hit, no-picture ok`,
);
