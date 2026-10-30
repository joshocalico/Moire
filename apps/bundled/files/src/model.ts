/** Pure Files logic: places, breadcrumbs, icons, drop decisions, pages and tab labels. */
import path from "node:path";
import { fileIconName } from "@moire/file-operations";
import type { BreadcrumbSegment, IconName } from "@moire/ui";
import type { Entry } from "./filesystem";
import type { FilePlace } from "./places";

/** Longest matching place wins (Home must not stay selected under Desktop). */
export function activePlaceId(cwd: string, places: readonly FilePlace[]): string | null {
  let best: FilePlace | null = null;
  for (const place of places) {
    if (cwd === place.path || cwd.startsWith(place.path + path.sep)) {
      if (!best || place.path.length > best.path.length) best = place;
    }
  }
  return best?.id ?? null;
}

/** A tab or window subtitle: the place name for a place, the folder name otherwise. */
export function folderLabel(
  cwd: string,
  places: readonly FilePlace[],
  trashDirectory: string,
): string {
  if (cwd === trashDirectory) return "Trash";
  return places.find((place) => place.path === cwd)?.label ?? (path.basename(cwd) || "Filesystem");
}

export function breadcrumbSegments(
  cwd: string,
  home: string,
  trashDirectory: string,
): BreadcrumbSegment[] {
  if (cwd === trashDirectory) return [{ id: cwd, label: "Trash" }];
  const resolved = path.resolve(cwd);
  const insideHome = resolved === home || resolved.startsWith(home + path.sep);
  const root = insideHome ? home : path.parse(resolved).root;
  const segments: BreadcrumbSegment[] = [{ id: root, label: insideHome ? "Home" : root }];
  let current = root;
  for (const part of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    segments.push({ id: current, label: part });
  }
  return segments;
}

/** Files and the desktop draw the same artwork for the same kind of file. */
export function iconFor(entry: Pick<Entry, "name" | "isDir">): IconName {
  return fileIconName(entry.name, entry.isDir) as IconName;
}

/**
 * Whether dropping `sources` into `directory` would change anything. Items
 * already in that folder, or a folder dropped into itself or its own
 * subfolder, are not real destinations and get no highlight or action.
 */
export function dropChangesSomething(sources: readonly string[], directory: string): boolean {
  const target = path.resolve(directory);
  return sources.some((source) => {
    const resolved = path.resolve(source);
    if (path.dirname(resolved) === target) return false;
    return !(target === resolved || target.startsWith(resolved + path.sep));
  });
}

/** A drop is valid only when no source would land inside itself. */
export function dropIsValid(sources: readonly string[], directory: string): boolean {
  const target = path.resolve(directory);
  return sources.every((source) => {
    const resolved = path.resolve(source);
    return target !== resolved && !target.startsWith(resolved + path.sep);
  });
}

/** A rectangle from two corners, in either drag direction. */
export function rectFromPoints(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { x: number; y: number; width: number; height: number } {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  };
}

export const ENTRY_FOCUS_PREFIX = "file:";
export const entryFocusId = (file: string) => `${ENTRY_FOCUS_PREFIX}${file}`;

/** What the page shows for a location. */
export type PageKind = "overview" | "folder" | "trash" | "recent" | "drive";

export function pageKind(options: {
  cwd: string;
  home: string;
  trashDirectory: string;
  special: "recent" | null;
  /** Mount points of removable drives. */
  driveRoots: readonly string[];
}): PageKind {
  if (options.special === "recent") return "recent";
  if (options.cwd === options.trashDirectory) return "trash";
  if (options.cwd === options.home) return "overview";
  if (options.driveRoots.includes(options.cwd)) return "drive";
  return "folder";
}

/** Past this many folders, only the first few get cards, then a "Show all N folders" card. */
const FOLDER_CARD_LIMIT = 12;
const FOLDER_CARDS_FOLDED = 8;

/** Which folders get a card, and how many wait behind "Show all N folders". */
export function visibleFolders<T>(folders: readonly T[], showAll: boolean) {
  if (showAll || folders.length <= FOLDER_CARD_LIMIT) return { shown: folders, hidden: 0 };
  return {
    shown: folders.slice(0, FOLDER_CARDS_FOLDED),
    hidden: folders.length - FOLDER_CARDS_FOLDED,
  };
}
