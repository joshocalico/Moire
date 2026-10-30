/** Clock's saved data: alarms (a shared local-store snapshot) and the world-clock cities. */
import path from "node:path";
import os from "node:os";
import { loadAppSettings, saveAppSettings } from "@moire/app-tools";
import { loadSnapshot, writeSnapshot, type StoreWriteResult } from "@moire/app-tools/local-store";
import { nextAlarm, type Alarm } from "./time";
import { parseCities } from "./world";

export const CLOCK_APP_ID = "org.moire.Clock";

function parseAlarms(data: unknown, now: number): Alarm[] {
  if (!Array.isArray(data)) throw new Error("Alarm file is invalid.");
  const identifiers = new Set<string>();
  return data.map((item: unknown) => {
    if (
      typeof item !== "object" ||
      !item ||
      !("id" in item) ||
      typeof item.id !== "string" ||
      !item.id ||
      !("label" in item) ||
      typeof item.label !== "string" ||
      !("time" in item) ||
      typeof item.time !== "string" ||
      !("enabled" in item) ||
      typeof item.enabled !== "boolean"
    )
      throw new Error("Alarm file contains an invalid alarm.");
    if (identifiers.has(item.id))
      throw new Error("Alarm file contains duplicate alarm identifiers.");
    identifiers.add(item.id);
    return {
      id: item.id,
      label: item.label,
      time: item.time,
      enabled: item.enabled,
      nextAtMs: nextAlarm(item.time, now),
    };
  });
}
export class AlarmStore {
  constructor(
    readonly file = path.join(
      process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local/share"),
      "moire/clock/alarms.json",
    ),
  ) {}
  load(now = Date.now()) {
    return loadSnapshot(this.file, (data) => parseAlarms(data, now));
  }
  read(now = Date.now()): Alarm[] {
    return [...this.load(now).items];
  }
  write(
    alarms: readonly Alarm[],
    expectedRevision: string | null,
    now = Date.now(),
  ): StoreWriteResult<Alarm> {
    const snapshot = writeSnapshot(this.file, alarms, expectedRevision, (data) =>
      parseAlarms(data, now),
    );
    return { ...snapshot, items: [...alarms] };
  }
}

/** Where the world-clock city list lives; a preference, so a broken file falls back to none. */
export type CityStore = {
  load(): string[];
  save(zones: readonly string[]): void;
};
export const settingsCityStore: CityStore = {
  load: () => loadAppSettings(CLOCK_APP_ID, parseCities),
  save: (zones) => saveAppSettings(CLOCK_APP_ID, { cities: zones }),
};
