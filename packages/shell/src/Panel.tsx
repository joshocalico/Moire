import { createElement, type ReactNode } from "react";
import { Group, Rect, Text, measureText } from "@moire/react-host";
import { themePalette } from "@moire/theme";
import { Button, Label } from "./widgets.js";

export type PanelProps = {
  screenW: number;
  screenH: number;
  clock?: string;
  onLauncherClick?: () => void;
};

export const PANEL_H = 36;

/** Bottom panel — brand + Apps affordance + clock. */
export function Panel(props: PanelProps): ReactNode {
  const pal = themePalette();
  const y = props.screenH - PANEL_H;
  const clock = props.clock ?? "";
  const clockW = measureText(clock) + 16;
  const brandSize = 22;
  return createElement(
    Group,
    { x: 0, y, width: props.screenW, height: PANEL_H },
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.screenW,
      height: PANEL_H,
      fill: pal.panel,
    }),
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.screenW,
      height: 1,
      fill: pal.accentLine,
    }),
    createElement(Label, {
      x: 14,
      y: Math.floor((PANEL_H - brandSize) / 2),
      text: "Moire",
      color: pal.text,
      fontSize: brandSize,
      fontWeight: "medium",
    }),
    createElement(Button, {
      x: 100,
      y: 6,
      width: 64,
      height: PANEL_H - 12,
      label: "Apps",
      fill: pal.accentLine,
      color: 0xffffffff,
      onPress: props.onLauncherClick,
    }),
    createElement(Text, {
      x: props.screenW - clockW,
      y: Math.floor((PANEL_H - 14) / 2),
      text: clock,
      color: pal.muted,
      fontSize: 13,
    }),
  );
}
