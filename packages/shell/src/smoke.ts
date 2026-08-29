import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { createShellRoot, rasterize, renderShell, type SceneNode } from "@moire/react-host";
import { Panel } from "./Panel";
import { Launcher } from "./Launcher";
import { createShell } from "./controller";
import { loadDesktopLayout } from "./DesktopIcons";

const width = 1024;
const height = 768;
const root = createShellRoot();
let taskPresses = 0;
renderShell(
  root,
  React.createElement(Panel, {
    screenW: width,
    screenH: height,
    clock: "10:20",
    tasks: [
      {
        clientId: 1,
        surfaceId: 7,
        title: "Files",
        appId: "org.moire.Files",
        focused: true,
        minimized: false,
      },
    ],
    onTaskPress: () => {
      taskPresses++;
    },
  }),
);
const out = rasterize(root.container, width, height);
let nonzero = 0;
for (const pixel of new Uint32Array(out.pixels.buffer)) {
  if (pixel >>> 24 !== 0) nonzero++;
}

assert.equal(root.container.children.length, 1, "panel scene did not mount");
assert.ok(nonzero >= width * 40, "panel scene rendered transparent");
assert.ok(out.hits.length >= 1, "panel lost its launcher hit region");
const taskHit = out.hits
  .filter(
    (hit) =>
      210 >= hit.x &&
      740 >= hit.y &&
      210 < hit.x + hit.width &&
      740 < hit.y + hit.height &&
      !!hit.onPress,
  )
  .at(-1);
