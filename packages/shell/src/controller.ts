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
import { createElement, useEffect, useMemo } from "react";
import { Panel } from "./Panel.js";
import { Launcher } from "./Launcher.js";
import { TitleBar, TITLEBAR_H } from "./TitleBar.js";
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
  let apps = discoverApplications(
    process.env.XDG_CURRENT_DESKTOP ?? "Moire",
  );
  let open = process.env.MOIRE_SHELL_START_OPEN === "1";
  let query = "";
  let selected = 0;
  let clock = formatClock();
  let dirty = true;
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

  const refreshApps = () => {
    apps = discoverApplications(process.env.XDG_CURRENT_DESKTOP ?? "Moire");
    dirty = true;
  };
  setInterval(refreshApps, 30_000).unref?.();
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

  const paintSsdWindow = (
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    window: SsdWindowInfo,
  ) => {
    const stripKey = `${window.clientId}:${window.surfaceId}:${window.contentW}:${window.title}:${window.focused ? 1 : 0}`;
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
        TITLEBAR_H,
      );
      strip = {
        pixels: painted.pixels,
        w: window.contentW,
        h: TITLEBAR_H,
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
          h.onPress();
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
          h.onPress();
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
  };
}

function formatClock(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
