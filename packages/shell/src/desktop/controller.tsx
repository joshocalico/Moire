/**
 * The desktop: icons for the Desktop folder, their selection, menus, drag
 * and drop, inline rename and keyboard, driven by the compositor through
 * the shell bridge. It behaves like a Files folder view — the same menu,
 * clipboard, operations and Trash — and never blocks input on file work.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import React, { type ReactNode } from "react";
import {
  createShellRoot,
  hitRegionContains,
  rasterize,
  renderShell,
  type HitKeyEvent,
  type HitPointerEvent,
  type HitRegion,
} from "@moire/react-host";
import {
  ContextMenu,
  createSelectionState,
  getUiScaleFactor,
  keyFromEvdev,
  reconcileSelection,
  reduceSelection,
  type ContextMenuAction,
  type SelectionAction,
  type SelectionState,
} from "@moire/ui";
import { themePalette } from "@moire/theme";
import type { FileActivationPortalClient, FileActivationService } from "@moire/app-discovery";
import {
  fileMenu,
  operationError,
  readFileClipboard,
  userDirectory,
  type FileMenuHandlers,
  type FileMenuItem,
  type FileMenuTarget,
  type FileSortField,
} from "@moire/file-operations";
import {
  cellAt,
  cellOrigin,
  desktopGrid,
  gridCells,
  iconAt,
  landingCells,
  loadDesktopLayout,
  moveCells,
  overflowAt,
  placeIcons,
  sameCell,
  saveDesktopLayout,
  type DesktopCell,
  type DesktopGrid,
  type DesktopPlacement,
  type SavedDesktopLayout,
} from "./layout";
import {
  arrangedLayout,
  namesInRect,
  readDesktopEntries,
  readDesktopEntriesSync,
  rectFromPoints,
  sameEntries,
  sortDesktopEntries,
  spatialNeighbor,
  typeaheadMatch,
  type DesktopEntry,
  type Direction,
  type Rect as Bounds,
} from "./model";
import { DesktopIcons, type DesktopRename } from "./DesktopIcons";
import {
  DesktopConfirmationView,
  DesktopToastView,
  type DesktopConfirmation,
  type DesktopToast,
} from "./overlay";
import { createDesktopWork } from "./work";
import {
  createDesktopOpener,
  desktopMenuHandlers,
  toMenuActions,
  wlCopy,
  type DesktopSpawn,
} from "./actions";
import { createDragChipRenderer, type DesktopDragChip } from "./drag-chip";

export type DesktopModifiers = { ctrl: boolean; shift: boolean; alt: boolean; meta: boolean };

export type DesktopDependencies = {
  spawn: DesktopSpawn;
  filesExec: string;
  settingsExec: string;
  activation(): FileActivationService;
  activationPortal: FileActivationPortalClient;
  modifiers(): DesktopModifiers;
  /** The top layer (menu, toast, confirmation) must repaint. */
  invalidateChrome(): void;
  /** Top-layer hit regions, rebuilt first when stale. */
  chromeHits(): HitRegion[];
  showIcons(): boolean;
  /** Put text on the session clipboard; wl-copy by default. */
  copyText?(text: string): Promise<void>;
};

export type DesktopRaster = { pixels: Uint8Array; revision: number; hits: HitRegion[] };

const KEY = {
  esc: 1,
  backspace: 14,
  tab: 15,
  enter: 28,
  a: 30,
  c: 46,
  x: 45,
  v: 47,
  z: 44,
  n: 49,
  i: 23,
  space: 57,
  f2: 60,
  f10: 68,
  home: 102,
  up: 103,
  left: 105,
  right: 106,
  end: 107,
  down: 108,
  delete: 111,
  menu: 139,
} as const;
const BTN_LEFT = 0x110;
const BTN_RIGHT = 0x111;
const DRAG_THRESHOLD = 8;
const DRAG_WATCHDOG_MS = 15_000;
const DRAG_RETURN_MS = 220;
const TYPEAHEAD_RESET_MS = 1_000;
const TOAST_MS = 6_000;
const REFRESH_MS = 2_000;
const RENAME_FIELD = "desktop:rename";

/** Local file paths from a text/uri-list payload; anything else is ignored. */
function pathsFromUris(uris: readonly string[]): string[] {
  const paths = new Set<string>();
  for (const uri of uris) {
    try {
      const url = new URL(uri.trim());
      if (url.protocol !== "file:" || url.search || url.hash) continue;
      const local = fileURLToPath(url);
      if (!local.includes("\0")) paths.add(local);
    } catch {
      // Not a local file URI.
    }
  }
  return [...paths];
}

