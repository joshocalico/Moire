/**
 * Search & Privacy's state: the file index's status, the indexing prefs it edits (the switch,
 * excluded folders, drives), rebuilding and clearing, and the dialogs those need.
 */
import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmationDialog } from "@moire/ui";
import { FileChooser, formatBytes, tidyPath } from "@moire/app-tools";
import {
  EVERYWHERE,
  type IndexClient,
  type IndexClientState,
} from "@moire/system-management/index-status";
import type { StorageClient, StorageClientState } from "@moire/system-management/storage-status";
import {
  addExclude,
  formatCount,
  removableDrives,
  removeEntry,
  summarizeIndex,
  withInclude,
  type Edit,
  type IndexingPrefs,
} from "./search-model";
import {
  clearIndex,
  currentSearchEnvironment,
  indexOnDisk,
  readHandEditedConfig,
  readIndexingPrefs,
  rebuildIndex,
  writeIndexingPrefs,
  type HandEditedConfig,
} from "./search-backend";

const APP_ID = "org.moire.Settings";
type Dialog = "none" | "turn-off" | "clear" | "choose-folder";
type Busy = "rebuild" | "clear" | null;

/** The page's state: prefs it edits, and what the index and drive services report. */
/** A change to the indexing prefs, for the settings journal. */
export type IndexingChange = (
  items: readonly {
    key: "indexingEnabled" | "indexExcludes" | "indexIncludes";
    from: unknown;
    to: unknown;
  }[],
  label: string,
) => void;

const PREF_KEYS = {
  enabled: "indexingEnabled",
  excludes: "indexExcludes",
  includes: "indexIncludes",
} as const;

export function useSearchSettings(
  index: IndexClient | null,
  storage: StorageClient | null,
  onChange?: IndexingChange,
) {
  const env = useRef(currentSearchEnvironment()).current;
  const [prefs, setPrefs] = useState<IndexingPrefs>(readIndexingPrefs);
  const [indexState, setIndexState] = useState<IndexClientState | null>(index?.state ?? null);
  const [storageState, setStorageState] = useState<StorageClientState | null>(
    storage?.state ?? null,
  );
  const [handEdited, setHandEdited] = useState<HandEditedConfig | null>(null);
  const [dialog, setDialog] = useState<Dialog>("none");
  const [busy, setBusy] = useState<Busy>(null);
  const [status, setStatus] = useState("");
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    setHandEdited(readHandEditedConfig());
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => (index ? index.subscribe(setIndexState) : undefined), [index]);
  useEffect(() => (storage ? storage.subscribe(setStorageState) : undefined), [storage]);

  const report = (edit: Edit<IndexingPrefs>, note: string, journal = true) => {
    if (!mounted.current) return;
    if (edit.ok) {
      const changed = (Object.keys(PREF_KEYS) as (keyof IndexingPrefs)[]).filter(
        (key) => JSON.stringify(prefs[key]) !== JSON.stringify(edit.value[key]),
      );
      if (journal && changed.length)
        onChange?.(
          changed.map((key) => ({ key: PREF_KEYS[key], from: prefs[key], to: edit.value[key] })),
          note,
        );
      setPrefs(edit.value);
    }
    setStatus(edit.ok ? note : edit.message);
  };
  const save = (patch: Partial<IndexingPrefs>, note: string) =>
    report(writeIndexingPrefs(patch), note);

  const summary = summarizeIndex(indexState, prefs.enabled);
  const running = indexState?.kind === "ready" && indexState.status.state !== "disabled";

  return {
    env,
    prefs,
    summary,
    running,
    busy,
    dialog,
    status,
    handEdited,
    drives: removableDrives(storageState, prefs.includes, formatBytes),
    setDialog,
    /** Read the prefs again after something else (Undo) wrote them. */
    reload() {
      setPrefs(readIndexingPrefs());
    },
    setEnabled(on: boolean) {
      if (on) return save({ enabled: true }, "Indexing on");
      // Turning off deletes the index, so say so first when there is one.
      if (summary.hasIndex || indexOnDisk(env)) setDialog("turn-off");
      else save({ enabled: false }, "Indexing off");
    },
    confirmTurnOff() {
      setDialog("none");
      save({ enabled: false }, "Indexing off · index deleted");
    },
    chooseExclude(folder: string) {
      setDialog("none");
      const edit = addExclude(prefs.excludes, folder, env);
      if (!edit.ok) return setStatus(edit.message);
      save({ excludes: edit.value }, `${tidyPath(folder)} excluded`);
    },
    removeExclude(entry: string) {
      save({ excludes: removeEntry(prefs.excludes, entry) }, `${tidyPath(entry)} included again`);
    },
    setDrive(drive: string, on: boolean) {
      save(
        { includes: withInclude(prefs.includes, drive, on) },
        on ? `${tidyPath(drive)} will be indexed` : `${tidyPath(drive)} left out of the index`,
      );
    },
    rebuild() {
      if (!index || busy) return;
      setBusy("rebuild");
      setStatus("Rebuilding the index…");
      void rebuildIndex(index, EVERYWHERE).then((result) => {
        if (!mounted.current) return;
        setBusy(null);
        setStatus(result.ok ? "Rebuilding the index" : result.message);
      });
    },
    confirmClear() {
      setDialog("none");
      if (!index || busy) return;
      setBusy("clear");
      setStatus("Clearing the index…");
      void clearIndex(index).then((result) => {
        if (!mounted.current) return;
        setBusy(null);
        report(result, "Index cleared · indexing again from the start");
      });
    },
  };
}

export type SearchSettings = ReturnType<typeof useSearchSettings>;

export function searchSummary(state: SearchSettings): string {
  const counts = state.summary.counts;
  return counts && state.running
    ? `${formatCount(counts.files)} files indexed for Files search`
    : state.summary.title;
}

/** The confirmations and folder chooser, above the whole window. */
export function SearchOverlays(props: {
  state: SearchSettings;
  width: number;
  height: number;
}): ReactNode {
  const { state } = props;
  return (
    <>
      <ConfirmationDialog
        open={state.dialog === "turn-off"}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title="Turn off indexing?"
        message="The index is deleted. Files will search names only until you turn indexing on again and it rebuilds."
        confirmLabel="Turn off"
        danger
        onConfirm={state.confirmTurnOff}
        onDismiss={() => state.setDialog("none")}
      />
      <ConfirmationDialog
        open={state.dialog === "clear"}
        viewportWidth={props.width}
        viewportHeight={props.height}
        title="Clear the index?"
        message="Everything indexed is deleted, then your files are read again from the start."
        confirmLabel="Clear"
        danger
        onConfirm={state.confirmClear}
        onDismiss={() => state.setDialog("none")}
      />
      {state.dialog === "choose-folder" ? (
        <FileChooser
          width={props.width}
          height={props.height}
          mode="folder"
          appId={APP_ID}
          title="Exclude a folder from search"
          directory={state.env.home}
          onChoose={state.chooseExclude}
          onCancel={() => state.setDialog("none")}
        />
      ) : null}
    </>
  );
}
