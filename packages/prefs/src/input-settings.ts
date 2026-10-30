/**
 * Read-modify-write helpers and a change watcher for the keyboard and pointer prefs.
 * settings.json stays the single source of truth: Settings writes here, the compositor watches.
 */
import fs from "node:fs";
import { loadSettings, settingsPath, updateSettings } from "./store";
import type { KeyboardSettings, PointerSettings } from "./input";

export type InputSettings = { keyboard: KeyboardSettings; pointer: PointerSettings };

export function loadInputSettings(): InputSettings {
  const { keyboard, pointer } = loadSettings();
  return { keyboard, pointer };
}

/** Merge the caller's fields into the latest stored keyboard prefs. */
export function updateKeyboardSettings(patch: Partial<KeyboardSettings>): KeyboardSettings {
  return updateSettings({ keyboard: { ...loadSettings().keyboard, ...patch } }).keyboard;
}

/** Merge the caller's fields into the latest stored pointer prefs. */
export function updatePointerSettings(patch: Partial<PointerSettings>): PointerSettings {
  return updateSettings({ pointer: { ...loadSettings().pointer, ...patch } }).pointer;
}

export type InputSettingsWatcher = {
  /** Stat settings.json; reload and notify only when the input prefs actually changed. */
  poll(): boolean;
  current(): InputSettings;
};

export function createInputSettingsWatcher(
  onChange: (next: InputSettings, previous: InputSettings) => void,
  read: () => InputSettings = loadInputSettings,
): InputSettingsWatcher {
  const stamp = (): string => {
    try {
      const stat = fs.statSync(settingsPath(), { bigint: true });
      return `${stat.ino}:${stat.mtimeNs}:${stat.size}`;
    } catch {
      return "";
    }
  };
  let lastStamp = stamp();
  let current = read();
  let signature = JSON.stringify(current);
  return {
    current: () => current,
    poll() {
      const next = stamp();
      if (next === lastStamp) return false;
      lastStamp = next;
      const settings = read();
      const nextSignature = JSON.stringify(settings);
      if (nextSignature === signature) return false;
      const previous = current;
      current = settings;
      signature = nextSignature;
      onChange(current, previous);
      return true;
    },
  };
}
