import assert from "node:assert/strict";
import { EglOutputScaler } from "./egl-output.js";
import { closeFd, O_CLOEXEC, O_RDWR, openPath } from "./libc.js";

const devicePath = process.env.MOIRE_RENDER_NODE ?? "/dev/dri/renderD128";
const fd = openPath(devicePath, O_RDWR | O_CLOEXEC);
let scaler: EglOutputScaler | null = null;
try {
  scaler = new EglOutputScaler(fd);
  const width = 8;
  const height = 6;
  const source = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      source[offset] = x * 17;
      source[offset + 1] = y * 29;
      source[offset + 2] = 255 - x * 13;
      source[offset + 3] = 255;
    }
  }
  const target = new Uint8Array(source.byteLength);
  scaler.beginFrame(source, width, height);
  scaler.renderOutput({
    id: "egl-conformance",
    x: 0,
    y: 0,
    width,
    height,
    targetWidth: width,
    targetHeight: height,
    targetPitch: width * 4,
    target,
  });
  assert.deepEqual(
    target,
    source,
    "surfaceless EGL round-trip changed orientation or BGRA channels",
  );

  const sceneWidth = 6;
  const sceneHeight = 4;
  const tile = new Uint8Array([
    9, 31, 211, 255, 17, 47, 193, 255,
    25, 63, 175, 255, 33, 79, 157, 255,
  ]);
  scaler.beginComposition({
    width: sceneWidth,
    height: sceneHeight,
    clearColor: 0xff14283c,
    layers: [
      {
        id: "retained-tile",
        pixels: tile,
        sourceWidth: 2,
        sourceHeight: 2,
        sourceStride: 8,
        revision: 1,
        destination: { x: 1, y: 1, width: 2, height: 2 },
        transform: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          1, 0, 0, 1,
        ],
        transformOrigin: [0, 0, 0],
        sampling: "nearest",
      },
    ],
  });
  const composed = new Uint8Array(sceneWidth * sceneHeight * 4);
  scaler.renderOutput({
    id: "retained-composition",
    x: 0,
    y: 0,
    width: sceneWidth,
    height: sceneHeight,
    targetWidth: sceneWidth,
    targetHeight: sceneHeight,
    targetPitch: sceneWidth * 4,
    target: composed,
  });
  const expected = new Uint8Array(composed.length);
  for (let pixel = 0; pixel < sceneWidth * sceneHeight; pixel++) {
    expected.set([0x3c, 0x28, 0x14, 0xff], pixel * 4);
  }
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 2; x++) {
      expected.set(
        tile.subarray((y * 2 + x) * 4, (y * 2 + x + 1) * 4),
        ((y + 1) * sceneWidth + x + 2) * 4,
      );
    }
  }
  assert.deepEqual(
    composed,
    expected,
    "retained EGL composition changed z placement, transform, or channels",
  );
  console.log(
    `[sys/egl-output-smoke] ok renderer=${scaler.info.glRenderer} version=${scaler.info.glVersion}`,
  );
} finally {
  scaler?.destroy();
  closeFd(fd);
}
