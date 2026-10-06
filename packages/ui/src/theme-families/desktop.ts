import type { ThemeFamily } from "#ui/personalization";
import type { ButtonRecipe, ButtonSize, ButtonVariant, WidgetTheme } from "#ui/widget-theme";
import { colorWithAlpha, foregroundOn, mixColor, mixControlFill } from "./color";

type DesktopFamily = Extract<ThemeFamily, "redmond" | "plasmid" | "gnomish">;
type Design = {
  heights: Record<ButtonSize, number>;
  radius: number;
  padding: number;
  rowHeight: number;
  menuRadius: number;
  focusWidth: number;
  indicatorWidth: number;
  scrollbarWidth: number;
};
const DESIGNS: Record<DesktopFamily, Design> = {
  redmond: {
    heights: { small: 28, medium: 34, large: 40 },
    radius: 4,
    padding: 12,
    rowHeight: 40,
    menuRadius: 8,
    focusWidth: 2,
    indicatorWidth: 3,
    scrollbarWidth: 4,
  },
  plasmid: {
    heights: { small: 26, medium: 32, large: 38 },
    radius: 3,
    padding: 10,
    rowHeight: 34,
    menuRadius: 5,
    focusWidth: 1,
    indicatorWidth: 0,
    scrollbarWidth: 8,
  },
  gnomish: {
    heights: { small: 30, medium: 38, large: 44 },
    radius: 9,
    padding: 16,
    rowHeight: 46,
    menuRadius: 12,
    focusWidth: 2,
    indicatorWidth: 0,
    scrollbarWidth: 6,
  },
};

function mapSizes<T>(make: (size: ButtonSize) => T): Record<ButtonSize, T> {
  return { small: make("small"), medium: make("medium"), large: make("large") };
}

