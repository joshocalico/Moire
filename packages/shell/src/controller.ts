import {
  discoverApplications,
  filterApplications,
  type DesktopEntry,
} from "@moire/app-discovery";
import {
  createShellRoot,
  rasterize,
  renderShell,
  type HitRegion,
  type ShellRoot,
} from "@moire/react-host";
import { installUiFonts, setUiScaleFactor } from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import { themePalette } from "@moire/theme";
import { createElement, useEffect, useMemo } from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Panel } from "./Panel.js";
import { Launcher } from "./Launcher.js";
import { TitleBar } from "./TitleBar.js";
import {
  DesktopIcons,
  listDesktopEntries,
  loadDesktopLayout,
  desktopDir,
  type DesktopLayout,
} from "./DesktopIcons.js";
import type { SsdAction, SsdWindowInfo } from "./ssd.js";

export type ShellSpawn = (opts: { exec: string }) => { unref?: () => void };

export type ShellBridge = {
  paint(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
  ): void;
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
  isLauncherOpen(): boolean;
  /** True when panel/launcher content changed (e.g. clock). */
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
  /** Parse file:// URIs, copy files to ~/Desktop, refresh icon list. */
  acceptDesktopDrop(uris: string[]): void;
  /** True if (x,y) is over a desktop icon hit region. */
  hitDesktop(x: number, y: number): boolean;
};

const KEY_ESC = 1;
const KEY_BACKSPACE = 14;
const KEY_ENTER = 28;
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
  open: boolean;
  query: string;
  selected: number;
  apps: DesktopEntry[];
  clock: string;
  onToggle: () => void;
  onQuery: (q: string) => void;
  onSelect: (i: number) => void;
  onLaunch: (app: DesktopEntry) => void;
  onDismiss: () => void;
};

function ShellApp(props: ShellAppProps) {
  const filtered = useMemo(
    () => filterApplications(props.apps, props.query).slice(0, 12),
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
    createElement(Panel, {
      screenW: props.width,
      screenH: props.height,
      clock: props.clock,
      onLauncherClick: props.onToggle,
    }),
    createElement(Launcher, {
      open: props.open,
      screenW: props.width,
      screenH: props.height,
      apps: filtered,
      query: props.query,
      selected: props.selected,
      onQueryChange: props.onQuery,
      onLaunch: props.onLaunch,
      onDismiss: props.onDismiss,
      onSelect: props.onSelect,
    }),
  );
}

/**
 * In-process DE shell: bottom panel + Super-key launcher + SSD titlebars.
 */
