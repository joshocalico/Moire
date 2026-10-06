import { createPlatformBackend, resolvePlatformKind, type PlatformBackend } from "./platform";
import { installUiFonts, setUiScaleFactor } from "./font/index";
import { Window } from "./window";
import {
  mergePersonalization,
  type PersonalizationOverrides,
  type PersonalizationProfile,
} from "./personalization";
import { createPersonalizedWidgetTheme, createWidgetTheme, type WidgetTheme } from "./widget-theme";
import type { MoireTheme } from "./theme";

export type ApplicationTheme =
  | "system"
  | MoireTheme
  | WidgetTheme
  | ((profile: PersonalizationProfile) => WidgetTheme);

export type ApplicationOpts = {
  /** Force platform; default auto (wayland if WAYLAND_DISPLAY, else headless). */
  platform?: "wayland" | "headless";
  /** System by default; accepts an app-wide theme or profile-driven factory. */
  theme?: ApplicationTheme;
  /** Override individual discovered preferences while inheriting the rest. */
  personalization?: PersonalizationOverrides;
};

/**
 * Application event loop — owns PlatformBackend and Windows.
 */
export class Application {
  private static readonly ANIMATION_FRAME_MS = 16;
  private backend: PlatformBackend | null = null;
  private windows: Window[] = [];
  private running = false;
  private readonly platformKind: "wayland" | "headless";
  private wakePending = true;
  private wakeResolver: (() => void) | null = null;
  private requestedTheme: ApplicationTheme;
  private personalizationOverrides: PersonalizationOverrides;
  private discoveredPersonalization: PersonalizationProfile | null = null;
  private personalization: PersonalizationProfile | null = null;
  private widgetTheme: WidgetTheme | null = null;
  private systemTheme: MoireTheme | undefined;
  private personalizationPoll: (() => void) | null = null;
  private personalizationStop: (() => void) | null = null;

  constructor(opts: ApplicationOpts = {}) {
    this.platformKind = opts.platform ?? resolvePlatformKind();
    this.requestedTheme = opts.theme ?? "system";
    this.personalizationOverrides = opts.personalization ?? {};
  }

  addWindow(win: Window): void {
    this.windows.push(win);
    if (this.widgetTheme) win.setTheme(this.widgetTheme);
    win.onInvalidated(() => this.wake());
  }

  async run(): Promise<void> {
    await installUiFonts();
    this.backend = await createPlatformBackend(this.platformKind);
    await this.backend.connect();
    this.discoveredPersonalization = this.backend.getPersonalization();
    this.personalization = mergePersonalization(
      this.discoveredPersonalization,
      this.personalizationOverrides,
    );
    if (this.personalization.source === "moire") {
      try {
        const { createPrefsWatcher, loadRuntimeTheme, loadSettings } = await import("@moire/prefs");
        const settings = loadSettings();
        this.systemTheme = loadRuntimeTheme();
        this.discoveredPersonalization = mergePersonalization(this.discoveredPersonalization, {
          colorScheme: settings.dark ? "dark" : "light",
          accent: this.systemTheme.tokens.accent,
          fontScale: settings.uiScale,
          themeFamily: settings.themeFamily,
          reducedMotion: settings.reducedMotion,
        });
        this.personalization = mergePersonalization(
          this.discoveredPersonalization,
          this.personalizationOverrides,
        );
        const watcher = createPrefsWatcher((theme) => {
          const nextSettings = loadSettings();
          this.systemTheme = theme;
          this.discoveredPersonalization = mergePersonalization(this.discoveredPersonalization!, {
            colorScheme: nextSettings.dark ? "dark" : "light",
            themeFamily: nextSettings.themeFamily,
            reducedMotion: nextSettings.reducedMotion,
            accent: theme.tokens.accent,
            fontScale: nextSettings.uiScale,
          });
          this.personalization = mergePersonalization(
            this.discoveredPersonalization,
            this.personalizationOverrides,
          );
          setUiScaleFactor(this.personalization.fontScale);
          this.refreshPersonalizationPresentation();
        });
        this.personalizationPoll = () => {
          watcher.poll();
        };
        this.personalizationStop = () => watcher.stop();
      } catch {
        // Moire prefs are optional for portable/headless consumers.
      }
    }
    setUiScaleFactor(this.personalization.fontScale);
    this.applyTheme(this.resolveTheme());
    this.personalizationStop = this.chainStops(
      this.personalizationStop,
      this.backend.onPersonalizationChange?.((profile) => {
        this.discoveredPersonalization = profile;
        this.personalization = mergePersonalization(
          this.discoveredPersonalization,
          this.personalizationOverrides,
        );
        setUiScaleFactor(this.personalization.fontScale);
        this.refreshPersonalizationPresentation();
      }) ?? null,
    );
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
      this.personalizationPoll?.();
      for (const w of this.windows) {
        if (!w.isClosed()) w.tick();
      }
      if (this.windows.length > 0 && this.windows.every((w) => w.isClosed())) {
        this.quit();
        break;
      }
      // Prefer compositor frame callbacks, but keep a paced local animation
      // clock while presentation values are active. A delayed or discarded
      // callback must not freeze interpolation until the one-second liveness
      // wake; the platform window's frame gate still prevents over-submission.
      const timeoutMs = this.windows.some(
        (window) => !window.isClosed() && window.hasActiveAnimations(),
      )
        ? Application.ANIMATION_FRAME_MS
        : 1_000;
      await this.waitForWake(timeoutMs);
    }

