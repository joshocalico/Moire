/**
 * Calendar events and the app's view state, as pure functions. Events are stored once; repeats
 * are expanded into occurrences only for the dates on screen.
 */
import { randomUUID } from "node:crypto";
import { isTimeZone, wallClock, wallClockTimestamp } from "@moire/app-tools";
import { addDays, addMonths, daysBetween, monthTitle, monthsBetween, weekTitle } from "./dates";

export const EVENT_COLORS = [
  { id: "blue", label: "Blue", color: 0xff5b8def },
  { id: "green", label: "Green", color: 0xff4fae74 },
  { id: "amber", label: "Amber", color: 0xffd69a35 },
  { id: "red", label: "Red", color: 0xffd8645a },
  { id: "purple", label: "Purple", color: 0xffa679d6 },
  { id: "teal", label: "Teal", color: 0xff38aaa6 },
] as const;
export type EventColor = (typeof EVENT_COLORS)[number]["id"];
export const isEventColor = (value: unknown): value is EventColor =>
  EVENT_COLORS.some((entry) => entry.id === value);

export const FREQUENCIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];
export type RecurrenceEnd =
  | { kind: "never" }
  | { kind: "count"; count: number }
  /** The last date (inclusive, in the event's zone) an occurrence may start on. */
  | { kind: "until"; date: string };
export type Recurrence = {
  frequency: Frequency;
  interval: number;
  end: RecurrenceEnd;
};

/** Events saved before colours and repeats existed have neither field. */
export type CalendarEvent = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  timeZone: string;
  notes: string;
  color?: EventColor;
  repeat?: Recurrence;
};

/** What the editor's fields hold: text as typed, choices by id. */
export type EventDraft = {
  id?: string;
  title: string;
  date: string;
  start: string;
  end: string;
  timeZone: string;
  notes: string;
  color: EventColor | "default";
  repeat: Frequency | "none";
  interval: string;
  ends: RecurrenceEnd["kind"];
  count: string;
  until: string;
};
export type DraftKey = Exclude<keyof EventDraft, "id">;
/** The fields an event needs; scripts and older callers may leave out colour and repeat. */
export type EventInput = Pick<
  EventDraft,
  "title" | "date" | "start" | "end" | "timeZone" | "notes"
> &
  Partial<EventDraft>;
export type DraftState = {
  readonly value: EventDraft;
  readonly original: EventDraft;
};

export const MAX_REPEAT_NUMBER = 999;

export function newDraft(date: string, zone: string): EventDraft {
  return {
    title: "",
    date,
    start: "09:00",
    end: "10:00",
    timeZone: zone,
    notes: "",
    color: "default",
    repeat: "none",
    interval: "1",
    ends: "never",
    count: "10",
    until: "",
  };
}

export function draftFromEvent(event: CalendarEvent): EventDraft {
  const start = wallClock(event.startMs, event.timeZone);
  const repeat = event.repeat;
  return {
    ...newDraft(start.date, event.timeZone),
    id: event.id,
    title: event.title,
    start: start.time,
    end: wallClock(event.endMs, event.timeZone).time,
    notes: event.notes,
    color: event.color ?? "default",
    repeat: repeat?.frequency ?? "none",
    interval: String(repeat?.interval ?? 1),
    ends: repeat?.end.kind ?? "never",
    count: repeat?.end.kind === "count" ? String(repeat.end.count) : "10",
    until: repeat?.end.kind === "until" ? repeat.end.date : "",
  };
}

export function draftChanged(state: DraftState | null): boolean {
  if (!state) return false;
  return (Object.keys(state.value) as (keyof EventDraft)[]).some(
    (key) => state.value[key] !== state.original[key],
  );
}

