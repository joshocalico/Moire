import type { DesktopEntry } from "@moire/app-discovery";
import { createElement, type ReactNode } from "react";
import { Group, Rect, Text } from "@moire/react-host";
import { themePalette } from "@moire/theme";
import { PANEL_H } from "./Panel.js";
import { Label, Surface } from "./widgets.js";

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
const ROW_H = 28;
const PAD = 16;
const FONT = 13;

/** Super-key app launcher overlay. */
export function Launcher(props: LauncherProps): ReactNode {
  if (!props.open) return null;
  const pal = themePalette();

  const boxH = PAD * 2 + 36 + props.apps.length * ROW_H + 24;
  const x = Math.floor((props.screenW - BOX_W) / 2);
  const y = Math.floor((props.screenH - PANEL_H - boxH) / 2);
  const q = props.query.length > 0 ? props.query : "Type to filter...";
  const qColor = props.query.length > 0 ? pal.text : pal.muted;

  const rows = props.apps.map((app, i) => {
    const rowY = PAD + 40 + i * ROW_H;
    const selected = i === props.selected;
    return createElement(
      Group,
      { key: app.id, x: PAD, y: rowY, width: BOX_W - PAD * 2, height: ROW_H },
      selected
        ? createElement(Rect, {
            x: 0,
            y: 0,
            width: BOX_W - PAD * 2,
            height: ROW_H - 2,
            fill: pal.accentLine,
          })
        : null,
      createElement(Rect, {
        x: 0,
        y: 0,
        width: BOX_W - PAD * 2,
        height: ROW_H - 2,
        fill: 0x00000000,
        onPress: () => props.onLaunch(app),
      }),
      createElement(Text, {
        x: 10,
        y: Math.floor((ROW_H - FONT) / 2) - 1,
        text: truncate(app.name, 48),
        color: pal.text,
        fontSize: FONT,
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
      height: props.screenH - PANEL_H,
      fill: 0x99080c0e,
      onPress: props.onDismiss,
    }),
    createElement(
      Surface,
      {
        x,
        y,
        width: BOX_W,
        height: boxH,
        fill: 0xf2141c22,
      },
      createElement(Rect, {
        x: 0,
        y: 0,
        width: BOX_W,
        height: 2,
        fill: pal.accent,
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
        y: PAD + 18,
        width: BOX_W - PAD * 2,
        height: 22,
        fill: 0xff0c1216,
      }),
      createElement(Text, {
        x: PAD + 8,
        y: PAD + 22,
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
