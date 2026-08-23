/** Controlled slider with pointer capture, focus, and keyboard adjustment. */
import React, { useId, useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent } from "@moire/react-host";
import {
  resolveStatefulStyle,
  useWidgetTheme,
  type ButtonSize,
  type WidgetState,
} from "../widget-theme.js";
import { registerIntrinsicSize } from "./layout.js";

export type SliderProps = {
  x?: number;
  y?: number;
  width: number;
  value: number;
  onChange?: (value: number) => void;
  height?: number;
  size?: ButtonSize;
  step?: number;
  disabled?: boolean;
  autoFocus?: boolean;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function Slider(props: SliderProps): ReactNode {
  const recipe = useWidgetTheme().recipes.slider[props.size ?? "medium"];
  const generatedId = useId();
  const [hovered, setHovered] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [focused, setFocused] = useState(false);
  const states: WidgetState[] = [];
  if (hovered) states.push("hover");
  if (pressed) states.push("pressed");
  if (focused) states.push("focused");
  if (props.disabled) states.push("disabled");
  const track = resolveStatefulStyle(recipe.track, ...states);
  const fill = resolveStatefulStyle(recipe.fill, ...states);
  const thumb = resolveStatefulStyle(recipe.thumb, ...states);
  const height = props.height ?? recipe.metrics.height;
  const value = clamp(props.value);
  const usable = Math.max(1, props.width - recipe.metrics.thumbSize);
  const thumbX = Math.round(usable * value);
  const trackX = Math.floor(recipe.metrics.thumbSize / 2);
  const trackWidth = usable;
  const trackY = Math.floor((height - recipe.metrics.trackHeight) / 2);
  const step = props.step && props.step > 0 ? props.step : 0.01;

  const commit = (raw: number) => {
    if (props.disabled) return;
    const next = clamp(Math.round(clamp(raw) / step) * step);
    props.onChange?.(next);
  };
  const setFromX = (localX: number) => {
    commit((localX - recipe.metrics.thumbSize / 2) / usable);
  };
  const handleKey = (event: HitKeyEvent) => {
    if (event.repeat || props.disabled) return;
    const increment = step * (event.shiftKey ? 10 : 1);
    if (event.code === 105 || event.code === 108 || event.key === "ArrowLeft" || event.key === "ArrowDown") {
      commit(value - increment);
    } else if (event.code === 106 || event.code === 103 || event.key === "ArrowRight" || event.key === "ArrowUp") {
      commit(value + increment);
    } else if (event.code === 102 || event.key === "Home") {
      commit(0);
    } else if (event.code === 107 || event.key === "End") {
      commit(1);
    }
  };

  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={height}
    >
      <Rect
        x={trackX}
        y={trackY}
        width={trackWidth}
        height={recipe.metrics.trackHeight}
        fill={track.fill}
        radius={track.radius}
        stroke={track.stroke}
        strokeWidth={track.strokeWidth}
      />
      <Rect
        x={trackX}
        y={trackY}
        width={Math.max(0, trackWidth * value)}
        height={recipe.metrics.trackHeight}
        fill={fill.fill}
        radius={fill.radius}
      />
      <Rect
        x={thumbX}
        y={Math.floor((height - recipe.metrics.thumbSize) / 2)}
        width={recipe.metrics.thumbSize}
        height={recipe.metrics.thumbSize}
        fill={thumb.fill}
        radius={thumb.radius}
        stroke={thumb.stroke}
        strokeWidth={thumb.strokeWidth}
      />
      <Rect
        width={props.width}
        height={height}
        fill={0x00000000}
        focusable={!props.disabled}
        autoFocus={props.autoFocus}
        focusId={`slider:${generatedId}`}
        onFocusChange={setFocused}
        onKeyDown={handleKey}
        onPointerEnter={props.disabled ? undefined : () => setHovered(true)}
        onPointerLeave={props.disabled ? undefined : () => setHovered(false)}
        onPointerDown={
          props.disabled
            ? undefined
            : (event) => {
                setPressed(true);
                setFromX(event.localX);
              }
        }
        onPointerMove={
          props.disabled || !pressed
            ? undefined
            : (event) => setFromX(event.localX)
        }
        onPointerUp={
          props.disabled
            ? undefined
            : (event) => {
                setFromX(event.localX);
                setPressed(false);
              }
        }
      />
    </Group>
  );
}

registerIntrinsicSize(Slider, (props, theme) => ({
  width: props.width,
  height: props.height ?? theme.recipes.slider[props.size ?? "medium"].metrics.height,
}));