/** Each family changes density, selection, focus, surfaces and control geometry. */
export function applyDesktopWidgetTheme(source: WidgetTheme, family: DesktopFamily): WidgetTheme {
  const design = DESIGNS[family];
  const pal = source.foundations.palette;
  const recipes = source.recipes;
  const button = (variant: ButtonVariant) =>
    mapSizes((size): ButtonRecipe => {
      const base = recipes.button[variant][size];
      const prominent = variant === "primary" || variant === "danger";
      const ghost = variant === "ghost";
      const fill =
        variant === "danger"
          ? pal.danger
          : variant === "primary"
            ? pal.accent
            : ghost
              ? 0
              : pal.surface;
      const foreground = prominent ? foregroundOn(fill) : pal.text;
      const radius = family === "gnomish" && prominent ? design.heights[size] / 2 : design.radius;
      return {
        ...base,
        root: {
          base: {
            ...base.root.base,
            fill,
            radius,
            stroke: ghost ? undefined : pal.borderSubtle,
            strokeWidth: ghost ? 0 : 1,
          },
          states: {
            ...base.root.states,
            hover: {
              fill: ghost
                ? pal.hover
                : prominent
                  ? mixControlFill(fill, pal.text, 0.08)
                  : mixColor(fill, pal.text, 0.08),
            },
            pressed: {
              fill: ghost
                ? pal.pressed
                : prominent
                  ? mixControlFill(fill, pal.bg, 0.2)
                  : mixColor(fill, pal.bg, 0.2),
            },
            focused: { stroke: pal.focusRing, strokeWidth: design.focusWidth },
          },
        },
        label: {
          ...base.label,
          base: {
            ...base.label.base,
            color: foreground,
            fontWeight: family === "plasmid" ? "regular" : "medium",
          },
        },
        leadingIcon: { ...base.leadingIcon, base: { ...base.leadingIcon.base, color: foreground } },
        trailingIcon: {
          ...base.trailingIcon,
          base: { ...base.trailingIcon.base, color: foreground },
        },
        metrics: { ...base.metrics, height: design.heights[size], paddingX: design.padding },
        rim: family === "redmond" && !ghost ? { color: pal.rimLight, width: 1 } : undefined,
      };
    });
  return {
    ...source,
    name: `${source.name}:${family}`,
    foundations: {
      ...source.foundations,
      controlHeights: design.heights,
      radii: {
        small: design.radius,
        medium: design.radius + 2,
        large: design.menuRadius,
        window: pal.radiusWindow,
      },
      focusRing: { width: design.focusWidth, inset: 1, radiusOffset: 2 },
      motion: {
        ...source.foundations.motion,
        normalMs: family === "plasmid" ? 130 : family === "gnomish" ? 200 : 160,
      },
    },
    recipes: {
      ...recipes,
      button: {
        primary: button("primary"),
        secondary: button("secondary"),
        ghost: button("ghost"),
        danger: button("danger"),
      },
      listItem: mapSizes((size) => {
        const recipe = recipes.listItem[size];
        return {
          ...recipe,
          selection: {
            ...recipe.selection,
            radius: design.radius,
            fill: pal.selection,
            stroke: family === "plasmid" ? pal.accent : undefined,
            strokeWidth: family === "plasmid" ? 1 : 0,
          },
          interaction: {
            ...recipe.interaction,
            base: { ...recipe.interaction.base, radius: design.radius },
          },
          indicator: { fill: pal.accent, width: design.indicatorWidth },
          metrics: { ...recipe.metrics, height: design.rowHeight, paddingX: design.padding },
        };
      }),
      gridItem: mapSizes((size) => ({
        ...recipes.gridItem[size],
        selection: {
          ...recipes.gridItem[size].selection,
          radius: design.radius + 3,
          fill: pal.selection,
          stroke: pal.accent,
          strokeWidth: 1,
        },
        labelScrim: { ...recipes.gridItem[size].labelScrim, fill: 0, radius: design.radius },
      })),
      textField: mapSizes((size) => {
        const recipe = recipes.textField[size];
        return {
          ...recipe,
          root: {
            ...recipe.root,
            base: {
              ...recipe.root.base,
              radius: design.radius,
              fill: family === "gnomish" ? pal.surface : pal.bg,
            },
            states: {
              ...recipe.root.states,
              focused: { stroke: pal.focusRing, strokeWidth: design.focusWidth },
            },
          },
          metrics: { ...recipe.metrics, height: design.heights[size], paddingX: design.padding },
        };
      }),
      tabs: mapSizes((size) => {
        const recipe = recipes.tabs[size];
        const pill = family === "gnomish";
        return {
          ...recipe,
          root: { ...recipe.root, fill: pill ? pal.surface : 0, radius: pill ? 10 : design.radius },
          tab: {
            ...recipe.tab,
            base: { ...recipe.tab.base, radius: pill ? 8 : design.radius },
            states: {
              ...recipe.tab.states,
              selected: { fill: pill ? pal.hover : colorWithAlpha(pal.accent, 0x16) },
            },
          },
          indicator: { ...recipe.indicator, fill: pill ? 0 : pal.accent },
          metrics: {
            ...recipe.metrics,
            height: design.heights[size],
            indicatorHeight: pill ? 0 : family === "redmond" ? 3 : 2,
          },
        };
      }),
      menu: mapSizes((size) => ({
        ...recipes.menu[size],
        surface: { ...recipes.menu[size].surface, fill: pal.overlay, radius: design.menuRadius },
        item: {
          ...recipes.menu[size].item,
          base: { ...recipes.menu[size].item.base, radius: design.radius },
          states: { ...recipes.menu[size].item.states, selected: { fill: pal.selection } },
        },
        metrics: {
          ...recipes.menu[size].metrics,
          rowHeight: design.rowHeight,
          surfacePadding: family === "plasmid" ? 4 : 8,
        },
      })),
      toggle: mapSizes((size) => {
        const recipe = recipes.toggle[size];
        const trackHeight = family === "gnomish" ? 24 : family === "plasmid" ? 18 : 20;
        return {
          ...recipe,
          track: { ...recipe.track, base: { ...recipe.track.base, radius: trackHeight / 2 } },
          metrics: {
            ...recipe.metrics,
            height: design.heights[size],
            trackHeight,
            trackWidth: trackHeight * 2,
            thumbSize: trackHeight - 4,
            thumbInset: 2,
          },
        };
      }),
      pathBar: mapSizes((size) => ({
        ...recipes.pathBar[size],
        metrics: {
          ...recipes.pathBar[size].metrics,
          editButtonWidth: Math.max(
            recipes.pathBar[size].metrics.editButtonWidth,
            design.padding * 2 + 32,
          ),
        },
      })),
      scrollArea: mapSizes((size) => ({
        ...recipes.scrollArea[size],
        track: {
          ...recipes.scrollArea[size].track,
          base: {
            ...recipes.scrollArea[size].track.base,
            fill: family === "plasmid" ? pal.panel : 0,
          },
        },
        metrics: { ...recipes.scrollArea[size].metrics, scrollbarWidth: design.scrollbarWidth },
      })),
      dialog: mapSizes((size) => ({
        ...recipes.dialog[size],
        surface: { ...recipes.dialog[size].surface, fill: pal.panel, radius: pal.radiusWindow },
        metrics: {
          ...recipes.dialog[size].metrics,
          titlebarHeight: pal.titlebarHeight,
          bodyPaddingX: design.padding + 4,
        },
      })),
    },
  };
}
