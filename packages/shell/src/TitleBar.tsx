import React, { type ReactNode } from "react";
import { Group, Rect, Text, measureText, measureTextBounds } from "@moire/react-host";
import { themePalette } from "@moire/theme";
import { Pressable } from "./widgets";

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
  maximized?: boolean;
  onClose?: () => void;
  onMaximize?: () => void;
  onMinimize?: () => void;
  onDrag?: () => void;
};

type WindowControlProps = {
  x: number;
  kind: "minimize" | "maximize" | "close";
  maximized?: boolean;
  color: number;
  onPress?: () => void;
};

function WindowControl(props: WindowControlProps): ReactNode {
  const pal = themePalette();
  const closeBounds = measureTextBounds("×", {
    fontSize: 17,
    fontWeight: "medium",
  });

  return (
    <Group x={props.x} y={3} width={TITLEBAR_BTN} height={TITLEBAR_BTN}>
      <Pressable
        width={TITLEBAR_BTN}
        height={TITLEBAR_BTN}
        fill={0x00000000}
        radius={pal.radiusSm + 1}
        onPress={props.onPress}
      />
      {props.kind === "minimize" ? (
        <Rect x={9} y={16} width={10} height={1} radius={1} fill={props.color} />
      ) : null}
      {props.kind === "maximize" && props.maximized ? (
        <Rect x={10} y={8} width={9} height={9} radius={1} stroke={props.color} strokeWidth={1} />
      ) : null}
      {props.kind === "maximize" ? (
        <Rect
          x={props.maximized ? 8 : 9}
          y={props.maximized ? 10 : 9}
          width={props.maximized ? 9 : 10}
          height={props.maximized ? 9 : 10}
          radius={1}
          stroke={props.color}
          strokeWidth={1}
        />
      ) : null}
      {props.kind === "close" ? (
        <Text
          x={Math.floor((TITLEBAR_BTN - closeBounds.width) / 2)}
          y={Math.floor((TITLEBAR_BTN - closeBounds.height) / 2)}
          text="×"
          color={props.color}
          fontSize={17}
          fontWeight="medium"
        />
      ) : null}
    </Group>
  );
}

/** Server-side decoration titlebar — renderer-independent React scene chrome. */
export function TitleBar(props: TitleBarProps): ReactNode {
  const pal = themePalette();
  const titlebarH = pal.titlebarHeight;
  const focused = props.focused !== false;
  const bg = focused ? pal.titlebar : pal.titlebarInactive;
  const fg = focused ? pal.text : pal.muted;
  const controlFg = focused ? pal.muted : pal.rimLight;
  const closeX = props.width - TITLEBAR_BTN_PAD - TITLEBAR_BTN;
  const maxX = closeX - TITLEBAR_BTN_GAP - TITLEBAR_BTN;
  const minX = maxX - TITLEBAR_BTN_GAP - TITLEBAR_BTN;
  const title = props.title || "Window";
  const fontSize = 13;
  const titleX = 27;
  const titleMaxW = Math.max(0, minX - titleX - 10);
  let shown = title;
  while (shown.length > 1 && measureText(shown, fontSize / 14) > titleMaxW) {
    shown = shown.slice(0, -1);
  }
  if (shown !== title && shown.length > 0) {
    shown = `${shown.slice(0, -1)}…`;
  }
  const titleBounds = measureTextBounds("Mg", {
    fontSize,
    fontWeight: "medium",
  });
  const titleY = Math.floor((titlebarH - titleBounds.height) / 2);
  const radius = Math.min(pal.radiusWindow, Math.floor(titlebarH / 2));

  return (
    <Group x={props.x} y={props.y} width={props.width} height={titlebarH}>
      {/* Rounded only at the exposed top edge; the lower rect seals to content. */}
      <Rect
        width={props.width}
        height={titlebarH}
        fill={bg}
        radius={radius}
        onPress={props.onDrag}
      />
      <Rect
        y={radius}
        width={props.width}
        height={titlebarH - radius}
        fill={bg}
        onPress={props.onDrag}
      />
      <Rect
        x={radius}
        width={Math.max(0, props.width - radius * 2)}
        height={1}
        fill={pal.rimLight}
      />
      <Rect y={titlebarH - 1} width={props.width} height={1} fill={pal.rimShade} />

      {/* A quiet focus jewel gives the title an anchor without an app-icon box. */}
      <Rect
        x={13}
        y={Math.floor((titlebarH - 6) / 2)}
        width={6}
        height={6}
        radius={3}
        fill={focused ? pal.accent : pal.border}
      />
      <Text x={titleX} y={titleY} text={shown} color={fg} fontSize={fontSize} fontWeight="medium" />

      <WindowControl x={minX} kind="minimize" color={controlFg} onPress={props.onMinimize} />
      <WindowControl
        x={maxX}
        kind="maximize"
        maximized={props.maximized}
        color={controlFg}
        onPress={props.onMaximize}
      />
      <WindowControl
        x={closeX}
        kind="close"
        color={focused ? pal.danger : controlFg}
        onPress={props.onClose}
      />
    </Group>
  );
}
