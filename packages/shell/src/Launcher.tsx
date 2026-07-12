import type { DesktopEntry } from "@moire/app-discovery";
import { createElement, type ReactNode } from "react";
import { Group, Rect, Text } from "@moire/react-host";
import { themePalette } from "@moire/theme";
import { Label, ListItem, Surface } from "./widgets.js";

export type LauncherProps = {
  open: boolean;
  screenW: number;
  screenH: number;
  apps: DesktopEntry[];
  query: string;
  selected: number;
  onQueryChange: (q: string) => void;
  onLaunch: (app: DesktopEntry) => void;
  onDismiss: () => void;
  onSelect: (i: number) => void;
};

const BOX_W = 440;
const ROW_H = 36;
const PAD = 18;
const FONT = 13;

/** Super-key app launcher overlay. */
export function Launcher(props: LauncherProps): ReactNode {
  if (!props.open) return null;
  const pal = themePalette();
  const panelH = pal.panelHeight;

  const boxH = PAD * 2 + 46 + props.apps.length * ROW_H + 10;
  const x = Math.floor((props.screenW - BOX_W) / 2);
  const y = Math.floor((props.screenH - panelH - boxH) / 2);
  const q = props.query.length > 0 ? props.query : "Type to filter...";
  const qColor = props.query.length > 0 ? pal.text : pal.muted;

  const rows = props.apps.map((app, i) => {
    const rowY = PAD + 46 + i * ROW_H;
    const selected = i === props.selected;
    return createElement(
      Group,
      { key: app.id, x: PAD, y: rowY, width: BOX_W - PAD * 2, height: ROW_H },
      createElement(ListItem, {
        x: 0,
        y: 0,
        width: BOX_W - PAD * 2,
        height: ROW_H - 2,
        title: truncate(app.name, 48),
        selected,
        onPress: () => props.onLaunch(app),
      }),
    );
  });

  return createElement(
    Group,
    { x: 0, y: 0, width: props.screenW, height: props.screenH },
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.screenW,
      height: props.screenH - panelH,
      fill: pal.overlay,
      onPress: props.onDismiss,
    }),
    createElement(
      Surface,
      {
        x,
        y,
        width: BOX_W,
        height: boxH,
        fill: pal.surface,
      },
      createElement(Rect, {
        x: 0,
        y: 0,
        width: BOX_W,
        height: 1,
        fill: pal.rimLight,
      }),
      createElement(Label, {
        x: PAD,
        y: PAD,
        text: "Launch",
        color: pal.accent,
        fontSize: 14,
        fontWeight: "medium",
      }),
      createElement(Rect, {
        x: PAD,
        y: PAD + 19,
        width: BOX_W - PAD * 2,
        height: 22,
        fill: pal.panel,
      }),
      createElement(Text, {
        x: PAD + 8,
        y: PAD + 23,
        text: truncate(q, 40),
        color: qColor,
        fontSize: FONT,
      }),
      ...rows,
    ),
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}
