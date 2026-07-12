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
      deltaY: ev.deltaY,
    };
  }

  private handlePointer(ev: UiPointerEvent): void {
    if (this.closed) return;

    if (ev.type === "move") {
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
      if (hit?.onPointerDown) {
        hit.onPointerDown(this.makeEvArgs(hit, ev));
        this.flushAndDirty();
      } else {
        this.dirty = true;
      }
      return;
    }

    if (ev.type === "up" && ev.button === "left") {
      const hit = this.findTopHit(
        ev.x,
        ev.y,
        (h) => !!(h.onPointerUp || h.onPress),
      );
      if (hit?.onPointerUp) {
        hit.onPointerUp(this.makeEvArgs(hit, ev));
      }
      // Fire onPress on up if little movement from down position.
      if (this.downPos) {
        const dx = ev.x - this.downPos.x;
        const dy = ev.y - this.downPos.y;
        if (dx * dx + dy * dy < 100) {
          const pressHit = this.findTopHit(ev.x, ev.y, (h) => !!h.onPress);
          if (pressHit) {
            pressHit.onPress!(this.makeEvArgs(pressHit, ev));
          }
        }
      }
      this.downPos = null;
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
