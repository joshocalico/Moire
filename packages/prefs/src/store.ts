/**
 * Moire user preferences — ~/.config/moire/settings.json
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { parseThemeFamily, type ThemeFamily } from "@moire/theme";

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
  themeFamily: ThemeFamily;
  /** Disable decorative motion in Moire applications sharing this user profile. */
  reducedMotion: boolean;
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
  themeFamily: "moire",
  reducedMotion: false,
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
    const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return normalizeSettings(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** External JSON is narrowed once; malformed fields fall back independently. */
export function normalizeSettings(value: unknown): MoireSettings {
  const s = isRecord(value) ? value : {};
  const wp = s.wallpaper;
  let wallpaper: WallpaperSettings | null = null;
  if (isRecord(wp)) {
    const mode = wp.mode;
    if (mode === "atmosphere" || mode === "gradient" || mode === "solid" || mode === "image") {
      wallpaper = {
        mode,
        ...(typeof wp.path === "string" ? { path: wp.path } : {}),
        ...(typeof wp.preset === "string" ? { preset: wp.preset } : {}),
      };
    }
  }
  return {
    dark: typeof s.dark === "boolean" ? s.dark : DEFAULT_SETTINGS.dark,
    themeFamily: parseThemeFamily(s.themeFamily),
    reducedMotion: s.reducedMotion === true,
    notifications:
      typeof s.notifications === "boolean" ? s.notifications : DEFAULT_SETTINGS.notifications,
    uiScale: clamp(finiteNumber(s.uiScale, DEFAULT_SETTINGS.uiScale), 0.75, 2),
    displayMode:
      typeof s.displayMode === "string" && /^\d+x\d+@\d+$/.test(s.displayMode)
        ? s.displayMode
        : null,
    displayOutputs: normalizeDisplayOutputs(s.displayOutputs),
    volume: clamp(finiteNumber(s.volume, DEFAULT_SETTINGS.volume), 0, 1),
    showDesktopIcons:
      typeof s.showDesktopIcons === "boolean"
        ? s.showDesktopIcons
        : DEFAULT_SETTINGS.showDesktopIcons,
    wallpaper,
  };
}

function normalizeDisplayOutputs(value: unknown): Record<string, DisplayOutputSettings> {
  if (!isRecord(value)) return {};
  const result: Record<string, DisplayOutputSettings> = {};
  for (const [id, item] of Object.entries(value)) {
    if (!id || !isRecord(item)) continue;
    const mode =
      typeof item.mode === "string" && /^\d+x\d+@\d+$/.test(item.mode) ? item.mode : null;
    Object.defineProperty(result, id, {
      value: {
        x: Math.round(clamp(finiteNumber(item.x, 0), 0, 65_535)),
        y: Math.round(clamp(finiteNumber(item.y, 0), 0, 65_535)),
        scale120: Math.round(clamp(finiteNumber(item.scale120, 120), 120, 240)),
        primary: item.primary === true,
        mode,
      },
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  const entries = Object.values(result);
  const first = entries[0];
  if (first && !entries.some((item) => item.primary)) first.primary = true;
  else {
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
  const temporary = `${dest}.${process.pid}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, out, { encoding: "utf8", mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, dest);
  } catch (error) {
    try {
      fs.rmSync(temporary, { force: true });
    } catch {
      // Preserve the original save error if its temporary file cannot be removed.
    }
    throw error;
  }
}

/** Apply only the caller's fields to the latest stored profile, not a stale UI snapshot. */
export function updateSettings(patch: Partial<MoireSettings>): MoireSettings {
  const next = normalizeSettings({ ...loadSettings(), ...patch });
  saveSettings(next);
  return next;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
