/** Saved alarms: the editable list, its actions, and explicit recovery from save conflicts. */
import { useState } from "react";
import { randomUUID } from "node:crypto";
import { StorageConflictError, retryStoreCleanup } from "@moire/app-tools/local-store";
import { errorText } from "@moire/app-tools";
import type { AlarmStore } from "./backend";
import { nextAlarm, type Alarm } from "./time";

const SNOOZE_MS = 5 * 60_000;

/** A save problem the user resolves explicitly; a draft is never discarded behind their back. */
export type StorageNotice = {
  kind: "recovery" | "cleanup";
  title: string;
  message: string;
};

const CLEANUP_PENDING = "Saved; cleanup pending";

export function useAlarms(store: AlarmStore, wallNow: () => number, report: (s: string) => void) {
  const [loaded, setLoaded] = useState(() => {
    try {
      const snapshot = store.load(wallNow());
      return { alarms: [...snapshot.items], revision: snapshot.revision, error: "" };
    } catch (error) {
      return { alarms: [] as Alarm[], revision: null as string | null, error: errorText(error) };
    }
  });
  const [revision, setRevision] = useState(loaded.revision);
  const [alarms, setAlarms] = useState<Alarm[]>(loaded.alarms);
  const [notice, setNotice] = useState<StorageNotice | null>(null);

  /** Write `next`; on any failure keep the draft and ask whether to reload. */
  const persist = (next: Alarm[], message = "Saved alarms"): boolean => {
    if (loaded.error) {
      report(loaded.error);
      setNotice({ kind: "recovery", title: "Could not save", message: loaded.error });
      return false;
    }
    try {
      const saved = store.write(next, revision, wallNow());
      setAlarms([...saved.items]);
      setRevision(saved.revision);
      if (saved.cleanup.kind === "pending") {
        console.warn("[clock] Saved with pending cleanup", saved.cleanup.message);
        setNotice({
          kind: "cleanup",
          title: CLEANUP_PENDING,
          message:
            "Your changes are saved. Cleanup of owned temporary files is pending. Retry cleanup does not save another copy; a later save also retries it.",
        });
      }
      report(saved.cleanup.kind === "pending" ? `${message}. Cleanup pending.` : message);
      return true;
    } catch (error) {
      setNotice({
        kind: "recovery",
        title: error instanceof StorageConflictError ? "Saved data changed" : "Could not save",
        message: errorText(error),
      });
      report(errorText(error));
      return false;
    }
  };

  const retryCleanup = () => {
    const cleanup = retryStoreCleanup();
    if (cleanup.kind === "complete") {
      setNotice(null);
      report("Changes saved; storage cleanup finished.");
    } else {
      console.warn("[clock] Storage cleanup remains pending", cleanup.message);
      setNotice({
        kind: "cleanup",
        title: CLEANUP_PENDING,
        message:
          "Your changes remain saved. Cleanup could not finish. Retry cleanup does not save another copy.",
      });
    }
  };

  const reload = () => {
    try {
      const snapshot = store.load(wallNow());
      setLoaded({ alarms: [...snapshot.items], revision: snapshot.revision, error: "" });
      setAlarms([...snapshot.items]);
      setRevision(snapshot.revision);
      report("Reloaded saved data. Your current draft is kept; review it before retrying.");
      setNotice(null);
    } catch (error) {
      report(errorText(error));
      setNotice({
        kind: "recovery",
        title: "Could not reload saved data",
        message: `${errorText(error)}. Your draft is still here.`,
      });
    }
  };

  const attempt = (work: () => boolean): boolean => {
    try {
      return work();
    } catch (error) {
      report(errorText(error));
      return false;
    }
  };

  return {
    alarms,
    /** Replace the in-memory list without saving (rescheduling after a ring). */
    setAlarms,
    loadError: loaded.error,
    reload,
    retryCleanup,
    notice,
    setNotice,
    add: (time: string, label: string) =>
      attempt(() =>
        persist(
          [
            ...alarms,
            {
              id: randomUUID(),
              label: label.trim() || "Alarm",
              time,
              enabled: true,
              nextAtMs: nextAlarm(time, wallNow()),
            },
          ],
          `Alarm set for ${time}`,
        ),
      ),
    setEnabled: (alarm: Alarm, enabled: boolean) =>
      attempt(() =>
        persist(
          alarms.map((item) =>
            item.id === alarm.id
              ? { ...item, enabled, nextAtMs: nextAlarm(item.time, wallNow()) }
              : item,
          ),
          enabled ? `${alarm.label} on` : `${alarm.label} off`,
        ),
      ),
    remove: (alarm: Alarm) =>
      persist(
        alarms.filter((item) => item.id !== alarm.id),
        `Deleted ${alarm.label}`,
      ),
    /** Ring this alarm again in five minutes; false when it could not be saved. */
    snooze: (alarmId: string): boolean => {
      const target = alarms.find((alarm) => alarm.id === alarmId);
      if (!target?.enabled) {
        report("This alarm is no longer enabled. The notice remains available to dismiss.");
        return false;
      }
      return persist(
        alarms.map((alarm) =>
          alarm.id === target.id ? { ...alarm, nextAtMs: wallNow() + SNOOZE_MS } : alarm,
        ),
        `Snoozed ${target.label} for 5 minutes`,
      );
    },
  };
}
