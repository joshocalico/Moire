import React, { type ReactNode } from "react";
import { Button, Surface, TextBlock, getUiScaleFactor, usePalette } from "@moire/ui";
import { Card } from "./card";

export const BANNER_HEIGHT = 72;
const WARNING = 0xffb48738;

/** Says the forecast below is saved rather than live, how old it is, and offers to retry. */
export function FreshnessBanner(props: {
  y: number;
  width: number;
  title: string;
  message: string;
  onRetry: () => void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const height = BANNER_HEIGHT * ui;
  const inset = 16 * ui;
  const buttonW = 84 * ui;
  const textW = Math.max(1, props.width - inset * 3 - buttonW);
  return (
    <Card y={props.y} width={props.width} height={height}>
      <Surface
        x={0}
        y={12 * ui}
        width={4 * ui}
        height={height - 24 * ui}
        radius={2 * ui}
        fill={WARNING}
      />
      <TextBlock
        x={inset}
        y={12 * ui}
        width={textW}
        height={18 * ui}
        text={props.title}
        fontSize={13}
        fontWeight="medium"
        maxLines={1}
        overflow="ellipsis"
      />
      <TextBlock
        x={inset}
        y={32 * ui}
        width={textW}
        height={30 * ui}
        text={props.message}
        color={pal.muted}
        fontSize={11}
        wrap
        maxLines={2}
        overflow="ellipsis"
      />
      <Button
        x={props.width - inset - buttonW}
        y={(height - 32 * ui) / 2}
        width={buttonW}
        height={32 * ui}
        label="Retry"
        focusId="weather:retry"
        onPress={props.onRetry}
      />
    </Card>
  );
}