/** A wall-clock time in `zone`, with the error the editor shows when it is not a real time. */
export function zonedTimestamp(date: string, time: string, zone: string): number {
  if (!isTimeZone(zone))
    throw new Error("Enter a valid IANA time zone, such as Australia/Adelaide.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    throw new Error("Use YYYY-MM-DD and HH:MM.");
  if (wallClockTimestamp(date, time, zone, { gap: "shift" }) === null)
    throw new Error("Enter a valid date and time.");
  const resolved = wallClockTimestamp(date, time, zone);
  if (resolved === null)
    throw new Error(
      "That local time does not exist because the clocks move forward. Choose another time.",
    );
  return resolved;
}

function repeatNumber(text: string, what: string): number {
  const value = Number(text.trim());
  if (!Number.isInteger(value) || value < 1 || value > MAX_REPEAT_NUMBER)
    throw new Error(`${what} must be a whole number from 1 to ${MAX_REPEAT_NUMBER}.`);
  return value;
}

function recurrenceFromDraft(draft: EventInput): Recurrence | undefined {
  if (!draft.repeat || draft.repeat === "none") return undefined;
  const interval = repeatNumber(draft.interval ?? "1", "Repeat every");
  let end: RecurrenceEnd = { kind: "never" };
  if (draft.ends === "count")
    end = {
      kind: "count",
      count: repeatNumber(draft.count ?? "", "Number of times"),
    };
  if (draft.ends === "until") {
    const date = (draft.until ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || addMonths(date, 0) !== date)
      throw new Error("Enter the last repeat date as YYYY-MM-DD.");
    if (date < draft.date) throw new Error("The last repeat date must be on or after the event.");
    end = { kind: "until", date };
  }
  return { frequency: draft.repeat, interval, end };
}

export function eventFromDraft(draft: EventInput): CalendarEvent {
  const title = draft.title.trim();
  if (!title) throw new Error("Give the event a title.");
  const startMs = zonedTimestamp(draft.date, draft.start, draft.timeZone);
  const endMs = zonedTimestamp(draft.date, draft.end, draft.timeZone);
  if (endMs <= startMs)
    throw new Error("The end time must be after the start time on the same day.");
  const repeat = recurrenceFromDraft(draft);
  return {
    id: draft.id ?? randomUUID(),
    title,
    startMs,
    endMs,
    timeZone: draft.timeZone,
    notes: draft.notes.trim(),
    ...(draft.color && draft.color !== "default" ? { color: draft.color } : {}),
    ...(repeat ? { repeat } : {}),
  };
}

export function describeRepeat(repeat: Recurrence | undefined): string {
  if (!repeat) return "";
  const unit = {
    daily: "day",
    weekly: "week",
    monthly: "month",
    yearly: "year",
  }[repeat.frequency];
  const every =
    repeat.interval === 1
      ? `Repeats ${repeat.frequency}`
      : `Repeats every ${repeat.interval} ${unit}s`;
  if (repeat.end.kind === "count")
    return `${every}, ${repeat.end.count} ${repeat.end.count === 1 ? "time" : "times"}`;
  if (repeat.end.kind === "until") return `${every} until ${repeat.end.date}`;
  return every;
}

/** One time an event happens: the event itself, or one repeat of it. */
export type Occurrence = {
  key: string;
  event: CalendarEvent;
  startMs: number;
  endMs: number;
};

const DAY_MS = 86_400_000;
/** Bounds the work one query does for a repeat that never matches (29 February yearly, say). */
const MAX_REPEAT_STEPS = 20_000;

function repeatDate(base: string, repeat: Recurrence, index: number): string | null {
  const steps = index * repeat.interval;
  switch (repeat.frequency) {
    case "daily":
      return addDays(base, steps);
    case "weekly":
      return addDays(base, steps * 7);
    case "monthly":
      return addMonths(base, steps);
    case "yearly":
      return addMonths(base, steps * 12);
  }
}

/** The first repeat index that could reach `date`, so long-running repeats skip their history. */
function firstIndexNear(base: string, repeat: Recurrence, date: string): number {
  if (repeat.end.kind === "count") return 0; // counting needs every earlier occurrence
  const periods = {
    daily: daysBetween(base, date) / repeat.interval,
    weekly: daysBetween(base, date) / (7 * repeat.interval),
    monthly: monthsBetween(base, date) / repeat.interval,
    yearly: monthsBetween(base, date) / (12 * repeat.interval),
  }[repeat.frequency];
  return Math.max(0, Math.floor(periods) - 1);
}

/** Occurrences of `event` starting in [fromMs, toMs). Repeats keep their wall-clock time. */
export function eventOccurrences(event: CalendarEvent, fromMs: number, toMs: number): Occurrence[] {
  const repeat = event.repeat;
  if (!repeat)
    return event.startMs >= fromMs && event.startMs < toMs
      ? [{ key: event.id, event, startMs: event.startMs, endMs: event.endMs }]
      : [];
  const base = wallClock(event.startMs, event.timeZone);
  const duration = event.endMs - event.startMs;
  const found: Occurrence[] = [];
  let produced = 0;
  let index = firstIndexNear(
    base.date,
    repeat,
    new Date(fromMs - DAY_MS).toISOString().slice(0, 10),
  );
  for (let steps = 0; steps < MAX_REPEAT_STEPS; steps++, index++) {
    const date = repeatDate(base.date, repeat, index);
    if (date === null) continue; // the 31st in a 30-day month: no occurrence that month
    if (repeat.end.kind === "until" && date > repeat.end.date) break;
    if (repeat.end.kind === "count" && produced >= repeat.end.count) break;
    produced++;
    const startMs =
      index === 0
        ? event.startMs
        : wallClockTimestamp(date, base.time, event.timeZone, { gap: "shift" });
    if (startMs === null) continue;
    if (startMs >= toMs) break;
    if (startMs >= fromMs)
      found.push({
        key: `${event.id}#${index}`,
        event,
        startMs,
        endMs: startMs + duration,
      });
  }
  return found;
}

/** Occurrences grouped by the local date (in `zone`) they start on, for each of `days`. */
export function occurrencesByDay(
  events: readonly CalendarEvent[],
  days: readonly string[],
  zone: string,
): Map<string, Occurrence[]> {
  const byDay = new Map<string, Occurrence[]>(days.map((day) => [day, []]));
  if (!days.length) return byDay;
  // Local midnight is between 14 hours before and 12 hours after UTC midnight.
  const fromMs = Date.parse(`${days[0]}T00:00:00Z`) - 15 * 3_600_000;
  const toMs = Date.parse(`${days.at(-1)}T00:00:00Z`) + DAY_MS + 13 * 3_600_000;
  for (const event of events)
    for (const occurrence of eventOccurrences(event, fromMs, toMs))
      byDay.get(wallClock(occurrence.startMs, zone).date)?.push(occurrence);
  for (const list of byDay.values()) list.sort((a, b) => a.startMs - b.startMs);
  return byDay;
}

export function dayOccurrences(
  events: readonly CalendarEvent[],
  date: string,
  zone: string,
): Occurrence[] {
  return occurrencesByDay(events, [date], zone).get(date) ?? [];
}

/** Search matches whole events (not each repeat), soonest first. */
export function searchEvents(events: readonly CalendarEvent[], query: string): Occurrence[] {
  const needle = query.trim().toLowerCase();
  return events
    .filter((event) => `${event.title} ${event.notes}`.toLowerCase().includes(needle))
    .sort((a, b) => a.startMs - b.startMs)
    .map((event) => ({
      key: event.id,
      event,
      startMs: event.startMs,
      endMs: event.endMs,
    }));
}

/** An occurrence placed in the week grid: its day column and its share of that column. */
export type WeekBlock = {
  occurrence: Occurrence;
  day: number;
  startMinute: number;
  endMinute: number;
  column: number;
  columns: number;
};
export const MINUTES_PER_DAY = 24 * 60;

/**
 * Lay a week out by day and time. Overlapping occurrences share their day's width side by side;
 * `minMinutes` is the shortest block drawn, so overlap is judged on what is actually painted.
 */
export function layoutWeek(
  days: readonly string[],
  byDay: ReadonlyMap<string, readonly Occurrence[]>,
  zone: string,
  minMinutes: number,
): WeekBlock[] {
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const blocks: WeekBlock[] = [];
  days.forEach((day, dayIndex) => {
    const placed = (byDay.get(day) ?? []).map((occurrence) => {
      const start = minutes(wallClock(occurrence.startMs, zone).time);
      const endClock = wallClock(occurrence.endMs, zone);
      const end = endClock.date === day ? minutes(endClock.time) : MINUTES_PER_DAY;
      const top = Math.min(start, MINUTES_PER_DAY - minMinutes);
      return {
        occurrence,
        day: dayIndex,
        startMinute: top,
        endMinute: Math.max(end, top + minMinutes),
        column: 0,
        columns: 1,
      };
    });
    placed.sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);
    let cluster: WeekBlock[] = [];
    let columnEnds: number[] = [];
    const close = () => {
      for (const block of cluster) block.columns = columnEnds.length;
      blocks.push(...cluster);
      cluster = [];
      columnEnds = [];
    };
    for (const block of placed) {
      if (cluster.length && block.startMinute >= Math.max(...columnEnds)) close();
      const free = columnEnds.findIndex((end) => end <= block.startMinute);
      block.column = free === -1 ? columnEnds.length : free;
      columnEnds[block.column] = block.endMinute;
      cluster.push(block);
    }
    close();
  });
  return blocks;
}

