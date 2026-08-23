/** Recipe-driven application dialog surface. */
import React, { type ReactNode } from "react";
import { Group, Rect, Text, measureTextBounds } from "@moire/react-host";
import { useWidgetTheme, type ButtonSize } from "../widget-theme.js";
import { Icon } from "./icon.js";
import { IconButton } from "./icon-button.js";

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
  const recipe = useWidgetTheme().recipes.dialog[props.size ?? "medium"];
  const titleBounds = measureTextBounds(props.title, {
    fontSize: recipe.title.fontSize,
    fontWeight: recipe.title.fontWeight,
  });
  const bodyY = recipe.metrics.titlebarHeight + recipe.metrics.bodyPaddingTop;
  const closeIconOffset = Math.floor(
    (recipe.metrics.closeSize - recipe.closeIcon.size) / 2,
  );
  const bodyHeight = Math.max(
    0,
    props.height - bodyY - recipe.metrics.bodyPaddingBottom,
  );
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
      clip
    >
      <Rect
        width={props.width}
        height={props.height}
        fill={recipe.surface.fill}
        radius={recipe.surface.radius}
        stroke={recipe.surface.stroke}
        strokeWidth={recipe.surface.strokeWidth}
      />
      <Rect
        width={props.width}
        height={recipe.metrics.titlebarHeight}
        fill={recipe.titlebar.fill}
        radius={recipe.titlebar.radius}
      />
      <Text
        x={recipe.metrics.titlePaddingX}
        y={Math.floor((recipe.metrics.titlebarHeight - titleBounds.height) / 2)}
        text={props.title}
        color={recipe.title.color}
        fontSize={recipe.title.fontSize}
        fontWeight={recipe.title.fontWeight}
      />
      {props.onClose ? (
        <IconButton
          x={props.width - recipe.metrics.closeInset - recipe.metrics.closeSize}
          y={Math.floor((recipe.metrics.titlebarHeight - recipe.metrics.closeSize) / 2)}
          width={recipe.metrics.closeSize}
          height={recipe.metrics.closeSize}
          size={props.size}
          variant="ghost"
          icon={() => (
            <Icon
              name="close"
              x={closeIconOffset}
              y={closeIconOffset}
              size={recipe.closeIcon.size}
              color={recipe.closeIcon.color}
            />
          )}
          onPress={props.onClose}
        />
      ) : null}
      <Group
        x={recipe.metrics.bodyPaddingX}
        y={bodyY}
        width={Math.max(0, props.width - recipe.metrics.bodyPaddingX * 2)}
        height={bodyHeight}
      >
        {props.children}
      </Group>
    </Group>
  );
}
