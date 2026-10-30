/**
 * Moire user preferences — ~/.config/moire/settings.json
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { parseThemeFamily, type ThemeFamily } from "@moire/theme";
import {
  DEFAULT_KEYBOARD_SETTINGS,
  DEFAULT_POINTER_SETTINGS,
  normalizeKeyboardSettings,
  normalizePointerSettings,
  type KeyboardSettings,
  type PointerSettings,
} from "./input";
import { DEFAULT_REGION_SETTINGS, normalizeRegionSettings, type RegionSettings } from "./region";
import { DEFAULT_POWER_SETTINGS, normalizePowerSettings, type PowerSettings } from "./power";
import { normalizeLauncherPins } from "./launcher";
import {
  DEFAULT_MANUAL_PROXY,
  normalizeManualProxy,
  type ManualProxySettings,
} from "./network-proxy";
import {
  DEFAULT_AUTO_DARK,
  DEFAULT_NIGHT_LIGHT,
  normalizeAutoDark,
  normalizeNightLight,
  type AutoDarkSettings,
  type NightLightSettings,
} from "./daylight";
import {
  DEFAULT_DND_SCHEDULE,
  normalizeDndSchedule,
  normalizeNotificationRules,
  type DoNotDisturbSchedule,
  type NotificationRules,
} from "./notifications";

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
  /** Accent colour (`#rrggbb`) over the style's own; null keeps the style's accent. */
  accent: string | null;
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
  /** Last requested sink volume 0..1 (the live volume is PipeWire's, set by the management service). */
  volume: number;
  /** Show file icons on the desktop background. */
  showDesktopIcons: boolean;
  /** The panel as one full-width bar instead of floating islands. */
  panelFullWidth: boolean;
  /** Window buttons in the panel show only their icon. */
  panelIconsOnly: boolean;
  /** Wallpaper override; null means use the bundled theme's wallpaper. */
  wallpaper: WallpaperSettings | null;
  /** Let the index service crawl Home for search; off deletes the index. */
  indexingEnabled: boolean;
  /** Folders (absolute or `~/…`) and name patterns (`*.iso`) the index skips. */
  indexExcludes: string[];
  /** Extra folders to index, such as a removable drive's mount point the user opted in. */
  indexIncludes: string[];
  /** Layouts, switching, repeat and Caps Lock; applied live by the compositor. */
  keyboard: KeyboardSettings;
  /** Pointer speed, scrolling and buttons; applied live by the compositor. */
  pointer: PointerSettings;
  /** Clock, first weekday and date order; read by the panel clock and apps. */
  region: RegionSettings;
  /** Dim, screen off, lock, suspend, lid, power key and power profile; applied by the compositor. */
  power: PowerSettings;
  /** Desktop entry ids the launcher lists first, in this order. */
  launcherPins: string[];
  /** Per-app notification rules, keyed by app id (see `notificationAppKey`). */
  notificationRules: NotificationRules;
  /** Hours when Do not disturb turns itself on. */
  doNotDisturbSchedule: DoNotDisturbSchedule;
  /** Warm the screen in the evening; applied by the compositor at composition. */
  nightLight: NightLightSettings;
  /** Switch `dark` on a schedule; the management service flips it at the boundaries. */
  autoDark: AutoDarkSettings;
  /** A hand-entered proxy, put in the environment of apps the compositor starts. */
  proxy: ManualProxySettings;
};

export const DEFAULT_SETTINGS: MoireSettings = {
  dark: true,
  themeFamily: "moire",
  accent: null,
  reducedMotion: false,
  notifications: true,
  uiScale: 1,
  displayMode: null,
  displayOutputs: {},
  volume: 0.7,
  showDesktopIcons: true,
  panelFullWidth: false,
  panelIconsOnly: false,
  wallpaper: null,
  indexingEnabled: true,
  indexExcludes: [],
  indexIncludes: [],
  keyboard: DEFAULT_KEYBOARD_SETTINGS,
  pointer: DEFAULT_POINTER_SETTINGS,
  region: DEFAULT_REGION_SETTINGS,
  power: DEFAULT_POWER_SETTINGS,
  launcherPins: [],
  notificationRules: {},
  doNotDisturbSchedule: DEFAULT_DND_SCHEDULE,
  nightLight: DEFAULT_NIGHT_LIGHT,
  autoDark: DEFAULT_AUTO_DARK,
  proxy: DEFAULT_MANUAL_PROXY,
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
    accent:
      typeof s.accent === "string" && /^#[0-9a-f]{6}$/i.test(s.accent)
        ? s.accent.toLowerCase()
        : null,
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
    panelFullWidth: s.panelFullWidth === true,
    panelIconsOnly: s.panelIconsOnly === true,
    wallpaper,
    indexingEnabled: s.indexingEnabled !== false,
    indexExcludes: normalizeIndexPaths(s.indexExcludes),
    indexIncludes: normalizeIndexPaths(s.indexIncludes).filter((entry) => entry.startsWith("/")),
    keyboard: normalizeKeyboardSettings(s.keyboard),
    pointer: normalizePointerSettings(s.pointer),
    region: normalizeRegionSettings(s.region),
    power: normalizePowerSettings(s.power),
    launcherPins: normalizeLauncherPins(s.launcherPins),
    notificationRules: normalizeNotificationRules(s.notificationRules),
    doNotDisturbSchedule: normalizeDndSchedule(s.doNotDisturbSchedule),
    nightLight: normalizeNightLight(s.nightLight),
    autoDark: normalizeAutoDark(s.autoDark),
    proxy: normalizeManualProxy(s.proxy),
  };
}

/** A hand-edited list keeps its usable entries; the cap keeps a bad file from costing much. */
const MAX_INDEX_PATHS = 256;
function normalizeIndexPaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry.length <= 4096 && !entry.includes("\0"));
  return [...new Set(entries)].slice(0, MAX_INDEX_PATHS);
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
