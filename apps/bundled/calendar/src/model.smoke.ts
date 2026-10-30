/** Calendar logic without rendering: dates, repeats, week layout, view state, .ics parsing. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { wallClock } from "@moire/app-tools";
import { addMonths, monthDays, moveMonth, weekDays, weekTitle } from "./dates";
import { CalendarStore, readIcsFile } from "./events";
import { IcsError, parseIcs } from "./ics";
import {
  dayOccurrences,
  draftFromEvent,
  eventFromDraft,
  eventOccurrences,
  initialView,
  layoutWeek,
  mergeImported,
  newDraft,
  occurrencesByDay,
  viewReducer,
  type CalendarEvent,
  type EventDraft,
} from "./model";

const UTC = "UTC";
const draft = (overrides: Partial<EventDraft>): EventDraft => ({
  ...newDraft("2026-01-31", UTC),
  title: "Fixture",
  ...overrides,
});
const startDates = (event: CalendarEvent, from: string, to: string, zone = UTC) =>
  eventOccurrences(event, Date.parse(`${from}T00:00:00Z`), Date.parse(`${to}T00:00:00Z`)).map(
    (occurrence) => wallClock(occurrence.startMs, zone).date,
  );

// Dates: Monday-first grids and weeks, short months.
assert.equal(monthDays("2024-02").length, 42);
assert.equal(monthDays("2026-10")[0], "2026-09-28");
assert.equal(moveMonth("2024-12", 1), "2025-01");
assert.deepEqual(weekDays("2026-10-04"), [
  "2026-09-28",
  "2026-09-29",
  "2026-09-30",
  "2026-10-01",
  "2026-10-02",
  "2026-10-03",
  "2026-10-04",
]);
assert.equal(addMonths("2026-01-31", 1), null, "31 January has no February twin");
assert.match(weekTitle("2026-10-07"), /^5 – 11 /);

// Repeats: expanded on demand, stored once.
const monthly = eventFromDraft(draft({ repeat: "monthly" }));
assert.deepEqual(
  monthly.repeat,
  { frequency: "monthly", interval: 1, end: { kind: "never" } },
  "a repeat is saved as a rule",
);
assert.deepEqual(
  startDates(monthly, "2026-01-01", "2026-06-01"),
  ["2026-01-31", "2026-03-31", "2026-05-31"],
  "monthly on the 31st skips short months",
);
const counted = eventFromDraft(
  draft({ date: "2026-10-05", repeat: "weekly", interval: "2", ends: "count", count: "3" }),
);
assert.deepEqual(startDates(counted, "2026-01-01", "2027-12-31"), [
  "2026-10-05",
  "2026-10-19",
  "2026-11-02",
]);
const until = eventFromDraft(
  draft({ date: "2026-10-05", repeat: "daily", ends: "until", until: "2026-10-07" }),
);
assert.deepEqual(startDates(until, "2026-10-01", "2026-10-31"), [
  "2026-10-05",
  "2026-10-06",
  "2026-10-07",
]);
const leap = eventFromDraft(draft({ date: "2024-02-29", repeat: "yearly" }));
assert.deepEqual(startDates(leap, "2024-01-01", "2033-01-01"), [
  "2024-02-29",
  "2028-02-29",
  "2032-02-29",
]);
const longRunning = eventFromDraft(draft({ date: "2000-01-03", repeat: "daily" }));
assert.deepEqual(
  startDates(longRunning, "2026-10-05", "2026-10-07"),
  ["2026-10-05", "2026-10-06"],
  "a years-old daily repeat still lands on today's dates",
);
// A weekly 09:00 meeting in New York stays at 09:00 local across the DST change.
const nyc = eventFromDraft(
  draft({ date: "2026-10-26", start: "09:00", repeat: "weekly", timeZone: "America/New_York" }),
);
const nycTimes = eventOccurrences(
  nyc,
  Date.parse("2026-10-20T00:00:00Z"),
  Date.parse("2026-11-20T00:00:00Z"),
).map((occurrence) => wallClock(occurrence.startMs, "America/New_York").time);
assert.deepEqual(nycTimes, ["09:00", "09:00", "09:00", "09:00"]);
assert.throws(
  () => eventFromDraft(draft({ repeat: "daily", ends: "until", until: "2025-01-01" })),
  /on or after/,
);
assert.throws(() => eventFromDraft(draft({ repeat: "daily", interval: "0" })), /whole number/);
// The editor round-trips a stored event, colour and repeat included.
const coloured = eventFromDraft(
  draft({ color: "green", repeat: "weekly", ends: "count", count: "4" }),
);
assert.equal(coloured.color, "green");
const back = draftFromEvent(coloured);
assert.equal(back.color, "green");
assert.equal(back.repeat, "weekly");
assert.equal(back.count, "4");
assert.equal(eventFromDraft(draft({})).color, undefined, "the default colour is not stored");
// Callers that only know the original six fields still build events.
const plain = eventFromDraft({
  title: "Plain",
  date: "2026-10-03",
  start: "11:00",
  end: "12:00",
  timeZone: UTC,
  notes: "",
});
assert.equal(plain.repeat, undefined);

// Day grouping by the viewer's zone, and the week layout's side-by-side overlaps.
const at = (date: string, start: string, end: string, title: string) =>
  eventFromDraft(draft({ date, start, end, title }));
const week = weekDays("2026-10-07");
const a = at("2026-10-07", "09:00", "11:00", "A"),
  b = at("2026-10-07", "10:00", "10:30", "B"),
  c = at("2026-10-07", "10:45", "12:00", "C"),
  d = at("2026-10-07", "13:00", "13:05", "D");
const byDay = occurrencesByDay([a, b, c, d, monthly], week, UTC);
assert.equal(byDay.get("2026-10-07")?.length, 4);
assert.equal(
  dayOccurrences([d], "2026-10-08", "Pacific/Auckland").length,
  1,
  "13:00 UTC is 02:00 the next day in Auckland",
);
const blocks = layoutWeek(week, byDay, UTC, 20);
const block = (title: string) => blocks.find((item) => item.occurrence.event.title === title)!;
assert.equal(block("A").day, 2, "Wednesday is the third column");
assert.deepEqual(
  ["A", "B", "C"].map((title) => [block(title).column, block(title).columns]),
  [
    [0, 2],
    [1, 2],
    [1, 2],
  ],
  "overlapping events share the day; C reuses B's column once B ends",
);
assert.deepEqual([block("D").column, block("D").columns], [0, 1]);
assert.equal(
  block("D").endMinute - block("D").startMinute,
  20,
  "short events get a readable block",
);

// View state: month paging leaves the selection; week paging carries it.
let view = initialView("2026-10-07", "month");
view = viewReducer(view, { type: "step", offset: 1 });
assert.equal(view.anchor.slice(0, 7), "2026-11");
assert.equal(view.selected, "2026-10-07");
view = viewReducer(view, { type: "mode", mode: "week" });
assert.equal(view.anchor, "2026-10-07", "switching view shows the selected day");
view = viewReducer(view, { type: "step", offset: -1 });
assert.equal(view.selected, "2026-09-30");
view = viewReducer(view, { type: "today", today: "2026-10-07" });
assert.deepEqual([view.selected, view.anchor, view.mode], ["2026-10-07", "2026-10-07", "week"]);

// .ics parsing.
const ics = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:utc-1",
  "SUMMARY:Standup\\, daily",
  "DTSTART:20261005T230000Z",
  "DTEND:20261005T231500Z",
  "RRULE:FREQ=DAILY;COUNT=5",
  "DESCRIPTION:Line one\\nLine two with a long description that is folded onto",
  "  the next line",
  "BEGIN:VALARM",
  "TRIGGER:-PT15M",
  "DESCRIPTION:Alarm text must not replace the event's",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:tz-1",
  'SUMMARY;LANGUAGE="en:AU":Review',
  "DTSTART;TZID=Australia/Adelaide:20261007T090000",
  "DURATION:PT90M",
  "RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261028T000000Z",
  "LOCATION:Room 4",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:floating-1",
  "SUMMARY:Lunch",
  "DTSTART:20261008T120000",
  "DTEND:20261008T130000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:allday-1",
  "SUMMARY:Holiday",
  "DTSTART;VALUE=DATE:20261009",
  "DTEND;VALUE=DATE:20261010",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:moved-1",
  "SUMMARY:Moved occurrence",
  "RECURRENCE-ID:20261006T230000Z",
  "DTSTART:20261007T230000Z",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:hourly-1",
  "SUMMARY:Hourly",
  "DTSTART:20261008T010000Z",
  "RRULE:FREQ=HOURLY",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");
const parsed = parseIcs(ics, "Europe/Berlin");
const byTitle = (title: string) => parsed.events.find((event) => event.title === title)!;
assert.deepEqual(
  parsed.events.map((event) => event.title),
  ["Standup, daily", "Review", "Lunch", "Holiday", "Hourly"],
);
const standup = byTitle("Standup, daily");
assert.equal(standup.id, "ics:utc-1");
assert.equal(standup.timeZone, "UTC");
assert.equal(new Date(standup.startMs).toISOString(), "2026-10-05T23:00:00.000Z");
assert.equal(standup.endMs - standup.startMs, 15 * 60_000);
assert.equal(
  standup.notes,
  "Line one\nLine two with a long description that is folded onto the next line",
  "unfolded, unescaped, and the alarm's description ignored",
);
assert.deepEqual(standup.repeat, {
  frequency: "daily",
  interval: 1,
  end: { kind: "count", count: 5 },
});
const review = byTitle("Review");
assert.equal(review.timeZone, "Australia/Adelaide");
assert.equal(wallClock(review.startMs, "Australia/Adelaide").time, "09:00");
assert.equal(review.endMs - review.startMs, 90 * 60_000);
assert.deepEqual(review.repeat?.end, { kind: "until", date: "2026-10-28" });
assert.equal(review.notes, "Location: Room 4");
const lunch = byTitle("Lunch");
assert.equal(lunch.timeZone, "Europe/Berlin", "floating times are read in the local zone");
assert.equal(wallClock(lunch.startMs, "Europe/Berlin").time, "12:00");
const holiday = byTitle("Holiday");
assert.deepEqual(
  [wallClock(holiday.startMs, "Europe/Berlin"), wallClock(holiday.endMs, "Europe/Berlin")],
  [
    { date: "2026-10-09", time: "00:00" },
    { date: "2026-10-09", time: "23:59" },
  ],
);
assert.equal(byTitle("Hourly").repeat, undefined);
assert.deepEqual(parsed.skipped, [
  { title: "Moved occurrence", reason: "a changed occurrence of a repeating event" },
]);
const adjustments = parsed.adjusted.map((note) => `${note.title}: ${note.reason}`).join("\n");
assert.match(adjustments, /Lunch: repeat rule simplified \(BYDAY=MO,WE,FR/);
assert.doesNotMatch(adjustments, /Review: repeat/, "BYDAY of the start's own weekday is exact");
assert.match(adjustments, /Hourly: repeat HOURLY is not supported/);
assert.match(adjustments, /Holiday: all-day/);
assert.throws(
  () => parseIcs("hello", UTC),
  (error) => error instanceof IcsError && error.kind === "not-calendar",
);
assert.throws(
  () => parseIcs("BEGIN:VCALENDAR\nEND:VCALENDAR", UTC),
  (error) => error instanceof IcsError && error.kind === "no-events",
);

// Importing the same file twice updates rather than duplicates.
const once = mergeImported([plain], parsed.events);
assert.deepEqual([once.added, once.updated], [5, 0]);
const twice = mergeImported(once.events, parsed.events);
assert.deepEqual([twice.added, twice.updated, twice.events.length], [0, 5, 6]);

// Storage: events saved before colours and repeats load unchanged; new fields round-trip.
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "moire-calendar-model-"));
try {
  const file = path.join(fixture, "events.json");
  const legacy = [
    {
      id: "old",
      title: "Saved last year",
      startMs: Date.parse("2025-10-01T09:00:00Z"),
      endMs: Date.parse("2025-10-01T10:00:00Z"),
      timeZone: "UTC",
      notes: "",
    },
  ];
  await fs.writeFile(file, JSON.stringify(legacy));
  const store = new CalendarStore(file);
  assert.deepEqual(store.read(), legacy);
  store.write([...store.read(), counted, coloured], store.load().revision);
  const reread = store.read();
  assert.deepEqual(reread.find((event) => event.id === counted.id)?.repeat, counted.repeat);
  assert.equal(reread.find((event) => event.id === coloured.id)?.color, "green");
  await fs.writeFile(file, JSON.stringify([{ ...legacy[0], color: "magenta" }]));
  assert.throws(() => store.read(), /invalid event/);
  const icsFile = path.join(fixture, "events.ics");
  await fs.writeFile(icsFile, ics);
  assert.equal((await readIcsFile(icsFile, UTC)).events.length, 5);
  await assert.rejects(
    readIcsFile(path.join(fixture, "missing.ics"), UTC),
    (error) => error instanceof IcsError && error.kind === "unreadable",
  );
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}
console.log(
  "[calendar/model] dates, repeats, week layout, view state, .ics parsing and storage passed",
);
