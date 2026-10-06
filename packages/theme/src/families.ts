import type { MoireTheme, MoireTokens } from "./index";

export const THEME_FAMILIES = ["moire", "cupertino", "redmond", "plasmid", "gnomish"] as const;
export type ThemeFamily = (typeof THEME_FAMILIES)[number];

export function parseThemeFamily(value: unknown): ThemeFamily {
  switch (value) {
    case "cupertino":
    case "redmond":
    case "plasmid":
    case "gnomish":
      return value;
    default:
      return "moire";
  }
}

export const THEME_FAMILY_LABELS: Record<ThemeFamily, string> = {
  moire: "Moire",
  cupertino: "Cupertino",
  redmond: "Redmond",
  plasmid: "Plasmid",
  gnomish: "Gnomish",
};

type FamilyDesign = {
  accent: string;
  dark: Pick<MoireTokens, "bg" | "panel" | "titlebar" | "surface" | "hover" | "border">;
  light: Pick<MoireTokens, "bg" | "panel" | "titlebar" | "surface" | "hover" | "border">;
  radius: number;
  windowRadius: number;
  titlebarHeight: number;
  panelHeight: number;
};

const DESIGNS: Record<ThemeFamily, FamilyDesign> = {
  moire: {
    accent: "#8a7aff",
    radius: 8,
    windowRadius: 14,
    titlebarHeight: 40,
    panelHeight: 56,
    dark: {
      bg: "#0d0e13",
      panel: "#1a1b24",
      titlebar: "#171820",
      surface: "#242633",
      hover: "#2e2f3e",
      border: "#454456",
    },
    light: {
      bg: "#f4f2fa",
      panel: "#eeebf5",
      titlebar: "#faf9fd",
      surface: "#ffffff",
      hover: "#e8e3f4",
      border: "#c9c2d8",
    },
  },
  cupertino: {
    accent: "#0a84ff",
    radius: 9,
    windowRadius: 16,
    titlebarHeight: 40,
    panelHeight: 62,
    dark: {
      bg: "#161617",
      panel: "#242426",
      titlebar: "#29292c",
      surface: "#333337",
      hover: "#3d3d42",
      border: "#4b4b50",
    },
    light: {
      bg: "#f5f5f7",
      panel: "#e8e8ed",
      titlebar: "#f1f1f4",
      surface: "#ffffff",
      hover: "#e4e4eb",
      border: "#c6c6ce",
    },
  },
  redmond: {
    accent: "#60cdff",
    radius: 5,
    windowRadius: 8,
    titlebarHeight: 38,
    panelHeight: 56,
    dark: {
      bg: "#17191d",
      panel: "#202329",
      titlebar: "#24272e",
      surface: "#2d3139",
      hover: "#363c46",
      border: "#484d58",
    },
    light: {
      bg: "#f5f7fb",
      panel: "#e9edf5",
      titlebar: "#f1f4fa",
      surface: "#ffffff",
      hover: "#e0e7f1",
      border: "#c8d0dc",
    },
  },
  plasmid: {
    accent: "#3daee9",
    radius: 4,
    windowRadius: 7,
    titlebarHeight: 34,
    panelHeight: 48,
    dark: {
      bg: "#1b1e20",
      panel: "#232629",
      titlebar: "#2a2e32",
      surface: "#31363b",
      hover: "#3b4248",
      border: "#58636c",
    },
    light: {
      bg: "#fcfcfc",
      panel: "#eff0f1",
      titlebar: "#eff0f1",
      surface: "#ffffff",
      hover: "#ddeaf3",
      border: "#b7c0c7",
    },
  },
  gnomish: {
    accent: "#3584e4",
    radius: 10,
    windowRadius: 14,
    titlebarHeight: 46,
    panelHeight: 54,
    dark: {
      bg: "#202023",
      panel: "#28282c",
      titlebar: "#303034",
      surface: "#38383e",
      hover: "#46464e",
      border: "#515159",
    },
    light: {
      bg: "#fafafa",
      panel: "#ebebef",
      titlebar: "#f6f6f8",
      surface: "#ffffff",
      hover: "#e4e4eb",
      border: "#c9c9d0",
    },
  },
};

/** Share family colors and chrome metrics between the shell and native apps. */
export function applyThemeFamily(base: MoireTheme, family: ThemeFamily, dark: boolean): MoireTheme {
  const design = DESIGNS[family];
  const colors = dark ? design.dark : design.light;
  const accent = !dark && family === "redmond" ? "#0067c0" : design.accent;
  return {
    ...base,
    family,
    name: `${family}-${dark ? "dark" : "light"}`,
    tokens: {
      ...base.tokens,
      ...colors,
      titlebarInactive: colors.panel,
      accent,
      accentLine: accent,
      focusRing: accent,
      selection: `${accent}38`,
      text: dark ? "#e4e7f1" : "#20212a",
      muted: dark ? "#a1a4b7" : "#626775",
      pressed: colors.panel,
      borderSubtle: dark ? "#30323d" : "#dcdfe6",
      overlay: dark ? `${colors.bg}f5` : "#fffffff5",
      danger: dark ? "#ff7eb6" : "#c42b48",
      radiusSm: Math.max(3, design.radius - 3),
      radiusMd: design.radius,
      radiusLg: design.radius + 4,
      radiusWindow: design.windowRadius,
      titlebarHeight: design.titlebarHeight,
      panelHeight: design.panelHeight,
    },
    wallpaper:
      family === "moire"
        ? base.wallpaper
        : {
            mode: "gradient",
            from: dark ? "#0f131c" : "#dce7f5",
            to: dark ? `${accent}` : "#f4f7fb",
            mid: colors.bg,
            midAt: 0.72,
          },
  };
}

/** Positions are shared by painted chrome and compositor hit testing. */
export function windowControlLayout(width: number, family: ThemeFamily = "moire") {
  if (family === "cupertino")
    return { closeX: 8, minX: 36, maxX: 64, titleX: 106, titleEnd: width - 16 };
  const closeX = width - 34;
  return { closeX, maxX: closeX - 32, minX: closeX - 64, titleX: 30, titleEnd: closeX - 76 };
}
