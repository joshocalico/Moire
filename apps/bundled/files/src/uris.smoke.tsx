import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { Window, installUiFonts, setDndBridge } from "@moire/ui";
import { HeadlessPlatform, notifyDrop } from "@moire/ui/testing";
const source = process.env.MOIRE_TEST_ROOT;
const { FilesApp }: typeof import("./main") = source
  ? await import(pathToFileURL(path.join(source, "apps/bundled/files/src/main.tsx")).href)
  : await import("./main");
import { pathsFromUriList, pathsToUriList } from "./uris";
import { FileCatalog } from "./catalog";

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-uris-"));
const previous = {
  HOME: process.env.HOME,
  XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};
process.env.HOME = fixture;
process.env.XDG_CONFIG_HOME = path.join(fixture, ".config");
// The session file clipboard lives in the runtime directory; keep it in the fixture.
process.env.XDG_RUNTIME_DIR = path.join(fixture, ".run");
process.env.XDG_DATA_HOME = path.join(fixture, ".local/share");
try {
  await installUiFonts();
  const names = ["design #1? 100% λ.txt", "two\nlines.txt"];
  const incoming = path.join(fixture, "incoming");
  const destination = path.join(fixture, "destination");
  const config = path.join(fixture, ".config/moire");
  await fs.mkdir(incoming);
  await fs.mkdir(destination);
  await fs.mkdir(config, { recursive: true });
  await fs.writeFile(path.join(config, "files-view.json"), JSON.stringify({ view: "list" }));
  const paths = names.map((name) => path.join(incoming, name));
  for (const file of paths) await fs.writeFile(file, `Real bytes for ${path.basename(file)}`);
  const catalog = new FileCatalog();
  await catalog.update(paths, ["Design"], "add");
  const serialized = pathsToUriList(paths);
  assert.deepEqual(pathsFromUriList(serialized), paths);
  assert.ok(
    serialized.includes("%23") &&
      serialized.includes("%3F") &&
      serialized.includes("%25") &&
      serialized.includes("%0A"),
  );
  assert.deepEqual(pathsFromUriList(`# comment\r\n${serialized}${serialized}`), paths);
  assert.deepEqual(
    pathsFromUriList(
      `file://remote.invalid${paths[0]}\nfile:///tmp/%2Fbad\nfile:///tmp/%00bad\nfile:///tmp/file#fragment\nhttps://example.invalid/file\n`,
    ),
    [],
  );
  assert.deepEqual(pathsFromUriList({ toString: () => serialized }), []);
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({
    title: "File URI workflow",
    width: 1280,
    height: 760,
    decorated: false,
  });
  let ready = false,
    busy = false,
    title = "";
  window.setContent((size) => (
    <FilesApp
      {...size}
      initialPath={incoming}
      windowActions={window}
      onQuit={() => {}}
      onBusyChange={(value) => {
        busy = value;
      }}
      onShowContextMenu={(request) => {
        title = request.title;
        ready = request.actions.some(
          (action) => action.id === "select-all" && action.disabled === false,
        );
        return true;
      }}
    />
  ));
  window.mount(backend);
  await Promise.resolve();
  const native = backend.getWindows()[0]!;
  const key = (code: number, key: string, ctrl = false, text?: string) => {
    const modifiers = { ctrl, alt: false, shift: false, meta: false };
    native.injectKey({ type: "down", code, key, text, modifiers, timeMs: 1 });
    native.injectKey({ type: "up", code, key, modifiers, timeMs: 2 });
    window.tick();
  };
  const settle = async (predicate: () => boolean) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      window.tick();
      if (predicate()) return;
    }
    assert.fail("Files URI workflow did not settle");
  };
  try {
    await settle(() => {
      key(139, "ContextMenu");
      return ready;
    });
    let dragPayload: unknown;
    setDndBridge({
      startDrag: (value) => {
        dragPayload = value;
      },
    });
    native.injectPointer({ type: "down", button: "left", x: 300, y: 163, timeMs: 1 });
    native.injectPointer({ type: "move", x: 322, y: 163, timeMs: 2 });
    window.tick();
    native.injectPointer({ type: "up", button: "left", x: 322, y: 163, timeMs: 3 });
    window.tick();
    assert.equal(
      dragPayload,
      pathToFileURL(paths[0]!).href + "\r\n",
      "actual Files row serializes reserved characters for an external drag",
    );
    key(38, "l", true);
    for (const character of destination) key(0, character, false, character);
    key(28, "Enter");
    await settle(() => {
      key(139, "ContextMenu");
      return title === "destination";
    });
    notifyDrop(`file://remote.invalid${paths[0]}\n`, ["text/uri-list"], 0, 0);
    window.tick();
    assert.equal(busy, false, "remote URI cannot start a local move");
    notifyDrop(serialized, ["text/uri-list"], 0, 0);
    window.tick();
    await settle(() => !busy);
    for (const file of paths) {
      const target = path.join(destination, path.basename(file));
      assert.equal(await fs.readFile(target, "utf8"), `Real bytes for ${path.basename(file)}`);
      await assert.rejects(fs.stat(file), { code: "ENOENT" });
    }
    const reloaded = new FileCatalog();
    await reloaded.load();
    for (const file of paths)
      assert.deepEqual(
        reloaded.tags(path.join(destination, path.basename(file))),
        ["Design"],
        "actual DnD move relocates persisted tags",
      );
  } finally {
    setDndBridge(null);
    window.destroy();
    backend.disconnect();
  }
  console.log(
    "[files/uris] actual public Window drag/drop preserves # ? % Unicode/newline names and bytes/tags; remote/malformed URI no-op passed",
  );
} finally {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await fs.rm(fixture, { recursive: true, force: true });
}