type DragGesture = {
  name: string;
  names: string[];
  label: string;
  origins: Map<string, DesktopCell>;
  grabX: number;
  grabY: number;
  originX: number;
  originY: number;
  lastX: number;
  lastY: number;
  startedMs: number;
};

export type DesktopController = ReturnType<typeof createDesktop>;

export function createDesktop(deps: DesktopDependencies) {
  const root = createShellRoot();
  const chips = createDragChipRenderer();
  let directory = userDirectory("DESKTOP");
  let entries: DesktopEntry[] = readDesktopEntriesSync(directory);
  let saved: SavedDesktopLayout = loadDesktopLayout();
  let selection: SelectionState<string> = createSelectionState(entries.map((entry) => entry.name));
  let width = 0;
  let height = 0;
  let scale = getUiScaleFactor();
  let dirty = true;
  let raster: DesktopRaster | null = null;
  let revision = 0;
  let keyboardActive = false;
  let sort: { field: FileSortField; descending: boolean } = { field: "name", descending: false };

  let menu: { x: number; y: number; title: string; actions: ContextMenuAction[] } | null = null;
  /** Where the menu was opened, so new items appear where the user asked for them. */
  let menuCell: DesktopCell | null = null;
  let menuFocus: HitRegion | null = null;
  let confirmation: DesktopConfirmation | null = null;
  let toast: DesktopToast | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let toastId = 0;
  let rename: DesktopRename | null = null;
  let renameFocused = false;
  let typeahead = { text: "", at: 0 };

  let down: { x: number; y: number; name: string | null; hit: HitRegion | null } | null = null;
  let rubber: { start: { x: number; y: number }; rect: Bounds; base: Set<string> } | null = null;
  let drag: DragGesture | null = null;
  let dragReturn: {
    name: string;
    label: string;
    originX: number;
    originY: number;
    fromX: number;
    fromY: number;
    startedMs: number;
  } | null = null;
  /** An external drag over the desktop: the folder it would go into, or where it would land. */
  let dropHover: { target: string | null; landing: DesktopCell[] } = { target: null, landing: [] };

  const panelHeight = () => themePalette().panelHeight;
  const availH = () => Math.max(1, (height || 1) - panelHeight());
  const grid = (): DesktopGrid => desktopGrid(width || 1, availH(), scale);
  let placementCache: { key: unknown[]; value: DesktopPlacement } | null = null;
  const placement = (): DesktopPlacement => {
    const visible = deps.showIcons() ? entries.map((entry) => entry.name) : [];
    const key = [visible.join("\0"), saved, width, height, scale];
    if (!placementCache || placementCache.key.some((part, index) => part !== key[index]))
      placementCache = { key, value: placeIcons(visible, saved, grid()) };
    return placementCache.value;
  };
  /** Names in visual order (column by column), for ranges, Home/End and typing. */
  const orderedNames = () =>
    [...placement().cells]
      .sort(([, a], [, b]) => a.col - b.col || a.row - b.row)
      .map(([name]) => name);
  const entryMap = () => new Map(entries.map((entry) => [entry.name, entry] as const));
  const itemFor = (name: string): FileMenuItem => ({
    path: path.join(directory, name),
    isDir: entryMap().get(name)?.isDir ?? false,
  });

  const changed = () => {
    dirty = true;
  };

  const select = (action: SelectionAction<string>) => {
    const next = reduceSelection(selection, orderedNames(), action);
    if (next !== selection) {
      selection = next;
      changed();
    }
  };
  const selectedNames = () => orderedNames().filter((name) => selection.selectedKeys.has(name));

  /* ---------- Feedback ---------- */

  const showToast = (next: Omit<DesktopToast, "id">, sticky = false) => {
    if (toastTimer) clearTimeout(toastTimer);
    toast = { ...next, id: ++toastId };
    const id = toast.id;
    toastTimer = sticky
      ? null
      : setTimeout(() => {
          if (toast?.id === id) {
            toast = null;
            deps.invalidateChrome();
          }
        }, TOAST_MS);
    toastTimer?.unref?.();
    deps.invalidateChrome();
  };
  const dismissToast = () => {
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = null;
    toast = null;
    deps.invalidateChrome();
  };

  /* ---------- Listing and layout ---------- */

  let refreshing: Promise<void> | null = null;
  const refresh = (): Promise<void> => {
    refreshing ??= (async () => {
      try {
        directory = userDirectory("DESKTOP");
        await fsp.mkdir(directory, { recursive: true }).catch(() => {});
        const next = await readDesktopEntries(directory);
        if (sameEntries(next, entries)) return;
        entries = next;
        selection = reconcileSelection(selection, orderedNames());
        if (rename && !entries.some((entry) => entry.name === rename!.name)) rename = null;
        changed();
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  };
  setInterval(() => void refresh(), REFRESH_MS).unref?.();

  const persist = (next: SavedDesktopLayout) => {
    saved = next;
    changed();
    work.track(
      saveDesktopLayout(next).catch((error) =>
        showToast({
          message: `Could not save icon positions. ${operationError(error)}`,
          tone: "error",
        }),
      ),
    );
  };

  /** Give newly arrived icons free cells near a point, keeping everything else where it is. */
  const placeArrivals = (names: readonly string[], near: DesktopCell | null) => {
    if (!names.length) return;
    const occupied = [...placement().cells]
      .filter(([name]) => !names.includes(name))
      .map(([, cell]) => cell);
    const cells = landingCells(names.length, near ?? { col: 0, row: 0 }, occupied, grid());
    const next = { ...saved };
    names.forEach((name, index) => {
      const cell = cells[index];
      if (cell) next[name] = cell;
    });
    persist(next);
  };

  /**
   * Icons keep the cell they were first given, so removing one leaves a gap
   * instead of reflowing the rest. Saved cells off a smaller screen are kept.
   */
  const pinNewIcons = () => {
    const unsaved = [...placement().cells].filter(([name]) => !saved[name]);
    if (unsaved.length) persist({ ...saved, ...Object.fromEntries(unsaved) });
  };

  const work = createDesktopWork({
    directory: () => directory,
    names: () => entries.map((entry) => entry.name),
    refresh,
    placeArrivals,
    showToast,
    dismissToast,
  });
  const open = createDesktopOpener({
    spawn: deps.spawn,
    filesExec: deps.filesExec,
    settingsExec: deps.settingsExec,
    activation: deps.activation,
    showToast,
  });

  /* ---------- Rename ---------- */

  const startRename = (name: string) => {
    if (!placement().cells.has(name)) return;
    select({ type: "select", key: name, gesture: {} });
    rename = { name, draft: name, error: null };
    keyboardActive = true;
    changed();
  };
  const commitRename = () => {
    const current = rename;
    if (!current) return;
    const draft = current.draft.trim();
    if (draft === current.name || !draft) {
      rename = null;
      changed();
      return;
    }
    if (entries.some((entry) => entry.name === draft)) {
      rename = { ...current, error: `“${draft}” already exists` };
      changed();
      return;
    }
    rename = null;
    changed();
    void work.run(
      {
        label: "Renaming",
        run: () => work.operations.rename(path.join(directory, current.name), draft),
        done: () => `Renamed to “${draft}”`,
      },
      () => {
        // The icon keeps its place under its new name.
        const cell = saved[current.name] ?? placement().cells.get(draft);
        const next = { ...saved };
        delete next[current.name];
        if (cell) next[draft] = cell;
        persist(next);
        select({ type: "select", key: draft, gesture: {} });
      },
      () => ({ label: "Rename" }),
    );
  };

  /* ---------- Menus ---------- */

  const closeMenu = () => {
    menu = null;
    menuFocus = null;
    deps.invalidateChrome();
  };
  const closeConfirmation = () => {
    confirmation = null;
    deps.invalidateChrome();
  };

  const handlers: FileMenuHandlers = desktopMenuHandlers({
    directory: () => directory,
    work,
    open,
    activation: deps.activation,
    activationPortal: deps.activationPortal,
    showToast,
    copyText: deps.copyText ?? wlCopy,
    menuCell: () => menuCell,
    cellOf: (name) => placement().cells.get(name) ?? null,
    placeArrivals,
    startRename,
    confirm: (next) => {
      confirmation = { ...next, focus: "cancel" };
      menu = null;
      deps.invalidateChrome();
    },
    closeConfirmation,
    selectAll: () => select({ type: "all" }),
    sortBy: (field, descending) => {
      sort = { field, descending };
      const order = sortDesktopEntries(entries, field, descending).map((entry) => entry.name);
      persist(arrangedLayout(order, gridCells(grid())));
    },
    arrange: () => persist(arrangedLayout(orderedNames(), gridCells(grid()))),
    refresh: () => void refresh(),
  });

  const menuActions = (target: FileMenuTarget) =>
    toMenuActions(
      fileMenu(
        target,
        {
          directory,
          inTrash: false,
          busy: work.busy,
          clipboard: readFileClipboard(),
          undoLabel: work.operations.undoLabel,
          itemCount: placement().cells.size,
          sort,
        },
        handlers,
      ),
    );

  const openMenu = (name: string | null, x: number, y: number) => {
    if (rename) commitRename();
    keyboardActive = true;
    menuCell = cellAt(grid(), x, y);
    if (!name) select({ type: "clear" });
    else if (!selection.selectedKeys.has(name)) select({ type: "select", key: name, gesture: {} });
    const items = name ? selectedNames().map(itemFor) : [];
    menu = {
      x,
      y,
      title: name ? (items.length > 1 ? `${items.length} Items` : name) : "Desktop",
      actions: menuActions(name ? { kind: "items", items } : { kind: "folder", directory }),
    };
    menuFocus = null;
    changed();
    deps.invalidateChrome();
  };

  /** Open the menu for the keyboard: at the focused icon, or the desktop's corner. */
  const openKeyboardMenu = () => {
    const focused = selection.focusKey ?? selectedNames()[0] ?? null;
    const cell = focused ? placement().cells.get(focused) : undefined;
    const current = grid();
    if (focused && cell && selection.selectedKeys.has(focused)) {
      const origin = cellOrigin(current, cell);
      openMenu(focused, origin.x + current.itemW / 2, origin.y + current.itemH / 2);
    } else openMenu(null, current.marginX, current.marginY);
  };

  /* ---------- Drag and drop ---------- */

  /** A folder icon at a point that a drag of `names` would move into. */
  const folderAt = (x: number, y: number, names: readonly string[]): string | null => {
    const name = iconAt(placement(), grid(), x, y);
    return name && !names.includes(name) && entryMap().get(name)?.isDir ? name : null;
  };
  const dragDelta = (gesture: DragGesture, x: number, y: number): DesktopCell => {
    const origin = gesture.origins.get(gesture.name) ?? { col: 0, row: 0 };
    const current = grid();
    const target = cellAt(
      current,
      x - gesture.grabX + current.itemW / 2,
      y - gesture.grabY + current.itemH / 2,
    );
    return { col: target.col - origin.col, row: target.row - origin.row };
  };
  /** Cells a local drag would land on; none when it targets a folder or changes nothing. */
  const dragLanding = (gesture: DragGesture): DesktopCell[] => {
    const { lastX: x, lastY: y } = gesture;
    if (folderAt(x, y, gesture.names) || overflowAt(placement(), grid(), x, y)) return [];
    const delta = dragDelta(gesture, x, y);
    if (delta.col === 0 && delta.row === 0) return [];
    return [...moveCells(gesture.origins, delta, placement().cells, grid()).values()];
  };
  const dropFeedback = () =>
    drag
      ? { target: folderAt(drag.lastX, drag.lastY, drag.names), landing: dragLanding(drag) }
      : dropHover;

  const beginReturn = (gesture: DragGesture, x = gesture.lastX, y = gesture.lastY) => {
    dragReturn = {
      name: gesture.name,
      label: gesture.label,
      originX: gesture.originX,
      originY: gesture.originY,
      fromX: x - gesture.grabX,
      fromY: y - gesture.grabY,
      startedMs: Date.now(),
    };
    drag = null;
    down = null;
    changed();
  };

  const finishDrop = (gesture: DragGesture, x: number, y: number) => {
    drag = null;
    down = null;
    changed();
    const folder = folderAt(x, y, gesture.names);
    if (folder) {
      select({ type: "clear" });
      void work.transferInto(
        "move",
        gesture.names.map((name) => path.join(directory, name)),
        path.join(directory, folder),
        null,
      );
      return;
    }
    const delta = dragDelta(gesture, x, y);
    if (delta.col === 0 && delta.row === 0) return;
    const moved = moveCells(gesture.origins, delta, placement().cells, grid());
    persist({ ...saved, ...Object.fromEntries(moved) });
  };

  const startDrag = (
    name: string,
    from: { x: number; y: number },
    at: { x: number; y: number },
  ) => {
    if (!selection.selectedKeys.has(name)) select({ type: "select", key: name, gesture: {} });
    const names = selectedNames();
    const cells = placement().cells;
    const origins = new Map(
      names.flatMap((selected) => {
        const cell = cells.get(selected);
        return cell ? [[selected, cell] as const] : [];
      }),
    );
    const origin = cellOrigin(grid(), cells.get(name) ?? { col: 0, row: 0 });
    drag = {
      name,
      names,
      label: names.length > 1 ? `${names.length} items` : name,
      origins,
      grabX: from.x - origin.x,
      grabY: from.y - origin.y,
      originX: origin.x,
      originY: origin.y,
      lastX: at.x,
      lastY: at.y,
      startedMs: Date.now(),
    };
  };

  const updateRubberBand = (from: { x: number; y: number }, at: { x: number; y: number }) => {
    rubber ??= {
      start: from,
      rect: rectFromPoints(from, at),
      // Ctrl adds the band to the existing selection.
      base: new Set(deps.modifiers().ctrl ? selection.selectedKeys : []),
    };
    rubber.rect = rectFromPoints(rubber.start, at);
    const inside = namesInRect(rubber.rect, placement(), grid());
    const keys = [...new Set([...rubber.base, ...inside])];
    const focus = inside.at(-1) ?? keys.at(-1) ?? null;
    selection = { selectedKeys: new Set(keys), anchorKey: focus, focusKey: focus };
    changed();
  };

  /* ---------- Rendering ---------- */

  const rebuild = () => {
    const feedback = dropFeedback();
    renderShell(
      root,
      <DesktopIcons
        screenW={width}
        availH={availH()}
        directory={directory}
        grid={grid()}
        placement={placement()}
        entries={entryMap()}
        selectedNames={selection.selectedKeys}
        focusedName={keyboardActive ? selection.focusKey : null}
        dropTargetName={feedback.target}
        landingCells={feedback.landing}
        rubberBand={rubber?.rect ?? null}
        rename={rename}
        draggingNames={new Set(drag?.names ?? [])}
        onBackgroundPress={(event) => {
          if (!event?.ctrlKey) select({ type: "clear" });
          keyboardActive = true;
        }}
        onBackgroundContextMenu={(event) => openMenu(null, event.x, event.y)}
        onSelect={(name, event) => {
          select({
            type: "select",
            key: name,
            gesture: { toggle: event?.ctrlKey || event?.metaKey, range: event?.shiftKey },
          });
          keyboardActive = true;
        }}
        onOpen={(name) => open.item(itemFor(name))}
        onContextMenu={(name, event) => openMenu(name, event.x, event.y)}
        onOpenOverflow={() => open.inFiles(directory)}
        onRenameChange={(draft) => {
          if (rename) rename = { ...rename, draft, error: null };
          changed();
        }}
        onRenameSubmit={commitRename}
        onRenameCancel={() => {
          rename = null;
          changed();
        }}
      />,
    );
    const painted = rasterize(root.container, width, height);
    raster = { pixels: painted.pixels, revision: ++revision, hits: painted.hits };
    dirty = false;
  };

  const ensureRaster = (w = width, h = height): DesktopRaster | null => {
    if (w <= 0 || h <= 0) return null;
    if (dirty || !raster || w !== width || h !== height || scale !== getUiScaleFactor()) {
      width = w;
      height = h;
      scale = getUiScaleFactor();
      pinNewIcons();
      rebuild();
      // The desktop has no focus manager: focusing a new rename field selects its name.
      if (rename && !renameFocused) {
        renameFocused = true;
        raster?.hits.find((hit) => hit.focusId === RENAME_FIELD)?.onFocusChange?.(true);
        rebuild();
      }
    }
    if (!rename) renameFocused = false;
    return raster;
  };

  const findHit = (x: number, y: number, accept: (hit: HitRegion) => boolean): HitRegion | null => {
    const hits = ensureRaster()?.hits ?? [];
    for (let index = hits.length - 1; index >= 0; index--) {
      const hit = hits[index]!;
      if (hitRegionContains(hit, x, y) && accept(hit)) return hit;
    }
    return null;
  };
  const pointerArgs = (hit: HitRegion, x: number, y: number, button: "left" | "right") => {
    const modifiers = deps.modifiers();
    return {
      x,
      y,
      localX: x - hit.x,
      localY: y - hit.y,
      button,
      shiftKey: modifiers.shift,
      ctrlKey: modifiers.ctrl,
      altKey: modifiers.alt,
      metaKey: modifiers.meta,
    } satisfies HitPointerEvent;
  };

  /* ---------- Keyboard ---------- */

  const keyEvent = (code: number, repeat: boolean): HitKeyEvent => {
    const modifiers = deps.modifiers();
    return {
      code,
      ...keyFromEvdev(code, modifiers),
      repeat,
      shiftKey: modifiers.shift,
      ctrlKey: modifiers.ctrl,
      altKey: modifiers.alt,
      metaKey: modifiers.meta,
    };
  };

  const activeMenuRow = (hits: readonly HitRegion[]) =>
    hits.find((hit) => hit.autoFocus && hit.focusId?.startsWith("context-menu:"));

  /** Arrow keys and Enter for the open menu, as a Window's focus manager would route them. */
  const onMenuKey = (code: number, repeat: boolean): boolean => {
    if (code === KEY.esc) {
      closeMenu();
      return true;
    }
    const event = keyEvent(code, repeat);
    const hits = deps.chromeHits();
    const active = activeMenuRow(hits);
    const handled = [...hits]
      .reverse()
      .some(
        (hit) => hit.focusScopeId === active?.focusScopeId && hit.onGlobalKeyDown?.(event) === true,
      );
    if (!handled && (code === KEY.enter || code === KEY.space)) active?.onKeyDown?.(event);
    deps.invalidateChrome();
    // Show the newly active row as focused.
    const next = activeMenuRow(deps.chromeHits());
    if (next?.focusId !== menuFocus?.focusId) {
      menuFocus?.onFocusChange?.(false);
      next?.onFocusChange?.(true);
      menuFocus = next ?? null;
      deps.invalidateChrome();
    }
    return true;
  };

  const onConfirmationKey = (current: DesktopConfirmation, code: number): boolean => {
    if (code === KEY.esc) closeConfirmation();
    else if (code === KEY.tab || code === KEY.left || code === KEY.right) {
      confirmation = { ...current, focus: current.focus === "cancel" ? "confirm" : "cancel" };
      deps.invalidateChrome();
    } else if (code === KEY.enter || code === KEY.space) {
      if (current.focus === "confirm") current.onConfirm();
      else closeConfirmation();
    }
    return true;
  };

  const moveFocus = (direction: Direction) => {
    const from = selection.focusKey ?? orderedNames()[0] ?? null;
    if (!from) return;
    const target = spatialNeighbor(from, direction, placement());
    if (!target) return;
    const { ctrl, shift } = deps.modifiers();
    if (ctrl && !shift) select({ type: "focus", key: target, select: false });
    else select({ type: "select", key: target, gesture: { range: shift } });
  };

  const typeToSelect = (text: string) => {
    const now = Date.now();
    typeahead = {
      text: now - typeahead.at > TYPEAHEAD_RESET_MS ? text : typeahead.text + text,
      at: now,
    };
    const match = typeaheadMatch(orderedNames(), typeahead.text, selection.focusKey);
    if (match) select({ type: "select", key: match, gesture: {} });
  };

  const onDesktopKey = (code: number) => {
    const { ctrl, shift, alt } = deps.modifiers();
    const items = selectedNames().map(itemFor);
    if (code === KEY.esc) select({ type: "clear" });
    else if (ctrl && shift && code === KEY.n) {
      menuCell = null;
      handlers.newFolder(directory);
    } else if (ctrl && code === KEY.a) select({ type: "all" });
    else if (ctrl && code === KEY.c && items.length) handlers.copy(items);
    else if (ctrl && code === KEY.x && items.length) handlers.cut(items);
    else if (ctrl && code === KEY.v) work.paste(directory, null);
    else if (ctrl && code === KEY.z) work.undoLast();
    else if (ctrl && code === KEY.i) handlers.properties(items.length ? items : null);
    else if (code === KEY.enter) items.forEach(open.item);
    else if (code === KEY.f2 && items.length === 1) startRename(path.basename(items[0]!.path));
    else if (code === KEY.delete && items.length)
      (shift ? handlers.deletePermanently : handlers.trash)(items);
    else if (code === KEY.menu || (shift && code === KEY.f10)) openKeyboardMenu();
    else if (code === KEY.space) {
      const focused = selection.focusKey;
      if (focused)
        select({ type: "select", key: focused, gesture: { toggle: ctrl, range: shift } });
    } else if (code === KEY.home || code === KEY.end)
      select({
        type: code === KEY.home ? "first" : "last",
        options: { extend: shift, preserveSelection: ctrl && !shift },
      });
    else if (code === KEY.left) moveFocus("left");
    else if (code === KEY.right) moveFocus("right");
    else if (code === KEY.up) moveFocus("up");
    else if (code === KEY.down) moveFocus("down");
    else if (!ctrl && !alt) {
      const text = keyFromEvdev(code, { shift, ctrl, alt, meta: false }).text;
      if (text?.trim()) typeToSelect(text);
    }
  };

  /** Where the drag chip is drawn: at the grab point, easing home after a cancel. */
  const chipPosition = (cursorX: number, cursorY: number): { x: number; y: number } | null => {
    if (drag) return { x: (cursorX | 0) - drag.grabX, y: (cursorY | 0) - drag.grabY };
    const animation = dragReturn;
    if (!animation) return { x: (cursorX | 0) + 14, y: (cursorY | 0) + 12 };
    const progress = Math.min(1, Math.max(0, (Date.now() - animation.startedMs) / DRAG_RETURN_MS));
    if (progress >= 1) {
      dragReturn = null;
      changed();
      return null;
    }
    const eased = 1 - Math.pow(1 - progress, 3);
    return {
      x: Math.round(animation.fromX + (animation.originX - animation.fromX) * eased),
      y: Math.round(animation.fromY + (animation.originY - animation.fromY) * eased),
    };
  };

  return {
    /** The desktop layer for this output size. */
    raster: (w: number, h: number): DesktopRaster | null => ensureRaster(w, h),

    /** The drag preview: the dragged tile itself for desktop drags, a label chip otherwise. */
    dragChip(cursorX: number, cursorY: number, label: string): DesktopDragChip | null {
      const preview = drag ?? dragReturn;
      const tile =
        preview?.label === label
          ? {
              name: preview.name,
              isDir: entryMap().get(preview.name)?.isDir ?? false,
              grid: grid(),
            }
          : null;
      const position = chipPosition(cursorX, cursorY);
      return position ? chips.render(label, tile, position) : null;
    },

    /** Top-layer content: the operation toast, the menu and a confirmation. */
    overlay(w: number, h: number): ReactNode {
      const top = Math.max(1, h - panelHeight());
      return (
        <>
          {toast ? (
            <DesktopToastView toast={toast} screenW={w} availH={top} onDismiss={dismissToast} />
          ) : null}
          {menu ? (
            <ContextMenu
              key={`${menu.x}:${menu.y}:${menu.title}`}
              viewportWidth={w}
              viewportHeight={top}
              x={menu.x}
              y={menu.y}
              title={menu.title}
              actions={menu.actions}
              onDismiss={closeMenu}
            />
          ) : null}
          {confirmation ? (
            <DesktopConfirmationView
              confirmation={confirmation}
              screenW={w}
              availH={top}
              onCancel={closeConfirmation}
            />
          ) : null}
        </>
      );
    },

    /** A menu or confirmation owns all input until it closes. */
    capturesInput: () => menu !== null || confirmation !== null,
    get keyboardActive() {
      return keyboardActive;
    },
    /** Another click: desktop keys go back to the focused window unless the desktop is clicked. */
    deactivateKeyboard() {
      keyboardActive = false;
    },
    /** A press on the panel closes the menu, as a press anywhere else outside it does. */
    pressOutsideDesktop(y: number) {
      if (menu && y >= availH()) {
        closeMenu();
        changed();
      }
    },
    /** A window took focus: stop taking keys, finish a rename and close the menu. */
    release() {
      keyboardActive = false;
      if (rename) commitRename();
      if (menu) closeMenu();
      changed();
    },
    /** Keys while a desktop menu or confirmation is open. */
    onModalKey(code: number, value: number): boolean {
      if (value !== 1 && value !== 2) return true;
      return confirmation ? onConfirmationKey(confirmation, code) : onMenuKey(code, value === 2);
    },
    /** Keys while the desktop has keyboard focus. */
    onKey(code: number, value: number): boolean {
      if (value !== 1 && value !== 2) return true;
      if (rename) {
        const field = (ensureRaster()?.hits ?? []).find((hit) => hit.focusId === RENAME_FIELD);
        field?.onKeyDown?.(keyEvent(code, value === 2));
        changed();
        return true;
      }
      onDesktopKey(code);
      return true;
    },

    onPointerButton(ev: { button: number; value: number; x: number; y: number }): boolean {
      const left = ev.button === BTN_LEFT;
      const right = ev.button === BTN_RIGHT;
      if (!left && !right) return false;
      if (right) {
        if (ev.value !== 1) return menu !== null;
        keyboardActive = true;
        const hit = findHit(ev.x, ev.y, (candidate) => !!candidate.onContextMenu);
        if (!hit) return false;
        hit.onContextMenu!(pointerArgs(hit, ev.x, ev.y, "right"));
        return true;
      }
      if (ev.value === 1) {
        keyboardActive = true;
        dragReturn = null;
        const field = findHit(ev.x, ev.y, (candidate) => candidate.focusId === RENAME_FIELD);
        if (field) {
          field.onPointerDown?.(pointerArgs(field, ev.x, ev.y, "left"));
          down = { x: ev.x, y: ev.y, name: null, hit: field };
          return true;
        }
        // Clicking anywhere else finishes a rename, as file managers do.
        if (rename) commitRename();
        const hit = findHit(
          ev.x,
          ev.y,
          (candidate) => !!(candidate.onPointerDown || candidate.onPress),
        );
        down = { x: ev.x, y: ev.y, name: iconAt(placement(), grid(), ev.x, ev.y), hit };
        hit?.onPointerDown?.(pointerArgs(hit, ev.x, ev.y, "left"));
        changed();
        return hit !== null;
      }
      if (drag) {
        finishDrop(drag, ev.x, ev.y);
        return true;
      }
      const pressed = down;
      down = null;
      if (rubber) {
        rubber = null;
        changed();
        return true;
      }
      if (!pressed?.hit) return false;
      pressed.hit.onPointerUp?.(pointerArgs(pressed.hit, ev.x, ev.y, "left"));
      const dx = ev.x - pressed.x;
      const dy = ev.y - pressed.y;
      if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) {
        const hit = findHit(ev.x, ev.y, (candidate) => !!candidate.onPress) ?? pressed.hit;
        hit.onPress?.(pointerArgs(hit, ev.x, ev.y, "left"));
      }
      changed();
      return true;
    },

    onPointerMotion(ev: { x: number; y: number }): void {
      if (!down) return;
      const dx = ev.x - down.x;
      const dy = ev.y - down.y;
      const moved = dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD;
      if (down.hit?.focusId === RENAME_FIELD) {
        down.hit.onPointerMove?.(pointerArgs(down.hit, ev.x, ev.y, "left"));
        changed();
        return;
      }
      if (down.name && !drag && moved) startDrag(down.name, down, ev);
      if (drag) {
        drag.lastX = ev.x;
        drag.lastY = ev.y;
        changed();
        return;
      }
      // The background (not an icon or the overflow tile) starts a rubber band.
      if (!down.name && down.hit && !down.hit.focusable && (rubber || moved))
        updateRubberBand(down, ev);
    },

    /** Items dropped from Files or another app: into the folder under the pointer, or onto the desktop there. */
    acceptDrop(uris: readonly string[], x: number, y: number): boolean {
      dropHover = { target: null, landing: [] };
      changed();
      const sources = pathsFromUris(uris);
      if (!sources.length) return false;
      const folder = folderAt(x, y, []);
      const destination = folder ? path.join(directory, folder) : directory;
      const cell = cellAt(grid(), x, y);
      const already = sources.filter((source) => path.dirname(source) === destination);
      const incoming = sources.filter((source) => path.dirname(source) !== destination);
      // A desktop item dragged out through a window and back only changes position.
      if (!folder && already.length)
        placeArrivals(
          already.map((source) => path.basename(source)),
          cell,
        );
      if (incoming.length)
        void work.transferInto("move", incoming, destination, folder ? null : cell);
      return true;
    },
    hitDesktop: (_x: number, y: number): boolean =>
      height > 0 ? y < height - panelHeight() : y >= 0,
    dragLabel: () => drag?.label ?? dragReturn?.label ?? null,
    dragUri: () =>
      drag
        ? {
            uri: `${drag.names.map((name) => pathToFileURL(path.join(directory, name)).href).join("\n")}\n`,
            label: drag.label,
          }
        : null,
    finishDrag(commit: boolean, x: number, y: number) {
      if (!drag) return;
      if (commit) finishDrop(drag, x, y);
      else {
        drag = null;
        down = null;
        dragReturn = null;
        changed();
      }
    },
    /** An external drag over the desktop: highlight only the real target. */
    dragHover(x: number, y: number, mimeTypes: readonly string[]) {
      let next: typeof dropHover = { target: null, landing: [] };
      if (mimeTypes.includes("text/uri-list")) {
        const folder = folderAt(x, y, []);
        if (folder) next = { target: folder, landing: [] };
        else if (!overflowAt(placement(), grid(), x, y))
          next = {
            target: null,
            landing: landingCells(1, cellAt(grid(), x, y), placement().cells.values(), grid()),
          };
      }
      if (
        next.target !== dropHover.target ||
        next.landing.length !== dropHover.landing.length ||
        next.landing.some((cell, index) => !sameCell(cell, dropHover.landing[index]!))
      ) {
        dropHover = next;
        changed();
      }
    },
    clearDragHover() {
      if (dropHover.target || dropHover.landing.length) {
        dropHover = { target: null, landing: [] };
        changed();
      }
    },
    cancelDrag(x?: number, y?: number) {
      if (drag) beginReturn(drag, x, y);
    },
    checkDragWatchdog() {
      if (drag && Date.now() - drag.startedMs > DRAG_WATCHDOG_MS) {
        console.warn(`[shell] desktop-drag watchdog: clearing stuck drag "${drag.label}"`);
        beginReturn(drag);
      }
    },
    needsRepaint: () => dirty || drag !== null || dragReturn !== null,
    /** What a drag would do right now: the folder it targets and the cells it would land on. */
    dropFeedback,
    /** Each visible icon's cell. */
    layout: () => placement().cells,
    /** Theme, scale or preferences changed: rebuild everything. */
    invalidate() {
      raster = null;
      placementCache = null;
      chips.invalidate();
      changed();
    },
    /** Resolves when every queued desktop operation has finished and been reported. */
    whenIdle: () => work.whenIdle(),
  };
}
