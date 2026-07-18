import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import {
  createShellRoot,
  rasterize,
  renderShell,
} from "@moire/react-host";
import { Panel } from "./Panel.js";
import { createShell } from "./controller.js";

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

const originalHome = process.env.HOME;
const smokeHome = fs.mkdtempSync(path.join(os.tmpdir(), "moire-shell-smoke-"));
try {
  process.env.HOME = smokeHome;
  process.env.XDG_CONFIG_HOME = path.join(smokeHome, ".config");
  const shell = createShell(() => ({ unref() {} }));
  const framebuffer = new Uint32Array(width * height);
  shell.paintDesktop(framebuffer, width, width, height);
  const opened = shell.onDesktopPointerButton?.({
    timeMs: 1,
    button: 273,
    value: 1,
    x: 700,
    y: 300,
  });
  assert.equal(opened, true, "empty desktop right-click was not consumed");
  shell.paintDesktop(framebuffer, width, width, height);
  shell.onDesktopPointerButton?.({
    timeMs: 2,
    button: 272,
    value: 1,
    x: 730,
    y: 352,
  });
  shell.onDesktopPointerButton?.({
    timeMs: 3,
    button: 272,
    value: 0,
    x: 730,
    y: 352,
  });
  assert.ok(
    fs.existsSync(path.join(smokeHome, "Desktop", "New Folder")),
    "desktop background New Folder action did not run",
  );
} finally {
  if (originalHome == null) delete process.env.HOME;
  else process.env.HOME = originalHome;
  delete process.env.XDG_CONFIG_HOME;
  fs.rmSync(smokeHome, { recursive: true, force: true });
}
console.log("[shell/smoke] ok");
