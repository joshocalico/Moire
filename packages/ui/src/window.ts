import type { ReactNode } from "react";
import {
  collectHits,
  createShellRoot,
  hitRegionContains,
  renderShell,
  RetainedSceneRenderer,
  RetainedSoftwareRenderer,
  SoftwareRenderer,
  type HitRegion,
  type HitKeyEvent,
  type HitPointerEvent,
  type ShellRoot,
} from "@moire/react-host";
import type {
  PlatformBackend,
  PlatformDiagnostics,
  PlatformWindow,
  UiKeyEvent,
  UiFrameEvent,
  UiPresentationMode,
  UiPointerEvent,
} from "./platform.js";
import { getMotionActivity, tickMotionFrame } from "./motion.js";

export type WindowSize = { width: number; height: number };

export type WindowPerformanceSnapshot = {
  width: number;
  height: number;
  frames: number;
  retainedFrames: number;
  softwareFrames: number;
  /** Component-tree commits; presentation-only frames deliberately skip this. */
  reconciledFrames: number;
  framesPerSecond: number;
  submittedFramesPerSecond: number;
  compositorFrames: number;
  compositorFramesPerSecond: number;
  presentedFrames: number;
  presentedFramesPerSecond: number;
  discardedFrames: number;
  dmabufFrames: number;
  shmFrames: number;
  lastTransport: "dmabuf" | "shm" | "headless" | null;
  displayRefreshHz: number;
  lastFrameMs: number;
  averageFrameMs: number;
  lastSceneMs: number;
  averageSceneMs: number;
  lastRasterMs: number;
  averageRasterMs: number;
  lastSubmitMs: number;
  averageSubmitMs: number;
  lastCopyMs: number;
  averageCopyMs: number;
  lastBufferReleaseMs: number;
  averageBufferReleaseMs: number;
  lastDamagePercent: number;
  averageDamagePercent: number;
  presentationFrameMsP50: number;
  presentationFrameMsP95: number;
  averagePresentationLatencyMs: number;
  presentationLatencyMsP95: number;
  lastLayerCount: number;
};

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

type TimedSample = { sourceMs: number; receivedAtMs: number };

function average(samples: readonly number[]): number {
  return samples.length > 0
    ? samples.reduce((total, sample) => total + sample, 0) / samples.length
    : 0;
}

function measuredRate(samples: TimedSample[], now: number): number {
  while (samples[0] && samples[0].receivedAtMs < now - 1_500) samples.shift();
  if (samples.length < 2) return 0;
  const elapsed = samples.at(-1)!.sourceMs - samples[0]!.sourceMs;
  return elapsed > 0 ? ((samples.length - 1) * 1_000) / elapsed : 0;
}

function retainSample(samples: number[], value: number, limit = 120): void {
  samples.push(value);
  if (samples.length > limit) samples.splice(0, samples.length - limit);
}

