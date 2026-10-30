/* eslint-disable import/no-relative-parent-imports -- Exercise Files through the real headless Window dispatcher. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import React from "react";
import { installUiFonts, Window, type ContextMenuAction } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { FilesApp } from "./main";

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-keyboard-"));
const previous = {
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
const window = new Window({ title: "Files keyboard workflows", width: 1020, height: 600 });
let title = "";
let actions: ContextMenuAction[] = [];
try {
  await installUiFonts();
  const view = process.argv.includes("--list") ? "list" : "grid";
  const config = path.join(fixture, ".config", "moire");
  await fs.mkdir(config, { recursive: true });
  await fs.writeFile(path.join(config, "files-view.json"), JSON.stringify({ view }));
  const source = path.join(fixture, "source");
  const folder = path.join(source, "Alpha");
  await fs.mkdir(folder, { recursive: true });
  await fs.writeFile(path.join(source, "zeta.txt"), "Outside folder");
  await fs.writeFile(path.join(folder, "beta.txt"), "First item");
  await fs.writeFile(path.join(folder, "gamma.txt"), "Last item");
  await backend.connect();
  window.setContent((size) => (
    <FilesApp
      {...size}
      initialPath={source}
      onQuit={() => {}}
      onShowContextMenu={(request) => {
        title = request.title;
        actions = request.actions;
        return true;
      }}
    />
  ));
  window.mount(backend);
  await Promise.resolve();
  window.tick();
  const native = backend.getWindows()[0];
  assert.ok(native);
  const send = (
    code: number,
    key: string,
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
      key,
      text: options.text,
      modifiers,
      timeMs: Date.now(),
    });
    native.injectKey({ type: "up", code, key, modifiers, timeMs: Date.now() });
    window.tick();
  };
  const context = () => send(139, "ContextMenu");
  const waitForFolder = async (name: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      window.tick();
      context();
      if (
        title === name &&
        actions.some((action) => action.id === "select-all" && !action.disabled)
      )
        return;
    }
    assert.fail(
      `Folder ${name} did not become ready; current context: ${title} ${JSON.stringify(actions.map(({ id, disabled }) => ({ id, disabled })))}`,
    );
  };
  await waitForFolder("source");
  assert.ok(
    actions.some((action) => action.id === "new-folder"),
    "initial focus keeps selection empty",
  );
  assert.equal(
    actions.filter((action) => action.id.endsWith("new-folder")).length,
    1,
    "folder menu offers one New Folder action",
  );
  assert.equal(
    actions.filter((action) => action.id.endsWith("refresh")).length,
    1,
    "folder menu offers one Refresh action",
  );
  // Space previews the focused item, selecting it; Escape closes the preview.
  send(57, " ");
  send(1, "Escape");
  context();
  assert.equal(title, "Alpha", "Space selects and previews the initially focused folder");
  send(28, "Enter");
  await waitForFolder("Alpha");
  send(102, "Home");
  send(view === "list" ? 108 : 106, view === "list" ? "ArrowDown" : "ArrowRight");
  context();
  assert.equal(title, "gamma.txt", "Arrows browse the next item after keyboard navigation");
  send(102, "Home", { shift: true });
  context();
  assert.equal(title, "2 Items", "Shift+Home extends a keyboard range");
  assert.equal(actions.find((action) => action.id === "rename")?.disabled, true);
  send(102, "Home");
  send(38, "l", { ctrl: true });
  send(1, "Escape");
  send(107, "End");
  context();
  assert.equal(title, "gamma.txt", "Escape from location editing returns arrows to the collection");

  send(33, "f", { ctrl: true });
  for (const character of "beta") send(48, character, { text: character });
  send(1, "Escape");
  context();
  assert.equal(title, "beta.txt", "Escape leaves search with the best match selected");
  send(107, "End");
  context();
  assert.equal(title, "gamma.txt", "Escape clears search and restores collection keyboard input");

  send(105, "ArrowLeft", { alt: true });
  await waitForFolder("source");
  send(57, " ");
  send(1, "Escape");
  context();
  assert.equal(title, "Alpha", "Back resets selection and restores initial collection focus");
  send(106, "ArrowRight", { alt: true });
  await waitForFolder("Alpha");
  send(57, " ");
  send(1, "Escape");
  context();
  assert.equal(title, "beta.txt", "Forward resets selection for the destination folder");

  // Named creation proves the operation shortcut still reaches the folder
  // after editing focus is released, while all effects stay in this fixture.
  send(49, "n", { ctrl: true, shift: true });
  for (const character of "Keyboard folder") send(20, character, { text: character });
  send(28, "Enter");
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    window.tick();
    try {
      if ((await fs.stat(path.join(folder, "Keyboard folder"))).isDirectory()) break;
    } catch {}
  }
  assert.equal((await fs.stat(path.join(folder, "Keyboard folder"))).isDirectory(), true);
  console.log(
    `[files/keyboard/${view}] initial focus, Space preview/Enter, arrows, range selection, path/search Escape, history and named creation passed`,
  );
} finally {
  window.destroy();
  backend.disconnect();
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await fs.rm(fixture, { recursive: true, force: true });
}
