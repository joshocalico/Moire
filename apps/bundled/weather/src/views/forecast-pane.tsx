import React, { type ReactNode } from "react";
import { Button, EmptyState, ScrollArea, getUiScaleFactor } from "@moire/ui";
import { hourlySlots, type Sync, type Units } from "#weather/model";
import type { Forecast, Place } from "#weather/weather";
import { CURRENT_HEIGHT, Current } from "./current";
import { Daily, dailyHeight } from "./daily";
import { BANNER_HEIGHT, FreshnessBanner } from "./freshness-banner";
import { HOURLY_HEIGHT, Hourly } from "./hourly";

const GAP = 16;

/** The selected place's forecast, or the state that stands in for it. */
export function ForecastPane(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  place: Place | null;
  forecast: Forecast | null;
  sync: Sync;
  units: Units;
  /** A notice that the forecast shown is saved rather than live. */
  freshness: { title: string; message: string } | null;
  onRetry: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const { place, forecast } = props;
  if (!place || !forecast) {
    const retry = (label: string) => (
      <Button
        width={140}
        height={36}
        label={label}
        variant="primary"
        focusId="weather:retry"
        onPress={props.onRetry}
      />
    );
    const state = !place
      ? {
          title: "No place selected",
          message: "Search for a city or town to see its forecast.",
        }
      : props.sync.kind === "loading"
        ? { title: `Loading the forecast for ${place.name}…` }
        : props.sync.kind === "unavailable"
          ? {
              title: "Forecast unavailable",
              message: `${props.sync.failure.message} Nothing is saved for ${place.name} yet.`,
              action: retry("Try Again"),
            }
          : {
              title: `No saved forecast for ${place.name}`,
              action: retry("Get Forecast"),
            };
    return (
      <EmptyState
        x={props.x}
        y={props.y}
        width={props.width}
        height={props.height}
        icon="weather"
        {...state}
      />
    );
  }
  const pad = GAP * ui;
  const width = Math.max(1, props.width - pad);
  const hours = hourlySlots(forecast);
  // Cards stack top to bottom; each is present only when it has something to say.
  const blocks: Array<[height: number, render: (y: number) => ReactNode]> = [];
  if (props.freshness) {
    const { title, message } = props.freshness;
    blocks.push([
      BANNER_HEIGHT * ui,
      (y) => (
        <FreshnessBanner
          key="freshness"
          y={y}
          width={width}
          title={title}
          message={message}
          onRetry={props.onRetry}
        />
      ),
    ]);
  }
  blocks.push([
    CURRENT_HEIGHT * ui,
    (y) => (
      <Current
        key="current"
        y={y}
        width={width}
        place={place}
        forecast={forecast}
        units={props.units}
      />
    ),
  ]);
  if (hours.length)
    blocks.push([
      HOURLY_HEIGHT * ui,
      (y) => <Hourly key="hourly" y={y} width={width} hours={hours} units={props.units} />,
    ]);
  blocks.push([
    dailyHeight(forecast.days.length) * ui,
    (y) => <Daily key="daily" y={y} width={width} forecast={forecast} units={props.units} />,
  ]);
  let y = pad;
  const children = blocks.map(([height, render]) => {
    const node = render(y);
    y += height + pad;
    return node;
  });
  return (
    <ScrollArea
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      contentHeight={y}
      keyboard={{ focusId: "weather:forecast" }}
      fill={0x00000000}
    >
      {children}
    </ScrollArea>
  );
}
