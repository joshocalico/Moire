/**
 * @moire/ui widget suite — OS-agnostic React components on @moire/react-host.
 * No Wayland / koffi / platform imports anywhere in this tree.
 *
 * All interactive widgets are in individual modules; re-exported here.
 */
import {
  Children,
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Group,
  Rect,
  Text,
  measureTextBounds,
  type HitPressEvent,
} from "@moire/react-host";
import { themePalette } from "../theme.js";
import { layoutFlex, type FlexChildSpec } from "../layout/yoga.js";
import { getUiScaleFactor } from "../font/index.js";

// Import Button for use in Dialog below, also re-exported.
import { Button } from "./button.js";

/* ---------- Re-exports from split modules ---------- */

export { Pressable } from "./pressable.js";
export type { PressableProps } from "./pressable.js";

export { Button } from "./button.js";
export type {
  ButtonProps,
  ButtonVariant,
  ButtonSize,
  ButtonSlot,
} from "./button.js";

export { IconButton } from "./icon-button.js";
export type {
  IconButtonProps,
  IconButtonSlot,
  IconButtonVariant,
} from "./icon-button.js";

export {
  WidgetThemeProvider,
  createWidgetTheme,
  getWidgetTheme,
  resolveStatefulStyle,
  useWidgetTheme,
} from "../widget-theme.js";
export type {
  WidgetThemeProviderProps,
  WidgetTheme,
  WidgetFoundations,
  WidgetState,
  StatefulStyle,
  WidgetBoxStyle,
  WidgetTextStyle,
  WidgetIconStyle,
  ButtonRecipe,
  IconButtonRecipe,
  ListItemRecipe,
  GridItemRecipe,
  CollectionItemRecipe,
  TextFieldRecipe,
  TabsRecipe,
  MenuRecipe,
  CheckboxRecipe,
  ToggleRecipe,
  SliderRecipe,
  ProgressBarRecipe,
} from "../widget-theme.js";

export { ScrollArea } from "./scroll.js";
export type { ScrollAreaProps } from "./scroll.js";

export { List, ListItem } from "./list.js";
export type { ListProps, ListItemProps, ListItemSlot } from "./list.js";

export { Grid, GridItem } from "./grid.js";
export type { GridProps, GridItemProps } from "./grid.js";

export { ImageWidget } from "./image-widget.js";
export type { ImageWidgetProps, ImageFit } from "./image-widget.js";

export { Icon } from "./icon.js";
export type { IconProps, IconName } from "./icon.js";

export { Draggable, DropTarget, DropZone, setDndBridge } from "./dnd.js";
export type {
  DraggableProps,
  DropTargetProps,
  DropZoneProps,
  DragIconSpec,
  DragPreviewSpec,
  DragSourceOptions,
  DragSourceController,
} from "./dnd.js";
export { useDragSource } from "./dnd.js";

export { CollectionItem, ContextMenuTrigger } from "./interaction.js";
export type {
  CollectionItemProps,
  ContextMenuTriggerProps,
} from "./interaction.js";

export { Tabs } from "./tabs.js";
export type { TabsProps, TabItem, TabSlot } from "./tabs.js";

export { Menu, MenuItem } from "./menu.js";
export type {
  MenuProps,
  MenuEntry,
  MenuItemProps,
  MenuItemSlot,
  MenuTrailingSlot,
} from "./menu.js";

export { Checkbox } from "./checkbox.js";
export type { CheckboxProps } from "./checkbox.js";

export { Toggle } from "./toggle.js";
export type { ToggleProps } from "./toggle.js";

export { Slider } from "./slider.js";
export type { SliderProps } from "./slider.js";

export { ProgressBar } from "./progress-bar.js";
export type { ProgressBarProps } from "./progress-bar.js";

export { TextField } from "./text-field.js";
export type { TextFieldProps, TextFieldSlot } from "./text-field.js";

export { SearchField } from "./search-field.js";
export type { SearchFieldProps } from "./search-field.js";

export { Breadcrumbs, PathBar } from "./breadcrumbs.js";
export type {
  BreadcrumbSegment,
  BreadcrumbsProps,
  PathBarProps,
} from "./breadcrumbs.js";

export {
  ContextMenu,
  OpenWithPicker,
  contextMenuSurfaceSize,
} from "./context-menu.js";
export { DisplayArrangement } from "./display-arrangement.js";
export type {
  DisplayArrangementItem,
  DisplayArrangementProps,
} from "./display-arrangement.js";
export type {
  ContextMenuAction,
  ContextMenuProps,
  OpenWithChoice,
  OpenWithPickerProps,
} from "./context-menu.js";

/* ---------- Layout helpers ---------- */

const DEFAULT_FONT = 14;

function textLineHeight(
  fontSize = DEFAULT_FONT,
  fontWeight?: "regular" | "medium" | "bold",
): number {
  return measureTextBounds("Mg", { fontSize, fontWeight }).height;
}

function textH(scale = 1, fontSize?: number): number {
  const base = fontSize ?? DEFAULT_FONT * scale;
  return Math.ceil(base * getUiScaleFactor());
}

export type BoxProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  flexGrow?: number;
  flexShrink?: number;
  minWidth?: number;
  minHeight?: number;
  children?: ReactNode;
};

export function Box(props: BoxProps): ReactNode {
  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width ?? 0,
      height: props.height ?? 0,
    },
    props.children,
  );
}

type FlexItemProps = {
  width?: number;
  height?: number;
  flexGrow?: number;
  flexShrink?: number;
  minWidth?: number;
  minHeight?: number;
};

