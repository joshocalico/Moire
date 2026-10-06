/* eslint-disable import/no-relative-parent-imports -- Integration checks exercise real app trees without introducing a widget-library dependency on Files. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React, { useState } from "react";
import {
  createShellRoot,
  renderShell,
  collectHits,
  type SceneNode,
  type HitKeyEvent,
} from "@moire/react-host";
import { installUiFonts, TextField, Window, type ContextMenuAction } from "@moire/ui";
import { HeadlessPlatform } from "../src/platforms/headless/index";
import { FilesApp } from "../../../apps/bundled/files/src/main";

await installUiFonts();
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-ui-"));
const previousHome = process.env.HOME,
  previousConfig = process.env.XDG_CONFIG_HOME;
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, ".config");
const source = path.join(fixture, "source"),
  destination = path.join(fixture, "destination");
await fs.mkdir(source);
await fs.mkdir(destination);
await fs.writeFile(path.join(source, "note.md"), "Real document preview");
const root = createShellRoot();
let actions: ContextMenuAction[] = [];
const tree = (
  <FilesApp
    width={1020}
    height={600}
    initialPath={source}
    onQuit={() => {}}
    onShowContextMenu={(request) => {
      actions = request.actions;
      return true;
    }}
  />
);
const refresh = () => renderShell(root, tree);
const texts = (node: SceneNode): string[] => [
  ...(node.kind === "text" ? [node.text ?? ""] : []),
  ...node.children.flatMap(texts),
];
const wait = async (condition: () => boolean) => {
  for (let attempt = 0; attempt < 200 && !condition(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    refresh();
  }
  assert.ok(condition(), texts(root.container).join(" | "));
};
const key: HitKeyEvent = {
  code: 30,
  key: "a",
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
};
function button(label: string) {
  const visit = (node: SceneNode, x = 0, y = 0): { x: number; y: number } | null => {
    x += node.x;
    y += node.y;
    if (node.kind === "text" && node.text === label) return { x, y };
    for (const child of node.children) {
      const match = visit(child, x, y);
      if (match) return match;
    }
    return null;
  };
  const position = visit(root.container);
  assert.ok(position, `Missing button ${label}`);
  const hit = collectHits(root.container).find(
    (hit) =>
      hit.focusable &&
      hit.onPress &&
      position.x >= hit.x &&
      position.x < hit.x + hit.width &&
      position.y >= hit.y &&
      position.y < hit.y + hit.height,
  );
  assert.ok(hit?.onPress, `No active button ${label}`);
  hit.onPress({ x: hit.x + 2, y: hit.y + 2, localX: 2, localY: 2 });
  refresh();
}
try {
  refresh();
  await wait(() => texts(root.container).includes("1 item"));
  const backgroundMenu = () => {
    const background = collectHits(root.container).find(
      (hit) => !hit.focusable && hit.onContextMenu,
    );
    assert.ok(background?.onContextMenu);
    background.onContextMenu({ x: background.x + 2, y: background.y + 2, localX: 2, localY: 2 });
    refresh();
  };
  backgroundMenu();
  for (const id of ["new-folder", "new-file", "paste", "undo", "sort-name", "sort-modified"])
    assert.ok(
      actions.some((action) => action.id === id),
      `Folder menu must retain ${id}`,
    );
  assert.equal(actions.find((action) => action.id === "paste")?.disabled, true);
  assert.equal(actions.find((action) => action.id === "undo")?.disabled, true);
  for (const id of ["copy", "cut", "rename", "trash"])
    assert.ok(!actions.some((action) => action.id === id), `Folder background has no ${id} target`);
  const file = collectHits(root.container).find(
    (hit) => hit.focusId === `file:${path.join(source, "note.md")}`,
  );
  assert.ok(file?.onPress);
  file.onPress({ x: file.x + 2, y: file.y + 2, localX: 2, localY: 2 });
  refresh();
  const item = collectHits(root.container).find((hit) => hit.focusId === file.focusId);
  assert.ok(item?.onContextMenu);
  item.onContextMenu({ x: item.x + 2, y: item.y + 2, localX: 2, localY: 2 });
  for (const id of ["copy", "cut", "rename", "trash", "copy-to", "move-to", "inspect"]) {
    const action = actions.find((action) => action.id === id);
    assert.ok(action, `Single-item menu must contain ${id}`);
    assert.equal(action.disabled ?? false, false, `Single-item menu must offer ${id}`);
  }
  actions.find((action) => action.id === "copy")?.onPress();
  refresh();
  backgroundMenu();
  assert.equal(
    actions.find((action) => action.id === "paste")?.disabled,
    false,
    "Copying an item enables Paste in the folder menu",
  );
  collectHits(root.container)
    .find((hit) => hit.focusId === file.focusId)
    ?.onPress?.({
      x: file.x + 2,
      y: file.y + 2,
      localX: 2,
      localY: 2,
    });
  refresh();
  await wait(() => texts(root.container).includes("Real document preview"));
  assert.ok(texts(root.container).includes("Permissions"));
  const fields = collectHits(root.container).filter((hit) =>
    hit.focusId?.startsWith("text-field:"),
  );
  const tagField = fields[fields.length - 1];
  assert.ok(tagField?.onKeyDown);
  tagField.onFocusChange?.(true);
  refresh();
  collectHits(root.container)
    .find((hit) => hit.focusId === tagField.focusId)
    ?.onKeyDown?.({ ...key, text: "work, ideas" });
  refresh();
  button("Add tags");
  await wait(() => texts(root.container).includes("work · 1"));
  const stored = JSON.parse(
    await fs.readFile(path.join(fixture, ".config/moire/files-tags.json"), "utf8"),
  );
  assert.deepEqual(stored.records[0].tags, ["work", "ideas"]);
  button("Organise selection…");
  actions.find((action) => action.id === "copy-to")?.onPress?.();
  refresh();
  const location = collectHits(root.container).find(
    (hit) => hit.autoFocus && hit.focusId?.startsWith("text-field:"),
  );
  assert.ok(location?.onKeyDown);
  location.onFocusChange?.(true);
  refresh();
  collectHits(root.container)
    .find((hit) => hit.focusId === location.focusId)
    ?.onKeyDown?.({ ...key, text: destination });
  refresh();
  button("Copy here");
  await wait(() => texts(root.container).includes("Copying files · Complete"));
  assert.equal(
    await fs.readFile(path.join(destination, "note.md"), "utf8"),
    "Real document preview",
  );
  button("Done");
  button("Organise selection…");
  actions.find((action) => action.id === "copy-to")?.onPress?.();
  refresh();
  const nextLocation = collectHits(root.container).find(
    (hit) => hit.autoFocus && hit.focusId?.startsWith("text-field:"),
  );
  assert.ok(nextLocation?.onKeyDown);
  nextLocation.onFocusChange?.(true);
  refresh();
  collectHits(root.container)
    .find((hit) => hit.focusId === nextLocation.focusId)
    ?.onKeyDown?.({ ...key, text: destination });
  refresh();
  button("Copy here");
  await wait(() => texts(root.container).includes("An item with this name already exists"));
  button("Keep both");
  await wait(() => texts(root.container).includes("Copying files · Complete"));
  assert.equal(
    await fs.readFile(path.join(destination, "note (2).md"), "utf8"),
    "Real document preview",
  );
  button("Done");
  assert.ok(texts(root.container).includes("work · 3"));
  console.log(
    "[files/ui] actual inspector metadata/preview, persistent tags, organisation dialog, transfer completion, keep-both and repeated flow passed",
  );
  renderShell(root, null);
  const liveBackend = new HeadlessPlatform();
  await liveBackend.connect();
  const liveWindow = new Window({ title: "Files path input", width: 1020, height: 600 });
  liveWindow.setContent((size) => (
    <FilesApp
      {...size}
      initialPath={source}
      onQuit={() => {}}
      onShowContextMenu={(request) => {
        actions = request.actions;
        return true;
      }}
    />
  ));
  liveWindow.mount(liveBackend);
  await Promise.resolve();
  liveWindow.tick();
  await new Promise((resolve) => setTimeout(resolve, 30));
  liveWindow.tick();
  const liveNative = liveBackend.getWindows()[0]!;
  const send = (code: number, key: string, text?: string, ctrl = false, shift = false) => {
    liveNative.injectKey({
      type: "down",
      code,
      key,
      text,
      modifiers: { ctrl, shift, alt: false, meta: false },
      timeMs: Date.now(),
    });
    liveNative.injectKey({
      type: "up",
      code,
      key,
      modifiers: { ctrl, shift, alt: false, meta: false },
      timeMs: Date.now(),
    });
    liveWindow.tick();
  };
  send(38, "l", undefined, true);
  liveWindow.tick();
  send(30, "a", undefined, true);
  for (const character of destination) send(20, character, character);
  send(28, "Enter");
  await new Promise((resolve) => setTimeout(resolve, 30));
  liveWindow.tick();
  send(49, "n", undefined, true, true);
  liveWindow.tick();
  for (const character of "Created through Files") send(20, character, character);
  send(28, "Enter");
  await new Promise((resolve) => setTimeout(resolve, 80));
  liveWindow.tick();
  assert.equal(
    (await fs.stat(path.join(destination, "Created through Files"))).isDirectory(),
    true,
    "real Window location editing and named creation must affect the requested folder",
  );
  send(38, "l", undefined, true);
  for (const character of source) send(20, character, character);
  send(28, "Enter");
  await new Promise((resolve) => setTimeout(resolve, 50));
  liveWindow.tick();
  send(68, "F10", undefined, false, true);
  assert.ok(
    actions.some((action) => action.id === "new-file"),
    "Shift+F10 opens folder actions",
  );
  send(30, "a", undefined, true);
  send(139, "ContextMenu");
  assert.equal(
    actions.find((action) => action.id === "rename")?.disabled,
    false,
    "Menu key opens actions for the single selection",
  );
  await fs.writeFile(path.join(source, "second.txt"), "Another disposable item");
  send(63, "F5");
  await new Promise((resolve) => setTimeout(resolve, 50));
  liveWindow.tick();
  send(30, "a", undefined, true);
  send(68, "F10", undefined, false, true);
  assert.equal(
    actions.find((action) => action.id === "rename")?.disabled,
    true,
    "Multiple selection disables single-item Rename",
  );
  assert.equal(
    actions.find((action) => action.id === "copy")?.disabled,
    false,
    "Multiple selection retains Copy",
  );
  console.log(
    "[files/ui] file/folder menus, Paste availability and keyboard context selection passed",
  );
  liveWindow.destroy();
  liveBackend.disconnect();
} finally {
  renderShell(root, null);
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousConfig === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = previousConfig;
  await fs.rm(fixture, { recursive: true, force: true });
}

// Exercise editing through the real Window input dispatcher, including modal
// focus acquisition, rather than directly invoking TextField's key callback.
const backend = new HeadlessPlatform();
await backend.connect();
let edited = "original.txt";
function Editor() {
  const [value, setValue] = useState(edited);
  return (
    <TextField
      width={240}
      value={value}
      autoFocus
      selectAllOnFocus
      onChange={(value) => {
        edited = value;
        setValue(value);
      }}
    />
  );
}
const window = new Window({ title: "Name editor", width: 260, height: 80 });
window.setContent(<Editor />);
window.mount(backend);
await Promise.resolve();
window.tick();
const native = backend.getWindows()[0]!;
native.injectKey({
  type: "down",
  code: 30,
  key: "a",
  text: "a",
  modifiers: { ctrl: false, shift: false, alt: false, meta: false },
  timeMs: 1,
});
assert.equal(edited, "a", "typing replaces the initially selected name");
native.injectKey({
  type: "down",
  code: 30,
  key: "a",
  modifiers: { ctrl: true, shift: false, alt: false, meta: false },
  timeMs: 2,
});
native.injectKey({
  type: "down",
  code: 48,
  key: "b",
  text: "b",
  modifiers: { ctrl: false, shift: false, alt: false, meta: false },
  timeMs: 3,
});
assert.equal(edited, "b", "Ctrl+A selects text without activating file commands");
for (let index = 0; index < 120; index++) {
  native.injectKey({
    type: "down",
    code: 30,
    key: "a",
    text: "a",
    modifiers: { ctrl: false, shift: false, alt: false, meta: false },
    timeMs: 4 + index,
  });
  native.injectKey({
    type: "up",
    code: 30,
    key: "a",
    modifiers: { ctrl: false, shift: false, alt: false, meta: false },
    timeMs: 4 + index,
  });
}
assert.equal(
  edited,
  "b" + "a".repeat(120),
  "a batched input burst must not drop characters or exhaust React update depth",
);
window.destroy();
backend.disconnect();
console.log("[files/ui] real Window name focus and Ctrl+A replacement passed");
