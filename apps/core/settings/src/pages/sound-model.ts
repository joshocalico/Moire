/** Sound's wording and arithmetic: volumes as people read them, device choices, the meter. */
import type {
  DesktopSound,
  DesktopSoundDevice,
  DesktopSoundStream,
} from "@moire/system-management/desktop-status";

/** Volume as people read it; the service may report a boost above 100%. */
export const volumePercent = (volume: number) => `${Math.round(volume * 100)}%`;

/** The meter's floor: quieter than this shows as an empty bar. */
const METER_FLOOR_DB = -60;

/**
 * A peak (0..1) as a bar length. Loudness is heard in decibels, so a straight peak would leave
 * speech in the bottom fifth of the bar.
 */
export function meterLevel(peak: number): number {
  if (!(peak > 0)) return 0;
  const db = 20 * Math.log10(Math.min(1, peak));
  return Math.max(0, Math.min(1, 1 - db / METER_FLOOR_DB));
}

/** The bar after a new peak: it jumps up and falls back gently. */
export function meterStep(previous: number, peak: number, fall = 0.12): number {
  return Math.max(meterLevel(peak), previous - fall);
}

export type ReadySound = Extract<DesktopSound, { kind: "ready" }>;

/** Device choices for a select; names repeated by two devices get their id to tell them apart. */
export function deviceChoices(devices: readonly DesktopSoundDevice[]) {
  const counts = new Map<string, number>();
  for (const device of devices) counts.set(device.name, (counts.get(device.name) ?? 0) + 1);
  return devices.map((device) => ({
    id: device.id,
    label: (counts.get(device.name) ?? 0) > 1 ? `${device.name} (${device.id})` : device.name,
  }));
}

export const defaultDevice = (devices: readonly DesktopSoundDevice[]) =>
  devices.find((device) => device.isDefault) ?? null;

/** A playing app's second line: what it plays, then its level. */
export function streamDescription(stream: DesktopSoundStream): string {
  const level = stream.muted ? "Muted" : volumePercent(stream.volume);
  return stream.title ? `${stream.title} · ${level}` : level;
}

/** The section's sentence when no app is playing, and the count when some are. */
export function appsSummary(streams: readonly DesktopSoundStream[]): string {
  if (!streams.length) return "When an app plays sound, its volume appears here.";
  return streams.length === 1 ? "1 app playing" : `${streams.length} apps playing`;
}
