import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { loadSnapshot, writeSnapshot } from "@moire/app-tools/local-store";

export type CalendarEvent = {
  id: string;
  title: string;
  startMs: number;
  endMs: number;
  timeZone: string;
  notes: string;
};
export type EventDraft = {
  id?: string;
  title: string;
  date: string;
  start: string;
  end: string;
  timeZone: string;
  notes: string;
};
export const defaultTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
export function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}
export function localDateTime(timestamp: number, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const part = (name: string) => parts.find((value) => value.type === name)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}
/** Resolve a wall-clock time using the zone's actual offsets, including DST. */
export function zonedTimestamp(date: string, time: string, zone: string): number {
  if (!validTimeZone(zone))
    throw new Error("Enter a valid IANA time zone, such as Australia/Adelaide.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    throw new Error("Use YYYY-MM-DD and HH:MM.");
  const naive = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== `${date}T${time}`)
    throw new Error("Enter a valid date and time.");
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = naive + hours * 3_600_000;
    const local = localDateTime(sample, zone);
    offsets.add(Date.parse(`${local.date}T${local.time}:00Z`) - sample);
  }
  const matches = [...offsets]
    .map((offset) => naive - offset)
    .filter((candidate) => {
      const local = localDateTime(candidate, zone);
      return local.date === date && local.time === time;
    })
    .sort((a, b) => a - b);
  const resolved = matches[0];
  if (resolved === undefined)
    throw new Error(
      "That local time does not exist because the clocks move forward. Choose another time.",
    );
  return resolved;
}
export function eventFromDraft(draft: EventDraft): CalendarEvent {
  const title = draft.title.trim();
  if (!title) throw new Error("Give the event a title.");
  const startMs = zonedTimestamp(draft.date, draft.start, draft.timeZone);
  const endMs = zonedTimestamp(draft.date, draft.end, draft.timeZone);
  if (endMs <= startMs)
    throw new Error("The end time must be after the start time on the same day.");
  return {
    id: draft.id ?? randomUUID(),
    title,
    startMs,
    endMs,
    timeZone: draft.timeZone,
    notes: draft.notes.trim(),
  };
}
export function monthDays(month: string): string[] {
  const first = new Date(`${month}-01T12:00:00Z`);
  if (!Number.isFinite(first.getTime())) throw new Error("Invalid calendar month.");
  first.setUTCDate(1 - ((first.getUTCDay() + 6) % 7));
  return Array.from({ length: 42 }, (_, index) =>
    new Date(first.getTime() + index * 86_400_000).toISOString().slice(0, 10),
  );
}
export function moveMonth(month: string, offset: number): string {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
export function dayEvents(
  events: readonly CalendarEvent[],
  date: string,
  zone: string,
): CalendarEvent[] {
  return events
    .filter((event) => localDateTime(event.startMs, zone).date === date)
    .sort((a, b) => a.startMs - b.startMs);
}
function parseEvent(value: unknown): CalendarEvent {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("title" in value) ||
    typeof value.title !== "string" ||
    !("startMs" in value) ||
    typeof value.startMs !== "number" ||
    !("endMs" in value) ||
    typeof value.endMs !== "number" ||
    !Number.isFinite(value.startMs) ||
    !Number.isFinite(value.endMs) ||
    !Number.isFinite(new Date(value.startMs).getTime()) ||
    !Number.isFinite(new Date(value.endMs).getTime()) ||
    value.endMs <= value.startMs ||
    !("timeZone" in value) ||
    typeof value.timeZone !== "string" ||
    !validTimeZone(value.timeZone) ||
    !("notes" in value) ||
    typeof value.notes !== "string"
  )
    throw new Error(
      "The calendar file contains an invalid event. Your file has been kept unchanged.",
    );
  return {
    id: value.id,
    title: value.title,
    startMs: value.startMs,
    endMs: value.endMs,
    timeZone: value.timeZone,
    notes: value.notes,
  };
}
function parseCalendar(data: unknown): CalendarEvent[] {
  if (!Array.isArray(data))
    throw new Error("The calendar file is invalid. Your file has been kept unchanged.");
  const events = data.map(parseEvent);
  if (new Set(events.map((event) => event.id)).size !== events.length)
    throw new Error("The calendar contains duplicate event identifiers.");
  return events;
}
export class CalendarStore {
  constructor(
    readonly file = path.join(
      process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local/share"),
      "moire/calendar/events.json",
    ),
  ) {}
  load() {
    return loadSnapshot(this.file, parseCalendar);
  }
  read(): CalendarEvent[] {
    return [...this.load().items];
  }
  write(events: readonly CalendarEvent[], expectedRevision: string | null) {
    return writeSnapshot(this.file, events, expectedRevision, parseCalendar);
  }
}
