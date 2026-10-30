import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { createShellRoot, rasterize, renderShell, type SceneNode } from "@moire/react-host";
import { Panel, panelMaterials, panelStatusGeometry, panelTaskRects } from "./Panel";
import { Launcher } from "./Launcher";
import { createShell } from "./controller";
import { loadDesktopLayout } from "./desktop/layout";
import { TitleBar } from "./TitleBar";
import { tickAllMotions } from "@moire/ui";
import {
  getTheme,
  setTheme,
  applyThemeFamily,
  THEME_FAMILIES,
  windowControlLayout,
} from "@moire/theme";

const width = 1024;
const height = 768;
const root = createShellRoot();
let taskPresses = 0;
const panelTasks = [
  {
    clientId: 1,
    surfaceId: 7,
    title: "Files",
    appId: "org.moire.Files",
    focused: true,
    minimized: false,
  },
];
renderShell(
  root,
  <Panel
    screenW={width}
    screenH={height}
    clock="10:20"
    tasks={panelTasks}
    onTaskPress={() => {
      taskPresses++;
    }}
  />,
);
const panelLayout = panelStatusGeometry({
  screenW: width,
  screenH: height,
  clock: "10:20",
  tasks: panelTasks,
  taskCount: panelTasks.length,
});
const glassArea = panelMaterials(panelLayout, false).reduce(
  (sum, shape) => sum + shape.width * shape.height,
  0,
);
const taskRect = panelTaskRects(panelLayout, panelTasks.length)[0]!;
const taskPoint = {
  x: panelLayout.panel.x + taskRect.x + taskRect.width / 2,
  y: panelLayout.panel.y + taskRect.y + taskRect.height / 2,
};
const out = rasterize(root.container, width, height);
let nonzero = 0;
for (const pixel of new Uint32Array(out.pixels.buffer)) {
  if (pixel >>> 24 !== 0) nonzero++;
}

assert.equal(root.container.children.length, 1, "panel scene did not mount");
// Rounded island corners leave a little of each shape unpainted.
assert.ok(nonzero >= glassArea * 0.9, "panel scene rendered transparent");
assert.ok(out.hits.length >= 1, "panel lost its launcher hit region");
const taskHit = out.hits
  .filter(
    (hit) =>
      taskPoint.x >= hit.x &&
      taskPoint.y >= hit.y &&
      taskPoint.x < hit.x + hit.width &&
      taskPoint.y < hit.y + hit.height &&
      !!hit.onPress,
  )
  .at(-1);
assert.ok(taskHit?.onPress, "panel task did not expose a press target");
taskHit.onPress({ ...taskPoint, localX: 14, localY: 12 });
assert.equal(taskPresses, 1, "panel task did not emit its activation intent");

