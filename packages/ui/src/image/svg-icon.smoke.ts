import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearSvgIconCache, loadSvgIconSync } from "./svg-icon";
import * as reference from "./svg-icon.reference";

// Every bundled symbolic icon at UI sizes (including the 28.8 px greeter brand)
// must rasterize byte-for-byte like the original per-sample implementation.
const icons = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../icons");
const sizes = [16, 20, 24, 28.8, 48, 64];
const colors = [0xffe4e7f1, 0x80336699];
let pairs = 0;
let referenceMs = 0;
let optimizedMs = 0;
for (const filename of fs.readdirSync(icons).sort()) {
  if (!filename.endsWith(".svg")) continue;
  const file = path.join(icons, filename);
  for (const color of colors) {
    for (const size of sizes) {
      let expected;
      let started = performance.now();
      try {
        expected = reference.loadSvgIconSync(file, size, color);
      } catch (error) {
        assert.throws(() => loadSvgIconSync(file, size, color), {
          message: (error as Error).message,
        });
        continue;
      }
      referenceMs += performance.now() - started;
      started = performance.now();
      const actual = loadSvgIconSync(file, size, color);
      optimizedMs += performance.now() - started;
      assert.equal(actual.width, expected.width, `${filename}@${size} width`);
      assert.equal(actual.height, expected.height, `${filename}@${size} height`);
      assert.ok(
        Buffer.from(actual.rgba).equals(Buffer.from(expected.rgba)),
        `${filename}@${size} color ${color.toString(16)} differs from the reference rasterizer`,
      );
      pairs++;
    }
  }
}
assert.ok(pairs >= 400, `expected every bundled icon to be compared, got ${pairs}`);

// Synthetic edges the bundled set lacks: negative/zero widths, degenerate and
// axis-aligned segments, and a filled, stroked polygon at odd sizes.
const synthetic = fs.mkdtempSync(path.join(os.tmpdir(), "moire-svg-icon-"));
try {
  const shapes = [
    `<polyline points="2,2 20,20 20,2" stroke-width="-2"/>`,
    `<polyline points="2,2 20,20 20,2" stroke-width="0"/>`,
    `<line x1="5" y1="5" x2="5" y2="5" stroke-width="3"/>`,
    `<polygon points="3,3 21,4 12,20" stroke-width="1.7" fill="currentColor"/>`,
    `<polyline points="0,12 24,12" stroke-width="2"/>`,
  ];
  for (const [index, shape] of shapes.entries()) {
    const file = path.join(synthetic, `${index}.svg`);
    fs.writeFileSync(
      file,
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">${shape}</svg>`,
    );
    for (const size of [7, 16, 24, 33, 48]) {
      const expected = reference.loadSvgIconSync(file, size, 0xffffffff);
      const actual = loadSvgIconSync(file, size, 0xffffffff);
      assert.ok(
        Buffer.from(actual.rgba).equals(Buffer.from(expected.rgba)),
        `synthetic ${shape}@${size} differs from the reference rasterizer`,
      );
      pairs++;
    }
  }
} finally {
  fs.rmSync(synthetic, { recursive: true, force: true });
}

// The greeter's first frame pays one uncached brand.svg rasterization.
const brand = path.join(icons, "brand.svg");
reference.clearSvgIconCache();
let started = performance.now();
reference.loadSvgIconSync(brand, 28.8, 0xffe4e7f1);
const brandReferenceMs = performance.now() - started;
clearSvgIconCache();
started = performance.now();
loadSvgIconSync(brand, 28.8, 0xffe4e7f1);
const brandOptimizedMs = performance.now() - started;

console.log(
  JSON.stringify({
    svgIconPixelIdentity: "ok",
    pairs,
    referenceMs: Math.round(referenceMs),
    optimizedMs: Math.round(optimizedMs),
    speedup: Number((referenceMs / optimizedMs).toFixed(1)),
    brandReferenceMs: Number(brandReferenceMs.toFixed(1)),
    brandOptimizedMs: Number(brandOptimizedMs.toFixed(1)),
  }),
);
