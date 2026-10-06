/** Native Linux conformance; uses actual producer BOs, no mock EGL/CPU snapshot. */
import assert from "node:assert/strict";
import { EglOutputScaler, type EglResidentImage, type EglClientPresent } from "./egl-output";
import { closeFd, O_CLOEXEC, O_RDWR, openPath } from "./libc";

const fd = openPath(process.env.MOIRE_RENDER_NODE ?? "/dev/dri/card0", O_RDWR | O_CLOEXEC);
let scaler: EglOutputScaler | null = null;
const images: EglResidentImage[] = [];
try {
  scaler = new EglOutputScaler(fd, { measureTransfers: true });
  const owner = scaler;
  const width = 97,
    height = 33;
  const pattern = (phase: number) => {
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        // First 4096 bytes can be black/transparent; later rows carry color.
        const alpha = y < 12 ? (phase === 0 ? 0 : 255) : [0, 128, 255][(x + y + phase) % 3]!;
        pixels.set(
          [
            Math.floor((((x * 13 + phase * 17) % 256) * alpha) / 255),
            Math.floor((((y * 23 + phase * 37) % 256) * alpha) / 255),
            Math.floor((((x * 7 + y * 11 + phase * 53) % 256) * alpha) / 255),
            alpha,
          ],
          (y * width + x) * 4,
        );
      }
    return pixels;
  };
  const produce = (pixels: Uint8Array, revision: number) => {
    const frame = owner.renderClientComposition("resident-producer", {
      width,
      height,
      clearColor: 0,
      layers: [
        {
          id: "producer-pattern",
          pixels,
          sourceWidth: width,
          sourceHeight: height,
          sourceStride: width * 4,
          revision,
          destination: { x: 0, y: 0, width, height },
          sampling: "nearest",
        },
      ],
    });
    assert.ok(frame, "native producer BO allocation failed");
    return frame;
  };
  const capture = (frame: EglClientPresent, format = frame.format) => {
    const image = owner.snapshotDmabuf({
      width: frame.width,
      height: frame.height,
      format,
      plane: { fd: frame.fd, offset: 0, stride: frame.stride, modifier: frame.modifier },
    });
    images.push(image);
    return image;
  };
  const firstPixels = pattern(0),
    secondPixels = pattern(1);
  const firstFrame = produce(firstPixels, 1);
  const first = capture(firstFrame);
  assert.equal(first.owner, owner);
  assert.equal(first.width, width);
  assert.equal(first.height, height);
  // Release immediately after GPU snapshot completes, then overwrite the same BO.
  owner.releaseClientFrame(firstFrame.id);
  const reused = produce(secondPixels, 2);
  assert.equal(reused.id, firstFrame.id, "fixture did not actually overwrite producer BO");
  const productionStart = owner.getTransferMetrics();
  const second = capture(reused);
  const xrgb = capture(reused, 0x34325258);
  owner.beginComposition({
    width,
    height,
    clearColor: 0,
    layers: [
      {
        id: "resident-metrics",
        pixels: second,
        sourceWidth: width,
        sourceHeight: height,
        sourceStride: width * 4,
        revision: 1,
        destination: { x: 0, y: 0, width, height },
        sampling: "nearest",
      },
    ],
  });
  const productionEnd = owner.getTransferMetrics();
  assert.equal(productionEnd.enabled, true);
  assert.equal(productionEnd.dmabufImport!.count - productionStart.dmabufImport!.count, 2);
  assert.equal(productionEnd.gpuCopy!.count - productionStart.gpuCopy!.count, 2);
  assert.equal(
    productionEnd.gpuCopy!.bytes - productionStart.gpuCopy!.bytes,
    width * height * 4 * 2,
  );
  for (const operation of ["textureUpload", "gpuReadback", "cpuCopy"] as const) {
    assert.equal(
      productionEnd[operation]!.count - productionStart[operation]!.count,
      0,
      `resident production unexpectedly used ${operation}`,
    );
    assert.equal(productionEnd[operation]!.bytes - productionStart[operation]!.bytes, 0);
  }
  assert.ok(productionEnd.completionWait!.count > productionStart.completionWait!.count);
  assert.equal(productionEnd.gpuExecutionMs, null, "completion wait was called GPU time");
  owner.releaseClientFrame(reused.id);
  // Drop the producer's BO and its exported fd before any snapshot readback.
  owner.dropClientChannel("resident-producer");
  assert.deepEqual(
    first.readbackPixels(),
    firstPixels,
    "producer reuse/destruction changed old GPU snapshot",
  );
  assert.deepEqual(
    second.readbackPixels(),
    secondPixels,
    "GPU import changed orientation, alpha, or BGRA channels",
  );
  const opaque = secondPixels.slice();
  for (let pixel = 3; pixel < opaque.length; pixel += 4) opaque[pixel] = 255;
  assert.deepEqual(xrgb.readbackPixels(), opaque, "XRGB snapshot did not force opaque alpha");

  assert.equal(
    owner.getTransferMetrics().gpuReadback!.count - productionEnd.gpuReadback!.count,
    3,
    "explicit diagnostic reads were not counted separately from production",
  );
  console.log(
    `[sys/egl-resident/production] ${JSON.stringify({
      imports: productionEnd.dmabufImport!.count - productionStart.dmabufImport!.count,
      gpuCopies: productionEnd.gpuCopy!.count - productionStart.gpuCopy!.count,
      gpuCopyBytes: productionEnd.gpuCopy!.bytes - productionStart.gpuCopy!.bytes,
      textureUploadBytes: 0,
      cpuCopyBytes: 0,
      gpuReadbackBytes: 0,
      completionWaitCpuElapsedMs:
        productionEnd.completionWait!.cpuElapsedMs - productionStart.completionWait!.cpuElapsedMs,
      gpuExecutionMs: null,
    })}`,
  );
  const renderResident = (image: EglResidentImage) => {
    const scene = {
      width,
      height,
      clearColor: 0,
      layers: [
        {
          id: "resident",
          pixels: image,
          sourceWidth: width,
          sourceHeight: height,
          sourceStride: width * 4,
          revision: 1,
          destination: { x: 0, y: 0, width, height },
          sampling: "nearest" as const,
        },
      ],
    };
    const target = new Uint8Array(width * height * 4);
    const damage = owner.beginComposition(scene);
    owner.renderOutput({
      id: "resident-output",
      x: 0,
      y: 0,
      width,
      height,
      targetWidth: width,
      targetHeight: height,
      targetPitch: width * 4,
      target,
    });
    return { target, damage, scene };
  };
  assert.deepEqual(
    renderResident(first).target,
    firstPixels,
    "resident layer sampled through wrong channel convention",
  );
  const replacement = renderResident(second);
  assert.ok(
    replacement.damage,
    "new resident identity with same revision did not invalidate damage",
  );
  assert.deepEqual(replacement.target, secondPixels);
  assert.equal(
    owner.beginComposition(replacement.scene),
    null,
    "immutable resident unnecessarily invalidated scene",
  );
  // Lazy readback must not disturb an already-composed cached scene.
  first.readbackPixels();
  assert.deepEqual(
    renderResident(second).target,
    secondPixels,
    "diagnostic readback corrupted retained GL state",
  );
  first.destroy();
  first.destroy();
  assert.throws(() => first.readbackPixels(), /destroyed/);
  assert.throws(() => renderResident(first), /destroyed/);
  owner.destroy();
  assert.equal(second.isDestroyed, true, "scaler leaked an owned resident image");
  assert.throws(() => second.readbackPixels(), /destroyed/);
  console.log(
    `[sys/egl-resident] native producer reuse/drop, 97x33 BGRA/alpha/XRGB, retained identity/state and owned lifetimes passed (${owner.info.glRenderer})`,
  );
} finally {
  for (const image of images) image.destroy();
  scaler?.destroy();
  closeFd(fd);
}
