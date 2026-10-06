import assert from "node:assert/strict";
import { wlShm } from "@moire/protocol/generated";
import { classifyShmFrame } from "./shm-format";

const pixels = new Uint8Array(24);
for (let offset = 0; offset < pixels.length; offset += 4) pixels.set([17, 49, 83, 255], offset);
const original = pixels.slice();
assert.equal(classifyShmFrame(pixels, 3, 2).format, wlShm.enums.format.xrgb8888);
for (const alpha of [3, 7, 11, 15, 19, 23]) {
  for (const value of [0, 1, 127, 254]) {
    pixels[alpha] = value;
    assert.equal(classifyShmFrame(pixels, 3, 2).format, wlShm.enums.format.argb8888);
  }
  pixels[alpha] = 255;
}
assert.deepEqual(pixels, original, "certification never modifies pixels");
for (const [width, height] of [
  [0, 2],
  [3, 0],
  [-3, -2],
  [1.5, 4],
  [NaN, 2],
  [Infinity, 2],
  [0x20000000, 1],
  [2 ** 53, 1],
] as const) {
  assert.throws(() => classifyShmFrame(pixels, width, height), RangeError);
}
for (const data of [new Uint8Array(0), pixels.subarray(0, 23), new Uint8Array(25)]) {
  assert.throws(() => classifyShmFrame(data, 3, 2), RangeError);
}
const slab = new Uint8Array(40);
slab.set(original, 8);
assert.equal(classifyShmFrame(slab.subarray(8, 32), 3, 2).format, wlShm.enums.format.xrgb8888);
console.log(
  "[wayland/shm-format] complete BGRA, every alpha position, invalid sizes and subarray boundary passed",
);
