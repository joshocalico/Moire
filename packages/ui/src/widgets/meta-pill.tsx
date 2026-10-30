/** A small translucent pill for a fact laid over a picture: dimensions, duration, camera. */
import React, { type ReactNode } from "react";
import { measureTextBounds } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { registerIntrinsicSize } from "./layout";
import { Surface, TextBlock } from "./primitives";

export type MetaPillProps = {
  x?: number;
  y?: number;
  text: string;
  /** "overlay" lets the picture show through; "solid" stays legible over busy pictures. */
  tone?: "overlay" | "solid";
};

const PILL_H = 22;
const PAD_X = 8;
const TEXT_SIZE = 11;
// Fixed, not themed: the pill sits on a picture, whose colours the theme doesn't know.
const OVERLAY_FILL = 0xb0000000;
const SOLID_FILL = 0xe0202024;
const INK = 0xffffffff;

export function metaPillWidth(text: string): number {
  const label = measureTextBounds(text, { fontSize: TEXT_SIZE, fontWeight: "medium" }).width;
  return Math.ceil(label + PAD_X * 2 * getUiScaleFactor());
}

export function metaPillHeight(): number {
  return Math.round(PILL_H * getUiScaleFactor());
}

/** White medium text on a dark rounded pill, sized to its text. */
export function MetaPill(props: MetaPillProps): ReactNode {
  const width = metaPillWidth(props.text);
  const height = metaPillHeight();
  return (
    <Surface
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={width}
      height={height}
      radius={height / 2}
      fill={props.tone === "solid" ? SOLID_FILL : OVERLAY_FILL}
    >
      <TextBlock
        width={width}
        height={height}
        text={props.text}
        color={INK}
        fontSize={TEXT_SIZE}
        fontWeight="medium"
        horizontalAlign="center"
        verticalAlign="center"
        maxLines={1}
      />
    </Surface>
  );
}

registerIntrinsicSize(MetaPill, (props) => ({
  width: metaPillWidth(props.text),
  height: metaPillHeight(),
}));
