/**
 * Pressable — interactive container with eased hover/press fill motion.
 */
import React, { useId, useRef, useState, type ReactNode } from "react";
import { Group, Rect, type HitKeyEvent, type HitPointerEvent } from "@moire/react-host";
import { easeTo, useMotionValue } from "#ui/motion";
import { useWidgetTheme } from "#ui/widget-theme";
import { contrastRatio, foregroundOn } from "#ui/theme-family-color";
import { FocusRing } from "./primitives";

export type PressableProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  fill?: number;
  hoverFill?: number;
  pressedFill?: number;
  disabledFill?: number;
  radius?: number;
  stroke?: number;
  strokeWidth?: number;
  /** Optional leading feedback mark that follows hover and press motion. */
  indicatorColor?: number;
  indicatorWidth?: number;
  children?: ReactNode;
  onPress?: (event?: HitPointerEvent) => void;
  onDoublePress?: () => void;
  onContextMenu?: (event: HitPointerEvent) => void;
  disabled?: boolean;
  focusable?: boolean;
  autoFocus?: boolean;
  focusId?: string;
  onFocusChange?: (focused: boolean) => void;
  onHoverChange?: (hovered: boolean) => void;
  onPointerMove?: (event: HitPointerEvent) => void;
  onKeyDown?: (event: HitKeyEvent) => void;
};

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Blend ARGB colors by t in 0..1 (a → b). */
function lerpArgb(from: number, to: number, t: number): number {
  const tt = Math.max(0, Math.min(1, t));
  const fa = (from >>> 24) & 0xff;
  const fr = (from >>> 16) & 0xff;
  const fg = (from >>> 8) & 0xff;
  const fb = from & 0xff;
  const ta = (to >>> 24) & 0xff;
  const tr = (to >>> 16) & 0xff;
  const tg = (to >>> 8) & 0xff;
  const tb = to & 0xff;
  return (
    ((lerpChannel(fa, ta, tt) << 24) |
      (lerpChannel(fr, tr, tt) << 16) |
      (lerpChannel(fg, tg, tt) << 8) |
      lerpChannel(fb, tb, tt)) >>>
    0
  );
}

export function Pressable(props: PressableProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const generatedId = useId();
  const [focused, setFocused] = useState(false);
  const focusable = props.focusable ?? !!(props.onPress || props.onDoublePress);
  const hoverMv = useMotionValue(0);
  const pressMv = useMotionValue(0);
  const lastClick = useRef(0);

  const base = props.disabled
    ? (props.disabledFill ?? props.fill ?? 0x00000000)
    : (props.fill ?? 0x00000000);
  let fill = base;
  if (!props.disabled) {
    // Motion values use layout-sized units so the shared 0.5 settle threshold
    // still yields a complete, multi-frame transition for normalized colors.
    const h = hoverMv.get() / 100;
    const p = pressMv.get() / 100;
    if (h > 0.01 || p > 0.01) {
      const hovered = lerpArgb(base, props.hoverFill ?? pal.hover, h);
      fill = lerpArgb(hovered, props.pressedFill ?? pal.pressed, p);
    }
  }
  // An accent-colored primary fill can equal the theme's focus stroke. Keep
  // transparent controls' existing policy; opaque fills can establish contrast.
  const focusColor =
    focused && fill >>> 24 === 0xff && contrastRatio(fill, pal.focusRing) < 3
      ? foregroundOn(fill)
      : pal.focusRing;

  const handlePress = (event?: HitPointerEvent) => {
    if (props.disabled) return;
    const now = Date.now();
    if (props.onDoublePress && now - lastClick.current < 400) {
      lastClick.current = 0;
      props.onDoublePress();
      return;
    }
    lastClick.current = now;
    props.onPress?.(event);
  };

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      <Rect
        x={0}
        y={0}
        width={props.width}
        height={props.height}
        fill={fill}
        radius={props.radius}
        stroke={props.stroke}
        strokeWidth={props.strokeWidth}
        onPointerEnter={
          props.disabled
            ? undefined
            : () => {
                easeTo(hoverMv, 100, 18);
                props.onHoverChange?.(true);
              }
        }
        onPointerLeave={
          props.disabled
            ? undefined
            : () => {
                easeTo(hoverMv, 0, 14);
                easeTo(pressMv, 0, 20);
                props.onHoverChange?.(false);
              }
        }
        onPointerMove={props.disabled ? undefined : props.onPointerMove}
        onPointerDown={
          props.disabled
            ? undefined
            : () => {
                easeTo(pressMv, 100, 22);
              }
        }
        onPointerUp={
          props.disabled
            ? undefined
            : () => {
                easeTo(pressMv, 0, 18);
              }
        }
        onPress={props.disabled ? undefined : handlePress}
        onContextMenu={props.disabled ? undefined : props.onContextMenu}
        focusable={!props.disabled && focusable}
        autoFocus={props.autoFocus}
        focusId={props.focusId ?? `pressable:${generatedId}`}
        onFocusChange={(next) => {
          setFocused(next);
          props.onFocusChange?.(next);
        }}
        onKeyDown={
          props.disabled
            ? undefined
            : (props.onKeyDown ??
              ((event: HitKeyEvent) => {
                if (event.repeat) return;
                if (
                  event.key === "Enter" ||
                  event.key === " " ||
                  event.code === 28 ||
                  event.code === 57
                ) {
                  props.onPress?.();
                }
              }))
        }
      />
      {props.indicatorColor != null && !props.disabled ? (
        <Rect
          x={0}
          y={8}
          width={props.indicatorWidth ?? 2}
          height={Math.max(0, props.height - 16)}
          radius={1}
          fill={lerpArgb(
            props.indicatorColor & 0x00ffffff,
            props.indicatorColor,
            Math.max(hoverMv.get(), pressMv.get()) / 100,
          )}
        />
      ) : null}
      {props.children}
      {focused &&
      !props.disabled &&
      !(props.stroke === focusColor && (props.strokeWidth ?? 0) > 0) ? (
        <FocusRing
          width={props.width}
          height={props.height}
          radius={props.radius}
          color={focusColor}
        />
      ) : null}
    </Group>
  );
}
