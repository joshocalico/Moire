/**
 * The home Trash, as the freedesktop.org Trash specification defines it:
 * `$XDG_DATA_HOME/Trash/files` holds the items and `Trash/info` holds one
 * `.trashinfo` file per item with its original path and deletion date.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { moveWithoutReplacing, pathExists } from "./paths";
import { uniqueName } from "./names";

export type TrashLocation = {
  readonly root: string;
  readonly files: string;
  readonly info: string;
};

export function homeTrash(): TrashLocation {
  const root = path.join(
    process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
    "Trash",
  );
  return trashAt(root);
}

export function trashAt(root: string): TrashLocation {
  return {
    root,
    files: path.join(root, "files"),
    info: path.join(root, "info"),
  };
}

export type TrashItem = {
  /** Name inside `Trash/files`; unique, and not necessarily the original name. */
  readonly trashName: string;
  /** Current location inside `Trash/files`. */
  readonly path: string;
  /** Where the item came from; null when its `.trashinfo` is missing or unreadable. */
  readonly originalPath: string | null;
  /** Deletion time in milliseconds; null when the date is missing or invalid. */
  readonly deletedAt: number | null;
  readonly isDir: boolean;
  readonly size: number;
};

/** The name the user knows the item by. */
export function trashDisplayName(item: TrashItem): string {
  return item.originalPath ? path.basename(item.originalPath) : item.trashName;
}

export function isInTrash(file: string, trash: TrashLocation = homeTrash()): boolean {
  const resolved = path.resolve(file);
  return resolved === trash.root || resolved.startsWith(trash.root + path.sep);
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The spec's DeletionDate is local time without a zone: YYYY-MM-DDThh:mm:ss. */
export function formatDeletionDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseDeletionDate(value: string | undefined): number | null {
  const match = value && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds] = match.map(Number);
  const time = new Date(year!, month! - 1, day!, hours!, minutes!, seconds!).getTime();
  return Number.isFinite(time) ? time : null;
}

/** Path keys are URL-escaped (RFC 2396) with slashes kept readable. */
function encodeTrashPath(file: string): string {
  return encodeURIComponent(file).replaceAll("%2F", "/");
}

function parseTrashInfo(text: string): {
  originalPath: string | null;
  deletedAt: number | null;
} {
  if (!/^\[Trash Info\]\s*$/m.test(text)) return { originalPath: null, deletedAt: null };
  const value = (key: string) => new RegExp(`^${key}=(.*)$`, "m").exec(text)?.[1]?.trim();
  let originalPath: string | null = null;
  try {
    const decoded = decodeURIComponent(value("Path") ?? "");
    originalPath = path.isAbsolute(decoded) ? decoded : null;
  } catch {
    originalPath = null;
  }
  return { originalPath, deletedAt: parseDeletionDate(value("DeletionDate")) };
}

async function ensureTrash(trash: TrashLocation): Promise<void> {
  await fs.mkdir(trash.files, { recursive: true, mode: 0o700 });
  await fs.mkdir(trash.info, { recursive: true, mode: 0o700 });
}

async function readItem(trash: TrashLocation, trashName: string): Promise<TrashItem | null> {
  const file = path.join(trash.files, trashName);
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let info = {
    originalPath: null as string | null,
    deletedAt: null as number | null,
  };
  try {
    info = parseTrashInfo(
      await fs.readFile(path.join(trash.info, `${trashName}.trashinfo`), "utf8"),
    );
  } catch {
    // An item without metadata is still in Trash; it can be deleted but not restored.
  }
  return {
    trashName,
    path: file,
    ...info,
    isDir: stat.isDirectory(),
    size: stat.isFile() ? stat.size : 0,
  };
}

/**
 * Move one item into Trash. The `.trashinfo` file is created exclusively
 * first, which reserves the name the spec requires to be unique.
 */
