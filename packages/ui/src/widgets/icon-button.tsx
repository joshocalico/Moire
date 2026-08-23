/** Compact recipe-driven control with a genuinely centered artwork slot. */
import React, { type ReactNode } from "react";
import {
  Group,
  Text,
  measureTextBounds,
  type HitPointerEvent,
} from "@moire/react-host";
import {
  resolveStatefulStyle,
  useWidgetTheme,
  type ButtonSize,
  type IconButtonVariant,
  type WidgetIconStyle,
} from "../widget-theme.js";
import { Pressable } from "./pressable.js";

export type { IconButtonVariant } from "../widget-theme.js";

export type IconButtonSlot =
  | string
  | ReactNode
  | ((style: WidgetIconStyle) => ReactNode);

export type IconButtonProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  icon: IconButtonSlot;
  variant?: IconButtonVariant;
  size?: ButtonSize;
  fill?: number;
  color?: number;
  disabled?: boolean;
  onPress?: () => void;
  onContextMenu?: (event: HitPointerEvent) => void;
};

export function IconButton(props: IconButtonProps): ReactNode {
  const theme = useWidgetTheme();
  const recipe =
    theme.recipes.iconButton[props.variant ?? "standard"][props.size ?? "medium"];
  const root = resolveStatefulStyle(recipe.root, "rest");
  const hovered = resolveStatefulStyle(recipe.root, "hover");
  const pressed = resolveStatefulStyle(recipe.root, "pressed");
  const disabled = resolveStatefulStyle(recipe.root, "disabled");
  const iconStyle = resolveStatefulStyle(
    recipe.icon,
    props.disabled ? "disabled" : "rest",
  );
  const width = props.width ?? recipe.metrics.size;
  const height = props.height ?? recipe.metrics.size;
  const explicitFill = props.fill != null;
  const fill = props.fill ?? root.fill;
  const color = props.color ?? iconStyle.color;
  let artwork: ReactNode;

  if (typeof props.icon === "function") {
    artwork = props.icon({ ...iconStyle, color });
  } else if (typeof props.icon === "string") {
    const bounds = measureTextBounds(props.icon, {
      fontSize: iconStyle.size,
      fontWeight: "medium",
    });
    artwork = (
      <Text
        x={Math.floor((width - bounds.width) / 2)}
        y={Math.floor((height - bounds.height) / 2)}
        text={props.icon}
        color={color}
        fontSize={iconStyle.size}
        fontWeight="medium"
      />
    );
  } else {
    artwork = (
      <Group
        x={Math.floor((width - iconStyle.size) / 2)}
        y={Math.floor((height - iconStyle.size) / 2)}
        width={iconStyle.size}
        height={iconStyle.size}
      >
        {props.icon}
      </Group>
    );
  }

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={width} height={height}>
      <Pressable
        width={width}
        height={height}
        fill={fill}
        hoverFill={explicitFill ? undefined : hovered.fill}
        pressedFill={explicitFill ? undefined : pressed.fill}
        disabledFill={explicitFill ? fill : disabled.fill}
        radius={props.disabled ? disabled.radius : root.radius}
        stroke={explicitFill ? undefined : props.disabled ? disabled.stroke : root.stroke}
        strokeWidth={
          explicitFill
            ? undefined
            : props.disabled
              ? disabled.strokeWidth
              : root.strokeWidth
        }
        disabled={props.disabled}
        onPress={props.onPress}
        onContextMenu={props.onContextMenu}
      />
      {artwork}
    </Group>
  );
}
