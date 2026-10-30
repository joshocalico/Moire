/**
 * Appearance's pure parts: the accent choices, each style's own palette, what each wallpaper
 * looks like in a thumbnail and the preview, and the words for a change.
 */
import {
  DEFAULT_SETTINGS,
  themeForSettings,
  type MoireSettings,
  type WallpaperSettings,
} from "@moire/prefs";
import {
  THEME_FAMILY_LABELS,
  hexToArgb as tokenColor,
  themePalette,
  type ThemeFamily,
  type ThemePalette,
  type WallpaperSpec,
} from "@moire/theme";
import { mixColor, type DesktopPreviewWallpaper } from "@moire/ui";

/** The style's own accent first, then fixed colours that read on light and dark surfaces. */
export const ACCENTS = [
  { id: "default", hex: null, label: "Style accent" },
  { id: "blue", hex: "#5aa2f0", label: "Blue" },
  { id: "teal", hex: "#2fbfb3", label: "Teal" },
  { id: "green", hex: "#3ecf8e", label: "Green" },
  { id: "yellow", hex: "#e3b341", label: "Yellow" },
  { id: "orange", hex: "#e8915a", label: "Orange" },
  { id: "red", hex: "#ef6b6b", label: "Red" },
  { id: "pink", hex: "#e86a9b", label: "Pink" },
  { id: "slate", hex: "#8a94a6", label: "Slate" },
] as const;
export type AccentId = (typeof ACCENTS)[number]["id"];

export function hexToArgb(hex: string): number {
  return (0xff000000 | Number.parseInt(hex.slice(1), 16)) >>> 0;
}

/** Which swatch an accent pref shows; a hand-edited colour not offered here selects none. */
export function accentId(accent: string | null): AccentId | null {
  if (!accent) return "default";
  return ACCENTS.find((entry) => entry.hex === accent)?.id ?? null;
}

const styles = new Map<string, { palette: ThemePalette; wallpaper: WallpaperSpec }>();

/** A style in a scheme, read once: reading it loads the bundled theme file. */
function style(family: ThemeFamily, dark: boolean) {
  const key = `${family}:${dark}`;
  let found = styles.get(key);
  if (!found) {
    const theme = themeForSettings({ ...DEFAULT_SETTINGS, themeFamily: family, dark });
    found = { palette: themePalette(theme), wallpaper: theme.wallpaper };
    styles.set(key, found);
  }
  return found;
}

export function familyPalette(family: ThemeFamily, dark: boolean): ThemePalette {
  return style(family, dark).palette;
}

/** The palette the person's choices make: their style and scheme with their accent. */
export function chosenPalette(values: Pick<MoireSettings, "themeFamily" | "dark" | "accent">) {
  const palette = familyPalette(values.themeFamily, values.dark);
  if (!values.accent) return palette;
  const accent = hexToArgb(values.accent);
  return { ...palette, accent, accentLine: accent };
}

export type WallpaperChoice = "theme" | "atmosphere" | "gradient" | "solid" | "image";

export function wallpaperChoice(wallpaper: WallpaperSettings | null): WallpaperChoice {
  if (!wallpaper) return "theme";
  return wallpaper.mode === "image" && !wallpaper.path ? "theme" : wallpaper.mode;
}

const ATMOSPHERE = [0xff1d2b4a, 0xff6a4fb0, 0xffe58f6a] as const;

/** What a wallpaper spec looks like in a thumbnail or the preview. */
function specPicture(spec: WallpaperSpec, palette: ThemePalette): DesktopPreviewWallpaper {
  switch (spec.mode) {
    case "image":
      return { kind: "image", path: spec.path };
    case "atmosphere":
      return { kind: "colors", colors: ATMOSPHERE };
    case "solid": {
      const color = spec.color ? tokenColor(spec.color) : palette.bg;
      return { kind: "colors", colors: [color, color, color] };
    }
    case "gradient": {
      const from = tokenColor(spec.from);
      const to = tokenColor(spec.to);
      return {
        kind: "colors",
        colors: [from, spec.mid ? tokenColor(spec.mid) : mixColor(from, to, 0.5), to],
      };
    }
  }
}

/** A wallpaper choice as it would look with the person's style, scheme and accent. */
export function wallpaperPicture(
  choice: WallpaperChoice,
  values: Pick<MoireSettings, "themeFamily" | "dark" | "wallpaper">,
  palette: ThemePalette,
): DesktopPreviewWallpaper {
  switch (choice) {
    case "theme":
      return specPicture(style(values.themeFamily, values.dark).wallpaper, palette);
    case "image":
      return values.wallpaper?.path
        ? { kind: "image", path: values.wallpaper.path }
        : specPicture(style(values.themeFamily, values.dark).wallpaper, palette);
    case "atmosphere":
      return { kind: "colors", colors: ATMOSPHERE };
    case "gradient":
      // As the compositor paints it: the background down to the accent line.
      return {
        kind: "colors",
        colors: [palette.bg, mixColor(palette.bg, palette.accentLine, 0.5), palette.accentLine],
      };
    case "solid":
      return { kind: "colors", colors: [palette.bg, palette.bg, palette.bg] };
  }
}

export const WALLPAPER_LABELS: Record<WallpaperChoice, string> = {
  theme: "Style default",
  atmosphere: "Atmosphere",
  gradient: "Gradient",
  solid: "Solid",
  image: "Picture",
};

/** The prefs value a thumbnail stands for. */
export function wallpaperSetting(
  choice: Exclude<WallpaperChoice, "image">,
): WallpaperSettings | null {
  return choice === "theme" ? null : { mode: choice };
}

export function styleLabel(family: ThemeFamily): string {
  return THEME_FAMILY_LABELS[family];
}

/** Slider position 0..1 for an interface size 0.75..2, and back. */
export const sliderFromScale = (scale: number) => Math.max(0, Math.min(1, (scale - 0.75) / 1.25));
export const scaleFromSlider = (value: number) =>
  Math.round((0.75 + Math.max(0, Math.min(1, value)) * 1.25) * 20) / 20;
