/**
 * List and ListItem — generic item list backed by ScrollArea.
 * ListItem: 3-px left accent rule when selected + selection wash.
 */
import { createElement, type ReactNode } from "react";
import { Group, Rect, Text, FONT_H } from "@moire/react-host";
import { themePalette } from "../theme.js";
import { ScrollArea } from "./scroll.js";
import { Pressable } from "./pressable.js";

/* ---------- ListItem ---------- */

export type ListItemProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  /** Optional leading element (icon, avatar…). */
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  selected?: boolean;
  onPress?: () => void;
  onDoublePress?: () => void;
  /** When false, no Pressable — parent owns hits. */
  interactive?: boolean;
};

export function ListItem(props: ListItemProps): ReactNode {
  const pal = themePalette();
  const h = props.height ?? 40;
  const ACCENT_W = 3;
  const PAD_L = ACCENT_W + 8;
  const interactive = props.interactive !== false;

  const titleY = props.subtitle
    ? Math.floor(h / 2) - FONT_H
    : Math.floor((h - FONT_H) / 2);
  const subtitleY = titleY + FONT_H + 2;

  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: h,
    },
    // Selection wash
    props.selected
      ? createElement(Rect, {
          x: 0,
          y: 0,
          width: props.width,
          height: h,
          fill: pal.selection,
        })
      : null,
    // Left accent rule when selected
    props.selected
      ? createElement(Rect, {
          x: 0,
          y: 0,
          width: ACCENT_W,
          height: h,
          fill: pal.accentLine,
        })
      : null,
    // Pressable overlay for hover/press feedback + onPress
    interactive
      ? createElement(Pressable, {
          x: 0,
          y: 0,
          width: props.width,
          height: h,
          onPress: props.onPress,
          onDoublePress: props.onDoublePress,
        })
      : null,
    // Leading slot
    props.leading
      ? createElement(Group, { x: PAD_L, y: Math.floor((h - 24) / 2), width: 24, height: 24 },
          props.leading,
        )
      : null,
    // Title
    createElement(Text, {
      x: PAD_L + (props.leading ? 32 : 0),
      y: titleY,
      text: props.title,
      color: pal.text,
    }),
    // Subtitle
    props.subtitle
      ? createElement(Text, {
          x: PAD_L + (props.leading ? 32 : 0),
          y: subtitleY,
          text: props.subtitle,
          color: pal.muted,
          fontSize: 11,
        })
      : null,
  );
}

/* ---------- List ---------- */

export type ListProps<T = unknown> = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  items: T[];
  renderItem: (item: T, index: number, selected: boolean) => ReactNode;
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  itemHeight?: number;
  scrollbar?: boolean;
};

export function List<T>(props: ListProps<T>): ReactNode {
  const itemH = props.itemHeight ?? 40;
  const contentHeight = props.items.length * itemH;

  const children = props.items.map((item, i) =>
    createElement(
      Group,
      { key: i, x: 0, y: i * itemH, width: props.width, height: itemH },
      props.renderItem(item, i, i === props.selectedIndex),
    ),
  );

  return createElement(
    ScrollArea,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
      contentHeight,
      scrollbar: props.scrollbar,
    },
    ...children,
  );
}
