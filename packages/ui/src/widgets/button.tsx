/** Recipe-driven Button with replaceable leading and trailing artwork slots. */
import React, { useId, useState, type ReactNode } from "react";
import {
  Group,
  Rect,
  Text,
  measureTextBounds,
  type HitKeyEvent,
} from "@moire/react-host";
import {
  resolveStatefulStyle,
  useWidgetTheme,
  type ButtonSize,
  type ButtonVariant,
  type WidgetIconStyle,
} from "../widget-theme.js";
import { Pressable } from "./pressable.js";

export type { ButtonSize, ButtonVariant } from "../widget-theme.js";

export type ButtonSlot = ReactNode | ((style: WidgetIconStyle) => ReactNode);

export type ButtonProps = {
  x?: number;
  y?: number;
  width: number;
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
  onPress?: () => void;
};

function renderSlot(slot: ButtonSlot, style: WidgetIconStyle): ReactNode {
  return typeof slot === "function" ? slot(style) : slot;
}

export function Button(props: ButtonProps): ReactNode {
  const theme = useWidgetTheme();
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
  const label = resolveStatefulStyle(
    recipe.label,
    props.disabled ? "disabled" : "rest",
  );
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
  const labelBounds = measureTextBounds(props.label, { fontSize, fontWeight });
  const leadingWidth = props.leadingIcon ? leadingIcon.size : 0;
  const trailingWidth = props.trailingIcon ? trailingIcon.size : 0;
  const leadingGap = props.leadingIcon ? recipe.metrics.gap : 0;
  const trailingGap = props.trailingIcon ? recipe.metrics.gap : 0;
  const contentWidth =
    leadingWidth +
    leadingGap +
    labelBounds.width +
    trailingGap +
    trailingWidth;
  const contentX = Math.max(
    recipe.metrics.paddingX,
    Math.floor((props.width - contentWidth) / 2),
  );
  const labelX = contentX + leadingWidth + leadingGap;
  const labelY = Math.floor((height - labelBounds.height) / 2);
  const explicitFill = props.fill != null;
  const baseFill = props.fill ?? root.fill;
  const labelColor = props.disabled
    ? label.color
    : props.color ?? (explicitFill ? 0xffffffff : label.color);
  const stroke = explicitFill
    ? undefined
    : props.disabled
      ? disabledRoot.stroke
      : root.stroke;
  const strokeWidth = explicitFill
    ? undefined
    : props.disabled
      ? disabledRoot.strokeWidth
      : root.strokeWidth;
  const radius = props.disabled ? disabledRoot.radius : root.radius;
  const handleKey = (event: HitKeyEvent) => {
    if (event.repeat || props.disabled) return;
    if (
      event.code === 28 ||
      event.code === 57 ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      props.onPress?.();
    }
  };

  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={height}
    >
      <Pressable
        x={0}
        y={0}
        width={props.width}
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
          width={Math.max(0, props.width - radius * 2)}
          height={recipe.rim.width}
          fill={recipe.rim.color}
        />
      ) : null}
      {props.leadingIcon ? (
        <Group
          x={contentX}
          y={Math.floor((height - leadingIcon.size) / 2)}
          width={leadingIcon.size}
          height={leadingIcon.size}
        >
          {renderSlot(props.leadingIcon, leadingIcon)}
        </Group>
      ) : null}
      <Text
        x={labelX}
        y={labelY}
        text={props.label}
        color={labelColor}
        fontSize={fontSize}
        fontWeight={fontWeight}
      />
      {props.trailingIcon ? (
        <Group
          x={labelX + labelBounds.width + trailingGap}
          y={Math.floor((height - trailingIcon.size) / 2)}
          width={trailingIcon.size}
          height={trailingIcon.size}
        >
          {renderSlot(props.trailingIcon, trailingIcon)}
        </Group>
      ) : null}
    </Group>
  );
}
