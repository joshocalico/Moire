import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectHits } from "@moire/react-host";
import { installUiFonts, tickMotionFrame } from "@moire/ui";
import { BOOT_SOURCE_BYTES, loadBootArtwork, boundedBootViewport, packBootScanout } from "./assets";
import { generateBootArtwork } from "./generate-assets";
import { createBootRoot } from "./view";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-boot-react-"));
const texture = path.join(fixture, "fold.rgba");
try {
  const rows = { width: 2, height: 2, pixels: Uint8Array.from({ length: 16 }, (_, i) => i + 1) };
  assert.strictEqual(packBootScanout(rows, 8), rows.pixels);
  assert.deepEqual(
    [...packBootScanout(rows, 12)],
    [1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0, 9, 10, 11, 12, 13, 14, 15, 16, 0, 0, 0, 0],
  );
  assert.throws(() => packBootScanout(rows, 4), /pitch/);
  generateBootArtwork(texture);
  assert.equal(fs.statSync(texture).size, BOOT_SOURCE_BYTES);
  const source = loadBootArtwork(texture);
  await installUiFonts();
  assert.equal(source.image.width, 1280);
  assert.equal(source.image.height, 800);
  assert.throws(() => loadBootArtwork(path.join(fixture, "absent")), /ENOENT/);
  const short = path.join(fixture, "short.rgba");
  fs.writeFileSync(short, new Uint8Array(4));
  assert.throws(() => loadBootArtwork(short), /exactly/);
  for (const [width, height] of [
    [0, 800],
    [1921, 800],
    [1280, 1201],
    [1.5, 2],
    [NaN, 800],
  ])
    assert.throws(() => boundedBootViewport(width!, height!), /viewport/);

  for (const [width, height] of [
    [1280, 800],
    [640, 400],
    [400, 640],
    [1920, 1200],
  ]) {
    assert.ok(width && height);
    const root = createBootRoot(width, height, source);
    const frame = root.softwareFrame();
    assert.equal(frame.pixels.byteLength, width * height * 4);
    assert.equal(
      collectHits(root.root.container).length,
      0,
      "decorative boot artwork does not intercept input",
    );
    let art = 0;
    let wordmark = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const at = (y * width + x) * 4;
        const r = frame.pixels[at + 2]!;
        const g = frame.pixels[at + 1]!;
        const b = frame.pixels[at]!;
        assert.equal(frame.pixels[at + 3], 255, "actual own React root must cover its viewport");
        if (x > width / 2 && r + g + b > 100) art++;
        if (
          x >= width * 0.12 &&
          x < width * 0.33 &&
          y >= height * 0.29 &&
          y < height * 0.41 &&
          r > 180 &&
          g > 160 &&
          b > 140
        )
          wordmark++;
      }
    }
    assert.ok(art > width * height * 0.01, "shared Fold must produce visible art");
    assert.ok(wordmark > 20, "shared BrandMark must paint the serif wordmark");
    const initial = root.retainedFrame();
    const repeated = root.retainedFrame();
    assert.equal(initial.layers.length, repeated.layers.length);
    for (const [index, layer] of initial.layers.entries()) {
      assert.strictEqual(
        repeated.layers[index]?.pixels,
        layer.pixels,
        "static retained texture identity must be stable",
      );
      assert.equal(repeated.layers[index]?.revision, layer.revision);
    }
    assert.equal(root.motionActivity().active, false, "software boot fallback must stay static");
    tickMotionFrame(5);
    assert.equal(root.motionActivity().active, false);
    root.close();
    root.close();
    assert.equal(root.root.container.children.length, 0);
    assert.throws(() => root.softwareFrame(), /closed/);
    assert.strictEqual(root.source?.image.rgba, source.image.rgba);
    console.log(
      `[boot/react] ${width}x${height} actual shared artwork and wordmark: ${art} art pixels, ${wordmark} wordmark pixels; stable static root passed`,
    );
  }
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
