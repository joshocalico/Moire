import {
  discoverApplications,
  filterApplications,
  ContextActionRegistry,
  FileActivationPortalClient,
  FileActivationService,
  resolveApplicationIcon,
  type DesktopEntry,
  type FileActionContext,
} from "@moire/app-discovery";
import {
  createShellRoot,
  rasterize,
  renderShell,
  type HitRegion,
  type ShellRoot,
} from "@moire/react-host";
import {
  installUiFonts,
  setUiScaleFactor,
  tickAllMotions,
  ContextMenu,
  ContextMenuTrigger,
  Icon,
  GridItem,
  createSelectionState,
  reduceSelection,
  reconcileSelection,
  type ContextMenuAction,
  type IconName,
  type SelectionAction,
  type SelectionState,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import { themePalette } from "@moire/theme";
import { createElement, useEffect, useMemo } from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Panel } from "./Panel.js";
import { Launcher } from "./Launcher.js";
import { TitleBar } from "./TitleBar.js";
import { Label } from "./widgets.js";
import {
  DesktopIcons,
  listDesktopEntries,
  loadDesktopLayout,
  saveDesktopLayout,
  desktopDir,
  hitTestDesktopIcon,
  desktopIconPosition,
  DESKTOP_ITEM_W,
  DESKTOP_ITEM_H,
  ICON_SIZE,
  type DesktopLayout,
} from "./DesktopIcons.js";
import type {
  SsdAction,
  SsdWindowInfo,
  TaskWindowAction,
  TaskWindowInfo,
} from "./ssd.js";
import { Group, Rect, measureText } from "@moire/react-host";

export type ShellSpawn = (opts: { exec: string }) => { unref?: () => void };

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export type ShellRasterSurface = {
  id: string;
  pixels: Uint8Array;
  width: number;
  height: number;
  stride: number;
  revision: number;
  x: number;
  y: number;
};

export type ShellBridge = {
  setPrimaryOutput(output: { x: number; y: number; width: number; height: number }): void;
  paint(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
  ): void;
  /** Revisioned shell surfaces for retained compositor backends. */
  chromeRaster(width: number, height: number): ShellRasterSurface | null;
  desktopRaster(width: number, height: number): ShellRasterSurface | null;
  /** Clear per-frame SSD hit list before painting windows in stack order. */
  beginSsdFrame(): void;
  /**
   * Paint one SSD titlebar into the framebuffer.
   * Call in stack order immediately after that window's client buffers so
   * chrome participates in window z-order (not a global overlay on top).
   */
  paintSsdWindow(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    window: SsdWindowInfo,
  ): void;
  ssdRaster(window: SsdWindowInfo): ShellRasterSurface;
  /** Paint all SSD titlebars (bottom→top). Prefer per-window paint in composite. */
  paintSsd(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    windows: SsdWindowInfo[],
  ): void;
  /** Hit-test SSD chrome; returns action or null. */
  hitSsd(x: number, y: number): SsdAction | null;
  onKey(ev: { code: number; value: number }): boolean;
  onPointerButton(ev: {
    timeMs: number;
    button: number;
    value: number;
    x: number;
    y: number;
  }): boolean;
  /** Pointer motion for top shell overlays and panel hover feedback. */
  onPointerMotion?(ev: { x: number; y: number }): boolean;
  /** Pointer motion over compositor-verified, unobscured SSD chrome. */
  onSsdPointerMotion?(ev: { x: number; y: number; inside: boolean }): boolean;
  /** Wheel input for launcher/menu scroll regions. */
  onPointerAxis?(ev: { x: number; y: number; deltaY: number }): boolean;
  setTasks?(tasks: TaskWindowInfo[]): void;
  /**
   * Pointer over empty desktop (no window under cursor).
   * Handles icon select / open. Returns true if consumed.
   */
  onDesktopPointerButton?(ev: {
    timeMs: number;
    button: number;
    value: number;
    x: number;
    y: number;
  }): boolean;
  /** Desktop icon hover tracking when no window under cursor. */
  onDesktopPointerMotion?(ev: { x: number; y: number }): void;
  isLauncherOpen(): boolean;
  /** True when panel/launcher/desktop content changed. */
  needsRepaint(): boolean;
  /** Drop panel/SSD caches after theme or prefs change. */
  invalidateChrome(): void;
  /**
   * Rasterize desktop icons and blend non-transparent pixels onto fb.
   * Call after wallpaper and before windows so icons appear under windows.
   * No-ops when showDesktopIcons is false.
   */
  paintDesktop(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
  ): void;
  /**
   * Parse file:// URIs and place them on the desktop. If (x, y) lands on a
   * folder icon, moves into that folder instead of ~/Desktop's root.
   */
  acceptDesktopDrop(uris: string[], x: number, y: number): boolean;
  /** True if (x,y) is over a desktop drop zone (above the panel). */
  hitDesktop(x: number, y: number): boolean;
  /** Shell-owned drag preview, including desktop icon return animation. */
  paintDragPreview(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    cursorX: number,
    cursorY: number,
    label: string,
  ): void;
  /** Revisioned drag preview used by retained compositor backends. */
  dragRaster(
    cursorX: number,
    cursorY: number,
    label: string,
  ): ShellRasterSurface | null;
  /** Label for an in-progress desktop icon drag, if any. */
  desktopDragLabel?(): string | null;
  /**
   * URI payload + label for the desktop icon currently mid local-reposition
   * drag, if any. The compositor escalates into a real DnD session with
   * this payload when the pointer crosses onto a client surface.
   */
  desktopDragUri?(): { uri: string; label: string } | null;
  /**
   * Called when an escalated (real-DnD) desktop-origin drag ends.
   * `commit=true`: finalize the reposition at (x, y). `commit=false`: the
   * item was handed to a client target — clear local state, keep layout.
   */
  finishDesktopDrag?(commit: boolean, x: number, y: number): void;
  /** Live-highlight a folder icon under (x, y) as a valid drop target. */
  onDesktopDragHover?(x: number, y: number, mimeTypes: string[]): void;
  /** Clear any desktop drop-hover highlight. */
  clearDesktopDragHover?(): void;
  /**
   * Force-clear an in-flight local desktop-icon drag (reposition, not yet
   * escalated to a real DnD session — that case is covered by the
   * compositor's own drag watchdog/Escape handling instead). The icon stays
   * at its last saved position; nothing is committed. Called on Escape.
   */
  cancelDesktopDrag?(x?: number, y?: number): void;
  /**
   * Polled unconditionally by the compositor (regardless of whether a real
   * DnD session is active) so a local desktop-icon drag that never receives
   * its terminating release event doesn't stay stuck forever — this state
   * never touches `this.drag`, so the compositor's own drag watchdog can't
   * see it.
   */
  checkDesktopDragWatchdog?(): void;
};

const KEY_ESC = 1;
const KEY_BACKSPACE = 14;
const KEY_ENTER = 28;
const KEY_LEFTCTRL = 29;
const KEY_LEFTSHIFT = 42;
const KEY_SPACE = 57;
const KEY_HOME = 102;
const KEY_UP = 103;
const KEY_LEFT = 105;
const KEY_RIGHT = 106;
const KEY_END = 107;
const KEY_DOWN = 108;
const KEY_RIGHTCTRL = 97;
const KEY_RIGHTSHIFT = 54;
const KEY_LEFTMETA = 125;
const KEY_RIGHTMETA = 126;

const US_MAP: Record<number, string> = {
  16: "q",
  17: "w",
  18: "e",
  19: "r",
  20: "t",
  21: "y",
  22: "u",
  23: "i",
  24: "o",
  25: "p",
  30: "a",
  31: "s",
  32: "d",
  33: "f",
  34: "g",
  35: "h",
  36: "j",
  37: "k",
  38: "l",
  44: "z",
  45: "x",
  46: "c",
  47: "v",
  48: "b",
  49: "n",
  50: "m",
  2: "1",
  3: "2",
  4: "3",
  5: "4",
  6: "5",
  7: "6",
  8: "7",
  9: "8",
  10: "9",
  11: "0",
  57: " ",
  12: "-",
  53: "/",
};

type ShellAppProps = {
  width: number;
  height: number;
  primaryOutput: { x: number; y: number; width: number; height: number };
  open: boolean;
  query: string;
  selected: number;
  apps: DesktopEntry[];
  tasks: TaskWindowInfo[];
  clock: string;
  onToggle: () => void;
  onQuery: (q: string) => void;
  onSelect: (i: number) => void;
  onLaunch: (app: DesktopEntry) => void;
  onDismiss: () => void;
  onTaskPress: (task: TaskWindowInfo) => void;
};

