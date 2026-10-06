import assert from "node:assert/strict";
import { EglOutputScaler, type EglResidentImage } from "./egl-output";
import { GbmDevice } from "./gbm";
import {
  closeFd,
  MAP_SHARED,
  mmap,
  munmap,
  nativeView,
  O_CLOEXEC,
  O_RDWR,
  openPath,
  PROT_READ,
} from "./libc";

// Keep immediate mmap for the CPU-backed llvmpipe publication regression.
// Other native buffers need a driver-mediated transfer before CPU access;
// GBM import/map exercises the same consumer path used by the compositor.
// Publication is asserted before any separate diagnostic owned readback.
// Run as root on a primary node for software allocators using CREATE_DUMB.
const node = process.env.MOIRE_RENDER_NODE ?? "/dev/dri/card0";
const fd = openPath(node, O_RDWR | O_CLOEXEC);
let scaler: EglOutputScaler | null = null;
let importer: GbmDevice | null = null;
const width = 1280;
const height = 800;
try {
  scaler = new EglOutputScaler(fd);
  if (scaler.execution !== "software") {
    const importFd = openPath(node, O_RDWR | O_CLOEXEC);
    try {
      importer = new GbmDevice(importFd, importFd);
    } catch (error) {
      closeFd(importFd);
      throw error;
    }
  }
  for (let index = 0; index < 60; index++) {
    const color = index % 2 === 0 ? 0xff193b7d : 0xffd79f21;
    const frame = scaler.renderClientComposition("publication", {
      width,
      height,
      clearColor: color,
      layers: [],
    });
    assert.ok(frame, "publication frame was not allocated");
    assert.ok(
      frame.format === 0x34325241 || frame.format === 0x34325258,
      "actual supported fourcc",
    );
    const length = frame.stride * height;
    const map = importer ? null : mmap(length, PROT_READ, MAP_SHARED, frame.fd, 0);
    try {
      const imported = importer?.mapImport({ ...frame, offset: 0 });
      if (importer) assert.ok(imported, "native buffer could not be imported and mapped");
      const snapshot = imported?.pixels ?? new Uint8Array(nativeView(map, length)).slice();
      const stride = imported?.stride ?? frame.stride;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const offset: number = y * stride + x * 4;
          const pixel: number =
            (snapshot[offset]! |
              (snapshot[offset + 1]! << 8) |
              (snapshot[offset + 2]! << 16) |
              (snapshot[offset + 3]! << 24)) >>>
            0;
          assert.equal(
            frame.format === 0x34325258 ? pixel & 0xffffff : pixel,
            frame.format === 0x34325258 ? color & 0xffffff : color,
            `unfinished frame ${index} at ${x},${y}`,
          );
        }
      }
      // Raw publication above cannot be rescued by this later readback oracle.
      if (index < 2 || index === 59) {
        const owned: EglResidentImage = scaler.snapshotDmabuf({
          width,
          height,
          format: frame.format,
          plane: { fd: frame.fd, offset: 0, stride: frame.stride, modifier: frame.modifier },
        });
        try {
          const pixels: Uint8Array = owned.readbackPixels();
          assert.equal(pixels.length, width * height * 4);
          for (let i = 0; i < pixels.length; i += 4)
            assert.deepEqual(
              Array.from(pixels.subarray(i, i + 4)),
              [color & 255, (color >>> 8) & 255, (color >>> 16) & 255, 255],
              "canonical BGRA opaque snapshot after publication assertion",
            );
        } finally {
          owned.destroy();
        }
      }
    } finally {
      if (map) munmap(map, length);
      importer?.releaseImport(frame.fd);
      scaler.releaseClientFrame(frame.id);
    }
  }
  console.log(
    `[sys/egl-publication-smoke] 60 format-aware complete raw frames via ${importer ? "independent-device GBM import/map" : "immediate mmap"} plus three canonical opaque BGRA checks (${scaler.info.glRenderer}); no hardware classification`,
  );
} finally {
  importer?.destroy();
  scaler?.destroy();
  closeFd(fd);
}
