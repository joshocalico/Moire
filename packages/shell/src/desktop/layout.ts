/**
 * Desktop icon geometry. Icons live on a grid of cells, filled column by
 * column from the top left. Saved positions are cells, not pixels, so a
 * layout survives a resolution change: a cell that no longer fits is placed
 * again automatically, and comes back when the screen grows.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const ICON_SIZE = 52;
export const DESKTOP_ITEM_W = 112;
export const DESKTOP_ITEM_H = 100;
const MARGIN_X = 28;
const MARGIN_Y = 28;
const GAP_X = 16;
const GAP_Y = 16;

export type DesktopCell = { col: number; row: number };
export type DesktopPoint = { x: number; y: number };

/** The grid for one screen. Every size is in output pixels at the current UI scale. */
export type DesktopGrid = {
  cols: number;
  rows: number;
  itemW: number;
  itemH: number;
  iconSize: number;
  cellW: number;
  cellH: number;
  marginX: number;
  marginY: number;
};

export function desktopGrid(screenW: number, availH: number, scale = 1): DesktopGrid {
  const px = (value: number) => Math.round(value * scale);
  const itemW = px(DESKTOP_ITEM_W);
  const itemH = px(DESKTOP_ITEM_H);
  const cellW = itemW + px(GAP_X);
  const cellH = itemH + px(GAP_Y);
  const marginX = px(MARGIN_X);
  const marginY = px(MARGIN_Y);
  return {
    cols: Math.max(1, Math.floor((screenW - marginX + px(GAP_X)) / cellW)),
    rows: Math.max(1, Math.floor((availH - marginY + px(GAP_Y)) / cellH)),
    itemW,
    itemH,
    iconSize: px(ICON_SIZE),
    cellW,
    cellH,
    marginX,
    marginY,
  };
}

export function cellOrigin(grid: DesktopGrid, cell: DesktopCell): DesktopPoint {
  return { x: grid.marginX + cell.col * grid.cellW, y: grid.marginY + cell.row * grid.cellH };
}

/** The cell under a point (clamped onto the grid). */
export function cellAt(grid: DesktopGrid, x: number, y: number): DesktopCell {
  return {
    col: Math.max(0, Math.min(grid.cols - 1, Math.floor((x - grid.marginX) / grid.cellW))),
    row: Math.max(0, Math.min(grid.rows - 1, Math.floor((y - grid.marginY) / grid.cellH))),
  };
}

const cellKey = (cell: DesktopCell) => `${cell.col}:${cell.row}`;
export const sameCell = (a: DesktopCell, b: DesktopCell) => a.col === b.col && a.row === b.row;
const fits = (grid: DesktopGrid, cell: DesktopCell) =>
  cell.col >= 0 && cell.row >= 0 && cell.col < grid.cols && cell.row < grid.rows;

/** Column-major order: how desktops fill icons, top to bottom, then left to right. */
export function gridCells(grid: DesktopGrid): DesktopCell[] {
  const cells: DesktopCell[] = [];
  for (let col = 0; col < grid.cols; col++)
    for (let row = 0; row < grid.rows; row++) cells.push({ col, row });
  return cells;
}

export type DesktopPlacement = {
  /** Cell of every visible icon. */
  cells: Map<string, DesktopCell>;
  /** Icons that do not fit on screen, gathered behind the overflow tile. */
  overflow: string[];
  /** Where the overflow tile sits, when there is one. */
  overflowCell: DesktopCell | null;
};

/**
 * Give each entry a cell: its saved one when that cell is on screen and not
 * taken, otherwise the first free cell. Icons never overlap. When there are
 * more entries than cells, the last cell becomes an overflow tile.
 */
export function placeIcons(
  entries: readonly string[],
  saved: Readonly<Record<string, DesktopCell>>,
  grid: DesktopGrid,
): DesktopPlacement {
  const all = gridCells(grid);
  const capacity = all.length;
  const overflowCell = entries.length > capacity ? all[capacity - 1]! : null;
  const taken = new Set<string>(overflowCell ? [cellKey(overflowCell)] : []);
  const cells = new Map<string, DesktopCell>();
  const unplaced: string[] = [];
  for (const name of entries) {
    const cell = saved[name];
    if (cell && fits(grid, cell) && !taken.has(cellKey(cell))) {
      taken.add(cellKey(cell));
      cells.set(name, cell);
    } else unplaced.push(name);
  }
  const free = all.filter((cell) => !taken.has(cellKey(cell)));
  const overflow: string[] = [];
  for (const name of unplaced) {
    const cell = free.shift();
    if (cell) cells.set(name, cell);
    else overflow.push(name);
  }
  return { cells, overflow, overflowCell };
}

/** Name of the icon under a point, or null. */
export function iconAt(
  placement: DesktopPlacement,
  grid: DesktopGrid,
  x: number,
  y: number,
): string | null {
  for (const [name, cell] of placement.cells) {
    const origin = cellOrigin(grid, cell);
    if (x >= origin.x && y >= origin.y && x < origin.x + grid.itemW && y < origin.y + grid.itemH)
      return name;
  }
  return null;
}

