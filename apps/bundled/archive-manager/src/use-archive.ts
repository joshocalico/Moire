/** Archive Manager's I/O: reading archives, extracting and saving them, with cancel and progress. */
import fs from "node:fs/promises";
import path from "node:path";
import { useEffect, useReducer, useRef } from "react";
import { errorText, freePath, rememberRecentFile, showInFiles } from "@moire/app-tools";
import { extractArchive, listArchive, writeArchive } from "./backend";
import {
  extractionName,
  initialState,
  isDirty,
  openDocument,
  reduce,
  targetFolder,
  withWritableExtension,
  type ArchiveDocument,
  type Change,
  type Dialog,
  type Pending,
  type State,
} from "./model";

export const APP_ID = "org.moire.ArchiveManager";

export type ArchiveControls = ReturnType<typeof makeControls>;

export function useArchive(options: {
  initialPath?: string;
  onCloseGuard?: (guard: (() => boolean) | null) => void;
  requestClose?: () => void;
}): [State, ArchiveControls] {
  const [state, dispatch] = useReducer(reduce, initialState);
  const live = useRef(state);
  live.current = state;
  const running = useRef<AbortController | null>(null);
  const closing = useRef(false);
  const controls = useRef<ArchiveControls | null>(null);
  controls.current ??= makeControls({
    dispatch,
    current: () => live.current,
    running,
    close: () => {
      closing.current = true;
      options.requestClose?.();
    },
  });
  useEffect(() => {
    if (options.initialPath) void controls.current!.open(options.initialPath, true);
    return () => running.current?.abort();
  }, []);
  // Closing with unsaved edits asks first, like opening another archive does.
  useEffect(() => {
    options.onCloseGuard?.(() => {
      const screen = live.current.screen;
      if (closing.current || screen.kind !== "document" || !isDirty(screen.doc)) return true;
      dispatch({
        type: "dialog",
        dialog: { kind: "discard", next: { kind: "close" } },
      });
      return false;
    });
    return () => options.onCloseGuard?.(null);
  }, [options.onCloseGuard]);
  return [state, controls.current];
}

function makeControls(env: {
  dispatch: (action: Parameters<typeof reduce>[1]) => void;
  current: () => State;
  running: { current: AbortController | null };
  close: () => void;
}) {
  const { dispatch, current, running } = env;
  const document = (): ArchiveDocument | null => {
    const screen = current().screen;
    return screen.kind === "document" ? screen.doc : null;
  };
  /** Runs `next` now, or asks to discard unsaved changes first. */
  const guarded = (next: Pending, force = false) => {
    const doc = document();
    if (!force && doc && isDirty(doc)) {
      dispatch({ type: "dialog", dialog: { kind: "discard", next } });
      return;
    }
    if (next.kind === "open") void open(next.file, true);
    else if (next.kind === "browse")
      dispatch({
        type: "dialog",
        dialog: { kind: "chooser", purpose: "open" },
      });
    else if (next.kind === "new") dispatch({ type: "new" });
    else env.close();
  };
  const open = async (file: string, force = false, keepTask = false) => {
    if (current().task.kind === "running") return;
    if (!force) return guarded({ kind: "open", file });
    dispatch({ type: "loading", file });
    if (!keepTask) dispatch({ type: "task-dismissed" });
    try {
      const listing = await listArchive(file);
      rememberRecentFile(APP_ID, listing.file);
      dispatch({
        type: "opened",
        doc: openDocument(listing.file, listing.entries, listing.kind),
      });
    } catch (error) {
      dispatch({ type: "open-failed", message: errorText(error) });
    }
  };
  const run = async (
    job: "extract" | "save",
    target: string,
    total: number,
    work: (
      signal: AbortSignal,
      progress: (done: number, total?: number) => void,
    ) => Promise<string>,
  ): Promise<string | null> => {
    if (running.current) return null;
    const controller = new AbortController();
    running.current = controller;
    dispatch({ type: "task-started", job, target, total });
    try {
      const output = await work(controller.signal, (done, all) =>
        dispatch({ type: "task-progress", done, total: all }),
      );
      dispatch({ type: "task-finished", output });
      return output;
    } catch (error) {
      dispatch({
        type: "task-failed",
        message: controller.signal.aborted
          ? `${job === "extract" ? "Extraction" : "Saving"} cancelled. Nothing was changed.`
          : errorText(error),
      });
      return null;
    } finally {
      running.current = null;
    }
  };
  const save = async (output: string | null) => {
    const doc = document();
    if (!doc) return;
    const target = output ? withWritableExtension(output) : doc.file;
    if (!target || (!output && !doc.format)) {
      dispatch({
        type: "dialog",
        dialog: { kind: "chooser", purpose: "save-as" },
      });
      return;
    }
    dispatch({ type: "dialog", dialog: null });
    const saved = await run("save", target, doc.entries.length, (signal, progress) =>
      writeArchive({
        original: doc.file,
        entries: doc.entries,
        output: target,
        replace: !output,
        signal,
        onProgress: progress,
      }),
    );
    if (saved) {
      // Re-read what was written: the listing is the proof, and it becomes the new base.
      await open(saved, true, true);
    }
  };
  return {
    open: (file: string, force = false) => void open(file, force),
    setDialog: (dialog: Dialog) => dispatch({ type: "dialog", dialog }),
    edit: (change: Change) => dispatch({ type: "edit", change }),
    select: (entry: string | null) => dispatch({ type: "select", path: entry }),
    dismissTask: () => dispatch({ type: "task-dismissed" }),
    browse: () => guarded({ kind: "browse" }),
    startNew: () => guarded({ kind: "new" }),
    /** Carry out what waited on the discard prompt, dropping the unsaved changes. */
    discardAndContinue: (next: Pending) => {
      dispatch({ type: "dialog", dialog: null });
      guarded(next, true);
    },
    save: (output: string | null = null) => void save(output),
    addSources: async (files: readonly string[]) => {
      const doc = document();
      if (!doc) return;
      for (const file of files) {
        try {
          const folder = (await fs.stat(file)).isDirectory();
          dispatch({
            type: "edit",
            change: {
              kind: "add",
              parent: targetFolder(doc),
              source: file,
              folder,
            },
          });
        } catch (error) {
          dispatch({ type: "notice", notice: errorText(error) });
        }
      }
    },
    extract: (parent?: string) => {
      const doc = document();
      if (!doc?.file) return;
      const file = doc.file;
      dispatch({ type: "dialog", dialog: null });
      const destination = freePath(parent ?? path.dirname(file), extractionName(file));
      const members = doc.base.filter((entry) => entry.origin.kind === "member").length;
      void run("extract", destination, members, (signal, progress) =>
        extractArchive(file, destination, signal, progress),
      );
    },
    cancel: () => running.current?.abort(),
    /** Show an extracted folder, or the folder a saved archive is in, in Files. */
    showResult: (target: string) =>
      void showInFiles(target).catch((error: unknown) =>
        dispatch({ type: "notice", notice: errorText(error) }),
      ),
  };
}
