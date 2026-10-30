/** Read-modify-write helpers for the launcher pins. */
import { loadSettings, updateSettings } from "./store";

export function loadLauncherPins(): string[] {
  return loadSettings().launcherPins;
}

/** Change the latest stored pins, not a stale snapshot; returns what was saved. */
export function updateLauncherPins(change: (pins: readonly string[]) => string[]): string[] {
  return updateSettings({ launcherPins: change(loadSettings().launcherPins) }).launcherPins;
}