export type ViewMode = "month" | "week";
/** What the calendar shows: `anchor` picks the visible month or week, `selected` the day. */
export type CalendarView = {
  mode: ViewMode;
  selected: string;
  anchor: string;
  query: string;
};
export type ViewAction =
  | { type: "mode"; mode: ViewMode }
  | { type: "step"; offset: number }
  | { type: "select"; date: string }
  | { type: "today"; today: string }
  | { type: "query"; query: string };

export function initialView(today: string, mode: ViewMode): CalendarView {
  return { mode, selected: today, anchor: today, query: "" };
}

export function viewReducer(view: CalendarView, action: ViewAction): CalendarView {
  switch (action.type) {
    case "mode":
      return { ...view, mode: action.mode, anchor: view.selected };
    case "step":
      if (view.mode === "month")
        return {
          ...view,
          anchor: addMonths(`${view.anchor.slice(0, 7)}-01`, action.offset)!,
        };
      // A week step carries the selection along, so New event lands in the visible week.
      return {
        ...view,
        selected: addDays(view.selected, action.offset * 7),
        anchor: addDays(view.anchor, action.offset * 7),
      };
    case "select":
      return { ...view, selected: action.date, anchor: action.date, query: "" };
    case "today":
      return {
        ...view,
        selected: action.today,
        anchor: action.today,
        query: "",
      };
    case "query":
      return { ...view, query: action.query };
  }
}

export function periodTitle(view: CalendarView): string {
  return view.mode === "month" ? monthTitle(view.anchor.slice(0, 7)) : weekTitle(view.anchor);
}

/** Add imported events; one already imported before (same id) is replaced, not duplicated. */
export function mergeImported(
  events: readonly CalendarEvent[],
  imported: readonly CalendarEvent[],
): { events: CalendarEvent[]; added: number; updated: number } {
  const ids = new Set(imported.map((event) => event.id));
  const kept = events.filter((event) => !ids.has(event.id));
  return {
    events: [...kept, ...imported],
    added: kept.length + imported.length - events.length,
    updated: events.length - kept.length,
  };
}