    for (const w of this.windows) w.destroy();
    this.personalizationStop?.();
    this.personalizationStop = null;
    this.personalizationPoll = null;
    this.backend.disconnect();
    this.backend = null;
  }

  getPersonalization(): PersonalizationProfile | null {
    return this.personalization;
  }

  /** Switch between system, profile-driven, and concrete application themes at runtime. */
  setTheme(theme: ApplicationTheme): void {
    this.requestedTheme = theme;
    if (this.personalization) this.applyTheme(this.resolveTheme());
  }

  /** Replace application-level preference overrides while retaining backend discovery. */
  setPersonalization(overrides: PersonalizationOverrides): void {
    this.personalizationOverrides = overrides;
    if (!this.discoveredPersonalization) return;
    this.personalization = mergePersonalization(this.discoveredPersonalization, overrides);
    setUiScaleFactor(this.personalization.fontScale);
    this.refreshPersonalizationPresentation();
  }

  /** Persist the user's motion preference without applying GTK, audio or renderer policy. */
  async setSessionReducedMotion(reducedMotion: boolean): Promise<void> {
    const { updateSettings } = await import("@moire/prefs");
    const settings = updateSettings({ reducedMotion });
    if (!this.discoveredPersonalization) return;
    this.discoveredPersonalization = mergePersonalization(this.discoveredPersonalization, {
      reducedMotion: settings.reducedMotion,
    });
    this.personalization = mergePersonalization(
      this.discoveredPersonalization,
      this.personalizationOverrides,
    );
    this.refreshPersonalizationPresentation();
  }

  quit(): void {
    this.running = false;
    this.wake();
  }

  private resolveTheme(): WidgetTheme {
    const profile = this.personalization;
    if (!profile) return createWidgetTheme(this.systemTheme);
    if (typeof this.requestedTheme === "function") return this.requestedTheme(profile);
    if (this.requestedTheme !== "system") {
      return this.isWidgetTheme(this.requestedTheme)
        ? this.requestedTheme
        : createWidgetTheme(this.requestedTheme);
    }
    return createPersonalizedWidgetTheme(profile, this.systemTheme);
  }

  private isWidgetTheme(theme: MoireTheme | WidgetTheme): theme is WidgetTheme {
    return "foundations" in theme && "recipes" in theme;
  }

  private applyTheme(theme: WidgetTheme): void {
    this.widgetTheme = theme;
    for (const window of this.windows) window.setTheme(theme);
    this.wake();
  }

  private usesPersonalizationTheme(): boolean {
    return this.requestedTheme === "system" || typeof this.requestedTheme === "function";
  }

  private refreshPersonalizationPresentation(): void {
    if (this.usesPersonalizationTheme()) {
      this.applyTheme(this.resolveTheme());
      return;
    }
    for (const window of this.windows) window.requestRedraw();
    this.wake();
  }

  private chainStops(first: (() => void) | null, second: (() => void) | null): (() => void) | null {
    if (!first) return second;
    if (!second) return first;
    return () => {
      first();
      second();
    };
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
