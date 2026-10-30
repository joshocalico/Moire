import React, { useEffect, useRef, type ReactNode } from "react";
import { Group, Rect, measureTextBounds, type SceneNode } from "@moire/react-host";
import { easeTo, useMotionValue } from "#ui/motion";
import { useWidgetTheme } from "#ui/widget-theme";
import { OverlayPortal, useOverlayHost } from "./overlay";
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
  /** An interactive child can own hover while the tooltip supplies help. */
  open?: boolean;
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
  const host = useOverlayHost();
  const trigger = useRef<SceneNode | null>(null);
  // Inside an OverlayHost the tip paints in its top layer, above later siblings, and keeps to
  // the host's bounds; elsewhere it paints inline beside the trigger.
  const located = host && trigger.current ? host.locate(trigger.current) : null;
  const tip = tipPosition(
    props.placement ?? "top",
    {
      x: located?.x ?? 0,
      y: located?.y ?? 0,
      width: props.width,
      height: props.height,
    },
    { width: tipWidth, height: tipHeight },
    offset,
    located,
  );
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
  useEffect(() => {
    if (props.open == null) return;
    if (props.open && !props.disabled) reveal();
    else conceal();
    return cancelTimer;
  }, [props.open, props.disabled]);

  const surface = (
    <Surface
      x={tip.x}
      y={tip.y}
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
  );
  return (
    <Group
      ref={trigger}
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={props.height}
    >
      {props.children}
      {props.open == null ? (
        <Rect
          width={props.width}
          height={props.height}
          fill={0x00000000}
          onPointerEnter={props.disabled ? undefined : reveal}
          onPointerLeave={props.disabled ? undefined : conceal}
        />
      ) : null}
      {located && opacity.get() > 0 ? (
        <OverlayPortal>{surface}</OverlayPortal>
      ) : located ? null : (
        surface
      )}
    </Group>
  );
}

type Box = { x: number; y: number; width: number; height: number };

/**
 * Where the tip goes beside its trigger. Within known bounds it flips to the opposite side when
 * the preferred one has no room, then slides along the edge to stay inside.
 */
function tipPosition(
  placement: TooltipPlacement,
  trigger: Box,
  tip: { width: number; height: number },
  offset: number,
  bounds: { width: number; height: number } | null,
): { x: number; y: number } {
  const margin = 4;
  const fits = (side: TooltipPlacement) => {
    if (!bounds) return true;
    if (side === "top") return trigger.y - offset - tip.height >= margin;
    if (side === "bottom")
      return trigger.y + trigger.height + offset + tip.height <= bounds.height - margin;
    if (side === "left") return trigger.x - offset - tip.width >= margin;
    return trigger.x + trigger.width + offset + tip.width <= bounds.width - margin;
  };
  const opposite = {
    top: "bottom",
    bottom: "top",
    left: "right",
    right: "left",
  } as const;
  const side = fits(placement) || !fits(opposite[placement]) ? placement : opposite[placement];
  let x =
    side === "left"
      ? trigger.x - tip.width - offset
      : side === "right"
        ? trigger.x + trigger.width + offset
        : trigger.x + Math.round((trigger.width - tip.width) / 2);
  let y =
    side === "top"
      ? trigger.y - tip.height - offset
      : side === "bottom"
        ? trigger.y + trigger.height + offset
        : trigger.y + Math.round((trigger.height - tip.height) / 2);
  if (bounds) {
    x = Math.max(margin, Math.min(x, bounds.width - tip.width - margin));
    y = Math.max(margin, Math.min(y, bounds.height - tip.height - margin));
  }
  return { x, y };
}
