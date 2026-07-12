/**
 * Pressable — interactive container that fills with hover/pressed palette tokens.
 */
import { createElement, useRef, useState, type ReactNode } from "react";
import { Group, Rect } from "@moire/react-host";
import { themePalette } from "../theme.js";

export type PressableProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  fill?: number;
  children?: ReactNode;
  onPress?: () => void;
  onDoublePress?: () => void;
  disabled?: boolean;
};

export function Pressable(props: PressableProps): ReactNode {
  const pal = themePalette();
  const [hover, setHover] = useState(false);
  const [pressed, setPressed] = useState(false);
  const lastClick = useRef(0);

  const base = props.fill ?? 0x00000000;
  let fill: number;
  if (props.disabled) fill = base;
  else if (pressed) fill = pal.pressed;
  else if (hover) fill = pal.hover;
  else fill = base;

  const handlePress = () => {
    if (props.disabled) return;
    const now = Date.now();
    if (props.onDoublePress && now - lastClick.current < 400) {
      lastClick.current = 0;
      props.onDoublePress();
      return;
    }
    lastClick.current = now;
    props.onPress?.();
  };

  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
    },
    createElement(Rect, {
      x: 0,
      y: 0,
      width: props.width,
      height: props.height,
      fill,
      onPointerEnter: props.disabled ? undefined : () => setHover(true),
      onPointerLeave: props.disabled
        ? undefined
        : () => {
            setHover(false);
            setPressed(false);
          },
      onPointerDown: props.disabled ? undefined : () => setPressed(true),
      onPointerUp: props.disabled ? undefined : () => setPressed(false),
      onPress: props.disabled ? undefined : handlePress,
    }),
    props.children,
  );
}
