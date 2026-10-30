/**
 * Several windows of one application share a taskbar chip; any window can be closed from the
 * taskbar (a chip's window list, Delete there, or middle-click on a single-window chip).
 */
import assert from "node:assert/strict";
import React from "react";
import { createShellRoot, renderShell, rasterize, type SceneNode } from "@moire/react-host";
import { installUiFonts, tickAllMotions } from "@moire/ui";
import { createShell } from "./controller";
import { Panel, groupTasks, panelStatusGeometry, panelTaskRects, type TaskGroup } from "./Panel";
import type { TaskWindowAction, TaskWindowInfo } from "./ssd";

await installUiFonts();
const width = 1280;
const height = 800;
const window = (surfaceId: number, appId: string, title: string, focused = false) =>
  ({
    clientId: surfaceId,
    surfaceId,
    appId,
    title,
    focused,
    minimized: false,
  }) satisfies TaskWindowInfo;
const tasks = [
  window(1, "org.moire.Terminal", "~/projects"),
  window(2, "org.moire.Files", "Documents", true),
  window(3, "org.moire.Terminal", "htop"),
  window(4, "org.moire.Terminal", "vim notes.md"),
];

// Grouping keeps first-appearance order, labels groups by application and counts windows.
const groups = groupTasks(tasks);
assert.deepEqual(
  groups.map((group) => [group.label, group.tasks.length]),
  [
    ["Terminal", 3],
    ["Documents", 1],
  ],
);

// The panel paints one chip per group, with a count on grouped chips.
const texts = (node: SceneNode): string[] => [
  ...(node.kind === "text" && node.text ? [node.text] : []),
  ...node.children.flatMap(texts),
];
const calls: string[] = [];
const root = createShellRoot();
renderShell(
  root,
  <Panel
    screenW={width}
    screenH={height}
    clock="14:20"
    tasks={tasks}
    onTaskPress={(task) => calls.push(`press:${task.surfaceId}`)}
    onTaskGroupPress={(_, group: TaskGroup) => calls.push(`group:${group.tasks.length}`)}
    onTaskMenu={(_, group: TaskGroup) => calls.push(`menu:${group.label}`)}
    onTaskClose={(task) => calls.push(`close:${task.surfaceId}`)}
  />,
);
tickAllMotions(1);
const frame = rasterize(root.container, width, height);
const painted = texts(root.container);
assert.ok(
  painted.includes("Terminal") && painted.includes("Documents"),
  "one chip per application",
);
assert.ok(painted.includes("3"), "a grouped chip shows its window count");
const geometry = panelStatusGeometry({ screenW: width, screenH: height, clock: "14:20", tasks });
const rects = panelTaskRects(geometry, groups.length);
assert.equal(rects.length, 2);
const chipHit = (index: number) => {
  const rect = rects[index]!;
  const x = geometry.panel.x + rect.x + rect.width / 2;
  const y = geometry.panel.y + rect.y + rect.height / 2;
  const hit = frame.hits
    .filter(
      (h) =>
        (h.onPress || h.onContextMenu) &&
        x >= h.x &&
        x < h.x + h.width &&
        y >= h.y &&
        y < h.y + h.height,
    )
    .at(-1);
  assert.ok(hit, `chip ${index} is pressable`);
  return { hit, x, y };
};
const event = (x: number, y: number, button: "left" | "right" | "middle") => ({
  x,
  y,
  localX: 4,
  localY: 4,
  button,
});
{
  const { hit, x, y } = chipHit(0);
  hit.onPress!(event(x, y, "left"));
  hit.onContextMenu!(event(x, y, "right"));
  hit.onContextMenu!(event(x, y, "middle"));
}
{
  const { hit, x, y } = chipHit(1);
  hit.onPress!(event(x, y, "left"));
  hit.onContextMenu!(event(x, y, "middle"));
}
assert.deepEqual(
  calls,
  ["group:3", "menu:Terminal", "press:2", "close:2"],
  "press, menu and close route per chip",
);
renderShell(root, null);

// Through the real shell: a group press lists its windows; Delete closes the selected one;
// middle-click closes a single-window chip.
const actions: TaskWindowAction[] = [];
const shell = createShell(
  () => ({ unref() {} }),
  (action) => actions.push(action),
);
shell.setPrimaryOutput({ x: 0, y: 0, width, height });
shell.setTasks?.(tasks);
const paint = () => {
  tickAllMotions(1);
  return shell.chromeRaster(width, height);
};
paint();
const click = (x: number, y: number, button = 0x110) => {
  for (const value of [1, 0]) shell.onPointerButton({ timeMs: value, button, value, x, y });
  paint();
};
const terminal = chipHit(0);
click(terminal.x, terminal.y);
const key = (code: number) => {
  for (const value of [1, 0]) shell.onKey({ code, value });
  paint();
};
key(111); // Delete on the auto-selected first window
assert.deepEqual(
  actions,
  [{ clientId: 1, surfaceId: 1, kind: "close" }],
  "Delete closes the selected window",
);
const files = chipHit(1);
click(files.x, files.y, 0x112);
assert.deepEqual(
  actions.at(-1),
  { clientId: 2, surfaceId: 2, kind: "close" },
  "middle-click closes a single window",
);
console.log("[shell/taskbar-groups] grouping, window list and taskbar close passed");
