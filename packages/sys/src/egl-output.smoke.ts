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
  const geometrySource = new Uint8Array([
    0, 0, 255, 255,
    0, 255, 0, 255,
    0, 0, 0, 0,
  ]);
  scaler.beginComposition({
    width: 3,
    height: 1,
    clearColor: 0xff112233,
    layers: [
      {
        id: "surface-geometry",
        pixels: geometrySource,
        sourceWidth: 3,
        sourceHeight: 1,
        sourceStride: 12,
        revision: 1,
        destination: { x: 0, y: 0, width: 3, height: 1 },
        surfaceGeometry: { x: 1, y: 0, width: 1, height: 1 },
        sampling: "nearest",
      },
    ],
  });
  const geometryTarget = new Uint8Array(12);
  scaler.renderOutput({
    id: "surface-geometry-mask",
    x: 0,
    y: 0,
    width: 3,
    height: 1,
    targetWidth: 3,
    targetHeight: 1,
    targetPitch: 12,
    target: geometryTarget,
  });
  assert.deepEqual(
    geometryTarget,
    new Uint8Array([
      0x33, 0x22, 0x11, 0xff,
      0, 255, 0, 255,
      0x33, 0x22, 0x11, 0xff,
    ]),
    "surface geometry mask did not discard opaque client padding",
  );
  const roundedSource = new Uint8Array(5 * 5 * 4);
  for (let pixel = 0; pixel < 25; pixel++) {
    roundedSource.set([0x10, 0xd0, 0x40, 0xff], pixel * 4);
  }
  scaler.beginComposition({
    width: 5,
    height: 5,
    clearColor: 0xff09111b,
    layers: [
      {
        id: "rounded-clip",
        pixels: roundedSource,
        sourceWidth: 5,
        sourceHeight: 5,
        sourceStride: 20,
        revision: 1,
        destination: { x: 0, y: 0, width: 5, height: 5 },
        cornerRadius: [2, 2, 2, 2],
        sampling: "nearest",
      },
    ],
  });
  const roundedTarget = new Uint8Array(5 * 5 * 4);
  scaler.renderOutput({
    id: "rounded-clip",
    x: 0,
    y: 0,
    width: 5,
    height: 5,
    targetWidth: 5,
    targetHeight: 5,
    targetPitch: 20,
    target: roundedTarget,
  });
  assert.deepEqual(
    roundedTarget.subarray(0, 4),
    new Uint8Array([0x1b, 0x11, 0x09, 0xff]),
    "rounded clip did not discard the top-left corner",
  );
  assert.deepEqual(
    roundedTarget.subarray(2 * 4, 3 * 4),
    new Uint8Array([0x10, 0xd0, 0x40, 0xff]),
    "rounded clip discarded the top edge centre",
  );
  scaler.beginComposition({
    width: 9,
    height: 9,
    clearColor: 0xffffffff,
    layers: [
      {
        id: "analytic-shadow",
        pixels: new Uint8Array(4),
        sourceWidth: 1,
        sourceHeight: 1,
        sourceStride: 4,
        revision: 1,
        destination: { x: 3, y: 3, width: 3, height: 3 },
        cornerRadius: 1,
        dropShadow: {
          offsetX: 0,
          offsetY: 0,
          blurRadius: 2,
          color: 0x80000000,
        },
        sampling: "nearest",
      },
    ],
  });
  const shadowTarget = new Uint8Array(9 * 9 * 4);
  scaler.renderOutput({
    id: "analytic-shadow",
    x: 0,
    y: 0,
    width: 9,
    height: 9,
    targetWidth: 9,
    targetHeight: 9,
    targetPitch: 36,
    target: shadowTarget,
  });
  assert.deepEqual(
    shadowTarget.subarray(0, 4),
    new Uint8Array([255, 255, 255, 255]),
    "drop shadow leaked beyond its bounded quad",
  );
  assert.ok(
    shadowTarget[(4 * 9 + 4) * 4]! < 200,
    "drop shadow did not darken the window footprint",
  );
  console.log(
    `[sys/egl-output-smoke] ok renderer=${scaler.info.glRenderer} version=${scaler.info.glVersion}`,
  );
} finally {
  scaler?.destroy();
  closeFd(fd);
}
