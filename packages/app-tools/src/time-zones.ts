/**
 * Wall-clock time in IANA time zones, for apps that store instants but show and edit local dates
 * and times (Calendar, Clock). Dates are "YYYY-MM-DD" and times "HH:MM" strings.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

/** One formatter per zone: constructing Intl formatters dominates the cost of each conversion. */
function formatter(zone: string): Intl.DateTimeFormat {
  let found = formatters.get(zone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(zone, found);
  }
  return found;
}

export function isTimeZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** The local date and time an instant shows on a clock in `zone`. */
export function wallClock(timestamp: number, zone: string): { date: string; time: string } {
  const parts = formatter(zone).formatToParts(timestamp);
  const part = (name: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === name)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

/**
 * The instant a wall-clock date and time names in `zone`, using the zone's real offsets
 * (daylight saving included). An ambiguous time (clocks moving back) resolves to its first
 * occurrence. A time skipped by clocks moving forward is `null` with `gap: "reject"`, or moves
 * forward by the gap with `gap: "shift"` (02:30 becomes 03:30), as calendars do for repeats.
 * Malformed input is `null`.
 */
export function wallClockTimestamp(
  date: string,
  time: string,
  zone: string,
  options: { gap: "reject" | "shift" } = { gap: "reject" },
): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !isTimeZone(zone))
    return null;
  const naive = Date.parse(`${date}T${time}:00Z`);
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== `${date}T${time}`)
    return null;
  // Every offset the zone uses within a day and a half either side; real offsets never differ
  // by more than that across a single transition.
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = naive + hours * 3_600_000;
    const local = wallClock(sample, zone);
    offsets.add(Date.parse(`${local.date}T${local.time}:00Z`) - sample);
  }
  const candidates = [...offsets].map((offset) => naive - offset);
  const exact = candidates
    .filter((candidate) => {
      const local = wallClock(candidate, zone);
      return local.date === date && local.time === time;
    })
    .sort((a, b) => a - b)[0];
  if (exact !== undefined) return exact;
  return options.gap === "shift" ? naive - Math.min(...offsets) : null;
}
