/**
 * Automatic dark style: while `autoDark` is on, keep `dark` matching its schedule. Checked every
 * half minute and soon after settings.json changes; a flip writes the pref, the active theme the
 * compositor, shell and apps watch, and GTK's scheme, the same three things Settings writes.
 */
import fs from "node:fs";
import {
  applyGtkAppearance,
  autoDarkState,
  loadSettings,
  readZoneLocation,
  settingsPath,
  updateSettings,
  writeActiveTheme,
  type DaylightContext,
  type MoireSettings,
} from "@moire/prefs";

const CHECK_MS = 30_000;
const WATCH_MS = 2_000;

export type AppearanceScheduleOptions = {
  load?: () => MoireSettings;
  /** Write `dark` and apply it; returns the stored settings. */
  apply?: (dark: boolean) => MoireSettings;
  context?: () => DaylightContext;
  now?: () => Date;
  checkMs?: number;
  /** Follow settings.json; false in smokes that call `check` themselves. */
  watch?: boolean;
  onError?: (error: unknown) => void;
};

export function applyDark(dark: boolean): MoireSettings {
  const next = updateSettings({ dark });
  writeActiveTheme(next);
  applyGtkAppearance(next.dark, next.uiScale);
  return next;
}

/** The scheme the schedule wants now, or null when automatic dark style is off or agrees. */
export function scheduledDark(
  settings: MoireSettings,
  now: Date,
  context: DaylightContext,
): boolean | null {
  const state = autoDarkState(settings.autoDark, settings.nightLight, now, context);
  return state && state.active !== settings.dark ? state.active : null;
}

export function attachAppearanceSchedule(options: AppearanceScheduleOptions = {}) {
  const load = options.load ?? loadSettings;
  const apply = options.apply ?? applyDark;
  const context = options.context ?? (() => readZoneLocation());
  const now = options.now ?? (() => new Date());
  const check = (): boolean | null => {
    try {
      const want = scheduledDark(load(), now(), context());
      if (want == null) return null;
      apply(want);
      return want;
    } catch (error) {
      options.onError?.(error);
      return null;
    }
  };
  const timer = setInterval(check, options.checkMs ?? CHECK_MS);
  timer.unref();
  const file = settingsPath();
  const onChange = () => check();
  if (options.watch !== false)
    fs.watchFile(file, { interval: WATCH_MS, persistent: false }, onChange);
  check();
  return {
    check,
    async dispose() {
      clearInterval(timer);
      if (options.watch !== false) fs.unwatchFile(file, onChange);
    },
  };
}
