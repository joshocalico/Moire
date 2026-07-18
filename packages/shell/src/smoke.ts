import assert from "node:assert/strict";
import React from "react";
import {
  createShellRoot,
  rasterize,
  renderShell,
} from "@moire/react-host";
import { Panel } from "./Panel.js";

const width = 1024;
const height = 768;
const root = createShellRoot();
renderShell(
  root,
  React.createElement(Panel, {
    screenW: width,
    screenH: height,
    clock: "10:20",
  }),
);
const out = rasterize(root.container, width, height);
let nonzero = 0;
for (const pixel of new Uint32Array(out.pixels.buffer)) {
  if ((pixel >>> 24) !== 0) nonzero++;
}

assert.equal(root.container.children.length, 1, "panel scene did not mount");
assert.ok(nonzero >= width * 40, "panel scene rendered transparent");
assert.ok(out.hits.length >= 1, "panel lost its launcher hit region");
console.log("[shell/smoke] ok");
