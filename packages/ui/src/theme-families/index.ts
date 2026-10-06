import type { PersonalizationProfile, ThemeFamily } from "#ui/personalization";
import type { WidgetTheme } from "#ui/widget-theme";
import { applyCupertinoWidgetTheme } from "./cupertino/index";
import { applyDesktopWidgetTheme } from "./desktop";

export type WidgetThemeFamilyDefinition = {
  id: ThemeFamily;
  label: string;
  apply: (theme: WidgetTheme, profile: PersonalizationProfile) => WidgetTheme;
};

const DEFINITIONS: Partial<Record<ThemeFamily, WidgetThemeFamilyDefinition>> = {
  redmond: {
    id: "redmond",
    label: "Redmond",
    apply: (theme) => applyDesktopWidgetTheme(theme, "redmond"),
  },
  plasmid: {
    id: "plasmid",
    label: "Plasmid",
    apply: (theme) => applyDesktopWidgetTheme(theme, "plasmid"),
  },
  gnomish: {
    id: "gnomish",
    label: "Gnomish",
    apply: (theme) => applyDesktopWidgetTheme(theme, "gnomish"),
  },
  cupertino: {
    id: "cupertino",
    label: "Cupertino",
    apply: applyCupertinoWidgetTheme,
  },
};

export const IMPLEMENTED_WIDGET_THEME_FAMILIES = Object.freeze(
  Object.keys(DEFINITIONS) as ThemeFamily[],
);

export function getWidgetThemeFamily(family: ThemeFamily): WidgetThemeFamilyDefinition | undefined {
  return DEFINITIONS[family];
}

export function applyWidgetThemeFamily(
  theme: WidgetTheme,
  profile: PersonalizationProfile,
): WidgetTheme {
  return getWidgetThemeFamily(profile.themeFamily)?.apply(theme, profile) ?? theme;
}
