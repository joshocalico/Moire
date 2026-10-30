import React, { useRef, type ReactNode } from "react";
import { Group, Rect, measureTextBounds } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import type { WindowActions, WindowSize } from "#ui/window";
import { useWidgetTheme } from "#ui/widget-theme";
import { IconButton } from "./icon-button";
import { Icon } from "./icon";
import { Label, Surface } from "./primitives";
import { registerIntrinsicSize } from "./layout";

export type WindowHeaderProps = {
  width: number;
  height?: number;
  title: string;
  icon?: ReactNode;
  /** The header allocates tab space after identity and native controls. */
  tabs?: (size: WindowSize) => ReactNode;
  /**
   * The least width the tab slot needs. When the window is too narrow, the title gives way
   * (ellipsized, then icon only, then nothing) before the slot is cut short.
   */
  minTabsWidth?: number;
  actions?: WindowActions;
};

const CONTROL = 30;
const DOUBLE_PRESS_MS = 400;

function headerHeight(): number {
  return Math.round(44 * getUiScaleFactor());
}

/** Shared client chrome with native actions and a bounded, left-aligned tab slot. */
export function WindowHeader(props: WindowHeaderProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const scale = getUiScaleFactor();
  const height = props.height ?? headerHeight();
  const pad = Math.round(theme.foundations.space.sm * scale);
  const control = Math.max(0, Math.min(height, windowControlSize(), (props.width - pad) / 3));
  const controlsWidth = props.actions ? control * 3 + pad : 0;
  const controlsX = Math.max(0, props.width - controlsWidth);
  const identityEnd = Math.max(0, controlsX - pad);
  const iconWidth = props.icon ? Math.round(20 * scale) : 0;
  // The installed font renderer applies the global UI scale to glyphs.
  const fontSize = 13;
  const titleWidth = measureTextBounds(props.title, {
    fontSize,
    fontWeight: "medium",
  }).width;
  const fullIdentity = Math.min(identityEnd, titleWidth + iconWidth + pad * 3);
  const identityWidth =
    props.tabs && props.minTabsWidth
      ? Math.max(
          Math.min(fullIdentity, pad),
          Math.min(fullIdentity, controlsX - pad - props.minTabsWidth),
        )
      : fullIdentity;
  const showIcon = !!props.icon && identityWidth >= iconWidth + pad * 2;
  const labelWidth = Math.max(0, identityWidth - pad * 2 - iconWidth);
  // An icon alone reads better than a title cut down to an ellipsis.
  const showLabel = identityWidth === fullIdentity || labelWidth >= 40 * scale;
  const tabsWidth = Math.max(0, controlsX - identityWidth - pad);
  return (
    <Surface width={props.width} height={height} fill={pal.panel} clip>
      {props.actions ? (
        <WindowMoveArea width={props.width} height={height} actions={props.actions} />
      ) : null}
      <Group x={pad} width={Math.max(0, identityWidth - pad)} height={height} clip>
        {showIcon ? (
          <Group y={Math.max(0, (height - iconWidth) / 2)} width={iconWidth} height={iconWidth}>
            {props.icon}
          </Group>
        ) : null}
        {showLabel ? (
          <Label
            x={iconWidth ? iconWidth + pad : 0}
            width={labelWidth}
            height={height}
            text={props.title}
            fontSize={fontSize}
            fontWeight="medium"
            verticalAlign="center"
            overflow="ellipsis"
          />
        ) : null}
      </Group>
      {props.tabs && tabsWidth > 0 ? (
        <Group x={identityWidth} width={tabsWidth} height={height} clip>
          {props.tabs({ width: tabsWidth, height })}
        </Group>
      ) : null}
      {props.actions ? (
        <WindowControls
          x={controlsX}
          y={Math.max(0, (height - control) / 2)}
          size={control}
          actions={props.actions}
        />
      ) : null}
      <Rect y={Math.max(0, height - 1)} width={props.width} height={1} fill={pal.borderSubtle} />
    </Surface>
  );
}

/** Lay the window's own move gesture under a custom titlebar: drag to move, double-click to maximize. */
export function WindowMoveArea(props: {
  x?: number;
  y?: number;
  width: number;
  height: number;
  actions: WindowActions;
}): ReactNode {
  const lastPress = useRef<number | null>(null);
  return (
    <Rect
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
      fill={0x00000000}
      onPointerDown={(event) => {
        if (event.button !== "left") return;
        const now = Date.now();
        if (lastPress.current !== null && now - lastPress.current < DOUBLE_PRESS_MS) {
          lastPress.current = null;
          props.actions.setMaximized(!props.actions.isMaximized());
        } else {
          lastPress.current = now;
          props.actions.beginMove();
        }
      }}
    />
  );
}

/** Minimize, maximize/restore and close, for any titlebar an app draws itself. */
export function WindowControls(props: {
  x?: number;
  y?: number;
  /** Side of each button; 30 by default, scaled. */
  size?: number;
  actions: WindowActions;
}): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const control = props.size ?? windowControlSize();
  const maximized = props.actions.isMaximized();
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={control * 3} height={control} clip>
      <IconButton
        width={control}
        height={control}
        focusId="window:minimize"
        icon={(style) => <Icon name="minimize" size={style.size} color={style.color} symbolic />}
        tooltip="Minimize"
        onPress={() => props.actions.minimize()}
      />
      <IconButton
        x={control}
        width={control}
        height={control}
        focusId="window:maximize"
        icon={(style) => (
          <Icon
            name={maximized ? "restore" : "maximize"}
            size={style.size}
            color={style.color}
            symbolic
          />
        )}
        tooltip={maximized ? "Restore" : "Maximize"}
        onPress={() => props.actions.setMaximized(!props.actions.isMaximized())}
      />
      <IconButton
        x={control * 2}
        width={control}
        height={control}
        focusId="window:close"
        icon={(style) => <Icon name="close" size={style.size} color={style.color} symbolic />}
        color={pal.danger}
        tooltip="Close"
        onPress={() => props.actions.requestClose()}
      />
    </Group>
  );
}

/** One window control's side at the current UI scale. */
export function windowControlSize(): number {
  return Math.round(CONTROL * getUiScaleFactor());
}

export type WindowFrameProps = Omit<WindowHeaderProps, "height"> & {
  height: number;
  headerHeight?: number;
  children: (size: WindowSize) => ReactNode;
};

/** Allocate chrome and body once so apps do not compute titlebar offsets. */
export function WindowFrame(props: WindowFrameProps): ReactNode {
  const allocatedHeader = Math.min(Math.max(0, props.height), props.headerHeight ?? headerHeight());
  return (
    <Group width={props.width} height={props.height} clip>
      <Group
        y={allocatedHeader}
        width={props.width}
        height={Math.max(0, props.height - allocatedHeader)}
        clip
      >
        {props.children({
          width: props.width,
          height: Math.max(0, props.height - allocatedHeader),
        })}
      </Group>
      <WindowHeader {...props} height={allocatedHeader} />
    </Group>
  );
}

registerIntrinsicSize(WindowHeader, (props) => ({
  width: props.width,
  height: props.height ?? headerHeight(),
}));
