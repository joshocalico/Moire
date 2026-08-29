import React, { useEffect, useRef, type ReactNode } from "react";
import { Group, Rect, measureTextBounds } from "@moire/react-host";
import { easeTo, useMotionValue } from "#ui/motion";
import { useWidgetTheme } from "#ui/widget-theme";
import { Surface, TextBlock } from "./primitives";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

export type TooltipProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  label: string;
  placement?: TooltipPlacement;
  delayMs?: number;
  offset?: number;
  tooltipWidth?: number;
  disabled?: boolean;
  children?: ReactNode;
};

/** Non-interactive hover help composed around any fixed-size trigger. */
export function Tooltip(props: TooltipProps): ReactNode {
  const theme = useWidgetTheme();
  const pal = theme.foundations.palette;
  const opacity = useMotionValue(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bounds = measureTextBounds(props.label, { fontSize: 10 });
  const tipWidth = props.tooltipWidth ?? Math.max(60, Math.min(260, bounds.width + 18));
  const estimatedLines = Math.max(
    1,
    Math.min(3, Math.ceil(bounds.width / Math.max(1, tipWidth - 18))),
  );
  const tipHeight = estimatedLines === 1 ? 28 : 14 + estimatedLines * 14;
  const offset = props.offset ?? 7;
  const placement = props.placement ?? "top";
  const tipX =
    placement === "left"
      ? -tipWidth - offset
      : placement === "right"
        ? props.width + offset
        : Math.round((props.width - tipWidth) / 2);
  const tipY =
    placement === "top"
      ? -tipHeight - offset
      : placement === "bottom"
        ? props.height + offset
        : Math.round((props.height - tipHeight) / 2);
  const cancelTimer = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancelTimer, []);
  const reveal = () => {
    cancelTimer();
    timer.current = setTimeout(
      () => {
        timer.current = null;
        easeTo(opacity, 100, 24);
      },
      Math.max(0, props.delayMs ?? 350),
    );
  };
  const conceal = () => {
    cancelTimer();
    easeTo(opacity, 0, 18);
  };

  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      {props.children}
      <Rect
        width={props.width}
        height={props.height}
        fill={0x00000000}
        onPointerEnter={props.disabled ? undefined : reveal}
        onPointerLeave={props.disabled ? undefined : conceal}
      />
      <Surface
        x={tipX}
        y={tipY}
        width={tipWidth}
        height={tipHeight}
        fill={pal.overlay}
        radius={theme.foundations.radii.small}
        stroke={pal.border}
        strokeWidth={theme.foundations.borders.hairline}
        elevation="low"
        opacity={opacity.get() / 100}
      >
        <TextBlock
          x={8}
          width={tipWidth - 16}
          height={tipHeight}
          text={props.label}
          color={pal.text}
          fontSize={10}
          horizontalAlign="center"
          verticalAlign="center"
          wrap
          lineGap={2}
          overflow="ellipsis"
          maxLines={estimatedLines}
        />
      </Surface>
    </Group>
  );
}
