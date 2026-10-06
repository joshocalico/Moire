import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import React from "react";
import { createShellRoot, rasterize, renderShell, type SceneNode } from "@moire/react-host";
import { applyThemeFamily, getTheme, setTheme, themePalette, THEME_FAMILIES } from "@moire/theme";
import { createShell, type ShellBridge, type ShellSpawn } from "./controller";
import { Launcher } from "./Launcher";

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
  p: 25,
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
function pointer(shell: ShellBridge, button: number, value: number): boolean {
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

  const feedbackRoot = createShellRoot();
  renderShell(
    feedbackRoot,
    React.createElement(Launcher, {
      open: true,
      screenW: width,
      screenH: height,
      apps: [],
      query: "alpha",
      selected: 0,
      launchState: { kind: "failed", appName: "Alpha Fixture" },
      onQueryChange() {},
      onLaunch() {},
      onSelect() {},
      onDismiss() {},
    }),
  );
  rasterize(feedbackRoot.container, width, height);
  assert.ok(
    textNodes(feedbackRoot.container).some(
      (node) => node.text === "Could not start Alpha Fixture. Try again.",
    ),
    "failure feedback did not reach the retained scene",
  );
} finally {
  for (const [name, value] of originalEnvironment) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  setTheme(originalTheme);
  fs.rmSync(temporaryHome, { recursive: true, force: true });
}
console.log("[shell/launcher-smoke] ok");
