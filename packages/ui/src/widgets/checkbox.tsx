/** Controlled, focusable checkbox with recipe-owned visuals. */
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
  type WidgetState,
} from "../widget-theme.js";

export type CheckboxProps = {
  x?: number;
  y?: number;
  checked: boolean;
  label?: string;
  onChange?: (checked: boolean) => void;
  width?: number;
  height?: number;
  size?: ButtonSize;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
};

export function Checkbox(props: CheckboxProps): ReactNode {
  const recipe = useWidgetTheme().recipes.checkbox[props.size ?? "medium"];
  const generatedId = useId();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const states: WidgetState[] = [];
  if (hovered) states.push("hover");
  if (pressed) states.push("pressed");
  if (props.checked) states.push("selected");
  if (focused) states.push("focused");
  if (props.invalid) states.push("invalid");
  if (props.disabled) states.push("disabled");
  const control = resolveStatefulStyle(recipe.control, ...states);
  const mark = resolveStatefulStyle(recipe.mark, ...states);
  const label = resolveStatefulStyle(recipe.label, ...states);
  const labelBounds = props.label
    ? measureTextBounds(props.label, {
        fontSize: label.fontSize,
        fontWeight: label.fontWeight,
      })
    : null;
  const height = props.height ?? recipe.metrics.height;
  const width =
    props.width ??
    recipe.metrics.controlSize +
      (labelBounds ? recipe.metrics.gap + labelBounds.width : 0);
  const controlY = Math.floor((height - recipe.metrics.controlSize) / 2);
  const markBounds = measureTextBounds("✓", {
    fontSize: mark.fontSize,
    fontWeight: mark.fontWeight,
  });

  const toggle = () => {
    if (!props.disabled) props.onChange?.(!props.checked);
  };
  const handleKey = (event: HitKeyEvent) => {
    if (event.repeat || props.disabled) return;
    if (
      event.code === 28 ||
      event.code === 57 ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      toggle();
    }
  };

  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={width}
      height={height}
    >
      <Rect
        x={0}
        y={controlY}
        width={recipe.metrics.controlSize}
        height={recipe.metrics.controlSize}
        fill={control.fill}
        radius={control.radius}
        stroke={control.stroke}
        strokeWidth={control.strokeWidth}
      />
      {props.checked ? (
        <Text
          x={Math.floor((recipe.metrics.controlSize - markBounds.width) / 2)}
          y={controlY + Math.floor((recipe.metrics.controlSize - markBounds.height) / 2)}
          text="✓"
          color={mark.color}
          fontSize={mark.fontSize}
          fontWeight={mark.fontWeight}
        />
      ) : null}
      {props.label && labelBounds ? (
        <Text
          x={recipe.metrics.controlSize + recipe.metrics.gap}
          y={Math.floor((height - labelBounds.height) / 2)}
          text={props.label}
          color={label.color}
          fontSize={label.fontSize}
          fontWeight={label.fontWeight}
        />
      ) : null}
      <Rect
        width={width}
        height={height}
        fill={0x00000000}
        focusable={!props.disabled}
        autoFocus={props.autoFocus}
        focusId={`checkbox:${generatedId}`}
        onFocusChange={setFocused}
        onKeyDown={handleKey}
        onPointerEnter={props.disabled ? undefined : () => setHovered(true)}
        onPointerLeave={
          props.disabled
            ? undefined
            : () => {
                setHovered(false);
                setPressed(false);
              }
        }
        onPointerDown={props.disabled ? undefined : () => setPressed(true)}
        onPointerUp={props.disabled ? undefined : () => setPressed(false)}
        onPress={props.disabled ? undefined : toggle}
      />
    </Group>
  );
}
