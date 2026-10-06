import type { WidgetTheme } from "#ui/widget-theme";
import { colorWithAlpha, mixColor } from "#ui/theme-family-color";
import { CUPERTINO_CONTROL_HEIGHTS, CUPERTINO_SIZES } from "./constants";

export type CupertinoFormRecipes = Pick<
  WidgetTheme["recipes"],
  "checkbox" | "toggle" | "slider" | "progressBar"
>;

export function cupertinoFormRecipes(source: WidgetTheme): CupertinoFormRecipes {
  const pal = source.foundations.palette;
  const checkbox = {} as WidgetTheme["recipes"]["checkbox"];
  const toggle = {} as WidgetTheme["recipes"]["toggle"];
  const slider = {} as WidgetTheme["recipes"]["slider"];
  const progressBar = {} as WidgetTheme["recipes"]["progressBar"];

  for (const size of CUPERTINO_SIZES) {
    const check = source.recipes.checkbox[size];
    checkbox[size] = {
      ...check,
      control: {
        ...check.control,
        base: {
          ...check.control.base,
          radius: Math.max(4, Math.round(check.metrics.controlSize * 0.28)),
        },
        states: {
          ...check.control.states,
          selected: { fill: pal.accent, stroke: pal.accent },
          focused: { stroke: pal.focusRing, strokeWidth: 2 },
        },
      },
      metrics: { ...check.metrics, height: CUPERTINO_CONTROL_HEIGHTS[size] },
    };

    const switchRecipe = source.recipes.toggle[size];
    const trackHeight = { small: 18, medium: 22, large: 26 }[size];
    const trackWidth = { small: 30, medium: 38, large: 44 }[size];
    const thumbInset = 2;
    const thumbSize = trackHeight - thumbInset * 2;
    toggle[size] = {
      ...switchRecipe,
      track: {
        ...switchRecipe.track,
        base: {
          ...switchRecipe.track.base,
          fill: mixColor(pal.surface, pal.muted, 0.22),
          radius: trackHeight / 2,
          stroke: colorWithAlpha(pal.border, 0x80),
        },
        states: {
          ...switchRecipe.track.states,
          selected: { fill: pal.accent, stroke: pal.accent },
          focused: { stroke: pal.focusRing, strokeWidth: 2 },
        },
      },
      thumb: {
        ...switchRecipe.thumb,
        base: {
          ...switchRecipe.thumb.base,
          radius: thumbSize / 2,
          stroke: colorWithAlpha(0xff000000, 0x20),
        },
      },
      metrics: {
        ...switchRecipe.metrics,
        height: CUPERTINO_CONTROL_HEIGHTS[size],
        trackWidth,
        trackHeight,
        thumbSize,
        thumbInset,
      },
    };

    const range = source.recipes.slider[size];
    const rangeThumb = { small: 12, medium: 14, large: 18 }[size];
    slider[size] = {
      ...range,
      fill: { ...range.fill, base: { ...range.fill.base, fill: pal.accent } },
      thumb: {
        ...range.thumb,
        base: {
          ...range.thumb.base,
          radius: rangeThumb / 2,
          stroke: colorWithAlpha(0xff000000, 0x28),
        },
      },
      metrics: { ...range.metrics, thumbSize: rangeThumb },
    };

    const progress = source.recipes.progressBar[size];
    progressBar[size] = {
      ...progress,
      track: {
        ...progress.track,
        fill: colorWithAlpha(pal.muted, 0x28),
        stroke: undefined,
        strokeWidth: 0,
      },
      fill: { ...progress.fill, fill: pal.accent },
    };
  }
  return { checkbox, toggle, slider, progressBar };
}
