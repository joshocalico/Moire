import React, { type ReactNode } from "react";
import { Separator, Surface, TextBlock, getUiScaleFactor, usePalette } from "@moire/ui";
import { dayLabel, formatTemperature, type Units } from "#weather/model";
import type { Day, Forecast } from "#weather/weather";
import { Card } from "./card";
import { RAIN, WeatherGlyph } from "./glyph";

const HEADING_HEIGHT = 44;
const ROW_HEIGHT = 46;

export const dailyHeight = (days: number) => HEADING_HEIGHT + days * ROW_HEIGHT + 8;

/** The week, each day's range drawn on the week's own temperature scale. */
export function Daily(props: {
  y: number;
  width: number;
  forecast: Forecast;
  units: Units;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const { days } = props.forecast;
  const weekMin = Math.min(...days.map((day) => day.min));
  const weekMax = Math.max(...days.map((day) => day.max));
  return (
    <Card y={props.y} width={props.width} height={dailyHeight(days.length) * ui}>
      <TextBlock
        x={16 * ui}
        width={props.width - 32 * ui}
        height={HEADING_HEIGHT * ui}
        text={`${days.length}-DAY FORECAST`}
        color={pal.muted}
        fontSize={11}
        fontWeight="medium"
        verticalAlign="center"
      />
      {days.map((day, index) => (
        <DayRow
          key={day.date}
          y={(HEADING_HEIGHT + index * ROW_HEIGHT) * ui}
          width={props.width}
          day={day}
          today={day.date === props.forecast.time.slice(0, 10)}
          weekMin={weekMin}
          weekMax={weekMax}
          divider={index > 0}
          units={props.units}
        />
      ))}
    </Card>
  );
}

function DayRow(props: {
  y: number;
  width: number;
  day: Day;
  today: boolean;
  weekMin: number;
  weekMax: number;
  divider: boolean;
  units: Units;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const { day } = props;
  const height = ROW_HEIGHT * ui;
  const inset = 16 * ui;
  const labelW = Math.min(110 * ui, props.width * 0.28);
  const glyph = 24 * ui;
  const rainW = 44 * ui;
  const tempW = 34 * ui;
  const barX = inset + labelW + glyph + 8 * ui + rainW + tempW + 8 * ui;
  const barW = Math.max(1, props.width - barX - 8 * ui - tempW - inset);
  // The bar is positioned in stored °C; the unit only changes the labels.
  const span = Math.max(1, props.weekMax - props.weekMin);
  const from = barX + ((day.min - props.weekMin) / span) * barW;
  const to = barX + ((day.max - props.weekMin) / span) * barW;
  const middle = height / 2;
  return (
    <>
      {props.divider ? (
        <Separator x={inset} y={props.y} width={props.width - inset * 2} color={pal.borderSubtle} />
      ) : null}
      <TextBlock
        x={inset}
        y={props.y}
        width={labelW}
        height={height}
        text={props.today ? "Today" : dayLabel(day.date)}
        fontSize={13}
        fontWeight={props.today ? "medium" : "regular"}
        verticalAlign="center"
        maxLines={1}
        overflow="ellipsis"
      />
      <WeatherGlyph
        x={inset + labelW}
        y={props.y + middle - glyph / 2}
        size={glyph}
        code={day.code}
      />
      <TextBlock
        x={inset + labelW + glyph + 8 * ui}
        y={props.y}
        width={rainW}
        height={height}
        text={day.rain >= 10 ? `${day.rain}%` : ""}
        color={RAIN}
        fontSize={11}
        fontWeight="medium"
        verticalAlign="center"
        maxLines={1}
      />
      <TextBlock
        x={barX - tempW - 8 * ui}
        y={props.y}
        width={tempW}
        height={height}
        text={formatTemperature(day.min, props.units)}
        color={pal.muted}
        fontSize={13}
        horizontalAlign="end"
        verticalAlign="center"
        maxLines={1}
      />
      <Surface
        x={barX}
        y={props.y + middle - 3 * ui}
        width={barW}
        height={6 * ui}
        radius={3 * ui}
        fill={pal.borderSubtle}
      />
      <Surface
        x={from}
        y={props.y + middle - 3 * ui}
        width={Math.max(6 * ui, to - from)}
        height={6 * ui}
        radius={3 * ui}
        fill={pal.accent}
      />
      <TextBlock
        x={barX + barW + 8 * ui}
        y={props.y}
        width={tempW}
        height={height}
        text={formatTemperature(day.max, props.units)}
        fontSize={13}
        fontWeight="medium"
        verticalAlign="center"
        maxLines={1}
      />
    </>
  );
}
