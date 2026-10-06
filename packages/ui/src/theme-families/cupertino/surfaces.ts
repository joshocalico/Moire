import type { WidgetTheme } from "#ui/widget-theme";
import { colorWithAlpha, foregroundOn } from "#ui/theme-family-color";
import { CUPERTINO_SIZES } from "./constants";

export type CupertinoSurfaceRecipes = Pick<
  WidgetTheme["recipes"],
  "scrollArea" | "menu" | "dialog"
>;

export function cupertinoSurfaceRecipes(source: WidgetTheme): CupertinoSurfaceRecipes {
  const pal = source.foundations.palette;
  const scrollArea = {} as WidgetTheme["recipes"]["scrollArea"];
  const menu = {} as WidgetTheme["recipes"]["menu"];
  const dialog = {} as WidgetTheme["recipes"]["dialog"];

  for (const size of CUPERTINO_SIZES) {
    const scroll = source.recipes.scrollArea[size];
    scrollArea[size] = {
      ...scroll,
      track: { ...scroll.track, base: { ...scroll.track.base, fill: 0x00000000 } },
      thumb: {
        ...scroll.thumb,
        base: { ...scroll.thumb.base, fill: colorWithAlpha(pal.muted, 0x72) },
      },
      metrics: {
        ...scroll.metrics,
        scrollbarWidth: { small: 5, medium: 6, large: 8 }[size],
        scrollbarMargin: 3,
      },
    };

    const menuRecipe = source.recipes.menu[size];
    menu[size] = {
      ...menuRecipe,
      surface: { ...menuRecipe.surface, fill: pal.overlay, radius: 12 },
      shadow: { ...menuRecipe.shadow, radius: 14 },
      item: {
        ...menuRecipe.item,
        base: { ...menuRecipe.item.base, radius: 6 },
        states: { ...menuRecipe.item.states, selected: { fill: pal.accent } },
      },
      label: {
        ...menuRecipe.label,
        states: { ...menuRecipe.label.states, selected: { color: foregroundOn(pal.accent) } },
      },
      description: {
        ...menuRecipe.description,
        states: { ...menuRecipe.description.states, selected: { color: foregroundOn(pal.accent) } },
      },
      leadingIcon: {
        ...menuRecipe.leadingIcon,
        states: { ...menuRecipe.leadingIcon.states, selected: { color: foregroundOn(pal.accent) } },
      },
      trailingText: {
        ...menuRecipe.trailingText,
        states: {
          ...menuRecipe.trailingText.states,
          selected: { color: foregroundOn(pal.accent) },
        },
      },
    };

    const dialogRecipe = source.recipes.dialog[size];
    dialog[size] = {
      ...dialogRecipe,
      surface: { ...dialogRecipe.surface, fill: pal.overlay, radius: 14 },
      titlebar: { ...dialogRecipe.titlebar, radius: 14 },
      metrics: {
        ...dialogRecipe.metrics,
        titlebarHeight: { small: 36, medium: 42, large: 50 }[size],
      },
    };
  }
  return { scrollArea, menu, dialog };
}
