import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { createShellRoot, rasterize, renderShell, type SceneNode } from "@moire/react-host";
import { applyThemeFamily, getTheme, setTheme, themePalette, THEME_FAMILIES } from "@moire/theme";
import { createShell, type ShellBridge, type ShellSpawn } from "./controller";
import type { TaskWindowAction } from "./ssd";
import { Launcher } from "./Launcher";
import { tickAllMotions } from "@moire/ui";
import { loadSettings, updateSettings } from "@moire/prefs";

const width = 1024;
const height = 768;
const temporaryHome = fs.mkdtempSync(path.join(os.tmpdir(), "moire-launcher-smoke-"));
const environmentKeys = [
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_DATA_DIRS",
  "MOIRE_SHELL_START_OPEN",
];
const originalEnvironment = environmentKeys.map((key) => [key, process.env[key]] as const);
const originalTheme = getTheme();
const commands: string[] = [];
const success: ShellSpawn = ({ exec }) => {
  commands.push(exec);
  return {};
};
const codes: Record<string, number> = {
  a: 30,
  b: 48,
  e: 18,
  f: 33,
  h: 35,
  i: 23,
  l: 38,
  m: 50,
  p: 25,
  r: 19,
  s: 31,
  t: 20,
  x: 45,
};
function key(shell: ShellBridge, code: number): void {
  assert.equal(shell.onKey({ code, value: 1 }), true);
  shell.onKey({ code, value: 0 });
}
function type(shell: ShellBridge, text: string): void {
  for (const character of text) {
    const code = codes[character];
    assert.ok(code, `missing fixture key ${character}`);
    key(shell, code);
  }
}
function replaceQuery(shell: ShellBridge, text: string): void {
  shell.onKey({ code: 29, value: 1 });
  key(shell, 30);
  shell.onKey({ code: 29, value: 0 });
  type(shell, text);
}
function makeShell(spawnApp: ShellSpawn = success): ShellBridge {
  const shell = createShell(spawnApp);
  shell.setPrimaryOutput({ x: 0, y: 0, width, height });
  shell.chromeRaster(width, height);
  return shell;
}
/** Let the launcher's entrance settle and repaint, as the compositor does within a few frames. */
function settle(shell: ShellBridge): void {
  tickAllMotions(1);
  shell.chromeRaster(width, height);
}
function pointer(shell: ShellBridge, button: number, value: number): boolean {
  settle(shell);
  // A filtered single-row launcher uses its minimum 300px box.
  const y = height - themePalette().panelHeight - 300 - 8 + 112 + 22;
  const x = ["redmond", "cupertino", "gnomish"].includes(getTheme().family ?? "moire")
    ? width / 2
    : 60;
  return shell.onPointerButton({ timeMs: 0, button, value, x, y });
}
function textNodes(node: SceneNode): SceneNode[] {
  return [...(node.kind === "text" ? [node] : []), ...node.children.flatMap(textNodes)];
}

