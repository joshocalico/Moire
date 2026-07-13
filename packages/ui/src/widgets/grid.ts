/**
 * Grid and GridItem — flow-layout grid backed by ScrollArea.
 * GridItem: icon slot + label, selection wash + outline, optional label scrim.
 */
import { createElement, type ReactNode } from "react";
import { Group, Rect, Text, FONT_H, measureText } from "@moire/react-host";
import { themePalette } from "../theme.js";
import { ScrollArea } from "./scroll.js";
import { Pressable } from "./pressable.js";

function ellipsize(text: string, maxWidth: number, fontSize: number): string {
  const scale = fontSize / 14;
  if (measureText(text, scale) <= maxWidth) return text;
  const ell = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + ell;
    if (measureText(candidate, scale) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + ell : ell;
}

/* ---------- GridItem ---------- */

export type GridItemProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** Icon or image shown in the upper portion. */
  icon?: ReactNode;
  /** Pixel size of the icon graphic (for centering). */
  iconSize?: number;
  label: string;
  selected?: boolean;
  onPress?: () => void;
  onDoublePress?: () => void;
  /** Soft scrim behind label (desktop over wallpaper). */
  labelScrim?: boolean;
};

export function GridItem(props: GridItemProps): ReactNode {
  const pal = themePalette();
  const fontSize = 12;
  const labelPad = 4;
  const labelH = FONT_H + 6;
  const iconSize =
    props.iconSize ?? Math.max(24, Math.min(56, props.height - labelH - 14));
  const iconAreaH = props.height - labelH - 6;
  const iconX = Math.floor((props.width - iconSize) / 2);
  const iconY = Math.max(4, Math.floor((iconAreaH - iconSize) / 2));
  const labelY = iconAreaH + 2;
  const labelMaxW = Math.max(8, props.width - labelPad * 2);
  const label = ellipsize(props.label, labelMaxW, fontSize);
  const tw = measureText(label, fontSize / 14);
  const tx = Math.max(labelPad, Math.floor((props.width - tw) / 2));

  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
    },
    props.selected
      ? createElement(Rect, {
          x: 0,
          y: 0,
          width: props.width,
          height: props.height,
          fill: pal.selection,
        })
      : null,
    props.selected
      ? createElement(Rect, {
          x: 0,
          y: 0,
          width: props.width,
          height: 1,
          fill: pal.accent,
        })
      : null,
    props.selected
      ? createElement(Rect, {
          x: 0,
          y: props.height - 1,
          width: props.width,
          height: 1,
          fill: pal.accent,
        })
      : null,
    props.selected
      ? createElement(Rect, {
          x: 0,
          y: 0,
          width: 1,
          height: props.height,
          fill: pal.accent,
        })
      : null,
    props.selected
      ? createElement(Rect, {
          x: props.width - 1,
          y: 0,
          width: 1,
          height: props.height,
          fill: pal.accent,
        })
      : null,
    createElement(Pressable, {
      x: 0,
      y: 0,
      width: props.width,
      height: props.height,
      onPress: props.onPress,
      onDoublePress: props.onDoublePress,
    }),
    props.icon
      ? createElement(
          Group,
          {
            x: iconX,
            y: iconY,
            width: iconSize,
            height: iconSize,
          },
          props.icon,
        )
      : null,
    props.labelScrim
      ? createElement(Rect, {
          x: Math.max(0, tx - 4),
          y: labelY - 1,
          width: Math.min(props.width, tw + 8),
          height: labelH,
          fill: 0xaa0a0c0e,
        })
      : null,
    createElement(Text, {
      x: tx,
      y: labelY + 2,
      text: label,
      color: pal.text,
      fontSize,
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
  padding?: number;
  scrollbar?: boolean;
};

export function Grid<T>(props: GridProps<T>): ReactNode {
  const gap = props.gap ?? 8;
  const pad = props.padding ?? 0;
  const innerW = Math.max(1, props.width - pad * 2);
  const cols = Math.max(
    1,
    Math.floor((innerW + gap) / (props.itemWidth + gap)),
  );
  const rows = Math.ceil(props.items.length / cols);
  const contentHeight =
    pad * 2 + (rows > 0 ? rows * (props.itemHeight + gap) - gap : 0);

  const children = props.items.map((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return createElement(
      Group,
      {
        key: i,
        x: pad + col * (props.itemWidth + gap),
        y: pad + row * (props.itemHeight + gap),
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
