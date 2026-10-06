/** Precompute the bounded own-React boot artwork; initrd needs only the PNG. */
import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import { createHash } from "node:crypto";
import React from "react";
import { PNG } from "pngjs";
import { createShellRoot, renderShell, SoftwareRenderer } from "@moire/react-host";
import {
  Backdrop,
  BrandMark,
  createSilkBackdrop,
  installUiFonts,
  setUiScaleFactor,
} from "@moire/ui";

const output = process.argv[2];
if (!output) throw new Error("Pass the output PNG path");
const width = 1280,
  height = 800;
setUiScaleFactor(1);
const beforeFonts = performance.now();
await installUiFonts();
const beforeArtwork = performance.now();
const source = createSilkBackdrop({ variant: "fold-e" });
const beforeRaster = performance.now();
const root = createShellRoot();
renderShell(
  root,
  <>
    <Backdrop width={width} height={height} source={source} />
    <BrandMark
      x={width * 0.12}
      y={height * 0.29}
      width={260}
      height={86}
      symbol={false}
      color={0xffffe5d3}
    />
  </>,
);
const frame = new SoftwareRenderer().render(root.container, { width, height });
assert.equal(frame.width, width);
assert.equal(frame.height, height);
assert.equal(frame.pixels.length, width * height * 4);
let artworkPixels = 0;
let wordmarkPixels = 0;
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    const b = frame.pixels[at]!;
    const g = frame.pixels[at + 1]!;
    const r = frame.pixels[at + 2]!;
    assert.equal(frame.pixels[at + 3], 255, "boot composition must cover its viewport");
    if (x > width * 0.5 && r + g + b > 100) artworkPixels++;
    if (x >= 153 && x < 413 && y >= 232 && y < 318 && r > 180 && g > 160 && b > 140)
      wordmarkPixels++;
  }
}
assert.ok(artworkPixels > 20_000, "right field must contain actual Silk artwork");
assert.ok(wordmarkPixels > 100, "quiet left region must contain the rendered serif wordmark");
const beforeEncode = performance.now();
const png = new PNG({ width, height });
for (let index = 0; index < frame.pixels.length; index += 4) {
  png.data[index] = frame.pixels[index + 2]!;
  png.data[index + 1] = frame.pixels[index + 1]!;
  png.data[index + 2] = frame.pixels[index]!;
  png.data[index + 3] = frame.pixels[index + 3]!;
}
const bytes = PNG.sync.write(png);
const beforeDecode = performance.now();
const decoded = PNG.sync.read(bytes);
const finished = performance.now();
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
fs.writeFileSync(output, bytes);
renderShell(root, null);
console.log(
  JSON.stringify({
    output,
    width,
    height,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    compressedBytes: bytes.length,
    decodedBytes: decoded.data.length,
    sourceBytes: source.metrics.bytes,
    geometry: source.metrics,
    pixelOracle: { artworkPixels, wordmarkPixels },
    fontLoadMs: beforeArtwork - beforeFonts,
    artworkGenerationMs: beforeRaster - beforeArtwork,
    reactRasterMs: beforeEncode - beforeRaster,
    encodeMs: beforeDecode - beforeEncode,
    decodeMs: finished - beforeDecode,
    timingScope: "artifact-generator process, not native boot or libpng timing",
    bootStrategy: "one static PNG; no Node, React runtime, generator or animation in initrd",
  }),
);
