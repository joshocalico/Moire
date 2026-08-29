import React, { type ReactNode } from "react";
import { Surface } from "./primitives";
import { Row, registerIntrinsicSize } from "./layout";
import { useWidgetTheme } from "#ui/widget-theme";

export type ToolbarProps = {
  x?: number;
  y?: number;
  width: number;
  height?: number;
  padding?: number;
  gap?: number;
  children?: ReactNode;
};

/** Recipe-neutral application toolbar with consistent chrome and spacing. */
export function Toolbar(props: ToolbarProps): ReactNode {
  const theme = useWidgetTheme();
  const height = props.height ?? 52;
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={props.width}
      height={height}
      fill={theme.foundations.palette.panel}
    >
      <Row
        width={props.width}
        height={height}
        padding={props.padding ?? theme.foundations.space.md}
        gap={props.gap ?? theme.foundations.space.sm}
        align="center"
      >
        {props.children}
      </Row>
    </Surface>
  );
}

registerIntrinsicSize(Toolbar, (props) => ({
  width: props.width,
  height: props.height ?? 52,
}));
