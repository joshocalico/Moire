import type { DesktopEntry } from "@moire/app-discovery";
import { createElement, type ReactNode } from "react";
import { FONT_H, Group, Rect, Text, measureText } from "@moire/react-host";
import { PANEL_H } from "./Panel.js";

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

/** Super-key app launcher overlay. */
export function Launcher(props: LauncherProps): ReactNode {
  if (!props.open) return null;

  const boxH = PAD * 2 + 36 + props.apps.length * ROW_H + 24;
  const x = Math.floor((props.screenW - BOX_W) / 2);
  const y = Math.floor((props.screenH - PANEL_H - boxH) / 2);
  const q = props.query.length > 0 ? props.query : "Type to filter...";
  const qColor = props.query.length > 0 ? 0xffe8f4f6 : 0xff6a8a92;

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
            fill: 0xff1a6b7a,
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
        y: Math.floor((ROW_H - FONT_H) / 2) - 1,
        text: truncate(app.name, 48),
        color: 0xfff2f8fa,
      }),
    );
  });

  return createElement(
    Group,
    { x: 0, y: 0, width: props.screenW, height: props.screenH },
    // Dim backdrop — click dismisses via controller outside-hit path.
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.screenW,
      height: props.screenH - PANEL_H,
      fill: 0x99080c0e,
      onPress: props.onDismiss,
    }),
    createElement(
      Group,
      { x, y, width: BOX_W, height: boxH },
      createElement(Rect, {
        x: 0,
        y: 0,
        width: BOX_W,
        height: boxH,
        fill: 0xf2141c22,
      }),
      createElement(Rect, {
        x: 0,
        y: 0,
        width: BOX_W,
        height: 2,
        fill: 0xff2a8a9a,
      }),
      createElement(Text, {
        x: PAD,
        y: PAD,
        text: "Launch",
        color: 0xff8ec4ce,
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
        text: truncate(q, Math.floor((BOX_W - PAD * 2 - 16) / 6)),
        color: qColor,
      }),
      ...rows,
    ),
  );
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + "…";
}

void measureText;
