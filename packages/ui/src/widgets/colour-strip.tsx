/** Swatches and bars drawn from numbers: a picture's dominant colours and its histogram. */
import React, { type ReactNode } from "react";
import { Group } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { mixColor } from "#ui/theme-family-color";
import { useWidgetTheme } from "#ui/widget-theme";
import { registerIntrinsicSize } from "./layout";
import { Pressable } from "./pressable";
import { Surface } from "./primitives";

export type ColourStripProps = {
  x?: number;
  y?: number;
  /** ARGB colours, drawn left to right. */
  colours: readonly number[];
  /** Swatch diameter before UI scale (default 18). */
  size?: number;
  /** Space between swatches before UI scale (default 6). */
  gap?: number;
  /** Makes each swatch pressable, e.g. to copy its colour. */
  onPress?(colour: number): void;
};

const SWATCH = 18;
const SWATCH_GAP = 6;

/** The strip's width, scaled, for `count` swatches. */
export function colourStripWidth(count: number, size = SWATCH, gap = SWATCH_GAP): number {
  const ui = getUiScaleFactor();
  return count > 0 ? count * Math.round(size * ui) + (count - 1) * Math.round(gap * ui) : 0;
}

/** Round swatches in a row, each outlined so pale colours stay visible on pale surfaces. */
export function ColourStrip(props: ColourStripProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const size = Math.round((props.size ?? SWATCH) * ui);
  const gap = Math.round((props.gap ?? SWATCH_GAP) * ui);
  const width = colourStripWidth(props.colours.length, props.size, props.gap);
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={width} height={size}>
      {props.colours.map((colour, index) =>
        props.onPress ? (
          <Pressable
            key={index}
            x={index * (size + gap)}
            width={size}
            height={size}
            radius={size / 2}
            fill={colour}
            hoverFill={colour}
            pressedFill={colour}
            stroke={pal.borderSubtle}
            strokeWidth={1}
            onPress={() => props.onPress?.(colour)}
          />
        ) : (
          <Surface
            key={index}
            x={index * (size + gap)}
            width={size}
            height={size}
            radius={size / 2}
            fill={colour}
            stroke={pal.borderSubtle}
            strokeWidth={1}
          />
        ),
      )}
    </Group>
  );
}

registerIntrinsicSize(ColourStrip, (props) => ({
  width: colourStripWidth(props.colours.length, props.size, props.gap),
  height: Math.round((props.size ?? SWATCH) * getUiScaleFactor()),
}));

export type HistogramProps = {
  x?: number;
  y?: number;
  width: number;
  height: number;
  /** Bin heights in 0..1, drawn left to right across the width. */
  values: readonly number[];
  /** Bar colour; a quiet mix of surface and muted by default. */
  colour?: number;
};

const MIN_BAR = 2;
const BAR_FILL_MIX = 0.75;

/** Bars rising from the baseline, one per value; bars under 2px are left out as noise. */
export function Histogram(props: HistogramProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const fill = props.colour ?? mixColor(pal.surface, pal.muted, BAR_FILL_MIX);
  const step = props.values.length ? props.width / props.values.length : 0;
  // One pixel between bars once they are wide enough to show it.
  const barWidth = Math.max(1, Math.round(step) - (step >= 3 ? 1 : 0));
  return (
    <Group x={props.x ?? 0} y={props.y ?? 0} width={props.width} height={props.height}>
      {props.values.map((value, index) => {
        const height = Math.round(Math.max(0, Math.min(1, value)) * props.height);
        if (height < MIN_BAR * ui) return null;
        const x = Math.round(index * step);
        return (
          <Surface
            key={index}
            x={x}
            y={props.height - height}
            width={Math.min(barWidth, props.width - x)}
            height={height}
            fill={fill}
          />
        );
      })}
    </Group>
  );
}

registerIntrinsicSize(Histogram, (props) => ({ width: props.width, height: props.height }));
