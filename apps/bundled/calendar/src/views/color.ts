/** How event colours and tints are painted. */
import { EVENT_COLORS, type EventColor } from "#calendar/model";

/** An event's colour; events without one use the theme accent, as they always have. */
export function eventColor(color: EventColor | "default" | undefined, accent: number): number {
  return EVENT_COLORS.find((entry) => entry.id === color)?.color ?? accent;
}

/** `color` with its alpha replaced, for fills behind text. */
export function tint(color: number, alpha: number): number {
  return ((color & 0x00ffffff) | (alpha << 24)) >>> 0;
}
