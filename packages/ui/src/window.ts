import type { ReactNode } from "react";
import {
  collectHits,
  createShellRoot,
  rasterize,
  renderShell,
  type HitRegion,
  type ShellRoot,
} from "@moire/react-host";
import type {
  PlatformBackend,
  PlatformWindow,
  UiKeyEvent,
  UiPointerEvent,
} from "./platform.js";

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

  private handlePointer(ev: UiPointerEvent): void {
    if (ev.type === "down" && ev.button === "left") {
      for (let i = this.hits.length - 1; i >= 0; i--) {
        const h = this.hits[i]!;
        if (
          ev.x >= h.x &&
          ev.x < h.x + h.width &&
          ev.y >= h.y &&
          ev.y < h.y + h.height
        ) {
          h.onPress({
            x: ev.x,
            y: ev.y,
            localX: ev.x - h.x,
            localY: ev.y - h.y,
          });
          // Flush React state updates from the handler, then present next tick.
          const tree =
            typeof this.content === "function"
              ? this.content({ width: this.width, height: this.height })
              : this.content;
          renderShell(this.root, tree);
          this.hits = collectHits(this.root.container);
          this.dirty = true;
          break;
        }
      }
    }
  }

  private handleKey(_ev: UiKeyEvent): void {
    // Apps can subscribe later; TextField input is app-managed for now.
  }
}
