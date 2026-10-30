/**
 * The chrome every Moire app shares. The header bar is the window's own titlebar (client-side):
 * app icon and name, the open document, the app's actions and the window controls in one bar,
 * so a window never shows its title twice. Apps using it open undecorated windows.
 */
import React, { type ReactNode } from "react";
import { Rect } from "@moire/react-host";
import { Horizontal, measureRowWidth } from "./layout";
import { Icon, type IconName } from "./icon";
import { Surface, TextBlock } from "./primitives";
import { WindowHeader } from "./window-frame";
import { getUiScaleFactor } from "#ui/font";
import { useWidgetTheme } from "#ui/widget-theme";
import type { WindowActions } from "#ui/window";

/** Logical heights, before UI scale. */
export const APP_HEADER_HEIGHT = 44;
export const APP_STATUS_HEIGHT = 28;

export type AppHeaderBarProps = {
  width: number;
  title: string;
  icon?: IconName;
  /** The open document or current place, muted beside the title. */
  subtitle?: string;
  /** The app's own actions, right-aligned before the window controls. */
  actions?: ReactNode;
  /** The window this bar belongs to: adds its controls, dragging and double-click maximize. */
  window?: WindowActions | null;
};

export function AppHeaderBar(props: AppHeaderBarProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const ui = getUiScaleFactor();
  const height = Math.round(APP_HEADER_HEIGHT * ui);
  const iconSize = Math.round(18 * ui);
  // Actions never shrink: in a narrow window the subtitle, then the title, give way to them.
  const gap = 8 * ui;
  const actionsWidth = props.actions ? measureRowWidth(props.actions, theme, gap) : 0;
  return (
    <WindowHeader
      width={props.width}
      height={height}
      title={props.title}
      icon={
        props.icon ? <Icon name={props.icon} size={iconSize} color={pal.accent} symbolic /> : null
      }
      actions={props.window ?? undefined}
      minTabsWidth={actionsWidth ? actionsWidth + gap * (props.subtitle ? 2 : 1) : undefined}
      tabs={
        props.subtitle || props.actions
          ? (size) => (
              <Horizontal
                width={size.width - gap}
                height={size.height}
                gap={gap}
                align="center"
                justify="end"
              >
                {/* Yoga does not shrink by default: the subtitle gives way so the actions keep
                    their width and the window controls are never pushed out. */}
                {props.subtitle ? (
                  <TextBlock
                    flexGrow={1}
                    flexShrink={1}
                    minWidth={0}
                    text={props.subtitle}
                    color={pal.muted}
                    fontSize={12}
                    overflow="ellipsis"
                    maxLines={1}
                  />
                ) : null}
                {props.actions ?? null}
              </Horizontal>
            )
          : undefined
      }
    />
  );
}

export type AppStatusLineProps = {
  width: number;
  y?: number;
  status: string;
  /** Right side: counts, position, attribution. */
  end?: string;
  tone?: "default" | "error";
};

/** The thin line at the foot of an app window. */
export function AppStatusLine(props: AppStatusLineProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const height = Math.round(APP_STATUS_HEIGHT * ui);
  return (
    <Surface y={props.y ?? 0} width={props.width} height={height} fill={pal.panel}>
      <Rect width={props.width} height={1} fill={pal.borderSubtle} />
      <Horizontal
        x={12 * ui}
        width={props.width - 24 * ui}
        height={height}
        gap={12 * ui}
        align="center"
      >
        <TextBlock
          flexGrow={1}
          flexShrink={1}
          minWidth={0}
          text={props.status}
          color={props.tone === "error" ? pal.danger : pal.muted}
          fontSize={11}
          overflow="ellipsis"
          maxLines={1}
        />
        {props.end ? (
          <TextBlock text={props.end} color={pal.muted} fontSize={11} maxLines={1} />
        ) : null}
      </Horizontal>
    </Surface>
  );
}

/** Content area between an app's header bar and status line. */
export function appChromeBody(height: number, options: { status?: boolean } = {}) {
  const ui = getUiScaleFactor();
  const top = Math.round(APP_HEADER_HEIGHT * ui);
  const bottom = options.status === false ? 0 : Math.round(APP_STATUS_HEIGHT * ui);
  return { y: top, height: Math.max(1, height - top - bottom) };
}
