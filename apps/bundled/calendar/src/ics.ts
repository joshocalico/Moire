/**
 * iCalendar (.ics, RFC 5545) import: VEVENTs with their title, times, description and a simple
 * repeat rule. Anything the calendar cannot represent is reported, never silently dropped.
 */
import { createHash } from "node:crypto";
import { isTimeZone, wallClock, wallClockTimestamp } from "@moire/app-tools";
import { addDays } from "./dates";
import { FREQUENCIES, MAX_REPEAT_NUMBER, type CalendarEvent, type Recurrence } from "./model";

export type IcsErrorKind = "unreadable" | "too-large" | "not-calendar" | "no-events";
export class IcsError extends Error {
  constructor(
    readonly kind: IcsErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "IcsError";
  }
}

/** An event left out of the import, or imported with a difference, and why. */
export type IcsNote = { title: string; reason: string };
export type IcsImport = {
  events: CalendarEvent[];
  skipped: IcsNote[];
  adjusted: IcsNote[];
};

type Property = { name: string; params: Record<string, string>; value: string };

/** Undo RFC 5545 line folding: a line starting with a space or tab continues the previous one. */
function unfold(text: string): string[] {
  const lines: string[] = [];
  for (const line of text.replace(/^﻿/, "").split(/\r\n|\r|\n/)) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length)
      lines[lines.length - 1] += line.slice(1);
    else if (line) lines.push(line);
  }
  return lines;
}

/** NAME;PARAM=value;PARAM="quoted:value":VALUE — colons and semicolons may hide in quotes. */
function parseLine(line: string): Property | null {
  let index = 0;
  const read = (stops: string) => {
    let out = "";
    let quoted = false;
    while (index < line.length) {
      const char = line[index]!;
      if (char === '"') quoted = !quoted;
      else if (!quoted && stops.includes(char)) break;
      else out += char;
      index++;
    }
    return out;
  };
  const name = read(";:").toUpperCase();
  const params: Record<string, string> = {};
  while (line[index] === ";") {
    index++;
    const key = read("=;:").toUpperCase();
    if (line[index] === "=") index++;
    params[key] = read(";:");
  }
  if (line[index] !== ":" || !name) return null;
  return { name, params, value: line.slice(index + 1) };
}

function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) =>
    char === "n" || char === "N" ? "\n" : char,
  );
}

type Moment =
  | { kind: "date"; date: string }
  | { kind: "time"; date: string; time: string; zone: string; ms: number };

