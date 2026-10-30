/** The selected day's events (or search results) as cards beside the month grid. */
import React, { type ReactNode } from "react";
import { wallClock } from "@moire/app-tools";
import {
  Box,
  EmptyState,
  Icon,
  IconButton,
  Label,
  Pressable,
  ScrollArea,
  SearchField,
  Surface,
  getUiScaleFactor,
  usePalette,
} from "@moire/ui";
import { dayTitle } from "#calendar/dates";
import { describeRepeat, type CalendarEvent, type Occurrence } from "#calendar/model";
import { eventColor } from "./color";
import type { Frame } from "./frame";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

function EventCard(props: {
  y: number;
  width: number;
  height: number;
  occurrence: Occurrence;
  zone: string;
  showDate: boolean;
  onEdit: () => void;
  onDelete: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const { event } = props.occurrence;
  const start = wallClock(props.occurrence.startMs, props.zone),
    end = wallClock(props.occurrence.endMs, props.zone);
  const when = `${props.showDate ? `${dayTitle(start.date)} · ` : ""}${start.time} – ${end.time}`;
  const detail = [describeRepeat(event.repeat), event.notes.replace(/\s+/g, " ")]
    .filter(Boolean)
    .join(" · ");
  const textX = 24 * ui,
    textW = Math.max(1, props.width - 60 * ui);
  const line = (y: number, height: number, text: string, fontSize: number, medium = false) => (
    <Label
      x={textX}
      y={y}
      width={textW}
      height={height}
      text={text}
      fontSize={fontSize}
      fontWeight={medium ? "medium" : "regular"}
      color={medium ? pal.text : pal.muted}
      maxLines={1}
      overflow="ellipsis"
    />
  );
  return (
    <Pressable
      y={props.y}
      width={props.width}
      height={props.height}
      radius={10 * ui}
      fill={pal.surface}
      hoverFill={pal.hover}
      pressedFill={pal.pressed}
      stroke={pal.borderSubtle}
      strokeWidth={1}
      focusId={`event:${props.occurrence.key}`}
      onPress={props.onEdit}
    >
      <Surface
        x={10 * ui}
        y={12 * ui}
        width={3 * ui}
        height={props.height - 24 * ui}
        radius={1.5 * ui}
        fill={eventColor(event.color, pal.accent)}
      />
      {line(10 * ui, 20 * ui, event.title, 13, true)}
      {line(30 * ui, 18 * ui, when, 12)}
      {detail ? line(48 * ui, 18 * ui, detail, 11) : null}
      <IconButton
        x={props.width - 40 * ui}
        y={(props.height - 30 * ui) / 2}
        width={30 * ui}
        height={30 * ui}
        variant="ghost"
        tooltip="Delete event"
        focusId={`event-delete:${props.occurrence.key}`}
        icon={<Icon name="trash" size={16 * ui} color={pal.muted} symbolic />}
        onPress={props.onDelete}
      />
    </Pressable>
  );
}

export function DayAgenda(
  props: Frame & {
    date: string;
    today: string;
    zone: string;
    query: string;
    occurrences: readonly Occurrence[];
    onQuery: (query: string) => void;
    onEdit: (event: CalendarEvent) => void;
    onDelete: (event: CalendarEvent) => void;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const searching = props.query.trim().length > 0;
  const count = props.occurrences.length;
  const heading = searching ? `${plural(count, "matching event")}` : dayTitle(props.date);
  const caption = searching
    ? "Across all dates"
    : `${props.date === props.today ? "Today · " : ""}${count ? plural(count, "event") : "Nothing scheduled"}`;
  const searchH = 32 * ui;
  const listY = searchH + 64 * ui;
  const listH = Math.max(1, props.height - listY);
  const cardH = 72 * ui,
    cardGap = 8 * ui,
    scrollbarGutter = 10 * ui;
  return (
    <Box x={props.x} y={props.y} width={props.width} height={props.height}>
      <SearchField
        width={props.width}
        height={searchH}
        value={props.query}
        placeholder="Search all events"
        onChange={props.onQuery}
        onClear={() => props.onQuery("")}
      />
      <Label
        y={searchH + 14 * ui}
        width={props.width}
        height={26 * ui}
        text={heading}
        fontSize={17}
        fontWeight="medium"
        maxLines={1}
        overflow="ellipsis"
      />
      <Label
        y={searchH + 40 * ui}
        width={props.width}
        height={18 * ui}
        text={caption}
        fontSize={12}
        color={pal.muted}
        maxLines={1}
      />
      {count === 0 ? (
        <EmptyState
          y={listY}
          width={props.width}
          height={Math.min(listH, 220 * ui)}
          icon={searching ? "search" : "calendar"}
          title={searching ? "No events match" : "A free day"}
          message={
            searching
              ? "Try another word from an event title or its notes."
              : "Press Ctrl+N or choose New event to add one."
          }
        />
      ) : (
        <ScrollArea
          y={listY}
          width={props.width}
          height={listH}
          contentHeight={Math.max(listH, count * (cardH + cardGap))}
        >
          {props.occurrences.map((occurrence, index) => (
            <EventCard
              key={occurrence.key}
              y={index * (cardH + cardGap)}
              width={props.width - scrollbarGutter}
              height={cardH}
              occurrence={occurrence}
              zone={props.zone}
              showDate={searching}
              onEdit={() => props.onEdit(occurrence.event)}
              onDelete={() => props.onDelete(occurrence.event)}
            />
          ))}
        </ScrollArea>
      )}
    </Box>
  );
}
