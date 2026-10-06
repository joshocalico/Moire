/** Portable frame policy; optional actual EGL raster oracle, never a hardware classifier. */
import assert from "node:assert/strict";
import {
  windowContentShape,
  contentShapeCoverage,
  paintShapedHeader,
} from "./window-content-shape";
import { EglOutputScaler, closeFd, openPath, O_RDWR, O_CLOEXEC } from "@moire/sys";
import type { EglCompositionLayer } from "@moire/sys";
import { WindowBorderPainter } from "./window-border";

const bounds = { x: 12, y: 10, width: 80, height: 54 };
const shape = windowContentShape(bounds, 12, "discard");
for (const [x, y] of [
  [12.5, 10.5],
  [91.5, 10.5],
  [91.5, 63.5],
  [12.5, 63.5],
])
  assert.equal(
    contentShapeCoverage(shape, x!, y!),
    0,
    "all exterior corner pixels remain uncovered",
  );
for (const [x, y] of [
  [24.5, 10.5],
  [12.5, 22.5],
  [50, 40],
])
  assert.equal(contentShapeCoverage(shape, x!, y!), 1, "inside pixels are retained");
assert.equal(contentShapeCoverage(shape, 11.5, 30), 0);
assert.equal(contentShapeCoverage({ ...shape, outside: "translucent-shadow" }, 11.5, 30), 1);
const square = windowContentShape(bounds, 0, "discard");
assert.equal(
  contentShapeCoverage(square, 12.5, 10.5),
  1,
  "maximized square corner remains content",
);
assert.deepEqual(
  windowContentShape({ ...bounds, width: 7 }, 1_000_000, "discard").radii,
  [3, 3, 3, 3],
  "radius allocation stays bounded by frame and 64 pixels",
);
assert.deepEqual(windowContentShape(bounds, 1_000_000, "discard").radii, [27, 27, 27, 27]);
assert.deepEqual(
  windowContentShape({ ...bounds, width: 2000, height: 2000 }, 1_000_000, "discard").radii,
  [64, 64, 64, 64],
);
// Legacy paint-only header preserves the real scene under its top corners,
// including another window. It never paints wallpaper into uncovered pixels.
const width = 110,
  height = 80,
  pitch = 128;
const prior = new Uint32Array(pitch * height);
for (let y = 0; y < height; y++)
  for (let x = 0; x < pitch; x++) prior[y * pitch + x] = (0xff000000 | (x << 8) | y) >>> 0;
const frame = prior.slice();
let paints = 0;
paintShapedHeader(frame, pitch, width, height, shape, () => {
  paints++;
  for (let y = bounds.y; y < bounds.y + 20; y++)
    frame.fill(0xffa03020, y * pitch + bounds.x, y * pitch + bounds.x + bounds.width);
});
assert.equal(paints, 1);
assert.equal(frame[bounds.y * pitch + bounds.x], prior[bounds.y * pitch + bounds.x]);
assert.equal(
  frame[bounds.y * pitch + bounds.x + bounds.width - 1],
  prior[bounds.y * pitch + bounds.x + bounds.width - 1],
);
assert.equal(frame[(bounds.y + 10) * pitch + bounds.x + 30], 0xffa03020);
for (let y = 0; y < height; y++)
  assert.ok(
    frame
      .subarray(y * pitch + width, (y + 1) * pitch)
      .every((v, i) => v === prior[y * pitch + width + i]),
    "pitch padding is untouched",
  );

