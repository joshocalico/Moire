/** Read-modify-write helpers for the region prefs, and the panel clock's live formatter. */
import fs from "node:fs";
import { loadSettings, settingsPath, updateSettings } from "./store";
import { formatClockTime, systemTimeZone, type RegionSettings } from "./region";

export function loadRegionSettings(): RegionSettings {
  return loadSettings().region;
}

/** Merge the caller's fields into the latest stored region prefs. */
export function updateRegionSettings(patch: Partial<RegionSettings>): RegionSettings {
  return updateSettings({ region: { ...loadSettings().region, ...patch } }).region;
}

export type LiveClock = {
  /** The current time as the panel shows it; cheap enough to call every second. */
  format(now?: Date): string;
};

/**
 * A clock that follows the 24-hour pref and the system zone without a restart. Prefs are re-read
 * only when settings.json changes; the zone is one readlink per call.
 */
export function createLiveClock(
  options: {
    read?: () => RegionSettings;
    stamp?: () => string;
    zone?: () => string | null;
  } = {},
): LiveClock {
  const read = options.read ?? loadRegionSettings;
  const zone = options.zone ?? (() => systemTimeZone());
  const stamp =
    options.stamp ??
    (() => {
      try {
        const stat = fs.statSync(settingsPath(), { bigint: true });
        return `${stat.ino}:${stat.mtimeNs}:${stat.size}`;
      } catch {
        return "";
      }
    });
  let lastStamp: string | null = null;
  let region: RegionSettings | null = null;
  return {
    format(now = new Date()) {
      const next = stamp();
      if (!region || next !== lastStamp) {
        lastStamp = next;
        region = read();
      }
      return formatClockTime(now, region, { timeZone: zone() });
    },
  };
}
