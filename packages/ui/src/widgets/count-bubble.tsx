/** A round accent count, shared by the rail's badges and the selection bar. */
import React, { type ReactNode } from "react";
import { Group, Rect, measureTextBounds } from "@moire/react-host";
import { foregroundOn } from "#ui/theme-family-color";
import { useWidgetTheme } from "#ui/widget-theme";
import { TextBlock } from "./primitives";

export type CountBubbleProps = {
  x?: number;
  y?: number;
  text: string;
  /** Diameter; longer counts stretch into a pill. */
  size: number;
  fontSize: number;
  fill?: number;
};

export function countBubbleWidth(text: string, size: number, fontSize: number): number {
  const label = measureTextBounds(text, { fontSize, fontWeight: "medium" }).width;
  return Math.max(size, Math.ceil(label + size * 0.6));
}

export function CountBubble(props: CountBubbleProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const fill = props.fill ?? pal.accent;
  const width = countBubbleWidth(props.text, props.size, props.fontSize);
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={width} height={props.size}>
      <Rect width={width} height={props.size} fill={fill} radius={props.size / 2} />
      <TextBlock
        width={width}
        height={props.size}
        text={props.text}
        color={foregroundOn(fill)}
        fontSize={props.fontSize}
        fontWeight="medium"
        horizontalAlign="center"
        verticalAlign="center"
        maxLines={1}
      />
    </Group>
  );
}
