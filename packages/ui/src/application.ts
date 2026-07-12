import {
  createPlatformBackend,
  resolvePlatformKind,
  type PlatformBackend,
} from "./platform.js";
import { installUiFonts, setUiScaleFactor } from "./font/index.js";
import { Window } from "./window.js";

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

  constructor(opts: ApplicationOpts = {}) {
    this.platformKind = opts.platform ?? resolvePlatformKind();
  }

  addWindow(win: Window): void {
    this.windows.push(win);
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
      await sleep(8);
    }

    for (const w of this.windows) w.destroy();
    this.backend.disconnect();
    this.backend = null;
  }

  quit(): void {
    this.running = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