export async function trashItem(
  source: string,
  trash: TrashLocation = homeTrash(),
): Promise<TrashItem> {
  const resolved = path.resolve(source);
  if (isInTrash(resolved, trash)) throw new Error("This item is already in Trash.");
  const stat = await fs.lstat(resolved);
  await ensureTrash(trash);
  const base = path.basename(resolved);
  const extension = stat.isDirectory() ? "" : path.extname(base);
  const stem = base.slice(0, base.length - extension.length);
  for (let attempt = 1; ; attempt++) {
    const trashName = attempt === 1 ? base : `${stem}.${attempt}${extension}`;
    const info = path.join(trash.info, `${trashName}.trashinfo`);
    try {
      await fs.writeFile(
        info,
        `[Trash Info]\nPath=${encodeTrashPath(resolved)}\nDeletionDate=${formatDeletionDate(new Date())}\n`,
        { flag: "wx", mode: 0o600 },
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw error;
    }
    const destination = path.join(trash.files, trashName);
    if (await pathExists(destination)) {
      // An orphaned item keeps its name; release the reservation and try the next one.
      await fs.unlink(info);
      continue;
    }
    try {
      await moveWithoutReplacing(resolved, destination);
    } catch (error) {
      await fs.unlink(info).catch(() => {});
      if ((error as NodeJS.ErrnoException).code === "EXDEV")
        throw new Error(
          `“${base}” is on another drive and cannot be moved to Trash. Delete it permanently instead.`,
        );
      throw error;
    }
    return {
      trashName,
      path: destination,
      originalPath: resolved,
      deletedAt: Date.now(),
      isDir: stat.isDirectory(),
      size: stat.isFile() ? stat.size : 0,
    };
  }
}

/** Items in Trash, newest deletion first. */
export async function listTrash(trash: TrashLocation = homeTrash()): Promise<TrashItem[]> {
  let names: string[];
  try {
    names = await fs.readdir(trash.files);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const items = (await Promise.all(names.map((name) => readItem(trash, name)))).filter(
    (item): item is TrashItem => item !== null,
  );
  return items.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0));
}

export async function trashCount(trash: TrashLocation = homeTrash()): Promise<number> {
  try {
    return (await fs.readdir(trash.files)).length;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
}

/** Find the Trash entry for a path inside `Trash/files`. */
export async function trashItemAt(
  file: string,
  trash: TrashLocation = homeTrash(),
): Promise<TrashItem> {
  const resolved = path.resolve(file);
  if (path.dirname(resolved) !== trash.files) throw new Error("Select an item in Trash.");
  const item = await readItem(trash, path.basename(resolved));
  if (!item) throw new Error("This item is no longer in Trash. Refresh and try again.");
  return item;
}

export type RestoreResult = {
  readonly item: TrashItem;
  readonly restoredTo: string;
};

/**
 * Put an item back where it came from, recreating missing parent folders.
 * When something new already occupies the original path, the item is
 * restored beside it under a numbered name rather than replacing it.
 */
export async function restoreTrashItem(
  item: TrashItem,
  trash: TrashLocation = homeTrash(),
): Promise<RestoreResult> {
  if (!item.originalPath)
    throw new Error(
      `“${item.trashName}” has no record of where it came from. Move it out of Trash instead.`,
    );
  const directory = path.dirname(item.originalPath);
  await fs.mkdir(directory, { recursive: true });
  const name = await uniqueName(directory, path.basename(item.originalPath), {
    directory: item.isDir,
  });
  const restoredTo = path.join(directory, name);
  await moveWithoutReplacing(item.path, restoredTo);
  await fs.rm(path.join(trash.info, `${item.trashName}.trashinfo`), {
    force: true,
  });
  return { item, restoredTo };
}

/** Remove an item and its metadata from Trash for good. */
export async function deleteTrashItem(
  item: TrashItem,
  trash: TrashLocation = homeTrash(),
): Promise<void> {
  await fs.rm(item.path, { recursive: true, force: true });
  await fs.rm(path.join(trash.info, `${item.trashName}.trashinfo`), {
    force: true,
  });
}

/** Permanently delete everything in Trash, including orphaned metadata. Returns the item count. */
export async function emptyTrash(
  trash: TrashLocation = homeTrash(),
  signal?: AbortSignal,
): Promise<number> {
  const items = await listTrash(trash);
  let removed = 0;
  for (const item of items) {
    if (signal?.aborted) break;
    await deleteTrashItem(item, trash);
    removed++;
  }
  if (!signal?.aborted) {
    try {
      for (const name of await fs.readdir(trash.info))
        await fs.rm(path.join(trash.info, name), { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return removed;
}
