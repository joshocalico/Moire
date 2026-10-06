/** Real shell capture and real Window dispatch across compositor client-focus handoffs. */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { Rect } from "@moire/react-host";
import { Window, installUiFonts } from "@moire/ui";
import { HeadlessPlatform } from "@moire/ui/testing";
import { createShell } from "./controller";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "moire-shell-focus-"));
const keys = [
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_DATA_DIRS",
  "MOIRE_SHELL_START_OPEN",
];
const previous = keys.map((key) => [key, process.env[key]] as const);
const width = 1024,
  height = 768;
try {
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = path.join(home, "config");
  process.env.XDG_DATA_HOME = path.join(home, "data");
  process.env.XDG_DATA_DIRS = path.join(home, "system");
  delete process.env.MOIRE_SHELL_START_OPEN;
  fs.mkdirSync(path.join(home, "Desktop"));
  for (const name of ["Alpha.txt", "Beta.txt", "Gamma.txt"])
    fs.writeFileSync(path.join(home, "Desktop", name), name);
  await installUiFonts();
  const backend = new HeadlessPlatform();
  await backend.connect();
  const delivered: number[] = [];
  const client = new Window({ title: "Files focus fixture", width: 300, height: 200 });
  client.setContent(
    React.createElement(Rect, {
      width: 300,
      height: 200,
      focusable: true,
      autoFocus: true,
      focusId: "client:keys",
      onKeyDown: (event) => delivered.push(event.code),
    }),
  );
  client.mount(backend);
  await Promise.resolve();
  client.tick();
  const native = backend.getWindows()[0]!;
  let taskActivations = 0;
  const shell = createShell(
    () => ({}),
    () => {
      taskActivations++;
      // The compositor's focusClient invokes this before keyboardEnter, even
      // when its focusedToplevel already names the activated client.
      shell.onClientFocus?.();
    },
  );
  shell.setPrimaryOutput({ x: 0, y: 0, width, height });
  shell.setTasks?.([
    {
      clientId: 1,
      surfaceId: 7,
      title: "Files",
      appId: "org.moire.Files",
      focused: true,
      minimized: false,
    },
  ]);
  const route = (code: number, value = 1): boolean => {
    const consumed = shell.onKey({ code, value });
    if (!consumed) {
      native.injectKey({
        type: value === 0 ? "up" : "down",
        code,
        key: { 107: "End", 108: "ArrowDown", 102: "Home", 103: "ArrowUp", 28: "Enter" }[code],
        modifiers: { ctrl: false, shift: false, alt: false, meta: false },
        timeMs: 0,
      });
      client.tick();
    }
    return consumed;
  };
  const desktopClick = (button = 272) => {
    for (const value of [1, 0])
      shell.onDesktopPointerButton?.({
        timeMs: value,
        button,
        value,
        x: 700,
        y: 300,
      });
  };
  const desktop = () => shell.desktopRaster(width, height)!.pixels.slice();
  const clientKeys = () => {
    const before = delivered.length,
      pixels = desktop();
    for (const code of [107, 108, 102, 103, 28]) {
      assert.equal(route(code), false, `client-focus handoff retained desktop key ${code}`);
      assert.equal(route(code, 0), false);
    }
    assert.deepEqual(delivered.slice(before), [107, 108, 102, 103, 28]);
    assert.deepEqual(desktop(), pixels, "client navigation modified desktop icons behind the app");
  };
  try {
    desktopClick();
    assert.equal(route(102), true);
    const first = desktop();
    assert.equal(route(107), true);
    assert.notDeepEqual(desktop(), first, "desktop Home/End navigation did not select icons");
    assert.equal(delivered.length, 0, "desktop navigation leaked into the client");
    // Alt+Tab is intercepted by the compositor before shell.onKey. Its
    // resulting client-focus event must release desktop capture without a click.
    route(56);
    shell.onClientFocus?.();
    assert.equal(route(56, 0), false, "Alt release remained captured after Alt+Tab");
    clientKeys();
    // A repeated focus event is meaningful after a new background click, even
    // if task identity and core focusedToplevel have not changed.
    desktopClick();
    assert.equal(route(107), true);
    shell.onClientFocus?.();
    clientKeys();
    // Actual taskbar press invokes activation, not a synthesized focus change.
    desktopClick();
    shell.chromeRaster(width, height);
    for (const value of [1, 0])
      shell.onPointerButton({
        timeMs: value,
        button: 272,
        value,
        x: 210,
        y: 740,
      });
    assert.equal(taskActivations, 1);
    clientKeys();
    // Both modifier edges remain deliverable while desktop capture is active.
    desktopClick();
    for (const code of [29, 97, 42, 54]) {
      assert.equal(route(code), false);
      assert.equal(route(code, 0), false);
    }
    desktopClick(273);
    assert.equal(route(108), true, "desktop menu did not capture keyboard input");
    shell.onClientFocus?.();
    clientKeys();
    // Client mapping/activation must not dismiss or bypass a launcher modal.
    desktopClick();
    route(125);
    route(125, 0);
    assert.equal(shell.isLauncherOpen(), true);
    shell.onClientFocus?.();
    const count = delivered.length;
    assert.equal(route(107), true);
    assert.equal(route(108), true);
    assert.equal(shell.isLauncherOpen(), true);
    assert.equal(delivered.length, count);
    route(1);
    assert.equal(shell.isLauncherOpen(), false);
    clientKeys();
    desktopClick();
    assert.equal(route(102), true, "desktop navigation failed after client handoffs");
  } finally {
    client.destroy();
    backend.disconnect();
  }
} finally {
  for (const [key, value] of previous) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(home, { recursive: true, force: true });
}
console.log(
  "[shell/focus] desktop navigation → Alt+Tab/client reactivation/taskbar → actual Window key dispatch, modifier release, desktop menu and launcher modal passed",
);
