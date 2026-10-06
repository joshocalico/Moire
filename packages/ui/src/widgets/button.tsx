/** Recipe-driven Button with replaceable leading and trailing artwork slots. */
import React, { useId, useState, type ReactNode } from "react";
import {
  Group,
  Rect,
  measureTextBounds,
  type HitKeyEvent,
  type HitPointerEvent,
} from "@moire/react-host";
import {
  resolveStatefulStyle,
  useWidgetTheme,
  type ButtonSize,
  type ButtonVariant,
  type WidgetIconStyle,
  type WidgetTheme,
} from "#ui/widget-theme";
import { Pressable } from "./pressable";
import { Box, Horizontal, Inset, registerIntrinsicSize, useLayoutMetrics } from "./layout";
import { TextBlock } from "./primitives";

export type { ButtonSize, ButtonVariant } from "#ui/widget-theme";

export type ButtonSlot = ReactNode | ((style: WidgetIconStyle) => ReactNode);

export type ButtonProps = {
  x?: number;
  y?: number;
  /** Omit for recipe-owned sizing to fit the label and icon slots. */
  width?: number;
  minWidth?: number;
  /** Uses the selected recipe's control height when omitted. */
  height?: number;
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Named artwork slots retain Button interaction and layout behavior. */
  leadingIcon?: ButtonSlot;
  trailingIcon?: ButtonSlot;
  /** Legacy escape hatch; explicit fill takes precedence over the recipe. */
  fill?: number;
  color?: number;
  fontSize?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  focusId?: string;
  onFocusChange?: (focused: boolean) => void;
  onPress?: (event?: HitPointerEvent) => void;
};

function renderSlot(slot: ButtonSlot, style: WidgetIconStyle): ReactNode {
  return typeof slot === "function" ? slot(style) : slot;
}

function naturalButtonWidth(props: ButtonProps, theme: WidgetTheme): number {
  const recipe = theme.recipes.button[props.variant ?? "secondary"][props.size ?? "medium"];
  const label = resolveStatefulStyle(recipe.label, props.disabled ? "disabled" : "rest");
  const textWidth = measureTextBounds(props.label, {
    fontSize: props.fontSize ?? label.fontSize,
    fontWeight: label.fontWeight,
  }).width;
  const leading = props.leadingIcon ? recipe.leadingIcon.base.size + recipe.metrics.gap : 0;
  const trailing = props.trailingIcon ? recipe.trailingIcon.base.size + recipe.metrics.gap : 0;
  return Math.max(
    props.minWidth ?? 0,
    Math.ceil(textWidth) + recipe.metrics.paddingX * 2 + leading + trailing + 2,
  );
}

export function Button(props: ButtonProps): ReactNode {
  const theme = useWidgetTheme();
  const allocated = useLayoutMetrics();
  const width = props.width ?? allocated?.width ?? naturalButtonWidth(props, theme);
  const generatedId = useId();
  const [focused, setFocused] = useState(false);
  const variant = props.variant ?? "secondary";
  const size = props.size ?? "medium";
  const recipe = theme.recipes.button[variant][size];
  const root = resolveStatefulStyle(
    recipe.root,
    focused ? "focused" : "rest",
    props.disabled ? "disabled" : "rest",
  );
  const hoveredRoot = resolveStatefulStyle(recipe.root, "hover");
  const pressedRoot = resolveStatefulStyle(recipe.root, "pressed");
  const disabledRoot = resolveStatefulStyle(recipe.root, "disabled");
  const label = resolveStatefulStyle(recipe.label, props.disabled ? "disabled" : "rest");
  const leadingIcon = resolveStatefulStyle(
    recipe.leadingIcon,
    props.disabled ? "disabled" : "rest",
  );
  const trailingIcon = resolveStatefulStyle(
    recipe.trailingIcon,
    props.disabled ? "disabled" : "rest",
  );

  const height = props.height ?? recipe.metrics.height;
  const fontSize = props.fontSize ?? label.fontSize;
  const fontWeight = label.fontWeight;
  const explicitFill = props.fill != null;
  const baseFill = props.fill ?? root.fill;
  const labelColor = props.disabled
    ? label.color
    : (props.color ?? (explicitFill ? 0xffffffff : label.color));
  const stroke = explicitFill ? undefined : props.disabled ? disabledRoot.stroke : root.stroke;
  const strokeWidth = explicitFill
    ? undefined
    : props.disabled
      ? disabledRoot.strokeWidth
      : root.strokeWidth;
  const radius = props.disabled ? disabledRoot.radius : root.radius;
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

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={width} height={height}>
      <Pressable
        x={0}
        y={0}
        width={width}
        height={height}
        fill={baseFill}
        hoverFill={explicitFill ? undefined : hoveredRoot.fill}
        pressedFill={explicitFill ? undefined : pressedRoot.fill}
        disabledFill={explicitFill ? baseFill : disabledRoot.fill}
        radius={radius}
        stroke={stroke}
        strokeWidth={strokeWidth}
        disabled={props.disabled}
        focusable={!!props.onPress}
        autoFocus={props.autoFocus}
        focusId={props.focusId ?? `button:${generatedId}`}
        onFocusChange={(next) => {
          setFocused(next);
          props.onFocusChange?.(next);
        }}
        onKeyDown={handleKey}
        onPress={props.onPress}
      />
      {!explicitFill && recipe.rim ? (
        <Rect
          x={radius}
          y={0}
          width={Math.max(0, width - radius * 2)}
          height={recipe.rim.width}
          fill={recipe.rim.color}
        />
      ) : null}
      <Inset width={width} height={height} padding={{ horizontal: recipe.metrics.paddingX }}>
        <Horizontal gap={recipe.metrics.gap} justify="center" align="center">
          {props.leadingIcon ? (
            <Box width={leadingIcon.size} height={leadingIcon.size}>
              {renderSlot(props.leadingIcon, leadingIcon)}
            </Box>
          ) : null}
          <TextBlock
            flexShrink={1}
            text={props.label}
            color={labelColor}
            fontSize={fontSize}
            fontWeight={fontWeight}
            overflow="ellipsis"
            maxLines={1}
          />
          {props.trailingIcon ? (
            <Box width={trailingIcon.size} height={trailingIcon.size}>
              {renderSlot(props.trailingIcon, trailingIcon)}
            </Box>
          ) : null}
        </Horizontal>
      </Inset>
    </Group>
  );
}

registerIntrinsicSize(Button, (props, theme) => ({
  width: props.width ?? naturalButtonWidth(props, theme),
  height:
    props.height ??
    theme.recipes.button[props.variant ?? "secondary"][props.size ?? "medium"].metrics.height,
}));
