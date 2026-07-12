/**
 * Grid and GridItem — flow-layout grid backed by ScrollArea.
 * GridItem: icon slot + label, selection highlight, optional label scrim.
 */
import { createElement, type ReactNode } from "react";
import { Group, Rect, Text, FONT_H } from "@moire/react-host";
import { themePalette } from "../theme.js";
import { ScrollArea } from "./scroll.js";
import { Pressable } from "./pressable.js";

/* ---------- GridItem ---------- */

export type GridItemProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** Icon or image shown in the upper portion. */
  icon?: ReactNode;
  label: string;
  selected?: boolean;
  onPress?: () => void;
  onDoublePress?: () => void;
  /** Gradient scrim behind label text (useful for desktop icon-over-wallpaper). */
  labelScrim?: boolean;
};

export function GridItem(props: GridItemProps): ReactNode {
  const pal = themePalette();
  const iconAreaH = Math.max(0, props.height - FONT_H - 8);
  const labelY = iconAreaH + 4;
  const tw = Math.min(props.width - 4, props.width);
  const tx = Math.max(2, Math.floor((props.width - tw) / 2));

  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
    },
    // Selection wash
    props.selected
      ? createElement(Rect, {
          x: 0,
          y: 0,
          width: props.width,
          height: props.height,
          fill: pal.selection,
        })
      : null,
    // Pressable hit surface
    createElement(Pressable, {
      x: 0,
      y: 0,
      width: props.width,
      height: props.height,
      onPress: props.onPress,
      onDoublePress: props.onDoublePress,
    }),
    // Icon area
    props.icon
      ? createElement(
          Group,
          {
            x: Math.floor((props.width - iconAreaH) / 2),
            y: 4,
            width: iconAreaH,
            height: iconAreaH,
          },
          props.icon,
        )
      : null,
    // Optional scrim behind label
    props.labelScrim
      ? createElement(Rect, {
          x: 0,
          y: labelY - 2,
          width: props.width,
          height: FONT_H + 6,
          fill: 0x88000000,
        })
      : null,
    // Label
    createElement(Text, {
      x: tx,
      y: labelY,
      text: props.label,
      color: pal.text,
      fontSize: 11,
    }),
  );
}

/* ---------- Grid ---------- */

export type GridProps<T = unknown> = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  itemWidth: number;
  itemHeight: number;
  gap?: number;
  scrollbar?: boolean;
};

export function Grid<T>(props: GridProps<T>): ReactNode {
  const gap = props.gap ?? 8;
  const cols = Math.max(
    1,
    Math.floor((props.width + gap) / (props.itemWidth + gap)),
  );
  const rows = Math.ceil(props.items.length / cols);
  const contentHeight =
    rows > 0 ? rows * (props.itemHeight + gap) - gap : 0;

  const children = props.items.map((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return createElement(
      Group,
      {
        key: i,
        x: col * (props.itemWidth + gap),
        y: row * (props.itemHeight + gap),
        width: props.itemWidth,
        height: props.itemHeight,
      },
      props.renderItem(item, i),
    );
  });

  return createElement(
    ScrollArea,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
      contentHeight: Math.max(props.height, contentHeight),
      scrollbar: props.scrollbar,
    },
    ...children,
  );
}
