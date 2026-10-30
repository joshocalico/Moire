/** Pure desktop behaviour: entries, spatial navigation, rubber band, type-to-select and sorting. */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { FileSortField } from "@moire/file-operations";
import { cellOrigin, type DesktopCell, type DesktopGrid, type DesktopPlacement } from "./layout";

export type DesktopEntry = {
  name: string;
  isDir: boolean;
  size: number;
  modified: number;
};

function visible(name: string): boolean {
  return !name.startsWith(".");
}

const byName = (a: DesktopEntry, b: DesktopEntry) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
/** Folders first, then by name — the order new icons fill the grid, as in Files. */
const listingOrder = (a: DesktopEntry, b: DesktopEntry) =>
  a.isDir !== b.isDir ? (a.isDir ? -1 : 1) : byName(a, b);

function entryFor(name: string, stat: fs.Stats): DesktopEntry {
  return {
    name,
    isDir: stat.isDirectory(),
    size: stat.isFile() ? stat.size : 0,
    modified: stat.mtimeMs,
  };
}

/** Startup listing: synchronous once, so the first frame already shows the icons. */
export function readDesktopEntriesSync(directory: string): DesktopEntry[] {
  try {
    fs.mkdirSync(directory, { recursive: true });
    return fs
      .readdirSync(directory)
      .filter(visible)
      .flatMap((name) => {
        try {
          return [entryFor(name, fs.statSync(path.join(directory, name)))];
        } catch {
          return [];
        }
      })
      .sort(listingOrder);
  } catch {
    return [];
  }
}

/** Refresh listing, off the input path. */
export async function readDesktopEntries(directory: string): Promise<DesktopEntry[]> {
  let names: string[];
  try {
    names = (await fsp.readdir(directory)).filter(visible);
  } catch {
    return [];
  }
  const entries = await Promise.all(
    names.map(async (name) => {
      try {
        return entryFor(name, await fsp.stat(path.join(directory, name)));
      } catch {
        return null;
      }
    }),
  );
  return entries.filter((entry): entry is DesktopEntry => entry !== null).sort(listingOrder);
}

export function sameEntries(a: readonly DesktopEntry[], b: readonly DesktopEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (entry, index) =>
        entry.name === b[index]!.name &&
        entry.isDir === b[index]!.isDir &&
        entry.size === b[index]!.size &&
        entry.modified === b[index]!.modified,
    )
  );
}

export type Direction = "left" | "right" | "up" | "down";

/** The nearest icon in a direction, preferring ones in line with the current icon. */
export function spatialNeighbor(
  from: string,
  direction: Direction,
  placement: DesktopPlacement,
): string | null {
  const origin = placement.cells.get(from);
  if (!origin) return placement.cells.keys().next().value ?? null;
  let best: { name: string; score: number } | null = null;
  for (const [name, cell] of placement.cells) {
    if (name === from) continue;
    const dx = cell.col - origin.col;
    const dy = cell.row - origin.row;
    const primary =
      direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
    if (primary <= 0) continue;
    const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = primary + cross * 2;
    if (!best || score < best.score) best = { name, score };
  }
  return best?.name ?? from;
}

export type Rect = { x: number; y: number; width: number; height: number };

export function rectFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Icons whose tiles intersect a rubber-band rectangle, in placement order. */
export function namesInRect(rect: Rect, placement: DesktopPlacement, grid: DesktopGrid): string[] {
  const names: string[] = [];
  for (const [name, cell] of placement.cells) {
    const origin = cellOrigin(grid, cell);
    if (
      origin.x < rect.x + rect.width &&
      origin.x + grid.itemW > rect.x &&
      origin.y < rect.y + rect.height &&
      origin.y + grid.itemH > rect.y
    )
      names.push(name);
  }
  return names;
}

/** Typing selects the next name starting with what was typed, as file managers do. */
export function typeaheadMatch(
  names: readonly string[],
  prefix: string,
  current: string | null,
): string | null {
  const needle = prefix.toLocaleLowerCase();
  if (!needle) return null;
  const start = current ? names.indexOf(current) : -1;
  // A repeated single letter cycles; a longer prefix keeps the current match if it still fits.
  const cycling = needle.length > 1 && [...needle].every((char) => char === needle[0]);
  const query = cycling ? needle[0]! : needle;
  const offset = cycling || needle.length === 1 ? 1 : 0;
  for (let step = 0; step < names.length; step++) {
    const name = names[(start + offset + step + names.length) % names.length]!;
    if (name.toLocaleLowerCase().startsWith(query)) return name;
  }
  return null;
}

/** Entries in the order Sort By arranges them; folders first, as in Files. */
export function sortDesktopEntries(
  entries: readonly DesktopEntry[],
  field: FileSortField,
  descending: boolean,
): DesktopEntry[] {
  const type = (entry: DesktopEntry) => (entry.isDir ? "" : path.extname(entry.name).toLowerCase());
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    const value =
      field === "size"
        ? a.size - b.size
        : field === "modified"
          ? a.modified - b.modified
          : field === "type"
            ? type(a).localeCompare(type(b))
            : 0;
    return (value || byName(a, b)) * (descending ? -1 : 1);
  });
}

/** Cells for an arrangement: the given order, packed column by column. */
export function arrangedLayout(
  order: readonly string[],
  cells: readonly DesktopCell[],
): Record<string, DesktopCell> {
  const layout: Record<string, DesktopCell> = {};
  order.forEach((name, index) => {
    const cell = cells[index];
    if (cell) layout[name] = cell;
  });
  return layout;
}
