/**
 * Headless PlatformBackend — in-memory framebuffer for tests / non-Linux CI.
 */
import type {
  PlatformBackend,
  PlatformWindow,
  PlatformWindowOpts,
  PlatformDiagnostics,
  UiFrameEvent,
  UiPresentationMode,
  UiKeyEvent,
  UiPointerEvent,
} from "../../platform.js";

export class HeadlessPlatform implements PlatformBackend {
  readonly name = "headless";
  private windows: HeadlessWindow[] = [];

  async connect(): Promise<void> {
    // no-op
  }

  createWindow(opts: PlatformWindowOpts): PlatformWindow {
    const w = new HeadlessWindow(opts);
    this.windows.push(w);
    // Deliver initial configure asynchronously so Window can subscribe first.
    queueMicrotask(() => w.emitConfigure(opts.width, opts.height));
    return w;
  }

  getDiagnostics(): PlatformDiagnostics {
    return {
      platform: "headless",
      displayServer: "none",
      transport: "in-memory",
      presentation: "headless",
      requestedAcceleration: process.env.MOIRE_UI_ACCELERATION ?? "auto",
      accelerated: false,
      capabilities: [],
      retainedFrames: 0,
      softwareFrames: this.windows.reduce(
        (total, window) => total + window.presentedFrames,
        0,
      ),
      dmabufFrames: 0,
      shmFrames: 0,
    };
  }

  pump(): void {
    // Synthetic events are pushed by tests via HeadlessWindow.inject*.
  }

  /** Exposes in-memory windows to headless interaction tests. */
  getWindows(): readonly HeadlessWindow[] {
    return this.windows;
  }

  disconnect(): void {
    for (const w of this.windows) w.destroy();
    this.windows = [];
  }
}

export class HeadlessWindow implements PlatformWindow {
  private title: string;
  private width: number;
  private height: number;
  /** Last presented frame (for tests). */
  lastFrame: Uint8Array | null = null;
  private configureCbs: Array<(w: number, h: number) => void> = [];
  private closeCbs: Array<() => void> = [];
  private pointerCbs: Array<(ev: UiPointerEvent) => void> = [];
  private keyCbs: Array<(ev: UiKeyEvent) => void> = [];
  private frameCbs: Array<(ev: UiFrameEvent) => void> = [];
  private alive = true;
  private nextCommitId = 1;
  /** Number of synthetic interactive move requests, exposed for tests. */
  moveRequests = 0;
  presentedFrames = 0;

  constructor(opts: PlatformWindowOpts) {
    this.title = opts.title;
    this.width = opts.width;
    this.height = opts.height;
  }

  setTitle(title: string): void {
    this.title = title;
  }

  setSize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.emitConfigure(this.width, this.height);
  }

  beginMove(): void {
    if (this.alive) this.moveRequests++;
  }

  setPresentationMode(_mode: UiPresentationMode): void {
    // The in-memory backend has one transport.
  }

  present(pixels: Uint8Array, width: number, height: number): void {
    if (!this.alive) return;
    this.width = width;
    this.height = height;
    this.lastFrame = Uint8Array.from(pixels);
    this.presentedFrames++;
    const commitId = this.nextCommitId++;
    const submittedAtMs = performance.now();
    this.emitFrame({
      type: "submitted",
      commitId,
      transport: "headless",
      submittedAtMs,
      copyMs: 0,
      damagedPixels: width * height,
      totalPixels: width * height,
    });
    queueMicrotask(() => {
      if (!this.alive) return;
      const receivedAtMs = performance.now();
      this.emitFrame({
        type: "compositor-frame",
        commitId,
        timestampMs: receivedAtMs,
        receivedAtMs,
      });
      this.emitFrame({
        type: "presented",
        commitId,
        timestampNs: process.hrtime.bigint(),
        refreshNs: 0,
        sequence: BigInt(commitId),
        flags: 0,
        receivedAtMs,
      });
    });
  }

  onConfigure(cb: (w: number, h: number) => void): void {
    this.configureCbs.push(cb);
  }

  onClose(cb: () => void): void {
    this.closeCbs.push(cb);
  }

  onPointer(cb: (ev: UiPointerEvent) => void): void {
    this.pointerCbs.push(cb);
  }

  onKey(cb: (ev: UiKeyEvent) => void): void {
    this.keyCbs.push(cb);
  }

  onFrame(cb: (ev: UiFrameEvent) => void): void {
    this.frameCbs.push(cb);
  }

  private emitFrame(ev: UiFrameEvent): void {
    for (const cb of this.frameCbs) cb(ev);
  }

  emitConfigure(w: number, h: number): void {
    for (const cb of this.configureCbs) cb(w, h);
  }

  injectPointer(ev: UiPointerEvent): void {
    for (const cb of this.pointerCbs) cb(ev);
  }

  injectKey(ev: UiKeyEvent): void {
    for (const cb of this.keyCbs) cb(ev);
  }

  requestClose(): void {
    for (const cb of this.closeCbs) cb();
  }

  destroy(): void {
    this.alive = false;
    this.configureCbs = [];
    this.closeCbs = [];
    this.pointerCbs = [];
    this.keyCbs = [];
    this.frameCbs = [];
  }

  getTitle(): string {
    return this.title;
  }
}
