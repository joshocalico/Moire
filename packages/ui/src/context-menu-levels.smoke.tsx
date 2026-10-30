/** Context menus: sliding submenus, shortcut hints, disabled reasons, and presses that keep them open. */
import assert from "node:assert/strict";
import React from "react";
import type { HitRegion, SceneNode } from "@moire/react-host";
import {
  ContextMenu,
  contextMenuSurfaceSize,
  installUiFonts,
  Window,
  type ContextMenuAction,
} from "./index";
import { HeadlessPlatform } from "./platforms/headless/index";
import { tickMotionFrame } from "./motion";

await installUiFonts();
const modifiers = { shift: false, ctrl: false, alt: false, meta: false };
const backend = new HeadlessPlatform();
await backend.connect();
const window = new Window({ title: "Menu levels", width: 360, height: 420 });
const pressed: string[] = [];
let dismissals = 0;
const actions: ContextMenuAction[] = [
  { id: "open", label: "Open", shortcut: "Enter", onPress: () => pressed.push("open") },
  {
    id: "paste",
    label: "Paste",
    disabled: true,
    disabledReason: "Cut or copy items first",
    onPress: () => pressed.push("paste"),
  },
  {
    id: "sort",
    label: "Sort By",
    separatorBefore: true,
    submenu: [
      { id: "sort-name", label: "Name", checked: true, onPress: () => pressed.push("name") },
      { id: "sort-size", label: "Size", checked: false, onPress: () => pressed.push("size") },
    ],
  },
];
window.setContent(() => (
  <ContextMenu
    viewportWidth={360}
    viewportHeight={420}
    x={20}
    y={20}
    title="Folder"
    actions={actions}
    onDismiss={() => dismissals++}
  />
));
window.mount(backend);
const native = backend.getWindows()[0]!;
const settle = async () => {
  for (let frame = 0; frame < 60; frame++) {
    tickMotionFrame(1 / 60);
    window.requestRedraw();
    window.tick();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
};
const key = (code: number, name: string) => {
  native.injectKey({ type: "down", code, key: name, modifiers, timeMs: code });
  window.tick();
};
const internals = window as unknown as { root: { container: SceneNode }; hits: HitRegion[] };
const texts = () => {
  const found: string[] = [];
  const walk = (node: SceneNode) => {
    if (node.kind === "text" && node.text) found.push(node.text);
    node.children.forEach(walk);
  };
  walk(internals.root.container);
  return found;
};
const textCenter = (label: string) => {
  let at: { x: number; y: number } | null = null;
  const walk = (node: SceneNode, x: number, y: number) => {
    x += node.x;
    y += node.y;
    if (!at && node.kind === "text" && node.text === label)
      at = { x: x + node.width / 2, y: y + node.height / 2 };
    node.children.forEach((child) => walk(child, x, y));
  };
  walk(internals.root.container, 0, 0);
  assert.ok(at, `${label} is visible`);
  return at as { x: number; y: number };
};
await settle();
const visible = texts();
assert.ok(visible.includes("Enter"), "shortcut hints are painted");
assert.ok(visible.includes("Cut or copy items first"), "a disabled action says why");

// Pressing a disabled row (or anywhere on the menu surface) keeps the menu open.
const paste = textCenter("Paste");
native.injectPointer({ type: "down", button: "left", ...paste, modifiers, timeMs: 1 });
native.injectPointer({ type: "up", button: "left", ...paste, modifiers, timeMs: 2 });
await settle();
assert.equal(dismissals, 0, "a disabled row does not dismiss the menu");
assert.deepEqual(pressed, []);

// Arrow keys skip the disabled row; Right opens the submenu in place, Left returns.
key(108, "ArrowDown");
key(106, "ArrowRight");
await settle();
assert.ok(texts().includes("Size"), "the submenu replaces the level");
assert.ok(!texts().includes("Open"), "the parent level is hidden while the submenu shows");
assert.ok(texts().includes("Sort By"), "the submenu leads with a row back to its parent");
key(105, "ArrowLeft");
await settle();
assert.ok(texts().includes("Open"), "Left returns to the parent level");
key(106, "ArrowRight");
await settle();
key(108, "ArrowDown");
key(28, "Enter");
await settle();
assert.deepEqual(pressed, ["size"], "choosing a submenu entry runs it and closes the menu");
assert.equal(dismissals, 1);

const size = contextMenuSurfaceSize(
  [
    { id: "a", label: "A", onPress: () => {} },
    {
      id: "more",
      label: "More",
      submenu: Array.from({ length: 6 }, (_, index) => ({
        id: `m${index}`,
        label: `M${index}`,
        onPress: () => {},
      })),
    },
  ],
  "Title",
);
const flat = contextMenuSurfaceSize([{ id: "a", label: "A", onPress: () => {} }], "Title");
assert.ok(size.height > flat.height + 5 * 30, "a native popup is sized for its tallest submenu");
window.destroy();
backend.disconnect();
console.log(
  "[ui/context-menu-levels] submenus, shortcuts, disabled reasons and surface presses passed",
);
