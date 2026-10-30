import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileKind, type FileKind } from "./kinds";

/** A file an app recorded as opened (see `rememberRecentFile` in `@moire/app-tools`). */
export type OpenedFile = {
  path: string;
  /** The app id the list belongs to, from its file name. */
  app: string;
  /**
   * When it was opened, estimated: the lists keep order but no times, so the newest entry takes
   * the list's write time and later entries step back a millisecond each, keeping their order.
   */
  openedAt: number;
};

/** Lists are capped at 12 by the writer; a hand-edited one should not cost more than this. */
const MAX_ENTRIES_PER_LIST = 64;

export function recentDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const state = env.XDG_STATE_HOME || path.join(env.HOME || os.homedir(), ".local", "state");
  return path.join(state, "moire", "recent");
}

/** Every app's recent list, merged newest first and de-duplicated by path. */
export async function readOpenedFiles(directory = recentDirectory()): Promise<OpenedFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch {
    return [];
  }
  const opened = new Map<string, OpenedFile>();
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(directory, name);
    let list: unknown;
    let written: number;
    try {
      written = (await fs.stat(file)).mtimeMs;
      list = JSON.parse(await fs.readFile(file, "utf8"));
    } catch {
      // One unreadable list must not hide the others.
      continue;
    }
    if (!Array.isArray(list)) continue;
    const app = name.slice(0, -".json".length);
    list.slice(0, MAX_ENTRIES_PER_LIST).forEach((entry, index) => {
      if (typeof entry !== "string" || !path.isAbsolute(entry)) return;
      const openedAt = written - index;
      const previous = opened.get(entry);
      if (!previous || previous.openedAt < openedAt)
        opened.set(entry, { path: entry, app, openedAt });
    });
  }
  return [...opened.values()].sort((a, b) => b.openedAt - a.openedAt);
}

/** A recent file as Files lists it, whether the index or the apps' own lists supplied it. */
export type RecentFile = {
  path: string;
  name: string;
  kind: FileKind;
  size: number;
  modified: number;
  /** The later of when it was opened through an app and when it was modified. */
  usedAt: number;
  source: "opened" | "modified";
  app: string | null;
};

/** Opened files that still exist, with their current size and time; moved or deleted ones drop out. */
export async function openedRecentFiles(
  opened: readonly OpenedFile[],
  limit: number,
): Promise<RecentFile[]> {
  const entries = await Promise.all(
    opened.slice(0, limit).map(async (item): Promise<RecentFile | null> => {
      try {
        const stat = await fs.stat(item.path);
        if (!stat.isFile()) return null;
        return {
          path: item.path,
          name: path.basename(item.path),
          kind: fileKind(item.path, false),
          size: stat.size,
          modified: stat.mtimeMs,
          usedAt: Math.max(item.openedAt, stat.mtimeMs),
          source: "opened",
          app: item.app,
        };
      } catch {
        return null;
      }
    }),
  );
  return entries.filter((entry): entry is RecentFile => entry !== null);
}
