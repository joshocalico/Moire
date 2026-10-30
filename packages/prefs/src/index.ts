/**
 * Watch Moire prefs / active theme and reload into @moire/theme cache.
 */
import fs from "node:fs";
import { loadTheme, setTheme, type MoireTheme } from "@moire/theme";
import { activeThemePath, loadSettings, settingsPath } from "./store";
import { bundledThemePath, themeForSettings } from "./apply";

export type PrefsWatcher = {
  /** Poll for changes (call from compositor frame / shell timer). */
  poll(): boolean;
  /** Current theme after last successful load. */
  theme(): MoireTheme;
  stop(): void;
};

/**
 * Prefer ~/.config/moire/active-theme.json when present; else bundled theme
 * for the current dark preference in settings.json.
 */
export function resolveRuntimeThemePath(): string {
  const active = activeThemePath();
  if (fs.existsSync(active)) return active;
  try {
    return bundledThemePath(loadSettings().dark);
  } catch {
    return bundledThemePath(true);
  }
}

export function loadRuntimeTheme(): MoireTheme {
  const theme = fs.existsSync(activeThemePath())
    ? loadTheme(resolveRuntimeThemePath())
    : themeForSettings(loadSettings());
  setTheme(theme);
  return theme;
}

export function createPrefsWatcher(onChange?: (theme: MoireTheme) => void): PrefsWatcher {
  let lastSettingsStamp = "";
  let lastThemeStamp = "";
  let lastSig = "";
  let current = loadRuntimeTheme();
  let debounceUntil = 0;

  const fileStamp = (p: string): string => {
    try {
      const stat = fs.statSync(p, { bigint: true });
      return `${stat.ino}:${stat.mtimeNs}:${stat.size}`;
    } catch {
      return "";
    }
  };

  const signature = (): string => {
    try {
      const s = loadSettings();
      return `${s.dark}|${s.themeFamily}|${s.uiScale}|${s.reducedMotion}|${s.panelFullWidth}|${s.panelIconsOnly}|${fileStamp(activeThemePath())}|${current.name}`;
    } catch {
      return String(fileStamp(activeThemePath()));
    }
  };

  lastSettingsStamp = fileStamp(settingsPath());
  lastThemeStamp = fileStamp(activeThemePath());
  lastSig = signature();

  return {
    theme: () => current,
    poll(): boolean {
      const now = Date.now();
      if (now < debounceUntil) return false;
      const sm = fileStamp(settingsPath());
      const tm = fileStamp(activeThemePath());
      if (sm === lastSettingsStamp && tm === lastThemeStamp) return false;
      lastSettingsStamp = sm;
      lastThemeStamp = tm;
      try {
        const settings = loadSettings();
        const next = loadRuntimeTheme();
        const sig = `${settings.dark}|${settings.themeFamily}|${settings.uiScale}|${settings.reducedMotion}|${settings.panelFullWidth}|${settings.panelIconsOnly}|${tm}|${next.name}`;
        if (sig === lastSig) return false;
        lastSig = sig;
        current = next;
        debounceUntil = now + 200;
        onChange?.(current);
        console.log(`[prefs] reloaded theme=${current.name} scale=${settings.uiScale}`);
        return true;
      } catch (err) {
        console.warn("[prefs] reload failed:", err);
        return false;
      }
    },
    stop() {
      // no handles
    },
  };
}

export {
  loadSettings,
  saveSettings,
  updateSettings,
  settingsPath,
  activeThemePath,
  configDir,
  DEFAULT_SETTINGS,
  type MoireSettings,
  type WallpaperSettings,
  type DisplayOutputSettings,
} from "./store";
export {
  applySettings,
  writeActiveTheme,
  themeForSettings,
  applyGtkAppearance,
  bundledThemePath,
  type ApplyResult,
} from "./apply";
export {
  DEFAULT_KEYBOARD_SETTINGS,
  DEFAULT_POINTER_SETTINGS,
  MAX_KEYBOARD_LAYOUTS,
  REPEAT_DELAY_RANGE,
  REPEAT_RATE_RANGE,
  isXkbName,
  keyboardLayoutId,
  normalizeKeyboardSettings,
  normalizePointerSettings,
  type AccelProfile,
  type CapsLockBehavior,
  type KeyboardLayoutRef,
  type KeyboardSettings,
  type LayoutSwitchShortcut,
  type PointerSettings,
  type TouchpadClickMethod,
  type TouchpadScrollMethod,
} from "./input";
export {
  createInputSettingsWatcher,
  loadInputSettings,
  updateKeyboardSettings,
  updatePointerSettings,
  type InputSettings,
  type InputSettingsWatcher,
} from "./input-settings";
export {
  DEFAULT_REGION_SETTINGS,
  formatCalendarDate,
  formatClockTime,
  normalizeRegionSettings,
  resolveFirstDayOfWeek,
  resolveFormatLocale,
  systemTimeZone,
  type ClockFormat,
  type DateFormat,
  type FirstDayOfWeek,
  type FormatOptions,
  type RegionSettings,
} from "./region";
export {
  createLiveClock,
  loadRegionSettings,
  updateRegionSettings,
  type LiveClock,
} from "./region-settings";
export {
  DEFAULT_POWER_SETTINGS,
  POWER_CHOICES,
  applyPowerPatch,
  normalizePowerSettings,
  type LidCloseAction,
  type PowerButtonAction,
  type PowerProfile,
  type PowerSettings,
  type PowerSettingsPatch,
  type PowerSourceTimeouts,
  type SleepBlockerGrant,
} from "./power";
export { loadPowerSettings, updatePowerSettings } from "./power-settings";
export {
  MAX_LAUNCHER_PINS,
  isLauncherPinned,
  moveLauncherPin,
  normalizeLauncherPins,
  orderLauncherApps,
  pinLauncherApp,
  toggleLauncherPin,
  unpinLauncherApp,
} from "./launcher";
export { loadLauncherPins, updateLauncherPins } from "./launcher-settings";
export {
  DEFAULT_DND_SCHEDULE,
  DEFAULT_NOTIFICATION_RULE,
  dndScheduleActive,
  dndScheduleEnd,
  minutesOfDay,
  normalizeDndSchedule,
  normalizeNotificationRules,
  notificationAppKey,
  notificationRuleFor,
  withNotificationRule,
  type DoNotDisturbSchedule,
  type NotificationRule,
  type NotificationRules,
} from "./notifications";
export {
  DEFAULT_AUTO_DARK,
  DEFAULT_NIGHT_LIGHT,
  NEUTRAL_KELVIN,
  WARMEST_KELVIN,
  autoDarkState,
  clockMinutes,
  clockTime,
  localClock,
  nightLightKelvin,
  nightLightScale,
  nightLightSchedule,
  nightLightState,
  normalizeAutoDark,
  normalizeNightLight,
  parseIso6709,
  readZoneLocation,
  scheduleState,
  sunTimes,
  zoneCoordinates,
  type AutoDarkSettings,
  type ClockTime,
  type Coordinates,
  type DaySchedule,
  type DaylightContext,
  type NightLightSettings,
  type ScheduleState,
  type SunTimes,
} from "./daylight";
export {
  DEFAULT_MANUAL_PROXY,
  isProxyAddress,
  normalizeManualProxy,
  proxyEnvironment,
  type ManualProxySettings,
} from "./network-proxy";
