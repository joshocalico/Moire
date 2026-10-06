/** Compact recipe-driven control with a genuinely centered artwork slot. */
import React, { useId, useState, type ReactNode } from "react";
import {
  Group,
  Text,
  measureTextBounds,
  type HitPointerEvent,
  type HitKeyEvent,
} from "@moire/react-host";
import {
  resolveStatefulStyle,
  useWidgetTheme,
  type ButtonSize,
  type IconButtonVariant,
  type WidgetIconStyle,
} from "#ui/widget-theme";
import { Pressable } from "./pressable";
import { registerIntrinsicSize } from "./layout";
import { Tooltip, type TooltipPlacement } from "./tooltip";

export type { IconButtonVariant } from "#ui/widget-theme";

export type IconButtonSlot = string | ReactNode | ((style: WidgetIconStyle) => ReactNode);

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
  selected?: boolean;
  tooltip?: string;
  tooltipPlacement?: TooltipPlacement;
  autoFocus?: boolean;
  focusId?: string;
  onFocusChange?: (focused: boolean) => void;
  onPress?: (event?: HitPointerEvent) => void;
  onContextMenu?: (event: HitPointerEvent) => void;
};

export function IconButton(props: IconButtonProps): ReactNode {
  const theme = useWidgetTheme();
  const generatedId = useId();
  const [focused, setFocused] = useState(false);
  const [hoveredControl, setHoveredControl] = useState(false);
  const recipe = theme.recipes.iconButton[props.variant ?? "standard"][props.size ?? "medium"];
  const root = resolveStatefulStyle(
    recipe.root,
    props.selected ? "selected" : "rest",
    focused ? "focused" : "rest",
    props.disabled ? "disabled" : "rest",
  );
  const hovered = resolveStatefulStyle(recipe.root, "hover");
  const pressed = resolveStatefulStyle(recipe.root, "pressed");
  const disabled = resolveStatefulStyle(recipe.root, "disabled");
  const iconStyle = resolveStatefulStyle(recipe.icon, props.disabled ? "disabled" : "rest");
  const width = props.width ?? recipe.metrics.size;
  const height = props.height ?? recipe.metrics.size;
  const explicitFill = props.fill != null;
  const fill = props.fill ?? root.fill;
  const color = props.color ?? iconStyle.color;
  let artwork: ReactNode;
  const handleKey = (event: HitKeyEvent) => {
    if (event.repeat || props.disabled) return;
    if (event.code === 28 || event.code === 57 || event.key === "Enter" || event.key === " ") {
      const bounds = event.targetBounds;
      props.onPress?.(
        bounds
          ? {
              x: bounds.x + bounds.width / 2,
              y: bounds.y + bounds.height / 2,
              localX: bounds.width / 2,
              localY: bounds.height / 2,
              button: "left",
            }
          : undefined,
      );
    }
  };

  if (typeof props.icon === "function") {
    artwork = (
      <Group
        x={Math.floor((width - iconStyle.size) / 2)}
        y={Math.floor((height - iconStyle.size) / 2)}
        width={iconStyle.size}
        height={iconStyle.size}
      >
        {props.icon({ ...iconStyle, color })}
      </Group>
    );
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
          explicitFill ? undefined : props.disabled ? disabled.strokeWidth : root.strokeWidth
        }
        disabled={props.disabled}
        focusable={!!props.onPress}
        autoFocus={props.autoFocus}
        focusId={props.focusId ?? `icon-button:${generatedId}`}
        onFocusChange={(next) => {
          setFocused(next);
          props.onFocusChange?.(next);
        }}
        onKeyDown={handleKey}
        onPress={props.onPress}
        onContextMenu={props.onContextMenu}
        onHoverChange={props.tooltip ? setHoveredControl : undefined}
      />
      {artwork}
      {props.tooltip ? (
        <Tooltip
          width={width}
          height={height}
          label={props.tooltip}
          placement={props.tooltipPlacement ?? "bottom"}
          open={hoveredControl || focused}
          disabled={props.disabled}
        />
      ) : null}
    </Group>
  );
}

registerIntrinsicSize(IconButton, (props, theme) => {
  const size =
    theme.recipes.iconButton[props.variant ?? "standard"][props.size ?? "medium"].metrics.size;
  return {
    width: props.width ?? size,
    height: props.height ?? size,
  };
});
