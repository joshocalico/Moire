/**
 * Headless PlatformBackend — in-memory framebuffer for tests / non-Linux CI.
 */
import type {
  PlatformBackend,
  PlatformWindow,
  PlatformWindowOpts,
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
  private alive = true;
  /** Number of synthetic interactive move requests, exposed for tests. */
  moveRequests = 0;

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

  present(pixels: Uint8Array, width: number, height: number): void {
    if (!this.alive) return;
    this.width = width;
    this.height = height;
    this.lastFrame = Uint8Array.from(pixels);
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
  }

  getTitle(): string {
    return this.title;
  }
}
