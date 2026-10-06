import assert from "node:assert/strict";
import { blurBackdrop } from "./backdrop";

const width = 96,
  height = 64,
  pitch = 100;
const panel = { x: 8, y: 28, width: 80, height: 28, radius: 10 };
const frame = (offset: number) => {
  const pixels = new Uint32Array(pitch * height).fill(0xff223344);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      pixels[y * pitch + x] = (x + offset) % 8 < 4 ? 0xff000000 : 0xffffffff;
  return pixels;
};
const first = frame(0);
const original = first.slice();
blurBackdrop(first, pitch, width, height, panel, 18);
assert.equal(first[0], original[0], "blur must leave pixels outside the panel unchanged");
assert.equal(
  first[panel.y * pitch + panel.x],
  original[panel.y * pitch + panel.x],
  "rounded material must preserve corner pixels",
);
const center = 40 * pitch + 40;
assert.notEqual(
  first[center],
  original[center],
  "real backdrop blur must soften a contrasting background",
);
assert.ok((first[center]! & 255) > 60 && (first[center]! & 255) < 195);
const next = frame(3);
blurBackdrop(next, pitch, width, height, panel, 18);
assert.notDeepEqual(next, first, "a changed backdrop must produce a changed frame");
console.log("[core/backdrop] live CPU blur, clipping and stride passed");
