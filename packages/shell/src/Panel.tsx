import { createElement, type ReactNode } from "react";
import { FONT_H, Group, Rect, Text, measureText } from "@moire/react-host";

export type PanelProps = {
  screenW: number;
  screenH: number;
  clock?: string;
  onLauncherClick?: () => void;
};

export const PANEL_H = 36;

/** Bottom panel — brand + Apps affordance + clock. */
export function Panel(props: PanelProps): ReactNode {
  const y = props.screenH - PANEL_H;
  const clock = props.clock ?? "";
  const clockW = measureText(clock) + 16;
  return createElement(
    Group,
    { x: 0, y, width: props.screenW, height: PANEL_H },
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.screenW,
      height: PANEL_H,
      fill: 0xe8121a1f,
    }),
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.screenW,
      height: 1,
      fill: 0xff1a6b7a,
    }),
    createElement(Text, {
      x: 14,
      y: Math.floor((PANEL_H - FONT_H) / 2),
      text: "Moire",
      color: 0xffe8f4f6,
    }),
    createElement(Rect, {
      x: 70,
      y: 6,
      width: 64,
      height: PANEL_H - 12,
      fill: 0xff1a6b7a,
      onPress: props.onLauncherClick,
    }),
    createElement(Text, {
      x: 82,
      y: Math.floor((PANEL_H - FONT_H) / 2),
      text: "Apps",
      color: 0xffffffff,
    }),
    createElement(Text, {
      x: props.screenW - clockW,
      y: Math.floor((PANEL_H - FONT_H) / 2),
      text: clock,
      color: 0xffb8d4da,
    }),
  );
}