try {
  process.env.HOME = temporaryHome;
  process.env.XDG_CONFIG_HOME = path.join(temporaryHome, ".config");
  process.env.XDG_DATA_HOME = path.join(temporaryHome, ".local", "share");
  process.env.XDG_DATA_DIRS = path.join(temporaryHome, "system-data");
  process.env.MOIRE_SHELL_START_OPEN = "1";
  const applications = path.join(process.env.XDG_DATA_HOME, "applications");
  fs.mkdirSync(applications, { recursive: true });
  for (const name of ["Alpha", "Beta", "Beta.File"]) {
    fs.writeFileSync(
      path.join(applications, `${name}.desktop`),
      `[Desktop Entry]\nType=Application\nName=${name} Fixture\nExec=fixture-${name}\n`,
    );
  }

  for (let index = 0; index < 30; index++) {
    fs.writeFileSync(
      path.join(applications, `long-${index}.desktop`),
      `[Desktop Entry]\nType=Application\nName=Long List ${index}\nExec=fixture-long-${index}\n`,
    );
  }

  const editor = makeShell();
  type(editor, "alph");
  key(editor, 105);
  key(editor, 105);
  type(editor, "x");
  key(editor, 28);
  assert.equal(commands.length, 0, "inserting at the caret must filter to no results");
  key(editor, 14);
  key(editor, 107);
  type(editor, "a");
  key(editor, 28);
  assert.equal(
    commands.at(-1),
    "fixture-Alpha",
    "caret editing did not restore the matching query",
  );
  assert.equal(editor.isLauncherOpen(), false, "successful launch did not dismiss launcher");

  const selection = makeShell();
  type(selection, "beta");
  key(selection, 102);
  key(selection, 111);
  type(selection, "b");
  key(selection, 107);
  selection.onKey({ code: 42, value: 1 });
  key(selection, 105);
  selection.onKey({ code: 42, value: 0 });
  type(selection, "a");
  key(selection, 28);
  assert.equal(commands.at(-1), "fixture-Beta", "Home/Delete or Shift selection editing failed");

  const punctuation = makeShell();
  type(punctuation, "beta");
  key(punctuation, 52);
  type(punctuation, "file");
  key(punctuation, 28);
  assert.equal(commands.at(-1), "fixture-Beta.File", "search discarded punctuation in an app name");

  for (const [family, dark] of THEME_FAMILIES.flatMap(
    (family) =>
      [
        [family, true],
        [family, false],
      ] as const,
  )) {
    setTheme(applyThemeFamily(originalTheme, family, dark));
    const shell = makeShell();
    type(shell, "alpha");
    const launchesBefore: number = commands.length;
    assert.equal(pointer(shell, 273, 1), true);
    assert.equal(pointer(shell, 273, 0), true);
    assert.equal(
      commands.length,
      launchesBefore,
      `${family}/${dark ? "dark" : "light"}: right-click launched an application`,
    );
    assert.equal(
      shell.isLauncherOpen(),
      true,
      `${family}/${dark ? "dark" : "light"}: right-click dismissed launcher`,
    );
    assert.equal(pointer(shell, 272, 1), true);
    assert.equal(pointer(shell, 273, 0), true);
    assert.equal(
      commands.length,
      launchesBefore,
      `${family}/${dark ? "dark" : "light"}: another button released the left grab`,
    );
    assert.equal(pointer(shell, 272, 0), true);
    assert.equal(
      commands.at(-1),
      "fixture-Alpha",
      `${family}/${dark ? "dark" : "light"}: left-click lost application activation`,
    );
  }
  setTheme(originalTheme);

  const clippedRows = makeShell();
  type(clippedRows, "list");
  settle(clippedRows);
  const launchesBeforeFooter: number = commands.length;
  const footerY = height - themePalette().panelHeight - 8 - 34 + 4;
  for (const value of [1, 0]) {
    clippedRows.onPointerButton({ timeMs: 0, button: 272, value, x: 60, y: footerY });
  }
  assert.equal(
    commands.length,
    launchesBeforeFooter,
    "a clipped launcher row activated through its footer",
  );
  assert.equal(
    clippedRows.isLauncherOpen(),
    true,
    "footer click fell through to the launcher backdrop",
  );

  const searchClick = makeShell();
  type(searchClick, "beta");
  const searchY = height - themePalette().panelHeight - 300 - 8 + 46 + 18;
  for (const value of [1, 0]) {
    searchClick.onPointerButton({ timeMs: 0, button: 272, value, x: 31, y: searchY });
  }
  type(searchClick, "x");
  const launchesBeforeCaret: number = commands.length;
  key(searchClick, 28);
  assert.equal(commands.length, launchesBeforeCaret);
  key(searchClick, 14);
  key(searchClick, 28);
  assert.equal(commands.at(-1), "fixture-Beta", "search click did not place an editable caret");

  const keyboardSelection = makeShell();
  type(keyboardSelection, "beta");
  key(keyboardSelection, 108);
  key(keyboardSelection, 28);
  assert.equal(
    commands.at(-1),
    "fixture-Beta.File",
    "Down did not select the next matching application",
  );

  const stalePress = makeShell();
  type(stalePress, "alpha");
  pointer(stalePress, 272, 1);
  replaceQuery(stalePress, "beta");
  const launchesBeforeRelease = commands.length;
  pointer(stalePress, 272, 0);
  assert.equal(commands.length, launchesBeforeRelease, "a removed row retained its press callback");
  key(stalePress, 28);
  assert.equal(commands.at(-1), "fixture-Beta", "Ctrl+A did not replace the launcher query");

  let synchronousAttempts = 0;
  const syncFailure = makeShell(({ exec }) => {
    commands.push(exec);
    if (synchronousAttempts++ === 0) throw new Error("fixture synchronous launch failure");
    return {};
  });
  type(syncFailure, "alpha");
  key(syncFailure, 28);
  assert.equal(syncFailure.isLauncherOpen(), true, "synchronous failure discarded the launcher");
  key(syncFailure, 28);
  assert.equal(commands.at(-1), "fixture-Alpha", "retry lost the failed launch query");
  assert.equal(syncFailure.isLauncherOpen(), false);

  let asynchronousAttempts = 0;
  const asyncFailure = makeShell(({ exec }) => {
    commands.push(exec);
    return asynchronousAttempts++ === 0
      ? spawn(path.join(temporaryHome, "missing-executable"))
      : spawn(process.execPath, ["-e", ""]);
  });
  type(asyncFailure, "beta");
  key(asyncFailure, 28);
  const pendingRaster = asyncFailure.chromeRaster(width, height)?.pixels.slice();
  const attemptsBeforeRepeat = commands.length;
  key(asyncFailure, 28);
  assert.equal(commands.length, attemptsBeforeRepeat, "pending process spawned twice");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(asyncFailure.isLauncherOpen(), true, "ENOENT discarded the launcher");
  assert.notDeepEqual(
    asyncFailure.chromeRaster(width, height)?.pixels,
    pendingRaster,
    "failure did not repaint feedback",
  );
  key(asyncFailure, 28);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(commands.at(-1), "fixture-Beta", "asynchronous retry lost the query");
  assert.equal(asyncFailure.isLauncherOpen(), false, "spawn success did not dismiss launcher");

  const cancelledFailure = makeShell(() => spawn(path.join(temporaryHome, "missing-executable")));
  type(cancelledFailure, "alpha");
  key(cancelledFailure, 28);
  key(cancelledFailure, 1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(
    cancelledFailure.isLauncherOpen(),
    false,
    "late process error reopened a dismissed launcher",
  );

  // Pins: listed first in pin order, toggled by right-click, re-read from prefs on every open.
  updateSettings({ launcherPins: ["long-7.desktop", "missing.desktop"] });
  const pinned = makeShell();
  key(pinned, 28);
  assert.equal(commands.at(-1), "fixture-long-7", "the pinned app is not listed first");
  const pinning = makeShell();
  type(pinning, "alpha");
  pointer(pinning, 273, 1);
  pointer(pinning, 273, 0);
  assert.deepEqual(
    loadSettings().launcherPins,
    ["long-7.desktop", "missing.desktop", "Alpha.desktop"],
    "right-click did not pin the app",
  );
  replaceQuery(pinning, "");
  key(pinning, 108);
  key(pinning, 28);
  assert.equal(commands.at(-1), "fixture-Alpha", "pins are not in pin order");
  const unpinning = makeShell();
  type(unpinning, "alpha");
  pointer(unpinning, 273, 1);
  pointer(unpinning, 273, 0);
  assert.deepEqual(loadSettings().launcherPins, ["long-7.desktop", "missing.desktop"]);
  key(unpinning, 1);
  updateSettings({ launcherPins: ["Beta.desktop"] });
  key(unpinning, 125);
  key(unpinning, 28);
  assert.equal(
    commands.at(-1),
    "fixture-Beta",
    "pins changed in Settings were not re-read on open",
  );
  updateSettings({ launcherPins: [] });

  // App activation: Settings has a single main window (SingleMainWindow), so launching it while
  // it is open restores and focuses that window; Terminal opens a new window every time.
  const terminalEntry = path.join(applications, "Terminal.desktop");
  fs.writeFileSync(
    terminalEntry,
    "[Desktop Entry]\nType=Application\nName=Terminal Fixture\nExec=fixture-terminal\nStartupWMClass=org.example.Terminal\n",
  );
  const actions: TaskWindowAction[] = [];
  const activation = createShell(success, (action) => actions.push(action));
  activation.setPrimaryOutput({ x: 0, y: 0, width, height });
  activation.chromeRaster(width, height);
  const launchFromLauncher = (query: string) => {
    if (!activation.isLauncherOpen()) {
      activation.onKey({ code: 125, value: 1 });
      activation.onKey({ code: 125, value: 0 });
    }
    assert.equal(activation.isLauncherOpen(), true, "Super opens the launcher");
    type(activation, query);
    key(activation, 28);
    assert.equal(activation.isLauncherOpen(), false, `Enter on ${query} closes the launcher`);
  };
  const window = (clientId: number, appId: string, minimized = false) => ({
    clientId,
    surfaceId: 3,
    title: appId,
    appId,
    focused: false,
    minimized,
  });
  launchFromLauncher("setti");
  assert.match(
    commands.at(-1)!,
    /moire-settings|@moire\/settings/,
    "the first launch starts Settings",
  );
  const settingsStarts = commands.length;
  activation.setTasks?.([window(7, "org.moire.Settings", true)]);
  launchFromLauncher("setti");
  assert.equal(commands.length, settingsStarts, "launching open Settings starts no second one");
  assert.deepEqual(actions, [{ clientId: 7, surfaceId: 3, kind: "activate" }]);
  launchFromLauncher("termi");
  assert.equal(commands.at(-1), "fixture-terminal");
  activation.setTasks?.([window(7, "org.moire.Settings"), window(8, "org.example.Terminal")]);
  launchFromLauncher("termi");
  assert.deepEqual(commands.slice(-2), ["fixture-terminal", "fixture-terminal"]);
  assert.equal(commands.length, settingsStarts + 2, "Terminal opens a second window");
  assert.equal(actions.length, 1, "Terminal never activates its open window");
  fs.rmSync(terminalEntry);

  // Super alone toggles the launcher on release; Super used in a chord never opens it.
  const superKey = makeShell();
  if (superKey.isLauncherOpen()) key(superKey, 1);
  superKey.onKey({ code: 125, value: 1 });
  assert.equal(superKey.isLauncherOpen(), false, "Super press alone must wait for release");
  superKey.onKey({ code: 125, value: 0 });
  assert.equal(superKey.isLauncherOpen(), true, "Super released alone opens the launcher");
  key(superKey, 125);
  assert.equal(superKey.isLauncherOpen(), false, "Super again closes it");
  superKey.onKey({ code: 125, value: 1 });
  superKey.onLayoutShortcut();
  superKey.onKey({ code: 125, value: 0 });
  assert.equal(superKey.isLauncherOpen(), false, "Super+Space switches layout, no launcher");
  superKey.onKey({ code: 125, value: 1 });
  superKey.onSuperChord?.();
  superKey.onKey({ code: 125, value: 0 });
  assert.equal(superKey.isLauncherOpen(), false, "Super+L locks, no launcher");
  superKey.onKey({ code: 125, value: 1 });
  key(superKey, 49);
  superKey.onKey({ code: 125, value: 0 });
  assert.equal(superKey.isLauncherOpen(), false, "Super+N opens notifications, no launcher");

  const feedbackRoot = createShellRoot();
  renderShell(
    feedbackRoot,
    <Launcher
      open
      screenW={width}
      screenH={height}
      apps={[]}
      query="alpha"
      selected={0}
      launchState={{ kind: "failed", appName: "Alpha Fixture" }}
      onQueryChange={() => {}}
      onLaunch={() => {}}
      onSelect={() => {}}
      onDismiss={() => {}}
    />,
  );
  rasterize(feedbackRoot.container, width, height);
  assert.ok(
    textNodes(feedbackRoot.container).some(
      (node) => node.text === "Could not start Alpha Fixture. Try again.",
    ),
    "failure feedback did not reach the retained scene",
  );
  const pinRoot = createShellRoot();
  renderShell(
    pinRoot,
    <Launcher
      open
      screenW={width}
      screenH={height}
      apps={[
        { id: "a.desktop", name: "Alpha Fixture", exec: "a", terminal: false, categories: [] },
      ]}
      pins={["a.desktop"]}
      notice="Pinned Alpha Fixture"
      query=""
      selected={0}
      onQueryChange={() => {}}
      onLaunch={() => {}}
      onSelect={() => {}}
      onDismiss={() => {}}
    />,
  );
  rasterize(pinRoot.container, width, height);
  const pinTexts = textNodes(pinRoot.container).map((node) => node.text);
  assert.ok(pinTexts.includes("Pinned"), "a pinned app is not marked");
  assert.ok(pinTexts.includes("Pinned Alpha Fixture"), "the pin notice is not in the footer");
} finally {
  for (const [name, value] of originalEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  setTheme(originalTheme);
  fs.rmSync(temporaryHome, { recursive: true, force: true });
}
console.log("[shell/launcher-smoke] ok");
