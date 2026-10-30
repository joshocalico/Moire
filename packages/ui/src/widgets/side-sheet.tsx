/**
 * Details on demand: a sheet that slides over the right of the window (the whole width when the
 * window is narrow), with a title, a close button and the caller's content. A scrim press or
 * Escape closes it, and focus stays inside while it is open.
 */
import React, { type ReactNode } from "react";
import { Group } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { useTween } from "#ui/motion";
import { useWidgetTheme } from "#ui/widget-theme";
import { FocusScope } from "./focus";
import { Icon } from "./icon";
import { IconButton } from "./icon-button";
import { ModalBarrier, OverlayPortal } from "./overlay";
import { Separator, Surface, TextBlock } from "./primitives";

export type SideSheetProps = {
  open: boolean;
  viewportWidth: number;
  viewportHeight: number;
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** The sheet's body, given the room under the title. */
  children: (size: { width: number; height: number }) => ReactNode;
  /** Focus id of the close button. */
  closeFocusId?: string;
};

const WIDTH = 360;
/** Below this window width the sheet covers the window. */
const FULL_BELOW = 640;
const HEADER = 60;

/** The sheet's width in a window this wide. */
export function sideSheetWidth(viewportWidth: number): number {
  const ui = getUiScaleFactor();
  return viewportWidth < FULL_BELOW * ui ? viewportWidth : Math.min(WIDTH * ui, viewportWidth);
}

/** The body's height under the sheet's header. */
export function sideSheetBodyHeight(viewportHeight: number): number {
  return Math.max(1, viewportHeight - HEADER * getUiScaleFactor());
}

export function SideSheet(props: SideSheetProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const ui = getUiScaleFactor();
  const progress = useTween(props.open ? 1 : 0, {
    initialValue: 0,
    duration: theme.foundations.motion.normalMs,
    easing: "ease-out",
  });
  if (!props.open && progress <= 0.001) return null;
  const width = sideSheetWidth(props.viewportWidth);
  const header = HEADER * ui;
  const button = 32 * ui;
  const pad = 18 * ui;
  const x = props.viewportWidth - width + Math.round((1 - progress) * 24 * ui);
  return (
    <OverlayPortal>
      <Group width={props.viewportWidth} height={props.viewportHeight}>
        <ModalBarrier
          active={props.open}
          width={props.viewportWidth}
          height={props.viewportHeight}
          onDismiss={props.onClose}
        />
        <FocusScope
          x={x}
          width={width}
          height={props.viewportHeight}
          active={props.open}
          onEscape={props.onClose}
        >
          <Surface
            width={width}
            height={props.viewportHeight}
            fill={pal.panel}
            elevation="high"
            opacity={progress}
            onPress={() => {}}
          >
            <Separator width={1} height={props.viewportHeight} />
            <TextBlock
              x={pad}
              y={props.subtitle ? 12 * ui : 0}
              width={Math.max(1, width - pad - button - 20 * ui)}
              height={props.subtitle ? 22 * ui : header}
              text={props.title}
              fontSize={16}
              fontWeight="medium"
              verticalAlign="center"
              overflow="ellipsis"
              maxLines={1}
            />
            {props.subtitle ? (
              <TextBlock
                x={pad}
                y={34 * ui}
                width={Math.max(1, width - pad - button - 20 * ui)}
                height={16 * ui}
                text={props.subtitle}
                fontSize={11}
                color={pal.muted}
                verticalAlign="center"
                overflow="ellipsis"
                maxLines={1}
              />
            ) : null}
            <IconButton
              x={width - button - 12 * ui}
              y={(header - button) / 2}
              width={button}
              height={button}
              variant="ghost"
              focusId={props.closeFocusId}
              tooltip="Close · Escape"
              tooltipPlacement="left"
              icon={(style) => <Icon name="close" size={16 * ui} color={style.color} symbolic />}
              onPress={props.onClose}
            />
            <Group y={header} width={width} height={sideSheetBodyHeight(props.viewportHeight)}>
              {props.children({ width, height: sideSheetBodyHeight(props.viewportHeight) })}
            </Group>
          </Surface>
        </FocusScope>
      </Group>
    </OverlayPortal>
  );
}
