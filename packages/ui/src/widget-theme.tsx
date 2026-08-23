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
  | "invalid"
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

export type IconButtonVariant = "standard" | "ghost" | "danger";

export type IconButtonRecipe = {
  root: StatefulStyle<WidgetBoxStyle>;
  icon: StatefulStyle<WidgetIconStyle>;
  metrics: { size: number };
};

export type ListItemRecipe = {
  selection: WidgetBoxStyle;
  interaction: StatefulStyle<WidgetBoxStyle>;
  title: StatefulStyle<WidgetTextStyle>;
  subtitle: StatefulStyle<WidgetTextStyle>;
  leadingIcon: StatefulStyle<WidgetIconStyle>;
  indicator: { fill: number; width: number };
  metrics: {
    height: number;
    paddingX: number;
    leadingGap: number;
    subtitleGap: number;
  };
};

export type GridItemRecipe = {
  selection: WidgetBoxStyle;
  dropTarget: WidgetBoxStyle;
  interaction: StatefulStyle<WidgetBoxStyle>;
  label: StatefulStyle<WidgetTextStyle>;
  labelScrim: WidgetBoxStyle;
  metrics: {
    labelPadding: number;
    labelHeightPadding: number;
    iconMin: number;
    iconMax: number;
    iconGap: number;
  };
};

export type CollectionItemRecipe = {
  outline: StatefulStyle<WidgetBoxStyle>;
};

export type TextFieldRecipe = {
  root: StatefulStyle<WidgetBoxStyle>;
  text: StatefulStyle<WidgetTextStyle>;
  placeholder: StatefulStyle<WidgetTextStyle>;
  leadingIcon: StatefulStyle<WidgetIconStyle>;
  trailingIcon: StatefulStyle<WidgetIconStyle>;
  caret: { fill: number; width: number };
  metrics: {
    height: number;
    paddingX: number;
    slotGap: number;
  };
};

export type TabsRecipe = {
  root: WidgetBoxStyle;
  tab: StatefulStyle<WidgetBoxStyle>;
  label: StatefulStyle<WidgetTextStyle>;
  icon: StatefulStyle<WidgetIconStyle>;
  indicator: WidgetBoxStyle;
  divider: { fill: number; height: number };
  metrics: {
    height: number;
    paddingX: number;
    gap: number;
    indicatorHeight: number;
    indicatorInsetX: number;
  };
};

export type MenuRecipe = {
  surface: WidgetBoxStyle;
  shadow: WidgetBoxStyle;
  item: StatefulStyle<WidgetBoxStyle>;
  label: StatefulStyle<WidgetTextStyle>;
  description: StatefulStyle<WidgetTextStyle>;
  header: WidgetTextStyle;
  leadingIcon: StatefulStyle<WidgetIconStyle>;
  trailingText: StatefulStyle<WidgetTextStyle>;
  indicator: StatefulStyle<{ fill: number; width: number }>;
  separator: { fill: number; height: number };
  metrics: {
    rowHeight: number;
    surfacePadding: number;
    itemInset: number;
    paddingX: number;
    contentGap: number;
    descriptionGap: number;
    headerHeight: number;
    separatorGap: number;
  };
};

export type CheckboxRecipe = {
  control: StatefulStyle<WidgetBoxStyle>;
  mark: StatefulStyle<WidgetTextStyle>;
  label: StatefulStyle<WidgetTextStyle>;
  metrics: { height: number; controlSize: number; gap: number };
};

export type ToggleRecipe = {
  track: StatefulStyle<WidgetBoxStyle>;
  thumb: StatefulStyle<WidgetBoxStyle>;
  label: StatefulStyle<WidgetTextStyle>;
  metrics: {
    height: number;
    trackWidth: number;
    trackHeight: number;
    thumbSize: number;
    thumbInset: number;
    gap: number;
  };
};

export type SliderRecipe = {
  track: StatefulStyle<WidgetBoxStyle>;
  fill: StatefulStyle<WidgetBoxStyle>;
  thumb: StatefulStyle<WidgetBoxStyle>;
  metrics: { height: number; trackHeight: number; thumbSize: number };
};

export type ProgressBarRecipe = {
  track: WidgetBoxStyle;
  fill: WidgetBoxStyle;
  metrics: { height: number };
};

