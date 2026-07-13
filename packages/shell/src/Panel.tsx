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

/** Default metric; live chrome reads themePalette().panelHeight. */
export const PANEL_H = 48;

/** Bottom panel — brand hero + quiet Apps + clock. */
export function Panel(props: PanelProps): ReactNode {
  const pal = themePalette();
  const panelH = Math.max(pal.panelHeight, 46);
  const y = props.screenH - panelH;
  const clock = props.clock ?? "";
  const clockW = measureText(clock) + 20;
  const brandSize = 26;
  // Translucent ink panel over wallpaper
  const panelFill = (pal.panel & 0x00ffffff) | 0xdd000000;
  return createElement(
    Group,
    { x: 0, y, width: props.screenW, height: panelH },
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.screenW,
      height: panelH,
      fill: panelFill,
    }),
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.screenW,
      height: 1,
      fill: pal.rimLight,
    }),
    createElement(Rect, {
      x: 0,
      y: panelH - 1,
      width: props.screenW,
      height: 1,
      fill: pal.rimShade,
    }),
    createElement(Label, {
      x: 18,
      y: Math.floor((panelH - brandSize) / 2) - 1,
      text: "Moire",
      color: pal.text,
      fontSize: brandSize,
      fontWeight: "medium",
    }),
    createElement(Button, {
      x: 112,
      y: Math.floor((panelH - 30) / 2),
      width: 72,
      height: 30,
      label: "Apps",
      variant: "ghost",
      fontSize: 13,
      onPress: props.onLauncherClick,
    }),
    createElement(Text, {
      x: props.screenW - clockW,
      y: Math.floor((panelH - 12) / 2),
      text: clock,
      color: pal.muted,
      fontSize: 12,
    }),
  );
}
