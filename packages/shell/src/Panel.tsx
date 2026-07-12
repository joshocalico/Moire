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
export const PANEL_H = 42;

/** Bottom panel — brand + Apps affordance + clock. */
export function Panel(props: PanelProps): ReactNode {
  const pal = themePalette();
  const panelH = pal.panelHeight;
  const y = props.screenH - panelH;
  const clock = props.clock ?? "";
  const clockW = measureText(clock) + 16;
  const brandSize = 24;
  return createElement(
    Group,
    { x: 0, y, width: props.screenW, height: panelH },
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.screenW,
      height: panelH,
      fill: pal.panel,
    }),
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.screenW,
      height: 1,
      fill: pal.rimLight,
    }),
    createElement(Label, {
      x: 14,
      y: Math.floor((panelH - brandSize) / 2),
      text: "Moire",
      color: pal.text,
      fontSize: brandSize,
      fontWeight: "medium",
    }),
    createElement(Button, {
      x: 100,
      y: Math.floor((panelH - 28) / 2),
      width: 68,
      height: 28,
      label: "Apps",
      variant: "secondary",
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
