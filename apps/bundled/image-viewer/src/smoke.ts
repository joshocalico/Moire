import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runTool } from "@moire/app-tools";
import { withFixture } from "@moire/app-tools/testing";
import { decodeImage } from "./backend";
await withFixture(async (directory) => {
  const source = path.join(directory, "image #1.png");
  await runTool("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=64x32",
    "-frames:v",
    "1",
    "-update",
    "1",
    source,
  ]);
  const original = await fs.readFile(source);
  for (const [turns, width, height] of [
    [0, 64, 32],
    [1, 32, 64],
    [-1, 32, 64],
    [2, 64, 32],
  ]) {
    const preview = await decodeImage(pathToFileURL(source).href, turns);
    assert.equal(preview.width, width);
    assert.equal(preview.height, height);
    await preview.dispose();
    await assert.rejects(fs.stat(preview.file), { code: "ENOENT" });
  }
  assert.deepEqual(
    await fs.readFile(source),
    original,
    "rotation previews never rewrite the image",
  );
  const jpeg = path.join(directory, "photo.jpg");
  await runTool("ffmpeg", ["-v", "error", "-i", source, "-frames:v", "1", jpeg]);
  const decoded = await decodeImage(jpeg);
  assert.equal(decoded.width, 64);
  await decoded.dispose();
  const unsupported = path.join(directory, "unknown.svg");
  await fs.writeFile(unsupported, "<svg/>");
  await assert.rejects(decodeImage(unsupported), /Unsupported image format/);
  const corrupt = path.join(directory, "corrupt.png");
  await fs.writeFile(corrupt, "not an image");
  await assert.rejects(decodeImage(corrupt));
  console.log(
    "[image-viewer] real PNG/JPEG decoding, file URL, clockwise/counterclockwise rotation, cleanup, corrupt/unsupported formats passed",
  );
});