export type ScrollAreaRecipe = {
  viewport: WidgetBoxStyle;
  track: StatefulStyle<WidgetBoxStyle>;
  thumb: StatefulStyle<WidgetBoxStyle>;
  metrics: {
    scrollbarWidth: number;
    scrollbarMargin: number;
    minThumbHeight: number;
    wheelStep: number;
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
    iconButton: Record<IconButtonVariant, Record<ButtonSize, IconButtonRecipe>>;
    listItem: Record<ButtonSize, ListItemRecipe>;
    gridItem: Record<ButtonSize, GridItemRecipe>;
    collectionItem: CollectionItemRecipe;
    textField: Record<ButtonSize, TextFieldRecipe>;
    tabs: Record<ButtonSize, TabsRecipe>;
    menu: Record<ButtonSize, MenuRecipe>;
    checkbox: Record<ButtonSize, CheckboxRecipe>;
    toggle: Record<ButtonSize, ToggleRecipe>;
    slider: Record<ButtonSize, SliderRecipe>;
    progressBar: Record<ButtonSize, ProgressBarRecipe>;
    scrollArea: Record<ButtonSize, ScrollAreaRecipe>;
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

function iconButtonRecipe(
  variant: IconButtonVariant,
  size: ButtonSize,
  palette: ThemePalette,
): IconButtonRecipe {
  const buttonVariant: ButtonVariant =
    variant === "standard" ? "secondary" : variant;
  const source = buttonRecipe(buttonVariant, size, palette);
  return {
    root: source.root,
    icon: source.leadingIcon,
    metrics: { size: source.metrics.height },
  };
}

function listItemRecipe(
  size: ButtonSize,
  palette: ThemePalette,
): ListItemRecipe {
  const metrics = {
    small: {
      height: 32,
      paddingX: 10,
      leadingGap: 7,
      subtitleGap: 1,
      titleSize: 12,
      subtitleSize: 10,
      iconSize: 18,
    },
    medium: {
      height: 40,
      paddingX: 11,
      leadingGap: 8,
      subtitleGap: 1,
      titleSize: 14,
      subtitleSize: 11,
      iconSize: 24,
    },
    large: {
      height: 52,
      paddingX: 14,
      leadingGap: 10,
      subtitleGap: 2,
      titleSize: 15,
      subtitleSize: 12,
      iconSize: 28,
    },
  }[size];
  const textDisabled = { disabled: { color: palette.muted } };
  return {
    selection: {
      fill: palette.selection,
      radius: palette.radiusSm,
    },
    interaction: {
      base: { fill: 0x00000000, radius: palette.radiusSm },
      states: {
        hover: { fill: withAlpha(palette.hover, 0xb0) },
        pressed: { fill: withAlpha(palette.pressed, 0xd0) },
        disabled: { fill: 0x00000000 },
      },
    },
    title: {
      base: {
        color: palette.text,
        fontSize: metrics.titleSize,
        fontWeight: "regular",
      },
      states: textDisabled,
    },
    subtitle: {
      base: {
        color: palette.muted,
        fontSize: metrics.subtitleSize,
        fontWeight: "regular",
      },
      states: textDisabled,
    },
    leadingIcon: {
      base: { color: palette.text, size: metrics.iconSize },
      states: { disabled: { color: palette.muted } },
    },
    indicator: { fill: palette.accentLine, width: 3 },
    metrics: {
      height: metrics.height,
      paddingX: metrics.paddingX,
      leadingGap: metrics.leadingGap,
      subtitleGap: metrics.subtitleGap,
    },
  };
}

function gridItemRecipe(
  size: ButtonSize,
  palette: ThemePalette,
): GridItemRecipe {
  const metrics = {
    small: {
      fontSize: 11,
      labelPadding: 3,
      labelHeightPadding: 5,
      iconMin: 20,
      iconMax: 42,
      iconGap: 10,
    },
    medium: {
      fontSize: 12,
      labelPadding: 4,
      labelHeightPadding: 6,
      iconMin: 24,
      iconMax: 56,
      iconGap: 14,
    },
    large: {
      fontSize: 14,
      labelPadding: 6,
      labelHeightPadding: 8,
      iconMin: 32,
      iconMax: 72,
      iconGap: 18,
    },
  }[size];
  return {
    selection: {
      fill: palette.selection,
      radius: palette.radiusMd,
      stroke: palette.accent,
      strokeWidth: 1,
    },
    dropTarget: {
      fill: withAlpha(palette.selection, 0xb0),
      radius: palette.radiusMd,
      stroke: palette.focusRing,
      strokeWidth: 2,
    },
    interaction: {
      base: { fill: 0x00000000, radius: palette.radiusMd },
      states: {
        hover: { fill: withAlpha(palette.hover, 0x90) },
        pressed: { fill: withAlpha(palette.pressed, 0xc0) },
        disabled: { fill: 0x00000000 },
      },
    },
    label: {
      base: {
        color: palette.text,
        fontSize: metrics.fontSize,
        fontWeight: "regular",
      },
      states: { disabled: { color: palette.muted } },
    },
    labelScrim: {
      fill: 0xaa0a0c0e,
      radius: palette.radiusSm,
    },
    metrics: {
      labelPadding: metrics.labelPadding,
      labelHeightPadding: metrics.labelHeightPadding,
      iconMin: metrics.iconMin,
      iconMax: metrics.iconMax,
      iconGap: metrics.iconGap,
    },
  };
}

function collectionItemRecipe(palette: ThemePalette): CollectionItemRecipe {
  return {
    outline: {
      base: { fill: 0x00000000, radius: palette.radiusSm },
      states: {
        focused: {
          stroke: palette.focusRing,
          strokeWidth: 2,
        },
        selected: {
          stroke: palette.accent,
          strokeWidth: 1,
        },
        disabled: {
          stroke: palette.muted,
          strokeWidth: 1,
        },
      },
    },
  };
}

function textFieldRecipe(
  size: ButtonSize,
  palette: ThemePalette,
): TextFieldRecipe {
  const metrics = {
    small: { height: 28, paddingX: 8, slotGap: 6, fontSize: 12, iconSize: 14 },
    medium: { height: 32, paddingX: 10, slotGap: 8, fontSize: 13, iconSize: 16 },
    large: { height: 40, paddingX: 12, slotGap: 8, fontSize: 14, iconSize: 18 },
  }[size];
  const disabledText = { disabled: { color: palette.muted } };
  return {
    root: {
      base: {
        fill: palette.surface,
        radius: palette.radiusSm,
        stroke: palette.borderSubtle,
        strokeWidth: 1,
      },
      states: {
        focused: { stroke: palette.focusRing, strokeWidth: 2 },
        invalid: { stroke: palette.danger },
        disabled: {
          fill: withAlpha(palette.surface, 0x80),
          stroke: withAlpha(palette.borderSubtle, 0x80),
        },
      },
    },
    text: {
      base: {
        color: palette.text,
        fontSize: metrics.fontSize,
        fontWeight: "regular",
      },
      states: disabledText,
    },
    placeholder: {
      base: {
        color: palette.muted,
        fontSize: metrics.fontSize,
        fontWeight: "regular",
      },
      states: disabledText,
    },
    leadingIcon: {
      base: { color: palette.muted, size: metrics.iconSize },
      states: {
        focused: { color: palette.accent },
        disabled: { color: palette.muted },
      },
    },
    trailingIcon: {
      base: { color: palette.muted, size: metrics.iconSize },
      states: {
        focused: { color: palette.text },
        disabled: { color: palette.muted },
      },
    },
    caret: { fill: palette.text, width: 1 },
    metrics: {
      height: metrics.height,
      paddingX: metrics.paddingX,
      slotGap: metrics.slotGap,
    },
  };
}

function tabsRecipe(size: ButtonSize, palette: ThemePalette): TabsRecipe {
  const metrics = {
    small: {
      height: 28,
      paddingX: 8,
      gap: 6,
      fontSize: 12,
      iconSize: 14,
      indicatorHeight: 2,
      indicatorInsetX: 8,
    },
    medium: {
      height: 34,
      paddingX: 10,
      gap: 8,
      fontSize: 13,
      iconSize: 16,
      indicatorHeight: 2,
      indicatorInsetX: 10,
    },
    large: {
      height: 40,
      paddingX: 12,
      gap: 8,
      fontSize: 14,
      iconSize: 18,
      indicatorHeight: 3,
      indicatorInsetX: 12,
    },
  }[size];
  return {
    root: { fill: palette.surface, radius: palette.radiusSm },
    tab: {
      base: { fill: 0x00000000, radius: palette.radiusSm },
      states: {
        hover: { fill: withAlpha(palette.hover, 0xb0) },
        pressed: { fill: withAlpha(palette.pressed, 0xd0) },
        focused: { stroke: palette.focusRing, strokeWidth: 1 },
        disabled: { fill: 0x00000000, stroke: undefined, strokeWidth: 0 },
      },
    },
    label: {
      base: {
        color: palette.muted,
        fontSize: metrics.fontSize,
        fontWeight: "regular",
      },
      states: {
        selected: { color: palette.accent, fontWeight: "medium" },
        disabled: { color: withAlpha(palette.muted, 0x80) },
      },
    },
    icon: {
      base: { color: palette.muted, size: metrics.iconSize },
      states: {
        selected: { color: palette.accent },
        disabled: { color: withAlpha(palette.muted, 0x80) },
      },
    },
    indicator: {
      fill: palette.accentLine,
      radius: Math.ceil(metrics.indicatorHeight / 2),
    },
    divider: { fill: palette.border, height: 1 },
    metrics: {
      height: metrics.height,
      paddingX: metrics.paddingX,
      gap: metrics.gap,
      indicatorHeight: metrics.indicatorHeight,
      indicatorInsetX: metrics.indicatorInsetX,
    },
  };
}

function menuRecipe(size: ButtonSize, palette: ThemePalette): MenuRecipe {
  const metrics = {
    small: {
      rowHeight: 30,
      surfacePadding: 4,
      itemInset: 4,
      paddingX: 9,
      contentGap: 7,
      descriptionGap: 1,
      headerHeight: 28,
      separatorGap: 7,
      fontSize: 12,
      descriptionSize: 10,
      iconSize: 16,
    },
    medium: {
      rowHeight: 38,
      surfacePadding: 8,
      itemInset: 6,
      paddingX: 12,
      contentGap: 8,
      descriptionGap: 2,
      headerHeight: 34,
      separatorGap: 9,
      fontSize: 13,
      descriptionSize: 11,
      iconSize: 20,
    },
    large: {
      rowHeight: 48,
      surfacePadding: 10,
      itemInset: 7,
      paddingX: 14,
      contentGap: 10,
      descriptionGap: 2,
      headerHeight: 40,
      separatorGap: 11,
      fontSize: 14,
      descriptionSize: 12,
      iconSize: 24,
    },
  }[size];
  return {
    surface: {
      fill: palette.panel,
      radius: palette.radiusMd,
      stroke: palette.borderSubtle,
      strokeWidth: 1,
    },
    shadow: { fill: palette.rimShade, radius: palette.radiusMd },
    item: {
      base: { fill: 0x00000000, radius: palette.radiusSm },
      states: {
        hover: { fill: withAlpha(palette.hover, 0xc0) },
        pressed: { fill: withAlpha(palette.pressed, 0xe0) },
        focused: { stroke: palette.focusRing, strokeWidth: 1 },
        selected: { fill: palette.selection },
        disabled: { fill: 0x00000000, stroke: undefined, strokeWidth: 0 },
      },
    },
    label: {
      base: {
        color: palette.text,
        fontSize: metrics.fontSize,
        fontWeight: "medium",
      },
      states: {
        danger: { color: palette.danger },
        disabled: { color: palette.muted },
      },
    },
    description: {
      base: {
        color: palette.muted,
        fontSize: metrics.descriptionSize,
        fontWeight: "regular",
      },
      states: { disabled: { color: withAlpha(palette.muted, 0x80) } },
    },
    header: {
      color: palette.muted,
      fontSize: 11,
      fontWeight: "medium",
    },
    leadingIcon: {
      base: { color: palette.text, size: metrics.iconSize },
      states: {
        danger: { color: palette.danger },
        disabled: { color: palette.muted },
      },
    },
    trailingText: {
      base: {
        color: palette.muted,
        fontSize: Math.max(10, metrics.fontSize - 2),
        fontWeight: "regular",
      },
      states: { disabled: { color: withAlpha(palette.muted, 0x80) } },
    },
    indicator: {
      base: { fill: palette.accentLine, width: 2 },
      states: {
        danger: { fill: palette.danger },
        disabled: { fill: 0x00000000 },
      },
    },
    separator: { fill: palette.borderSubtle, height: 1 },
    metrics: {
      rowHeight: metrics.rowHeight,
      surfacePadding: metrics.surfacePadding,
      itemInset: metrics.itemInset,
      paddingX: metrics.paddingX,
      contentGap: metrics.contentGap,
      descriptionGap: metrics.descriptionGap,
      headerHeight: metrics.headerHeight,
      separatorGap: metrics.separatorGap,
    },
  };
}

function checkboxRecipe(
  size: ButtonSize,
  palette: ThemePalette,
): CheckboxRecipe {
  const metrics = {
    small: { height: 28, controlSize: 16, gap: 7, fontSize: 12, markSize: 12 },
    medium: { height: 32, controlSize: 18, gap: 8, fontSize: 13, markSize: 14 },
    large: { height: 40, controlSize: 22, gap: 10, fontSize: 14, markSize: 17 },
  }[size];
  return {
    control: {
      base: {
        fill: palette.surface,
        radius: Math.max(3, Math.round(metrics.controlSize * 0.22)),
        stroke: palette.border,
        strokeWidth: 1,
      },
      states: {
        hover: { fill: palette.hover },
        pressed: { fill: palette.pressed },
        selected: { fill: palette.accentLine, stroke: palette.accentLine },
        focused: { stroke: palette.focusRing, strokeWidth: 2 },
        invalid: { stroke: palette.danger, strokeWidth: 2 },
        disabled: {
          fill: withAlpha(palette.surface, 0x70),
          stroke: withAlpha(palette.border, 0x70),
        },
      },
    },
    mark: {
      base: {
        color: 0xffffffff,
        fontSize: metrics.markSize,
        fontWeight: "bold",
      },
      states: { disabled: { color: withAlpha(0xffffffff, 0x80) } },
    },
    label: {
      base: {
        color: palette.text,
        fontSize: metrics.fontSize,
        fontWeight: "regular",
      },
      states: { disabled: { color: palette.muted } },
    },
    metrics: {
      height: metrics.height,
      controlSize: metrics.controlSize,
      gap: metrics.gap,
    },
  };
}

function toggleRecipe(size: ButtonSize, palette: ThemePalette): ToggleRecipe {
  const metrics = {
    small: {
      height: 28,
      trackWidth: 32,
      trackHeight: 18,
      thumbSize: 14,
      thumbInset: 2,
      gap: 8,
      fontSize: 12,
    },
    medium: {
      height: 32,
      trackWidth: 36,
      trackHeight: 20,
      thumbSize: 16,
      thumbInset: 2,
      gap: 8,
      fontSize: 13,
    },
    large: {
      height: 40,
      trackWidth: 44,
      trackHeight: 24,
      thumbSize: 20,
      thumbInset: 2,
      gap: 10,
      fontSize: 14,
    },
  }[size];
  return {
    track: {
      base: {
        fill: palette.surface,
        radius: Math.floor(metrics.trackHeight / 2),
        stroke: palette.border,
        strokeWidth: 1,
      },
      states: {
        hover: { fill: palette.hover },
        pressed: { fill: palette.pressed },
        selected: { fill: palette.accentLine, stroke: palette.accentLine },
        focused: { stroke: palette.focusRing, strokeWidth: 2 },
        disabled: {
          fill: withAlpha(palette.surface, 0x70),
          stroke: withAlpha(palette.border, 0x70),
        },
      },
    },
    thumb: {
      base: {
        fill: 0xffffffff,
        radius: Math.floor(metrics.thumbSize / 2),
        stroke: palette.rimShade,
        strokeWidth: 1,
      },
      states: { disabled: { fill: 0x80ffffff, stroke: undefined } },
    },
    label: {
      base: {
        color: palette.text,
        fontSize: metrics.fontSize,
        fontWeight: "regular",
      },
      states: { disabled: { color: palette.muted } },
    },
    metrics: {
      height: metrics.height,
      trackWidth: metrics.trackWidth,
      trackHeight: metrics.trackHeight,
      thumbSize: metrics.thumbSize,
      thumbInset: metrics.thumbInset,
      gap: metrics.gap,
    },
  };
}

function sliderRecipe(size: ButtonSize, palette: ThemePalette): SliderRecipe {
  const metrics = {
    small: { height: 24, trackHeight: 3, thumbSize: 12 },
    medium: { height: 28, trackHeight: 4, thumbSize: 14 },
    large: { height: 36, trackHeight: 6, thumbSize: 18 },
  }[size];
  return {
    track: {
      base: {
        fill: palette.surface,
        radius: Math.ceil(metrics.trackHeight / 2),
        stroke: palette.borderSubtle,
        strokeWidth: 1,
      },
      states: { disabled: { fill: withAlpha(palette.surface, 0x70) } },
    },
    fill: {
      base: {
        fill: palette.accentLine,
        radius: Math.ceil(metrics.trackHeight / 2),
      },
      states: { disabled: { fill: withAlpha(palette.accentLine, 0x70) } },
    },
    thumb: {
      base: {
        fill: 0xffffffff,
        radius: Math.floor(metrics.thumbSize / 2),
        stroke: palette.rimShade,
        strokeWidth: 1,
      },
      states: {
        hover: { stroke: palette.accent, strokeWidth: 2 },
        pressed: { fill: palette.accent, stroke: palette.focusRing, strokeWidth: 2 },
        focused: { stroke: palette.focusRing, strokeWidth: 2 },
        disabled: { fill: 0x80ffffff, stroke: undefined, strokeWidth: 0 },
      },
    },
    metrics,
  };
}

function progressBarRecipe(
  size: ButtonSize,
  palette: ThemePalette,
): ProgressBarRecipe {
  const height = { small: 4, medium: 8, large: 12 }[size];
  return {
    track: {
      fill: palette.surface,
      radius: Math.ceil(height / 2),
      stroke: palette.borderSubtle,
      strokeWidth: 1,
    },
    fill: { fill: palette.accentLine, radius: Math.ceil(height / 2) },
    metrics: { height },
  };
}

function scrollAreaRecipe(
  size: ButtonSize,
  palette: ThemePalette,
): ScrollAreaRecipe {
  const metrics = {
    small: {
      scrollbarWidth: 5,
      scrollbarMargin: 2,
      minThumbHeight: 16,
      wheelStep: 28,
    },
    medium: {
      scrollbarWidth: 6,
      scrollbarMargin: 2,
      minThumbHeight: 20,
      wheelStep: 34,
    },
    large: {
      scrollbarWidth: 8,
      scrollbarMargin: 3,
      minThumbHeight: 24,
      wheelStep: 42,
    },
  }[size];
  return {
    viewport: { fill: palette.panel, radius: 0 },
    track: {
      base: {
        fill: withAlpha(palette.surface, 0x90),
        radius: Math.ceil(metrics.scrollbarWidth / 2),
      },
      states: { hover: { fill: palette.surface } },
    },
    thumb: {
      base: {
        fill: palette.border,
        radius: Math.ceil(metrics.scrollbarWidth / 2),
      },
      states: {
        hover: { fill: palette.muted },
        pressed: { fill: palette.accent },
      },
    },
    metrics,
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
  const iconVariants: IconButtonVariant[] = ["standard", "ghost", "danger"];
  const sizes: ButtonSize[] = ["small", "medium", "large"];
  const button = {} as WidgetTheme["recipes"]["button"];
  const iconButton = {} as WidgetTheme["recipes"]["iconButton"];
  const listItem = {} as WidgetTheme["recipes"]["listItem"];
  const gridItem = {} as WidgetTheme["recipes"]["gridItem"];
  const textField = {} as WidgetTheme["recipes"]["textField"];
  const tabs = {} as WidgetTheme["recipes"]["tabs"];
  const menu = {} as WidgetTheme["recipes"]["menu"];
  const checkbox = {} as WidgetTheme["recipes"]["checkbox"];
  const toggle = {} as WidgetTheme["recipes"]["toggle"];
  const slider = {} as WidgetTheme["recipes"]["slider"];
  const progressBar = {} as WidgetTheme["recipes"]["progressBar"];
  const scrollArea = {} as WidgetTheme["recipes"]["scrollArea"];
  for (const variant of variants) {
    button[variant] = {} as Record<ButtonSize, ButtonRecipe>;
    for (const size of sizes) {
      button[variant][size] = buttonRecipe(variant, size, palette);
    }
  }
  for (const variant of iconVariants) {
    iconButton[variant] = {} as Record<ButtonSize, IconButtonRecipe>;
    for (const size of sizes) {
      iconButton[variant][size] = iconButtonRecipe(variant, size, palette);
    }
  }
  for (const size of sizes) {
    listItem[size] = listItemRecipe(size, palette);
    gridItem[size] = gridItemRecipe(size, palette);
    textField[size] = textFieldRecipe(size, palette);
    tabs[size] = tabsRecipe(size, palette);
    menu[size] = menuRecipe(size, palette);
    checkbox[size] = checkboxRecipe(size, palette);
    toggle[size] = toggleRecipe(size, palette);
    slider[size] = sliderRecipe(size, palette);
    progressBar[size] = progressBarRecipe(size, palette);
    scrollArea[size] = scrollAreaRecipe(size, palette);
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
    recipes: {
      button,
      iconButton,
      listItem,
      gridItem,
      collectionItem: collectionItemRecipe(palette),
      textField,
      tabs,
      menu,
      checkbox,
      toggle,
      slider,
      progressBar,
      scrollArea,
    },
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
