/**
 * JPEG and GIF decoders against real encoder output. The fixtures were made by this script with
 * `--generate` (cjpeg, jpegtran, sips and ffmpeg from libjpeg-turbo 3 / macOS / ffmpeg 7); the
 * normal run decodes them and compares with djpeg and ffmpeg when those are installed.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { decodeGif, decodeJpeg, gifSize, jpegSize } from "@moire/file-formats/image";
import type { ImageData } from "./load";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

/** Gradients, a disc and stripes: enough structure to catch IDCT, upsampling and colour bugs. */
function sourcePicture(width: number, height: number): ImageData {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      const inDisc = (x - width * 0.6) ** 2 + (y - height * 0.45) ** 2 < (height * 0.3) ** 2;
      const stripe = Math.floor(x / 3) % 2 === 0 && y > height * 0.8;
      rgba[at] = inDisc ? 230 : Math.round((x / width) * 255);
      rgba[at + 1] = inDisc ? 60 : Math.round((y / height) * 255);
      rgba[at + 2] = stripe ? 20 : inDisc ? 40 : 160;
      rgba[at + 3] = 255;
    }
  return { rgba, width, height };
}

function ppm(image: ImageData): Buffer {
  const header = Buffer.from(`P6\n${image.width} ${image.height}\n255\n`);
  const body = Buffer.alloc(image.width * image.height * 3);
  for (let i = 0; i < image.width * image.height; i++) {
    body[i * 3] = image.rgba[i * 4]!;
    body[i * 3 + 1] = image.rgba[i * 4 + 1]!;
    body[i * 3 + 2] = image.rgba[i * 4 + 2]!;
  }
  return Buffer.concat([header, body]);
}

function png(image: ImageData): Buffer {
  const out = new PNG({ width: image.width, height: image.height });
  out.data = Buffer.from(image.rgba);
  return PNG.sync.write(out);
}

const JPEGS: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ["baseline-420.jpg", "64x48", ["-quality", "85", "-sample", "2x2"]],
  ["baseline-444.jpg", "64x48", ["-quality", "90", "-sample", "1x1"]],
  ["baseline-422.jpg", "64x48", ["-quality", "85", "-sample", "2x1"]],
  ["baseline-411.jpg", "64x48", ["-quality", "85", "-sample", "4x1"]],
  ["odd-420.jpg", "37x23", ["-quality", "80", "-sample", "2x2"]],
  ["gray.jpg", "37x23", ["-grayscale"]],
  ["rgb.jpg", "37x23", ["-rgb"]],
  ["restart.jpg", "37x23", ["-sample", "2x2", "-restart", "1B"]],
  ["progressive.jpg", "64x48", ["-progressive", "-sample", "2x2"]],
  ["progressive-odd-restart.jpg", "37x23", ["-progressive", "-restart", "1B"]],
];

function generate(): void {
  fs.mkdirSync(FIXTURES, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "jpeg-fixtures-"));
  for (const [width, height] of [
    [64, 48],
    [37, 23],
  ] as const) {
    const picture = sourcePicture(width, height);
    fs.writeFileSync(path.join(work, `${width}x${height}.ppm`), ppm(picture));
    fs.writeFileSync(path.join(FIXTURES, `source-${width}x${height}.png`), png(picture));
  }
  for (const [name, source, args] of JPEGS)
    execFileSync("cjpeg", [
      ...args,
      "-outfile",
      path.join(FIXTURES, name),
      path.join(work, `${source}.ppm`),
    ]);
  execFileSync("jpegtran", [
    "-progressive",
    "-outfile",
    path.join(FIXTURES, "jpegtran-progressive.jpg"),
    path.join(FIXTURES, "baseline-422.jpg"),
  ]);
  execFileSync("sips", [
    "-s",
    "format",
    "jpeg",
    "-s",
    "formatOptions",
    "80",
    path.join(FIXTURES, "source-64x48.png"),
    "--out",
    path.join(FIXTURES, "sips.jpg"),
  ]);
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-y",
    "-i",
    path.join(FIXTURES, "source-37x23.png"),
    path.join(FIXTURES, "ffmpeg.gif"),
  ]);
  execFileSync("sips", [
    "-s",
    "format",
    "gif",
    path.join(FIXTURES, "source-64x48.png"),
    "--out",
    path.join(FIXTURES, "sips.gif"),
  ]);
  fs.rmSync(work, { recursive: true });
}

const has = (tool: string) => spawnSync("which", [tool]).status === 0;

