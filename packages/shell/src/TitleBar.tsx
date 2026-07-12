import { createElement, type ReactNode } from "react";
import { Group, Rect, measureText } from "@moire/react-host";
import { themePalette } from "@moire/theme";
import { Button, Label } from "./widgets.js";

export const TITLEBAR_H = 34;
export const TITLEBAR_BTN = 28;
export const TITLEBAR_BTN_GAP = 4;
export const TITLEBAR_BTN_PAD = 6;

export type TitleBarProps = {
  x: number;
  y: number;
  width: number;
  title: string;
  focused?: boolean;
  onClose?: () => void;
  onMaximize?: () => void;
  onMinimize?: () => void;
  onDrag?: () => void;
};

/** Server-side decoration titlebar — painted via react-host into the scene. */
export function TitleBar(props: TitleBarProps): ReactNode {
  const pal = themePalette();
  const titlebarH = pal.titlebarHeight;
  const focused = props.focused !== false;
  const bg = focused ? pal.titlebar : pal.titlebarInactive;
  const fg = focused ? pal.text : pal.muted;
  const btnY = Math.floor((titlebarH - TITLEBAR_BTN) / 2);
  const closeX = props.width - TITLEBAR_BTN_PAD - TITLEBAR_BTN;
  const maxX = closeX - TITLEBAR_BTN_GAP - TITLEBAR_BTN;
  const minX = maxX - TITLEBAR_BTN_GAP - TITLEBAR_BTN;
  const title = props.title || "Window";
  const titleMaxW = Math.max(0, minX - 12);
  const fontSize = 13;
  let shown = title;
  while (shown.length > 1 && measureText(shown) > titleMaxW) {
    shown = shown.slice(0, -1);
  }
  if (shown !== title && shown.length > 0) shown = `${shown.slice(0, -1)}...`;

  return createElement(
    Group,
    { x: props.x, y: props.y, width: props.width, height: titlebarH },
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: titlebarH,
      fill: bg,
      onPress: props.onDrag,
    }),
    createElement(Rect, {
      x: 0,
      y: titlebarH - 1,
      width: props.width,
      height: 1,
      fill: pal.rimLight,
    }),
    createElement(Label, {
      x: 10,
      y: Math.floor((titlebarH - fontSize) / 2),
      text: shown,
      color: fg,
      fontSize,
      fontWeight: "medium",
    }),
    createElement(Button, {
      x: minX,
      y: btnY,
      width: TITLEBAR_BTN,
      height: TITLEBAR_BTN,
      label: "-",
      variant: "ghost",
      color: fg,
      onPress: props.onMinimize,
    }),
    createElement(Button, {
      x: maxX,
      y: btnY,
      width: TITLEBAR_BTN,
      height: TITLEBAR_BTN,
      label: "+",
      variant: "ghost",
      color: fg,
      onPress: props.onMaximize,
    }),
    createElement(Button, {
      x: closeX,
      y: btnY,
      width: TITLEBAR_BTN,
      height: TITLEBAR_BTN,
      label: "x",
      variant: "ghost",
      color: focused ? pal.danger : fg,
      onPress: props.onClose,
    }),
  );
}
