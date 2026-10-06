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
  actions?: WindowActions;
};

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
  const control = Math.max(0, Math.min(height, Math.round(30 * scale), (props.width - pad) / 3));
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
  const identityWidth = Math.min(identityEnd, titleWidth + iconWidth + pad * 3);
  const tabsWidth = Math.max(0, controlsX - identityWidth - pad);
  const lastPress = useRef<number | null>(null);
  const toggleMaximized = () => {
    if (props.actions) props.actions.setMaximized(!props.actions.isMaximized());
  };
  const maximized = props.actions?.isMaximized() ?? false;

  return (
    <Surface width={props.width} height={height} fill={pal.panel} clip>
      <Rect
        width={props.width}
        height={height}
        fill={0x00000000}
        onPointerDown={
          props.actions
            ? (event) => {
                if (event.button !== "left") return;
                const now = Date.now();
                if (lastPress.current !== null && now - lastPress.current < 400) {
                  lastPress.current = null;
                  toggleMaximized();
                } else {
                  lastPress.current = now;
                  props.actions?.beginMove();
                }
              }
            : undefined
        }
      />
      <Group x={pad} width={Math.max(0, identityWidth - pad)} height={height} clip>
        {props.icon ? (
          <Group y={Math.max(0, (height - iconWidth) / 2)} width={iconWidth} height={iconWidth}>
            {props.icon}
          </Group>
        ) : null}
        <Label
          x={iconWidth ? iconWidth + pad : 0}
          width={Math.max(0, identityWidth - pad * 2 - iconWidth)}
          height={height}
          text={props.title}
          fontSize={fontSize}
          fontWeight="medium"
          verticalAlign="center"
          overflow="ellipsis"
        />
      </Group>
      {props.tabs && tabsWidth > 0 ? (
        <Group x={identityWidth} width={tabsWidth} height={height} clip>
          {props.tabs({ width: tabsWidth, height })}
        </Group>
      ) : null}
      {props.actions ? (
        <Group
          x={controlsX}
          y={Math.max(0, (height - control) / 2)}
          width={controlsWidth}
          height={control}
          clip
        >
          <IconButton
            width={control}
            height={control}
            focusId="window:minimize"
            icon={(style) => (
              <Icon name="minimize" size={style.size} color={style.color} symbolic />
            )}
            tooltip="Minimize"
            onPress={() => props.actions?.minimize()}
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
            onPress={toggleMaximized}
          />
          <IconButton
            x={control * 2}
            width={control}
            height={control}
            focusId="window:close"
            icon={(style) => <Icon name="close" size={style.size} color={style.color} symbolic />}
            color={pal.danger}
            tooltip="Close"
            onPress={() => props.actions?.requestClose()}
          />
        </Group>
      ) : null}
      <Rect y={Math.max(0, height - 1)} width={props.width} height={1} fill={pal.borderSubtle} />
    </Surface>
  );
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
