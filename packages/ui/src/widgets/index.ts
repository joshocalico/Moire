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
  FONT_H,
  Group,
  Rect,
  Text,
  measureText,
  type HitPressEvent,
} from "@moire/react-host";
import { themePalette } from "../theme.js";
import { layoutFlex, type FlexChildSpec } from "../layout/yoga.js";
import { getUiScaleFactor } from "../font/index.js";

// Import Button for use in Dialog/IconButton below, also re-exported.
import { Button } from "./button.js";
import { Pressable } from "./pressable.js";

/* ---------- Re-exports from split modules ---------- */

export { Pressable } from "./pressable.js";
export type { PressableProps } from "./pressable.js";

export { Button } from "./button.js";
export type { ButtonProps, ButtonVariant } from "./button.js";

export { ScrollArea } from "./scroll.js";
export type { ScrollAreaProps } from "./scroll.js";

export { List, ListItem } from "./list.js";
export type { ListProps, ListItemProps } from "./list.js";

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
} from "./dnd.js";

export { Tabs } from "./tabs.js";
export type { TabsProps } from "./tabs.js";

/* ---------- Layout helpers ---------- */

const DEFAULT_FONT = 14;

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
  children?: ReactNode;
  onPress?: () => void;
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
      onPress: props.onPress,
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

/* ---------- IconButton ---------- */

export type IconButtonProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  icon: string;
  fill?: number;
  color?: number;
  onPress?: () => void;
};

export function IconButton(props: IconButtonProps): ReactNode {
  return createElement(Button, {
    x: props.x,
    y: props.y,
    width: props.width,
    height: props.height,
    label: props.icon,
    fill: props.fill,
    color: props.color,
    onPress: props.onPress,
  });
}

/* ---------- Checkbox ---------- */

export type CheckboxProps = {
  x?: number;
  y?: number;
  checked: boolean;
  label?: string;
  onChange?: (checked: boolean) => void;
  width?: number;
  height?: number;
};

export function Checkbox(props: CheckboxProps): ReactNode {
  const pal = themePalette();
  const box = 18;
  const label = props.label ?? "";
  const w = props.width ?? box + (label ? measureText(label) + 10 : 0);
  const h = props.height ?? Math.max(box, FONT_H + 4);
  return createElement(
    Group,
    { x: props.x ?? 0, y: props.y ?? 0, width: w, height: h },
    createElement(Rect, {
      x: 0,
      y: Math.floor((h - box) / 2),
      width: box,
      height: box,
      fill: props.checked ? pal.accentLine : pal.surface,
      onPress: () => props.onChange?.(!props.checked),
    }),
    props.checked
      ? createElement(Text, {
          x: 4,
          y: Math.floor((h - FONT_H) / 2),
          text: "x",
          color: 0xffffffff,
          fontSize: 12,
        })
      : null,
    label
      ? createElement(Text, {
          x: box + 8,
          y: Math.floor((h - FONT_H) / 2),
          text: label,
          color: pal.text,
        })
      : null,
  );
}

/* ---------- Toggle ---------- */

export type ToggleProps = {
  x?: number;
  y?: number;
  on: boolean;
  label?: string;
  onChange?: (on: boolean) => void;
  width?: number;
  height?: number;
};

export function Toggle(props: ToggleProps): ReactNode {
  const pal = themePalette();
  const trackW = 36;
  const trackH = 20;
  const knob = 16;
  const label = props.label ?? "";
  const w = props.width ?? trackW + (label ? measureText(label) + 10 : 0);
  const h = props.height ?? Math.max(trackH, FONT_H + 4);
  const ty = Math.floor((h - trackH) / 2);
  return createElement(
    Group,
    { x: props.x ?? 0, y: props.y ?? 0, width: w, height: h },
    createElement(Rect, {
      x: 0,
      y: ty,
      width: trackW,
      height: trackH,
      fill: props.on ? pal.accentLine : pal.surface,
      onPress: () => props.onChange?.(!props.on),
    }),
    createElement(Rect, {
      x: props.on ? trackW - knob - 2 : 2,
      y: ty + 2,
      width: knob,
      height: knob,
      fill: 0xffffffff,
      onPress: () => props.onChange?.(!props.on),
    }),
    label
      ? createElement(Text, {
          x: trackW + 8,
          y: Math.floor((h - FONT_H) / 2),
          text: label,
          color: pal.text,
        })
      : null,
  );
}

/* ---------- Slider ---------- */

