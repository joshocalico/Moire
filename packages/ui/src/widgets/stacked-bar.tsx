/**
 * A one-line proportional bar with a legend under it, e.g. a folder's size by kind. Unlike
 * `StackedBarChart` it has no axes or series: one total, split into coloured segments.
 */
import React, { type ReactNode } from "react";
import { Group, measureTextBounds } from "@moire/react-host";
import { getUiScaleFactor } from "#ui/font";
import { useWidgetTheme } from "#ui/widget-theme";
import { registerIntrinsicSize } from "./layout";
import { Surface, TextBlock } from "./primitives";

export type StackedBarSegment = {
  id: string;
  label: string;
  value: number;
  colour: number;
  /** After the label in the legend, e.g. "185.8 KB". */
  detail?: string;
};

export type StackedBarProps = {
  x?: number;
  y?: number;
  width: number;
  segments: readonly StackedBarSegment[];
  /** Bar thickness before UI scale (default 8). */
  barHeight?: number;
  /** Show the legend row under the bar (default true). */
  legend?: boolean;
};

const BAR_H = 8;
const MIN_SEGMENT = 3;
const LEGEND_GAP = 8;
const LEGEND_H = 18;
const DOT = 8;
const DOT_GAP = 4;
const ITEM_GAP = 10;
const LEGEND_SIZE = 11;

/** The widget's height, scaled, with the default bar height. */
export function stackedBarHeight(legend = true, barHeight = BAR_H): number {
  const ui = getUiScaleFactor();
  return Math.round(barHeight * ui) + (legend ? Math.round((LEGEND_GAP + LEGEND_H) * ui) : 0);
}

function legendText(segment: StackedBarSegment): string {
  return segment.detail ? `${segment.label} ${segment.detail}` : segment.label;
}

/** Segment widths that fill `width`: proportional, at least 3px each, the last taking the rest. */
function segmentWidths(segments: readonly StackedBarSegment[], width: number): number[] {
  const ui = getUiScaleFactor();
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0);
  if (total <= 0) return segments.map(() => 0);
  const min = Math.round(MIN_SEGMENT * ui);
  const widths = segments.map((segment) =>
    segment.value > 0 ? Math.max(min, Math.round((segment.value / total) * width)) : 0,
  );
  // Minimums and rounding can over- or under-fill; settle the difference on the widest segment.
  const drift = width - widths.reduce((sum, value) => sum + value, 0);
  const widest = widths.indexOf(Math.max(...widths));
  widths[widest] = Math.max(min, widths[widest]! + drift);
  return widths;
}

/** Legend items left to right, dropping the ones that would run past `width`. */
function legendLayout(
  segments: readonly StackedBarSegment[],
  width: number,
): Array<{ segment: StackedBarSegment; x: number; width: number }> {
  const ui = getUiScaleFactor();
  const placed: Array<{ segment: StackedBarSegment; x: number; width: number }> = [];
  let x = 0;
  for (const segment of segments) {
    if (segment.value <= 0) continue;
    const text = Math.ceil(measureTextBounds(legendText(segment), { fontSize: LEGEND_SIZE }).width);
    const item = Math.round((DOT + DOT_GAP) * ui) + text;
    if (x + item > width) continue;
    placed.push({ segment, x, width: item });
    x += item + Math.round(ITEM_GAP * ui);
  }
  return placed;
}

export function StackedBar(props: StackedBarProps): ReactNode {
  const pal = useWidgetTheme().foundations.palette;
  const ui = getUiScaleFactor();
  const legend = props.legend ?? true;
  const barH = Math.round((props.barHeight ?? BAR_H) * ui);
  const widths = segmentWidths(props.segments, props.width);
  const legendY = barH + Math.round(LEGEND_GAP * ui);
  const legendH = Math.round(LEGEND_H * ui);
  const dot = Math.round(DOT * ui);
  let x = 0;
  return (
    <Group
      x={props.x ?? 0}
      y={props.y ?? 0}
      width={props.width}
      height={stackedBarHeight(legend, props.barHeight)}
    >
      <Surface width={props.width} height={barH} radius={barH / 2} fill={pal.surface} clip>
        {props.segments.map((segment, index) => {
          const width = widths[index]!;
          const at = x;
          x += width;
          return width > 0 ? (
            <Surface
              key={segment.id}
              x={at}
              width={Math.min(width, props.width - at)}
              height={barH}
              fill={segment.colour}
            />
          ) : null;
        })}
      </Surface>
      {legend
        ? legendLayout(props.segments, props.width).map(({ segment, x: itemX, width }) => (
            <Group key={segment.id} x={itemX} y={legendY} width={width} height={legendH}>
              <Surface
                y={Math.round((legendH - dot) / 2)}
                width={dot}
                height={dot}
                radius={dot / 2}
                fill={segment.colour}
              />
              <TextBlock
                x={Math.round((DOT + DOT_GAP) * ui)}
                width={width - Math.round((DOT + DOT_GAP) * ui)}
                height={legendH}
                text={legendText(segment)}
                color={pal.muted}
                fontSize={LEGEND_SIZE}
                verticalAlign="center"
                maxLines={1}
              />
            </Group>
          ))
        : null}
    </Group>
  );
}

registerIntrinsicSize(StackedBar, (props) => ({
  width: props.width,
  height: stackedBarHeight(props.legend ?? true, props.barHeight),
}));
