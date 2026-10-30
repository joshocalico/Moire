import React, { type ReactNode } from "react";
import {
  Button,
  Icon,
  IconButton,
  Pressable,
  ScrollArea,
  SearchField,
  Separator,
  TextBlock,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import { formatTimeAgo } from "@moire/app-tools";
import { formatTemperature, isStale, type Search, type Units } from "#weather/model";
import type { CachedPlace, Place } from "#weather/weather";
import { Card } from "./card";
import { WeatherGlyph } from "./glyph";

const ROW_HEIGHT = 52;
const HEADER_HEIGHT = 32;
const FOOTER_HEIGHT = 58;
/** evdev KEY_DELETE and KEY_BACKSPACE: either removes the focused saved place. */
const DELETE_KEYS = new Set([111, 14]);
/** evdev KEY_ENTER and KEY_SPACE open the focused place, as Pressable does by default. */
const OPEN_KEYS = new Set([28, 57]);

/** Location search, its results, and the places already saved. */
export function PlacesSidebar(props: {
  x: number;
  y: number;
  width: number;
  height: number;
  query: string;
  search: Search;
  entries: readonly CachedPlace[];
  selectedId: string | null;
  units: Units;
  now: number;
  onQuery: (value: string) => void;
  onSearch: () => void;
  onPick: (place: Place) => void;
  onRemove: (place: Place) => void;
  onClear: () => void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const inset = 12 * ui,
    innerW = props.width - inset * 2,
    rowH = ROW_HEIGHT * ui,
    headerH = HEADER_HEIGHT * ui,
    footerH = FOOTER_HEIGHT * ui;
  const listY = inset + 36 * ui + 8 * ui + 34 * ui + 8 * ui;
  const results = props.search.kind === "results" ? props.search.places : [];
  const resultsH = results.length ? headerH + results.length * rowH : 0;
  const header = (y: number, text: string) => (
    <TextBlock
      x={inset / 2 + 4 * ui}
      y={y}
      width={innerW}
      height={headerH}
      text={text}
      color={pal.muted}
      fontSize={11}
      fontWeight="medium"
      verticalAlign="center"
    />
  );
  return (
    <Card x={props.x} y={props.y} width={props.width} height={props.height}>
      <SearchField
        x={inset}
        y={inset}
        width={innerW}
        height={36 * ui}
        value={props.query}
        placeholder="City or town"
        focusId="weather:search"
        onChange={props.onQuery}
        onSubmit={props.onSearch}
      />
      <Button
        x={inset}
        y={inset + 44 * ui}
        width={innerW}
        height={34 * ui}
        label={props.search.kind === "searching" ? "Searching…" : "Find Location"}
        focusId="weather:find"
        disabled={props.search.kind === "searching"}
        onPress={props.onSearch}
      />
      <ScrollArea
        x={inset / 2}
        y={listY}
        width={props.width - inset}
        height={Math.max(1, props.height - listY - footerH)}
        contentHeight={resultsH + headerH + Math.max(1, props.entries.length) * rowH}
        fill={0x00000000}
      >
        {results.length ? header(0, "RESULTS") : null}
        {results.map((result, index) => (
          <PlaceRow
            key={`${result.id}:${index}`}
            y={headerH + index * rowH}
            width={innerW}
            focusId={`weather:result:${index}`}
            title={result.name}
            detail={result.country}
            selected={false}
            onPress={() => props.onPick(result)}
          />
        ))}
        {header(resultsH, "SAVED PLACES")}
        {props.entries.length ? (
          props.entries.map((entry, index) => (
            <PlaceRow
              key={entry.place.id}
              y={resultsH + headerH + index * rowH}
              width={innerW}
              focusId={`weather:place:${entry.place.id}`}
              title={entry.place.name}
              // Old forecasts say how old they are, so a glance at the list shows what is stale.
              detail={
                isStale(entry.forecast, props.now)
                  ? [entry.place.country, formatTimeAgo(entry.forecast.fetchedAt, props.now)]
                      .filter(Boolean)
                      .join(" · ")
                  : entry.place.country
              }
              selected={entry.place.id === props.selectedId}
              code={entry.forecast.code}
              temperature={formatTemperature(entry.forecast.temperature, props.units)}
              onPress={() => props.onPick(entry.place)}
              onRemove={() => props.onRemove(entry.place)}
            />
          ))
        ) : (
          <TextBlock
            x={inset / 2 + 4 * ui}
            y={resultsH + headerH}
            width={innerW}
            height={rowH}
            text="Places you open are kept here."
            color={pal.muted}
            fontSize={12}
            verticalAlign="center"
            wrap
            maxLines={2}
          />
        )}
      </ScrollArea>
      <Separator x={inset} y={props.height - footerH} width={innerW} color={pal.borderSubtle} />
      <Button
        x={inset}
        y={props.height - footerH + 12 * ui}
        width={innerW}
        height={34 * ui}
        label="Clear Saved Places"
        variant="ghost"
        focusId="weather:clear"
        disabled={!props.entries.length}
        onPress={props.onClear}
      />
    </Card>
  );
}

/** A search result or saved place; saved places carry their sky, temperature and a remove button. */
function PlaceRow(props: {
  y: number;
  width: number;
  focusId: string;
  title: string;
  detail: string;
  selected: boolean;
  code?: number;
  temperature?: string;
  onPress: () => void;
  onRemove?: () => void;
}): ReactNode {
  const pal = usePalette();
  const ui = getUiScaleFactor();
  const height = (ROW_HEIGHT - 4) * ui;
  const removeW = props.onRemove ? 24 * ui : 0;
  const trailingW = props.temperature ? 70 * ui + removeW : 0;
  const textW = Math.max(1, props.width - 10 * ui - trailingW);
  const temperatureX = props.width - removeW - 38 * ui;
  return (
    <>
      <Pressable
        x={6 * ui}
        y={props.y}
        width={props.width}
        height={height}
        radius={8 * ui}
        fill={props.selected ? pal.selection : 0x00000000}
        focusable
        focusId={props.focusId}
        onPress={props.onPress}
        // Supplying onKeyDown replaces Pressable's own Enter/Space handling, so keep it here.
        onKeyDown={(event) => {
          if (event.repeat) return;
          if (OPEN_KEYS.has(event.code)) props.onPress();
          else if (DELETE_KEYS.has(event.code)) props.onRemove?.();
        }}
      >
        <TextBlock
          x={10 * ui}
          y={7 * ui}
          width={textW}
          text={props.title}
          fontSize={13}
          fontWeight={props.selected ? "medium" : "regular"}
          overflow="ellipsis"
          maxLines={1}
        />
        <TextBlock
          x={10 * ui}
          y={26 * ui}
          width={textW}
          text={props.detail}
          color={pal.muted}
          fontSize={11}
          overflow="ellipsis"
          maxLines={1}
        />
        {props.temperature && props.code !== undefined ? (
          <>
            <WeatherGlyph
              x={temperatureX - 24 * ui}
              y={height / 2 - 11 * ui}
              size={22 * ui}
              code={props.code}
            />
            <TextBlock
              x={temperatureX}
              width={30 * ui}
              height={height}
              text={props.temperature}
              fontSize={14}
              horizontalAlign="end"
              verticalAlign="center"
              maxLines={1}
            />
          </>
        ) : null}
      </Pressable>
      {props.onRemove ? (
        <IconButton
          x={6 * ui + props.width - removeW - 2 * ui}
          y={props.y + (height - removeW) / 2}
          width={removeW}
          height={removeW}
          size="small"
          variant="ghost"
          tooltip={`Remove ${props.title}`}
          focusId={`${props.focusId}:remove`}
          icon={(style) => <Icon symbolic name="close" size={style.size} color={pal.muted} />}
          onPress={props.onRemove}
        />
      ) : null}
    </>
  );
}
