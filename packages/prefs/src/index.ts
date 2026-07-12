/**
 * Watch Moire prefs / active theme and reload into @moire/theme cache.
 */
import fs from "node:fs";
import { loadTheme, setTheme, type MoireTheme } from "@moire/theme";
import { activeThemePath, loadSettings, settingsPath } from "./store.js";
import { bundledThemePath } from "./apply.js";

export type PrefsWatcher = {
  /** Poll for changes (call from compositor frame / shell timer). */
  poll(): boolean;
  /** Current theme after last successful load. */
  theme(): MoireTheme;
  stop(): void;
};

/**
 * Prefer ~/.config/moire/active-theme.json when present; else bundled theme
 * for the current dark preference in settings.json.
 */
export function resolveRuntimeThemePath(): string {
  const active = activeThemePath();
  if (fs.existsSync(active)) return active;
  try {
    return bundledThemePath(loadSettings().dark);
  } catch {
    return bundledThemePath(true);
  }
}

export function loadRuntimeTheme(): MoireTheme {
  const theme = loadTheme(resolveRuntimeThemePath());
  setTheme(theme);
  return theme;
}

export function createPrefsWatcher(
  onChange?: (theme: MoireTheme) => void,
): PrefsWatcher {
  let lastSettingsMtime = 0;
  let lastThemeMtime = 0;
  let lastSig = "";
  let current = loadRuntimeTheme();
  let debounceUntil = 0;

  const mtime = (p: string): number => {
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      return 0;
    }
  };

  const signature = (): string => {
    try {
      const s = loadSettings();
      return `${s.dark}|${s.uiScale}|${mtime(activeThemePath())}|${current.name}`;
    } catch {
      return String(mtime(activeThemePath()));
    }
  };

  lastSettingsMtime = mtime(settingsPath());
  lastThemeMtime = mtime(activeThemePath());
  lastSig = signature();

  return {
    theme: () => current,
    poll(): boolean {
      const now = Date.now();
      if (now < debounceUntil) return false;
      const sm = mtime(settingsPath());
      const tm = mtime(activeThemePath());
      if (sm === lastSettingsMtime && tm === lastThemeMtime) return false;
      lastSettingsMtime = sm;
      lastThemeMtime = tm;
      try {
        const settings = loadSettings();
        const next = loadRuntimeTheme();
        const sig = `${settings.dark}|${settings.uiScale}|${tm}|${next.name}`;
        if (sig === lastSig) return false;
        lastSig = sig;
        current = next;
        debounceUntil = now + 200;
        onChange?.(current);
        console.log(
          `[prefs] reloaded theme=${current.name} scale=${settings.uiScale}`,
        );
        return true;
      } catch (err) {
        console.warn("[prefs] reload failed:", err);
        return false;
      }
    },
    stop() {
      // no handles
    },
  };
}

export {
  loadSettings,
  saveSettings,
  settingsPath,
  activeThemePath,
  configDir,
  DEFAULT_SETTINGS,
  type MoireSettings,
  type WallpaperSettings,
} from "./store.js";
export {
  applySettings,
  applyVolume,
  readSystemVolume,
  writeActiveTheme,
  themeForSettings,
  applyGtkAppearance,
  bundledThemePath,
  type ApplyResult,
} from "./apply.js";
