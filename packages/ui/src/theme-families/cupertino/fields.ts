import type { WidgetTheme } from "#ui/widget-theme";
import { CUPERTINO_CONTROL_HEIGHTS, CUPERTINO_CONTROL_RADII, CUPERTINO_SIZES } from "./constants";

export type CupertinoFieldRecipes = Pick<WidgetTheme["recipes"], "textField" | "tabs">;

export function cupertinoFieldRecipes(source: WidgetTheme): CupertinoFieldRecipes {
  const pal = source.foundations.palette;
  const textField = {} as WidgetTheme["recipes"]["textField"];
  const tabs = {} as WidgetTheme["recipes"]["tabs"];
  for (const size of CUPERTINO_SIZES) {
    const radius = CUPERTINO_CONTROL_RADII[size];
    const field = source.recipes.textField[size];
    textField[size] = {
      ...field,
      root: {
        ...field.root,
        base: { ...field.root.base, radius, stroke: pal.border },
        states: { ...field.root.states, focused: { stroke: pal.focusRing, strokeWidth: 2 } },
      },
      metrics: { ...field.metrics, height: CUPERTINO_CONTROL_HEIGHTS[size] },
    };

    const tab = source.recipes.tabs[size];
    tabs[size] = {
      ...tab,
      root: {
        ...tab.root,
        fill: pal.panel,
        radius: radius + 1,
        stroke: pal.border,
        strokeWidth: 1,
      },
      tab: {
        ...tab.tab,
        base: { ...tab.tab.base, radius },
        states: {
          ...tab.tab.states,
          selected: { fill: pal.surface, stroke: pal.borderSubtle, strokeWidth: 1 },
          focused: { stroke: pal.focusRing, strokeWidth: 2 },
        },
      },
      label: {
        ...tab.label,
        states: { ...tab.label.states, selected: { color: pal.text, fontWeight: "medium" } },
      },
      indicator: { fill: 0x00000000, radius: 0 },
      divider: { fill: 0x00000000, height: 0 },
      metrics: { ...tab.metrics, height: CUPERTINO_CONTROL_HEIGHTS[size], indicatorHeight: 0 },
    };
  }
  return { textField, tabs };
}