export function overflowAt(
  placement: DesktopPlacement,
  grid: DesktopGrid,
  x: number,
  y: number,
): boolean {
  if (!placement.overflowCell) return false;
  const origin = cellOrigin(grid, placement.overflowCell);
  return x >= origin.x && y >= origin.y && x < origin.x + grid.itemW && y < origin.y + grid.itemH;
}

/**
 * Move a group of icons by a whole number of cells. The dragged icons keep
 * their arrangement; any that would land off screen or on another icon take
 * the nearest free cell instead.
 */
export function moveCells(
  moving: ReadonlyMap<string, DesktopCell>,
  delta: DesktopCell,
  occupied: ReadonlyMap<string, DesktopCell>,
  grid: DesktopGrid,
): Map<string, DesktopCell> {
  const taken = new Set<string>();
  for (const [name, cell] of occupied) if (!moving.has(name)) taken.add(cellKey(cell));
  const result = new Map<string, DesktopCell>();
  const all = gridCells(grid);
  for (const [name, cell] of moving) {
    const wanted = { col: cell.col + delta.col, row: cell.row + delta.row };
    let target: DesktopCell | undefined =
      fits(grid, wanted) && !taken.has(cellKey(wanted)) ? wanted : undefined;
    if (!target) {
      const clamped = {
        col: Math.max(0, Math.min(grid.cols - 1, wanted.col)),
        row: Math.max(0, Math.min(grid.rows - 1, wanted.row)),
      };
      target = all
        .filter((candidate) => !taken.has(cellKey(candidate)))
        .sort(
          (a, b) =>
            Math.hypot(a.col - clamped.col, a.row - clamped.row) -
            Math.hypot(b.col - clamped.col, b.row - clamped.row),
        )[0];
    }
    if (!target) continue;
    taken.add(cellKey(target));
    result.set(name, target);
  }
  return result;
}

/** Free cells for new arrivals at a drop point, nearest first, never on an occupied cell. */
export function landingCells(
  count: number,
  at: DesktopCell,
  occupied: Iterable<DesktopCell>,
  grid: DesktopGrid,
): DesktopCell[] {
  const taken = new Set([...occupied].map(cellKey));
  // Fill downward from the drop cell first, as a column of arrivals reads naturally.
  return gridCells(grid)
    .filter((cell) => !taken.has(cellKey(cell)))
    .sort((a, b) => {
      const order = (cell: DesktopCell) =>
        ((cell.col - at.col + grid.cols) % grid.cols) * grid.rows +
        ((cell.row - at.row + grid.rows) % grid.rows);
      return order(a) - order(b);
    })
    .slice(0, count);
}

/* ---------- Persistence ---------- */

export type SavedDesktopLayout = Record<string, DesktopCell>;

export function desktopLayoutPath(): string {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "moire", "desktop-layout.json");
}

/** Version 1 stored pixel positions; convert them to the cells they sat on. */
function fromStored(value: unknown): SavedDesktopLayout {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  const layout: SavedDesktopLayout = {};
  if (record.version === 2 && record.cells && typeof record.cells === "object") {
    for (const [name, cell] of Object.entries(record.cells as Record<string, unknown>)) {
      const { col, row } = (cell ?? {}) as Partial<DesktopCell>;
      if (Number.isInteger(col) && Number.isInteger(row) && col! >= 0 && row! >= 0)
        layout[name] = { col: col!, row: row! };
    }
    return layout;
  }
  for (const [name, point] of Object.entries(record)) {
    const { x, y } = (point ?? {}) as Partial<DesktopPoint>;
    if (typeof x !== "number" || typeof y !== "number") continue;
    layout[name] = {
      col: Math.max(0, Math.round((x - MARGIN_X) / (DESKTOP_ITEM_W + GAP_X))),
      row: Math.max(0, Math.round((y - MARGIN_Y) / (DESKTOP_ITEM_H + GAP_Y))),
    };
  }
  return layout;
}

export function loadDesktopLayout(): SavedDesktopLayout {
  try {
    return fromStored(JSON.parse(fs.readFileSync(desktopLayoutPath(), "utf8")));
  } catch {
    return {};
  }
}

let pendingSave: Promise<void> = Promise.resolve();

/** Persist asynchronously and atomically; saves are serialized so the last one wins. */
export function saveDesktopLayout(layout: SavedDesktopLayout): Promise<void> {
  const file = desktopLayoutPath();
  const body = `${JSON.stringify({ version: 2, cells: layout }, null, 2)}\n`;
  pendingSave = pendingSave
    .catch(() => {})
    .then(async () => {
      await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${process.pid}.tmp`;
      await fsp.writeFile(temporary, body, "utf8");
      await fsp.rename(temporary, file);
    });
  return pendingSave;
}
