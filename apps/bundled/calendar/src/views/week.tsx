/** The week: seven day columns against a scrolling 24-hour timeline. */
import React, { useEffect, useState, type ReactNode } from "react";
import { wallClock } from "@moire/app-tools";
import {
  Box,
  Label,
  Pressable,
  ScrollArea,
  Separator,
  Surface,
  getUiScaleFactor,
  usePalette,
  useWidgetTheme,
} from "@moire/ui";
import { WEEKDAYS } from "#calendar/dates";
import {
  MINUTES_PER_DAY,
  layoutWeek,
  type CalendarEvent,
  type Occurrence,
  type WeekBlock,
} from "#calendar/model";
import { eventColor, tint } from "./color";
import type { Frame } from "./frame";

const HOUR_HEIGHT = 44;
const GUTTER = 48;
const HEADER_HEIGHT = 48;
/** Shortest block painted, so a five-minute event still has room for its title. */
const MIN_BLOCK_MINUTES = 24;
/** Where the timeline opens when the week has nothing earlier. */
const DEFAULT_FIRST_HOUR = 8;

function Block(props: {
  block: WeekBlock;
  x: number;
  y: number;
  width: number;
  height: number;
  zone: string;
  onEdit: () => void;
}): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const { occurrence } = props.block;
  const color = eventColor(occurrence.event.color, pal.accent);
  const textW = Math.max(1, props.width - 10 * ui);
  const time = wallClock(occurrence.startMs, props.zone).time;
  return (
    <Pressable
      x={props.x}
      y={props.y}
      width={props.width}
      height={props.height}
      radius={6 * ui}
      fill={tint(color, 0x38)}
      hoverFill={tint(color, 0x55)}
      pressedFill={tint(color, 0x70)}
      focusId={`occurrence:${occurrence.key}`}
      onPress={props.onEdit}
    >
      <Surface width={3 * ui} height={props.height} radius={1.5 * ui} fill={color} />
      <Label
        x={7 * ui}
        y={3 * ui}
        width={textW}
        height={16 * ui}
        text={occurrence.event.title}
        fontSize={12}
        fontWeight="medium"
        maxLines={1}
        overflow="ellipsis"
      />
      {props.height >= 36 * ui ? (
        <Label
          x={7 * ui}
          y={19 * ui}
          width={textW}
          height={15 * ui}
          text={time}
          fontSize={11}
          color={pal.muted}
          maxLines={1}
          overflow="ellipsis"
        />
      ) : null}
    </Pressable>
  );
}

