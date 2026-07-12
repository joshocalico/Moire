/**
 * Widget suite — OS-agnostic React components on @moire/react-host.
 * No Wayland / koffi / platform imports.
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

const DEFAULT_FONT = 14;

function textH(scale = 1, fontSize?: number): number {
  const base = fontSize ?? DEFAULT_FONT * scale;
  return Math.ceil(base * getUiScaleFactor());
}

/* ---------- Layout ---------- */

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
  children?: ReactNode;
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
  /** Used when this Row/Column is a flex child of another Row/Column. */
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
        {
          key: el.key ?? i,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        },
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
        {
          key: el.key ?? i,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        },
        el,
      );
    }),
  );
}

/* ---------- Basics ---------- */

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
  // Wrap when width/height provided so Yoga flex parents get a real box.
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
  return createElement(Text, {
    x: props.x ?? 0,
    y: props.y ?? 0,
    ...textEl,
  });
}

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
  return createElement(Surface, {
    ...props,
    fill: props.fill ?? pal.surface,
  });
}

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
    fill: props.color ?? pal.accentLine,
  });
}

/** @deprecated use Separator */
export const Divider = Separator;

export type ButtonProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  label: string;
  fill?: number;
  color?: number;
  fontSize?: number;
  onPress?: () => void;
};

export function Button(props: ButtonProps): ReactNode {
  const pal = themePalette();
  const fill = props.fill ?? pal.accentLine;
  const color = props.color ?? 0xffffffff;
  const fontSize = props.fontSize ?? DEFAULT_FONT;
  const tw = measureText(props.label, fontSize / 14);
  const th = textH(1, fontSize);
  const tx = Math.max(4, Math.floor((props.width - tw) / 2));
  const ty = Math.floor((props.height - th) / 2);
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
      fill,
      onPress: props.onPress,
    }),
    createElement(Text, {
      x: tx,
      y: ty,
      text: props.label,
      color,
      fontSize,
    }),
  );
}

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
    ...props,
    label: props.icon,
  });
}

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
    // Full-height hit target — value from click X (not +0.1 only).
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
  const shown =
    props.value.length > 0
      ? props.value
      : (props.placeholder ?? "");
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
      ? createElement(Rect, {
          x: 0,
          y: h - 2,
          width: props.width,
          height: 2,
          fill: pal.accentLine,
        })
      : null,
    createElement(Text, {
      x: 10,
      y: Math.floor((h - FONT_H) / 2),
      text: shown,
      color,
    }),
  );
}

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
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: h,
      fill: pal.surface,
    }),
    createElement(Rect, {
      x: 0,
      y: 0,
      width: Math.floor(props.width * v),
      height: h,
      fill: pal.accentLine,
    }),
  );
}

export type ScrollAreaProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  scrollY?: number;
  children?: ReactNode;
};

export function ScrollArea(props: ScrollAreaProps): ReactNode {
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
      fill: pal.panel,
    }),
    createElement(
      Group,
      {
        x: 0,
        y: -(props.scrollY ?? 0),
        width: props.width,
        height: props.height,
      },
      props.children,
    ),
  );
}

export type ListItemProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  label: string;
  selected?: boolean;
  onPress?: () => void;
};

export function ListItem(props: ListItemProps): ReactNode {
  const pal = themePalette();
  const h = props.height ?? 28;
  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: h,
    },
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: h,
      fill: props.selected ? pal.accentLine : 0x00000000,
      onPress: props.onPress,
    }),
    createElement(Text, {
      x: 10,
      y: Math.floor((h - FONT_H) / 2),
      text: props.label,
      color: pal.text,
    }),
  );
}

export type ListProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  items: string[];
  selected?: number;
  onSelect?: (index: number) => void;
};

export function List(props: ListProps): ReactNode {
  const rowH = 28;
  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
    },
    ...props.items.map((label, i) =>
      createElement(ListItem, {
        key: i,
        x: 0,
        y: i * rowH,
        width: props.width,
        height: rowH,
        label,
        selected: i === props.selected,
        onPress: () => props.onSelect?.(i),
      }),
    ),
  );
}

export type TabsProps = {
  x?: number;
  y?: number;
  width: number;
  tabs: string[];
  active: number;
  onChange?: (index: number) => void;
  height?: number;
};

export function Tabs(props: TabsProps): ReactNode {
  const pal = themePalette();
  const h = props.height ?? 32;
  const n = Math.max(1, props.tabs.length);
  const tw = Math.floor(props.width / n);
  return createElement(
    Group,
    { x: props.x ?? 0, y: props.y ?? 0, width: props.width, height: h },
    ...props.tabs.map((tab, i) =>
      createElement(
        Group,
        { key: i, x: i * tw, y: 0, width: tw, height: h },
        createElement(Rect, {
          x: 0,
          y: 0,
          width: tw,
          height: h,
          fill: i === props.active ? pal.accentLine : pal.surface,
          onPress: () => props.onChange?.(i),
        }),
        createElement(Text, {
          x: 10,
          y: Math.floor((h - FONT_H) / 2),
          text: tab,
          color: pal.text,
        }),
      ),
    ),
  );
}

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
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: 36,
      fill: pal.titlebar,
    }),
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
      fill: pal.danger,
      onPress: props.onClose,
    }),
    createElement(
      Group,
      { x: 12, y: 44, width: props.width - 24, height: props.height - 56 },
      props.children,
    ),
  );
}

export type MenuItemProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  label: string;
  onPress?: () => void;
};

export function MenuItem(props: MenuItemProps): ReactNode {
  return createElement(ListItem, {
    x: props.x,
    y: props.y,
    width: props.width,
    height: props.height ?? 28,
    label: props.label,
    onPress: props.onPress,
  });
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
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: h,
      fill: pal.panel,
    },
    ...props.items.map((item, i) =>
      createElement(MenuItem, {
        key: i,
        x: 4,
        y: 4 + i * rowH,
        width: props.width - 8,
        label: item.label,
        onPress: item.onPress,
      }),
    ),
  );
}

export function usePalette() {
  return themePalette();
}
