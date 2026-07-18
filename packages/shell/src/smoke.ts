import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import {
  createShellRoot,
  rasterize,
  renderShell,
  type SceneNode,
} from "@moire/react-host";
import { Panel } from "./Panel.js";
import { Launcher } from "./Launcher.js";
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

const launcherRoot = createShellRoot();
renderShell(
  launcherRoot,
  React.createElement(Launcher, {
    open: true,
    screenW: width,
    screenH: height,
    apps: Array.from({ length: 20 }, (_, index) => ({
      id: `icon-smoke-${index}.desktop`,
      name: `Icon Smoke ${index}`,
      exec: "true",
      icon: path.resolve(process.cwd(), "../ui/icons/app.png"),
      terminal: false,
      categories: [],
    })),
    query: "",
    selected: 0,
    onQueryChange: () => {},
    onLaunch: () => {},
    onDismiss: () => {},
    onSelect: () => {},
  }),
);
const containsImage = (node: SceneNode): boolean =>
  node.kind === "image" || node.children.some(containsImage);
assert.equal(
  containsImage(launcherRoot.container),
  true,
  "launcher discarded the desktop entry icon",
);
const launcherPaint = rasterize(launcherRoot.container, width, height);
assert.equal(
  launcherPaint.hits.some((hit) => !!hit.onWheel),
  true,
  "launcher did not expose a wheel target for the full application list",
);
const searchHit = launcherPaint.hits
  .filter(
    (hit) =>
      40 >= hit.x &&
      170 >= hit.y &&
      40 < hit.x + hit.width &&
      170 < hit.y + hit.height &&
      (!!hit.onPress || !!hit.focusable),
  )
  .at(-1);
assert.equal(
  searchHit?.focusable,
  true,
  "launcher search click would fall through to the dismiss backdrop",
);

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
  const simulatedWindow = 0xff5a6b7c;
  framebuffer.fill(simulatedWindow);
  shell.paintDesktop(framebuffer, width, width, height);
  assert.equal(
    framebuffer[352 * width + 730],
    simulatedWindow,
    "desktop menu leaked into the below-window desktop pass",
  );
  shell.paint(framebuffer, width, width, height);
  assert.notEqual(
    framebuffer[352 * width + 730],
    simulatedWindow,
    "desktop menu was not painted in the top shell pass",
  );
  const outside = framebuffer[100 * width + 100]!;
  assert.ok(
    ((outside >>> 16) & 0xff) > 40 &&
      ((outside >>> 8) & 0xff) > 40 &&
      (outside & 0xff) > 40,
    "transparent dismiss layer blacked out the underlying desktop",
  );
  assert.equal(
    shell.onPointerMotion?.({ x: 730, y: 352 }),
    true,
    "open menu did not capture pointer motion for row feedback",
  );
  shell.onPointerButton({
    timeMs: 2,
    button: 272,
    value: 1,
    x: 730,
    y: 352,
  });
  const releaseConsumed = shell.onPointerButton({
    timeMs: 3,
    button: 272,
    value: 0,
    x: 730,
    y: 352,
  });
  assert.equal(releaseConsumed, true, "menu release clicked through its overlay");
  for (let frame = 0; frame < 16; frame++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    shell.needsRepaint();
    framebuffer.fill(simulatedWindow);
    shell.paint(framebuffer, width, width, height);
  }
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
