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
  const theme = applyThemeFamily(
    loadTheme(bundledThemePath(settings.dark)),
    settings.themeFamily,
    settings.dark,
  );
  return settings.accent ? withAccent(theme, settings.accent) : theme;
}

/**
 * The person's accent over a style's: buttons, selection, focus and the accent line. Apps read
 * these tokens from the active theme, so one write recolours the shell and every app.
 */
function withAccent(theme: MoireTheme, accent: string): MoireTheme {
  return {
    ...theme,
    tokens: {
      ...theme.tokens,
      accent,
      accentLine: accent,
      focusRing: accent,
      selection: `${accent}66`,
    },
  };
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

export type ApplyResult = {
  settings: MoireSettings;
  theme: MoireTheme;
};

/**
 * Persist settings and apply them to the theme file and GTK. Live volume belongs to the
 * management service, which talks to PipeWire (`@moire/audio`).
 */
export function applySettings(settings: MoireSettings): ApplyResult {
  saveSettings(settings);
  const theme = writeActiveTheme(settings);
  applyGtkAppearance(settings.dark, settings.uiScale);
  console.log(
    `[prefs] applied dark=${settings.dark} scale=${settings.uiScale} notifs=${settings.notifications}`,
  );
  return { settings, theme };
}

function commandExists(bin: string): boolean {
  const r = spawnSync("sh", ["-c", `command -v ${bin}`], {
    encoding: "utf8",
  });
  return r.status === 0;
}