const ZONE_IN_PATH = /([A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/;

/** DTSTART/DTEND/UNTIL as a date, or a time in UTC ("Z"), a TZID zone, or floating local time. */
function parseMoment(property: Property, localZone: string, adjust: (reason: string) => void) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(
    property.value.trim(),
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, , utc] = match;
  const date = `${year}-${month}-${day}`;
  if (hour === undefined || property.params.VALUE === "DATE")
    return { kind: "date", date } as const;
  const time = `${hour}:${minute}`;
  let zone = localZone;
  if (utc) zone = "UTC";
  else if (property.params.TZID) {
    const tzid = property.params.TZID;
    // Some producers prefix the IANA name with a path, such as /mozilla.org/…/Europe/London.
    const named = isTimeZone(tzid) ? tzid : ZONE_IN_PATH.exec(tzid)?.[1];
    if (named && isTimeZone(named)) zone = named;
    else adjust(`unknown time zone “${tzid}”, read as local time`);
  }
  const ms = wallClockTimestamp(date, time, zone, { gap: "shift" });
  return ms === null ? null : ({ kind: "time", date, time, zone, ms } satisfies Moment);
}

/** DURATION such as PT1H30M, P1D or P2W. */
function parseDuration(value: string): number | null {
  const match = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    value.trim(),
  );
  if (!match || value.trim() === "P" || value.trim().endsWith("T")) return null;
  const [weeks, days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  return ((((weeks! * 7 + days!) * 24 + hours!) * 60 + minutes!) * 60 + seconds!) * 1000;
}

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** FREQ, INTERVAL, COUNT and UNTIL; BY* parts only where they repeat the start's own day. */
function parseRule(
  value: string,
  start: { date: string; zone: string },
  adjust: (reason: string) => void,
): Recurrence | undefined {
  const parts = Object.fromEntries(
    value.split(";").map((part) => {
      const [key = "", val = ""] = part.split("=");
      return [key.toUpperCase(), val.toUpperCase()];
    }),
  );
  const frequency = FREQUENCIES.find((name) => name.toUpperCase() === parts.FREQ);
  if (!frequency) {
    adjust(`repeat ${parts.FREQ ?? "rule"} is not supported, so only the first time is imported`);
    return undefined;
  }
  const interval = Number(parts.INTERVAL ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_REPEAT_NUMBER) {
    adjust(
      `repeat interval ${parts.INTERVAL} is not supported, so only the first time is imported`,
    );
    return undefined;
  }
  const weekday = (new Date(`${start.date}T12:00:00Z`).getUTCDay() + 6) % 7;
  const redundant: Record<string, string> = {
    BYDAY: frequency === "weekly" ? WEEKDAY_CODES[weekday]! : "",
    BYMONTHDAY: frequency === "monthly" ? String(Number(start.date.slice(8))) : "",
    BYMONTH: frequency === "yearly" ? String(Number(start.date.slice(5, 7))) : "",
  };
  const ignored = Object.keys(parts).filter(
    (key) =>
      !["FREQ", "INTERVAL", "COUNT", "UNTIL", "WKST"].includes(key) &&
      parts[key] !== redundant[key],
  );
  if (ignored.length)
    adjust(
      `repeat rule simplified (${ignored.map((key) => `${key}=${parts[key]}`).join(", ")} not supported); it repeats ${frequency} from its first date`,
    );
  if (parts.COUNT) {
    const count = Number(parts.COUNT);
    if (Number.isInteger(count) && count >= 1)
      return {
        frequency,
        interval,
        end: { kind: "count", count: Math.min(count, MAX_REPEAT_NUMBER) },
      };
  }
  if (parts.UNTIL) {
    const until = parseMoment(
      { name: "UNTIL", params: {}, value: parts.UNTIL },
      start.zone,
      adjust,
    );
    if (until)
      return {
        frequency,
        interval,
        end: {
          kind: "until",
          date: until.kind === "date" ? until.date : wallClock(until.ms, start.zone).date,
        },
      };
  }
  return { frequency, interval, end: { kind: "never" } };
}

/** Fallback length when an event gives neither DTEND nor DURATION. */
const DEFAULT_EVENT_MS = 3_600_000;
const MINUTE_MS = 60_000;

function toEvent(
  props: Property[],
  localZone: string,
  skipped: IcsNote[],
  adjusted: IcsNote[],
): CalendarEvent | null {
  const get = (name: string) => props.find((prop) => prop.name === name);
  const title = unescapeText(get("SUMMARY")?.value ?? "").trim() || "Untitled event";
  const adjust = (reason: string) => adjusted.push({ title, reason });
  const skip = (reason: string) => {
    skipped.push({ title, reason });
    return null;
  };
  if (get("RECURRENCE-ID")) return skip("a changed occurrence of a repeating event");
  if (get("STATUS")?.value.toUpperCase() === "CANCELLED") return skip("cancelled");
  const dtstart = get("DTSTART");
  const start = dtstart && parseMoment(dtstart, localZone, adjust);
  if (!start) return skip("no readable start time");
  const dtend = get("DTEND");
  const end = dtend ? parseMoment(dtend, localZone, adjust) : null;
  const duration = get("DURATION") ? parseDuration(get("DURATION")!.value) : null;

  let zone: string, startMs: number, endMs: number;
  if (start.kind === "date") {
    // The calendar has no all-day events: an all-day event fills its days, 00:00 to 23:59.
    zone = localZone;
    const lastDay =
      end?.kind === "date" && end.date > start.date
        ? addDays(end.date, -1)
        : duration
          ? addDays(start.date, Math.max(1, Math.round(duration / 86_400_000)) - 1)
          : start.date;
    startMs = wallClockTimestamp(start.date, "00:00", zone, { gap: "shift" })!;
    endMs = wallClockTimestamp(lastDay, "23:59", zone, { gap: "shift" })!;
    adjust("all-day event imported as 00:00 – 23:59");
  } else {
    zone = start.zone;
    startMs = start.ms;
    endMs = end?.kind === "time" ? end.ms : startMs + (duration ?? DEFAULT_EVENT_MS);
    // The calendar keeps whole minutes; seconds are dropped from both ends.
    if (endMs - startMs < MINUTE_MS) endMs = startMs + MINUTE_MS;
  }
  if (endMs <= startMs) return skip("it ends before it starts");
  const rrule = get("RRULE");
  const repeat = rrule ? parseRule(rrule.value, { date: start.date, zone }, adjust) : undefined;
  if (rrule && get("EXDATE")) adjust("skipped dates (EXDATE) are not supported and still show");
  const description = unescapeText(get("DESCRIPTION")?.value ?? "").trim();
  const location = unescapeText(get("LOCATION")?.value ?? "").trim();
  const uid = get("UID")?.value.trim();
  return {
    // Stable ids make importing the same file again update events rather than duplicate them.
    id: `ics:${uid || createHash("sha256").update(`${title}\n${dtstart!.value}`).digest("hex").slice(0, 24)}`,
    title,
    startMs,
    endMs,
    timeZone: zone,
    notes: [location && `Location: ${location}`, description].filter(Boolean).join("\n"),
    ...(repeat ? { repeat } : {}),
  };
}

/** Parse .ics text; floating and all-day times are read in `localZone`. */
export function parseIcs(text: string, localZone: string): IcsImport {
  const lines = unfold(text);
  if (!lines.some((line) => /^BEGIN:VCALENDAR$/i.test(line.trim())))
    throw new IcsError("not-calendar", "This file is not an iCalendar (.ics) file.");
  const events: CalendarEvent[] = [];
  const skipped: IcsNote[] = [];
  const adjusted: IcsNote[] = [];
  const seen = new Set<string>();
  let found = 0;
  // Properties of the open VEVENT; `nested` counts components inside it (VALARM) to ignore.
  let current: Property[] | null = null;
  let nested = 0;
  for (const line of lines) {
    const prop = parseLine(line);
    if (!prop) continue;
    const component = prop.value.trim().toUpperCase();
    if (prop.name === "BEGIN") {
      if (current) nested++;
      else if (component === "VEVENT") current = [];
    } else if (prop.name === "END") {
      if (current && nested) nested--;
      else if (current && component === "VEVENT") {
        found++;
        const event = toEvent(current, localZone, skipped, adjusted);
        if (event && seen.has(event.id))
          skipped.push({
            title: event.title,
            reason: "a duplicate of an earlier event in the file",
          });
        else if (event) {
          seen.add(event.id);
          events.push(event);
        }
        current = null;
      }
    } else if (current && !nested) current.push(prop);
  }
  if (!found) throw new IcsError("no-events", "This calendar file has no events in it.");
  return { events, skipped, adjusted };
}