export function createShell(spawn: ShellSpawn): ShellBridge {
  const root: ShellRoot = createShellRoot();
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
      terminal: false,
      categories: ["Settings", "System"],
    },
    {
      id: "moire-files.desktop",
      name: "Files",
      comment: "Moire file browser",
      exec: filesExec,
      terminal: false,
      categories: ["FileManager", "System"],
    },
  ];
  const mergeApps = (): DesktopEntry[] => [
    ...builtinApps,
    ...discoverApplications(process.env.XDG_CURRENT_DESKTOP ?? "Moire").filter(
      (a) => a.id !== "moire-settings.desktop",
    ),
  ];
  let apps = mergeApps();
  let open = process.env.MOIRE_SHELL_START_OPEN === "1";
  let query = "";
  let selected = 0;
  let clock = formatClock();
  let dirty = true;
  setUiScaleFactor(loadSettings().uiScale);
  void installUiFonts().then(() => {
    dirty = true;
    console.log("[shell] TTF fonts ready (@moire/ui)");
  });
  if (open) console.log("[shell] launcher start-open (MOIRE_SHELL_START_OPEN)");
  let hits: HitRegion[] = [];
  let overlay: Uint8Array | null = null;
  let ow = 0;
  let oh = 0;
  let metaHeld = false;

  let ssdHits: HitRegion[] = [];
  let ssdPending: { current: SsdAction | null } = { current: null };
  /** Cached titlebar strips keyed by content (not position). */
  const ssdStripCache = new Map<
    string,
    { pixels: Uint8Array; w: number; h: number; hits: HitRegion[] }
  >();
  const ssdScratchRoot: ShellRoot = createShellRoot();

  // ── Desktop icons state ────────────────────────────────────────────────────
  const desktopRoot: ShellRoot = createShellRoot();
  let desktopEntries: string[] = listDesktopEntries();
  let desktopLayout: DesktopLayout = loadDesktopLayout();
  let desktopSelectedName: string | undefined;
  let desktopHits: HitRegion[] = [];
  let desktopOverlay: Uint8Array | null = null;
  let desktopW = 0;
  let desktopH = 0;
  let desktopDirty = true;

  const refreshApps = () => {
    apps = mergeApps();
    dirty = true;
  };
  setInterval(refreshApps, 30_000).unref?.();

  const refreshDesktop = () => {
    desktopEntries = listDesktopEntries();
    desktopLayout = loadDesktopLayout();
    desktopDirty = true;
  };
  // Refresh desktop list every 2s to catch external changes
  setInterval(refreshDesktop, 2_000).unref?.();

  const openDesktopEntry = (name: string) => {
    const filePath = path.join(desktopDir(), name);
    try {
      const child = spawn({ exec: `xdg-open ${filePath}` });
      child.unref?.();
      console.log(`[shell] desktop open: ${filePath}`);
    } catch (err) {
      console.error(`[shell] desktop open failed:`, err);
    }
  };
  setInterval(() => {
    const next = formatClock();
    if (next !== clock) {
      clock = next;
      dirty = true;
    }
  }, 1000).unref?.();

  const launch = (app: DesktopEntry) => {
    const exec = app.terminal ? `foot -e ${app.exec}` : app.exec;
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
    renderShell(
      root,
      createElement(ShellApp, {
        width,
        height,
        open,
        query,
        selected,
        apps,
        clock,
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
      }),
    );
    const painted = rasterize(root.container, width, height);
    overlay = painted.pixels;
    hits = painted.hits;
    ow = width;
    oh = height;
    dirty = false;
  };

  const blendOverlay = (
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    srcBytes: Uint8Array,
  ) => {
    const src = new Uint32Array(
      srcBytes.buffer,
      srcBytes.byteOffset,
      srcBytes.byteLength >>> 2,
    );
    for (let y = 0; y < height; y++) {
      const si = y * width;
      const di = y * pitchPx;
      for (let x = 0; x < width; x++) {
        const pixel = src[si + x]!;
        const a = (pixel >>> 24) & 0xff;
        if (a === 0) continue;
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
      createElement(DesktopIcons, {
        screenW: width,
        screenH: height,
        panelH: pal.panelHeight,
        entries: desktopEntries,
        layout: desktopLayout,
        selectedName: desktopSelectedName,
        onSelect: (name) => {
          desktopSelectedName = name;
          desktopDirty = true;
        },
        onOpen: openDesktopEntry,
      }),
    );
    const painted = rasterize(desktopRoot.container, width, height);
    desktopOverlay = painted.pixels;
    desktopHits = painted.hits;
    desktopW = width;
    desktopH = height;
    desktopDirty = false;
  };

  const paintSsdWindow = (
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    window: SsdWindowInfo,
  ) => {
    const stripKey = `${window.clientId}:${window.surfaceId}:${window.contentW}:${window.title}:${window.focused ? 1 : 0}`;
    const titlebarH = themePalette().titlebarHeight;
    let strip = ssdStripCache.get(stripKey);
    if (!strip) {
      ssdPending = { current: null };
      const sid = window.surfaceId;
      const cid = window.clientId;
      renderShell(
        ssdScratchRoot,
        createElement(TitleBar, {
          x: 0,
          y: 0,
          width: window.contentW,
          title: window.title,
          focused: window.focused,
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
        ssdScratchRoot.container,
        Math.max(1, window.contentW),
        titlebarH,
      );
      strip = {
        pixels: painted.pixels,
        w: window.contentW,
        h: titlebarH,
        hits: painted.hits,
      };
      ssdStripCache.set(stripKey, strip);
      for (const k of [...ssdStripCache.keys()]) {
        if (k !== stripKey && k.startsWith(`${window.clientId}:${window.surfaceId}:`)) {
          ssdStripCache.delete(k);
        }
      }
    }

    blitStrip(
      fb,
      pitchPx,
      width,
      height,
      window.x,
      window.y,
      strip.pixels,
      strip.w,
      strip.h,
    );

    for (const h of strip.hits) {
      ssdHits.push({
        x: window.x + h.x,
        y: window.y + h.y,
        width: h.width,
        height: h.height,
        onPress: h.onPress,
      });
    }
  };

  return {
    paint(fb, pitchPx, width, height) {
      if (dirty || !overlay || ow !== width || oh !== height) {
        rebuild(width, height);
      }
      if (!overlay) return;
      blendOverlay(fb, pitchPx, width, height, overlay);
    },

    beginSsdFrame() {
      ssdHits = [];
    },

    paintSsdWindow,

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
        const list = filterApplications(apps, query).slice(0, 12);
        const app = list[selected];
        if (app) launch(app);
        return true;
      }
      if (ev.code === 103 || ev.code === 108) {
        const list = filterApplications(apps, query).slice(0, 12);
        if (list.length === 0) return true;
        if (ev.code === 103) selected = (selected - 1 + list.length) % list.length;
        else selected = (selected + 1) % list.length;
        dirty = true;
        return true;
      }
      const ch = US_MAP[ev.code];
      if (ch && !metaHeld) {
        query += ch;
        selected = 0;
        dirty = true;
        return true;
      }
      return true;
    },

    onPointerButton(ev) {
      if (ev.value !== 1) return open;
      for (let i = hits.length - 1; i >= 0; i--) {
        const h = hits[i]!;
        if (
          ev.x >= h.x &&
          ev.y >= h.y &&
          ev.x < h.x + h.width &&
          ev.y < h.y + h.height
        ) {
          h.onPress?.({
            x: ev.x,
            y: ev.y,
            localX: ev.x - h.x,
            localY: ev.y - h.y,
          });
          dirty = true;
          return true;
        }
      }
      if (open) {
        open = false;
        query = "";
        selected = 0;
        dirty = true;
        return true;
      }
      return false;
    },

    isLauncherOpen: () => open,
    needsRepaint: () => dirty,
    invalidateChrome: () => {
      dirty = true;
      overlay = null;
      ow = 0;
      oh = 0;
      ssdStripCache.clear();
      desktopOverlay = null;
      desktopDirty = true;
      desktopW = 0;
      desktopH = 0;
      const settings = loadSettings();
      setUiScaleFactor(settings.uiScale);
      console.log("[shell] chrome invalidated (prefs/theme)");
    },

    paintDesktop(fb, pitchPx, width, height) {
      const settings = loadSettings();
      if (!settings.showDesktopIcons) return;
      if (desktopDirty || !desktopOverlay || desktopW !== width || desktopH !== height) {
        rebuildDesktop(width, height);
      }
      if (!desktopOverlay) return;
      blendOverlay(fb, pitchPx, width, height, desktopOverlay);
    },

    acceptDesktopDrop(uris) {
      const dest = desktopDir();
      try {
        fs.mkdirSync(dest, { recursive: true });
      } catch {
        // ignore
      }
      for (const uri of uris) {
        if (!uri.startsWith("file://")) continue;
        const src = decodeURIComponent(uri.slice("file://".length));
        try {
          const base = path.basename(src);
          fs.copyFileSync(src, path.join(dest, base));
          console.log(`[shell] desktop drop: ${src} → ${dest}/${base}`);
        } catch (err) {
          console.error(`[shell] desktop drop failed for ${src}:`, err);
        }
      }
      refreshDesktop();
    },

    hitDesktop(x, y) {
      for (let i = desktopHits.length - 1; i >= 0; i--) {
        const h = desktopHits[i]!;
        if (x >= h.x && y >= h.y && x < h.x + h.width && y < h.y + h.height) {
          return true;
        }
      }
      return false;
    },
  };
}

function formatClock(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
