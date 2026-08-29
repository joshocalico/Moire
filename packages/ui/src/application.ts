import { createPlatformBackend, resolvePlatformKind, type PlatformBackend } from "./platform";
import { installUiFonts, setUiScaleFactor } from "./font/index";
import { Window } from "./window";

export type ApplicationOpts = {
  /** Force platform; default auto (wayland if WAYLAND_DISPLAY, else headless). */
  platform?: "wayland" | "headless";
};

/**
 * Application event loop — owns PlatformBackend and Windows.
 */
export class Application {
  private backend: PlatformBackend | null = null;
  private windows: Window[] = [];
  private running = false;
  private readonly platformKind: "wayland" | "headless";
  private wakePending = true;
  private wakeResolver: (() => void) | null = null;

  constructor(opts: ApplicationOpts = {}) {
    this.platformKind = opts.platform ?? resolvePlatformKind();
  }

  addWindow(win: Window): void {
    this.windows.push(win);
    win.onInvalidated(() => this.wake());
  }

  async run(): Promise<void> {
    try {
      const { loadSettings } = await import("@moire/prefs");
      setUiScaleFactor(loadSettings().uiScale);
    } catch {
      // prefs optional for headless smoke without workspace link
    }
    await installUiFonts();
    this.backend = await createPlatformBackend(this.platformKind);
    await this.backend.connect();
    console.log(`[ui] platform=${this.backend.name}`);

    for (const w of this.windows) {
      w.mount(this.backend);
      w.onClose(() => {
        if (this.windows.every((x) => x.isClosed())) this.quit();
      });
    }

    this.running = true;
    while (this.running) {
      this.backend.pump();
      for (const w of this.windows) {
        if (!w.isClosed()) w.tick();
      }
      if (this.windows.length > 0 && this.windows.every((w) => w.isClosed())) {
        this.quit();
        break;
      }
      // Native input, frame callbacks, React commits and timers wake this
      // loop directly. The timeout is only a liveness fallback for future
      // backends, not the animation clock.
      await this.waitForWake(1_000);
    }

    for (const w of this.windows) w.destroy();
    this.backend.disconnect();
    this.backend = null;
  }

  quit(): void {
    this.running = false;
    this.wake();
  }

  private wake(): void {
    if (this.wakeResolver) {
      const resolve = this.wakeResolver;
      this.wakeResolver = null;
      resolve();
      return;
    }
    this.wakePending = true;
  }

  private waitForWake(timeoutMs: number): Promise<void> {
    if (this.wakePending) {
      this.wakePending = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.wakeResolver === finish) this.wakeResolver = null;
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      this.wakeResolver = finish;
    });
  }
}
