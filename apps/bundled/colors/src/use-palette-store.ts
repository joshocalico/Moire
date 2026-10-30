/**
 * Saved palettes backed by PaletteStore: revision-checked writes, the conflict and pending-cleanup
 * notices they raise, and reloading after a conflict.
 */
import { useState } from "react";
import { StorageConflictError, retryStoreCleanup } from "@moire/app-tools/local-store";
import type { Palette, PaletteStore } from "./palettes";

/** Shown in a dialog: a failed or conflicting save (offer Reload), or a save whose cleanup lags. */
export type StorageNotice =
  | { kind: "recovery"; title: string; message: string }
  | { kind: "cleanup"; title: string; message: string };

const CLEANUP_TITLE = "Saved; cleanup pending";

function initial(store: PaletteStore) {
  try {
    const snapshot = store.load();
    return {
      palettes: [...snapshot.items],
      revision: snapshot.revision,
      loadError: "",
    };
  } catch (error) {
    return {
      palettes: [] as Palette[],
      revision: null,
      loadError: String(error),
    };
  }
}

export function usePaletteStore(store: PaletteStore, setStatus: (message: string) => void) {
  const [state, setState] = useState(() => initial(store));
  const [notice, setNotice] = useState<StorageNotice | null>(null);

  /** Write `next`; true when it was saved. Failures raise a notice and leave the list as it was. */
  const commit = (next: readonly Palette[], message: string): boolean => {
    if (state.loadError) {
      setStatus(state.loadError);
      setNotice({
        kind: "recovery",
        title: "Could not save",
        message: state.loadError,
      });
      return false;
    }
    try {
      const saved = store.write(next, state.revision);
      setState({
        palettes: [...saved.items],
        revision: saved.revision,
        loadError: "",
      });
      if (saved.cleanup.kind === "pending") {
        console.warn("[colors] Saved with pending cleanup", saved.cleanup.message);
        setNotice({
          kind: "cleanup",
          title: CLEANUP_TITLE,
          message:
            "Your changes are saved. Cleanup of owned temporary files is pending. Retry cleanup does not save another copy; a later save also retries it.",
        });
        setStatus(`${message}. Cleanup pending.`);
      } else setStatus(message);
      return true;
    } catch (caught) {
      setNotice({
        kind: "recovery",
        title: caught instanceof StorageConflictError ? "Saved data changed" : "Could not save",
        message: caught instanceof Error ? caught.message : String(caught),
      });
      setStatus(String(caught));
      return false;
    }
  };

  /** Re-read saved palettes; returns them so the caller can reconcile its selection. */
  const reload = (): readonly Palette[] | null => {
    try {
      const snapshot = store.load();
      setState({
        palettes: [...snapshot.items],
        revision: snapshot.revision,
        loadError: "",
      });
      setNotice(null);
      setStatus("Reloaded saved data. Your current draft is kept; review it before retrying.");
      return snapshot.items;
    } catch (error) {
      setStatus(String(error));
      setNotice({
        kind: "recovery",
        title: "Could not reload saved data",
        message: `${String(error)}. Your draft is still here.`,
      });
      return null;
    }
  };

  const retryCleanup = () => {
    const cleanup = retryStoreCleanup();
    if (cleanup.kind === "complete") {
      setNotice(null);
      setStatus("Changes saved; storage cleanup finished.");
      return;
    }
    console.warn("[colors] Storage cleanup remains pending", cleanup.message);
    setNotice({
      kind: "cleanup",
      title: CLEANUP_TITLE,
      message:
        "Your changes remain saved. Cleanup could not finish. Retry cleanup does not save another copy.",
    });
  };

  return {
    palettes: state.palettes,
    loadError: state.loadError,
    notice,
    dismissNotice: () => setNotice(null),
    commit,
    reload,
    retryCleanup,
  };
}
