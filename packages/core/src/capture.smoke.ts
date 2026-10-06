import assert from "node:assert/strict";
import { createCompositorOutputRenderer } from "./output-renderer";
const renderer = createCompositorOutputRenderer(-1, "software");
const pixels = new Uint8Array(
  new Uint32Array([0xffff0000, 0xff0000ff, 0xff00ff00, 0xffffffff]).buffer,
);
const target = {
  geometry: { id: "fixture", x: 1, y: 0, width: 1, height: 2 },
  physicalWidth: 1,
  physicalHeight: 2,
};
assert.throws(() => renderer.captureOutput(target));
renderer.beginFrame({ pixels, width: 2, height: 2, stride: 8 });
assert.deepEqual([...renderer.captureOutput(target)], [255, 0, 0, 255, 255, 255, 255, 255]);
const destination = new Uint8Array(8);
renderer.renderOutput({ ...target, pixels: destination, pitch: 4 });
assert.deepEqual(
  renderer.captureOutput(target),
  destination,
  "capture matches actual output crop/scale",
);
renderer.destroy();
console.log("Actual compositor output capture/crop and scanout-independent pixels passed");
