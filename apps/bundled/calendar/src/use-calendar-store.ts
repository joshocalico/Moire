/** The saved events as React state: load, save with conflict detection, reload and cleanup. */
import { useRef, useState } from "react";
import { StorageConflictError, retryStoreCleanup } from "@moire/app-tools/local-store";
import type { CalendarStore } from "./events";
import type { CalendarEvent } from "./model";

/** A storage problem the user decides on: reload saved data, or retry a pending cleanup. */
export type StoragePrompt = {
  kind: "recovery" | "cleanup";
  title: string;
  message: string;
};
type Saved = ReturnType<CalendarStore["write"]>;

const CLEANUP_PENDING = {
  kind: "cleanup",
  title: "Saved; cleanup pending",
  message:
    "Your changes are saved. Cleanup of owned temporary files is pending. Retry cleanup does not save another copy; a later save also retries it.",
} as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadEvents(store: CalendarStore) {
  try {
    const snapshot = store.load();
    return {
      events: [...snapshot.items],
      revision: snapshot.revision,
      error: "",
    };
  } catch (error) {
    return {
      events: [] as CalendarEvent[],
      revision: null,
      error: String(error),
    };
  }
}

export function useCalendarStore(store: CalendarStore) {
  const [initial] = useState(() => loadEvents(store));
  const [loadError, setLoadError] = useState(initial.error);
  const [events, setEventsState] = useState<CalendarEvent[]>(initial.events);
  // Saves and async imports read the latest list, not the one a callback closed over.
  const eventsRef = useRef(events);
  const revision = useRef(initial.revision);
  const [status, setStatus] = useState(initial.error || "Events are saved on this computer");
  const [prompt, setPrompt] = useState<StoragePrompt | null>(null);
  const setEvents = (next: CalendarEvent[]) => {
    eventsRef.current = next;
    setEventsState(next);
  };

  /** Save the list `update` makes from the current one; `null` when it was not saved. */
  const persist = (
    update: (current: readonly CalendarEvent[]) => CalendarEvent[],
    message: string,
  ): Saved | null => {
    if (loadError) {
      setStatus(loadError);
      setPrompt({
        kind: "recovery",
        title: "Could not save",
        message: loadError,
      });
      return null;
    }
    try {
      const saved = store.write(update(eventsRef.current), revision.current);
      setEvents([...saved.items]);
      revision.current = saved.revision;
      const pending = saved.cleanup.kind === "pending";
      if (pending) {
        console.warn("[calendar] Saved with pending cleanup", saved.cleanup.message);
        setPrompt(CLEANUP_PENDING);
      }
      setStatus(pending ? `${message}. Cleanup pending.` : message);
      return saved;
    } catch (error) {
      setPrompt({
        kind: "recovery",
        title: error instanceof StorageConflictError ? "Saved data changed" : "Could not save",
        message: errorMessage(error),
      });
      setStatus(String(error));
      return null;
    }
  };

  const retryCleanup = () => {
    const cleanup = retryStoreCleanup();
    if (cleanup.kind === "complete") {
      setPrompt(null);
      setStatus("Changes saved; storage cleanup finished.");
      return;
    }
    console.warn("[calendar] Storage cleanup remains pending", cleanup.message);
    setPrompt({
      kind: "cleanup",
      title: "Saved; cleanup pending",
      message:
        "Your changes remain saved. Cleanup could not finish. Retry cleanup does not save another copy.",
    });
  };

  /** Re-read the store after a conflict; the open draft is kept for the user to review. */
  const reloadSaved = (): boolean => {
    try {
      const snapshot = store.load();
      setLoadError("");
      setEvents([...snapshot.items]);
      revision.current = snapshot.revision;
      setStatus("Reloaded saved data. Your current draft is kept; review it before retrying.");
      setPrompt(null);
      return true;
    } catch (error) {
      setStatus(String(error));
      setPrompt({
        kind: "recovery",
        title: "Could not reload saved data",
        message: `${String(error)}. Your draft is still here.`,
      });
      return false;
    }
  };

  return {
    events,
    loadError,
    status,
    setStatus,
    prompt,
    askReload: () =>
      setPrompt({
        kind: "recovery",
        title: "Reload saved data?",
        message: "Current input is kept. Review it before retrying the save.",
      }),
    dismissPrompt: () => setPrompt(null),
    persist,
    retryCleanup,
    reloadSaved,
  };
}
