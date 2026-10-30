/**
 * The shell's lock screen surface: its own React root, rendered for the compositor's locked
 * frame, plus pointer dispatch for the power menu. Mounted only while locked, so nothing of the
 * desktop chrome (popups, notifications, drafts) is part of it.
 *
 * Keys never come here: the compositor turns them into the password itself and sends back only
 * a view. A throw from here makes the compositor draw its own prompt; the lock holds either way.
 */
import React from "react";
import {
  RetainedSceneRenderer,
  RetainedSoftwareRenderer,
  collectHits,
  createShellRoot,
  hitRegionContains,
  renderShell,
  type HitPointerEvent,
  type HitRegion,
  type RetainedSceneFrame,
} from "@moire/react-host";
import { getUiScaleFactor } from "@moire/ui";
import { LockScreen, type LockBattery } from "./LockScreen";
import type { LockScreenAction, LockScreenView } from "./types";

export type LockRaster = {
  id: string;
  pixels: Uint8Array;
  width: number;
  height: number;
  stride: number;
  revision: number;
  x: number;
  y: number;
};

export type LockSurfaceDeps = {
  clock(): string;
  date(): string;
  battery(): LockBattery | null;
  /** Theme or scale changed since the last call (re-render everything). */
  themeEpoch?(): number;
};

export type LockSurface = {
  raster(view: LockScreenView, width: number, height: number): LockRaster | null;
  pointer(ev: { x: number; y: number; button?: number; value?: number }): LockScreenAction | null;
  /** True while the lock UI has motion or a pending re-render. */
  needsRepaint(motionsMoving: boolean): boolean;
  setLocked(locked: boolean): void;
  /** Where a control is (by focusId) in the last raster, for smokes. */
  control(focusId: string): { x: number; y: number; width: number; height: number } | null;
};

const BTN_LEFT = 0x110;
/** The power menu closes by itself if left open. */
const MENU_TIMEOUT_MS = 10_000;

export function createLockSurface(deps: LockSurfaceDeps): LockSurface {
  let root = createShellRoot({ onCommit: () => (committed = true) });
  let committed = true;
  let scene = new RetainedSceneRenderer({ precise: true });
  const software = new RetainedSoftwareRenderer();
  let mounted = false;
  let inputs = "";
  let pixels: Uint8Array | null = null;
  let revision = 0;
  let size = { width: 0, height: 0 };
  let hits: HitRegion[] = [];
  let menuOpen = false;
  let menuOpenedAt = 0;
  let hovered: HitRegion | null = null;
  let pressed: HitRegion | null = null;
  let action: LockScreenAction | null = null;
  let lastView: LockScreenView | null = null;
  let moving = false;

  const render = (view: LockScreenView, width: number, height: number) => {
    renderShell(
      root,
      <LockScreen
        width={width}
        height={height}
        view={view}
        clock={deps.clock()}
        date={deps.date()}
        battery={deps.battery()}
        powerMenuOpen={menuOpen}
        onPowerMenu={(open) => {
          menuOpen = open;
          menuOpenedAt = Date.now();
          inputs = "";
        }}
        onAction={(chosen) => {
          action = chosen;
          menuOpen = false;
          inputs = "";
        }}
      />,
    );
  };

  const present = (frame: RetainedSceneFrame, full: boolean) => {
    const painted = software.render(frame);
    if (!full && pixels === painted.pixels && frame.damage && frame.damage.length === 0) return;
    pixels = painted.pixels;
    revision++;
  };

  const event = (hit: HitRegion, x: number, y: number): HitPointerEvent => ({
    x,
    y,
    localX: x - hit.x,
    localY: y - hit.y,
    button: "left",
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
  });

  const hitAt = (x: number, y: number) => {
    for (let index = hits.length - 1; index >= 0; index--) {
      const hit = hits[index]!;
      if ((hit.onPress || hit.onPointerDown) && hitRegionContains(hit, x, y)) return hit;
    }
    return null;
  };

  return {
    raster(view, width, height) {
      if (width <= 0 || height <= 0) return null;
      if (menuOpen && Date.now() - menuOpenedAt > MENU_TIMEOUT_MS) {
        menuOpen = false;
        inputs = "";
      }
      const key = JSON.stringify([
        view,
        width,
        height,
        getUiScaleFactor(),
        deps.clock(),
        deps.date(),
        deps.battery(),
        menuOpen,
        deps.themeEpoch?.() ?? 0,
      ]);
      lastView = view;
      const full = width !== size.width || height !== size.height;
      if (!mounted || key !== inputs || full) {
        mounted = true;
        inputs = key;
        size = { width, height };
        render(view, width, height);
      }
      const viewport = { width, height };
      const frame = committed
        ? scene.render(root.container, viewport)
        : (scene.renderPresentation(root.container, viewport) ??
          scene.render(root.container, viewport));
      committed = false;
      present(frame, full);
      // Live transforms (the entrance, a shake) move hit targets too.
      hits = collectHits(root.container);
      if (!pixels) return null;
      return { id: "shell:lock", pixels, width, height, stride: width * 4, revision, x: 0, y: 0 };
    },

    pointer(ev) {
      action = null;
      const hit = hitAt(ev.x, ev.y);
      if (ev.button === undefined) {
        if (hit !== hovered) {
          hovered?.onPointerLeave?.(event(hovered, ev.x, ev.y));
          hit?.onPointerEnter?.(event(hit, ev.x, ev.y));
          hovered = hit;
          inputs = "";
        }
        return null;
      }
      if (ev.button !== BTN_LEFT) return null;
      if (ev.value === 1) {
        pressed = hit;
        hit?.onPointerDown?.(event(hit, ev.x, ev.y));
        // A press anywhere else closes the menu.
        if (!hit && menuOpen) menuOpen = false;
        inputs = "";
        return null;
      }
      if (ev.value === 0 && pressed) {
        const target = pressed;
        pressed = null;
        target.onPointerUp?.(event(target, ev.x, ev.y));
        if (hitRegionContains(target, ev.x, ev.y)) target.onPress?.(event(target, ev.x, ev.y));
        inputs = "";
      }
      const chosen = action;
      action = null;
      return chosen;
    },

    needsRepaint(motionsMoving) {
      if (!lastView) return false;
      const wanted = committed || motionsMoving || moving;
      moving = motionsMoving;
      return wanted;
    },

    control(focusId) {
      const hit = hits.find((candidate) => candidate.focusId === focusId);
      return hit ? { x: hit.x, y: hit.y, width: hit.width, height: hit.height } : null;
    },

    setLocked(locked) {
      menuOpen = false;
      hovered = null;
      pressed = null;
      action = null;
      if (locked) return;
      // Unmount: the next lock starts fresh, with its entrance.
      renderShell(root, null);
      root = createShellRoot({ onCommit: () => (committed = true) });
      scene = new RetainedSceneRenderer({ precise: true });
      software.invalidate();
      mounted = false;
      inputs = "";
      pixels = null;
      lastView = null;
      hits = [];
    },
  };
}
