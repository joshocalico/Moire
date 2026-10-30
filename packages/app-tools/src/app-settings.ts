/**
 * Small per-app preferences (units, modes, saved cities): one JSON object per app under
 * $XDG_CONFIG_HOME/moire/apps. Documents and records belong in local-store snapshots instead;
 * these are conveniences, so a missing or malformed file falls back to the defaults.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function appSettingsPath(appId: string): string {
  const config = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(config, "moire", "apps", `${appId.replace(/[^\w.-]/g, "_")}.json`);
}

/** Load an app's preferences; `parse` validates the stored value and fills in defaults. */
export function loadAppSettings<T>(appId: string, parse: (data: unknown) => T): T {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(appSettingsPath(appId), "utf8"));
  } catch {
    data = undefined;
  }
  return parse(data);
}

/** Save an app's preferences atomically. Throws so the app can say the change was not kept. */
export function saveAppSettings<T>(appId: string, value: T): void {
  const target = appSettingsPath(appId);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temporary, target);
}