assert.ok(taskHit?.onPress, "panel task did not expose a press target");
taskHit.onPress({ x: 210, y: 740, localX: 14, localY: 12 });
assert.equal(taskPresses, 1, "panel task did not emit its activation intent");

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
  fs.mkdirSync(path.join(smokeHome, "Desktop"), { recursive: true });
  fs.writeFileSync(path.join(smokeHome, "Desktop", "Alpha.txt"), "alpha\n");
  fs.writeFileSync(path.join(smokeHome, "Desktop", "Beta.txt"), "beta\n");
  const shell = createShell(() => ({ unref() {} }));
  const framebuffer = new Uint32Array(width * height);
  shell.setPrimaryOutput({ x: width / 2, y: 0, width: width / 2, height });
  shell.paint(framebuffer, width, width, height);
  assert.equal(
    framebuffer[(height - 8) * width + 100],
    0,
    "panel painted outside the primary output",
  );
  assert.notEqual(
    framebuffer[(height - 8) * width + width - 100],
    0,
    "panel did not follow the primary output",
  );
  shell.setPrimaryOutput({ x: 0, y: 0, width, height });
  framebuffer.fill(0);
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
    ((outside >>> 16) & 0xff) > 40 && ((outside >>> 8) & 0xff) > 40 && (outside & 0xff) > 40,
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

  framebuffer.fill(0);
  shell.paintDesktop(framebuffer, width, width, height);
  const clickDesktop = (x: number, y: number, timeMs: number) => {
    assert.equal(
      shell.onDesktopPointerButton?.({
        timeMs,
        button: 272,
        value: 1,
        x,
        y,
      }),
      true,
    );
    assert.equal(
      shell.onDesktopPointerButton?.({
        timeMs: timeMs + 1,
        button: 272,
        value: 0,
        x,
        y,
      }),
      true,
    );
  };
  clickDesktop(40, 40, 20);
  assert.equal(shell.onKey({ code: 29, value: 1 }), false);
  clickDesktop(40, 156, 22);
  assert.equal(shell.onKey({ code: 29, value: 0 }), false);

  shell.onDesktopPointerButton?.({
    timeMs: 24,
    button: 272,
    value: 1,
    x: 40,
    y: 40,
  });
  shell.onDesktopPointerMotion?.({ x: 100, y: 40 });
  const groupDrag = shell.desktopDragUri?.();
  assert.equal(groupDrag?.label, "2 items");
  assert.match(groupDrag?.uri ?? "", /Alpha\.txt/);
  assert.match(groupDrag?.uri ?? "", /Beta\.txt/);
  const dragFrameA = shell.dragRaster(100, 40, groupDrag?.label ?? "");
  const dragFrameB = shell.dragRaster(140, 70, groupDrag?.label ?? "");
  assert.ok(dragFrameA && dragFrameB, "desktop drag did not expose a retained layer");
  assert.equal(dragFrameB.x - dragFrameA.x, 40);
  assert.equal(dragFrameB.y - dragFrameA.y, 30);
  assert.equal(dragFrameA.pixels.byteLength, dragFrameA.width * dragFrameA.height * 4);
  shell.finishDesktopDrag?.(true, 200, 40);
  const movedLayout = loadDesktopLayout();
  assert.equal(movedLayout["Alpha.txt"]?.x, 188);
  assert.equal(movedLayout["Beta.txt"]?.x, 188);

  shell.onDesktopPointerButton?.({
    timeMs: 26,
    button: 272,
    value: 1,
    x: 200,
    y: 40,
  });
  shell.onDesktopPointerMotion?.({ x: 160, y: 40 });
  shell.finishDesktopDrag?.(true, 40, 272);
  assert.equal(fs.existsSync(path.join(smokeHome, "Desktop", "Alpha.txt")), false);
  assert.equal(fs.existsSync(path.join(smokeHome, "Desktop", "Beta.txt")), false);
  assert.equal(fs.existsSync(path.join(smokeHome, "Desktop", "New Folder", "Alpha.txt")), true);
  assert.equal(fs.existsSync(path.join(smokeHome, "Desktop", "New Folder", "Beta.txt")), true);

  const ssdWindow = {
    clientId: 9,
    surfaceId: 12,
    x: 100,
    y: 100,
    contentW: 400,
    contentH: 300,
    title: "A considered window title",
    focused: true,
    maximized: false,
  };
  framebuffer.fill(simulatedWindow);
  shell.beginSsdFrame();
  shell.paintSsdWindow(framebuffer, width, width, height, ssdWindow);
  assert.equal(framebuffer[100 * width + 100], simulatedWindow, "SSD top corner was not rounded");
  assert.notEqual(
    framebuffer[117 * width + 116],
    simulatedWindow,
    "SSD focus jewel was not painted",
  );

  const closeX = ssdWindow.x + ssdWindow.contentW - 6 - 28;
  const hoverSampleX = closeX + 3;
  const hoverSampleY = ssdWindow.y + 6;
  const idleControlPixel = framebuffer[hoverSampleY * width + hoverSampleX];
  assert.equal(
    shell.onSsdPointerMotion?.({
      x: closeX + 14,
      y: ssdWindow.y + 17,
      inside: true,
    }),
    true,
    "visible SSD did not capture hover",
  );
  for (let frame = 0; frame < 8; frame++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    shell.needsRepaint();
    framebuffer.fill(simulatedWindow);
    shell.beginSsdFrame();
    shell.paintSsdWindow(framebuffer, width, width, height, ssdWindow);
  }
  assert.notEqual(
    framebuffer[hoverSampleY * width + hoverSampleX],
    idleControlPixel,
    "SSD close control did not animate its hover feedback",
  );
  assert.deepEqual(
    shell.hitSsd(closeX + 14, ssdWindow.y + 17),
    { kind: "close", clientId: 9, surfaceId: 12 },
    "restyled SSD close control lost its action",
  );
  assert.equal(
    shell.onSsdPointerMotion?.({ x: 0, y: 0, inside: false }),
    false,
    "SSD hover remained active after leaving chrome",
  );
} finally {
  if (originalHome == null) delete process.env.HOME;
  else process.env.HOME = originalHome;
  delete process.env.XDG_CONFIG_HOME;
  fs.rmSync(smokeHome, { recursive: true, force: true });
}
console.log("[shell/smoke] ok");
