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
  if (process.env.MOIRE_TEST_DIRECT_OUTPUT === "1") {
    const directWidth = 64;
    const directHeight = 64;
    const directOutput = {
      id: "egl-direct-conformance",
      x: 0,
      y: 0,
      width,
      height,
      targetWidth: directWidth,
      targetHeight: directHeight,
    };
    const direct = scaler.renderOutputDirect(directOutput);
    const directReadback = new Uint8Array(directWidth * directHeight * 4);
    scaler.readDirectOutput(directOutput, directReadback);
    const scanoutPixel = (pixel: Uint8Array) =>
      new Uint8Array([pixel[2]!, pixel[1]!, pixel[0]!, pixel[3]!]);
    assert.deepEqual(
      directReadback.subarray(0, 4),
      scanoutPixel(source.subarray(0, 4)),
      "GBM/EGLImage target did not convert top-left BGRA storage to scanout RGB",
    );
    assert.deepEqual(
      directReadback.subarray(directReadback.length - 4),
      scanoutPixel(source.subarray(source.length - 4)),
      "GBM/EGLImage target did not convert bottom-right BGRA storage to scanout RGB",
    );
    assert.ok(direct.framebufferId > 0, "direct target did not register a DRM FB");
    const alternate = scaler.renderOutputDirect(directOutput);
    assert.notEqual(
      alternate.framebufferId,
      direct.framebufferId,
      "direct output did not rotate to a second scanout target",
    );
    const recycled = scaler.renderOutputDirect(directOutput);
    assert.equal(
      recycled.framebufferId,
      direct.framebufferId,
      "direct output did not recycle its first scanout target",
    );
    console.log(
      `[sys/egl-output-smoke] direct framebuffers=${direct.framebufferId},${alternate.framebufferId} stride=${direct.stride}`,
    );
  }

  const clientChannel = "egl-client-conformance";
  const clientFrames = [
    scaler.renderClientFrame(clientChannel, source, width, height),
    scaler.renderClientFrame(clientChannel, source, width, height),
    scaler.renderClientFrame(clientChannel, source, width, height),
  ];
  assert.ok(clientFrames.every(Boolean), "client target pool did not allocate");
  assert.equal(
    scaler.renderClientFrame(clientChannel, source, width, height),
    null,
    "client target pool reused a compositor-owned frame",
  );
  const firstClientFrame = clientFrames[0]!;
  assert.ok(firstClientFrame.fd >= 0, "client target did not export a dma-buf fd");
  assert.ok(firstClientFrame.stride >= width * 4, "client target stride is invalid");
  scaler.releaseClientFrame(firstClientFrame.id);
  const recycledClientFrame = scaler.renderClientFrame(
    clientChannel,
    source,
    width,
    height,
  );
  assert.equal(
    recycledClientFrame?.id,
    firstClientFrame.id,
    "released client target was not recycled",
  );
  scaler.dropClientChannel(clientChannel);

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
  const blurWidth = 24;
  const blurHeight = 8;
  const stripeSource = new Uint8Array(blurWidth * blurHeight * 4);
  for (let y = 0; y < blurHeight; y++) {
    for (let x = 0; x < blurWidth; x++) {
      const value = x % 2 === 0 ? 0 : 255;
      stripeSource.set([value, value, value, 255], (y * blurWidth + x) * 4);
    }
  }
  scaler.beginComposition({
    width: blurWidth,
    height: blurHeight,
    clearColor: 0xff000000,
    layers: [
      {
        id: "blur-stripes",
        pixels: stripeSource,
        sourceWidth: blurWidth,
        sourceHeight: blurHeight,
        sourceStride: blurWidth * 4,
        revision: 1,
        destination: { x: 0, y: 0, width: blurWidth, height: blurHeight },
        sampling: "nearest",
      },
      {
        id: "bounded-backdrop-blur",
        pixels: new Uint8Array(4),
        sourceWidth: 1,
        sourceHeight: 1,
        sourceStride: 4,
        revision: 1,
        destination: { x: 8, y: 2, width: 8, height: 4 },
        backdropBlur: { radius: 4 },
        sampling: "nearest",
      },
    ],
  });
  const blurTarget = new Uint8Array(stripeSource.length);
  scaler.renderOutput({
    id: "bounded-backdrop-blur",
    x: 0,
    y: 0,
    width: blurWidth,
    height: blurHeight,
    targetWidth: blurWidth,
    targetHeight: blurHeight,
    targetPitch: blurWidth * 4,
    target: blurTarget,
  });
  assert.deepEqual(
    blurTarget.subarray((1 * blurWidth + 1) * 4, (1 * blurWidth + 2) * 4),
    stripeSource.subarray((1 * blurWidth + 1) * 4, (1 * blurWidth + 2) * 4),
    "backdrop blur modified pixels outside its layer bounds",
  );
  const blurredDark = blurTarget[(3 * blurWidth + 10) * 4]!;
  const blurredLight = blurTarget[(3 * blurWidth + 11) * 4]!;
  assert.ok(
    blurredDark > 10 && blurredLight < 245,
    "backdrop blur did not reduce contrast inside its layer bounds",
  );
  scaler.beginComposition({
    width: 1,
    height: 1,
    clearColor: 0xff000000,
    layers: [
      {
        id: "semantic-rgba-color-matrix",
        pixels: new Uint8Array([10, 20, 30, 255]),
        sourceWidth: 1,
        sourceHeight: 1,
        sourceStride: 4,
        revision: 1,
        destination: { x: 0, y: 0, width: 1, height: 1 },
        colorMatrix: [
          0, 0, 0, 0, 0,
          0, 1, 0, 0, 0,
          0, 0, 1, 0, 0,
          0, 0, 0, 1, 0,
        ],
        sampling: "nearest",
      },
    ],
  });
  const colorMatrixTarget = new Uint8Array(4);
  scaler.renderOutput({
    id: "semantic-rgba-color-matrix",
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    targetWidth: 1,
    targetHeight: 1,
    targetPitch: 4,
    target: colorMatrixTarget,
  });
  assert.deepEqual(
    colorMatrixTarget,
    new Uint8Array([10, 20, 0, 255]),
    "color matrix did not operate in semantic RGBA channel order",
  );
  console.log(
    `[sys/egl-output-smoke] ok renderer=${scaler.info.glRenderer} version=${scaler.info.glVersion}`,
  );
} finally {
  scaler?.destroy();
  closeFd(fd);
}
