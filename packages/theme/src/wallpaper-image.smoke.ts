/**
 * Wallpaper pictures: JPEG (with EXIF orientation), GIF and PNG paint the colours of their
 * source, larger pictures are averaged down once per output size and reused, and the loader
 * decodes on a worker thread, reduces big pictures to cover the output, and skips unchanged
 * files. Fixtures are the decoder fixtures in @moire/ui (encodings of `source-64x48.png`).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import {
  createWallpaperImageLoader,
  fittedWallpaperCount,
  getTheme,
  loadImageFile,
  paintWallpaper,
  setWallpaperImagePixels,
  wallpaperImageRevision,
  type MoireTheme,
} from "./index";

const FIXTURES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../ui/src/image/fixtures",
);
const fixture = (name: string) => path.join(FIXTURES, name);
const work = fs.mkdtempSync(path.join(os.tmpdir(), "moire-wallpaper-"));

const source = PNG.sync.read(fs.readFileSync(fixture("source-64x48.png")));
const sourceAt = (x: number, y: number) => {
  const at = (y * source.width + x) * 4;
  return [source.data[at]!, source.data[at + 1]!, source.data[at + 2]!];
};

function themeFor(file: string, fit: "cover" | "contain" | "fill" = "fill"): MoireTheme {
  return { ...getTheme(), wallpaper: { mode: "image", path: file, fit, vignette: 0 } };
}

function paint(file: string, width: number, height: number, fit?: "cover" | "fill") {
  const fb = new Uint32Array(width * height);
  paintWallpaper(fb, width, width, height, themeFor(file, fit));
  return fb;
}

const rgb = (pixel: number) => [(pixel >>> 16) & 255, (pixel >>> 8) & 255, pixel & 255];

/** Mean absolute channel difference between a painted frame and `expected(x, y)`. */
function meanError(
  fb: Uint32Array,
  width: number,
  height: number,
  expected: (x: number, y: number) => number[],
): number {
  let total = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const got = rgb(fb[y * width + x]!);
      const want = expected(x, y);
      for (let c = 0; c < 3; c++) total += Math.abs(got[c]! - want[c]!);
    }
  return total / (width * height * 3);
}

// JPEG, upright: painted 1:1 it reads as its source.
{
  const file = fixture("baseline-444.jpg");
  setWallpaperImagePixels(loadImageFile(file));
  const error = meanError(paint(file, 64, 48), 64, 48, sourceAt);
  assert.ok(error < 4, `JPEG wallpaper differs from its source by ${error.toFixed(2)}`);
  console.log(`[wallpaper] JPEG 64×48 mean error ${error.toFixed(2)}`);
}

// Progressive JPEG.
{
  const file = fixture("progressive.jpg");
  const image = loadImageFile(file);
  assert.deepEqual([image.width, image.height], [64, 48]);
  setWallpaperImagePixels(image);
  const error = meanError(paint(file, 64, 48), 64, 48, sourceAt);
  assert.ok(error < 12, `progressive (4:2:0) JPEG wallpaper differs by ${error.toFixed(2)}`);
}

// EXIF orientation 6 (rotate 90° clockwise): the wallpaper is the upright 48×64 picture.
{
  const jpeg = fs.readFileSync(fixture("baseline-444.jpg"));
  // A big-endian TIFF with one IFD entry: Orientation (0x0112), SHORT, 1, value 6.
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00,
    0x00, 0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);
  const rotated = path.join(work, "rotated.jpg");
  fs.writeFileSync(rotated, Buffer.concat([jpeg.subarray(0, 2), app1, payload, jpeg.subarray(2)]));
  const image = loadImageFile(rotated);
  assert.deepEqual([image.width, image.height], [48, 64], "EXIF 6 swaps width and height");
  setWallpaperImagePixels(image);
  const error = meanError(paint(rotated, 48, 64), 48, 64, (x, y) => sourceAt(y, 47 - x));
  assert.ok(error < 4, `rotated JPEG differs from the turned source by ${error.toFixed(2)}`);
  console.log(`[wallpaper] EXIF-rotated JPEG 48×64 mean error ${error.toFixed(2)}`);
}

// GIF (first frame, 256 colours).
{
  const file = fixture("sips.gif");
  setWallpaperImagePixels(loadImageFile(file));
  const error = meanError(paint(file, 64, 48), 64, 48, sourceAt);
  assert.ok(error < 8, `GIF wallpaper differs from its source by ${error.toFixed(2)}`);
  console.log(`[wallpaper] GIF 64×48 mean error ${error.toFixed(2)}`);
}

