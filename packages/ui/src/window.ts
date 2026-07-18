import type { ReactNode } from "react";
import {
  collectHits,
  createShellRoot,
  rasterize,
  renderShell,
  type HitRegion,
  type HitPointerEvent,
  type ShellRoot,
} from "@moire/react-host";
import type {
  PlatformBackend,
  PlatformWindow,
  UiKeyEvent,
  UiPointerEvent,
} from "./platform.js";
import { tickAllMotions } from "./motion.js";

export type WindowSize = { width: number; height: number };

/**
 * Most recently mounted window, used by `hitTestDropData` to resolve DnD
 * drop positions against the live scene tree. Apps in this toolkit are
 * single-window, so a module-level "active window" is sufficient.
 */
let activeWindowForHitTest: Window | null = null;

/**
 * Look up the `data` payload (see `Draggable`'s `dropData` prop) of the
 * topmost hit region at window-local (x, y), or null. Used to resolve a
 * more specific DnD drop target than "somewhere in this window" — e.g.
 * whether a drop landed on a particular folder row/cell.
 */
export function hitTestDropData(x: number, y: number): unknown {
  return activeWindowForHitTest?.hitTestData(x, y) ?? null;
}

/** Geometric drop-hover update on the active window — see `Window.updateDropHover`. */
export function updateActiveWindowDropHover(x: number, y: number): void {
  activeWindowForHitTest?.updateDropHover(x, y);
}

/** Clear any drop-hover highlight on the active window. */
export function clearActiveWindowDropHover(): void {
  activeWindowForHitTest?.clearDropHover();
}

/**
 * Mark the active window dirty so it repaints on the next tick. Needed by
 * code that mutates React state outside `Window`'s own pointer handling
 * (e.g. the DnD drop-zone hover system and drag-end reset, both driven by
 * the Wayland event loop) — a `useState` setter alone doesn't tell
 * `Window.tick()` a redraw is due.
 */
export function requestActiveWindowRedraw(): void {
  activeWindowForHitTest?.requestRedraw();
}

export type WindowContent = ReactNode | ((size: WindowSize) => ReactNode);

export type WindowOpts = {
  title: string;
  appId?: string;
  width?: number;
  height?: number;
  /**
   * When false, the Wayland backend requests a fixed size (min==max) so the
   * compositor does not expand the window to its default slot (800×600).
   * Default true.
   */
  resizable?: boolean;
};

/**
 * Toolkit window — rasterizes React → ARGB and presents via PlatformBackend.
 */
export class Window {
  readonly title: string;
  readonly appId: string;
  readonly resizable: boolean;
  private width: number;
  private height: number;
  private content: WindowContent = null;
  private root: ShellRoot = createShellRoot();
  private platformWin: PlatformWindow | null = null;
  private hits: HitRegion[] = [];
  private dirty = true;
  private closed = false;
  private onCloseCb: (() => void) | null = null;

  // Pointer state
  private hoverHit: HitRegion | null = null;
  private downPos: { x: number; y: number } | null = null;
  /**
   * The hit region that received the last `down`, held until `up`. Move/up
   * events route here instead of being re-hit-tested at the live cursor
   * position — implicit pointer capture, needed for drag gestures (which by
   * definition move the cursor away from the pressed element's bounds).
   */
  private capturedHit: HitRegion | null = null;
  /**
   * The specific `data`-tagged region currently hovered by an external DnD
   * drag (see `updateDropHover`). Geometric, not id-based — two regions
   * carrying the same `data` (e.g. a breadcrumb and a sidebar row for the
   * same path) never cross-highlight each other.
   */
  private hoveredDropRegion: HitRegion | null = null;

  // Motion timing
  private lastTickMs: number = Date.now();

  constructor(opts: WindowOpts) {
    this.title = opts.title;
    this.appId = opts.appId ?? "moire.app";
    this.width = opts.width ?? 480;
    this.height = opts.height ?? 360;
    this.resizable = opts.resizable !== false;
  }

  setContent(node: WindowContent): void {
    this.content = node;
    this.dirty = true;
  }

