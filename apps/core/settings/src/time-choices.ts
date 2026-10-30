/**
 * Clock-time choices for schedules (Do not disturb, night light, automatic dark style): every
 * half hour of the day, labelled in the user's clock format.
 */
import { formatClockTime, type RegionSettings } from "@moire/prefs";

/** Every half hour of the day, labelled in the user's clock format. */
export function scheduleTimes(region: RegionSettings): { id: string; label: string }[] {
  const day = new Date(2000, 0, 1);
  return Array.from({ length: 48 }, (_, index) => {
    const hours = Math.floor(index / 2);
    const minutes = (index % 2) * 30;
    const id = `${String(hours).padStart(2, "0")}:${minutes ? "30" : "00"}`;
    day.setHours(hours, minutes, 0, 0);
    return { id, label: formatClockTime(day, region) };
  });
}

/** `HH:MM` in the user's clock format. */
export function clockLabel(time: string, region: RegionSettings): string {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return formatClockTime(new Date(2000, 0, 1, hours, minutes), region);
}

/** A time someone saved off the half hour stays choosable. */
export function withTime(
  choices: readonly { id: string; label: string }[],
  time: string,
  region: RegionSettings,
) {
  return choices.some((choice) => choice.id === time)
    ? choices
    : [...choices, { id: time, label: clockLabel(time, region) }].sort((a, b) =>
        a.id.localeCompare(b.id),
      );
}
