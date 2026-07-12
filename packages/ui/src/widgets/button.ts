/**
 * Button — four variants with hover/press states via Pressable.
 * primary   → accent fill, white text, top-edge rimLight highlight
 * secondary → surface fill, text colour
 * ghost     → transparent, text colour, border on hover
 * danger    → danger fill, white text
 */
import { createElement, type ReactNode } from "react";
import { Group, Rect, Text, measureText, FONT_H } from "@moire/react-host";
import { themePalette } from "../theme.js";
import { Pressable } from "./pressable.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export type ButtonProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  label: string;
  variant?: ButtonVariant;
  /** Legacy: explicit fill color (takes precedence over variant). */
  fill?: number;
  color?: number;
  fontSize?: number;
  disabled?: boolean;
  onPress?: () => void;
};

const DEFAULT_FONT = 14;

export function Button(props: ButtonProps): ReactNode {
  const pal = themePalette();
  const variant: ButtonVariant = props.variant ?? "secondary";
  const fontSize = props.fontSize ?? DEFAULT_FONT;

  // Resolve fill and label color from variant (explicit fill overrides)
  let baseFill: number;
  let labelColor: number;
  const hasRim = !props.fill && (variant === "primary" || variant === "secondary");

  if (props.fill != null) {
    baseFill = props.fill;
    labelColor = props.color ?? 0xffffffff;
  } else {
    switch (variant) {
      case "primary":
        baseFill = pal.accentLine;
        labelColor = 0xffffffff;
        break;
      case "secondary":
        baseFill = pal.surface;
        labelColor = props.color ?? pal.text;
        break;
      case "ghost":
        baseFill = 0x00000000;
        labelColor = props.color ?? pal.text;
        break;
      case "danger":
        baseFill = pal.danger;
        labelColor = 0xffffffff;
        break;
    }
  }

  const tw = measureText(props.label, fontSize / 14);
  const th = FONT_H;
  const tx = Math.max(4, Math.floor((props.width - tw) / 2));
  const ty = Math.floor((props.height - th) / 2);

  return createElement(
    Group,
    {
      x: props.x ?? 0,
      y: props.y ?? 0,
      width: props.width,
      height: props.height,
    },
    createElement(Pressable, {
      x: 0,
      y: 0,
      width: props.width,
      height: props.height,
      fill: baseFill,
      disabled: props.disabled,
      onPress: props.onPress,
    }),
    // 1-px top rim highlight for elevated variants
    hasRim
      ? createElement(Rect, {
          x: 0,
          y: 0,
          width: props.width,
          height: 1,
          fill: pal.rimLight,
        })
      : null,
    createElement(Text, {
      x: tx,
      y: ty,
      text: props.label,
      color: props.disabled ? pal.muted : labelColor,
      fontSize,
    }),
  );
}
