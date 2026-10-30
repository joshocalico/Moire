/**
 * How evening schedules read in Settings: night light's and automatic dark style's state as a
 * sentence, and the choices for their schedule selects.
 */
import {
  autoDarkState,
  nightLightState,
  type AutoDarkSettings,
  type NightLightSettings,
  type RegionSettings,
  type ScheduleState,
} from "@moire/prefs";
import type { DaylightModel } from "#settings/context";
import { clockLabel } from "#settings/time-choices";

export const NIGHT_LIGHT_SCHEDULES = [
  { id: "sunset", label: "Sunset to sunrise" },
  { id: "custom", label: "Custom times" },
  { id: "off", label: "No schedule" },
] as const;

export const AUTO_DARK_SCHEDULES = [
  { id: "sunset", label: "Sunset to sunrise" },
  { id: "night-light", label: "With night light" },
  { id: "custom", label: "Custom times" },
] as const;

/** Said when sunset was asked for but the time zone has no place to take it from. */
export function approximateNote(from: string, to: string, region: RegionSettings): string {
  return `Your time zone has no location, so sunset to sunrise uses ${clockLabel(from, region)} to ${clockLabel(to, region)}. Choose Custom times to change them.`;
}

export function nightLightNow(settings: NightLightSettings, daylight: DaylightModel) {
  return nightLightState(settings, daylight.now, daylight);
}

/** "On until 05:43", "Comes on at 21:21", "On" or the plain description. */
export function nightLightSummary(
  settings: NightLightSettings,
  state: ScheduleState,
  region: RegionSettings,
): string {
  if (!settings.enabled) return "Warmer colours in the evening";
  if (settings.schedule === "off") return "On until you turn it off";
  if (!state.until) return state.active ? "On all night here" : "Off: the sun doesn't set here";
  return state.active
    ? `On until ${clockLabel(state.until, region)}`
    : `Comes on at ${clockLabel(state.until, region)}`;
}

export function autoDarkNow(
  auto: AutoDarkSettings,
  nightLight: NightLightSettings,
  daylight: DaylightModel,
) {
  return autoDarkState(auto, nightLight, daylight.now, daylight);
}

/** "Dark until 05:43", "Light until 21:21". */
export function autoDarkSummary(state: ScheduleState, region: RegionSettings): string {
  const scheme = state.active ? "Dark" : "Light";
  return state.until ? `${scheme} until ${clockLabel(state.until, region)}` : `${scheme} today`;
}
