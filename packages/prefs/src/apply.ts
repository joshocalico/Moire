/**
 * Apply Moire settings to the host (GTK, volume, active theme file).
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyThemeFamily, loadTheme, type MoireTheme, type WallpaperSpec } from "@moire/theme";
import {
  activeThemePath,
  configDir,
  type MoireSettings,
  type WallpaperSettings,
  saveSettings,
} from "./store";

function repoThemesRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  // packages/prefs/src → repo themes/
  return path.resolve(here, "../../../themes");
}

export function bundledThemePath(dark: boolean): string {
  return path.join(repoThemesRoot(), dark ? "default" : "light", "theme.json");
}

export function themeForSettings(settings: MoireSettings): MoireTheme {
  return applyThemeFamily(
    loadTheme(bundledThemePath(settings.dark)),
    settings.themeFamily,
    settings.dark,
  );
}

function settingsWallpaperToSpec(wp: WallpaperSettings, theme: MoireTheme): WallpaperSpec {
  if (wp.mode === "atmosphere") return { mode: "atmosphere" };
  if (wp.mode === "gradient") {
    return { mode: "gradient", from: theme.tokens.bg, to: theme.tokens.accentLine };
  }
  if (wp.mode === "solid") return { mode: "solid", color: theme.tokens.bg };
  if (wp.mode === "image" && wp.path) return { mode: "image", path: wp.path };
  return { mode: "atmosphere" };
}

/** Write ~/.config/moire/active-theme.json for compositor/shell to load. */
export function writeActiveTheme(settings: MoireSettings): MoireTheme {
  const base = themeForSettings(settings);
  const theme: MoireTheme = settings.wallpaper
    ? { ...base, wallpaper: settingsWallpaperToSpec(settings.wallpaper, base) }
    : base;
  fs.mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  const out = `${JSON.stringify(theme, null, 2)}\n`;
  const dest = activeThemePath();
  try {
    if (fs.readFileSync(dest, "utf8") === out) return theme;
  } catch {
    // missing — write
  }
  fs.writeFileSync(dest, out, "utf8");
  return theme;
}

export function applyGtkAppearance(dark: boolean, uiScale: number): void {
  const preferDark = dark ? "true" : "false";
  const fontPt = Math.max(8, Math.round(10 * uiScale));
  const font = `Sans ${fontPt}`;
  const ini = `[Settings]
gtk-theme-name=Moire
gtk-application-prefer-dark-theme=${preferDark}
gtk-icon-theme-name=Adwaita
gtk-cursor-theme-name=Adwaita
gtk-font-name=${font}
gtk-decoration-layout=close,minimize,maximize:
`;
  const home = process.env.HOME ?? "";
  for (const ver of ["gtk-3.0", "gtk-4.0"]) {
    const dir = path.join(home, ".config", ver);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "settings.ini"), ini, "utf8");
    } catch (err) {
      console.warn(`[prefs] gtk ${ver} write failed:`, err);
    }
  }

  if (commandExists("gsettings")) {
    try {
      execFileSync(
        "gsettings",
        [
          "set",
          "org.gnome.desktop.interface",
          "color-scheme",
          dark ? "prefer-dark" : "prefer-light",
        ],
        { stdio: "ignore" },
      );
      execFileSync("gsettings", ["set", "org.gnome.desktop.interface", "gtk-theme", "Moire"], {
        stdio: "ignore",
      });
      execFileSync("gsettings", ["set", "org.gnome.desktop.interface", "font-name", font], {
        stdio: "ignore",
      });
    } catch {
      // gsettings optional
    }
  }
}

export function readSystemVolume(): number | null {
  if (commandExists("wpctl")) {
    try {
      const out = execFileSync("wpctl", ["get-volume", "@DEFAULT_AUDIO_SINK@"], {
        encoding: "utf8",
      });
      // "Volume: 0.70" or "Volume: 0.70 [MUTED]"
      const m = out.match(/Volume:\s*([0-9.]+)/);
      if (m) return Math.min(1, Math.max(0, Number(m[1])));
    } catch {
      // ignore
    }
  }
  if (commandExists("pactl")) {
    try {
      const out = execFileSync("pactl", ["get-sink-volume", "@DEFAULT_SINK@"], {
        encoding: "utf8",
      });
      const m = out.match(/(\d+)%/);
      if (m) return Math.min(1, Math.max(0, Number(m[1]) / 100));
    } catch {
      // ignore
    }
  }
  return null;
}

export function applyVolume(volume: number): { ok: boolean; detail: string } {
  const pct = Math.round(Math.min(1, Math.max(0, volume)) * 100);
  if (commandExists("wpctl")) {
    try {
      execFileSync("wpctl", ["get-volume", "@DEFAULT_AUDIO_SINK@"], {
        stdio: "ignore",
      });
    } catch {
      return { ok: false, detail: "wpctl: no default audio sink" };
    }
    try {
      execFileSync("wpctl", ["set-volume", "@DEFAULT_AUDIO_SINK@", `${pct}%`], { stdio: "ignore" });
      return { ok: true, detail: `wpctl ${pct}%` };
    } catch (err) {
      return { ok: false, detail: `wpctl failed: ${String(err)}` };
    }
  }
  if (commandExists("pactl")) {
    try {
      execFileSync("pactl", ["set-sink-volume", "@DEFAULT_SINK@", `${pct}%`], { stdio: "ignore" });
      return { ok: true, detail: `pactl ${pct}%` };
    } catch (err) {
      return { ok: false, detail: `pactl failed: ${String(err)}` };
    }
  }
  return {
    ok: false,
    detail: "no wpctl/pactl (volume saved; install PipeWire for live apply)",
  };
}

export type ApplyResult = {
  settings: MoireSettings;
  theme: MoireTheme;
  volume: { ok: boolean; detail: string };
};

/** Persist settings and apply to theme file, GTK, and audio. */
export function applySettings(settings: MoireSettings): ApplyResult {
  saveSettings(settings);
  const theme = writeActiveTheme(settings);
  applyGtkAppearance(settings.dark, settings.uiScale);
  const volume = applyVolume(settings.volume);
  console.log(
    `[prefs] applied dark=${settings.dark} scale=${settings.uiScale} notifs=${settings.notifications} volume=${volume.detail}`,
  );
  return { settings, theme, volume };
}

function commandExists(bin: string): boolean {
  const r = spawnSync("sh", ["-c", `command -v ${bin}`], {
    encoding: "utf8",
  });
  return r.status === 0;
}