function percentile(samples: readonly number[], ratio: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))]!;
}

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
  private root: ShellRoot = createShellRoot({
    onCommit: () => {
      // Timer/promise-driven React state (Spinner, async loading, progress)
      // commits outside tickFrame(). Schedule a present without requiring an
      // unrelated pointer/key event to wake the visual state up.
      if (!this.renderingRoot) this.invalidate();
    },
  });
  private platformWin: PlatformWindow | null = null;
  private backend: PlatformBackend | null = null;
  private readonly popups = new Set<Window>();
  private hits: HitRegion[] = [];
  private dirty = true;
  /** React/component tree changed; false means the committed scene is reusable. */
  private reconcileDirty = true;
  /** Suppress invalidation caused by the explicit renderShell call in tick. */
  private renderingRoot = false;
  private closed = false;
  private readonly onCloseCallbacks = new Set<() => void>();
  private readonly invalidationCallbacks = new Set<() => void>();
  private readonly compositorFrameCallbacks = new Set<
    (timestampMs: number) => void
  >();
  private animationsActive = false;
  /** Current Wayland/headless presentation path consumes software frames. */
  private readonly renderer = new SoftwareRenderer();
  /** Primitive-layer renderer offered to accelerated platform windows first. */
  private readonly retainedRenderer = new RetainedSceneRenderer();
  /** Cached-layer compositor used when the platform declines acceleration. */
  private readonly retainedSoftwareRenderer = new RetainedSoftwareRenderer();
  private frameCount = 0;
  private retainedFrameCount = 0;
  private softwareFrameCount = 0;
  private reconciledFrameCount = 0;
  private lastFrameMs = 0;
  private lastLayerCount = 0;
  private compositorFrameCount = 0;
  private presentedFrameCount = 0;
  private discardedFrameCount = 0;
  private dmabufFrameCount = 0;
  private shmFrameCount = 0;
  private lastTransport: "dmabuf" | "shm" | "headless" | null = null;
  private displayRefreshHz = 0;
  private lastSceneMs = 0;
  private lastRasterMs = 0;
  private lastSubmitMs = 0;
  private lastCopyMs = 0;
  private lastBufferReleaseMs = 0;
  private lastDamagePercent = 0;
  private readonly pendingSubmissionTimes = new Map<number, number>();
  private readonly recentSubmitTimes: TimedSample[] = [];
  private readonly recentCompositorTimes: TimedSample[] = [];
  private readonly recentPresentationTimes: TimedSample[] = [];
  private readonly recentFrameDurations: number[] = [];
  private readonly recentSceneDurations: number[] = [];
  private readonly recentRasterDurations: number[] = [];
  private readonly recentSubmitDurations: number[] = [];
  private readonly recentCopyDurations: number[] = [];
  private readonly recentBufferReleaseDurations: number[] = [];
  private readonly recentDamagePercents: number[] = [];
  private readonly recentPresentationLatencies: number[] = [];
  private focusedId: string | null = null;
  private focusedHit: HitRegion | null = null;
  private readonly consumedAutoFocusIds = new Set<string>();

  // Pointer state
  private hoverHit: HitRegion | null = null;
  /** Last known pointer geometry, used to reconcile hover after layout moves. */
  private lastPointerEvent: UiPointerEvent | null = null;
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
    this.invalidate();
  }

  setTitle(title: string): void {
    if (title === this.title) return;
    this.title = title;
    this.platformWin?.setTitle(title);
  }

  onClose(cb: () => void): void {
    this.onCloseCallbacks.add(cb);
  }

  /** Application-loop hook: fires whenever this window needs another tick. */
  onInvalidated(cb: () => void): () => void {
    this.invalidationCallbacks.add(cb);
    return () => this.invalidationCallbacks.delete(cb);
  }

  private invalidate(reconcile = true): void {
    this.dirty = true;
    if (reconcile) this.reconcileDirty = true;
    for (const callback of this.invalidationCallbacks) callback();
  }

  /** Subscribe to compositor frame opportunities (Wayland wl_surface.frame). */
  onCompositorFrame(cb: (timestampMs: number) => void): () => void {
    this.compositorFrameCallbacks.add(cb);
    return () => this.compositorFrameCallbacks.delete(cb);
  }

  getWidth(): number {
    return this.width;
  }

  getHeight(): number {
    return this.height;
  }

  getPlatformDiagnostics(): PlatformDiagnostics | null {
    return this.backend?.getDiagnostics() ?? null;
  }

  getPerformanceSnapshot(): WindowPerformanceSnapshot {
    const now = performance.now();
    const submittedFramesPerSecond = measuredRate(this.recentSubmitTimes, now);
    const compositorFramesPerSecond = measuredRate(
      this.recentCompositorTimes,
      now,
    );
    const presentedFramesPerSecond = measuredRate(
      this.recentPresentationTimes,
      now,
    );
    const presentationIntervals = this.recentPresentationTimes
      .slice(1)
      .map((sample, index) =>
        sample.sourceMs - this.recentPresentationTimes[index]!.sourceMs,
      )
      .filter((interval) => interval > 0);
    return {
      width: this.width,
      height: this.height,
      frames: this.frameCount,
      retainedFrames: this.retainedFrameCount,
      softwareFrames: this.softwareFrameCount,
      reconciledFrames: this.reconciledFrameCount,
      framesPerSecond: submittedFramesPerSecond,
      submittedFramesPerSecond,
      compositorFrames: this.compositorFrameCount,
      compositorFramesPerSecond,
      presentedFrames: this.presentedFrameCount,
      presentedFramesPerSecond,
      discardedFrames: this.discardedFrameCount,
      dmabufFrames: this.dmabufFrameCount,
      shmFrames: this.shmFrameCount,
      lastTransport: this.lastTransport,
      displayRefreshHz: this.displayRefreshHz,
      lastFrameMs: this.lastFrameMs,
      averageFrameMs: average(this.recentFrameDurations),
      lastSceneMs: this.lastSceneMs,
      averageSceneMs: average(this.recentSceneDurations),
      lastRasterMs: this.lastRasterMs,
      averageRasterMs: average(this.recentRasterDurations),
      lastSubmitMs: this.lastSubmitMs,
      averageSubmitMs: average(this.recentSubmitDurations),
      lastCopyMs: this.lastCopyMs,
      averageCopyMs: average(this.recentCopyDurations),
      lastBufferReleaseMs: this.lastBufferReleaseMs,
      averageBufferReleaseMs: average(this.recentBufferReleaseDurations),
      lastDamagePercent: this.lastDamagePercent,
      averageDamagePercent: average(this.recentDamagePercents),
      presentationFrameMsP50: percentile(presentationIntervals, 0.5),
      presentationFrameMsP95: percentile(presentationIntervals, 0.95),
      averagePresentationLatencyMs: average(this.recentPresentationLatencies),
      presentationLatencyMsP95: percentile(this.recentPresentationLatencies, 0.95),
      lastLayerCount: this.lastLayerCount,
    };
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

  setPresentationMode(mode: UiPresentationMode): void {
    this.platformWin?.setPresentationMode(mode);
    this.requestRedraw();
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
        this.invalidate();
      } else {
        // Still need a first paint after configure ack.
        this.invalidate();
      }
    });
    pw.onClose(() => {
      this.closed = true;
      for (const callback of this.onCloseCallbacks) callback();
    });
    pw.onPointer((ev) => this.handlePointer(ev));
    pw.onKey((ev) => this.handleKey(ev));
    pw.onFrame((ev) => this.handleFrameEvent(ev));
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
    // Wake the application loop for the popup without rebuilding the parent.
    popup.onInvalidated(() => this.invalidate(false));
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
    const motion = advanceMotions
      ? tickMotionFrame(dt)
      : { active: false, presentationChanged: false, requiresReconcile: false };
    this.animationsActive = motion.active;
    if (motion.presentationChanged || motion.requiresReconcile) {
      this.dirty = true;
      if (motion.requiresReconcile) this.reconcileDirty = true;
      for (const popup of this.popups) {
        popup.dirty = true;
        if (motion.requiresReconcile) popup.reconcileDirty = true;
      }
    }

    if (!this.dirty) return;
    this.dirty = false;
    const frameStartedAt = performance.now();
    const shouldReconcile = this.reconcileDirty;
    this.reconcileDirty = false;
    if (shouldReconcile) {
      this.reconciledFrameCount++;
      const tree =
        typeof this.content === "function"
          ? this.content({ width: this.width, height: this.height })
          : this.content;
      this.renderingRoot = true;
      try {
        renderShell(this.root, tree);
      } finally {
        this.renderingRoot = false;
      }
      // A motion may have mounted or resumed inside this commit. It has not
      // participated in the pre-render tick yet, but must request the next
      // compositor frame so it can begin without a timer or React state loop.
      if (advanceMotions) this.animationsActive = getMotionActivity().active;
    }
    // Rendering may synchronously finish a closing popup and destroy this
    // platform window. Do not present through a handle invalidated mid-frame.
    if (this.closed || this.platformWin !== platformWin) return;
    const viewport = {
      width: this.width,
      height: this.height,
    };
    // Live transforms affect pointer geometry even though layout is unchanged.
    this.refreshHits();
    const sceneFinishedAt = performance.now();
    const sceneMs = sceneFinishedAt - frameStartedAt;
    if (platformWin.presentScene) {
      const rasterStartedAt = performance.now();
      const retained = !shouldReconcile
        ? this.retainedRenderer.renderPresentation(this.root.container, viewport) ??
          this.retainedRenderer.render(this.root.container, viewport)
        : this.retainedRenderer.render(this.root.container, viewport);
      this.lastLayerCount = retained.layers.length;
      const submitStartedAt = performance.now();
      if (platformWin.presentScene(retained)) {
        this.recordRenderedFrame(
          "retained",
          frameStartedAt,
          sceneMs,
          submitStartedAt - rasterStartedAt,
          performance.now() - submitStartedAt,
        );
        return;
      }
      const frame = this.retainedSoftwareRenderer.render(retained);
      const rasterMs = performance.now() - rasterStartedAt;
      const softwareSubmitStartedAt = performance.now();
      platformWin.present(frame.pixels, frame.width, frame.height, retained.damage);
      this.recordRenderedFrame(
        "software",
        frameStartedAt,
        sceneMs,
        rasterMs,
        performance.now() - softwareSubmitStartedAt,
      );
      return;
    }
    const rasterStartedAt = performance.now();
    const frame = this.renderer.render(this.root.container, viewport);
    const rasterMs = performance.now() - rasterStartedAt;
    const submitStartedAt = performance.now();
    platformWin.present(frame.pixels, frame.width, frame.height);
    this.recordRenderedFrame(
      "software",
      frameStartedAt,
      sceneMs,
      rasterMs,
      performance.now() - submitStartedAt,
    );
  }

  private handleFrameEvent(ev: UiFrameEvent): void {
    if (ev.type === "submitted") {
      this.frameCount++;
      this.lastTransport = ev.transport;
      if (ev.transport === "dmabuf") this.dmabufFrameCount++;
      if (ev.transport === "shm") this.shmFrameCount++;
      this.lastCopyMs = ev.copyMs;
      retainSample(this.recentCopyDurations, ev.copyMs);
      this.lastDamagePercent = ev.totalPixels > 0
        ? (ev.damagedPixels / ev.totalPixels) * 100
        : 0;
      retainSample(this.recentDamagePercents, this.lastDamagePercent);
      this.pendingSubmissionTimes.set(ev.commitId, ev.submittedAtMs);
      if (this.pendingSubmissionTimes.size > 240) {
        const oldest = this.pendingSubmissionTimes.keys().next().value as
          | number
          | undefined;
        if (oldest != null) this.pendingSubmissionTimes.delete(oldest);
      }
      this.recentSubmitTimes.push({
        sourceMs: ev.submittedAtMs,
        receivedAtMs: ev.submittedAtMs,
      });
      return;
    }
    if (ev.type === "compositor-frame") {
      this.compositorFrameCount++;
      this.recentCompositorTimes.push({
        sourceMs: ev.timestampMs,
        receivedAtMs: ev.receivedAtMs,
      });
      for (const callback of this.compositorFrameCallbacks) {
        callback(ev.timestampMs);
      }
      if (this.animationsActive || ev.retrySuggested) this.invalidate(false);
      return;
    }
    if (ev.type === "presented") {
      this.presentedFrameCount++;
      const wholeMs = ev.timestampNs / 1_000_000n;
      const fractionalMs = ev.timestampNs % 1_000_000n;
      this.recentPresentationTimes.push({
        sourceMs: Number(wholeMs) + Number(fractionalMs) / 1_000_000,
        receivedAtMs: ev.receivedAtMs,
      });
      this.displayRefreshHz = ev.refreshNs > 0
        ? 1_000_000_000 / ev.refreshNs
        : this.displayRefreshHz;
      const submittedAtMs = this.pendingSubmissionTimes.get(ev.commitId);
      if (submittedAtMs != null) {
        retainSample(
          this.recentPresentationLatencies,
          Math.max(0, ev.receivedAtMs - submittedAtMs),
        );
        this.pendingSubmissionTimes.delete(ev.commitId);
      }
      return;
    }
    if (ev.type === "discarded") {
      this.discardedFrameCount++;
      this.pendingSubmissionTimes.delete(ev.commitId);
      return;
    }
    this.lastBufferReleaseMs = ev.latencyMs;
    retainSample(this.recentBufferReleaseDurations, ev.latencyMs);
    if (ev.retrySuggested) this.invalidate(false);
  }

  private recordRenderedFrame(
    renderer: "retained" | "software",
    startedAt: number,
    sceneMs: number,
    rasterMs: number,
    submitMs: number,
  ): void {
    const duration = performance.now() - startedAt;
    if (renderer === "retained") this.retainedFrameCount++;
    else this.softwareFrameCount++;
    this.lastFrameMs = duration;
    this.lastSceneMs = sceneMs;
    this.lastRasterMs = rasterMs;
    this.lastSubmitMs = submitMs;
    retainSample(this.recentFrameDurations, duration);
    retainSample(this.recentSceneDurations, sceneMs);
    retainSample(this.recentRasterDurations, rasterMs);
    retainSample(this.recentSubmitDurations, submitMs);
  }

  requestRedraw(): void {
    this.invalidate();
  }

  destroy(): void {
    for (const popup of [...this.popups]) popup.destroy();
    this.popups.clear();
    this.closed = true;
    this.compositorFrameCallbacks.clear();
    this.invalidationCallbacks.clear();
    this.pendingSubmissionTimes.clear();
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
    this.renderingRoot = true;
    try {
      renderShell(this.root, tree);
    } finally {
      this.renderingRoot = false;
    }
    this.refreshHits();
    this.invalidate();
  }

  private refreshHits(): void {
    this.hits = collectHits(this.root.container);
    this.reconcileHoverAfterLayout();
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
      this.invalidate();
      return;
    }
    if (activeScopeId && this.focusedHit?.focusScopeId !== activeScopeId) {
      const firstInScope = this.hits.find(
        (hit) => hit.focusable && hit.focusScopeId === activeScopeId,
      );
      if (firstInScope) {
        this.changeFocus(firstInScope);
        this.invalidate();
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

  private reconcileHoverAfterLayout(): void {
    const ev = this.lastPointerEvent;
    if (!ev || this.capturedHit) return;
    const next = this.findTopHit(
      ev.x,
      ev.y,
      (hit) => !!(hit.onPointerEnter || hit.onPointerLeave || hit.onPointerMove),
    );
    if (next?.focusId === this.hoverHit?.focusId) {
      // Refresh the callbacks and geometry without manufacturing a leave/enter
      // pair for every React commit.
      this.hoverHit = next;
      return;
    }
    this.hoverHit?.onPointerLeave?.(this.makeEvArgs(this.hoverHit, ev));
    this.hoverHit = next;
    next?.onPointerEnter?.(this.makeEvArgs(next, ev));
    this.invalidate();
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
    this.lastPointerEvent = ev;

    if (ev.type === "move") {
      if (this.capturedHit) {
        // Captured by an earlier `down` — keep delivering to that element
        // even though the cursor has left its bounds (drag gesture), rather
        // than re-hit-testing at the live position.
        if (this.capturedHit.onPointerMove) {
          this.capturedHit.onPointerMove(this.makeEvArgs(this.capturedHit, ev));
          this.flushAndDirty();
        }
        return;
      }
      const newHover = this.findTopHit(
        ev.x,
        ev.y,
        (h) => !!(h.onPointerEnter || h.onPointerLeave || h.onPointerMove),
      );
      let changed = false;
      if (newHover?.focusId !== this.hoverHit?.focusId) {
        if (this.hoverHit?.onPointerLeave) {
          this.hoverHit.onPointerLeave(this.makeEvArgs(this.hoverHit, ev));
          changed = true;
        }
        this.hoverHit = newHover;
        if (newHover?.onPointerEnter) {
          newHover.onPointerEnter(this.makeEvArgs(newHover, ev));
          changed = true;
        }
      } else if (newHover) {
        // Hit regions are re-collected after every commit; retain the latest
        // callbacks without treating object identity as a hover transition.
        this.hoverHit = newHover;
      }
      if (newHover?.onPointerMove) {
        newHover.onPointerMove(this.makeEvArgs(newHover, ev));
        changed = true;
      }
      if (changed) {
        this.flushAndDirty();
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