export type SliderProps = {
  x?: number;
  y?: number;
  width: number;
  value: number; // 0..1
  onChange?: (v: number) => void;
  height?: number;
};

export function Slider(props: SliderProps): ReactNode {
  const pal = themePalette();
  const h = props.height ?? 24;
  const trackH = 4;
  const thumb = 14;
  const v = Math.max(0, Math.min(1, props.value));
  const usable = Math.max(1, props.width - thumb);
  const fillW = Math.floor(usable * v);
  const setFromLocalX = (localX: number) => {
    const next = Math.max(0, Math.min(1, (localX - thumb / 2) / usable));
    props.onChange?.(next);
  };
  return createElement(
    Group,
    { x: props.x ?? 0, y: props.y ?? 0, width: props.width, height: h },
    createElement(Rect, {
      x: 0,
      y: Math.floor((h - trackH) / 2),
      width: props.width,
      height: trackH,
      fill: pal.surface,
    }),
    createElement(Rect, {
      x: 0,
      y: Math.floor((h - trackH) / 2),
      width: fillW + thumb / 2,
      height: trackH,
      fill: pal.accentLine,
    }),
    createElement(Rect, {
      x: fillW,
      y: Math.floor((h - thumb) / 2),
      width: thumb,
      height: thumb,
      fill: 0xffffffff,
    }),
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: h,
      fill: 0x00000000,
      onPress: (ev: HitPressEvent) => setFromLocalX(ev.localX),
    }),
  );
}

/* ---------- TextField ---------- */

export type TextFieldProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  value: string;
  placeholder?: string;
  onChange?: (v: string) => void;
  focused?: boolean;
};

export function TextField(props: TextFieldProps): ReactNode {
  const pal = themePalette();
  const h = props.height ?? 32;
  const shown = props.value.length > 0 ? props.value : (props.placeholder ?? "");
  const color = props.value.length > 0 ? pal.text : pal.muted;
  return createElement(
    Group,
    { x: props.x ?? 0, y: props.y ?? 0, width: props.width, height: h },
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: h,
      fill: pal.surface,
    }),
    props.focused
      ? createElement(Rect, { x: 0, y: h - 2, width: props.width, height: 2, fill: pal.accentLine })
      : null,
    createElement(Text, {
      x: 10,
      y: Math.floor((h - FONT_H) / 2),
      text: shown,
      color,
    }),
  );
}

/* ---------- ProgressBar ---------- */

export type ProgressBarProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  value: number; // 0..1
};

export function ProgressBar(props: ProgressBarProps): ReactNode {
  const pal = themePalette();
  const h = props.height ?? 8;
  const v = Math.max(0, Math.min(1, props.value));
  return createElement(
    Group,
    { x: props.x ?? 0, y: props.y ?? 0, width: props.width, height: h },
    createElement(Rect, { x: 0, y: 0, width: props.width, height: h, fill: pal.surface }),
    createElement(Rect, { x: 0, y: 0, width: Math.floor(props.width * v), height: h, fill: pal.accentLine }),
  );
}

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
      y: 10,
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

/* ---------- Menu ---------- */

export type MenuItemProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  label: string;
  onPress?: () => void;
};

export function MenuItem(props: MenuItemProps): ReactNode {
  const pal = themePalette();
  const h = props.height ?? 28;
  return createElement(
    Group,
    { x: props.x ?? 0, y: props.y ?? 0, width: props.width, height: h },
    createElement(Pressable, {
      x: 0, y: 0, width: props.width, height: h, onPress: props.onPress,
    }),
    createElement(Text, {
      x: 10,
      y: Math.floor((h - FONT_H) / 2),
      text: props.label,
      color: pal.text,
    }),
  );
}

export type MenuProps = {
  x?: number;
  y?: number;
  width: number;
  items: Array<{ label: string; onPress?: () => void }>;
};

export function Menu(props: MenuProps): ReactNode {
  const pal = themePalette();
  const rowH = 28;
  const h = props.items.length * rowH + 8;
  return createElement(
    Surface,
    { x: props.x ?? 0, y: props.y ?? 0, width: props.width, height: h, fill: pal.panel },
    ...props.items.map((item, i) =>
      createElement(MenuItem, {
        key: i, x: 4, y: 4 + i * rowH,
        width: props.width - 8,
        label: item.label,
        onPress: item.onPress,
      }),
    ),
  );
}

/* ---------- Utility ---------- */

export function usePalette() {
  return themePalette();
}
