import React, {
  createContext,
  useContext,
  type ReactNode,
} from "react";
import {
  SPACE,
  TYPE_ROLES,
  getTheme,
  themePalette,
  type MoireTheme,
  type ThemePalette,
} from "./theme.js";

export type WidgetState =
  | "rest"
  | "hover"
  | "pressed"
  | "focused"
  | "disabled"
  | "selected"
  | "danger";

export type StatefulStyle<T extends object> = {
  base: T;
  states?: Partial<Record<WidgetState, Partial<T>>>;
};

export type WidgetBoxStyle = {
  fill: number;
  radius: number;
  stroke?: number;
  strokeWidth?: number;
};

export type WidgetTextStyle = {
  color: number;
  fontSize: number;
  fontWeight: "regular" | "medium" | "bold";
};

export type WidgetIconStyle = {
  color: number;
  size: number;
};

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "small" | "medium" | "large";

export type ButtonRecipe = {
  root: StatefulStyle<WidgetBoxStyle>;
  label: StatefulStyle<WidgetTextStyle>;
  leadingIcon: StatefulStyle<WidgetIconStyle>;
  trailingIcon: StatefulStyle<WidgetIconStyle>;
  metrics: {
    height: number;
    paddingX: number;
    gap: number;
  };
  rim?: {
    color: number;
    width: number;
  };
};

export type WidgetFoundations = {
  palette: ThemePalette;
  type: typeof TYPE_ROLES;
  space: typeof SPACE;
  radii: {
    small: number;
    medium: number;
    large: number;
    window: number;
  };
  motion: {
    fastMs: number;
    normalMs: number;
    slowMs: number;
    easing: "ease-out";
  };
  elevation: {
    low: { blur: number; offsetY: number; opacity: number };
    medium: { blur: number; offsetY: number; opacity: number };
    high: { blur: number; offsetY: number; opacity: number };
  };
};

export type WidgetTheme = {
  name: string;
  foundations: WidgetFoundations;
  recipes: {
    button: Record<ButtonVariant, Record<ButtonSize, ButtonRecipe>>;
  };
};

function channel(color: number, shift: number): number {
  return (color >>> shift) & 0xff;
}

function mixArgb(from: number, to: number, amount: number): number {
  const mix = (a: number, b: number) =>
    Math.round(a + (b - a) * Math.max(0, Math.min(1, amount)));
  return (
    (mix(channel(from, 24), channel(to, 24)) << 24) |
    (mix(channel(from, 16), channel(to, 16)) << 16) |
    (mix(channel(from, 8), channel(to, 8)) << 8) |
    mix(channel(from, 0), channel(to, 0))
  ) >>> 0;
}

function withAlpha(color: number, alpha: number): number {
  return (((alpha & 0xff) << 24) | (color & 0x00ffffff)) >>> 0;
}

function buttonSize(
  size: ButtonSize,
  palette: ThemePalette,
): Pick<ButtonRecipe, "metrics" | "label" | "leadingIcon" | "trailingIcon"> {
  const values = {
    small: { height: 28, paddingX: 10, gap: 6, fontSize: 12, iconSize: 14 },
    medium: { height: 34, paddingX: 12, gap: 8, fontSize: 13, iconSize: 16 },
    large: { height: 40, paddingX: 16, gap: 8, fontSize: 14, iconSize: 18 },
  }[size];
  const label: StatefulStyle<WidgetTextStyle> = {
    base: {
      color: palette.text,
      fontSize: values.fontSize,
      fontWeight: "medium",
    },
    states: { disabled: { color: palette.muted } },
  };
  const icon: StatefulStyle<WidgetIconStyle> = {
    base: { color: palette.text, size: values.iconSize },
    states: { disabled: { color: palette.muted } },
  };
  return {
    metrics: {
      height: values.height,
      paddingX: values.paddingX,
      gap: values.gap,
    },
    label,
    leadingIcon: icon,
    trailingIcon: icon,
  };
}

