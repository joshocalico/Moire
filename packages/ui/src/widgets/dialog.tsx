/** Recipe-driven application dialog surface. */
import React, { type ReactNode } from "react";
import { useWidgetTheme, type ButtonSize } from "../widget-theme.js";
import { Icon } from "./icon.js";
import { IconButton } from "./icon-button.js";
import { Box, Horizontal, Inset, Vertical, registerIntrinsicSize } from "./layout.js";
import { Surface, TextBlock } from "./primitives.js";

export type DialogProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  title: string;
  size?: ButtonSize;
  children?: ReactNode;
  onClose?: () => void;
};

export function Dialog(props: DialogProps): ReactNode {
  const theme = useWidgetTheme();
  const recipe = theme.recipes.dialog[props.size ?? "medium"];
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      fill={recipe.surface.fill}
      radius={recipe.surface.radius}
      stroke={recipe.surface.stroke}
      strokeWidth={recipe.surface.strokeWidth}
      elevation="high"
      clip
    >
      <Vertical width={props.width} height={props.height} gap={0}>
        <Surface
          width={props.width}
          height={recipe.metrics.titlebarHeight}
          fill={recipe.titlebar.fill}
          radius={recipe.titlebar.radius}
        >
          <Inset
            width={props.width}
            height={recipe.metrics.titlebarHeight}
            padding={{ horizontal: recipe.metrics.titlePaddingX }}
          >
            <Horizontal gap={theme.foundations.space.sm} align="center">
              <TextBlock
                flexGrow={1}
                flexShrink={1}
                text={props.title}
                color={recipe.title.color}
                fontSize={recipe.title.fontSize}
                fontWeight={recipe.title.fontWeight}
                verticalAlign="center"
                overflow="ellipsis"
                maxLines={1}
              />
              {props.onClose ? (
                <IconButton
                  width={recipe.metrics.closeSize}
                  height={recipe.metrics.closeSize}
                  size={props.size}
                  variant="ghost"
                  icon={<Icon name="close" size={recipe.closeIcon.size} color={recipe.closeIcon.color} symbolic />}
                  onPress={props.onClose}
                />
              ) : <Box width={0} height={recipe.metrics.closeSize} />}
            </Horizontal>
          </Inset>
        </Surface>
        <Inset
          flexGrow={1}
          padding={{
            top: recipe.metrics.bodyPaddingTop,
            right: recipe.metrics.bodyPaddingX,
            bottom: recipe.metrics.bodyPaddingBottom,
            left: recipe.metrics.bodyPaddingX,
          }}
        >
          {props.children}
        </Inset>
      </Vertical>
    </Surface>
  );
}

registerIntrinsicSize(Dialog, (props) => ({
  width: props.width,
  height: props.height,
}));