const launcherRoot = createShellRoot();
renderShell(
  launcherRoot,
  <Launcher
    open
    screenW={width}
    screenH={height}
    apps={Array.from({ length: 20 }, (_, index) => ({
      id: `icon-smoke-${index}.desktop`,
      name: `Icon Smoke ${index}`,
      exec: "true",
      icon: path.resolve(process.cwd(), "../ui/icons/app.png"),
      terminal: false,
      categories: [],
    }))}
    query=""
    selected={0}
    onQueryChange={() => {}}
    onLaunch={() => {}}
    onDismiss={() => {}}
    onSelect={() => {}}
  />,
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
  // The session file clipboard lives in the runtime directory; keep it in the fixture.
  process.env.XDG_RUNTIME_DIR = path.join(smokeHome, ".run");
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
  const desktopBeforeBackgroundClick = shell.desktopRaster(width, height);
  const chromeBeforeBackgroundClick = shell.chromeRaster(width, height);
  assert.ok(desktopBeforeBackgroundClick, "desktop retained layer was not created");
  assert.ok(chromeBeforeBackgroundClick, "chrome retained layer was not created");
  assert.notEqual(
    desktopBeforeBackgroundClick.pixels,
    chromeBeforeBackgroundClick.pixels,
    "desktop and chrome roots aliased the same raster backing store",
  );
  const desktopPixelsBeforeBackgroundClick = desktopBeforeBackgroundClick.pixels.slice();
  const chromePixelsBeforeBackgroundClick = chromeBeforeBackgroundClick.pixels.slice();
  assert.equal(
    shell.onDesktopPointerButton?.({
      timeMs: 0,
      button: 272,
      value: 1,
      x: 700,
      y: 300,
    }),
    true,
    "empty desktop left-click was not captured by its background surface",
  );
  assert.equal(
    shell.onDesktopPointerButton?.({
      timeMs: 1,
      button: 272,
      value: 0,
      x: 700,
      y: 300,
    }),
    true,
    "empty desktop left-click release was not captured",
  );
  const desktopAfterBackgroundClick = shell.desktopRaster(width, height);
  const chromeAfterBackgroundClick = shell.chromeRaster(width, height);
  assert.ok(
    desktopAfterBackgroundClick,
    "desktop retained layer vanished after a background click",
  );
  assert.ok(chromeAfterBackgroundClick, "chrome retained layer vanished after a background click");
  assert.deepEqual(
    desktopAfterBackgroundClick.pixels,
    desktopPixelsBeforeBackgroundClick,
    "background click changed an unselected desktop raster",
  );
  assert.deepEqual(
    chromeAfterBackgroundClick.pixels,
    chromePixelsBeforeBackgroundClick,
    "background click changed unrelated panel chrome",
  );
  const opened = shell.onDesktopPointerButton?.({
    timeMs: 2,
    button: 273,
    value: 1,
    x: 700,
    y: 200,
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
    shell.onPointerMotion?.({ x: 730, y: 252 }),
    true,
    "open menu did not capture pointer motion for row feedback",
  );
  shell.onPointerButton({
    timeMs: 2,
    button: 272,
    value: 1,
    x: 730,
    y: 252,
  });
  const releaseConsumed = shell.onPointerButton({
    timeMs: 3,
    button: 272,
    value: 0,
    x: 730,
    y: 252,
  });
  assert.equal(releaseConsumed, true, "menu release clicked through its overlay");
  // The menu runs its action once its closing motion ends.
  for (
    let frame = 0;
    frame < 60 && !fs.existsSync(path.join(smokeHome, "Desktop", "New Folder"));
    frame++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    shell.needsRepaint();
    framebuffer.fill(simulatedWindow);
    shell.paint(framebuffer, width, width, height);
    await shell.whenDesktopIdle?.();
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
  await shell.whenDesktopIdle?.();
  // Icons snap to grid cells: the group moved one column right, keeping its arrangement.
  const movedLayout = loadDesktopLayout();
  assert.deepEqual(movedLayout["Alpha.txt"], { col: 1, row: 0 });
  assert.deepEqual(movedLayout["Beta.txt"], { col: 1, row: 1 });

  // New Folder landed where the background menu was opened; drop the group onto it.
  const folderCell = movedLayout["New Folder"];
  assert.ok(folderCell, "the new folder was placed on the grid");
  const folderX = 28 + folderCell.col * 128 + 56;
  const folderY = 28 + folderCell.row * 116 + 50;
  shell.onDesktopPointerButton?.({
    timeMs: 26,
    button: 272,
    value: 1,
    x: 200,
    y: 40,
  });
  shell.onDesktopPointerMotion?.({ x: 160, y: 40 });
  shell.finishDesktopDrag?.(true, folderX, folderY);
  await shell.whenDesktopIdle?.();
  assert.equal(fs.existsSync(path.join(smokeHome, "Desktop", "Alpha.txt")), false);
  assert.equal(fs.existsSync(path.join(smokeHome, "Desktop", "Beta.txt")), false);
  assert.equal(fs.existsSync(path.join(smokeHome, "Desktop", "New Folder", "Alpha.txt")), true);
  assert.equal(fs.existsSync(path.join(smokeHome, "Desktop", "New Folder", "Beta.txt")), true);

  const applicationsDir = path.join(smokeHome, ".local", "share", "applications");
  fs.mkdirSync(applicationsDir, { recursive: true });
  for (let index = 0; index < 30; index++) {
    fs.writeFileSync(
      path.join(applicationsDir, `scroll-smoke-${index}.desktop`),
      `[Desktop Entry]\nType=Application\nName=Scroll Smoke ${index}\nExec=true\n`,
    );
  }
  const originalDataHome = process.env.XDG_DATA_HOME;
  const originalStartOpen = process.env.MOIRE_SHELL_START_OPEN;
  process.env.XDG_DATA_HOME = path.join(smokeHome, ".local", "share");
  process.env.MOIRE_SHELL_START_OPEN = "1";
  const launcherShell = createShell(() => ({ unref() {} }));
  launcherShell.setPrimaryOutput({ x: 0, y: 0, width, height });
  const launcherBefore = new Uint32Array(width * height);
  launcherShell.paint(launcherBefore, width, width, height);
  // Let the launcher's entrance settle before measuring its scroll.
  tickAllMotions(1);
  launcherShell.paint(launcherBefore, width, width, height);
  assert.equal(
    launcherShell.onPointerButton({ timeMs: 30, button: 272, value: 1, x: 410, y: 230 }),
    true,
    "launcher scroll thumb did not begin a pointer grab",
  );
  assert.equal(
    launcherShell.onPointerMotion?.({ x: 410, y: 490 }),
    true,
    "launcher scroll thumb did not retain its pointer grab",
  );
  const launcherDuringDrag = new Uint32Array(width * height);
  launcherShell.paint(launcherDuringDrag, width, width, height);
  assert.notDeepEqual(
    launcherDuringDrag,
    launcherBefore,
    "launcher content did not scroll until pointer release",
  );
  launcherShell.onPointerButton({ timeMs: 31, button: 272, value: 0, x: 410, y: 490 });
  if (originalDataHome == null) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalDataHome;
  if (originalStartOpen == null) delete process.env.MOIRE_SHELL_START_OPEN;
  else process.env.MOIRE_SHELL_START_OPEN = originalStartOpen;

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
  const otherWindow = { ...ssdWindow, clientId: 10, surfaceId: 12, x: 540, title: "Second window" };
  const otherCloseX = otherWindow.x + otherWindow.contentW - 6 - 28;
  shell.beginSsdFrame();
  shell.paintSsd(framebuffer, width, width, height, [ssdWindow]);
  shell.paintSsd(framebuffer, width, width, height, [otherWindow]);
  assert.deepEqual(
    shell.hitSsd(closeX + 14, ssdWindow.y + 17),
    { kind: "close", clientId: 9, surfaceId: 12 },
    "bulk stack-slot calls retain first window hits",
  );
  assert.deepEqual(
    shell.hitSsd(otherCloseX + 14, otherWindow.y + 17),
    { kind: "close", clientId: 10, surfaceId: 12 },
    "bulk stack-slot calls retain second window hits",
  );
  shell.beginSsdFrame();
  shell.paintSsd(framebuffer, width, width, height, [otherWindow]);
  assert.equal(
    shell.hitSsd(closeX + 14, ssdWindow.y + 17),
    null,
    "next frame clears stale bulk hits",
  );
} finally {
  if (originalHome == null) delete process.env.HOME;
  else process.env.HOME = originalHome;
  delete process.env.XDG_CONFIG_HOME;
  fs.rmSync(smokeHome, { recursive: true, force: true });
}
const originalTheme = getTheme();
try {
  for (const family of THEME_FAMILIES) {
    const theme = applyThemeFamily(originalTheme, family, true);
    setTheme(theme);
    let closed = false;
    const chrome = createShellRoot();
    renderShell(
      chrome,
      <TitleBar
        x={0}
        y={0}
        width={460}
        title="Files"
        onClose={() => {
          closed = true;
        }}
      />,
    );
    const frame = rasterize(chrome.container, 460, theme.tokens.titlebarHeight);
    const controls = windowControlLayout(460, family);
    const x = controls.closeX + 14;
    const y = Math.floor(theme.tokens.titlebarHeight / 2);
    const hit = frame.hits
      .filter(
        (item) =>
          item.onPress &&
          x >= item.x &&
          x < item.x + item.width &&
          y >= item.y &&
          y < item.y + item.height,
      )
      .at(-1);
    assert.ok(hit?.onPress, `${family} close control must have a hit region`);
    hit.onPress({ x, y, localX: 14, localY: 14 });
    assert.ok(closed, `${family} close control must emit its action`);
    if (family === "cupertino") {
      const pixels = new Uint32Array(frame.pixels.buffer);
      assert.equal(pixels[y * 460 + x], 0xffff6059, "Cupertino close light must be red");
      assert.equal(
        pixels[y * 460 + controls.minX + 14],
        0xffffbd2e,
        "Cupertino minimize light must be amber",
      );
      assert.equal(
        pixels[y * 460 + controls.maxX + 14],
        0xff28c840,
        "Cupertino maximize light must be green",
      );
    }
  }
} finally {
  setTheme(originalTheme);
}
console.log("[shell/smoke] ok");
