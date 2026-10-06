import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import React from "react";
import { Window, installUiFonts, type ContextMenuAction } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { FilesApp } from "./main";
const phase = process.argv.find((arg) => arg.startsWith("--phase="))?.slice(8);
if (!phase) {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-files-pane-restart-"));
  try {
    await fs.mkdir(path.join(fixture, "folder"));
    await fs.writeFile(path.join(fixture, "folder/item.txt"), "Disposable pane fixture");
    for (const current of ["write", "restart"])
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [...process.execArgv, fileURLToPath(import.meta.url), `--phase=${current}`],
          {
            env: {
              ...process.env,
              HOME: fixture,
              XDG_CONFIG_HOME: path.join(fixture, ".config"),
              XDG_DATA_HOME: path.join(fixture, ".local/share"),
            },
            stdio: "inherit",
          },
        );
        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error("Files pane fixture child timed out"));
        }, 15000);
        child.once("error", (error) => {
          clearTimeout(timer);
          reject(error);
        });
        child.once("exit", (code, signal) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`Files pane child exited ${code}/${signal}`));
        });
      });
    console.log(
      "[files/panes] real independent Window/process restart restores actual drag-resized pane widths and preview toggle from disk",
    );
  } finally {
    await fs.rm(fixture, { recursive: true, force: true });
  }
} else {
  assert.ok(phase === "write" || phase === "restart");
  const config = path.join(process.env.XDG_CONFIG_HOME!, "moire/files-view.json");
  if (phase === "write") {
    await fs.mkdir(path.dirname(config), { recursive: true });
    await fs.writeFile(
      config,
      JSON.stringify({ view: "list", sidebarWidth: 208, inspectorWidth: 300, inspectorOpen: true }),
    );
  }
  await installUiFonts();
  const backend = new HeadlessPlatform();
  await backend.connect();
  const window = new Window({
    title: "Files pane persistence",
    width: 1280,
    height: 800,
    decorated: false,
  });
  let actions: ContextMenuAction[] = [];
  window.setContent((size) => (
    <FilesApp
      {...size}
      initialPath={path.join(process.env.HOME!, "folder")}
      windowActions={window}
      onQuit={() => {}}
      onShowContextMenu={(request) => {
        actions = request.actions;
        return false;
      }}
    />
  ));
  window.mount(backend);
  await Promise.resolve();
  const native = backend.getWindows()[0]!;
  const key = (code: number, key: string) => {
    const modifiers = { ctrl: false, alt: false, shift: false, meta: false };
    native.injectKey({ type: "down", code, key, modifiers, timeMs: 1 });
    native.injectKey({ type: "up", code, key, modifiers, timeMs: 2 });
    window.tick();
  };
  const wait = async (predicate: () => Promise<boolean> | boolean) => {
    for (let index = 0; index < 100; index++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      window.tick();
      if (await predicate()) return;
    }
    assert.fail(
      `Files pane state did not become ready (${phase}): ${await fs.readFile(config, "utf8")}`,
    );
  };
  const preferences = async (): Promise<{
    sidebarWidth: number;
    inspectorWidth: number;
    inspectorOpen: boolean;
  }> => JSON.parse(await fs.readFile(config, "utf8"));
  try {
    await wait(() => {
      key(139, "ContextMenu");
      return actions.some((action) => action.id === "preview-toggle");
    });
    key(1, "Escape");
    for (let frame = 0; frame < 30; frame++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      window.tick();
    }
    if (phase === "write") {
      const drag = (from: number, to: number) => {
        native.injectPointer({ type: "down", button: "left", x: from, y: 400, timeMs: 1 });
        native.injectPointer({ type: "move", x: to, y: 400, timeMs: 2 });
        native.injectPointer({ type: "up", button: "left", x: to, y: 400, timeMs: 3 });
        window.tick();
      };
      drag(211, 251);
      await wait(async () => (await preferences()).sidebarWidth === 248);
      drag(976, 916);
      await wait(async () => (await preferences()).inspectorWidth === 360);
      key(139, "ContextMenu");
      key(102, "Home");
      key(28, "Enter");
      await wait(async () => (await preferences()).inspectorOpen === false);
    } else {
      const saved = await preferences();
      assert.equal(saved.sidebarWidth, 248);
      assert.equal(saved.inspectorWidth, 360);
      assert.equal(saved.inspectorOpen, false);
      key(139, "ContextMenu");
      assert.equal(
        actions.find((action) => action.id === "preview-toggle")?.label,
        "Show preview",
        "fresh app must load hidden preview rather than its default",
      );
      key(102, "Home");
      key(28, "Enter");
      await wait(async () => (await preferences()).inspectorOpen);
      const reopened = await preferences();
      assert.equal(reopened.sidebarWidth, 248);
      assert.equal(reopened.inspectorWidth, 360);
    }
  } finally {
    window.destroy();
    backend.disconnect();
  }
}
