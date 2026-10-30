/**
 * The shell's secure prompt surface: its own React root, rendered for the compositor's protected
 * frame, plus pointer dispatch for its buttons, the identity chooser and the details. Mounted
 * only while a prompt (or the verification key's notice) is up, so nothing of the desktop chrome
 * is part of it.
 *
 * Keys never come here: the compositor turns them into the answer itself and sends back only a
 * view. A throw from here makes the compositor draw its own prompt; it never answers a request.
 */
import React, { type ReactElement } from "react";
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
import { SecureNotice, SecurePrompt } from "./SecurePrompt";
import type { SecurePromptAction, SecurePromptView } from "./types";

export type SecurePromptRaster = {
  id: string;
  pixels: Uint8Array;
  width: number;
  height: number;
  stride: number;
  revision: number;
  x: number;
  y: number;
};

export type SecurePromptSurfaceDeps = {
  /** Theme or scale changed since the last call (re-render everything). */
  themeEpoch?(): number;
};

export type SecurePromptSurface = {
  raster(view: SecurePromptView, width: number, height: number): SecurePromptRaster | null;
  /** "No system password request is open". */
  notice(width: number, height: number): SecurePromptRaster | null;
  pointer(ev: { x: number; y: number; button?: number; value?: number }): SecurePromptAction | null;
  /** True while the prompt has motion or a pending re-render. */
  needsRepaint(motionsMoving: boolean): boolean;
  setOpen(open: boolean): void;
  /** Where a control is (by focusId) in the last raster, for smokes. */
  control(focusId: string): { x: number; y: number; width: number; height: number } | null;
};

const BTN_LEFT = 0x110;

export function createSecurePromptSurface(deps: SecurePromptSurfaceDeps = {}): SecurePromptSurface {
  let root = createShellRoot({ onCommit: () => (committed = true) });
  let committed = true;
  let scene = new RetainedSceneRenderer({ precise: true });
  const software = new RetainedSoftwareRenderer();
  /** What the root shows: one prompt (by id), the notice, or nothing. */
  let subject = "";
  let inputs = "";
  let pixels: Uint8Array | null = null;
  let revision = 0;
  let size = { width: 0, height: 0 };
  let hits: HitRegion[] = [];
  let chooserOpen = false;
  let detailsOpen = false;
  let hovered: HitRegion | null = null;
  let pressed: HitRegion | null = null;
  let action: SecurePromptAction | null = null;
  let moving = false;

  const reset = () => {
    renderShell(root, null);
    root = createShellRoot({ onCommit: () => (committed = true) });
    scene = new RetainedSceneRenderer({ precise: true });
    software.invalidate();
    committed = true;
    inputs = "";
    pixels = null;
    hits = [];
    chooserOpen = false;
    detailsOpen = false;
    hovered = null;
    pressed = null;
    action = null;
  };

  const present = (frame: RetainedSceneFrame, full: boolean) => {
    const painted = software.render(frame);
    if (!full && pixels === painted.pixels && frame.damage && frame.damage.length === 0) return;
    pixels = painted.pixels;
    revision++;
  };

  /**
   * Another prompt (or the notice) starts from a fresh root, with its own entrance and with the
   * chooser and the details closed.
   */
  const begin = (next: string) => {
    if (next !== subject && subject) reset();
    subject = next;
  };

  /** Render `element` when `key` or the size changed, then rasterise the root. */
  const draw = (
    key: string,
    width: number,
    height: number,
    element: () => ReactElement,
  ): SecurePromptRaster | null => {
    if (width <= 0 || height <= 0) return null;
    const full = width !== size.width || height !== size.height;
    if (key !== inputs || full) {
      inputs = key;
      size = { width, height };
      renderShell(root, element());
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
    return {
      id: "shell:secure-prompt",
      pixels,
      width,
      height,
      stride: width * 4,
      revision,
      x: 0,
      y: 0,
    };
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
      begin(`prompt:${view.id}`);
      const key = JSON.stringify([
        view,
        width,
        height,
        getUiScaleFactor(),
        chooserOpen,
        detailsOpen,
        deps.themeEpoch?.() ?? 0,
      ]);
      return draw(key, width, height, () => (
        <SecurePrompt
          width={width}
          height={height}
          view={view}
          chooserOpen={chooserOpen}
          detailsOpen={detailsOpen}
          onChooser={(open) => {
            chooserOpen = open;
            inputs = "";
          }}
          onDetails={(open) => {
            detailsOpen = open;
            inputs = "";
          }}
          onAction={(chosen) => {
            action = chosen;
            inputs = "";
          }}
        />
      ));
    },

    notice(width, height) {
      begin("notice");
      const key = JSON.stringify([width, height, getUiScaleFactor(), deps.themeEpoch?.() ?? 0]);
      return draw(key, width, height, () => <SecureNotice width={width} height={height} />);
    },

    pointer(ev) {
      action = null;
      if (!subject.startsWith("prompt:")) return null;
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
      if (!subject) return false;
      const wanted = committed || motionsMoving || moving || inputs === "";
      moving = motionsMoving;
      return wanted;
    },

    control(focusId) {
      const hit = hits.find((candidate) => candidate.focusId === focusId);
      return hit ? { x: hit.x, y: hit.y, width: hit.width, height: hit.height } : null;
    },

    setOpen() {
      // Unmount, opening or closing: the next prompt starts fresh.
      if (subject) reset();
      subject = "";
      moving = false;
    },
  };
}