if (process.env.MOIRE_TEST_CONTENT_SHAPE_EGL === "1") {
  const fd = openPath(process.env.MOIRE_RENDER_NODE ?? "/dev/dri/renderD128", O_RDWR | O_CLOEXEC);
  let scaler: EglOutputScaler | undefined;
  try {
    scaler = new EglOutputScaler(fd, { measureTransfers: true });
    const sceneWidth = 110,
      sceneHeight = 90;
    const destination = { x: 8, y: 6, width: 88, height: 62 };
    const pixels = new Uint8Array(destination.width * destination.height * 4);
    for (let y = 0; y < destination.height; y++)
      for (let x = 0; x < destination.width; x++) {
        const inFrame = x >= 4 && y >= 4 && x < 84 && y < 58;
        pixels.set(
          inFrame ? [40, 70, 190, 255] : x === 0 ? [99, 99, 99, 255] : [8, 12, 16, 64],
          (y * destination.width + x) * 4,
        );
      }
    const body: EglCompositionLayer = {
      id: "actual-csd-buffer",
      pixels,
      sourceWidth: destination.width,
      sourceHeight: destination.height,
      sourceStride: destination.width * 4,
      revision: 1,
      destination,
      sampling: "nearest",
      contentShape: { ...shape, outside: "translucent-shadow" },
      surfaceGeometry: { x: 4, y: 4, width: 80, height: 54 },
    };
    const take = (layers: EglCompositionLayer[], scale = 1) => {
      const before = scaler!.getTransferMetrics();
      scaler!.beginComposition({
        width: sceneWidth,
        height: sceneHeight,
        clearColor: 0xff101018,
        layers,
      });
      const after = scaler!.getTransferMetrics();
      assert.equal(
        after.gpuReadback!.count,
        before.gpuReadback!.count,
        "production shape composition must not read GPU pixels",
      );
      const physicalWidth = sceneWidth * scale,
        physicalHeight = sceneHeight * scale;
      const target = new Uint8Array(physicalWidth * physicalHeight * 4);
      // Explicit diagnostic oracle only, after the actual shader pass.
      scaler!.renderOutput({
        id: "content-shape-oracle",
        x: 0,
        y: 0,
        width: sceneWidth,
        height: sceneHeight,
        targetWidth: physicalWidth,
        targetHeight: physicalHeight,
        targetPitch: physicalWidth * 4,
        target,
      });
      return { words: new Uint32Array(target.buffer), width: physicalWidth };
    };
    const borders = new WindowBorderPainter();
    for (const focused of [true, false]) {
      const color = focused ? 0xff9c85ce : 0xff525160;
      const outline = borders
        .layers("outline", 1, bounds, { width: 1, radius: 12, color })
        .map((layer) => ({
          id: layer.id,
          pixels: layer.source.pixels,
          sourceWidth: layer.source.width,
          sourceHeight: layer.source.height,
          sourceStride: layer.source.stride,
          destination: layer.destination,
          revision: 1,
          sampling: "nearest" as const,
        }));
      const raster = take([body, ...outline]);
      for (const [x, y] of [
        [12, 10],
        [91, 10],
        [91, 63],
        [12, 63],
      ])
        assert.equal(raster.words[y! * raster.width + x!], 0xff101018);
      assert.equal(raster.words[30 * raster.width + 40], 0xffbe4628);
      assert.equal(raster.words[10 * raster.width + 50], color);
      assert.notEqual(
        raster.words[20 * raster.width + 10],
        0xff101018,
        "translucent CSD shadow survives",
      );
      assert.equal(raster.words[20 * raster.width + 8], 0xff101018, "opaque CSD padding discarded");
      const scaled = take([body, ...outline], 1.5);
      // renderOutput intentionally uses GL_LINEAR. A physical pixel centre
      // near a logical corner can sample the preserved CSD shadow next to it.
      // Compare the entire scaled image with an independent linear sampler of
      // the already-verified logical frame; don't demand a nearest-only pixel.
      let maxScaleError = 0;
      for (let y = 0; y < sceneHeight * 1.5; y++)
        for (let x = 0; x < sceneWidth * 1.5; x++) {
          const sx = (x + 0.5) / 1.5 - 0.5,
            sy = (y + 0.5) / 1.5 - 0.5;
          const x0 = Math.floor(sx),
            y0 = Math.floor(sy),
            tx = sx - x0,
            ty = sy - y0;
          const sample = (px: number, py: number) =>
            raster.words[
              Math.max(0, Math.min(sceneHeight - 1, py)) * sceneWidth +
                Math.max(0, Math.min(sceneWidth - 1, px))
            ]!;
          const actual = scaled.words[y * scaled.width + x]!;
          for (let shift = 0; shift <= 24; shift += 8) {
            const channel = (word: number) => (word >>> shift) & 255;
            const expected = Math.round(
              channel(sample(x0, y0)) * (1 - tx) * (1 - ty) +
                channel(sample(x0 + 1, y0)) * tx * (1 - ty) +
                channel(sample(x0, y0 + 1)) * (1 - tx) * ty +
                channel(sample(x0 + 1, y0 + 1)) * tx * ty,
            );
            const error = Math.abs(channel(actual) - expected);
            maxScaleError = Math.max(maxScaleError, error);
            assert.ok(
              error <= 2,
              `linear scale oracle mismatch (${x},${y}) channel${shift / 8}: ${channel(actual)} vs ${expected}`,
            );
          }
        }
      console.log(
        `[window/content-shape] scale1.5 full-frame linear oracle maxChannelError=${maxScaleError}`,
      );
      assert.equal(scaled.words[45 * scaled.width + 60], 0xffbe4628);
    }
    const squareRaster = take([
      { ...body, contentShape: { ...square, outside: "translucent-shadow" } },
    ]);
    assert.equal(
      squareRaster.words[10 * squareRaster.width + 12],
      0xffbe4628,
      "radius-only state change invalidates retained damage",
    );
    const roundedAgain = take([body]);
    assert.equal(
      roundedAgain.words[10 * roundedAgain.width + 12],
      0xff101018,
      "newly transparent corners redraw the lower scene after square state",
    );
    const highDpiPixels = new Uint8Array(destination.width * destination.height * 16);
    for (let y = 0; y < destination.height * 2; y++)
      for (let x = 0; x < destination.width * 2; x++) {
        const source = (Math.floor(y / 2) * destination.width + Math.floor(x / 2)) * 4;
        highDpiPixels.set(pixels.subarray(source, source + 4), (y * destination.width * 2 + x) * 4);
      }
    const highDpi = take([
      {
        ...body,
        pixels: highDpiPixels,
        sourceWidth: destination.width * 2,
        sourceHeight: destination.height * 2,
        sourceStride: destination.width * 8,
        surfaceGeometry: { x: 8, y: 8, width: 160, height: 108 },
      },
    ]);
    assert.equal(
      highDpi.words[10 * highDpi.width + 12],
      0xff101018,
      "buffer scale does not move logical frame or radius",
    );
    assert.equal(highDpi.words[30 * highDpi.width + 40], 0xffbe4628);
    const shifted = take([
      {
        ...body,
        contentShape: {
          ...body.contentShape!,
          bounds: { ...bounds, x: bounds.x + 2, y: bounds.y + 2 },
        },
      },
    ]);
    assert.equal(
      shifted.words[12 * shifted.width + 14],
      0xff101018,
      "geometry-only frame shift changes cached mask and damage",
    );
    const solidPixels = (w: number, h: number, color: number) => {
      const pixels = new Uint8Array(w * h * 4);
      new Uint32Array(pixels.buffer).fill(color);
      return pixels;
    };
    const ssdShape = { ...shape, outside: "discard" as const };
    const ssdHeader: EglCompositionLayer = {
      id: "ssd-header",
      pixels: solidPixels(80, 20, 0xff304070),
      sourceWidth: 80,
      sourceHeight: 20,
      sourceStride: 320,
      destination: { x: 12, y: 10, width: 80, height: 20 },
      contentShape: ssdShape,
    };
    const ssdBody: EglCompositionLayer = {
      id: "ssd-body",
      pixels: solidPixels(80, 34, 0xffa06020),
      sourceWidth: 80,
      sourceHeight: 34,
      sourceStride: 320,
      destination: { x: 12, y: 30, width: 80, height: 34 },
      contentShape: ssdShape,
    };
    const split = take([ssdBody, ssdHeader]);
    for (const [x, y] of [
      [12, 10],
      [91, 10],
      [91, 63],
      [12, 63],
    ])
      assert.equal(
        split.words[y! * split.width + x!],
        0xff101018,
        "SSD header/body share full frame rather than independently round their quads",
      );
    assert.equal(
      split.words[29 * split.width + 12],
      0xff304070,
      "header bottom is square at shared frame seam",
    );
    assert.equal(
      split.words[30 * split.width + 12],
      0xffa06020,
      "body top is square at shared frame seam",
    );
    const child: EglCompositionLayer = {
      id: "crossing-child",
      pixels: new Uint8Array([0xa0, 0x80, 0x18, 255]),
      sourceWidth: 1,
      sourceHeight: 1,
      sourceStride: 4,
      destination: { x: 10, y: 8, width: 20, height: 20 },
    };
    const crossing = take([body, child]);
    assert.equal(
      crossing.words[10 * crossing.width + 12],
      0xff1880a0,
      "child is not clipped by parent shape",
    );
    const unshaped = take([{ ...body, contentShape: undefined, surfaceGeometry: undefined }]);
    assert.equal(
      unshaped.words[10 * unshaped.width + 12],
      0xffbe4628,
      "fullscreen/unshaped next draw clears prior mask uniforms",
    );
    const shapedAfterFullscreen = take([body]);
    assert.equal(
      shapedAfterFullscreen.words[10 * shapedAfterFullscreen.width + 12],
      0xff101018,
      "fullscreen return reactivates rounded mask without changing producer pixels",
    );
    console.log(
      "[window/content-shape] actual EGL corner/shadow/focus/state/scale/child/uniform-reset oracle PASS; diagnostic readback only, no hardware qualification",
    );
  } finally {
    scaler?.destroy();
    closeFd(fd);
  }
}
console.log(
  "[window/content-shape] bounded frame coverage and exact underlying-scene legacy header preservation PASS",
);
