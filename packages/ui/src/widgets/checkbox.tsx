/** Controlled, focusable checkbox with recipe-owned visuals. */
import React, { useId, useState, type ReactNode } from "react";
import {
  Group,
  Rect,
  measureTextBounds,
  type HitKeyEvent,
} from "@moire/react-host";
import {
  resolveStatefulStyle,
  useWidgetTheme,
  type ButtonSize,
  type WidgetState,
} from "../widget-theme.js";
import { Box, Horizontal, registerIntrinsicSize } from "./layout.js";
import { TextBlock } from "./primitives.js";

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
      <Horizontal width={width} height={height} gap={recipe.metrics.gap} align="center">
        <Box width={recipe.metrics.controlSize} height={recipe.metrics.controlSize}>
          <Rect
            width={recipe.metrics.controlSize}
            height={recipe.metrics.controlSize}
            fill={control.fill}
            radius={control.radius}
            stroke={control.stroke}
            strokeWidth={control.strokeWidth}
          />
          {props.checked ? (
            <TextBlock
              width={recipe.metrics.controlSize}
              height={recipe.metrics.controlSize}
              text="✓"
              color={mark.color}
              fontSize={mark.fontSize}
              fontWeight={mark.fontWeight}
              horizontalAlign="center"
              verticalAlign="center"
            />
          ) : null}
        </Box>
        {props.label && labelBounds ? (
          <TextBlock
            flexGrow={1}
            text={props.label}
            color={label.color}
            fontSize={label.fontSize}
            fontWeight={label.fontWeight}
            verticalAlign="center"
            overflow="ellipsis"
            maxLines={1}
          />
        ) : null}
      </Horizontal>
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

registerIntrinsicSize(Checkbox, (props, theme) => {
  const recipe = theme.recipes.checkbox[props.size ?? "medium"];
  const labelStyle = resolveStatefulStyle(
    recipe.label,
    props.disabled ? "disabled" : "rest",
  );
  const labelWidth = props.label
    ? measureTextBounds(props.label, {
        fontSize: labelStyle.fontSize,
        fontWeight: labelStyle.fontWeight,
      }).width
    : 0;
  return {
    width: props.width ?? recipe.metrics.controlSize + (props.label ? recipe.metrics.gap + labelWidth : 0),
    height: props.height ?? recipe.metrics.height,
  };
});
