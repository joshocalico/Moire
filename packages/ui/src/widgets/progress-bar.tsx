/** Determinate progress indicator with recipe-owned geometry and paint. */
import React, { type ReactNode } from "react";
import { Group, Rect } from "@moire/react-host";
import { useWidgetTheme, type ButtonSize } from "../widget-theme.js";

export type ProgressBarProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  size?: ButtonSize;
  value: number;
};

export function ProgressBar(props: ProgressBarProps): ReactNode {
  const recipe = useWidgetTheme().recipes.progressBar[props.size ?? "medium"];
  const height = props.height ?? recipe.metrics.height;
  const value = Math.max(0, Math.min(1, props.value));
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={height}
      clip
    >
      <Rect
        width={props.width}
        height={height}
        fill={recipe.track.fill}
        radius={recipe.track.radius}
        stroke={recipe.track.stroke}
        strokeWidth={recipe.track.strokeWidth}
      />
      <Rect
        width={Math.floor(props.width * value)}
        height={height}
        fill={recipe.fill.fill}
        radius={recipe.fill.radius}
      />
    </Group>
  );
}
