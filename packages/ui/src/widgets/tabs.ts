/**
 * Tabs — underline indicator on the active tab (replaces full-slab style).
 */
import { createElement, type ReactNode } from "react";
import { Group, Rect, Text, measureTextBounds } from "@moire/react-host";
import { themePalette } from "../theme.js";
import { Pressable } from "./pressable.js";

export type TabsProps = {
  x?: number;
  y?: number;
  width: number;
  tabs: string[];
  active: number;
  onChange?: (index: number) => void;
  height?: number;
};

const UNDERLINE_H = 2;

export function Tabs(props: TabsProps): ReactNode {
  const pal = themePalette();
  const h = props.height ?? 32;
  const n = Math.max(1, props.tabs.length);
  const tw = Math.floor(props.width / n);
  const lineH = measureTextBounds("Mg", { fontSize: 14 }).height;

  return createElement(
    Group,
    { x: props.x ?? 0, y: props.y ?? 0, width: props.width, height: h },
    // Background strip
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: h,
      fill: pal.surface,
    }),
    ...props.tabs.map((tab, i) => {
      const isActive = i === props.active;
      const ty = Math.floor((h - lineH - UNDERLINE_H) / 2);

      return createElement(
        Group,
        { key: i, x: i * tw, y: 0, width: tw, height: h },
        createElement(Pressable, {
          x: 0,
          y: 0,
          width: tw,
          height: h,
          onPress: () => props.onChange?.(i),
        }),
        createElement(Text, {
          x: 8,
          y: ty,
          text: tab,
          color: isActive ? pal.accent : pal.muted,
          fontWeight: isActive ? "medium" : "regular",
        }),
        // Active underline
        isActive
          ? createElement(Rect, {
              x: 0,
              y: h - UNDERLINE_H,
              width: tw,
              height: UNDERLINE_H,
              fill: pal.accentLine,
            })
          : null,
      );
    }),
    // Bottom border line
    createElement(Rect, {
      x: 0,
      y: h - 1,
      width: props.width,
      height: 1,
      fill: pal.border,
    }),
  );
}
