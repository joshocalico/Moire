/** Finding a terminal for "Open in Terminal", and the command that opens it in a folder. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { parseDesktopFile } from "./desktop";
import { enterableFolder, findTerminal, terminalLaunch } from "./terminal";

const moire = parseDesktopFile(
  fs.readFileSync(
    new URL("../../../apps/bundled/terminal/moire-terminal.desktop", import.meta.url),
    "utf8",
  ),
  "moire-terminal.desktop",
  "Moire",
)!;
const xterm = parseDesktopFile(
  "[Desktop Entry]\nType=Application\nName=XTerm\nExec=xterm %F\nCategories=System;TerminalEmulator;\n",
  "xterm.desktop",
  "Moire",
)!;
const editor = parseDesktopFile(
  "[Desktop Entry]\nType=Application\nName=Editor\nExec=editor %f\nCategories=Utility;\n",
  "editor.desktop",
  "Moire",
)!;

assert.equal(
  findTerminal([editor, xterm, moire])?.id,
  "moire-terminal.desktop",
  "Moire's own first",
);
assert.equal(findTerminal([editor, xterm])?.id, "xterm.desktop", "else any terminal emulator");
assert.equal(findTerminal([editor]), null, "no terminal installed");

// The folder reaches the shell intact, quotes and spaces included.
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "it's a folder "));
try {
  const launch = terminalLaunch(moire, folder);
  assert.equal(launch.cwd, folder);
  assert.equal(launch.name, "Terminal");
  assert.match(launch.command, /^moire-terminal --working-directory /);
  const argv = execFileSync(
    "/bin/sh",
    ["-c", `set -- ${launch.command}; shift; printf '%s\\n' "$@"`],
    {
      encoding: "utf8",
    },
  );
  assert.deepEqual(argv.trimEnd().split("\n"), ["--working-directory", folder]);
  // A folder that cannot be entered starts the shell in its nearest enterable ancestor.
  const locked = path.join(folder, "locked");
  fs.mkdirSync(path.join(locked, "inner"), { recursive: true });
  fs.chmodSync(locked, 0);
  try {
    if (process.getuid?.() !== 0) {
      assert.equal(enterableFolder(locked), folder);
      assert.equal(enterableFolder(path.join(locked, "inner")), folder);
      assert.equal(terminalLaunch(moire, locked).cwd, folder);
    }
  } finally {
    fs.chmodSync(locked, 0o755);
  }
  assert.equal(enterableFolder(path.join(folder, "missing", "deeper")), folder);
  // Other emulators are started in the folder, without file arguments.
  assert.deepEqual(terminalLaunch(xterm, folder), { command: "xterm", cwd: folder, name: "XTerm" });
} finally {
  fs.rmSync(folder, { recursive: true, force: true });
}
console.log("app-discovery: terminal discovery and Open in Terminal command ok");
