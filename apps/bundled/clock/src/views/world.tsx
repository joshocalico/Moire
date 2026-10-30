import React, { type ReactNode } from "react";
import {
  Box,
  Button,
  Horizontal,
  Icon,
  IconButton,
  ScrollArea,
  TextBlock,
  Vertical,
  getUiScaleFactor,
  usePalette,
  type WindowSize,
} from "@moire/ui";
import { Card, localTimeZone } from "@moire/app-tools";
import { relativeDay, relativeOffset, zoneOf, zoneTime } from "#clock/world";
import { CARD_INSET, DIGIT_ADVANCE, READOUT, panelWidth } from "./readout";

const LIST_MAX_WIDTH = 640;
const CONTROL_HEIGHT = 36;
const ROW_GAP = 8;

/** Local time, large, and the user's world clocks under it. */
export function WorldPanel(
  props: WindowSize & {
    now: number;
    cities: readonly string[];
    onAdd: () => void;
    onRemove: (zone: string) => void;
  },
): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const pad = 16 * ui;
  const compact = props.cities.length > 0;
  const localH = (compact ? 136 : 210) * ui;
  const addRowH = 40 * ui;
  if (!compact) {
    // Alone, the local clock sits above centre with the way to add cities beneath it.
    const contentH = localH + 16 * ui + addRowH;
    const top = Math.round(Math.max(pad, (props.height - contentH) / 2.4));
    return (
      <Box width={props.width} height={props.height}>
        <LocalTime width={props.width} y={top} height={localH} now={props.now} compact={false} />
        <Horizontal
          y={top + localH + 16 * ui}
          width={props.width}
          height={addRowH}
          justify="center"
          align="center"
        >
          {addCityButton("primary", props.onAdd)}
        </Horizontal>
      </Box>
    );
  }
  const width = Math.min(props.width - pad * 2, LIST_MAX_WIDTH * ui);
  const x = (props.width - width) / 2;
  const cardH = (CONTROL_HEIGHT + CARD_INSET * 2) * ui,
    gap = ROW_GAP * ui;
  const headerY = pad + localH;
  const listY = headerY + addRowH + gap;
  return (
    <Box width={props.width} height={props.height}>
      <LocalTime width={props.width} y={pad} height={localH} now={props.now} compact />
      <Horizontal x={x} y={headerY} width={width} height={addRowH} gap={8 * ui} align="center">
        <TextBlock
          flexGrow={1}
          text={`WORLD CLOCKS · ${props.cities.length}`}
          color={pal.muted}
          fontSize={11}
          fontWeight="medium"
          maxLines={1}
        />
        {addCityButton("secondary", props.onAdd)}
      </Horizontal>
      <ScrollArea
        x={x}
        y={listY}
        width={width + 10 * ui}
        height={Math.max(1, props.height - listY - pad)}
        contentHeight={props.cities.length * (cardH + gap)}
        fill={0x00000000}
      >
        {props.cities.map((zone, index) => (
          <CityRow
            key={zone}
            y={index * (cardH + gap)}
            width={width}
            height={cardH}
            zone={zone}
            now={props.now}
            onRemove={() => props.onRemove(zone)}
          />
        ))}
      </ScrollArea>
    </Box>
  );
}

/** A plain function rather than a component, so the row lays the Button out at its own size. */
function addCityButton(variant: "primary" | "secondary", onPress: () => void): ReactNode {
  return (
    <Button
      height={CONTROL_HEIGHT * getUiScaleFactor()}
      label="Add City…"
      variant={variant}
      focusId="clock:add-city"
      onPress={onPress}
    />
  );
}

function LocalTime(props: {
  width: number;
  y: number;
  height: number;
  now: number;
  compact: boolean;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const date = new Date(props.now);
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const width = panelWidth(props.width);
  const clock = `${part("hour")}:${part("minute")}`;
  const clockH = (props.compact ? 80 : 112) * ui;
  const fontSize = Math.min(
    props.compact ? 64 : 104,
    Math.floor((width - 54 * ui) / ui / (clock.length * DIGIT_ADVANCE)),
  );
  return (
    <Vertical
      x={Math.round((props.width - width) / 2)}
      y={props.y}
      width={width}
      height={props.height}
      gap={0}
      align="center"
      justify="center"
    >
      <Horizontal height={clockH} gap={10 * ui} align="center">
        <TextBlock text={clock} fontFamily={READOUT.fontFamily} fontSize={fontSize} maxLines={1} />
        <Vertical width={44 * ui} height={clockH * 0.64} gap={2 * ui} justify="center">
          <TextBlock
            text={part("dayPeriod").toLocaleUpperCase()}
            color={pal.accent}
            fontSize={13}
            fontWeight="medium"
            maxLines={1}
          />
          <TextBlock
            text={part("second")}
            fontFamily={READOUT.fontFamily}
            fontSize={props.compact ? 22 : 30}
            color={pal.muted}
          />
        </Vertical>
      </Horizontal>
      <Box width={width} height={(props.compact ? 4 : 12) * ui} />
      <TextBlock
        width={width}
        text={date.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
        fontSize={props.compact ? 15 : 18}
        fontWeight="medium"
        horizontalAlign="center"
        maxLines={1}
        overflow="ellipsis"
      />
      <Box width={width} height={6 * ui} />
      <TextBlock
        width={width}
        text={localTimeZone().replace(/_/g, " ")}
        color={pal.muted}
        fontSize={12}
        horizontalAlign="center"
        maxLines={1}
      />
    </Vertical>
  );
}

function CityRow(props: {
  y: number;
  width: number;
  height: number;
  zone: string;
  now: number;
  onRemove: () => void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const zone = zoneOf(props.zone);
  const day = relativeDay(props.zone, props.now);
  const offset = relativeOffset(props.zone, props.now);
  return (
    <Card y={props.y} width={props.width} height={props.height}>
      <Horizontal
        width={props.width - CARD_INSET * 2 * ui}
        height={CONTROL_HEIGHT * ui}
        gap={14 * ui}
        align="center"
      >
        <Vertical flexGrow={1} height={CONTROL_HEIGHT * ui} gap={0} justify="center">
          <TextBlock
            text={zone.city}
            fontSize={15}
            fontWeight="medium"
            maxLines={1}
            overflow="ellipsis"
          />
          <TextBlock
            text={[day, offset, zone.region].filter(Boolean).join(" · ")}
            color={pal.muted}
            fontSize={12}
            maxLines={1}
            overflow="ellipsis"
          />
        </Vertical>
        <TextBlock
          text={zoneTime(props.zone, props.now)}
          fontFamily={READOUT.fontFamily}
          fontSize={28}
          maxLines={1}
        />
        <IconButton
          icon={(style) => <Icon name="trash" {...style} symbolic />}
          variant="ghost"
          tooltip={`Remove ${zone.city}`}
          focusId={`clock:remove-city:${props.zone}`}
          onPress={props.onRemove}
        />
      </Horizontal>
    </Card>
  );
}
