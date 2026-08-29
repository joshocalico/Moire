import assert from "node:assert/strict";
import {
  copySceneToOutput,
  copySceneToOutputScaled,
  desktopBounds,
  horizontalLayout,
  layoutsOverlap,
  normalizeLayoutOrigin,
  outputContainingPoint,
  outputsIntersectingRect,
  outputMembershipDelta,
  replacementOwner,
} from "./display-layout";

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
assert.deepEqual(
  normalizeLayoutOrigin([
    { id: "left", x: -4, y: 2, width: 4, height: 3 },
    { id: "right", x: 0, y: -1, width: 3, height: 3 },
  ]).map(({ id, x, y }) => ({ id, x, y })),
  [
    { id: "left", x: 0, y: 3 },
    { id: "right", x: 4, y: 0 },
  ],
);
assert.equal(layoutsOverlap(outputs), false);
assert.equal(
  layoutsOverlap([
    { id: "a", x: 0, y: 0, width: 4, height: 4 },
    { id: "b", x: 3, y: 3, width: 2, height: 2 },
  ]),
  true,
);
assert.equal(outputContainingPoint(outputs, 4, 2)?.id, "DP-1");
assert.equal(outputContainingPoint(outputs, 7, 2), null);
assert.equal(replacementOwner(outputs, 0)?.id, "DP-1");
assert.equal(replacementOwner(outputs, 1)?.id, "eDP-1");
assert.equal(replacementOwner([outputs[0]!], 0), null);
assert.deepEqual(
  outputsIntersectingRect(outputs, { x: 2, y: 0, width: 2, height: 2 }).map((output) => output.id),
  ["eDP-1", "DP-1"],
);
assert.deepEqual(
  outputsIntersectingRect(outputs, { x: 3, y: 0, width: 1, height: 1 }).map((output) => output.id),
  ["DP-1"],
);
assert.deepEqual(outputsIntersectingRect(outputs, { x: 7, y: 2, width: 1, height: 1 }), []);
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
    assert.deepEqual([...target.subarray(offset, offset + 4)], [dp.x + x, y, 0xa5, 0xff]);
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

// Mixed-DPI: a 2×1 logical output scaled into a 4×2 physical target.
const scaledTarget = new Uint8Array(4 * 2 * 4);
copySceneToOutputScaled(
  scene,
  bounds.width,
  bounds.height,
  { id: "hidpi", x: 3, y: 0, width: 2, height: 1 },
  scaledTarget,
  4,
  2,
  16,
);
for (let py = 0; py < 2; py++) {
  for (let px = 0; px < 4; px++) {
    const offset = (py * 4 + px) * 4;
    assert.deepEqual(
      [...scaledTarget.subarray(offset, offset + 4)],
      [3 + Math.floor(px / 2), 0, 0xa5, 0xff],
    );
  }
}

console.log("[core/display-layout-smoke] ok");
