import type { WidgetFoundations } from "#ui/widget-theme";
import { CUPERTINO_CONTROL_HEIGHTS } from "./constants";

export function cupertinoFoundations(source: WidgetFoundations): WidgetFoundations {
  return {
    ...source,
    radii: { small: 6, medium: 9, large: 13, window: 16 },
    controlHeights: CUPERTINO_CONTROL_HEIGHTS,
    focusRing: { width: 2, inset: 2, radiusOffset: 3 },
    motion: { fastMs: 120, normalMs: 180, slowMs: 280, easing: "ease-out" },
    elevation: {
      low: { blur: 10, offsetY: 2, opacity: 0.14 },
      medium: { blur: 24, offsetY: 8, opacity: 0.2 },
      high: { blur: 40, offsetY: 16, opacity: 0.28 },
    },
  };
}
