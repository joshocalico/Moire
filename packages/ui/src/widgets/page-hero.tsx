/**
 * The card at the top of a settings page: the page's icon, its main state as a sentence and the
 * master control (the Wi‑Fi switch). Given children instead, it is a tinted card for the page's
 * own picture, such as Appearance's desktop preview.
 */
import React, { type ReactNode } from "react";
import { Group } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { mixColor } from "#ui/theme-family-color";
import { useWidgetTheme } from "#ui/widget-theme";
import { isDarkPalette, IconTile } from "./icon-tile";
import type { IconName } from "./icon";
import { Horizontal, registerIntrinsicSize } from "./layout";
import { Surface, TextBlock } from "./primitives";

export type PageHeroProps = {
  x?: number;
  y?: number;
  width: number;
  /** 84 unscaled pixels by default. */
  height?: number;
  tint?: number;
  icon?: IconName;
  title?: string;
  detail?: string;
  /** The master control at the right edge, given the width it reserved. */
  control?: ReactNode;
  controlWidth?: number;
  /** Custom content filling the card instead of the icon, title and control. */
  children?: ReactNode;
};

const HEIGHT = 84;

/** The hero's default height, scaled. */
export function pageHeroHeight(): number {
  return HEIGHT * getUiScaleFactor();
}

export function PageHero(props: PageHeroProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const height = props.height ?? HEIGHT * ui;
  const tint = props.tint ?? pal.accent;
  const controlWidth = props.control ? (props.controlWidth ?? 52 * ui) : 0;
  const textX = 80 * ui;
  const textWidth = Math.max(
    1,
    props.width - textX - 18 * ui - controlWidth - (controlWidth ? 12 * ui : 0),
  );
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={height}>
      <Surface
        width={props.width}
        height={height}
        radius={12 * ui}
        fill={mixColor(pal.surface, tint, isDarkPalette(pal) ? 0.1 : 0.06)}
        stroke={mixColor(pal.borderSubtle, tint, 0.35)}
        strokeWidth={1}
      >
        {props.children ?? (
          <>
            {props.icon ? (
              <IconTile
                x={18 * ui}
                y={(height - 48 * ui) / 2}
                size={48}
                icon={props.icon}
                tint={tint}
              />
            ) : null}
            <TextBlock
              x={textX}
              y={height / 2 - 22 * ui}
              width={textWidth}
              height={24 * ui}
              text={props.title ?? ""}
              fontSize={17}
              fontWeight="medium"
              verticalAlign="center"
              overflow="ellipsis"
              maxLines={1}
            />
            {props.detail ? (
              <TextBlock
                x={textX}
                y={height / 2 + 2 * ui}
                width={textWidth}
                height={18 * ui}
                text={props.detail}
                fontSize={12}
                color={pal.muted}
                verticalAlign="center"
                overflow="ellipsis"
                maxLines={1}
              />
            ) : null}
            {props.control ? (
              <Horizontal
                x={props.width - 18 * ui - controlWidth}
                width={controlWidth}
                height={height}
                justify="end"
                align="center"
              >
                {props.control}
              </Horizontal>
            ) : null}
          </>
        )}
      </Surface>
    </Group>
  );
}

registerIntrinsicSize(PageHero, (props) => ({
  width: props.width,
  height: props.height ?? HEIGHT * getUiScaleFactor(),
}));