function ShellApp(props: ShellAppProps) {
  const filtered = useMemo(
    () => filterApplications(props.apps, props.query),
    [props.apps, props.query],
  );

  useEffect(() => {
    if (props.selected >= filtered.length) {
      props.onSelect(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, props.selected, props.onSelect]);

  return createElement(
    "group",
    { x: 0, y: 0, width: props.width, height: props.height },
    createElement(
      "group",
      {
        x: props.primaryOutput.x,
        y: props.primaryOutput.y,
        width: props.primaryOutput.width,
        height: props.primaryOutput.height,
      },
      createElement(Panel, {
        screenW: props.primaryOutput.width,
        screenH: props.primaryOutput.height,
        clock: props.clock,
        tasks: props.tasks,
        onLauncherClick: props.onToggle,
        onTaskPress: props.onTaskPress,
      }),
      createElement(Launcher, {
        open: props.open,
        screenW: props.primaryOutput.width,
        screenH: props.primaryOutput.height,
        apps: filtered,
        query: props.query,
        selected: props.selected,
        onQueryChange: props.onQuery,
        onLaunch: props.onLaunch,
        onDismiss: props.onDismiss,
        onSelect: props.onSelect,
      }),
    ),
  );
}

/**
 * In-process DE shell: bottom panel + Super-key launcher + SSD titlebars.
 */
export function createShell(
  spawn: ShellSpawn,
  onTaskAction: (action: TaskWindowAction) => void = () => {},
): ShellBridge {
  const root: ShellRoot = createShellRoot();
  let primaryOutput = { x: 0, y: 0, width: 1, height: 1 };
  const moireRoot =
    process.env.MOIRE_ROOT ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const settingsExec = `pnpm --dir ${moireRoot} --filter @moire/settings start`;
  const filesExec = `pnpm --dir ${moireRoot} --filter @moire/files start`;
  const builtinApps: DesktopEntry[] = [
    {
      id: "moire-settings.desktop",
      name: "Settings",
      comment: "Moire system settings",
      exec: settingsExec,
      icon: "preferences-system",
      terminal: false,
      categories: ["Settings", "System"],
    },
    {
      id: "moire-files.desktop",
      name: "Files",
      comment: "Moire file browser",
      exec: filesExec,
      icon: "system-file-manager",
      terminal: false,
      categories: ["FileManager", "System"],
    },
  ];
  const mergeApps = (): DesktopEntry[] => [
    ...builtinApps,
    ...discoverApplications(process.env.XDG_CURRENT_DESKTOP ?? "Moire").filter(
      (app) =>
        app.id !== "moire-settings.desktop" &&
        app.id !== "moire-files.desktop",
    ),
  ];
  let apps = mergeApps();
  const createActivationService = (applications: DesktopEntry[]) =>
    new FileActivationService((activation) => {
      const child = spawn({ exec: activation.command });
      child.unref?.();
      console.log(
        `[shell] file activation: ${activation.filePath} → ${activation.command}`,
      );
    }, applications);
  let activation = createActivationService(apps);
  const activationPortal = new FileActivationPortalClient();
  let mimeDb = activation.mimeDatabase;
  let open = process.env.MOIRE_SHELL_START_OPEN === "1";
  let query = "";
  let selected = 0;
  let clock = formatClock();
  let tasks: TaskWindowInfo[] = [];
  let dirty = true;
  const initialSettings = loadSettings();
  let showDesktopIcons = initialSettings.showDesktopIcons;
  setUiScaleFactor(initialSettings.uiScale);
  void installUiFonts().then(() => {
    dirty = true;
    console.log("[shell] TTF fonts ready (@moire/ui)");
  });
  if (open) console.log("[shell] launcher start-open (MOIRE_SHELL_START_OPEN)");
  let hits: HitRegion[] = [];
  let overlay: Uint8Array | null = null;
  let overlayRevision = 0;
  type AlphaRuns = Array<Int32Array | null>;
  let overlayRuns: AlphaRuns | null = null;
  let ow = 0;
  let oh = 0;
  let metaHeld = false;
  let ctrlHeld = false;
  let shiftHeld = false;
  let overlayPointerGrab = false;
  let overlayDownHit: HitRegion | null = null;
  let shellHover: HitRegion | null = null;

  type SsdHit = HitRegion & { identity: string; stripKey: string };
  type SsdStrip = {
    root: ShellRoot;
    pixels: Uint8Array;
    w: number;
    h: number;
    hits: HitRegion[];
    signature: string;
    dirty: boolean;
    revision: number;
  };
  let ssdHits: SsdHit[] = [];
  let ssdHover: SsdHit | null = null;
  let ssdAnimationActive = false;
  let ssdPending: { current: SsdAction | null } = { current: null };
  /** One persistent React root per window keeps control motion state local. */
  const ssdStripCache = new Map<string, SsdStrip>();
  const ssdSeen = new Set<string>();

  // ── Desktop icons state ────────────────────────────────────────────────────
  const desktopRoot: ShellRoot = createShellRoot();
  let desktopEntries: string[] = listDesktopEntries();
  let desktopLayout: DesktopLayout = loadDesktopLayout();
  let desktopSelection: SelectionState<string> =
    createSelectionState(desktopEntries);
  let desktopKeyboardActive = false;
  let desktopMenu:
    | { kind: "item"; name: string; x: number; y: number }
    | { kind: "background"; x: number; y: number }
    | null = null;
  /** Folder icon currently hovered by an active external/escalated drag. */
  let desktopDropHoverName: string | null = null;
  /** A compatible drag is over the desktop, regardless of a specific folder hit. */
  let desktopDragActive = false;
  let desktopHits: HitRegion[] = [];
  let desktopOverlay: Uint8Array | null = null;
  let desktopRevision = 0;
  let desktopOverlayRuns: AlphaRuns | null = null;
  let desktopW = 0;
  let desktopH = 0;
  let desktopDirty = true;
  let desktopHover: HitRegion | null = null;
  let desktopDown: { x: number; y: number; hit: HitRegion; name?: string } | null =
    null;
  let desktopDrag: {
    name: string;
    names: string[];
    label: string;
    origins: DesktopLayout;
    grabX: number;
    grabY: number;
    originX: number;
    originY: number;
    lastX: number;
    lastY: number;
  } | null = null;
  let desktopDragReturn: {
    name: string;
    label: string;
    originX: number;
    originY: number;
    fromX: number;
    fromY: number;
    startedMs: number;
    durationMs: number;
  } | null = null;
  /**
   * When `desktopDrag` started. Purely local (never touches the compositor
   * DnD session), so the compositor's own drag watchdog can't see it — if
   * this gesture's release is ever lost, nothing else clears it. Checked by
   * `checkDesktopDragWatchdog`, polled by the compositor unconditionally.
   */
  let desktopDragStartMs = 0;
  const DESKTOP_DRAG_WATCHDOG_TIMEOUT_MS = 15_000;
  let desktopMotionTick = Date.now();
  const PANEL_BTN_LEFT = 0x110; // BTN_LEFT
  const PANEL_BTN_RIGHT = 0x111; // BTN_RIGHT
  const dragChipRoot: ShellRoot = createShellRoot();
  let dragChipCache: {
    key: string;
    pixels: Uint8Array;
    w: number;
    h: number;
  } | null = null;
  let dragChipRevision = 0;
  const DESKTOP_DRAG_THRESHOLD = 8;

  const updateDesktopSelection = (
    action: SelectionAction<string>,
  ): void => {
    const next = reduceSelection(desktopSelection, desktopEntries, action);
    if (next === desktopSelection) return;
    desktopSelection = next;
    desktopDirty = true;
    dirty = true;
  };

  const selectedDesktopNames = (): string[] =>
    desktopEntries.filter((name) => desktopSelection.selectedKeys.has(name));

  const selectDesktopName = (
    name: string,
    modifiers: { toggle?: boolean; range?: boolean } = {},
  ): void => {
    updateDesktopSelection({ type: "select", key: name, gesture: modifiers });
  };

  const desktopNeighbor = (
    fromName: string,
    direction: "left" | "right" | "up" | "down",
  ): string | null => {
    const fromIndex = desktopEntries.indexOf(fromName);
    if (fromIndex < 0) return desktopEntries[0] ?? null;
    const from = desktopIconPosition(
      fromName,
      fromIndex,
      desktopLayout,
      desktopW || 1,
      desktopH || 1,
      themePalette().panelHeight,
    );
    let best: { name: string; score: number } | null = null;
    for (let index = 0; index < desktopEntries.length; index++) {
      const name = desktopEntries[index]!;
      if (name === fromName) continue;
      const candidate = desktopIconPosition(
        name,
        index,
        desktopLayout,
        desktopW || 1,
        desktopH || 1,
        themePalette().panelHeight,
      );
      const dx = candidate.x - from.x;
      const dy = candidate.y - from.y;
      const primary =
        direction === "left"
          ? -dx
          : direction === "right"
            ? dx
            : direction === "up"
              ? -dy
              : dy;
      if (primary <= 0) continue;
      const cross = direction === "left" || direction === "right"
        ? Math.abs(dy)
        : Math.abs(dx);
      const score = primary + cross * 2;
      if (!best || score < best.score) best = { name, score };
    }
    return best?.name ?? fromName;
  };

  const moveDesktopSelection = (
    direction: "left" | "right" | "up" | "down",
  ): void => {
    const from = desktopSelection.focusKey ?? desktopEntries[0] ?? null;
    if (!from) return;
    const target = desktopNeighbor(from, direction);
    if (!target) return;
    if (ctrlHeld && !shiftHeld) {
      updateDesktopSelection({ type: "focus", key: target, select: false });
    } else {
      selectDesktopName(target, { range: shiftHeld });
    }
  };

  const refreshApps = () => {
    const nextApps = mergeApps();
    const appsChanged =
      nextApps.length !== apps.length ||
      nextApps.some((app, index) => {
        const current = apps[index];
        return (
          !current ||
          app.id !== current.id ||
          app.name !== current.name ||
          app.genericName !== current.genericName ||
          app.exec !== current.exec ||
          app.icon !== current.icon ||
          app.terminal !== current.terminal ||
          app.categories.join("\0") !== current.categories.join("\0") ||
          (app.mimeTypes ?? []).join("\0") !==
            (current.mimeTypes ?? []).join("\0")
        );
      });
    apps = nextApps;
    activation = createActivationService(apps);
    mimeDb = activation.mimeDatabase;
    if (appsChanged) dirty = true;
  };
  setInterval(refreshApps, 30_000).unref?.();

  const refreshDesktop = () => {
    const nextEntries = listDesktopEntries();
    const nextLayout = loadDesktopLayout();
    const entriesChanged =
      nextEntries.length !== desktopEntries.length ||
      nextEntries.some((entry, index) => entry !== desktopEntries[index]);
    const layoutNames = Object.keys(desktopLayout);
    const nextLayoutNames = Object.keys(nextLayout);
    const layoutChanged =
      nextLayoutNames.length !== layoutNames.length ||
      nextLayoutNames.some((name) => {
        const current = desktopLayout[name];
        const next = nextLayout[name];
        return !current || !next || current.x !== next.x || current.y !== next.y;
      });
    if (!entriesChanged && !layoutChanged) return;
    desktopEntries = nextEntries;
    desktopLayout = nextLayout;
    desktopSelection = reconcileSelection(desktopSelection, desktopEntries);
    desktopDirty = true;
  };
  // Refresh desktop list every 2s to catch external changes
  setInterval(refreshDesktop, 2_000).unref?.();

  const openDesktopEntry = (name: string) => {
    const filePath = path.join(desktopDir(), name);
    try {
      if (!activation.openDefault(filePath)) {
        const exec = `xdg-open ${pathToFileURL(filePath).href}`;
        const child = spawn({ exec });
        child.unref?.();
        console.log(`[shell] desktop open fallback: ${filePath} → ${exec}`);
      }
    } catch (err) {
      console.error(`[shell] desktop open failed:`, err);
    }
  };

  const showDesktopOpenWith = (name: string) => {
    const filePath = path.join(desktopDir(), name);
    desktopMenu = null;
    dirty = true;
    void activationPortal
      .openWith(filePath)
      .then(() => {
        activation.refreshAssociations();
        desktopDirty = true;
      })
      .catch((error) => console.error("[shell] Open With failed", error));
  };

  const desktopActionRegistry = new ContextActionRegistry();
  desktopActionRegistry.register({
    id: "moire.open",
    actions(context) {
      if (context.paths.length === 0) return [];
      const openActions = [
        {
          id: "open",
          label:
            context.paths.length === 1
              ? "Open"
              : `Open ${context.paths.length} Items`,
          icon: context.directories.every(Boolean) ? "folder" : "file",
          run: () => {
            context.paths.forEach((filePath) =>
              openDesktopEntry(path.basename(filePath)),
            );
          },
        },
      ];
      if (context.paths.length !== 1 || context.directories[0]) {
        return openActions;
      }
      const name = path.basename(context.paths[0]!);
      return [
        ...openActions,
        {
          id: "open-with",
          label: "Open With…",
          description: "Choose a compatible application",
          icon: "app",
          run: () => showDesktopOpenWith(name),
        },
      ];
    },
  });
  desktopActionRegistry.register({
    id: "moire.location",
    actions(context) {
      if (context.paths.length !== 1) return [];
      const filePath = context.paths[0];
      if (!filePath) return [];
      return [
        {
          id: "show-in-files",
          label: "Show in Files",
          icon: "folder",
          separatorBefore: true,
          run: () => {
            const child = spawn({ exec: `xdg-open ${pathToFileURL(path.dirname(filePath)).href}` });
            child.unref?.();
          },
        },
      ];
    },
  });

  const desktopContextActions = (name: string): ContextMenuAction[] => {
    const targetNames = desktopSelection.selectedKeys.has(name)
      ? selectedDesktopNames()
      : [name];
    const paths = targetNames.map((target) => path.join(desktopDir(), target));
    const context: FileActionContext = {
      source: "desktop",
      scope: "items",
      currentDirectory: desktopDir(),
      paths,
      mimeTypes: paths.map((filePath) => mimeDb.mimeTypeForPath(filePath)),
      directories: paths.map((filePath) => {
        try {
          return fs.statSync(filePath).isDirectory();
        } catch {
          return false;
        }
      }),
    };
    return desktopActionRegistry.actionsFor(context).map((action) => ({
      id: action.id,
      label: action.label,
      description: action.description,
      icon: (["app", "file", "folder"] as IconName[]).includes(
        action.icon as IconName,
      )
        ? (action.icon as IconName)
        : undefined,
      danger: action.danger,
      disabled: action.enabled === false,
      separatorBefore: action.separatorBefore,
      onPress: action.run,
    }));
  };

  const createDesktopFolder = (): void => {
    const root = desktopDir();
    for (let index = 1; index < 10_000; index++) {
      const name = index === 1 ? "New Folder" : `New Folder ${index}`;
      try {
        fs.mkdirSync(path.join(root, name), { recursive: false });
        refreshDesktop();
        selectDesktopName(name);
        desktopKeyboardActive = true;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          console.error("[shell] new desktop folder failed:", error);
          return;
        }
      }
    }
  };

  desktopActionRegistry.register({
    id: "moire.background",
    actions(context) {
      if (context.scope !== "background") return [];
      return [
        {
          id: "new-folder",
          label: "New Folder",
          icon: "folder",
          run: createDesktopFolder,
        },
        {
          id: "select-all",
          label: "Select All",
          icon: "grid",
          enabled: desktopEntries.length > 0,
          run: () => updateDesktopSelection({ type: "all" }),
        },
        {
          id: "open-in-files",
          label: "Open Desktop in Files",
          icon: "folder",
          separatorBefore: true,
          run: () => {
            const child = spawn({
              exec: `${filesExec} ${JSON.stringify(pathToFileURL(desktopDir()).href)}`,
            });
            child.unref?.();
          },
        },
        {
          id: "arrange-icons",
          label: "Arrange Icons",
          icon: "grid",
          run: () => {
            desktopLayout = {};
            saveDesktopLayout(desktopLayout);
            desktopDirty = true;
          },
        },
        {
          id: "refresh",
          label: "Refresh Desktop",
          icon: "desktop",
          run: refreshDesktop,
        },
        {
          id: "change-background",
          label: "Change Background…",
          icon: "app",
          separatorBefore: true,
          run: () => {
            const child = spawn({ exec: settingsExec });
            child.unref?.();
          },
        },
      ];
    },
  });

  const desktopBackgroundActions = (): ContextMenuAction[] =>
    desktopActionRegistry
      .actionsFor({
        source: "desktop",
        scope: "background",
        currentDirectory: desktopDir(),
        paths: [],
        mimeTypes: [],
        directories: [],
      })
      .map((action) => ({
        id: action.id,
        label: action.label,
        description: action.description,
        icon: (["app", "desktop", "folder", "grid"] as IconName[]).includes(
          action.icon as IconName,
        )
          ? (action.icon as IconName)
          : undefined,
        danger: action.danger,
        disabled: action.enabled === false,
        separatorBefore: action.separatorBefore,
        onPress: action.run,
      }));
  setInterval(() => {
    const next = formatClock();
    if (next !== clock) {
      clock = next;
      dirty = true;
    }
  }, 1000).unref?.();

  const launch = (app: DesktopEntry) => {
    const exec = app.terminal
      ? `moire-terminal --command ${shellQuote(app.exec)}`
      : app.exec;
    try {
      const child = spawn({ exec });
      child.unref?.();
      console.log(`[shell] launch ${app.id} → ${exec}`);
    } catch (err) {
      console.error(`[shell] launch failed ${app.id}:`, err);
    }
    open = false;
    query = "";
    selected = 0;
    dirty = true;
  };

  const rebuild = (width: number, height: number) => {
    const pal = themePalette();
    const panelTasks = tasks.map((task) => {
      const normalized = task.appId.toLowerCase().replace(/\.desktop$/, "");
      const application = apps.find((app) => {
        const id = app.id.toLowerCase().replace(/\.desktop$/, "");
        return id === normalized || normalized.endsWith(id) || id.endsWith(normalized);
      });
      return {
        ...task,
        iconPath: resolveApplicationIcon(application?.icon),
      };
    });
    renderShell(
      root,
      createElement(
        Group,
        { x: 0, y: 0, width, height },
        createElement(ShellApp, {
          width,
          height,
          primaryOutput,
          open,
          query,
          selected,
          apps,
          clock,
          tasks: panelTasks,
          onToggle: () => {
            open = !open;
            if (!open) {
              query = "";
              selected = 0;
            }
            dirty = true;
          },
          onQuery: (q: string) => {
            query = q;
            selected = 0;
            dirty = true;
          },
          onSelect: (i: number) => {
            selected = i;
            dirty = true;
          },
          onLaunch: launch,
          onDismiss: () => {
            open = false;
            query = "";
            selected = 0;
            dirty = true;
          },
          onTaskPress: (task: TaskWindowInfo) => {
            onTaskAction({
              clientId: task.clientId,
              surfaceId: task.surfaceId,
            });
          },
        }),
        desktopMenu
          ? createElement(ContextMenu, {
              viewportWidth: width,
              viewportHeight: height - pal.panelHeight,
              x: desktopMenu.x,
              y: desktopMenu.y,
              title:
                desktopMenu.kind === "item"
                  ? desktopSelection.selectedKeys.has(desktopMenu.name) &&
                    desktopSelection.selectedKeys.size > 1
                    ? `${desktopSelection.selectedKeys.size} Items`
                    : desktopMenu.name
                  : "Desktop",
              actions:
                desktopMenu.kind === "item"
                  ? desktopContextActions(desktopMenu.name)
                  : desktopBackgroundActions(),
              onDismiss: () => {
                desktopMenu = null;
                dirty = true;
              },
            })
          : null,
      ),
    );
    const painted = rasterize(root.container, width, height);
    overlay = painted.pixels;
    overlayRevision++;
    overlayRuns = buildAlphaRuns(overlay, width, height);
    hits = painted.hits;
    ow = width;
    oh = height;
    dirty = false;
  };

  /** Cache non-transparent runs once per raster instead of scanning every
   * transparent screen pixel on every composite. The runs also map directly
   * to retained-scene damage regions for the EGL path. */
  const buildAlphaRuns = (
    srcBytes: Uint8Array,
    width: number,
    height: number,
  ): AlphaRuns => {
    const src = new Uint32Array(
      srcBytes.buffer,
      srcBytes.byteOffset,
      srcBytes.byteLength >>> 2,
    );
    const rows: AlphaRuns = new Array(height).fill(null);
    for (let y = 0; y < height; y++) {
      const pairs: number[] = [];
      const row = y * width;
      let x = 0;
      while (x < width) {
        while (x < width && (src[row + x]! >>> 24) === 0) x++;
        if (x >= width) break;
        const start = x;
        while (x < width && (src[row + x]! >>> 24) !== 0) x++;
        pairs.push(start, x);
      }
      if (pairs.length > 0) rows[y] = Int32Array.from(pairs);
    }
    return rows;
  };

  const blendOverlay = (
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    srcBytes: Uint8Array,
    runs?: AlphaRuns | null,
  ) => {
    const src = new Uint32Array(
      srcBytes.buffer,
      srcBytes.byteOffset,
      srcBytes.byteLength >>> 2,
    );
    for (let y = 0; y < height; y++) {
      const si = y * width;
      const di = y * pitchPx;
      const rowRuns = runs?.[y];
      if (runs && !rowRuns) continue;
      const runCount = rowRuns?.length ?? 2;
      for (let run = 0; run < runCount; run += 2) {
        const start = rowRuns?.[run] ?? 0;
        const end = rowRuns?.[run + 1] ?? width;
        for (let x = start; x < end; x++) {
          const pixel = src[si + x]!;
          const a = (pixel >>> 24) & 0xff;
          if (a === 255) {
            fb[di + x] = pixel;
            continue;
          }
          const dst = fb[di + x]!;
          const inv = 255 - a;
          const r =
            (((pixel >>> 16) & 0xff) + ((((dst >>> 16) & 0xff) * inv) / 255)) | 0;
          const g =
            (((pixel >>> 8) & 0xff) + ((((dst >>> 8) & 0xff) * inv) / 255)) | 0;
          const b = ((pixel & 0xff) + (((dst & 0xff) * inv) / 255)) | 0;
          fb[di + x] = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
        }
      }
    }
  };

  const blitStrip = (
    fb: Uint32Array,
    pitchPx: number,
    fbW: number,
    fbH: number,
    dx: number,
    dy: number,
    srcBytes: Uint8Array,
    srcW: number,
    srcH: number,
  ) => {
    const src = new Uint32Array(
      srcBytes.buffer,
      srcBytes.byteOffset,
      srcBytes.byteLength >>> 2,
    );
    for (let row = 0; row < srcH; row++) {
      const py = dy + row;
      if (py < 0 || py >= fbH) continue;
      const si = row * srcW;
      const di = py * pitchPx;
      for (let col = 0; col < srcW; col++) {
        const px = dx + col;
        if (px < 0 || px >= fbW) continue;
        const pixel = src[si + col]!;
        const a = (pixel >>> 24) & 0xff;
        if (a === 0) continue;
        if (a === 255) {
          fb[di + px] = pixel;
          continue;
        }
        const dst = fb[di + px]!;
        const inv = 255 - a;
        const r =
          (((pixel >>> 16) & 0xff) + ((((dst >>> 16) & 0xff) * inv) / 255)) | 0;
        const g =
          (((pixel >>> 8) & 0xff) + ((((dst >>> 8) & 0xff) * inv) / 255)) | 0;
        const b = ((pixel & 0xff) + (((dst & 0xff) * inv) / 255)) | 0;
        fb[di + px] = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
      }
    }
  };

  const rebuildDesktop = (width: number, height: number) => {
    const pal = themePalette();
    renderShell(
      desktopRoot,
      createElement(
        Group,
        { x: 0, y: 0, width, height: height - pal.panelHeight },
        createElement(
          ContextMenuTrigger,
          {
            width,
            height: height - pal.panelHeight,
            onPress: () => {
              updateDesktopSelection({ type: "clear" });
              desktopMenu = null;
              desktopKeyboardActive = true;
              desktopDirty = true;
              dirty = true;
            },
            onContextMenu: (event) => {
              updateDesktopSelection({ type: "clear" });
              desktopMenu = { kind: "background", x: event.x, y: event.y };
              desktopKeyboardActive = true;
              desktopDirty = true;
              dirty = true;
            },
          },
          createElement(DesktopIcons, {
            screenW: width,
            screenH: height,
            panelH: pal.panelHeight,
            entries: showDesktopIcons ? desktopEntries : [],
            layout: desktopLayout,
            selectedNames: desktopSelection.selectedKeys,
            focusedName: desktopSelection.focusKey,
            dropHoverName: desktopDropHoverName,
            dragActive: desktopDragActive,
            onSelect: (name, event) => {
              selectDesktopName(name, {
                toggle: event?.ctrlKey || event?.metaKey,
                range: event?.shiftKey,
              });
              desktopMenu = null;
              desktopKeyboardActive = true;
              desktopDirty = true;
              dirty = true;
            },
            onOpen: openDesktopEntry,
            onContextMenu: (name, event) => {
              if (!desktopSelection.selectedKeys.has(name)) {
                selectDesktopName(name);
              }
              desktopMenu = {
                kind: "item",
                name,
                x: event.x,
                y: event.y,
              };
              desktopKeyboardActive = true;
              desktopDirty = true;
              dirty = true;
            },
          }),
        ),
      ),
    );
    const painted = rasterize(desktopRoot.container, width, height);
    desktopOverlay = painted.pixels;
    desktopRevision++;
    desktopOverlayRuns = buildAlphaRuns(desktopOverlay, width, height);
    desktopHits = painted.hits;
    desktopW = width;
    desktopH = height;
    desktopDirty = false;
  };

  /** Rebuild hit list if we already know the screen size. */
  const ensureDesktopHits = () => {
    if (desktopW > 0 && desktopH > 0 && desktopDirty) {
      rebuildDesktop(desktopW, desktopH);
    }
  };

  const prepareSsdWindow = (window: SsdWindowInfo): ShellRasterSurface => {
    const stripKey = `${window.clientId}:${window.surfaceId}`;
    const signature = `${window.contentW}:${window.title}:${window.focused ? 1 : 0}:${window.maximized ? 1 : 0}`;
    const titlebarH = themePalette().titlebarHeight;
    ssdSeen.add(stripKey);
    let strip = ssdStripCache.get(stripKey);
    if (!strip) {
      strip = {
        root: createShellRoot(),
        pixels: new Uint8Array(0),
        w: 0,
        h: titlebarH,
        hits: [],
        signature: "",
        dirty: true,
        revision: 0,
      };
      ssdStripCache.set(stripKey, strip);
    }
    if (strip.dirty || strip.signature !== signature) {
      ssdPending = { current: null };
      const sid = window.surfaceId;
      const cid = window.clientId;
      renderShell(
        strip.root,
        createElement(TitleBar, {
          x: 0,
          y: 0,
          width: window.contentW,
          title: window.title,
          focused: window.focused,
          maximized: window.maximized,
          onDrag: () => {
            ssdPending.current = { kind: "drag", surfaceId: sid, clientId: cid };
          },
          onClose: () => {
            ssdPending.current = { kind: "close", surfaceId: sid, clientId: cid };
          },
          onMaximize: () => {
            ssdPending.current = {
              kind: "maximize",
              surfaceId: sid,
              clientId: cid,
            };
          },
          onMinimize: () => {
            ssdPending.current = {
              kind: "minimize",
              surfaceId: sid,
              clientId: cid,
            };
          },
        }),
      );
      const painted = rasterize(
        strip.root.container,
        Math.max(1, window.contentW),
        titlebarH,
      );
      strip.pixels = painted.pixels;
      strip.w = window.contentW;
      strip.h = titlebarH;
      strip.hits = painted.hits;
      strip.signature = signature;
      strip.dirty = false;
      strip.revision++;
    }

    strip.hits.forEach((h, index) => {
      ssdHits.push({
        identity: `${stripKey}:${index}`,
        stripKey,
        x: window.x + h.x,
        y: window.y + h.y,
        width: h.width,
        height: h.height,
        onPress: h.onPress,
        onPointerEnter: h.onPointerEnter,
        onPointerLeave: h.onPointerLeave,
        onPointerMove: h.onPointerMove,
      });
    });
    return {
      id: `ssd:${stripKey}`,
      pixels: strip.pixels,
      width: strip.w,
      height: strip.h,
      stride: strip.w * 4,
      revision: strip.revision,
      x: window.x,
      y: window.y,
    };
  };

  const paintSsdWindow = (
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    window: SsdWindowInfo,
  ) => {
    const raster = prepareSsdWindow(window);
    blitStrip(
      fb,
      pitchPx,
      width,
      height,
      raster.x,
      raster.y,
      raster.pixels,
      raster.width,
      raster.height,
    );
  };

  const desktopFolderAt = (
    x: number,
    y: number,
    sourceNames: readonly string[],
  ): string | null => {
    const pal = themePalette();
    const targetName = hitTestDesktopIcon(
      x,
      y,
      desktopEntries,
      desktopLayout,
      desktopW || 1,
      desktopH || 1,
      pal.panelHeight,
    );
    if (!targetName || sourceNames.includes(targetName)) return null;
    try {
      return fs.statSync(path.join(desktopDir(), targetName)).isDirectory()
        ? targetName
        : null;
    } catch {
      return null;
    }
  };

  const beginDesktopDragReturn = (
    drag: NonNullable<typeof desktopDrag>,
    cursorX = drag.lastX,
    cursorY = drag.lastY,
  ): void => {
    desktopDragReturn = {
      name: drag.name,
      label: drag.label,
      originX: drag.originX,
      originY: drag.originY,
      fromX: cursorX - drag.grabX,
      fromY: cursorY - drag.grabY,
      startedMs: Date.now(),
      durationMs: 220,
    };
    desktopDrag = null;
    desktopDown = null;
    desktopDropHoverName = null;
    desktopDragActive = false;
    desktopDirty = true;
  };

  /** Move a local single/group drag into a folder or persist translated positions. */
  const finalizeDesktopDrop = (x: number, y: number): void => {
    if (!desktopDrag) return;
    const drag = desktopDrag;
    const pal = themePalette();
    const availH = (desktopH || 1) - pal.panelHeight;

    const targetName = desktopFolderAt(x, y, drag.names);
    if (targetName) {
      const moves = drag.names.map((name) => ({
        name,
        src: path.join(desktopDir(), name),
        dest: path.join(desktopDir(), targetName, name),
      }));
      const moved: typeof moves = [];
      try {
        for (const move of moves) {
          if (fs.existsSync(move.dest)) {
            throw new Error(`destination already exists: ${move.dest}`);
          }
        }
        for (const move of moves) {
          fs.renameSync(move.src, move.dest);
          moved.push(move);
        }
        const nextLayout = { ...desktopLayout };
        drag.names.forEach((name) => delete nextLayout[name]);
        saveDesktopLayout(nextLayout);
        desktopLayout = nextLayout;
        updateDesktopSelection({ type: "clear" });
        desktopDrag = null;
        desktopDown = null;
        desktopDropHoverName = null;
        desktopDragActive = false;
        refreshDesktop();
        console.log(
          `[shell] desktop local drop: ${drag.names.join(", ")} → ${targetName}`,
        );
        return;
      } catch (err) {
        for (const move of moved.reverse()) {
          try {
            fs.renameSync(move.dest, move.src);
          } catch (rollbackError) {
            console.error(
              "[shell] desktop group-drop rollback failed:",
              rollbackError,
            );
          }
        }
        console.error(
          `[shell] desktop local drop failed for ${drag.label} onto ${targetName}:`,
          err,
        );
        beginDesktopDragReturn(drag, x, y);
        return;
      }
    }

    const origins = drag.names
      .map((name) => drag.origins[name])
      .filter((origin): origin is { x: number; y: number } => !!origin);
    if (origins.length === 0) {
      beginDesktopDragReturn(drag, x, y);
      return;
    }
    const maxX = (desktopW || 1) - DESKTOP_ITEM_W;
    const maxY = availH - DESKTOP_ITEM_H;
    const dx = Math.max(
      Math.max(...origins.map((origin) => -origin.x)),
      Math.min(
        x - drag.grabX - drag.originX,
        Math.min(...origins.map((origin) => maxX - origin.x)),
      ),
    );
    const dy = Math.max(
      Math.max(...origins.map((origin) => -origin.y)),
      Math.min(
        y - drag.grabY - drag.originY,
        Math.min(...origins.map((origin) => maxY - origin.y)),
      ),
    );
    const nextLayout = { ...desktopLayout };
    drag.names.forEach((name) => {
      const origin = drag.origins[name];
      if (!origin) return;
      nextLayout[name] = {
        x: origin.x + dx,
        y: origin.y + dy,
      };
    });
    try {
      saveDesktopLayout(nextLayout);
      desktopLayout = nextLayout;
    } catch (error) {
      console.error("[shell] desktop layout save failed:", error);
      beginDesktopDragReturn(drag, x, y);
      return;
    }
    desktopDrag = null;
    desktopDown = null;
    desktopDropHoverName = null;
    desktopDragActive = false;
    desktopDirty = true;
  };

  const buildDragRaster = (
    cursorX: number,
    cursorY: number,
    label: string,
  ): ShellRasterSurface | null => {
    const text = label.length > 24 ? label.slice(0, 23) + "…" : label;
    const desktopPreview = desktopDrag ?? desktopDragReturn;
    const isDesktopDrag = desktopPreview?.label === label;
    let dirEntry = false;
    if (isDesktopDrag) {
      try {
        dirEntry = fs
          .statSync(path.join(desktopDir(), desktopPreview.name))
          .isDirectory();
      } catch {
        // The file may have moved while the return animation is completing.
      }
    }
    const padX = 12;
    const padY = 8;
    const plainW = Math.max(
      72,
      Math.round(measureText(text, 13 / 14) + padX * 2 + 28),
    );
    const w = isDesktopDrag ? DESKTOP_ITEM_W : plainW;
    const h = isDesktopDrag ? DESKTOP_ITEM_H : 36;
    const cacheKey = `${text}|${isDesktopDrag}|${dirEntry}`;
    if (!dragChipCache || dragChipCache.key !== cacheKey) {
      const pal = themePalette();
      renderShell(
        dragChipRoot,
        isDesktopDrag
          ? createElement(
              Group,
              { x: 0, y: 0, width: w, height: h },
              createElement(GridItem, {
                width: w,
                height: h,
                label: text,
                iconSize: ICON_SIZE,
                labelScrim: true,
                interactive: false,
                icon: createElement(Icon, {
                  name: dirEntry ? "folder" : "file",
                  size: ICON_SIZE,
                  color: dirEntry ? pal.accent : pal.text,
                }),
              }),
            )
          : createElement(
              Group,
              { x: 0, y: 0, width: w, height: h },
              createElement(Rect, {
                width: w,
                height: h,
                fill: (pal.surface & 0x00ffffff) | 0xf0000000,
              }),
              createElement(Rect, {
                width: w,
                height: 1,
                fill: pal.rimLight,
              }),
              createElement(Rect, {
                width: 3,
                height: h,
                fill: pal.accentLine,
              }),
              createElement(Label, {
                x: padX + 4,
                y: padY,
                text,
                color: pal.text,
                fontSize: 13,
                fontWeight: "medium",
              }),
            ),
      );
      const painted = rasterize(dragChipRoot.container, w, h);
      dragChipCache = { key: cacheKey, pixels: painted.pixels, w, h };
      dragChipRevision++;
    }

    let x = (cursorX | 0) + 14;
    let y = (cursorY | 0) + 12;
    if (desktopDrag) {
      x = (cursorX | 0) - desktopDrag.grabX;
      y = (cursorY | 0) - desktopDrag.grabY;
    } else if (desktopDragReturn) {
      const animation = desktopDragReturn;
      const progress = Math.min(
        1,
        Math.max(0, (Date.now() - animation.startedMs) / animation.durationMs),
      );
      if (progress >= 1) {
        desktopDragReturn = null;
        desktopDirty = true;
        return null;
      }
      const eased = 1 - Math.pow(1 - progress, 3);
      x = Math.round(animation.fromX + (animation.originX - animation.fromX) * eased);
      y = Math.round(animation.fromY + (animation.originY - animation.fromY) * eased);
    }
    return {
      id: "shell:drag-preview",
      pixels: dragChipCache.pixels,
      width: dragChipCache.w,
      height: dragChipCache.h,
      stride: dragChipCache.w * 4,
      revision: dragChipRevision,
      x,
      y,
    };
  };

  return {
    setPrimaryOutput(next) {
      if (
        primaryOutput.x === next.x &&
        primaryOutput.y === next.y &&
        primaryOutput.width === next.width &&
        primaryOutput.height === next.height
      ) return;
      primaryOutput = { ...next };
      dirty = true;
    },
    setTasks(nextTasks) {
      const changed =
        nextTasks.length !== tasks.length ||
        nextTasks.some((task, index) => {
          const current = tasks[index];
          return (
            !current ||
            current.clientId !== task.clientId ||
            current.surfaceId !== task.surfaceId ||
            current.title !== task.title ||
            current.appId !== task.appId ||
            current.focused !== task.focused ||
            current.minimized !== task.minimized
          );
        });
      if (!changed) return;
      tasks = nextTasks;
      dirty = true;
    },
    paint(fb, pitchPx, width, height) {
      if (dirty || !overlay || ow !== width || oh !== height) {
        rebuild(width, height);
      }
      if (!overlay) return;
      blendOverlay(fb, pitchPx, width, height, overlay, overlayRuns);
    },

    chromeRaster(width, height) {
      if (dirty || !overlay || ow !== width || oh !== height) {
        rebuild(width, height);
      }
      if (!overlay) return null;
      return {
        id: "shell:chrome",
        pixels: overlay,
        width,
        height,
        stride: width * 4,
        revision: overlayRevision,
        x: 0,
        y: 0,
      };
    },

    beginSsdFrame() {
      for (const key of ssdStripCache.keys()) {
        if (!ssdSeen.has(key)) {
          const stale = ssdStripCache.get(key);
          if (stale) renderShell(stale.root, null);
          ssdStripCache.delete(key);
        }
      }
      ssdSeen.clear();
      ssdHits = [];
    },

    paintSsdWindow,

    ssdRaster(window) {
      return prepareSsdWindow(window);
    },

    paintSsd(fb, pitchPx, width, height, windows) {
      ssdHits = [];
      for (const w of windows) {
        paintSsdWindow(fb, pitchPx, width, height, w);
      }
    },

    hitSsd(x, y) {
      ssdPending.current = null;
      for (let i = ssdHits.length - 1; i >= 0; i--) {
        const h = ssdHits[i]!;
        if (
          x >= h.x &&
          y >= h.y &&
          x < h.x + h.width &&
          y < h.y + h.height
) {
          h.onPress?.({
            x,
            y,
            localX: x - h.x,
            localY: y - h.y,
          });
          return ssdPending.current;
        }
      }
      return null;
    },

    onKey(ev) {
      if (ev.code === KEY_LEFTCTRL || ev.code === KEY_RIGHTCTRL) {
        ctrlHeld = ev.value !== 0;
      }
      if (ev.code === KEY_LEFTSHIFT || ev.code === KEY_RIGHTSHIFT) {
        shiftHeld = ev.value !== 0;
      }
      if (desktopMenu) {
        if (ev.value !== 1 && ev.value !== 2) return true;
        if (ev.code === KEY_ESC) {
          desktopMenu = null;
          dirty = true;
        }
        return true;
      }
      if (ev.code === KEY_LEFTMETA || ev.code === KEY_RIGHTMETA) {
        metaHeld = ev.value !== 0;
        if (ev.value === 1) {
          open = !open;
          if (!open) {
            query = "";
            selected = 0;
          }
          dirty = true;
          return true;
        }
        return true;
      }

      if (!open && desktopKeyboardActive) {
        const modifier =
          ev.code === KEY_LEFTCTRL ||
          ev.code === KEY_RIGHTCTRL ||
          ev.code === KEY_LEFTSHIFT ||
          ev.code === KEY_RIGHTSHIFT;
        // A client may have received the modifier-down before focus moved to
        // the desktop. Forward both edges so it cannot retain a stuck key.
        if (modifier) return false;
        if (ev.value !== 1 && ev.value !== 2) return true;
        if (ev.code === KEY_ESC) {
          updateDesktopSelection({ type: "clear" });
          return true;
        }
        if (ctrlHeld && ev.code === 30) {
          updateDesktopSelection({ type: "all" });
          return true;
        }
        if (ev.code === KEY_ENTER) {
          selectedDesktopNames().forEach(openDesktopEntry);
          return true;
        }
        if (ev.code === KEY_SPACE) {
          const focused = desktopSelection.focusKey;
          if (focused) {
            selectDesktopName(focused, {
              toggle: ctrlHeld,
              range: shiftHeld,
            });
          }
          return true;
        }
        if (ev.code === KEY_HOME || ev.code === KEY_END) {
          updateDesktopSelection({
            type: ev.code === KEY_HOME ? "first" : "last",
            options: {
              extend: shiftHeld,
              preserveSelection: ctrlHeld && !shiftHeld,
            },
          });
          return true;
        }
        if (ev.code === KEY_LEFT) moveDesktopSelection("left");
        else if (ev.code === KEY_RIGHT) moveDesktopSelection("right");
        else if (ev.code === KEY_UP) moveDesktopSelection("up");
        else if (ev.code === KEY_DOWN) moveDesktopSelection("down");
        return true;
      }

      if (!open) return false;
      if (ev.value !== 1 && ev.value !== 2) return true;

      if (ev.code === KEY_ESC) {
        open = false;
        query = "";
        selected = 0;
        dirty = true;
        return true;
      }
      if (ev.code === KEY_BACKSPACE) {
        query = query.slice(0, -1);
        selected = 0;
        dirty = true;
        return true;
      }
      if (ev.code === KEY_ENTER) {
        const list = filterApplications(apps, query);
        const app = list[selected];
        if (app) launch(app);
        return true;
      }
      if (ev.code === 103 || ev.code === 108) {
        const list = filterApplications(apps, query);
        if (list.length === 0) return true;
        if (ev.code === 103) selected = (selected - 1 + list.length) % list.length;
        else selected = (selected + 1) % list.length;
        dirty = true;
        return true;
      }
      const ch = US_MAP[ev.code];
      if (ch && !metaHeld && !ctrlHeld) {
        query += ch;
        selected = 0;
        dirty = true;
        return true;
      }
      return true;
    },

    onPointerButton(ev) {
      if (ev.value === 1) desktopKeyboardActive = false;
      if (ev.value === 0 && overlayPointerGrab) {
        const hit = overlayDownHit;
        if (hit) {
          const args = {
            x: ev.x,
            y: ev.y,
            localX: ev.x - hit.x,
            localY: ev.y - hit.y,
            button: ev.button === PANEL_BTN_RIGHT || ev.button === 273
              ? ("right" as const)
              : ("left" as const),
          };
          hit.onPointerUp?.(args);
          if (
            ev.x >= hit.x &&
            ev.y >= hit.y &&
            ev.x < hit.x + hit.width &&
            ev.y < hit.y + hit.height
          ) {
            hit.onPress?.(args);
          }
        }
        overlayDownHit = null;
        overlayPointerGrab = false;
        dirty = true;
        return true;
      }
      if (ev.value !== 1) {
        return open || desktopMenu != null;
      }
      for (let i = hits.length - 1; i >= 0; i--) {
        const h = hits[i]!;
        if (
          !h.onPointerDown &&
          !h.onPress &&
          !h.onContextMenu &&
          !h.focusable
        ) {
          continue;
        }
        if (
          ev.x >= h.x &&
          ev.y >= h.y &&
          ev.x < h.x + h.width &&
          ev.y < h.y + h.height
        ) {
          overlayDownHit = h;
          h.onPointerDown?.({
            x: ev.x,
            y: ev.y,
            localX: ev.x - h.x,
            localY: ev.y - h.y,
            button: ev.button === PANEL_BTN_RIGHT || ev.button === 273
              ? ("right" as const)
              : ("left" as const),
          });
          overlayPointerGrab = true;
          dirty = true;
          return true;
        }
      }
      if (open) {
        open = false;
        query = "";
        selected = 0;
        overlayPointerGrab = true;
        dirty = true;
        return true;
      }
      return false;
    },

    onPointerMotion(ev) {
      let next: HitRegion | null = null;
      for (let i = hits.length - 1; i >= 0; i--) {
        const hit = hits[i]!;
        if (
          ev.x >= hit.x &&
          ev.y >= hit.y &&
          ev.x < hit.x + hit.width &&
          ev.y < hit.y + hit.height &&
          (hit.onPointerEnter || hit.onPointerLeave || hit.onPointerMove)
        ) {
          next = hit;
          break;
        }
      }

      if (next !== shellHover) {
        shellHover?.onPointerLeave?.({
          x: ev.x,
          y: ev.y,
          localX: ev.x - shellHover.x,
          localY: ev.y - shellHover.y,
        });
        shellHover = next;
        next?.onPointerEnter?.({
          x: ev.x,
          y: ev.y,
          localX: ev.x - next.x,
          localY: ev.y - next.y,
        });
        dirty = true;
      } else if (next?.onPointerMove) {
        next.onPointerMove({
          x: ev.x,
          y: ev.y,
          localX: ev.x - next.x,
          localY: ev.y - next.y,
        });
        dirty = true;
      }

      return open || desktopMenu != null || next != null;
    },

    onSsdPointerMotion(ev) {
      let next: SsdHit | null = null;
      if (ev.inside) {
        for (let i = ssdHits.length - 1; i >= 0; i--) {
          const hit = ssdHits[i]!;
          if (
            ev.x >= hit.x &&
            ev.y >= hit.y &&
            ev.x < hit.x + hit.width &&
            ev.y < hit.y + hit.height &&
            (hit.onPointerEnter || hit.onPointerLeave || hit.onPointerMove)
          ) {
            next = hit;
            break;
          }
        }
      }

      if (next?.identity !== ssdHover?.identity) {
        ssdHover?.onPointerLeave?.({
          x: ev.x,
          y: ev.y,
          localX: ev.x - ssdHover.x,
          localY: ev.y - ssdHover.y,
        });
        if (ssdHover) {
          const previous = ssdStripCache.get(ssdHover.stripKey);
          if (previous) previous.dirty = true;
        }
        ssdHover = next;
        next?.onPointerEnter?.({
          x: ev.x,
          y: ev.y,
          localX: ev.x - next.x,
          localY: ev.y - next.y,
        });
        if (next) {
          const current = ssdStripCache.get(next.stripKey);
          if (current) current.dirty = true;
        }
        ssdAnimationActive = true;
      } else if (next) {
        // Rasterization replaces HitRegion objects; retain the current one so
        // future leave events reach the latest persistent React instance.
        ssdHover = next;
        next.onPointerMove?.({
          x: ev.x,
          y: ev.y,
          localX: ev.x - next.x,
          localY: ev.y - next.y,
        });
      }

      return ev.inside;
    },

    onPointerAxis(ev) {
      for (let i = hits.length - 1; i >= 0; i--) {
        const hit = hits[i]!;
        if (
          hit.onWheel &&
          ev.x >= hit.x &&
          ev.y >= hit.y &&
          ev.x < hit.x + hit.width &&
          ev.y < hit.y + hit.height
        ) {
          hit.onWheel({
            x: ev.x,
            y: ev.y,
            localX: ev.x - hit.x,
            localY: ev.y - hit.y,
            // evdev REL_WHEEL is a signed notch count, while ScrollArea uses
            // logical pixels. Match Wayland's direction and advance about one
            // launcher row per notch so wheel input is visibly responsive.
            deltaY: -ev.deltaY * 44,
          });
          dirty = true;
          return true;
        }
      }
      return open || desktopMenu != null;
    },

    onDesktopPointerButton(ev) {
      const left = ev.button === PANEL_BTN_LEFT || ev.button === 272;
      const right = ev.button === PANEL_BTN_RIGHT || ev.button === 273;
      if (!left && !right) return false;
      ensureDesktopHits();
      const pal = themePalette();

      const findHit = (pred: (h: HitRegion) => boolean): HitRegion | null => {
        for (let i = desktopHits.length - 1; i >= 0; i--) {
          const h = desktopHits[i]!;
          if (
            ev.x >= h.x &&
            ev.y >= h.y &&
            ev.x < h.x + h.width &&
            ev.y < h.y + h.height &&
            pred(h)
          ) {
            return h;
          }
        }
        return null;
      };

      const args = (h: HitRegion) => ({
        x: ev.x,
        y: ev.y,
        localX: ev.x - h.x,
        localY: ev.y - h.y,
        button: right ? ("right" as const) : ("left" as const),
        shiftKey: shiftHeld,
        ctrlKey: ctrlHeld,
        metaKey: false,
      });

      if (right) {
        if (ev.value !== 1) return desktopMenu != null;
        desktopKeyboardActive = true;
        const hit = findHit((h) => !!h.onContextMenu);
        if (hit?.onContextMenu) {
          hit.onContextMenu(args(hit));
          desktopDirty = true;
          return true;
        }
        if (desktopMenu) {
          desktopMenu = null;
          desktopDirty = true;
          dirty = true;
          return true;
        }
        return false;
      }

      if (ev.value === 1) {
        desktopKeyboardActive = true;
        desktopDragReturn = null;
        const hit = findHit((h) => !!(h.onPointerDown || h.onPress));
        if (!hit) {
          updateDesktopSelection({ type: "clear" });
          desktopDown = null;
          desktopDrag = null;
          return false;
        }
        const overlayOpen = desktopMenu != null;
        const name = overlayOpen
          ? null
          : hitTestDesktopIcon(
              ev.x,
              ev.y,
              desktopEntries,
              desktopLayout,
              desktopW || 1,
              desktopH || 1,
              pal.panelHeight,
            );
        desktopDown = { x: ev.x, y: ev.y, hit, name: name ?? undefined };
        desktopDrag = null;
        hit.onPointerDown?.(args(hit));
        desktopDirty = true;
        return true;
      }

      if (ev.value === 0) {
        if (desktopDrag) {
          finalizeDesktopDrop(ev.x, ev.y);
          return true;
        }

        const hit =
          findHit((h) => !!(h.onPointerUp || h.onPress)) ??
          desktopDown?.hit ??
          null;
        if (hit?.onPointerUp) hit.onPointerUp(args(hit));
        if (desktopDown) {
          const dx = ev.x - desktopDown.x;
          const dy = ev.y - desktopDown.y;
          if (dx * dx + dy * dy < DESKTOP_DRAG_THRESHOLD * DESKTOP_DRAG_THRESHOLD) {
            const pressHit = findHit((h) => !!h.onPress) ?? desktopDown.hit;
            pressHit.onPress?.(args(pressHit));
          }
        }
        desktopDown = null;
        desktopDirty = true;
        return hit != null;
      }

      return false;
    },

    onDesktopPointerMotion(ev) {
      const settings = loadSettings();
      if (!settings.showDesktopIcons) return;
      ensureDesktopHits();

      if (desktopDown?.name && !desktopDrag) {
        const dx = ev.x - desktopDown.x;
        const dy = ev.y - desktopDown.y;
        if (dx * dx + dy * dy >= DESKTOP_DRAG_THRESHOLD * DESKTOP_DRAG_THRESHOLD) {
          const name = desktopDown.name;
          if (!desktopSelection.selectedKeys.has(name)) selectDesktopName(name);
          const names = desktopSelection.selectedKeys.has(name)
            ? selectedDesktopNames()
            : [name];
          const origins: DesktopLayout = {};
          names.forEach((selectedName) => {
            const index = desktopEntries.indexOf(selectedName);
            if (index < 0) return;
            origins[selectedName] = desktopIconPosition(
              selectedName,
              index,
              desktopLayout,
              desktopW || 1,
              desktopH || 1,
              themePalette().panelHeight,
            );
          });
          const origin = origins[name] ?? {
            x: desktopDown.hit.x,
            y: desktopDown.hit.y,
          };
          desktopDrag = {
            name,
            names,
            label: names.length > 1 ? `${names.length} items` : name,
            origins,
            grabX: desktopDown.x - origin.x,
            grabY: desktopDown.y - origin.y,
            originX: origin.x,
            originY: origin.y,
            lastX: ev.x,
            lastY: ev.y,
          };
          desktopDragStartMs = Date.now();
          desktopDirty = true;
        }
      }

      if (desktopDrag) {
        desktopDrag.lastX = ev.x;
        desktopDrag.lastY = ev.y;
        // Traditional drag semantics: the icon stays put (desktopLayout is
        // untouched) while a translucent ghost tracks the cursor via
        // paintDragPreview; the real position only commits on drop, in
        // finalizeDesktopDrop. No desktop-layer rebuild needed here.
        const nextDropHover = desktopFolderAt(
          ev.x,
          ev.y,
          desktopDrag.names,
        );
        if (
          nextDropHover !== desktopDropHoverName ||
          !desktopDragActive
        ) {
          desktopDropHoverName = nextDropHover;
          desktopDragActive = true;
          desktopDirty = true;
        }
        return;
      }

      let next: HitRegion | null = null;
      for (let i = desktopHits.length - 1; i >= 0; i--) {
        const h = desktopHits[i]!;
        if (
          ev.x >= h.x &&
          ev.y >= h.y &&
          ev.x < h.x + h.width &&
          ev.y < h.y + h.height &&
          (h.onPointerEnter || h.onPointerLeave || h.onPointerMove)
        ) {
          next = h;
          break;
        }
      }
      if (next !== desktopHover) {
        if (desktopHover?.onPointerLeave) {
          desktopHover.onPointerLeave({
            x: ev.x,
            y: ev.y,
            localX: ev.x - desktopHover.x,
            localY: ev.y - desktopHover.y,
          });
        }
        desktopHover = next;
        if (next?.onPointerEnter) {
          next.onPointerEnter({
            x: ev.x,
            y: ev.y,
            localX: ev.x - next.x,
            localY: ev.y - next.y,
          });
        }
        desktopDirty = true;
      } else if (next?.onPointerMove) {
        next.onPointerMove({
          x: ev.x,
          y: ev.y,
          localX: ev.x - next.x,
          localY: ev.y - next.y,
        });
        desktopDirty = true;
      }
    },

    isLauncherOpen: () => open,
    needsRepaint: () => {
      const now = Date.now();
      const dt = Math.min((now - desktopMotionTick) / 1000, 0.1);
      desktopMotionTick = now;
      const wasSsdAnimating = ssdAnimationActive;
      const motionsMoving = tickAllMotions(dt);
      if (motionsMoving || wasSsdAnimating) {
        dirty = true;
        desktopDirty = true;
        for (const strip of ssdStripCache.values()) strip.dirty = true;
      }
      ssdAnimationActive = motionsMoving;
      return dirty || desktopDirty || desktopDrag != null || desktopDragReturn != null;
    },
    invalidateChrome: () => {
      dirty = true;
      overlay = null;
      overlayRuns = null;
      ow = 0;
      oh = 0;
      for (const strip of ssdStripCache.values()) {
        renderShell(strip.root, null);
      }
      ssdStripCache.clear();
      ssdSeen.clear();
      ssdHover = null;
      ssdAnimationActive = false;
      desktopOverlay = null;
      desktopOverlayRuns = null;
      desktopDirty = true;
      desktopW = 0;
      desktopH = 0;
      dragChipCache = null;
      const settings = loadSettings();
      showDesktopIcons = settings.showDesktopIcons;
      setUiScaleFactor(settings.uiScale);
      console.log("[shell] chrome invalidated (prefs/theme)");
    },

    paintDesktop(fb, pitchPx, width, height) {
      if (
        desktopDirty ||
        !desktopOverlay ||
        desktopW !== width ||
        desktopH !== height
      ) {
        rebuildDesktop(width, height);
      }
      if (!showDesktopIcons) return;
      if (!desktopOverlay) return;
      blendOverlay(
        fb,
        pitchPx,
        width,
        height,
        desktopOverlay,
        desktopOverlayRuns,
      );
    },

    desktopRaster(width, height) {
      if (
        desktopDirty ||
        !desktopOverlay ||
        desktopW !== width ||
        desktopH !== height
      ) {
        rebuildDesktop(width, height);
      }
      if (!showDesktopIcons || !desktopOverlay) return null;
      return {
        id: "shell:desktop",
        pixels: desktopOverlay,
        width,
        height,
        stride: width * 4,
        revision: desktopRevision,
        x: 0,
        y: 0,
      };
    },

    acceptDesktopDrop(uris, x, y) {
      const root = desktopDir();
      try {
        fs.mkdirSync(root, { recursive: true });
      } catch {
        // ignore
      }

      // If the drop landed on a folder icon, move into that folder instead
      // of the desktop root.
      const pal = themePalette();
      const hitName = hitTestDesktopIcon(
        x,
        y,
        desktopEntries,
        desktopLayout,
        desktopW || 1,
        desktopH || 1,
        pal.panelHeight,
      );
      let dest = root;
      if (hitName) {
        const hitPath = path.join(root, hitName);
        try {
          if (fs.statSync(hitPath).isDirectory()) dest = hitPath;
        } catch {
          // ignore
        }
      }
      const intoFolder = dest !== root;
      let accepted = false;

      for (const uri of uris) {
        if (!uri.startsWith("file://")) continue;
        const src = decodeURIComponent(uri.slice("file://".length));
        const destPath = path.join(dest, path.basename(src));
        if (src === destPath) continue;
        try {
          if (intoFolder) {
            try {
              fs.renameSync(src, destPath);
            } catch {
              fs.copyFileSync(src, destPath);
            }
          } else {
            fs.copyFileSync(src, destPath);
          }
          accepted = true;
          console.log(`[shell] desktop drop: ${src} → ${destPath}`);
        } catch (err) {
          console.error(`[shell] desktop drop failed for ${src}:`, err);
        }
      }
      refreshDesktop();
      return accepted;
    },

    hitDesktop(_x, y) {
      const pal = themePalette();
      if (desktopH > 0) {
        return y < desktopH - pal.panelHeight;
      }
      return y >= 0;
    },

    paintDragPreview(fb, pitchPx, _width, _height, cursorX, cursorY, label) {
      const text = label.length > 24 ? label.slice(0, 23) + "…" : label;
      // Desktop-origin drags (the only ones without a real Wayland icon
      // surface, so the only ones that ever reach this chip fallback) get a
      // translucent copy of the actual tile (same GridItem, same shape) that
      // tracks the original grab point — a traditional OS-style ghost, not
      // a live-moving icon. Other sources (rare: a real client drag with no
      // icon surface of its own) fall back to a plain text chip.
      const desktopPreview = desktopDrag ?? desktopDragReturn;
      const isDesktopDrag = desktopPreview?.label === label;
      let dirEntry = false;
      if (isDesktopDrag) {
        try {
          dirEntry = fs
            .statSync(path.join(desktopDir(), desktopPreview.name))
            .isDirectory();
        } catch {
          // ignore
        }
      }
      const chipW = isDesktopDrag ? DESKTOP_ITEM_W : 0;
      const chipH = isDesktopDrag ? DESKTOP_ITEM_H : 0;
      const padX = 12;
      const padY = 8;
      const tw = measureText(text, 13 / 14);
      const plainW = Math.max(72, Math.round(tw + padX * 2 + 28));
      const plainH = 36;
      const w = isDesktopDrag ? chipW : plainW;
      const h = isDesktopDrag ? chipH : plainH;
      const cacheKey = `${text}|${isDesktopDrag}|${dirEntry}`;
      if (!dragChipCache || dragChipCache.key !== cacheKey) {
        const pal = themePalette();
        renderShell(
          dragChipRoot,
          isDesktopDrag
            ? createElement(
                Group,
                { x: 0, y: 0, width: w, height: h, opacity: 0.6 },
                createElement(GridItem, {
                  width: w,
                  height: h,
                  label: text,
                  iconSize: ICON_SIZE,
                  labelScrim: true,
                  interactive: false,
                  icon: createElement(Icon, {
                    name: dirEntry ? "folder" : "file",
                    size: ICON_SIZE,
                    color: dirEntry ? pal.accent : pal.text,
                  }),
                }),
              )
            : createElement(
                Group,
                { x: 0, y: 0, width: w, height: h },
                createElement(Rect, {
                  x: 0,
                  y: 0,
                  width: w,
                  height: h,
                  fill: (pal.surface & 0x00ffffff) | 0xf0000000,
                }),
                createElement(Rect, {
                  x: 0,
                  y: 0,
                  width: w,
                  height: 1,
                  fill: pal.rimLight,
                }),
                createElement(Rect, {
                  x: 0,
                  y: 0,
                  width: 3,
                  height: h,
                  fill: pal.accentLine,
                }),
                createElement(Label, {
                  x: padX + 4,
                  y: padY,
                  text,
                  color: pal.text,
                  fontSize: 13,
                  fontWeight: "medium",
                }),
              ),
        );
        const painted = rasterize(dragChipRoot.container, w, h);
        dragChipCache = {
          key: cacheKey,
          pixels: painted.pixels,
          w,
          h,
        };
      }
      const chip = dragChipCache;
      // Desktop drags track the original grab point (where the icon would
      // land if dropped now); other chips float near the cursor.
      let dx = (cursorX | 0) + 14;
      let dy = (cursorY | 0) + 12;
      if (desktopDrag) {
        dx = (cursorX | 0) - desktopDrag.grabX;
        dy = (cursorY | 0) - desktopDrag.grabY;
      } else if (desktopDragReturn) {
        const anim = desktopDragReturn;
        const progress = Math.min(
          1,
          Math.max(0, (Date.now() - anim.startedMs) / anim.durationMs),
        );
        if (progress >= 1) {
          desktopDragReturn = null;
          desktopDirty = true;
          return;
        }
        const eased = 1 - Math.pow(1 - progress, 3);
        dx = Math.round(anim.fromX + (anim.originX - anim.fromX) * eased);
        dy = Math.round(anim.fromY + (anim.originY - anim.fromY) * eased);
      }
      blitStrip(fb, pitchPx, _width, _height, dx, dy, chip.pixels, chip.w, chip.h);
    },

    dragRaster(cursorX, cursorY, label) {
      return buildDragRaster(cursorX, cursorY, label);
    },

    desktopDragLabel: () =>
      desktopDrag?.label ?? desktopDragReturn?.label ?? null,

    desktopDragUri: () => {
      if (!desktopDrag) return null;
      const uri = desktopDrag.names
        .map((name) => pathToFileURL(path.join(desktopDir(), name)).href)
        .join("\n");
      return { uri: `${uri}\n`, label: desktopDrag.label };
    },

    finishDesktopDrag: (commit, x, y) => {
      if (!desktopDrag) return;
      if (commit) {
        finalizeDesktopDrop(x, y);
      } else {
        desktopDrag = null;
        desktopDown = null;
        desktopDragReturn = null;
        desktopDirty = true;
      }
    },

    onDesktopDragHover: (x, y, mimeTypes) => {
      const active = mimeTypes.includes("text/uri-list");
      let next: string | null = null;
      if (active) {
        const pal = themePalette();
        const hitName = hitTestDesktopIcon(
          x,
          y,
          desktopEntries,
          desktopLayout,
          desktopW || 1,
          desktopH || 1,
          pal.panelHeight,
        );
        if (hitName !== desktopDropHoverName) {
          const bounds = desktopEntries.map((n) => {
            const saved = desktopLayout[n];
            return `${n}@${saved ? `${saved.x},${saved.y}` : "(default)"}`;
          });
          console.log(
            `[shell] desktop-hover hit-test x=${x} y=${y} desktopW=${desktopW} desktopH=${desktopH} panelH=${pal.panelHeight} -> ${hitName ?? "(none)"} | entries: ${bounds.join(" ")}`,
          );
        }
        if (hitName) {
          try {
            if (fs.statSync(path.join(desktopDir(), hitName)).isDirectory()) {
              next = hitName;
            }
          } catch {
            // ignore
          }
        }
      }
      if (next !== desktopDropHoverName || active !== desktopDragActive) {
        desktopDropHoverName = next;
        desktopDragActive = active;
        desktopDirty = true;
      }
    },

    clearDesktopDragHover: () => {
      if (desktopDropHoverName !== null || desktopDragActive) {
        desktopDropHoverName = null;
        desktopDragActive = false;
        desktopDirty = true;
      }
    },

    cancelDesktopDrag: (x, y) => {
      if (!desktopDrag) return;
      console.warn(`[shell] desktop-drag cancelled (was dragging "${desktopDrag.label}")`);
      beginDesktopDragReturn(desktopDrag, x, y);
    },

    checkDesktopDragWatchdog: () => {
      if (!desktopDrag) return;
      const idleMs = Date.now() - desktopDragStartMs;
      if (idleMs > DESKTOP_DRAG_WATCHDOG_TIMEOUT_MS) {
        console.warn(
          `[shell] desktop-drag watchdog: clearing stuck drag "${desktopDrag.label}" idle for ${idleMs}ms`,
        );
        beginDesktopDragReturn(desktopDrag);
      }
    },
  };
}

function formatClock(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
