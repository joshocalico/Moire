import React, { type ReactNode } from "react";
import { Group, Rect, Text, measureTextBounds } from "@moire/react-host";
import { themePalette, getTheme, windowControlLayout } from "@moire/theme";
import { Icon, Pressable, applicationIcon } from "./widgets";

export const TITLEBAR_H = 34;
export const TITLEBAR_BTN = 28;
export const TITLEBAR_BTN_GAP = 4;
export const TITLEBAR_BTN_PAD = 6;

export type TitleBarProps = {
  x: number;
  y: number;
  width: number;
  title: string;
  appId?: string;
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
  const family = getTheme().family;
  const closeBounds = measureTextBounds("×", {
    fontSize: 17,
    fontWeight: "medium",
  });

  return (
    <Group
      x={props.x}
      y={Math.floor((pal.titlebarHeight - TITLEBAR_BTN) / 2)}
      width={TITLEBAR_BTN}
      height={TITLEBAR_BTN}
    >
      <Pressable
        width={TITLEBAR_BTN}
        height={TITLEBAR_BTN}
        fill={0x00000000}
        radius={family === "gnomish" ? 14 : pal.radiusSm + 1}
        hoverFill={
          family !== "cupertino" && props.kind === "close" && family === "redmond"
            ? pal.danger
            : pal.hover
        }
        onPress={props.onPress}
      />
      {family === "cupertino" ? (
        <Rect
          x={8}
          y={8}
          width={12}
          height={12}
          radius={6}
          fill={
            props.kind === "close"
              ? 0xffff6059
              : props.kind === "minimize"
                ? 0xffffbd2e
                : 0xff28c840
          }
        />
      ) : null}
      {family !== "cupertino" && props.kind === "minimize" ? (
        <Rect x={9} y={16} width={10} height={1} radius={1} fill={props.color} />
      ) : null}
      {family !== "cupertino" && props.kind === "maximize" && props.maximized ? (
        <Rect x={10} y={8} width={9} height={9} radius={1} stroke={props.color} strokeWidth={1} />
      ) : null}
      {family !== "cupertino" && props.kind === "maximize" ? (
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
      {family !== "cupertino" && props.kind === "close" ? (
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
  const { closeX, maxX, minX, titleX, titleEnd } = windowControlLayout(
    props.width,
    getTheme().family,
  );
  const title = props.title || "Window";
  const fontSize = 13;
  const textX = getTheme().family === "cupertino" ? titleX : titleX + 4;
  const titleMaxW = Math.max(0, titleEnd - textX);
  let shown = title;
  const titleWidth = (text: string) =>
    measureTextBounds(text, { fontSize, fontWeight: "medium" }).width;
  if (titleWidth(title) > titleMaxW) {
    while (shown.length && titleWidth(`${shown}…`) > titleMaxW) shown = shown.slice(0, -1);
    shown = titleWidth("…") <= titleMaxW ? `${shown}…` : "";
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
      <Rect y={titlebarH - 1} width={props.width} height={1} fill={pal.rimShade} />

      {getTheme().family !== "cupertino" ? (
        <Icon
          x={12}
          y={Math.floor((titlebarH - 16) / 2)}
          name={applicationIcon(props.appId || props.title)}
          symbolic
          size={16}
          color={focused ? pal.accent : pal.muted}
        />
      ) : null}
      <Text x={textX} y={titleY} text={shown} color={fg} fontSize={fontSize} fontWeight="medium" />

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
