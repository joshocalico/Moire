/** Owner runs explicitly on a permitted render node; never opens/modesets a KMS output. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { EglOutputScaler, type EglClientPresent, type EglCompositionScene } from "./egl-output";
import { openPath, closeFd, O_RDWR, O_CLOEXEC } from "./libc";
if (process.platform !== "linux" || !process.env.MOIRE_EGL_CAPABILITY_NODE) {
  console.log(
    "SKIP EGL native opacity/pool/transfer oracle: Linux and explicit MOIRE_EGL_CAPABILITY_NODE required; no hardware-positive claim",
  );
} else {
  const fd = openPath(process.env.MOIRE_EGL_CAPABILITY_NODE, O_RDWR | O_CLOEXEC);
  let scaler: EglOutputScaler | null = null;
  try {
    scaler = new EglOutputScaler(fd, { measureTransfers: true });
    const width = 16,
      height = 12;
    const opaque: EglCompositionScene = {
      width,
      height,
      clearColor: 0,
      layers: [
        {
          id: "solid-background",
          revision: 1,
          pixels: new Uint8Array([40, 30, 20, 255]),
          sourceWidth: 1,
          sourceHeight: 1,
          sourceStride: 4,
          destination: { x: 0, y: 0, width, height },
        },
      ],
    };
    const transparent: EglCompositionScene = { ...opaque, layers: [] };
    const draw = (scene = opaque): EglClientPresent => {
      const frame = scaler?.renderClientComposition("native-opacity", scene);
      assert.ok(
        frame,
        "actual client dma-buf allocation is required; unsupported allocation is not a passing native oracle",
      );
      return frame;
    };
    const a = draw(),
      b = draw();
    scaler.releaseClientFrame(a.id);
    const c = draw(transparent);
    assert.equal(a.format, 0x34325258);
    assert.equal(c.format, 0x34325241);
    const returned = draw();
    assert.equal(returned.id, a.id);
    scaler.releaseClientFrame(b.id);
    scaler.releaseClientFrame(returned.id);
    assert.equal(scaler.hasClientFrame(a.id), true);
    assert.equal(scaler.hasClientFrame(b.id), true);
    fs.fstatSync(a.fd);
    fs.fstatSync(b.fd);
    scaler.releaseClientFrame(c.id);
    assert.throws(() => fs.fstatSync(c.fd), { code: "EBADF" });
    const idleStart = scaler.getTransferMetrics();
    const fdStart = fs.readdirSync("/proc/self/fd").length;
    for (let tick = 0; tick < 100; tick++) {
      const frame = draw();
      assert.equal(frame.id, a.id);
      scaler.releaseClientFrame(frame.id);
    }
    const idleEnd = scaler.getTransferMetrics();
    assert.equal(fs.readdirSync("/proc/self/fd").length, fdStart);
    assert.equal(idleEnd.textureUpload?.count, idleStart.textureUpload?.count);
    assert.equal(idleEnd.gpuReadback?.count, idleStart.gpuReadback?.count);
    assert.equal(idleEnd.dmabufImport?.count, idleStart.dmabufImport?.count);
    assert.equal(idleEnd.cpuCopy?.count, idleStart.cpuCopy?.count);
    assert.equal(idleEnd.gpuCopy?.count, (idleStart.gpuCopy?.count ?? 0) + 100);
    const held = [draw(), draw(), draw()];
    const heldStart = scaler.getTransferMetrics();
    const heldFds = fs.readdirSync("/proc/self/fd").length;
    for (let nextWidth = 17; nextWidth < 117; nextWidth++)
      assert.equal(
        scaler.renderClientComposition("native-opacity", { ...opaque, width: nextWidth }),
        null,
      );
    assert.equal(scaler.getTransferMetrics().dmabufImport?.count, heldStart.dmabufImport?.count);
    assert.equal(fs.readdirSync("/proc/self/fd").length, heldFds);
    for (const frame of held) scaler.releaseClientFrame(frame.id);
    for (const frame of held) assert.throws(() => fs.fstatSync(frame.fd), { code: "EBADF" });
    const fresh = draw();
    assert.equal(fresh.format, 0x34325258);
    // Explicit validation readback is separate from the production draw-derived certificate.
    const oracle = scaler.renderClientCompositionReadback(opaque).pixels;
    for (let offset = 0; offset < oracle.length; offset += 4)
      assert.deepEqual(oracle.subarray(offset, offset + 4), new Uint8Array([40, 30, 20, 255]));
    const afterOracle = scaler.getTransferMetrics();
    assert.equal(afterOracle.gpuReadback?.count, (heldStart.gpuReadback?.count ?? 0) + 1);
    console.log(
      JSON.stringify({
        event: "egl-capability-native",
        execution: scaler.execution,
        info: scaler.info,
        idleFrames: 100,
        heldResizeAttempts: 100,
        idleStart,
        idleEnd,
        afterOracle,
        scope:
          "actual render-node EGL/GBM formats, native held-target ownership and counters; not scanout or hardware proof",
      }),
    );
    scaler.destroy();
    scaler.destroy();
    assert.throws(() => fs.fstatSync(fresh.fd), { code: "EBADF" });
  } finally {
    scaler?.destroy();
    closeFd(fd);
  }
}
