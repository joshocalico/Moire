/**
 * Calendar dates as "YYYY-MM-DD" strings. Arithmetic runs at noon UTC so it never crosses a
 * daylight-saving boundary; time zones only matter when a date meets a time (see model.ts).
 */

const DAY_MS = 86_400_000;
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function noon(date: string): Date {
  const value = new Date(`${date}T12:00:00Z`);
  if (!Number.isFinite(value.getTime())) throw new Error(`Invalid calendar date ${date}.`);
  return value;
}

export function addDays(date: string, days: number): string {
  return new Date(noon(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((noon(to).getTime() - noon(from).getTime()) / DAY_MS);
}

/** Monday = 0 … Sunday = 6, matching the grid's columns. */
export function weekdayIndex(date: string): number {
  return (noon(date).getUTCDay() + 6) % 7;
}

/** The seven dates of the Monday-first week containing `date`. */
export function weekDays(date: string): string[] {
  const monday = addDays(date, -weekdayIndex(date));
  return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
}

/** Six Monday-first weeks covering `month` ("YYYY-MM"), padded with neighbouring days. */
export function monthDays(month: string): string[] {
  const first = `${month}-01`;
  const start = addDays(first, -weekdayIndex(first));
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

/** The same day `months` later, or `null` when that month is too short (31 Jan + 1 month). */
export function addMonths(date: string, months: number): string | null {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const index = year * 12 + (month - 1) + months;
  const target = new Date(Date.UTC(Math.floor(index / 12), index % 12, day, 12));
  if (target.getUTCDate() !== day) return null;
  return target.toISOString().slice(0, 10);
}

export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

export function moveMonth(month: string, offset: number): string {
  return addMonths(`${month}-01`, offset)!.slice(0, 7);
}

function format(date: string, options: Intl.DateTimeFormatOptions): string {
  return noon(date).toLocaleDateString(undefined, {
    ...options,
    timeZone: "UTC",
  });
}

export const monthTitle = (month: string) =>
  format(`${month}-01`, { month: "long", year: "numeric" });
export const dayTitle = (date: string) =>
  format(date, { weekday: "long", day: "numeric", month: "long" });
export const shortDate = (date: string) => format(date, { day: "numeric", month: "short" });

/** "5 – 11 October 2026", "28 Sept – 4 Oct 2026" or across a new year with both years. */
export function weekTitle(date: string): string {
  const days = weekDays(date);
  const first = days[0]!,
    last = days[6]!;
  if (first.slice(0, 7) === last.slice(0, 7))
    return `${Number(first.slice(8))} – ${format(last, { day: "numeric", month: "long", year: "numeric" })}`;
  if (first.slice(0, 4) === last.slice(0, 4))
    return `${shortDate(first)} – ${format(last, { day: "numeric", month: "short", year: "numeric" })}`;
  const long = { day: "numeric", month: "short", year: "numeric" } as const;
  return `${format(first, long)} – ${format(last, long)}`;
}
