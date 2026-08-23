import type { ReactNode } from "react";
import {
  collectHits,
  createShellRoot,
  hitRegionContains,
  renderShell,
  SoftwareRenderer,
  type HitRegion,
  type HitKeyEvent,
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

export type PopupOptions = {
  x: number;
  y: number;
  width: number;
  height: number;
  content: WindowContent;
  onClose?: () => void;
};

export type PopupHandle = {
  destroy(): void;
  requestRedraw(): void;
};

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
  /** When false, the client owns its chrome and no SSD titlebar is requested. */
  decorated?: boolean;
};

/**
 * Toolkit window — rasterizes React → ARGB and presents via PlatformBackend.
 */
export class Window {
  title: string;
  readonly appId: string;
  readonly resizable: boolean;
  readonly decorated: boolean;
  private width: number;
  private height: number;
  private content: WindowContent = null;
  private root: ShellRoot = createShellRoot();
  private platformWin: PlatformWindow | null = null;
  private backend: PlatformBackend | null = null;
  private readonly popups = new Set<Window>();
  private hits: HitRegion[] = [];
  private dirty = true;
  private closed = false;
  private readonly onCloseCallbacks = new Set<() => void>();
  /** Current Wayland/headless presentation path consumes software frames. */
  private readonly renderer = new SoftwareRenderer();
  private focusedId: string | null = null;
  private focusedHit: HitRegion | null = null;
  private readonly consumedAutoFocusIds = new Set<string>();

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
    this.decorated = opts.decorated !== false;
  }

  setContent(node: WindowContent): void {
    this.content = node;
    this.dirty = true;
  }

  setTitle(title: string): void {
    if (title === this.title) return;
    this.title = title;
    this.platformWin?.setTitle(title);
  }

  onClose(cb: () => void): void {
    this.onCloseCallbacks.add(cb);
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
    this.backend = backend;
    const pw = backend.createWindow({
      title: this.title,
      appId: this.appId,
      width: this.width,
      height: this.height,
      resizable: this.resizable,
      decorated: this.decorated,
    });
    this.attachPlatformWindow(pw, true);
  }

  /** Start a compositor-owned move from a client-rendered drag region. */
  beginMove(): void {
    this.platformWin?.beginMove();
  }

  private attachPlatformWindow(
    pw: PlatformWindow,
    makeActive: boolean,
  ): void {
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
      for (const callback of this.onCloseCallbacks) callback();
    });
    pw.onPointer((ev) => this.handlePointer(ev));
    pw.onKey((ev) => this.handleKey(ev));
    if (makeActive) activeWindowForHitTest = this;
  }

  /** Open a native child popup when supported by the current platform. */
  showPopup(opts: PopupOptions): PopupHandle | null {
    const backend = this.backend;
    const parent = this.platformWin;
    if (!backend?.createPopup || !parent || this.closed) return null;

    const popup = new Window({
      title: "Popup",
      appId: `${this.appId}.popup`,
      width: opts.width,
      height: opts.height,
      resizable: false,
    });
    popup.backend = backend;
    popup.setContent(opts.content);
    const platformPopup = backend.createPopup({
      parent,
      width: opts.width,
      height: opts.height,
      anchorX: opts.x,
      anchorY: opts.y,
      grab: true,
    });
    popup.attachPlatformWindow(platformPopup, false);
    this.popups.add(popup);

    let destroyed = false;
    const destroy = (notify: boolean) => {
      if (destroyed) return;
      destroyed = true;
      this.popups.delete(popup);
      popup.destroy();
      if (notify) opts.onClose?.();
      this.requestRedraw();
    };
    popup.onClose(() => destroy(true));

    return {
      destroy: () => destroy(false),
      requestRedraw: () => popup.requestRedraw(),
    };
  }

  /** Topmost hit region's `data` at window-local (x, y), or null. */
  hitTestData(x: number, y: number): unknown {
    return this.findDropRegion(x, y)?.data ?? null;
  }

  private findDropRegion(x: number, y: number): HitRegion | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      if (hitRegionContains(h, x, y) && h.data !== undefined) {
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
    this.tickFrame(true);
    for (const popup of this.popups) popup.tickFrame(false);
  }

  private tickFrame(advanceMotions: boolean): void {
    if (this.closed || !this.platformWin) return;
    const platformWin = this.platformWin;

    // Advance motions; mark dirty if anything is still moving.
    const now = Date.now();
    const dt = Math.min((now - this.lastTickMs) / 1000, 0.1);
    this.lastTickMs = now;
    if (advanceMotions && tickAllMotions(dt)) {
      this.dirty = true;
      for (const popup of this.popups) popup.dirty = true;
    }

    if (!this.dirty) return;
    this.dirty = false;
    const tree =
      typeof this.content === "function"
        ? this.content({ width: this.width, height: this.height })
        : this.content;
    renderShell(this.root, tree);
    // Rendering may synchronously finish a closing popup and destroy this
    // platform window. Do not present through a handle invalidated mid-frame.
    if (this.closed || this.platformWin !== platformWin) return;
    const frame = this.renderer.render(this.root.container, {
      width: this.width,
      height: this.height,
    });
    this.refreshHits();
    platformWin.present(frame.pixels, frame.width, frame.height);
  }

  requestRedraw(): void {
    this.dirty = true;
  }

  destroy(): void {
    for (const popup of [...this.popups]) popup.destroy();
    this.popups.clear();
    this.closed = true;
    this.focusedHit?.onFocusChange?.(false);
    this.focusedHit = null;
    this.focusedId = null;
    renderShell(this.root, null);
    this.platformWin?.destroy();
    this.platformWin = null;
    this.backend = null;
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
    this.refreshHits();
    this.dirty = true;
  }

  private refreshHits(): void {
    this.hits = collectHits(this.root.container);
    const activeScopeId = this.activeTrappedScopeId();
    const presentAutoFocusIds = new Set(
      this.hits
        .filter((hit) => hit.autoFocus && hit.focusId)
        .map((hit) => hit.focusId!),
    );
    for (const id of this.consumedAutoFocusIds) {
      if (!presentAutoFocusIds.has(id)) this.consumedAutoFocusIds.delete(id);
    }
    const autoFocusCandidate = this.hits.find(
      (hit) =>
        hit.focusable &&
        hit.autoFocus &&
        (!activeScopeId || hit.focusScopeId === activeScopeId) &&
        !!hit.focusId &&
        !this.consumedAutoFocusIds.has(hit.focusId),
    );
    if (autoFocusCandidate?.focusId) {
      this.consumedAutoFocusIds.add(autoFocusCandidate.focusId);
      this.changeFocus(autoFocusCandidate);
      this.dirty = true;
      return;
    }
    if (activeScopeId && this.focusedHit?.focusScopeId !== activeScopeId) {
      const firstInScope = this.hits.find(
        (hit) => hit.focusable && hit.focusScopeId === activeScopeId,
      );
      if (firstInScope) {
        this.changeFocus(firstInScope);
        this.dirty = true;
        return;
      }
    }
    if (!this.focusedId) {
      this.focusedHit = null;
      return;
    }
    this.focusedHit =
      this.hits.find(
        (hit) => hit.focusable && hit.focusId === this.focusedId,
      ) ?? null;
    if (!this.focusedHit) this.focusedId = null;
  }

  private activeTrappedScopeId(): string | null {
    for (let index = this.hits.length - 1; index >= 0; index--) {
      const hit = this.hits[index]!;
      if (hit.focusScopeId && hit.focusScopeTrap && hit.focusScopeActive !== false) {
        return hit.focusScopeId;
      }
    }
    return null;
  }

  private changeFocus(next: HitRegion | null): boolean {
    const focusable = next?.focusable ? next : null;
    const nextId = focusable?.focusId ?? null;
    if (nextId === this.focusedId) {
      this.focusedHit = focusable;
      return false;
    }
    this.focusedHit?.onFocusChange?.(false);
    this.focusedId = nextId;
    this.focusedHit = focusable;
    focusable?.onFocusChange?.(true);
    return true;
  }

  private moveFocus(reverse: boolean): void {
    const activeScopeId = this.activeTrappedScopeId();
    const focusable = this.hits.filter(
      (hit) => hit.focusable && (!activeScopeId || hit.focusScopeId === activeScopeId),
    );
    if (focusable.length === 0) {
      if (this.changeFocus(null)) this.flushAndDirty();
      return;
    }
    const current = focusable.findIndex(
      (hit) => hit.focusId === this.focusedId,
    );
    const nextIndex = reverse
      ? current <= 0
        ? focusable.length - 1
        : current - 1
      : current < 0 || current === focusable.length - 1
        ? 0
        : current + 1;
    if (this.changeFocus(focusable[nextIndex] ?? null)) this.flushAndDirty();
  }

  private findTopHit(
    x: number,
    y: number,
    pred: (h: HitRegion) => boolean,
  ): HitRegion | null {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i]!;
      if (hitRegionContains(h, x, y) && pred(h)) {
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
      shiftKey: ev.modifiers?.shift ?? false,
      ctrlKey: ev.modifiers?.ctrl ?? false,
      altKey: ev.modifiers?.alt ?? false,
      metaKey: ev.modifiers?.meta ?? false,
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
      const focusHit = this.findTopHit(ev.x, ev.y, (candidate) => !!candidate.focusable);
      const focusChanged = this.changeFocus(focusHit);
      // Capture for the duration of this press so move/up keep reaching this
      // element regardless of where the cursor travels — required for drag
      // gestures. Reset stale hover so the first post-release move re-derives it.
      this.capturedHit = hit;
      this.hoverHit = null;
      if (hit?.onPointerDown) {
        hit.onPointerDown(this.makeEvArgs(hit, ev));
        this.flushAndDirty();
      } else if (focusChanged) {
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
        hit.onWheel(this.makeEvArgs(hit, ev));
        this.flushAndDirty();
      }
      return;
    }
  }

  private handleKey(ev: UiKeyEvent): void {
    if (this.closed) return;
    const event: HitKeyEvent = {
      code: ev.code,
      key: ev.key,
      text: ev.text,
      repeat: ev.type === "repeat",
      shiftKey: ev.modifiers.shift,
      ctrlKey: ev.modifiers.ctrl,
      altKey: ev.modifiers.alt,
      metaKey: ev.modifiers.meta,
      targetBounds: this.focusedHit ? {
        x: this.focusedHit.x,
        y: this.focusedHit.y,
        width: this.focusedHit.width,
        height: this.focusedHit.height,
      } : undefined,
    };
    if (ev.type === "down" || ev.type === "repeat") {
      const activeScopeId = this.activeTrappedScopeId();
      for (let index = this.hits.length - 1; index >= 0; index--) {
        const hit = this.hits[index]!;
        if (
          !hit.onGlobalKeyDown ||
          hit.focusScopeActive === false ||
          (activeScopeId && hit.focusScopeId !== activeScopeId)
        ) {
          continue;
        }
        if (hit.onGlobalKeyDown(event) === true) {
          this.flushAndDirty();
          return;
        }
      }
    }
    if (
      (ev.type === "down" || ev.type === "repeat") &&
      ev.code === 15 &&
      !this.focusedHit?.captureTab
    ) {
      this.moveFocus(ev.modifiers.shift);
      return;
    }
    const focused = this.focusedHit;
    if (!focused) return;
    const contextMenuKey =
      ev.type === "down" &&
      (ev.code === 139 || (ev.code === 68 && ev.modifiers.shift));
    if (contextMenuKey && focused.onContextMenu) {
      const localX = Math.max(0, focused.width - 8);
      const localY = focused.height / 2;
      focused.onContextMenu({
        x: focused.x + localX,
        y: focused.y + localY,
        localX,
        localY,
        button: "right",
      });
      this.flushAndDirty();
      return;
    }
    if (ev.type === "up") focused.onKeyUp?.(event);
    else focused.onKeyDown?.(event);
    this.flushAndDirty();
  }
}
