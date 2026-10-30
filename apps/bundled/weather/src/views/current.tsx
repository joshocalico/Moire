import React, { type ReactNode } from "react";
import { Separator, TextBlock, getUiScaleFactor, usePalette } from "@moire/ui";
import { formatTemperature, formatWind, today, weatherLabel, type Units } from "#weather/model";
import type { Forecast, Place } from "#weather/weather";
import { Card } from "./card";
import { WeatherGlyph } from "./glyph";

export const CURRENT_HEIGHT = 216;

/** Current conditions: the sky, the temperature large, and the details beneath. */
export function Current(props: {
  y: number;
  width: number;
  place: Place;
  forecast: Forecast;
  units: Units;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const { forecast, units } = props;
  const height = CURRENT_HEIGHT * ui;
  const day = today(forecast);
  const inset = 20 * ui;
  const glyph = 84 * ui;
  const textX = inset + glyph + 16 * ui;
  const textW = Math.max(1, props.width - textX - inset);
  const stats = [
    ["Feels like", formatTemperature(forecast.feelsLike, units)],
    ["Wind", formatWind(forecast.wind, units)],
    ["Rain", day ? `${day.rain}%` : "—"],
  ] as const;
  const statsY = height - 64 * ui;
  const statW = (props.width - inset * 2) / stats.length;
  return (
    <Card y={props.y} width={props.width} height={height}>
      <WeatherGlyph x={inset} y={inset + 6 * ui} size={glyph} code={forecast.code} />
      <TextBlock
        x={textX}
        y={inset - 4 * ui}
        width={textW}
        height={76 * ui}
        text={formatTemperature(forecast.temperature, units)}
        fontFamily="display"
        fontSize={64}
        verticalAlign="center"
        maxLines={1}
      />
      <TextBlock
        x={textX}
        y={inset + 74 * ui}
        width={textW}
        height={22 * ui}
        text={weatherLabel(forecast.code)}
        fontSize={17}
        fontWeight="medium"
        maxLines={1}
        overflow="ellipsis"
      />
      <TextBlock
        x={textX}
        y={inset + 98 * ui}
        width={textW}
        height={18 * ui}
        text={
          day
            ? `High ${formatTemperature(day.max, units)} · Low ${formatTemperature(day.min, units)}`
            : props.place.timeZone
        }
        color={pal.muted}
        fontSize={12}
        maxLines={1}
        overflow="ellipsis"
      />
      <Separator
        x={inset}
        y={statsY - 10 * ui}
        width={props.width - inset * 2}
        color={pal.borderSubtle}
      />
      {stats.map(([label, value], index) => (
        <React.Fragment key={label}>
          <TextBlock
            x={inset + index * statW}
            y={statsY}
            width={statW - 8 * ui}
            height={16 * ui}
            text={label.toLocaleUpperCase()}
            color={pal.muted}
            fontSize={10}
            fontWeight="medium"
            maxLines={1}
          />
          <TextBlock
            x={inset + index * statW}
            y={statsY + 18 * ui}
            width={statW - 8 * ui}
            height={24 * ui}
            text={value}
            fontSize={16}
            fontWeight="medium"
            maxLines={1}
            overflow="ellipsis"
          />
        </React.Fragment>
      ))}
    </Card>
  );
}
