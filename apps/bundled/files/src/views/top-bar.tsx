/** The top bar: back and forward, the search field in the middle, the window menu and controls. */
import React, { type ReactNode } from "react";
import {
  Box,
  Icon,
  IconButton,
  WindowControls,
  WindowMoveArea,
  getUiScaleFactor,
  windowControlSize,
  type HitPointerEvent,
  type WindowActions,
} from "@moire/ui";

const BUTTON = 32;
const SEARCH_MAX = 440;
const EDGE = 16;
const GAP = 8;

export function TopBar(props: {
  width: number;
  height: number;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack(): void;
  onForward(): void;
  /** Draws the search field into the width it is given. */
  search: (width: number, height: number) => ReactNode;
  onWindowMenu(event?: HitPointerEvent): void;
  window?: WindowActions;
}): ReactNode {
  const ui = getUiScaleFactor();
  const button = Math.round(BUTTON * ui);
  const edge = Math.round(EDGE * ui);
  const gap = Math.round(GAP * ui);
  const y = Math.round((props.height - button) / 2);
  const controls = props.window ? windowControlSize() * 3 + Math.round(12 * ui) : 0;
  const menuX = props.width - controls - edge - button + (props.window ? edge - gap : 0);
  const navigationEnd = edge + button * 2 + gap * 3;
  // Centred on the bar when there is room, otherwise between the arrows and the menu.
  const searchMax = Math.max(1, menuX - gap - navigationEnd);
  const searchWidth = Math.min(Math.round(SEARCH_MAX * ui), searchMax);
  const searchX = Math.max(
    navigationEnd,
    Math.min(Math.round((props.width - searchWidth) / 2), menuX - gap - searchWidth),
  );
  const navigation = (
    icon: "back" | "forward",
    tooltip: string,
    enabled: boolean,
    onPress: () => void,
    x: number,
  ) => (
    <IconButton
      x={x}
      y={y}
      width={button}
      height={button}
      variant="ghost"
      focusId={`files:${icon}`}
      tooltip={tooltip}
      disabled={!enabled}
      icon={(style) => <Icon symbolic name={icon} size={Math.round(18 * ui)} color={style.color} />}
      onPress={onPress}
    />
  );
  return (
    <Box width={props.width} height={props.height}>
      {props.window ? (
        <WindowMoveArea width={props.width} height={props.height} actions={props.window} />
      ) : null}
      {navigation("back", "Back · Alt+Left", props.canGoBack, props.onBack, edge)}
      {navigation(
        "forward",
        "Forward · Alt+Right",
        props.canGoForward,
        props.onForward,
        edge + button + gap,
      )}
      <Box x={searchX} y={y} width={searchWidth} height={button}>
        {props.search(searchWidth, button)}
      </Box>
      <IconButton
        x={menuX}
        y={y}
        width={button}
        height={button}
        variant="ghost"
        focusId="files:window-menu"
        tooltip="Menu"
        icon={(style) => (
          <Icon symbolic name="more" size={Math.round(18 * ui)} color={style.color} />
        )}
        onPress={props.onWindowMenu}
      />
      {props.window ? (
        <WindowControls
          x={props.width - windowControlSize() * 3 - Math.round(12 * ui)}
          y={Math.round((props.height - windowControlSize()) / 2)}
          actions={props.window}
        />
      ) : null}
    </Box>
  );
}
