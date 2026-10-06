import React, { type ReactNode } from "react";
import { Group } from "@moire/react-host";
import { Icon } from "./icon";
import { Label, usePalette } from "./primitives";
import { getUiScaleFactor } from "#ui/font";

export type BrandMarkProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  color?: number;
  /** Boot uses a quiet wordmark; welcome includes the interference blossom. */
  symbol?: boolean;
};

/** Shared Moire identity, with a bundled, licensed serif face and no hit regions. */
export function BrandMark(props: BrandMarkProps): ReactNode {
  const palette = usePalette();
  const symbol = props.symbol !== false;
  const scale = Math.min(props.width / (symbol ? 210 : 180), props.height / 66);
  const icon = 54 * scale;
  const textX = symbol ? 70 * scale : 0;
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      {symbol && (
        <Icon
          name="brand"
          x={0}
          y={(props.height - icon) / 2}
          size={icon}
          color={props.color ?? palette.text}
          symbolic
        />
      )}
      <Label
        x={textX}
        width={Math.max(0, props.width - textX)}
        height={props.height}
        text="moire"
        fontFamily="serif"
        fontSize={(40 * scale) / getUiScaleFactor()}
        color={props.color ?? palette.text}
        verticalAlign="center"
      />
    </Group>
  );
}
