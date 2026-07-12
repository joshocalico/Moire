import { createElement, type ReactNode } from "react";
import { FONT_H, Group, Rect, Text, measureText } from "@moire/react-host";

export const TITLEBAR_H = 32;
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
  const focused = props.focused !== false;
  const bg = focused ? 0xff2a2e33 : 0xff1e2126;
  const fg = focused ? 0xfff1f3f5 : 0xff9aa0a6;
  const accent = 0xff1a6b7a;
  const btnY = Math.floor((TITLEBAR_H - TITLEBAR_BTN) / 2);
  const closeX = props.width - TITLEBAR_BTN_PAD - TITLEBAR_BTN;
  const maxX = closeX - TITLEBAR_BTN_GAP - TITLEBAR_BTN;
  const minX = maxX - TITLEBAR_BTN_GAP - TITLEBAR_BTN;
  const title = props.title || "Window";
  const titleMaxW = Math.max(0, minX - 12);
  let shown = title;
  while (shown.length > 1 && measureText(shown) > titleMaxW) {
    shown = shown.slice(0, -1);
  }
  if (shown !== title && shown.length > 0) shown = `${shown.slice(0, -1)}...`;

  return createElement(
    Group,
    { x: props.x, y: props.y, width: props.width, height: TITLEBAR_H },
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: TITLEBAR_H,
      fill: bg,
      onPress: props.onDrag,
    }),
    createElement(Rect, {
      x: 0,
      y: TITLEBAR_H - 1,
      width: props.width,
      height: 1,
      fill: accent,
    }),
    createElement(Text, {
      x: 10,
      y: Math.floor((TITLEBAR_H - FONT_H) / 2),
      text: shown,
      color: fg,
    }),
    createElement(Rect, {
      x: minX,
      y: btnY,
      width: TITLEBAR_BTN,
      height: TITLEBAR_BTN,
      fill: 0xff3a3f46,
      onPress: props.onMinimize,
    }),
    createElement(Text, {
      x: minX + 10,
      y: btnY + Math.floor((TITLEBAR_BTN - FONT_H) / 2),
      text: "-",
      color: fg,
    }),
    createElement(Rect, {
      x: maxX,
      y: btnY,
      width: TITLEBAR_BTN,
      height: TITLEBAR_BTN,
      fill: 0xff3a3f46,
      onPress: props.onMaximize,
    }),
    createElement(Text, {
      x: maxX + 8,
      y: btnY + Math.floor((TITLEBAR_BTN - FONT_H) / 2),
      text: "+",
      color: fg,
    }),
    createElement(Rect, {
      x: closeX,
      y: btnY,
      width: TITLEBAR_BTN,
      height: TITLEBAR_BTN,
      fill: focused ? 0xffa33b3b : 0xff5a3030,
      onPress: props.onClose,
    }),
    createElement(Text, {
      x: closeX + 10,
      y: btnY + Math.floor((TITLEBAR_BTN - FONT_H) / 2),
      text: "x",
      color: 0xffffffff,
    }),
  );
}
