/** Mode and angle unit, kept between runs in the shared per-app settings file. */
import { loadAppSettings, saveAppSettings } from "@moire/app-tools";
import { parseSettings, type CalculatorSettings } from "./model";

export const APP_ID = "org.moire.Calculator";

export const loadPreferences = (): CalculatorSettings => loadAppSettings(APP_ID, parseSettings);
export const savePreferences = (settings: CalculatorSettings): void =>
  saveAppSettings(APP_ID, settings);