function collectFlexChildren(children: ReactNode): {
  specs: FlexChildSpec[];
  elements: ReactElement[];
} {
  const specs: FlexChildSpec[] = [];
  const elements: ReactElement[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const p = child.props as FlexItemProps & { width?: number; height?: number };
    specs.push({
      width: p.width,
      height: p.height,
      flexGrow: p.flexGrow,
      flexShrink: p.flexShrink,
      minWidth: p.minWidth,
      minHeight: p.minHeight,
    });
    elements.push(child as ReactElement);
  });
  return { specs, elements };
}

export type RowProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  gap?: number;
  padding?: number;
  justify?: "start" | "center" | "end" | "space-between" | "space-around";
  align?: "start" | "center" | "end" | "stretch";
  flexGrow?: number;
  flexShrink?: number;
  minWidth?: number;
  minHeight?: number;
  children?: ReactNode;
};

export function Row(props: RowProps): ReactNode {
  const { specs, elements } = collectFlexChildren(props.children);
  const laid = layoutFlex(
    {
      direction: "row",
      width: props.width,
      height: props.height,
      gap: props.gap ?? 8,
      padding: props.padding ?? 0,
      justify: props.justify,
      align: props.align ?? "center",
    },
    specs,
  );
  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: laid.container.width,
      height: laid.container.height,
    },
    ...elements.map((el, i) => {
      const box = laid.children[i]!;
      return createElement(
        Group,
        { key: el.key ?? i, x: box.x, y: box.y, width: box.width, height: box.height },
        el,
      );
    }),
  );
}

export type ColumnProps = RowProps;

export function Column(props: ColumnProps): ReactNode {
  const { specs, elements } = collectFlexChildren(props.children);
  const laid = layoutFlex(
    {
      direction: "column",
      width: props.width,
      height: props.height,
      gap: props.gap ?? 8,
      padding: props.padding ?? 0,
      justify: props.justify,
      align: props.align ?? "stretch",
    },
    specs,
  );
  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: laid.container.width,
      height: laid.container.height,
    },
    ...elements.map((el, i) => {
      const box = laid.children[i]!;
      return createElement(
        Group,
        { key: el.key ?? i, x: box.x, y: box.y, width: box.width, height: box.height },
        el,
      );
    }),
  );
}

/* ---------- Label ---------- */

export type LabelProps = {
  x?: number;
  y?: number;
  text: string;
  color?: number;
  scale?: number;
  fontSize?: number;
  fontWeight?: "regular" | "medium" | "bold";
  fontFamily?: "sans" | "mono";
  width?: number;
  height?: number;
};

export function Label(props: LabelProps): ReactNode {
  const pal = themePalette();
  const scale = props.scale ?? 1;
  const fontSize = props.fontSize ?? (scale > 1 ? 14 * scale : undefined);
  const textEl = {
    text: props.text,
    color: props.color ?? pal.text,
    scale,
    fontSize,
    fontWeight: props.fontWeight,
    fontFamily: props.fontFamily,
  };
  if (props.width != null || props.height != null) {
    return createElement(
      Group,
      {
        x: props.x ?? 0,
        y: props.y ?? 0,
        width: props.width ?? 0,
        height: props.height ?? textH(scale, fontSize),
      },
      createElement(Text, { x: 0, y: 0, ...textEl }),
    );
  }
  return createElement(Text, { x: props.x ?? 0, y: props.y ?? 0, ...textEl });
}

/* ---------- Surface / Panel ---------- */

export type SurfaceProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  fill?: number;
  radius?: number;
  stroke?: number;
  strokeWidth?: number;
  children?: ReactNode;
  onPress?: () => void;
  onContextMenu?: (event: HitPressEvent) => void;
};

export function Surface(props: SurfaceProps): ReactNode {
  const pal = themePalette();
  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
    },
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: props.height,
      fill: props.fill ?? pal.panel,
      radius: props.radius,
      stroke: props.stroke,
      strokeWidth: props.strokeWidth,
      onPress: props.onPress,
      onContextMenu: props.onContextMenu,
    }),
    props.children,
  );
}

export type PanelProps = SurfaceProps;

export function Panel(props: PanelProps): ReactNode {
  const pal = themePalette();
  return createElement(Surface, { ...props, fill: props.fill ?? pal.surface });
}

/* ---------- Separator ---------- */

export type SeparatorProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  color?: number;
};

export function Separator(props: SeparatorProps): ReactNode {
  const pal = themePalette();
  return createElement(Rect, {
    x: props.x ?? 0,
    y: props.y ?? 0,
    width: props.width,
    height: props.height ?? 1,
    fill: props.color ?? pal.border,
  });
}

/** @deprecated use Separator */
export const Divider = Separator;

/* ---------- Dialog ---------- */

export type DialogProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  title: string;
  children?: ReactNode;
  onClose?: () => void;
};

export function Dialog(props: DialogProps): ReactNode {
  const pal = themePalette();
  const titleLineH = textLineHeight(14, "medium");
  return createElement(
    Surface,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
      fill: pal.panel,
    },
    createElement(Rect, { x: 0, y: 0, width: props.width, height: 36, fill: pal.titlebar }),
    createElement(Text, {
      x: 12,
      y: Math.floor((36 - titleLineH) / 2),
      text: props.title,
      color: pal.text,
      fontWeight: "medium",
    }),
    createElement(Button, {
      x: props.width - 36,
      y: 4,
      width: 28,
      height: 28,
      label: "x",
      variant: "danger",
      onPress: props.onClose,
    }),
    createElement(
      Group,
      { x: 12, y: 44, width: props.width - 24, height: props.height - 56 },
      props.children,
    ),
  );
}

/* ---------- Utility ---------- */

export function usePalette() {
  return themePalette();
}