  onClose(cb: () => void): void {
    this.onCloseCb = cb;
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  isClosed(): boolean {
    return this.closed;
  }

  /** Attach to a connected PlatformBackend. */
  mount(backend: PlatformBackend): void {
    const pw = backend.createWindow({
      title: this.title,
      appId: this.appId,
      width: this.width,
      height: this.height,
      resizable: this.resizable,
    });
    this.platformWin = pw;
    pw.onConfigure((w, h) => {
      const nextW = w > 0 ? w : this.width;
      const nextH = h > 0 ? h : this.height;
      if (nextW !== this.width || nextH !== this.height) {
        this.width = nextW;
        this.height = nextH;
        this.dirty = true;
      } else {
        // Still need a first paint after configure ack.
        this.dirty = true;
      }
    });
    pw.onClose(() => {
      this.closed = true;
      this.onCloseCb?.();
    });
    pw.onPointer((ev) => this.handlePointer(ev));
    pw.onKey((ev) => this.handleKey(ev));
    activeWindowForHitTest = this;
  }

  /** Topmost hit region's `data` at window-local (x, y), or null. */
  hitTestData(x: number, y: number): unknown {
    return this.findDropRegion(x, y)?.data ?? null;
  }

  private findDropRegion(x: number, y: number): HitRegion | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      if (
        x >= h.x &&
        x < h.x + h.width &&
        y >= h.y &&
        y < h.y + h.height &&
        h.data !== undefined
      ) {
        return h;
      }
    }
    return null;
  }

  /**
   * Geometric drop-hover update: fires `onDropHoverChange` on exactly the
   * region under (x, y) — not "any region whose `data` happens to match",
   * which would cross-highlight unrelated regions sharing the same value
   * (e.g. a breadcrumb and a sidebar row both tagged with the same path).
   */
  updateDropHover(x: number, y: number): void {
    const next = this.findDropRegion(x, y);
    if (next === this.hoveredDropRegion) return;
    this.hoveredDropRegion?.onDropHoverChange?.(false);
    next?.onDropHoverChange?.(true);
    this.hoveredDropRegion = next;
    // onDropHoverChange is a plain useState setter; nothing else tells
    // tick() a redraw is due since this fires from the Wayland event loop.
    this.requestRedraw();
  }

  /** Called on drag leave / drop / cancel. */
  clearDropHover(): void {
    if (!this.hoveredDropRegion) return;
    this.hoveredDropRegion.onDropHoverChange?.(false);
    this.hoveredDropRegion = null;
    this.requestRedraw();
  }

  /** Rebuild + present if dirty. */
  tick(): void {
    if (this.closed || !this.platformWin) return;

    // Advance motions; mark dirty if anything is still moving.
    const now = Date.now();
    const dt = Math.min((now - this.lastTickMs) / 1000, 0.1);
    this.lastTickMs = now;
    if (tickAllMotions(dt)) this.dirty = true;

    if (!this.dirty) return;
    this.dirty = false;
    const tree =
      typeof this.content === "function"
        ? this.content({ width: this.width, height: this.height })
        : this.content;
    renderShell(this.root, tree);
    const { pixels, hits } = rasterize(
      this.root.container,
      this.width,
      this.height,
    );
    this.hits = hits;
    this.platformWin.present(pixels, this.width, this.height);
  }

  requestRedraw(): void {
    this.dirty = true;
  }

  destroy(): void {
    this.closed = true;
    this.platformWin?.destroy();
    this.platformWin = null;
    if (activeWindowForHitTest === this) activeWindowForHitTest = null;
  }

  /**
   * Re-render the tree now (processing any pending React state updates),
   * refresh hit regions, and mark as dirty for the next present call.
   */
  private flushAndDirty(): void {
    const tree =
      typeof this.content === "function"
        ? this.content({ width: this.width, height: this.height })
        : this.content;
    renderShell(this.root, tree);
    this.hits = collectHits(this.root.container);
    this.dirty = true;
  }

  private findTopHit(
    x: number,
    y: number,
    pred: (h: HitRegion) => boolean,
  ): HitRegion | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      if (x >= h.x && x < h.x + h.width && y >= h.y && y < h.y + h.height && pred(h)) {
        return h;
      }
    }
    return null;
  }

  private makeEvArgs(h: HitRegion, ev: UiPointerEvent): HitPointerEvent {
    return {
      x: ev.x,
      y: ev.y,
      localX: ev.x - h.x,
      localY: ev.y - h.y,
      button: ev.button,
      deltaY: ev.deltaY,
    };
  }

  private handlePointer(ev: UiPointerEvent): void {
    if (this.closed) return;

    if (ev.type === "move") {
      if (this.capturedHit) {
        // Captured by an earlier `down` — keep delivering to that element
        // even though the cursor has left its bounds (drag gesture), rather
        // than re-hit-testing at the live position.
        if (this.capturedHit.onPointerMove) {
          this.capturedHit.onPointerMove(this.makeEvArgs(this.capturedHit, ev));
        }
        this.dirty = true;
        return;
      }
      const newHover = this.findTopHit(
        ev.x,
        ev.y,
        (h) => !!(h.onPointerEnter || h.onPointerLeave || h.onPointerMove),
      );
      let changed = false;
      if (newHover !== this.hoverHit) {
        if (this.hoverHit?.onPointerLeave) {
          this.hoverHit.onPointerLeave(this.makeEvArgs(this.hoverHit, ev));
          changed = true;
        }
        this.hoverHit = newHover;
        if (newHover?.onPointerEnter) {
          newHover.onPointerEnter(this.makeEvArgs(newHover, ev));
          changed = true;
        }
      }
      if (newHover?.onPointerMove) {
        newHover.onPointerMove(this.makeEvArgs(newHover, ev));
        changed = true;
      }
      if (changed) {
        this.flushAndDirty();
      } else {
        this.dirty = true;
      }
      return;
    }

    if (ev.type === "down" && ev.button === "left") {
      const hit = this.findTopHit(
        ev.x,
        ev.y,
        (h) => !!(h.onPointerDown || h.onPress),
      );
      this.downPos = { x: ev.x, y: ev.y };
      // Capture for the duration of this press so move/up keep reaching this
      // element regardless of where the cursor travels — required for drag
      // gestures. Reset stale hover so the first post-release move re-derives it.
      this.capturedHit = hit;
      this.hoverHit = null;
      if (hit?.onPointerDown) {
        hit.onPointerDown(this.makeEvArgs(hit, ev));
        this.flushAndDirty();
      } else {
        this.dirty = true;
      }
      return;
    }

    if (ev.type === "down" && ev.button === "right") {
      const hit = this.findTopHit(ev.x, ev.y, (h) => !!h.onContextMenu);
      if (hit?.onContextMenu) {
        hit.onContextMenu(this.makeEvArgs(hit, ev));
        this.flushAndDirty();
      }
      return;
    }

    if (ev.type === "up" && ev.button === "left") {
      const hit =
        this.capturedHit ??
        this.findTopHit(ev.x, ev.y, (h) => !!(h.onPointerUp || h.onPress));
      if (hit?.onPointerUp) {
        hit.onPointerUp(this.makeEvArgs(hit, ev));
      }
      // Fire onPress on up if little movement from down position.
      if (this.downPos) {
        const dx = ev.x - this.downPos.x;
        const dy = ev.y - this.downPos.y;
        if (dx * dx + dy * dy < 100) {
          const pressHit =
            this.capturedHit ?? this.findTopHit(ev.x, ev.y, (h) => !!h.onPress);
          if (pressHit?.onPress) {
            pressHit.onPress(this.makeEvArgs(pressHit, ev));
          }
        }
      }
      this.downPos = null;
      this.capturedHit = null;
      this.flushAndDirty();
      return;
    }

    if (ev.type === "wheel") {
      const hit = this.findTopHit(ev.x, ev.y, (h) => !!h.onWheel);
      if (hit?.onWheel) {
        hit.onWheel({
          x: ev.x,
          y: ev.y,
          localX: ev.x - hit.x,
          localY: ev.y - hit.y,
          deltaY: ev.deltaY,
        });
        this.flushAndDirty();
      }
      return;
    }
  }

  private handleKey(_ev: UiKeyEvent): void {
    // Apps can subscribe later; TextField input is app-managed for now.
  }
}
