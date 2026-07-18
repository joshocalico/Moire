import assert from "node:assert/strict";
import {
  copySceneToOutput,
  desktopBounds,
  horizontalLayout,
  outputContainingPoint,
  outputsIntersectingRect,
  outputMembershipDelta,
  replacementOwner,
} from "./display-layout.js";

const outputs = horizontalLayout([
  { id: "eDP-1", width: 3, height: 2 },
  { id: "DP-1", width: 2, height: 3 },
  { id: "HDMI-A-1", width: 4, height: 1 },
]);

assert.deepEqual(
  outputs.map(({ id, x, y }) => ({ id, x, y })),
  [
    { id: "eDP-1", x: 0, y: 0 },
    { id: "DP-1", x: 3, y: 0 },
    { id: "HDMI-A-1", x: 5, y: 0 },
  ],
);
assert.deepEqual(desktopBounds(outputs), { width: 9, height: 3 });
assert.equal(outputContainingPoint(outputs, 4, 2)?.id, "DP-1");
assert.equal(outputContainingPoint(outputs, 7, 2), null);
assert.equal(replacementOwner(outputs, 0)?.id, "DP-1");
assert.equal(replacementOwner(outputs, 1)?.id, "eDP-1");
assert.equal(replacementOwner([outputs[0]!], 0), null);
assert.deepEqual(
  outputsIntersectingRect(outputs, { x: 2, y: 0, width: 2, height: 2 }).map(
    (output) => output.id,
  ),
  ["eDP-1", "DP-1"],
);
assert.deepEqual(
  outputsIntersectingRect(outputs, { x: 3, y: 0, width: 1, height: 1 }).map(
    (output) => output.id,
  ),
  ["DP-1"],
);
assert.deepEqual(
  outputsIntersectingRect(outputs, { x: 7, y: 2, width: 1, height: 1 }),
  [],
);
assert.deepEqual(outputMembershipDelta(new Set([11]), [11, 12]), {
  entered: [12],
  left: [],
  next: new Set([11, 12]),
});
assert.deepEqual(outputMembershipDelta(new Set([11, 12]), [12]), {
  entered: [],
  left: [11],
  next: new Set([12]),
});

const bounds = desktopBounds(outputs);
const scene = new Uint8Array(bounds.width * bounds.height * 4);
for (let y = 0; y < bounds.height; y++) {
  for (let x = 0; x < bounds.width; x++) {
    const offset = (y * bounds.width + x) * 4;
    scene[offset] = x;
    scene[offset + 1] = y;
    scene[offset + 2] = 0xa5;
    scene[offset + 3] = 0xff;
  }
}

// DP-1 starts at logical x=3 and uses a deliberately padded target pitch.
const dp = outputs[1]!;
const pitch = dp.width * 4 + 8;
const target = new Uint8Array(pitch * dp.height).fill(0xcc);
copySceneToOutput(scene, bounds.width, bounds.height, dp, target, pitch);
for (let y = 0; y < dp.height; y++) {
  for (let x = 0; x < dp.width; x++) {
    const offset = y * pitch + x * 4;
    assert.deepEqual([...target.subarray(offset, offset + 4)], [
      dp.x + x,
      y,
      0xa5,
      0xff,
    ]);
  }
  assert.deepEqual(
    [...target.subarray(y * pitch + dp.width * 4, (y + 1) * pitch)],
    new Array(8).fill(0xcc),
  );
}

assert.throws(
  () =>
    copySceneToOutput(
      scene,
      bounds.width,
      bounds.height,
      { id: "bad", x: 8, y: 0, width: 2, height: 1 },
      new Uint8Array(8),
      8,
    ),
  /outside the logical scene/,
);

console.log("[core/display-layout-smoke] ok");