export function WeekView(
  props: Frame & {
    days: readonly string[];
    byDay: ReadonlyMap<string, readonly Occurrence[]>;
    selected: string;
    today: string;
    zone: string;
    nowMs: number;
    onSelect: (date: string) => void;
    onEdit: (event: CalendarEvent) => void;
  },
): ReactNode {
  const ui = getUiScaleFactor();
  const pal = usePalette();
  const onAccent = useWidgetTheme().recipes.button.primary.medium.label.base.color;
  const hourH = HOUR_HEIGHT * ui,
    gutter = GUTTER * ui,
    headerH = HEADER_HEIGHT * ui,
    scrollbarGutter = 10 * ui;
  const columnW = (props.width - gutter - scrollbarGutter) / 7;
  const bodyH = Math.max(1, props.height - headerH);
  const contentH = hourH * 24;
  const blocks = layoutWeek(props.days, props.byDay, props.zone, MIN_BLOCK_MINUTES);
  const firstHour = Math.min(
    DEFAULT_FIRST_HOUR,
    ...blocks.map((block) => Math.floor(block.startMinute / 60)),
  );
  const [scrollY, setScrollY] = useState(0);
  // Each new week opens at its first event (or the working day), not where the last one was.
  useEffect(() => {
    setScrollY(Math.max(0, Math.min(contentH - bodyH, firstHour * hourH - 8 * ui)));
  }, [props.days[0]]);
  const now = wallClock(props.nowMs, props.zone);
  const todayIndex = props.days.indexOf(now.date);
  const nowMinute = Number(now.time.slice(0, 2)) * 60 + Number(now.time.slice(3));
  return (
    <Box x={props.x} y={props.y} width={props.width} height={props.height}>
      {props.days.map((day, index) => {
        const today = day === props.today,
          selected = day === props.selected;
        const markSize = 26 * ui;
        return (
          <Pressable
            key={day}
            x={gutter + index * columnW + 2 * ui}
            y={2 * ui}
            width={columnW - 4 * ui}
            height={headerH - 4 * ui}
            radius={8 * ui}
            fill={selected ? tint(pal.accent, 0x2e) : 0x00000000}
            hoverFill={selected ? tint(pal.accent, 0x40) : pal.hover}
            pressedFill={pal.pressed}
            focusId={`week-day:${day}`}
            onPress={() => props.onSelect(day)}
          >
            <Label
              y={2 * ui}
              width={columnW - 4 * ui}
              height={14 * ui}
              text={WEEKDAYS[index]!}
              fontSize={11}
              fontWeight="medium"
              color={pal.muted}
              horizontalAlign="center"
            />
            {today ? (
              <Surface
                x={(columnW - 4 * ui - markSize) / 2}
                y={16 * ui}
                width={markSize}
                height={markSize}
                radius={markSize / 2}
                fill={pal.accent}
              />
            ) : null}
            <Label
              y={16 * ui}
              width={columnW - 4 * ui}
              height={markSize}
              text={String(Number(day.slice(-2)))}
              fontSize={14}
              fontWeight="medium"
              color={today ? onAccent : selected ? pal.accent : pal.text}
              horizontalAlign="center"
              verticalAlign="center"
            />
          </Pressable>
        );
      })}
      <Separator y={headerH - 1} width={props.width} color={pal.borderSubtle} />
      <ScrollArea
        y={headerH}
        width={props.width}
        height={bodyH}
        contentHeight={contentH}
        scrollY={scrollY}
        onScroll={setScrollY}
        keyboard={{ focusId: "calendar:week-timeline" }}
      >
        {todayIndex >= 0 ? (
          <Surface
            x={gutter + todayIndex * columnW}
            width={columnW}
            height={contentH}
            fill={tint(pal.accent, 0x0c)}
          />
        ) : null}
        {Array.from({ length: 24 }, (_, hour) => (
          <Box key={hour} y={hour * hourH} width={props.width} height={hourH}>
            <Separator x={gutter} width={columnW * 7} color={pal.borderSubtle} />
            {hour > 0 ? (
              <Label
                y={-7 * ui}
                width={gutter - 8 * ui}
                height={14 * ui}
                text={`${String(hour).padStart(2, "0")}:00`}
                fontSize={11}
                color={pal.muted}
                horizontalAlign="end"
              />
            ) : null}
          </Box>
        ))}
        {props.days.map((day, index) => (
          <Separator
            key={day}
            x={gutter + index * columnW}
            width={1}
            height={contentH}
            color={pal.borderSubtle}
          />
        ))}
        {blocks.map((block) => {
          const slot = columnW / block.columns;
          return (
            <Block
              key={block.occurrence.key}
              block={block}
              x={gutter + block.day * columnW + block.column * slot + 2 * ui}
              y={(block.startMinute / 60) * hourH + 1}
              width={Math.max(1, slot - 4 * ui)}
              height={Math.max(1, ((block.endMinute - block.startMinute) / 60) * hourH - 2)}
              zone={props.zone}
              onEdit={() => props.onEdit(block.occurrence.event)}
            />
          );
        })}
        {todayIndex >= 0 && nowMinute < MINUTES_PER_DAY ? (
          <Surface
            x={gutter + todayIndex * columnW}
            y={(nowMinute / 60) * hourH - 1 * ui}
            width={columnW}
            height={2 * ui}
            fill={pal.danger}
          />
        ) : null}
      </ScrollArea>
    </Box>
  );
}
