/** The window body: the month grid beside the day agenda, or the week timeline. */
import React, { useMemo, type ReactNode } from "react";
import { getUiScaleFactor } from "@moire/ui";
import { monthDays, weekDays } from "#calendar/dates";
import {
  occurrencesByDay,
  searchEvents,
  type CalendarEvent,
  type CalendarView,
} from "#calendar/model";
import { DayAgenda } from "./agenda";
import type { Frame } from "./frame";
import { MonthGrid } from "./month";
import { WeekView } from "./week";

const PAD = 16;
const GAP = 20;
/** Below this width the agenda moves under the month grid. */
const SIDE_BY_SIDE_WIDTH = 600;

function monthLayout(width: number, height: number): { grid: Frame; agenda: Frame } {
  const ui = getUiScaleFactor();
  const pad = PAD * ui,
    gap = GAP * ui;
  const innerW = Math.max(1, width - pad * 2),
    innerH = Math.max(1, height - pad * 2);
  if (width >= SIDE_BY_SIDE_WIDTH * ui) {
    const gridW = Math.round(Math.min(560 * ui, Math.max(260 * ui, (innerW - gap) * 0.55)));
    return {
      grid: { x: pad, y: pad, width: gridW, height: innerH },
      agenda: {
        x: pad + gridW + gap,
        y: pad,
        width: Math.max(1, innerW - gridW - gap),
        height: innerH,
      },
    };
  }
  const gridH = Math.round(Math.min(innerH * 0.58, 340 * ui));
  return {
    grid: { x: pad, y: pad, width: innerW, height: gridH },
    agenda: {
      x: pad,
      y: pad + gridH + gap,
      width: innerW,
      height: Math.max(1, innerH - gridH - gap),
    },
  };
}

export function CalendarBody(props: {
  width: number;
  height: number;
  view: CalendarView;
  events: readonly CalendarEvent[];
  today: string;
  zone: string;
  nowMs: number;
  onSelect: (date: string) => void;
  onQuery: (query: string) => void;
  onEdit: (event: CalendarEvent) => void;
  onDelete: (event: CalendarEvent) => void;
}): ReactNode {
  const { view, zone } = props;
  const days = useMemo(
    () => (view.mode === "month" ? monthDays(view.anchor.slice(0, 7)) : weekDays(view.anchor)),
    [view.mode, view.anchor],
  );
  // The agenda's day is usually inside the visible days, but month paging can leave it behind.
  const queryDays = useMemo(
    () => (days.includes(view.selected) ? days : [...days, view.selected].sort()),
    [days, view.selected],
  );
  const byDay = useMemo(
    () => occurrencesByDay(props.events, queryDays, zone),
    [props.events, queryDays, zone],
  );
  if (view.mode === "week") {
    const ui = getUiScaleFactor();
    return (
      <WeekView
        x={PAD * ui}
        y={8 * ui}
        width={Math.max(1, props.width - PAD * 2 * ui)}
        height={Math.max(1, props.height - 8 * ui)}
        days={days}
        byDay={byDay}
        selected={view.selected}
        today={props.today}
        zone={zone}
        nowMs={props.nowMs}
        onSelect={props.onSelect}
        onEdit={props.onEdit}
      />
    );
  }
  const layout = monthLayout(props.width, props.height);
  const searching = view.query.trim().length > 0;
  return (
    <>
      <MonthGrid
        {...layout.grid}
        month={view.anchor.slice(0, 7)}
        days={days}
        byDay={byDay}
        selected={view.selected}
        today={props.today}
        onSelect={props.onSelect}
      />
      <DayAgenda
        {...layout.agenda}
        date={view.selected}
        today={props.today}
        zone={zone}
        query={view.query}
        occurrences={
          searching ? searchEvents(props.events, view.query) : (byDay.get(view.selected) ?? [])
        }
        onQuery={props.onQuery}
        onEdit={props.onEdit}
        onDelete={props.onDelete}
      />
    </>
  );
}
