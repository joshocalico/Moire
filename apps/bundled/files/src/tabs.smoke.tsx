import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { installUiFonts, Window, type ContextMenuAction } from "@moire/ui";
import { flattenFileMenu } from "@moire/file-operations";
import { HeadlessPlatform, notifyDrop } from "@moire/ui/testing";
import type { SceneNode } from "@moire/react-host";
import { FilesApp } from "./main";

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-tabs-"));
const environment = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, ".config");
// The session file clipboard lives in the runtime directory; keep it in the fixture.
process.env.XDG_RUNTIME_DIR = path.join(fixture, ".run");
process.env.XDG_DATA_HOME = path.join(fixture, ".local", "share");
const backend = new HeadlessPlatform();
const window = new Window({
  title: "Files tab workflows",
  width: 1280,
  height: 760,
  decorated: false,
});
let title = "";
let busy = false;
let actions: ContextMenuAction[] = [];
try {
  await installUiFonts();
  const config = path.join(fixture, ".config", "moire");
  const source = path.join(fixture, "source");
  const folder = path.join(source, "Alpha");
  const big = path.join(fixture, "Big");
  await fs.mkdir(config, { recursive: true });
  await fs.mkdir(folder, { recursive: true });
  await fs.mkdir(big);
  await fs.writeFile(path.join(config, "files-view.json"), JSON.stringify({ view: "list" }));
  await fs.writeFile(path.join(source, "zeta.txt"), "Original");
  await fs.writeFile(path.join(folder, "beta.txt"), "Beta");
  await fs.writeFile(path.join(folder, "gamma.txt"), "Gamma");
  for (let start = 0; start < 1200; start += 100)
    await Promise.all(
      Array.from({ length: 100 }, (_, offset) =>
        fs.writeFile(
          path.join(big, `item-${String(start + offset).padStart(4, "0")}.txt`),
          "Large fixture",
        ),
      ),
    );
  await backend.connect();
  window.setContent((size) => (
    <FilesApp
      {...size}
      initialPath={source}
      windowActions={window}
      onQuit={() => {}}
      onBusyChange={(value) => {
        busy = value;
      }}
      onShowContextMenu={(request) => {
        title = request.title;
        actions = request.actions;
        return true;
      }}
    />
  ));
  window.mount(backend);
  await Promise.resolve();
  const native = backend.getWindows()[0];
  assert.ok(native);
  const key = (
    code: number,
    name: string,
    options: { ctrl?: boolean; shift?: boolean; alt?: boolean; text?: string } = {},
  ) => {
    const modifiers = {
      ctrl: options.ctrl ?? false,
      shift: options.shift ?? false,
      alt: options.alt ?? false,
      meta: false,
    };
    native.injectKey({
      type: "down",
      code,
      key: name,
      text: options.text,
      modifiers,
      timeMs: Date.now(),
    });
    native.injectKey({ type: "up", code, key: name, modifiers, timeMs: Date.now() });
    window.tick();
  };
  const settle = async () => {
    for (let i = 0; i < 12; i++) {
      await new Promise((done) => setTimeout(done, 10));
      window.tick();
    }
  };
  const context = () => {
    title = "";
    key(139, "ContextMenu");
  };
  const waitIdle = async () => {
    for (let i = 0; i < 200; i++) {
      await new Promise((done) => setTimeout(done, 10));
      window.tick();
      if (!busy) return;
    }
    assert.fail("Operation did not become idle");
  };
  const expectContext = async (expected: string) => {
    for (let i = 0; i < 100; i++) {
      await new Promise((done) => setTimeout(done, 10));
      window.tick();
      context();
      if (
        title === expected &&
        actions.find((action) => action.id === "select-all")?.disabled !== true
      )
        return;
    }
    assert.fail(`Expected ${expected}, received ${title}`);
  };
  const location = async (directory: string, expected = path.basename(directory)) => {
    key(38, "l", { ctrl: true });
    for (const character of directory) key(20, character, { text: character });
    key(28, "Enter");
    await expectContext(expected);
    await settle();
  };
  const invoke = (id: string) => {
    const action = flattenFileMenu(actions).find((entry) => entry.id === id);
    assert.ok(action, `Missing ${id}`);
    assert.notEqual(action.disabled, true);
    action.onPress?.();
    window.tick();
  };
  await expectContext("source");
  // Sort By ▸ Reverse Order flips the current name order.
  const reverseOrder = flattenFileMenu(actions).find((action) => action.id === "sort-reverse");
  assert.ok(reverseOrder);
  key(102, "Home");
  key(28, "Enter");
  await expectContext("Alpha");
  key(102, "Home");
  key(107, "End", { shift: true });
  context();
  assert.equal(title, "2 Items");
  key(46, "c", { ctrl: true });
  key(20, "t", { ctrl: true });
  await expectContext("Alpha");
  assert.ok(
    actions.some((action) => action.id === "new-folder"),
    "new tab starts without inherited selection",
  );
  await location(source);
  key(105, "ArrowLeft", { alt: true });
  await expectContext("Alpha");
  key(106, "ArrowRight", { alt: true });
  await expectContext("source");
  key(33, "f", { ctrl: true });
  for (const character of "zeta") key(20, character, { text: character });
  key(15, "Tab", { ctrl: true, shift: true });
  await expectContext("2 Items");
  key(103, "ArrowUp");
  context();
  assert.equal(title, "beta.txt", "restored collection focus receives arrows");
  key(15, "Tab", { ctrl: true });
  await expectContext("source");
  // The other tab still shows its own search, with its results.
  const painted = (): string[] => {
    const found: string[] = [];
    const walk = (node: SceneNode) => {
      if (node.kind === "text" && node.text) found.push(node.text);
      node.children.forEach(walk);
    };
    walk((window as unknown as { root: { container: SceneNode } }).root.container);
    return found;
  };
  for (let i = 0; i < 50 && !painted().includes("Best match"); i++) await settle();
  assert.ok(
    painted().includes("Best match") && painted().includes("zeta.txt"),
    "other tab keeps its independent search",
  );
  await location(source);
  key(47, "v", { ctrl: true });
  await waitIdle();
  key(1, "Escape");
  for (let i = 0; i < 100; i++) {
    await new Promise((done) => setTimeout(done, 10));
    window.tick();
    key(30, "a", { ctrl: true });
    context();
    if (title === "4 Items") break;
  }
  assert.equal(title, "4 Items", "completed copy reloads the active collection");
  assert.equal(
    await fs.readFile(path.join(source, "beta.txt"), "utf8"),
    "Beta",
    "clipboard is shared by tabs",
  );
  assert.equal(await fs.readFile(path.join(source, "gamma.txt"), "utf8"), "Gamma");
  key(102, "Home");
  key(108, "ArrowDown");
  key(108, "ArrowDown", { shift: true });
  context();
  assert.equal(title, "2 Items");
  invoke("trash");
  await waitIdle();
  await settle();
  await assert.rejects(fs.stat(path.join(source, "beta.txt")), { code: "ENOENT" });
  await assert.rejects(fs.stat(path.join(source, "gamma.txt")), { code: "ENOENT" });
  key(44, "z", { ctrl: true });
  await waitIdle();
  await settle();
  assert.equal(
    await fs.readFile(path.join(source, "beta.txt"), "utf8"),
    "Beta",
    "one Undo restores the group",
  );
  assert.equal(await fs.readFile(path.join(source, "gamma.txt"), "utf8"), "Gamma");
  key(102, "Home");
  key(108, "ArrowDown");
  key(108, "ArrowDown", { shift: true });
  context();
  invoke("trash");
  await waitIdle();
  await settle();
  // Trash is shown by name, not as its storage folder.
  await location(path.join(fixture, ".local", "share", "Trash", "files"), "Trash");
  key(30, "a", { ctrl: true });
  context();
  assert.equal(title, "2 Items");
  invoke("restore");
  await waitIdle();
  await settle();
  assert.equal(await fs.readFile(path.join(source, "gamma.txt"), "utf8"), "Gamma");
  await location(big);
  key(107, "End");
  await settle();
  context();
  assert.equal(title, "item-1199.txt", "End reveals the virtualized final row");
  key(103, "ArrowUp");
  context();
  assert.equal(title, "item-1198.txt", "revealed row owns real keyboard focus");
  reverseOrder.onPress?.();
  await settle();
  context();
  assert.equal(title, "item-1198.txt", "sort retains path identity");
  key(108, "ArrowDown");
  context();
  assert.equal(title, "item-1197.txt", "keyboard uses the new comparator order");
  key(15, "Tab", { ctrl: true });
  await expectContext("beta.txt");
  key(15, "Tab", { ctrl: true });
  await expectContext("item-1197.txt");
  key(103, "ArrowUp");
  context();
  assert.equal(
    title,
    "item-1198.txt",
    "tab restores focus and large-directory scroll after reordering",
  );
  const incoming = path.join(fixture, "incoming.txt");
  await fs.writeFile(incoming, "Incoming drop");
  notifyDrop(`file://${incoming}\n`, ["text/uri-list"], 0, 0);
  window.tick();
  await waitIdle();
  key(1, "Escape");
  await settle();
  assert.equal(
    await fs.readFile(path.join(big, "incoming.txt"), "utf8"),
    "Incoming drop",
    "real DropTarget uses the active tab destination",
  );
  await assert.rejects(fs.stat(incoming), { code: "ENOENT" });
  key(17, "w", { ctrl: true });
  await expectContext("beta.txt");
  console.log(
    "[files/tabs] independent history/search/selection/focus/scroll, group copy/Trash/Undo/Restore, 1200-row reveal/sort, incoming DnD, and tab close passed",
  );
} finally {
  window.destroy();
  backend.disconnect();
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await fs.rm(fixture, { recursive: true, force: true });
}
