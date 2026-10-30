/** Calendar I/O: the saved event store, .ics files, and the remembered view. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { errorText, isTimeZone, loadAppSettings, saveAppSettings } from "@moire/app-tools";
import { loadSnapshot, writeSnapshot } from "@moire/app-tools/local-store";
import { IcsError, parseIcs, type IcsImport } from "./ics";
import {
  FREQUENCIES,
  isEventColor,
  type CalendarEvent,
  type Recurrence,
  type ViewMode,
} from "./model";

export const APP_ID = "org.moire.Calendar";

function invalid(): never {
  throw new Error(
    "The calendar file contains an invalid event. Your file has been kept unchanged.",
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const positiveInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 1;

function parseRepeat(value: unknown): Recurrence {
  if (
    !isRecord(value) ||
    !FREQUENCIES.includes(value.frequency as Recurrence["frequency"]) ||
    !positiveInteger(value.interval) ||
    !isRecord(value.end)
  )
    invalid();
  const end = value.end;
  const frequency = value.frequency as Recurrence["frequency"];
  if (end.kind === "never") return { frequency, interval: value.interval, end: { kind: "never" } };
  if (end.kind === "count" && positiveInteger(end.count))
    return {
      frequency,
      interval: value.interval,
      end: { kind: "count", count: end.count },
    };
  if (end.kind === "until" && typeof end.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(end.date))
    return {
      frequency,
      interval: value.interval,
      end: { kind: "until", date: end.date },
    };
  invalid();
}

function parseEvent(value: unknown): CalendarEvent {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.startMs !== "number" ||
    typeof value.endMs !== "number" ||
    !Number.isFinite(new Date(value.startMs).getTime()) ||
    !Number.isFinite(new Date(value.endMs).getTime()) ||
    value.endMs <= value.startMs ||
    typeof value.timeZone !== "string" ||
    !isTimeZone(value.timeZone) ||
    typeof value.notes !== "string" ||
    (value.color !== undefined && !isEventColor(value.color))
  )
    invalid();
  return {
    id: value.id,
    title: value.title,
    startMs: value.startMs,
    endMs: value.endMs,
    timeZone: value.timeZone,
    notes: value.notes,
    ...(isEventColor(value.color) ? { color: value.color } : {}),
    ...(value.repeat !== undefined ? { repeat: parseRepeat(value.repeat) } : {}),
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

/** Calendar files are small; anything larger is almost certainly the wrong file. */
const MAX_ICS_BYTES = 8 * 1024 * 1024;

/** Read and parse an .ics file. Every failure is an `IcsError` the app can show as is. */
export async function readIcsFile(file: string, localZone: string): Promise<IcsImport> {
  let text: string;
  try {
    if ((await fs.stat(file)).size > MAX_ICS_BYTES)
      throw new IcsError("too-large", "This file is too large to be a calendar (over 8 MB).");
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    if (error instanceof IcsError) throw error;
    throw new IcsError("unreadable", errorText(error));
  }
  return parseIcs(text, localZone);
}

/** Month or week, as last chosen; a missing or damaged preference falls back to month. */
export function loadViewMode(): ViewMode {
  return loadAppSettings(APP_ID, (data) =>
    isRecord(data) && data.view === "week" ? "week" : "month",
  );
}

/** Returns an error message when the preference could not be kept. */
export function saveViewMode(view: ViewMode): string | null {
  try {
    saveAppSettings(APP_ID, { view });
    return null;
  } catch (error) {
    return `Could not remember the view: ${errorText(error)}`;
  }
}

/** Seeding scripts and other packages' smokes build stored events through the store module. */
export { eventFromDraft } from "./model";
