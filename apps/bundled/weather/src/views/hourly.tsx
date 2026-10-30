import React, { type ReactNode } from "react";
import { TextBlock, getUiScaleFactor, usePalette } from "@moire/ui";
import { formatTemperature, hourLabel, type Units } from "#weather/model";
import type { Hour } from "#weather/weather";
import { Card } from "./card";
import { RAIN, WeatherGlyph } from "./glyph";

export const HOURLY_HEIGHT = 140;
const HEADING_HEIGHT = 40;

/** The next day in even steps: hour, sky, temperature and any real chance of rain. */
export function Hourly(props: {
  y: number;
  width: number;
  hours: readonly Hour[];
  units: Units;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const inset = 16 * ui;
  const columnW = (props.width - inset * 2) / Math.max(1, props.hours.length);
  const glyph = 24 * ui;
  const top = HEADING_HEIGHT * ui;
  return (
    <Card y={props.y} width={props.width} height={HOURLY_HEIGHT * ui}>
      <TextBlock
        x={inset}
        width={props.width - inset * 2}
        height={top}
        text="NEXT 24 HOURS"
        color={pal.muted}
        fontSize={11}
        fontWeight="medium"
        verticalAlign="center"
      />
      {props.hours.map((hour, index) => {
        const x = inset + index * columnW;
        const label = {
          x,
          width: columnW,
          horizontalAlign: "center",
          maxLines: 1,
        } as const;
        return (
          <React.Fragment key={hour.time}>
            <TextBlock
              {...label}
              y={top}
              height={18 * ui}
              text={index === 0 ? "Now" : hourLabel(hour.time)}
              color={index === 0 ? pal.text : pal.muted}
              fontSize={11}
              fontWeight={index === 0 ? "medium" : "regular"}
            />
            <WeatherGlyph
              x={x + (columnW - glyph) / 2}
              y={top + 22 * ui}
              size={glyph}
              code={hour.code}
            />
            <TextBlock
              {...label}
              y={top + 50 * ui}
              height={20 * ui}
              text={formatTemperature(hour.temperature, props.units)}
              fontSize={14}
              fontWeight="medium"
            />
            <TextBlock
              {...label}
              y={top + 72 * ui}
              height={16 * ui}
              text={hour.rain >= 10 ? `${hour.rain}%` : ""}
              color={RAIN}
              fontSize={10}
              fontWeight="medium"
            />
          </React.Fragment>
        );
      })}
    </Card>
  );
}
