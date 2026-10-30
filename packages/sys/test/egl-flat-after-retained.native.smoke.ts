/**
 * A flat frame after retained ones reaches the output on a real EGL context. The session's locked
 * frame is flat while the desktop is retained; r55 showed black because the flat upload went to
 * a texture that a retained frame had only pretended to size. Needs a render node: set
 * MOIRE_RENDER_NODE, or the first /dev/dri/renderD* is used. Without one (the Nix build sandbox)
 * this prints SKIP; an explicitly named node that fails is an error.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { closeFd, EglOutputScaler, O_CLOEXEC, O_RDWR, openPath } from "@moire/sys";

function renderNode(): string | null {
  if (process.env.MOIRE_RENDER_NODE) return process.env.MOIRE_RENDER_NODE;
  try {
    const node = fs.readdirSync("/dev/dri").find((name) => name.startsWith("renderD"));
    return node ? `/dev/dri/${node}` : null;
  } catch {
    return null;
  }
}

const explicit = !!process.env.MOIRE_RENDER_NODE;
const node = process.platform === "linux" ? renderNode() : null;
let fd = -1;
let scaler: EglOutputScaler | null = null;
if (node) {
  try {
    fd = openPath(node, O_RDWR | O_CLOEXEC);
    scaler = new EglOutputScaler(fd);
  } catch (error) {
    if (fd >= 0) closeFd(fd);
    fd = -1;
    if (explicit) throw error;
    console.log(`SKIP flat-after-retained EGL check: ${node} unusable (${String(error)})`);
  }
} else {
  console.log("SKIP flat-after-retained EGL check: Linux with a render node required");
}

function solid(width: number, height: number, rgba: readonly number[]): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(rgba, i);
  return pixels;
}
function readback(target: EglOutputScaler, width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  target.renderOutput({
    id: "flat-after-retained",
    x: 0,
    y: 0,
    width,
    height,
    targetWidth: width,
    targetHeight: height,
    targetPitch: width * 4,
    target: pixels,
  });
  return pixels;
}
function retained(target: EglOutputScaler, width: number, height: number, revision: number) {
  target.beginComposition({
    width,
    height,
    clearColor: 0,
    layers: [
      {
        id: "background",
        revision,
        pixels: new Uint8Array([10, 120, 40, 255]),
        sourceWidth: 1,
        sourceHeight: 1,
        sourceStride: 4,
        destination: { x: 0, y: 0, width, height },
      },
    ],
  });
}

if (scaler) {
  try {
    const width = 32;
    const height = 24;
    // The desktop: retained frames only, the flat texture never allocated.
    retained(scaler, width, height, 1);
    assert.deepEqual(readback(scaler, width, height), solid(width, height, [10, 120, 40, 255]));
    // The lock: a flat frame of the same size must show, not sample an empty texture.
    const locked = solid(width, height, [200, 30, 90, 255]);
    scaler.beginFrame(locked, width, height);
    assert.deepEqual(readback(scaler, width, height), locked, "flat frame after retained");
    // Unlock, a larger desktop, then a flat frame at the new size.
    retained(scaler, width * 2, height * 2, 2);
    readback(scaler, width * 2, height * 2);
    const larger = solid(width * 2, height * 2, [60, 70, 220, 255]);
    scaler.beginFrame(larger, width * 2, height * 2);
    assert.deepEqual(readback(scaler, width * 2, height * 2), larger, "flat after a resize");
    console.log(`[egl-flat-after-retained] PASS on ${node} (${scaler.info.glRenderer})`);
  } finally {
    scaler.destroy();
    closeFd(fd);
  }
}
