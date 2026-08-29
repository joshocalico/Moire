/**
 * Moire user preferences — ~/.config/moire/settings.json
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type WallpaperSettings = {
  mode: "atmosphere" | "gradient" | "solid" | "image";
  /** Absolute path; only used when mode === "image". */
  path?: string;
  /** Optional preset name hint for future use. */
  preset?: string;
};

export type DisplayOutputSettings = {
  x: number;
  y: number;
  /** Fractional scale in Wayland's 120ths (120 = 100%). */
  scale120: number;
  primary: boolean;
  mode: string | null;
};

export type MoireSettings = {
  /** Prefer dark tokens + GTK dark scheme. */
  dark: boolean;
  /** Desktop notification preference (future toast daemon). */
  notifications: boolean;
  /** UI scale factor (1.0 = 100%). Shell/compositor may honor later. */
  uiScale: number;
  /** Confirmed DRM mode id (`WIDTHxHEIGHT@MILLIHZ`); null uses preferred. */
  displayMode: string | null;
  /** Confirmed layout keyed by EDID identity (connector identity as fallback). */
  displayOutputs: Record<string, DisplayOutputSettings>;
  /** Last requested sink volume 0..1 (also applied via wpctl/pactl when available). */
  volume: number;
  /** Show file icons on the desktop background. */
  showDesktopIcons: boolean;
  /** Wallpaper override; null means use the bundled theme's wallpaper. */
  wallpaper: WallpaperSettings | null;
};

export const DEFAULT_SETTINGS: MoireSettings = {
  dark: true,
  notifications: true,
  uiScale: 1,
  displayMode: null,
  displayOutputs: {},
  volume: 0.7,
  showDesktopIcons: true,
  wallpaper: null,
};

export function configDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(base, "moire");
}

export function settingsPath(): string {
  return path.join(configDir(), "settings.json");
}

/** Active theme file written by Settings; compositor prefers this when present. */
export function activeThemePath(): string {
  return path.join(configDir(), "active-theme.json");
}

export function loadSettings(): MoireSettings {
  const file = settingsPath();
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<MoireSettings>;
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...raw });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function normalizeSettings(s: MoireSettings): MoireSettings {
  const wp = s.wallpaper as WallpaperSettings | null | undefined;
  let wallpaper: WallpaperSettings | null = null;
  if (wp && typeof wp === "object" && typeof wp.mode === "string") {
    const mode = wp.mode as WallpaperSettings["mode"];
    if (mode === "atmosphere" || mode === "gradient" || mode === "solid" || mode === "image") {
      wallpaper = { mode, path: wp.path, preset: wp.preset };
    }
  }
  return {
    dark: !!s.dark,
    notifications: !!s.notifications,
    uiScale: clamp(Number(s.uiScale) || 1, 0.75, 2),
    displayMode:
      typeof s.displayMode === "string" && /^\d+x\d+@\d+$/.test(s.displayMode)
        ? s.displayMode
        : null,
    displayOutputs: normalizeDisplayOutputs(s.displayOutputs),
    volume: clamp(Number(s.volume) || 0, 0, 1),
    showDesktopIcons: s.showDesktopIcons !== false,
    wallpaper,
  };
}

function normalizeDisplayOutputs(value: unknown): Record<string, DisplayOutputSettings> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, DisplayOutputSettings> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!id || !raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Partial<DisplayOutputSettings>;
    const mode =
      typeof item.mode === "string" && /^\d+x\d+@\d+$/.test(item.mode) ? item.mode : null;
    result[id] = {
      x: Math.round(clamp(Number(item.x) || 0, 0, 65_535)),
      y: Math.round(clamp(Number(item.y) || 0, 0, 65_535)),
      scale120: Math.round(clamp(Number(item.scale120) || 120, 120, 240)),
      primary: item.primary === true,
      mode,
    };
  }
  const entries = Object.values(result);
  if (entries.length > 0 && !entries.some((item) => item.primary)) {
    entries[0]!.primary = true;
  } else if (entries.filter((item) => item.primary).length > 1) {
    let found = false;
    for (const item of entries) {
      if (item.primary && found) item.primary = false;
      found ||= item.primary;
    }
  }
  return result;
}

export function saveSettings(settings: MoireSettings): void {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const next = normalizeSettings(settings);
  const out = `${JSON.stringify(next, null, 2)}\n`;
  const dest = settingsPath();
  try {
    if (fs.readFileSync(dest, "utf8") === out) return;
  } catch {
    // missing — write
  }
  fs.writeFileSync(dest, out, "utf8");
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
