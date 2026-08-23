import React, { type ReactNode } from "react";
import { Row } from "./layout.js";
import { Separator, Surface } from "./primitives.js";
import { useWidgetTheme } from "../widget-theme.js";

export type StatusBarProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  padding?: number;
  gap?: number;
  children?: ReactNode;
};

/** Low-emphasis application status and mode strip. */
export function StatusBar(props: StatusBarProps): ReactNode {
  const theme = useWidgetTheme();
  const height = props.height ?? 28;
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={height}
      fill={theme.foundations.palette.panel}
    >
      <Separator width={props.width} />
      <Row
        y={1}
        width={props.width}
        height={height - 1}
        padding={props.padding ?? theme.foundations.space.sm}
        gap={props.gap ?? theme.foundations.space.md}
        align="center"
      >
        {props.children}
      </Row>
    </Surface>
  );
}
