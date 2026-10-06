import assert from "node:assert/strict";
import { createElement } from "react";
import {
  Rect,
  createShellRoot,
  renderShell,
  RetainedSceneRenderer,
  RetainedSoftwareRenderer,
  SoftwareRenderer,
  type RetainedSceneFrame,
} from "@moire/react-host";

const retainedRoot = createShellRoot();
const retainedScene = new RetainedSceneRenderer();
const retainedSoftware = new RetainedSoftwareRenderer();
const cases = [
  { width: 12, height: 8, rectWidth: 12, fill: 0xff112233 },
  { width: 12, height: 8, rectWidth: 6, fill: 0xff112233 },
  { width: 12, height: 8, rectWidth: 0, fill: 0xff112233 },
  { width: 12, height: 8, rectWidth: 4, fill: 0x80335577 },
  { width: 12, height: 8, rectWidth: 12, fill: 0xff445566 },
  { width: 12, height: 8, rectWidth: 0, fill: 0 },
  { width: 7, height: 3, rectWidth: 7, fill: 0xff223344 },
  { width: 7, height: 3, rectWidth: 2, fill: 0xff223344 },
];
try {
  for (const [index, fixture] of cases.entries()) {
    const content = fixture.rectWidth
      ? createElement(Rect, {
          width: fixture.rectWidth,
          height: fixture.height,
          fill: fixture.fill,
        })
      : null;
    renderShell(retainedRoot, content);
    const viewport = { width: fixture.width, height: fixture.height };
    const scene = retainedScene.render(retainedRoot.container, viewport);
    const actual = retainedSoftware.render(scene).pixels;
    const freshRoot = createShellRoot();
    try {
      renderShell(freshRoot, content);
      const fresh = new SoftwareRenderer().render(freshRoot.container, viewport).pixels;
      assert.deepEqual(actual, fresh, `retained frame ${index} matches independent fresh paint`);
      for (let y = 0; y < fixture.height; y++) {
        for (let x = fixture.rectWidth; x < fixture.width; x++) {
          assert.equal(actual[(y * fixture.width + x) * 4 + 3], 0, "uncovered pixels clear alpha");
        }
      }
    } finally {
      renderShell(freshRoot, null);
    }
  }
} finally {
  renderShell(retainedRoot, null);
}

// Damage clearing replaces straight clear color with premultiplied pixels;
// pixels outside damage survive and fractional alpha never accumulates.
const renderer = new RetainedSoftwareRenderer();
const full: RetainedSceneFrame = { width: 4, height: 2, clearColor: 0xff224466, layers: [] };
const initial = renderer.render(full).pixels.slice();
const partial = renderer.render({
  ...full,
  clearColor: 0,
  damage: [{ x: 0, y: 0, width: 1, height: 2 }],
}).pixels;
for (let y = 0; y < 2; y++) {
  assert.deepEqual(partial.slice(y * 16, y * 16 + 4), new Uint8Array(4));
  assert.deepEqual(partial.slice(y * 16 + 4, y * 16 + 16), initial.slice(y * 16 + 4, y * 16 + 16));
}
const translucent = { ...full, clearColor: 0x80ff8040 };
const once = renderer.render(translucent).pixels.slice();
assert.deepEqual(once.slice(0, 4), Uint8Array.from([32, 64, 128, 128]));
assert.deepEqual(
  renderer.render(translucent).pixels,
  once,
  "clear alpha replaces rather than accumulates",
);
assert.deepEqual(renderer.render({ ...full, clearColor: 0 }).pixels, new Uint8Array(32));
console.log(
  "[retained-alpha] eight actual React transitions match fresh paint; transparent/partial/premultiplied damage clear PASS",
);