// PNG still works, and a non-picture is refused with a sentence.
{
  const file = fixture("source-64x48.png");
  setWallpaperImagePixels(loadImageFile(file));
  assert.equal(meanError(paint(file, 64, 48), 64, 48, sourceAt), 0, "PNG wallpaper paints exactly");
  const text = path.join(work, "notes.txt");
  fs.writeFileSync(text, "not a picture, just text");
  assert.throws(() => loadImageFile(text), /not a PNG, JPEG or GIF/);
}

// A larger picture is averaged down once per output size, and reused.
{
  const file = fixture("source-64x48.png");
  setWallpaperImagePixels(loadImageFile(file));
  const revision = wallpaperImageRevision();
  const half = paint(file, 32, 24);
  assert.equal(fittedWallpaperCount(), 1);
  const average = (x: number, y: number) =>
    [0, 1, 2].map((c) =>
      Math.round(
        [sourceAt(2 * x, 2 * y), sourceAt(2 * x + 1, 2 * y), sourceAt(2 * x, 2 * y + 1)]
          .concat([sourceAt(2 * x + 1, 2 * y + 1)])
          .reduce((sum, pixel) => sum + pixel[c]!, 0) / 4,
      ),
    );
  const error = meanError(half, 32, 24, average);
  assert.ok(error < 1, `the half-size wallpaper is the 2×2 average (error ${error.toFixed(2)})`);
  assert.deepEqual(paint(file, 32, 24), half, "the same output size paints the same pixels");
  assert.equal(fittedWallpaperCount(), 1, "a second paint at that size reuses the fitted copy");
  paint(file, 16, 12);
  assert.equal(fittedWallpaperCount(), 2, "another output size gets its own copy");
  paint(file, 32, 24, "cover");
  assert.equal(fittedWallpaperCount(), 3);
  assert.equal(wallpaperImageRevision(), revision, "painting doesn't change the picture");
  setWallpaperImagePixels(null);
  assert.equal(fittedWallpaperCount(), 0, "a new picture drops the fitted copies");
  assert.ok(wallpaperImageRevision() > revision, "a new picture changes the revision");
}

// The loader: decodes on a worker, reduces a big picture to cover the output, skips repeats.
{
  const big = new PNG({ width: 4000, height: 2250 });
  for (let y = 0; y < big.height; y++)
    for (let x = 0; x < big.width; x++) {
      const at = (y * big.width + x) * 4;
      big.data[at] = (x * 255) / big.width;
      big.data[at + 1] = (y * 255) / big.height;
      big.data[at + 2] = 90;
      big.data[at + 3] = 255;
    }
  const file = path.join(work, "big.png");
  fs.writeFileSync(file, PNG.sync.write(big));
  const images: ({ width: number; height: number } | null)[] = [];
  const loader = createWallpaperImageLoader((image) =>
    images.push(image && { width: image.width, height: image.height }),
  );
  loader.setTheme(themeFor(file));
  await loader.idle();
  assert.equal(images.length, 0, "nothing decodes until an output asks for a size");
  const started = performance.now();
  loader.ensureSize(1280, 720);
  await loader.idle();
  assert.deepEqual([...images], [{ width: 1920, height: 1080 }], "reduced to cover 1920×1080");
  console.log(
    `[wallpaper] 4000×2250 PNG decoded off-thread in ${(performance.now() - started).toFixed(0)} ms`,
  );
  loader.setTheme(themeFor(file));
  loader.ensureSize(1280, 720);
  await loader.idle();
  assert.equal(images.length, 1, "an unchanged file isn't decoded again");
  loader.ensureSize(2560, 1440);
  await loader.idle();
  assert.deepEqual(images.at(-1), { width: 2560, height: 1440 }, "a larger output decodes again");
  loader.setTheme({ ...getTheme(), wallpaper: { mode: "solid", color: "#123456" } });
  assert.equal(images.at(-1), null, "leaving picture mode clears the picture");
  const errors: unknown[] = [];
  const failing = createWallpaperImageLoader(
    (image) => images.push(image && { width: image.width, height: image.height }),
    {
      onError: (error) => errors.push(error),
    },
  );
  failing.setTheme(themeFor(path.join(work, "missing.jpg")));
  failing.ensureSize(800, 600);
  await failing.idle();
  assert.equal(images.at(-1), null, "a missing picture falls back to the gradient");
  assert.equal(errors.length, 1, "and its failure is reported");
  loader.dispose();
  failing.dispose();
}

fs.rmSync(work, { recursive: true, force: true });
console.log("[wallpaper] smoke ok");
