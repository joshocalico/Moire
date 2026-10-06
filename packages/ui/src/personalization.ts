import {
  applyThemeFamily,
  getTheme,
  THEME_FAMILIES,
  type ThemeFamily,
  type MoireTheme,
  type MoireTokens,
} from "@moire/theme";
export { THEME_FAMILIES } from "@moire/theme";
export type { ThemeFamily } from "@moire/theme";

export type ColorScheme = "light" | "dark";

export type PersonalizationProfile = {
  source: "moire" | "platform" | "environment" | "fallback" | "application";
  platform: string;
  colorScheme: ColorScheme;
  accent?: string;
  contrast: "normal" | "high";
  reducedMotion: boolean;
  reducedTransparency: boolean;
  fontScale: number;
  themeFamily: ThemeFamily;
  iconTheme?: string;
  cursorTheme?: string;
  availableThemeFamilies: readonly ThemeFamily[];
  availableAccents: readonly string[];
};

export type PersonalizationOverrides = Partial<
  Omit<PersonalizationProfile, "availableThemeFamilies" | "availableAccents">
>;

export const DISCOVERABLE_ACCENTS = [
  "#8a7aff",
  "#0a84ff",
  "#60cdff",
  "#3daee9",
  "#3584e4",
  "#bf5af2",
  "#ff9f0a",
] as const;

function boolEnv(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function validAccent(value: string | undefined): string | undefined {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined;
}

function inferFamily(platform: string, desktop: string): ThemeFamily {
  if (desktop.includes("moire")) return "moire";
  if (platform === "darwin") return "cupertino";
  if (platform === "win32") return "redmond";
  if (desktop.includes("kde") || desktop.includes("plasma")) return "plasmid";
  if (desktop.includes("gnome") || desktop.includes("gtk")) return "gnomish";
  return "moire";
}

function defaultAccent(family: ThemeFamily): string {
  if (family === "cupertino") return "#0a84ff";
  if (family === "redmond") return "#60cdff";
  if (family === "plasmid") return "#3daee9";
  if (family === "gnomish") return "#3584e4";
  return "#8a7aff";
}

/** Normalize the personalization visible to a platform backend. */
export function discoverPersonalization(
  platform: string = process.platform,
  overrides: PersonalizationOverrides = {},
): PersonalizationProfile {
  const desktop = [
    process.env.XDG_CURRENT_DESKTOP,
    process.env.XDG_SESSION_DESKTOP,
    process.env.DESKTOP_SESSION,
  ]
    .filter(Boolean)
    .join(":")
    .toLowerCase();
  const themeName = `${process.env.GTK_THEME ?? ""} ${process.env.MOIRE_THEME ?? ""}`.toLowerCase();
  const family = overrides.themeFamily ?? inferFamily(platform, desktop);
  const explicitScheme = process.env.MOIRE_COLOR_SCHEME?.trim().toLowerCase();
  const colorScheme =
    overrides.colorScheme ??
    (explicitScheme === "light" || explicitScheme === "dark"
      ? explicitScheme
      : themeName.includes("dark")
        ? "dark"
        : "dark");
  const moire = desktop.includes("moire") || boolEnv("MOIRE_SESSION");
  return {
    source: overrides.source ?? (moire ? "moire" : desktop ? "platform" : "environment"),
    platform: overrides.platform ?? (moire ? "moire" : platform),
    colorScheme,
    accent: overrides.accent ?? validAccent(process.env.MOIRE_ACCENT) ?? defaultAccent(family),
    contrast: overrides.contrast ?? (boolEnv("MOIRE_HIGH_CONTRAST") ? "high" : "normal"),
    reducedMotion: overrides.reducedMotion ?? boolEnv("MOIRE_REDUCE_MOTION"),
    reducedTransparency: overrides.reducedTransparency ?? boolEnv("MOIRE_REDUCE_TRANSPARENCY"),
    fontScale: Math.max(
      0.75,
      Math.min(2, overrides.fontScale ?? (Number(process.env.MOIRE_FONT_SCALE ?? 1) || 1)),
    ),
    themeFamily: family,
    iconTheme: overrides.iconTheme ?? process.env.ICON_THEME,
    cursorTheme: overrides.cursorTheme ?? process.env.XCURSOR_THEME,
    availableThemeFamilies: THEME_FAMILIES,
    availableAccents: DISCOVERABLE_ACCENTS,
  };
}

export function mergePersonalization(
  profile: PersonalizationProfile,
  overrides: PersonalizationOverrides = {},
): PersonalizationProfile {
  return {
    ...profile,
    ...overrides,
    fontScale: Math.max(0.75, Math.min(2, overrides.fontScale ?? profile.fontScale)),
    availableThemeFamilies: profile.availableThemeFamilies,
    availableAccents: profile.availableAccents,
  };
}

/** Derive renderer-neutral Moire tokens from a platform personalization profile. */
export function personalizeTheme(
  profile: PersonalizationProfile,
  base: MoireTheme = getTheme(),
): MoireTheme {
  const familyTheme = applyThemeFamily(base, profile.themeFamily, profile.colorScheme === "dark");
  const accent = profile.accent ?? familyTheme.tokens.accent;
  const tokens: MoireTokens = {
    ...familyTheme.tokens,
    accent,
    accentLine: accent,
    focusRing: accent,
    selection: `${accent}66`,
    ...(profile.contrast === "high"
      ? {
          border: profile.colorScheme === "light" ? "#202020" : "#f4f4f4",
          borderSubtle: profile.colorScheme === "light" ? "#505050" : "#b8b8b8",
        }
      : {}),
    ...(profile.reducedTransparency
      ? {
          panel: profile.colorScheme === "light" ? "#eceff3" : "#1e2329",
          overlay: profile.colorScheme === "light" ? "#ffffff" : "#0a0c0e",
        }
      : {}),
  };
  return {
    ...familyTheme,
    name: `${profile.themeFamily}-${profile.colorScheme}`,
    tokens,
  };
}