function buttonRecipe(
  variant: ButtonVariant,
  size: ButtonSize,
  palette: ThemePalette,
): ButtonRecipe {
  const sized = buttonSize(size, palette);
  const radius = size === "large" ? palette.radiusMd : palette.radiusSm;
  let fill = palette.surface;
  let hover = palette.hover;
  let pressed = palette.pressed;
  let label = palette.text;
  let stroke: number | undefined = palette.borderSubtle;
  let rim = true;

  if (variant === "primary") {
    fill = palette.accentLine;
    hover = mixArgb(palette.accentLine, palette.accent, 0.24);
    pressed = mixArgb(palette.accentLine, palette.bg, 0.24);
    label = 0xffffffff;
    stroke = mixArgb(palette.accentLine, palette.accent, 0.4);
  } else if (variant === "ghost") {
    fill = 0x00000000;
    hover = withAlpha(palette.hover, 0xc0);
    pressed = withAlpha(palette.pressed, 0xe0);
    stroke = undefined;
    rim = false;
  } else if (variant === "danger") {
    fill = palette.danger;
    hover = mixArgb(palette.danger, 0xffffffff, 0.12);
    pressed = mixArgb(palette.danger, palette.bg, 0.24);
    label = 0xffffffff;
    stroke = mixArgb(palette.danger, palette.bg, 0.18);
    rim = false;
  }

  const root: StatefulStyle<WidgetBoxStyle> = {
    base: { fill, radius, stroke, strokeWidth: stroke == null ? 0 : 1 },
    states: {
      hover: { fill: hover },
      pressed: { fill: pressed },
      focused: { stroke: palette.focusRing, strokeWidth: 1 },
      disabled: {
        fill: variant === "ghost" ? 0x00000000 : withAlpha(fill, 0x70),
        stroke: variant === "ghost" ? undefined : withAlpha(stroke ?? fill, 0x50),
      },
    },
  };
  const labelStyle: StatefulStyle<WidgetTextStyle> = {
    ...sized.label,
    base: { ...sized.label.base, color: label },
  };
  const iconStyle: StatefulStyle<WidgetIconStyle> = {
    ...sized.leadingIcon,
    base: { ...sized.leadingIcon.base, color: label },
  };
  return {
    ...sized,
    root,
    label: labelStyle,
    leadingIcon: iconStyle,
    trailingIcon: iconStyle,
    rim: rim ? { color: palette.rimLight, width: 1 } : undefined,
  };
}

export function resolveStatefulStyle<T extends object>(
  style: StatefulStyle<T>,
  ...states: WidgetState[]
): T {
  const resolved = { ...style.base };
  for (const state of states) {
    const override = style.states?.[state];
    if (override) Object.assign(resolved, override);
  }
  return resolved;
}

export function createWidgetTheme(theme: MoireTheme = getTheme()): WidgetTheme {
  const palette = themePalette(theme);
  const variants: ButtonVariant[] = ["primary", "secondary", "ghost", "danger"];
  const sizes: ButtonSize[] = ["small", "medium", "large"];
  const button = {} as WidgetTheme["recipes"]["button"];
  for (const variant of variants) {
    button[variant] = {} as Record<ButtonSize, ButtonRecipe>;
    for (const size of sizes) {
      button[variant][size] = buttonRecipe(variant, size, palette);
    }
  }
  return {
    name: `${theme.name}-widgets`,
    foundations: {
      palette,
      type: TYPE_ROLES,
      space: SPACE,
      radii: {
        small: palette.radiusSm,
        medium: palette.radiusMd,
        large: palette.radiusLg,
        window: palette.radiusWindow,
      },
      motion: {
        fastMs: 90,
        normalMs: 150,
        slowMs: 240,
        easing: "ease-out",
      },
      elevation: {
        low: { blur: 8, offsetY: 2, opacity: 0.18 },
        medium: { blur: 18, offsetY: 6, opacity: 0.24 },
        high: { blur: 32, offsetY: 12, opacity: 0.32 },
      },
    },
    recipes: { button },
  };
}

let fallbackSource: MoireTheme | null = null;
let fallbackTheme: WidgetTheme | null = null;

export function getWidgetTheme(): WidgetTheme {
  const source = getTheme();
  if (source !== fallbackSource || !fallbackTheme) {
    fallbackSource = source;
    fallbackTheme = createWidgetTheme(source);
  }
  return fallbackTheme;
}

const WidgetThemeContext = createContext<WidgetTheme | null>(null);

export type WidgetThemeProviderProps = {
  theme: WidgetTheme;
  children?: ReactNode;
};

export function WidgetThemeProvider(
  props: WidgetThemeProviderProps,
): ReactNode {
  return (
    <WidgetThemeContext.Provider value={props.theme}>
      {props.children}
    </WidgetThemeContext.Provider>
  );
}

export function useWidgetTheme(): WidgetTheme {
  return useContext(WidgetThemeContext) ?? getWidgetTheme();
}
