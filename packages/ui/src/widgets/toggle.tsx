/** Controlled switch with focus/keyboard behavior and animated thumb motion. */
import React, { useEffect, useId, useState, type ReactNode } from "react";
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
import { easeTo, useMotionValue } from "../motion.js";

export type ToggleProps = {
  x?: number;
  y?: number;
  on: boolean;
  label?: string;
  onChange?: (on: boolean) => void;
  width?: number;
  height?: number;
  size?: ButtonSize;
  disabled?: boolean;
  autoFocus?: boolean;
};

export function Toggle(props: ToggleProps): ReactNode {
  const recipe = useWidgetTheme().recipes.toggle[props.size ?? "medium"];
  const generatedId = useId();
  const position = useMotionValue(props.on ? 100 : 0);
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    easeTo(position, props.on ? 100 : 0, 24);
  }, [position, props.on]);
  const states: WidgetState[] = [];
  if (hovered) states.push("hover");
  if (pressed) states.push("pressed");
  if (props.on) states.push("selected");
  if (focused) states.push("focused");
  if (props.disabled) states.push("disabled");
  const track = resolveStatefulStyle(recipe.track, ...states);
  const thumb = resolveStatefulStyle(recipe.thumb, ...states);
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
    recipe.metrics.trackWidth +
      (labelBounds ? recipe.metrics.gap + labelBounds.width : 0);
  const trackY = Math.floor((height - recipe.metrics.trackHeight) / 2);
  const travel =
    recipe.metrics.trackWidth -
    recipe.metrics.thumbInset * 2 -
    recipe.metrics.thumbSize;
  const thumbX =
    recipe.metrics.thumbInset +
    Math.round(travel * Math.max(0, Math.min(1, position.get() / 100)));

  const toggle = () => {
    if (!props.disabled) props.onChange?.(!props.on);
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
        y={trackY}
        width={recipe.metrics.trackWidth}
        height={recipe.metrics.trackHeight}
        fill={track.fill}
        radius={track.radius}
        stroke={track.stroke}
        strokeWidth={track.strokeWidth}
      />
      <Rect
        x={thumbX}
        y={trackY + recipe.metrics.thumbInset}
        width={recipe.metrics.thumbSize}
        height={recipe.metrics.thumbSize}
        fill={thumb.fill}
        radius={thumb.radius}
        stroke={thumb.stroke}
        strokeWidth={thumb.strokeWidth}
      />
      {props.label && labelBounds ? (
        <Text
          x={recipe.metrics.trackWidth + recipe.metrics.gap}
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
        focusId={`toggle:${generatedId}`}
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
