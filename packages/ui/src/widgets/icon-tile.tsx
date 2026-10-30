/** A tinted rounded square holding a symbolic icon: page identity in rows, tiles and heroes. */
import React, { type ReactNode } from "react";
import { getUiScaleFactor } from "#ui/font";
import { foregroundOn, mixColor } from "#ui/theme-family-color";
import { useWidgetTheme } from "#ui/widget-theme";
import { Icon, type IconName } from "./icon";
import { registerIntrinsicSize } from "./layout";
import { Surface } from "./primitives";

export type IconTileProps = {
  x?: number;
  y?: number;
  icon: IconName;
  /** Icon colour; the tile is a wash of it over the surface. The accent by default. */
  tint?: number;
  /** Side in unscaled pixels; 32 by default. */
  size?: number;
};

/** True when the palette's background is dark, so tints need a stronger wash to read. */
export function isDarkPalette(palette: { bg: number }): boolean {
  return foregroundOn(palette.bg) === 0xffffffff;
}

export function IconTile(props: IconTileProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const size = (props.size ?? 32) * getUiScaleFactor();
  const tint = props.tint ?? pal.accent;
  const glyph = Math.round(size * 0.52);
  return (
    <Surface
      x={props.x}
      y={props.y}
      width={size}
      height={size}
      radius={Math.round(size * 0.28)}
      fill={mixColor(pal.surface, tint, isDarkPalette(pal) ? 0.22 : 0.16)}
    >
      <Icon
        x={Math.round((size - glyph) / 2)}
        y={Math.round((size - glyph) / 2)}
        name={props.icon}
        size={glyph}
        color={tint}
        symbolic
      />
    </Surface>
  );
}

registerIntrinsicSize(IconTile, (props) => ({
  width: (props.size ?? 32) * getUiScaleFactor(),
  height: (props.size ?? 32) * getUiScaleFactor(),
}));