/** djpeg's decode (no fancy upsampling, to match ours) as RGB or gray samples. */
function djpeg(file: string): { width: number; height: number; channels: number; data: Buffer } {
  const out = execFileSync("djpeg", ["-nosmooth", "-pnm", file]);
  const header = /^(P[56])\s+(\d+)\s+(\d+)\s+255\s/.exec(out.toString("latin1", 0, 40))!;
  return {
    channels: header[1] === "P6" ? 3 : 1,
    width: Number(header[2]),
    height: Number(header[3]),
    data: out.subarray(header[0].length),
  };
}

function compare(
  image: ImageData,
  reference: { width: number; height: number; channels: number; data: Uint8Array },
): { mean: number; max: number } {
  assert.equal(image.width, reference.width);
  assert.equal(image.height, reference.height);
  let total = 0;
  let max = 0;
  let samples = 0;
  for (let i = 0; i < image.width * image.height; i++)
    for (let c = 0; c < 3; c++) {
      const expected = reference.data[i * reference.channels + (reference.channels === 3 ? c : 0)]!;
      const error = Math.abs(image.rgba[i * 4 + c]! - expected);
      total += error;
      max = Math.max(max, error);
      samples++;
    }
  return { mean: total / samples, max };
}

/** Average over 8×8 cells, for checking the DC-only decode. */
function boxDown(
  reference: { width: number; height: number; channels: number; data: Uint8Array },
  factor: number,
) {
  const width = Math.ceil(reference.width / factor);
  const height = Math.ceil(reference.height / factor);
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let count = 0;
        for (let yy = y * factor; yy < Math.min(reference.height, (y + 1) * factor); yy++)
          for (let xx = x * factor; xx < Math.min(reference.width, (x + 1) * factor); xx++) {
            sum +=
              reference.data[
                (yy * reference.width + xx) * reference.channels +
                  (reference.channels === 3 ? c : 0)
              ]!;
            count++;
          }
        data[(y * width + x) * 3 + c] = Math.round(sum / count);
      }
  return { width, height, channels: 3, data };
}

if (process.argv.includes("--generate")) {
  generate();
  console.log(`[jpeg] fixtures written to ${FIXTURES}`);
  process.exit(0);
}

const read = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURES, name)));
const withDjpeg = has("djpeg");
if (!withDjpeg) console.log("[jpeg] djpeg is not installed; checking sizes and sanity only");

for (const name of [...JPEGS.map(([file]) => file), "jpegtran-progressive.jpg", "sips.jpg"]) {
  const bytes = read(name);
  const image = decodeJpeg(bytes);
  assert.deepEqual(jpegSize(bytes), { width: image.width, height: image.height }, name);
  assert.equal(image.rgba.length, image.width * image.height * 4);
  if (!withDjpeg) continue;
  const { mean, max } = compare(image, djpeg(path.join(FIXTURES, name)));
  console.log(
    `[jpeg] ${name.padEnd(28)} ${image.width}×${image.height} mean ${mean.toFixed(3)} max ${max}`,
  );
  assert.ok(mean < 1, `${name}: mean error ${mean}`);
  assert.ok(max <= 8, `${name}: max error ${max}`);
}

// The DC-only decode is the 8×8 block averages.
{
  const name = "baseline-444.jpg";
  const image = decodeJpeg(read(name), { maxEdge: 8 });
  assert.deepEqual([image.width, image.height], [8, 6]);
  assert.deepEqual(decodeJpeg(read(name), { maxEdge: 9 }).width, 64, "no scaling below maxEdge");
  if (withDjpeg) {
    const { mean, max } = compare(image, boxDown(djpeg(path.join(FIXTURES, name)), 8));
    console.log(`[jpeg] DC-only 1/8 ${name} mean ${mean.toFixed(3)} max ${max}`);
    assert.ok(mean < 4 && max < 24, `DC-only error mean ${mean} max ${max}`);
  }
  const odd = decodeJpeg(read("odd-420.jpg"), { maxEdge: 4 });
  assert.deepEqual([odd.width, odd.height], [5, 3]);
}

// A truncated file decodes what is there; non-JPEG data is refused.
{
  const bytes = read("baseline-420.jpg");
  const cut = decodeJpeg(bytes.subarray(0, bytes.length - 120));
  assert.deepEqual([cut.width, cut.height], [64, 48]);
  const full = decodeJpeg(bytes);
  assert.deepEqual(
    cut.rgba.subarray(0, 64 * 16 * 4),
    full.rgba.subarray(0, 64 * 16 * 4),
    "first MCU row intact",
  );
  assert.notDeepEqual(cut.rgba, full.rgba, "the cut changed the end");
  assert.throws(() => decodeJpeg(read("source-64x48.png")), /Not a JPEG/);
  assert.equal(jpegSize(read("source-64x48.png")), null);
  assert.throws(() => decodeJpeg(bytes.subarray(0, 200)), /no image data/);
}

