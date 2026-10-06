import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PNG } from "pngjs";
import { screenshotPng, writeScreenshot } from "./capture";
const bgra = new Uint8Array([0, 0, 255, 255, 255, 0, 0, 255, 0, 255, 0, 255, 255, 255, 255, 255]);
const frame = { width: 2, height: 2, pixels: bgra };
const decoded = PNG.sync.read(screenshotPng(frame));
assert.deepEqual(
  [...decoded.data],
  [255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255],
  "actual BGRA capture becomes upright RGBA PNG",
);
assert.throws(() => screenshotPng({ ...frame, width: 3 }));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-capture-smoke-"));
try {
  const file = await writeScreenshot(frame, directory);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(path.dirname(file))).mode & 0o777, 0o700);
  assert.deepEqual(PNG.sync.read(await fs.readFile(file)).data, decoded.data);
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
console.log("Compositor capture pixels, PNG colours and private capture lifetime passed");
