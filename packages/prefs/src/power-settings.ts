/** Read-modify-write helpers for the power prefs. */
import { loadSettings, updateSettings } from "./store";
import { applyPowerPatch, type PowerSettings, type PowerSettingsPatch } from "./power";

export function loadPowerSettings(): PowerSettings {
  return loadSettings().power;
}

/** Merge the caller's fields into the latest stored power prefs, not a stale UI snapshot. */
export function updatePowerSettings(patch: PowerSettingsPatch): PowerSettings {
  return updateSettings({ power: applyPowerPatch(loadSettings().power, patch) }).power;
}