// GIF: exact against ffmpeg's decode, and against the palette made for it.
for (const name of ["ffmpeg.gif", "sips.gif"]) {
  const bytes = read(name);
  const image = decodeGif(bytes);
  assert.deepEqual(gifSize(bytes), { width: image.width, height: image.height });
  if (!has("ffmpeg")) continue;
  const reference = execFileSync("ffmpeg", [
    "-v",
    "error",
    "-i",
    path.join(FIXTURES, name),
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-",
  ]);
  assert.equal(reference.length, image.rgba.length, name);
  let differing = 0;
  for (let i = 0; i < image.rgba.length; i += 4)
    if (
      reference[i + 3] !== image.rgba[i + 3] ||
      (image.rgba[i + 3] &&
        reference.readUInt32BE(i) !== Buffer.from(image.rgba.subarray(i, i + 4)).readUInt32BE(0))
    )
      differing++;
  console.log(
    `[gif] ${name} ${image.width}×${image.height} differing pixels vs ffmpeg: ${differing}`,
  );
  assert.equal(differing, 0, name);
}

/**
 * A GIF built here so the expected pixels are exact: an interlaced 3×10 frame at (1, 1) of a 5×12
 * screen, with a local colour table and a transparent index. LZW codes are written uncompressed
 * (a literal per pixel, clearing before the code size would grow).
 */
{
  const width = 3;
  const height = 10;
  const indices = Array.from({ length: width * height }, (_, i) => i % 4);
  const codes: number[] = [4];
  indices.forEach((index, i) => {
    codes.push(index);
    if (i % 2 === 1) codes.push(4);
  });
  codes.push(5);
  let acc = 0;
  let bits = 0;
  const data: number[] = [];
  for (const code of codes) {
    acc |= code << bits;
    bits += 3;
    while (bits >= 8) {
      data.push(acc & 255);
      acc >>= 8;
      bits -= 8;
    }
  }
  if (bits) data.push(acc & 255);
  // Interlaced order: source row n is screen row rows[n].
  const rows = [0, 8, 4, 2, 6, 1, 3, 5, 7, 9];
  const table = [10, 20, 30, 200, 0, 0, 0, 200, 0, 0, 0, 250];
  const gif = new Uint8Array([
    ...Buffer.from("GIF89a"),
    5,
    0,
    12,
    0,
    0,
    0,
    0,
    0x21,
    0xf9,
    4,
    1,
    0,
    0,
    2,
    0,
    0x2c,
    1,
    0,
    1,
    0,
    width,
    0,
    height,
    0,
    0x80 | 0x40 | 1,
    ...table,
    2,
    data.length,
    ...data,
    0,
    0x3b,
  ]);
  const image = decodeGif(gif);
  assert.deepEqual([image.width, image.height], [5, 12]);
  for (let source = 0; source < height; source++)
    for (let x = 0; x < width; x++) {
      const index = indices[source * width + x]!;
      const at = ((rows[source]! + 1) * 5 + x + 1) * 4;
      const pixel = [...image.rgba.subarray(at, at + 4)];
      assert.deepEqual(
        pixel,
        index === 2 ? [0, 0, 0, 0] : [...table.slice(index * 3, index * 3 + 3), 255],
      );
    }
  assert.deepEqual([...image.rgba.subarray(0, 4)], [0, 0, 0, 0], "outside the frame stays clear");
  assert.throws(() => decodeGif(read("baseline-420.jpg")), /Not a GIF/);
}

// Timing on a 12 MP photo-sized JPEG, made at run time and not kept.
if (has("cjpeg") && !process.argv.includes("--quick")) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "jpeg-timing-"));
  const big = sourcePicture(4000, 3000);
  fs.writeFileSync(path.join(scratch, "big.ppm"), ppm(big));
  execFileSync("cjpeg", [
    "-quality",
    "88",
    "-outfile",
    path.join(scratch, "big.jpg"),
    path.join(scratch, "big.ppm"),
  ]);
  const bytes = new Uint8Array(fs.readFileSync(path.join(scratch, "big.jpg")));
  for (const options of [{}, { maxEdge: 256 }]) {
    const started = performance.now();
    const image = decodeJpeg(bytes, options);
    console.log(
      `[jpeg] 4000×3000 ${JSON.stringify(options)} → ${image.width}×${image.height} in ${(performance.now() - started).toFixed(0)} ms`,
    );
  }
  fs.rmSync(scratch, { recursive: true });
}

console.log("[jpeg] JPEG and GIF decoders passed");
