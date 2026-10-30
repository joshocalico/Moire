/**
 * "Open in Terminal": the installed terminal emulator and the command that opens it in a folder.
 * Moire's Terminal takes the folder as `--working-directory`; any other emulator is started with
 * the folder as its working directory, which is where terminals open their first shell.
 */
import fs from "node:fs";
import path from "node:path";
import { discoverApplications } from "./applications";
import type { DesktopEntry } from "./desktop";

const MOIRE_TERMINAL_ID = "moire-terminal.desktop";
const TERMINAL_CATEGORY = "TerminalEmulator";

export type TerminalLaunch = {
  /** A shell command line. */
  command: string;
  cwd: string;
  /** The terminal's name, for messages ("Could not start Terminal"). */
  name: string;
};

/** Moire's Terminal when installed, else the first terminal emulator, else null. */
export function findTerminal(
  applications: readonly DesktopEntry[] = discoverApplications(),
): DesktopEntry | null {
  return (
    applications.find((app) => app.id === MOIRE_TERMINAL_ID) ??
    applications.find((app) => app.categories.includes(TERMINAL_CATEGORY)) ??
    null
  );
}

/**
 * The folder a shell can start in: `directory`, or its nearest ancestor that can be entered (an
 * unreadable folder's parent, from where its permissions can be looked at and fixed).
 */
export function enterableFolder(directory: string): string {
  for (let folder = path.resolve(directory); ; folder = path.dirname(folder)) {
    try {
      fs.accessSync(folder, fs.constants.X_OK);
      if (fs.statSync(folder).isDirectory()) return folder;
    } catch {
      // Not enterable: try its parent.
    }
    if (folder === path.dirname(folder)) return folder;
  }
}

export function terminalLaunch(terminal: DesktopEntry, folder: string): TerminalLaunch {
  const directory = enterableFolder(folder);
  const quoted = `'${directory.replace(/'/g, `'\\''`)}'`;
  return {
    command:
      terminal.id === MOIRE_TERMINAL_ID
        ? `${terminal.exec} --working-directory ${quoted}`
        : terminal.exec,
    cwd: directory,
    name: terminal.name,
  };
}
