/** Files' backend: folder listings, Trash listings, view preferences and launch arguments. */
import fs from "node:fs/promises";
import syncFs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { listTrash, trashDisplayName, type TrashLocation } from "@moire/file-operations";

export type Entry = {
  /** The name shown; for a Trash entry, its original name. */
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
  /** Set for items listed from Trash. */
  trash?: { originalPath: string | null; deletedAt: number | null };
};
export type SortField = "name" | "size" | "modified" | "type";
export type ViewMode = "list" | "grid" | "columns";
export const VIEW_MODES: readonly ViewMode[] = ["list", "grid", "columns"];
export type FilesPreferences = {
  view: ViewMode;
  sort: SortField;
  descending: boolean;
  hidden: boolean;
  /** The rail shows labels, as a sidebar (Ctrl+B). */
  railExpanded: boolean;
};
export const defaultPreferences: FilesPreferences = {
  view: "list",
  sort: "name",
  descending: false,
  hidden: false,
  railExpanded: false,
};
const preferencesPath = () =>
  path.join(
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
    "moire",
    "files-view.json",
  );
let pendingPreferences: Promise<void> = Promise.resolve();
export async function loadViewPreferences(): Promise<FilesPreferences> {
  try {
    const value = JSON.parse(await fs.readFile(preferencesPath(), "utf8"));
    return {
      view: VIEW_MODES.includes(value.view) ? value.view : defaultPreferences.view,
      sort: ["size", "modified", "type"].includes(value.sort) ? value.sort : "name",
      descending: value.descending === true,
      hidden: value.hidden === true,
      railExpanded: value.railExpanded === true,
    };
  } catch {
    return defaultPreferences;
  }
}
export function saveViewPreferences(value: FilesPreferences): Promise<void> {
  const file = preferencesPath();
  const write = pendingPreferences
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(value), { flag: "wx" });
        await fs.rename(temporary, file);
      } finally {
        await fs.rm(temporary, { force: true });
      }
    });
  pendingPreferences = write;
  return write;
}
export function fileType(entry: Entry): string {
  if (entry.isDir) return "Folder";
  const extension = path.extname(entry.name).slice(1).toUpperCase();
  return extension ? `${extension} file` : "File";
}
export async function readDirectory(directory: string, hidden: boolean): Promise<Entry[]> {
  const names = await fs.readdir(directory, { withFileTypes: true });
  const entries: Entry[] = [];
  for (const item of names) {
    if (!hidden && item.name.startsWith(".")) continue;
    const file = path.join(directory, item.name);
    try {
      const stat = await fs.stat(file);
      entries.push({
        name: item.name,
        path: file,
        isDir: stat.isDirectory(),
        size: stat.size,
        modified: stat.mtimeMs,
      });
    } catch (error) {
      // A disappearing directory entry is normal during a refresh. Other
      // failures belong in the visible error state, not an empty-folder lie.
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return entries;
}
export function sortEntries(
  entries: readonly Entry[],
  field: SortField,
  descending: boolean,
): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    const value =
      field === "size"
        ? a.size - b.size
        : field === "modified"
          ? a.modified - b.modified
          : field === "type"
            ? fileType(a).localeCompare(fileType(b))
            : a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
    return (value || a.name.localeCompare(b.name)) * (descending ? -1 : 1);
  });
}

/** Trash as a folder listing: original names, where each item came from and when it was deleted. */
export async function readTrash(trash: TrashLocation): Promise<Entry[]> {
  return (await listTrash(trash)).map((item) => ({
    name: trashDisplayName(item),
    path: item.path,
    isDir: item.isDir,
    size: item.size,
    modified: item.deletedAt ?? 0,
    trash: { originalPath: item.originalPath, deletedAt: item.deletedAt },
  }));
}

export type LaunchTarget = {
  directory: string;
  /** An item to select once the folder is listed. */
  select: string | null;
  /** Open with the inspector showing (the desktop's Properties). */
  properties: boolean;
};

/**
 * `moire-files [--select | --properties] [path-or-file-uri]`: a folder opens
 * as is and a file opens its folder with the file selected. `--select` reveals
 * any item (a folder too) in its parent; `--properties` also shows its details.
 */
export function launchTarget(argv: readonly string[], fallback: string): LaunchTarget {
  const properties = argv.includes("--properties");
  const reveal = properties || argv.includes("--select");
  const raw = argv.find((arg) => arg.length > 0 && !arg.startsWith("-"));
  const fallbackTarget = { directory: fallback, select: null, properties };
  if (!raw) return fallbackTarget;
  let requested: string;
  try {
    requested = raw.startsWith("file:") ? fileURLToPath(raw) : path.resolve(raw);
  } catch {
    return fallbackTarget;
  }
  try {
    const stat = syncFs.statSync(requested);
    return stat.isDirectory() && !reveal
      ? { directory: requested, select: null, properties }
      : { directory: path.dirname(requested), select: requested, properties };
  } catch {
    return fallbackTarget;
  }
}

/** Expand `~` and resolve a typed location against the current folder. */
export function expandLocation(value: string, cwd: string): string {
  const expanded =
    value === "~"
      ? os.homedir()
      : value.startsWith(`~${path.sep}`)
        ? path.join(os.homedir(), value.slice(2))
        : value;
  return path.resolve(cwd, expanded);
}

/**
 * Tab completion for the location field: extend the last segment to the
 * longest prefix shared by the matching subfolders, adding a slash once
 * exactly one folder matches. Null when nothing matches.
 */
export function completeLocation(draft: string, cwd: string, hidden: boolean): string | null {
  const slash = draft.lastIndexOf("/");
  const typedParent = slash >= 0 ? draft.slice(0, slash + 1) : "";
  const prefix = draft.slice(slash + 1);
  let names: string[];
  try {
    names = syncFs
      .readdirSync(expandLocation(typedParent || ".", cwd), { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith(prefix) &&
          (hidden || prefix.startsWith(".") || !entry.name.startsWith(".")),
      )
      .map((entry) => entry.name)
      .sort();
  } catch {
    return null;
  }
  if (!names.length) return null;
  if (names.length === 1) return `${typedParent}${names[0]}/`;
  let shared = names[0]!;
  for (const name of names) while (!name.startsWith(shared)) shared = shared.slice(0, -1);
  return `${typedParent}${shared}`;
}
