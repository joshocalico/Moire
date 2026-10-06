import type { PersonalizationProfile } from "#ui/personalization";
import { colorWithAlpha, foregroundOn, mixColor, mixControlFill } from "#ui/theme-family-color";
import type {
  ButtonRecipe,
  ButtonSize,
  ButtonVariant,
  IconButtonRecipe,
  WidgetTheme,
} from "#ui/widget-theme";
import {
  CUPERTINO_BUTTON_VARIANTS,
  CUPERTINO_CONTROL_HEIGHTS,
  CUPERTINO_CONTROL_RADII,
  CUPERTINO_ICON_VARIANTS,
  CUPERTINO_SIZES,
} from "./constants";

export type CupertinoButtonRecipes = Pick<WidgetTheme["recipes"], "button" | "iconButton">;

function buttonRecipe(
  source: ButtonRecipe,
  variant: ButtonVariant,
  size: ButtonSize,
  theme: WidgetTheme,
  profile: PersonalizationProfile,
): ButtonRecipe {
  const pal = theme.foundations.palette;
  const primary = variant === "primary";
  const danger = variant === "danger";
  const ghost = variant === "ghost";
  const fill = primary ? pal.accent : danger ? pal.danger : ghost ? 0x00000000 : pal.surface;
  const foreground = primary || danger ? foregroundOn(fill) : ghost ? pal.accent : pal.text;
  const pressedTarget = profile.colorScheme === "dark" ? 0xff000000 : 0xffffffff;
  const stroke = primary || danger || ghost ? undefined : pal.border;
  return {
    ...source,
    root: {
      base: {
        ...source.root.base,
        fill,
        radius: CUPERTINO_CONTROL_RADII[size],
        stroke,
        strokeWidth: stroke == null ? 0 : 1,
      },
      states: {
        ...source.root.states,
        hover: {
          fill: ghost
            ? colorWithAlpha(pal.accent, 0x18)
            : (primary || danger ? mixControlFill : mixColor)(
                fill,
                profile.colorScheme === "dark" ? 0xffffffff : 0xff000000,
                0.08,
              ),
        },
        pressed: {
          fill: ghost
            ? colorWithAlpha(pal.accent, 0x2e)
            : (primary || danger ? mixControlFill : mixColor)(fill, pressedTarget, 0.16),
        },
        focused: { stroke: pal.focusRing, strokeWidth: 2 },
        disabled: {
          fill: ghost ? 0x00000000 : colorWithAlpha(fill, 0x60),
          stroke: stroke == null ? undefined : colorWithAlpha(stroke, 0x50),
        },
      },
    },
    label: {
      ...source.label,
      base: { ...source.label.base, color: foreground, fontWeight: "medium" },
    },
    leadingIcon: {
      ...source.leadingIcon,
      base: { ...source.leadingIcon.base, color: foreground },
    },
    trailingIcon: {
      ...source.trailingIcon,
      base: { ...source.trailingIcon.base, color: foreground },
    },
    metrics: {
      ...source.metrics,
      height: CUPERTINO_CONTROL_HEIGHTS[size],
      paddingX: { small: 10, medium: 12, large: 15 }[size],
    },
    rim: primary ? { color: colorWithAlpha(0xffffffff, 0x24), width: 1 } : undefined,
  };
}

function iconButtonRecipe(
  source: IconButtonRecipe,
  size: ButtonSize,
  theme: WidgetTheme,
): IconButtonRecipe {
  const controlSize = CUPERTINO_CONTROL_HEIGHTS[size];
  return {
    ...source,
    root: {
      ...source.root,
      base: { ...source.root.base, radius: controlSize / 2 },
      states: {
        ...source.root.states,
        focused: { stroke: theme.foundations.palette.focusRing, strokeWidth: 2 },
      },
    },
    metrics: { size: controlSize },
  };
}

export function cupertinoButtonRecipes(
  source: WidgetTheme,
  profile: PersonalizationProfile,
): CupertinoButtonRecipes {
  const button = {} as WidgetTheme["recipes"]["button"];
  const iconButton = {} as WidgetTheme["recipes"]["iconButton"];
  for (const variant of CUPERTINO_BUTTON_VARIANTS) {
    button[variant] = {} as Record<ButtonSize, ButtonRecipe>;
    for (const size of CUPERTINO_SIZES) {
      button[variant][size] = buttonRecipe(
        source.recipes.button[variant][size],
        variant,
        size,
        source,
        profile,
      );
    }
  }
  for (const variant of CUPERTINO_ICON_VARIANTS) {
    iconButton[variant] = {} as Record<ButtonSize, IconButtonRecipe>;
    for (const size of CUPERTINO_SIZES) {
      iconButton[variant][size] = iconButtonRecipe(
        source.recipes.iconButton[variant][size],
        size,
        source,
      );
    }
  }
  return { button, iconButton };
}
