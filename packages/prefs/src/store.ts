/**
 * Moire user preferences — ~/.config/moire/settings.json
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export type MoireSettings = {
  /** Prefer dark tokens + GTK dark scheme. */
  dark: boolean;
  /** Desktop notification preference (future toast daemon). */
  notifications: boolean;
  /** UI scale factor (1.0 = 100%). Shell/compositor may honor later. */
  uiScale: number;
  /** Last requested sink volume 0..1 (also applied via wpctl/pactl when available). */
  volume: number;
};

export const DEFAULT_SETTINGS: MoireSettings = {
  dark: true,
  notifications: true,
  uiScale: 1,
  volume: 0.7,
};

export function configDir(): string {
  const base =
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
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
  return {
    dark: !!s.dark,
    notifications: !!s.notifications,
    uiScale: clamp(Number(s.uiScale) || 1, 0.75, 2),
    volume: clamp(Number(s.volume) || 0, 0, 1),
  };
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
