import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { PNG } from "pngjs";
import { Window, installUiFonts, type ContextMenuAction } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { FileCatalog } from "./catalog";
import { remainingCutPaths } from "./cut-clipboard";

const sourceRoot = process.env.MOIRE_TEST_ROOT;
const { FilesApp }: typeof import("./main") = sourceRoot
  ? await import(pathToFileURL(path.join(sourceRoot, "apps/bundled/files/src/main.tsx")).href)
  : await import("./main");
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-cut-recovery-"));
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
const output = process.env.MOIRE_CAPTURE_DIR;
const backend = new HeadlessPlatform();
const window = new Window({
  title: "Files cut recovery",
  width: 1280,
  height: 760,
  decorated: false,
});
let busy = false;
let contextTitle = "";
let actions: ContextMenuAction[] = [];
try {
  const folders = Object.fromEntries(
    await Promise.all(
      [
        "skip-source",
        "skip-destination",
        "skip-retry",
        "partial-source",
        "partial-destination",
        "partial-retry",
      ].map(async (name) => {
        const folder = path.join(fixture, name);
        await fs.mkdir(folder);
        return [name, folder];
      }),
    ),
  );
  const skip = path.join(folders["skip-source"]!, "only.txt");
  const first = path.join(folders["partial-source"]!, "a-first.txt");
  const last = path.join(folders["partial-source"]!, "z-last.txt");
  await fs.writeFile(skip, "Skipped source bytes");
  await fs.writeFile(
    path.join(folders["skip-destination"]!, "only.txt"),
    "Existing skip destination",
  );
  await fs.writeFile(first, "Completed first move");
  await fs.writeFile(last, "Unfinished last move");
  await fs.writeFile(
    path.join(folders["partial-destination"]!, "z-last.txt"),
    "Existing partial destination",
  );
  const config = path.join(fixture, ".config", "moire");
  await fs.mkdir(config, { recursive: true });
  await fs.writeFile(path.join(config, "files-view.json"), JSON.stringify({ view: "list" }));
  const catalogFile = path.join(config, "files-tags.json");
  const catalog = new FileCatalog(catalogFile);
  await catalog.update([skip, first, last], ["Recovery"], "add");
  const broken = path.join(fixture, "dangling-link");
  await fs.symlink("missing-target", broken);
  assert.deepEqual(
    await remainingCutPaths([skip, path.join(fixture, "missing"), broken]),
    [skip, broken],
    "existence means lstat: preserve an unmoved symlink without following its target",
  );
  await assert.rejects(
    remainingCutPaths([path.join(skip, "not-a-child")]),
    { code: "ENOTDIR" },
    "unexpected stat failures cannot be called completed moves",
  );
  await installUiFonts();
  await backend.connect();
  window.setContent((size) => (
    <FilesApp
      {...size}
      initialPath={folders["skip-source"]!}
      windowActions={window}
      onQuit={() => {}}
      onBusyChange={(value) => {
        busy = value;
      }}
      onShowContextMenu={(request) => {
        contextTitle = request.title;
        actions = request.actions;
        return true;
      }}
    />
  ));
  window.mount(backend);
  await Promise.resolve();
  const native = backend.getWindows()[0]!;
  const key = (code: number, name: string, options: { ctrl?: boolean; text?: string } = {}) => {
    const modifiers = { ctrl: options.ctrl ?? false, shift: false, alt: false, meta: false };
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
    for (let frame = 0; frame < 20; frame++) {
      await new Promise((done) => setTimeout(done, 10));
      window.tick();
    }
  };
  const wait = async (check: () => Promise<boolean> | boolean, message: string) => {
    for (let i = 0; i < 200; i++) {
      await new Promise((done) => setTimeout(done, 10));
      window.tick();
      if (await check()) return;
    }
    assert.fail(message);
  };
  const exists = async (file: string) => {
    try {
      await fs.lstat(file);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  };
  const location = async (folder: string) => {
    key(38, "l", { ctrl: true });
    for (const character of folder) key(0, character, { text: character });
    key(28, "Enter");
    await settle();
    key(139, "ContextMenu");
    assert.equal(contextTitle, path.basename(folder));
  };
  const save = async (name: string) => {
    if (!output) return;
    await fs.mkdir(output, { recursive: true });
    const png = new PNG({ width: 1280, height: 760 });
    const frame = native.lastFrame!;
    for (let at = 0; at < frame.length; at += 4)
      png.data.set([frame[at + 2]!, frame[at + 1]!, frame[at]!, frame[at + 3]!], at);
    await fs.writeFile(path.join(output, `${name}.png`), PNG.sync.write(png));
  };
  await settle();
  if (!process.argv.includes("--partial-only")) {
    key(30, "a", { ctrl: true });
    key(45, "x", { ctrl: true });
    await location(folders["skip-destination"]!);
    key(47, "v", { ctrl: true });
    await settle();
    assert.equal(busy, true, "collision holds the actual move pending user choice");
    native.injectPointer({ type: "wheel", x: 640, y: 500, deltaY: 600, timeMs: Date.now() });
    window.tick();
    await settle();
    await save("skip-choice");
    // The dialog's real close control owns initial focus. Traversal reaches Keep both,
    // then Skip this item, after scrolling the real choices into view.
    key(15, "Tab");
    key(15, "Tab");
    key(28, "Enter");
    await wait(() => !busy, "Skip did not finish the move dialog");
    await settle();
    await save("skip-receipt");
    assert.equal(await fs.readFile(skip, "utf8"), "Skipped source bytes");
    assert.equal(
      await fs.readFile(path.join(folders["skip-destination"]!, "only.txt"), "utf8"),
      "Existing skip destination",
    );
    key(1, "Escape");
    await settle();
    await location(folders["skip-retry"]!);
    assert.notEqual(
      actions.find((action) => action.id === "paste")?.disabled,
      true,
      "the skipped cut item remains available to Paste",
    );
    key(47, "v", { ctrl: true });
    await wait(
      async () => !busy && (await exists(path.join(folders["skip-retry"]!, "only.txt"))),
      "Paste did not retry the skipped cut source",
    );
    await settle();
    key(1, "Escape");
    await settle();
    assert.equal(
      await fs.readFile(path.join(folders["skip-retry"]!, "only.txt"), "utf8"),
      "Skipped source bytes",
    );
    assert.equal(await exists(skip), false);
  }
  await location(folders["partial-source"]!);
  key(30, "a", { ctrl: true });
  key(45, "x", { ctrl: true });
  await location(folders["partial-destination"]!);
  key(47, "v", { ctrl: true });
  await wait(
    async () => busy && !(await exists(first)) && (await exists(last)),
    "First move did not publish before the second item's real collision",
  );
  await settle();
  await save("partial-conflict");
  key(1, "Escape");
  await wait(() => !busy, "Escape did not cancel the pending transfer");
  await settle();
  await save("partial-stopped");
  key(1, "Escape");
  await settle();
  await location(folders["partial-retry"]!);
  assert.notEqual(actions.find((action) => action.id === "paste")?.disabled, true);
  key(47, "v", { ctrl: true });
  await wait(
    async () => !busy && (await exists(path.join(folders["partial-retry"]!, "z-last.txt"))),
    "Paste retry retained an already-moved source instead of only the remaining cut item",
  );
  await settle();
  assert.equal(
    await fs.readFile(path.join(folders["partial-destination"]!, "a-first.txt"), "utf8"),
    "Completed first move",
  );
  assert.equal(
    await fs.readFile(path.join(folders["partial-destination"]!, "z-last.txt"), "utf8"),
    "Existing partial destination",
  );
  assert.equal(
    await fs.readFile(path.join(folders["partial-retry"]!, "z-last.txt"), "utf8"),
    "Unfinished last move",
  );
  assert.equal(await exists(path.join(folders["partial-retry"]!, "a-first.txt")), false);
  assert.equal(await exists(last), false);
  const reopened = new FileCatalog(catalogFile);
  await reopened.load();
  for (const file of [
    process.argv.includes("--partial-only") ? skip : path.join(folders["skip-retry"]!, "only.txt"),
    path.join(folders["partial-destination"]!, "a-first.txt"),
    path.join(folders["partial-retry"]!, "z-last.txt"),
  ])
    assert.deepEqual(reopened.tags(file), ["Recovery"]);
  await save("partial-retry-complete");
  console.log(
    JSON.stringify({
      kind: "files-cut-recovery",
      source: sourceRoot ?? "workspace",
      scope:
        "actual public Window cut/Paste, scroll/Tab/Skip, partial move/Escape/retry and persisted bytes/tags; native input acceptance remains separate",
    }),
  );
} finally {
  window.destroy();
  backend.disconnect();
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await fs.rm(fixture, { recursive: true, force: true });
}
