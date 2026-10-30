/** The notebook as saved and as drafted, with autosave and save-before-close. */
import { useEffect, useRef, useState } from "react";
import { requestActiveWindowRedraw } from "@moire/ui";
import { errorText } from "@moire/app-tools";
import { emptyNotebook, type NotesStore, type Notebook } from "./store";
import { editNote, type NotePatch } from "./model";

/** Typing pauses this long before a draft is written. */
const AUTOSAVE_DELAY_MS = 400;
const IDLE_STATUS = "Notes stay on this computer";

export type NotebookState = ReturnType<typeof useNotebook>;

export function useNotebook(store: NotesStore, onCloseGuard?: (guard: () => boolean) => void) {
  // Read once, before the first frame, so the first frame already shows the saved notes.
  const [initial] = useState(() => {
    try {
      return { book: store.load(), status: IDLE_STATUS };
    } catch (error) {
      return { book: emptyNotebook(), status: errorText(error) };
    }
  });
  const [book, setBook] = useState(initial.book);
  const [status, setStatus] = useState(initial.status);
  // Event handlers run several steps per input; they read and write the latest book here
  // rather than through a render-old closure.
  const current = useRef(book);
  const unsaved = useRef(false);
  const replace = (next: Notebook) => {
    current.current = next;
    setBook(next);
  };
  /** Saves `next`; on failure the draft stays in memory and the status says why. */
  const commit = (next: Notebook): boolean => {
    try {
      const saved = store.save(next);
      replace(saved);
      unsaved.current = false;
      setStatus(saved.cleanup.kind === "pending" ? saved.cleanup.message : "Saved locally");
      return true;
    } catch (error) {
      setStatus(errorText(error));
      return false;
    }
  };
  /** Saves pending edits, if any. False means the draft could not be saved and must be kept. */
  const flush = (): boolean => !unsaved.current || commit(current.current);
  const edit = (id: string, patch: NotePatch) => {
    unsaved.current = true;
    replace(editNote(current.current, id, patch, Date.now()));
    setStatus("Saving…");
  };
  /** Replaces the draft with the saved notebook; returns it, or null when it cannot be read. */
  const reload = (): Notebook | null => {
    try {
      const next = store.load();
      replace(next);
      unsaved.current = false;
      setStatus("Reloaded local notes");
      return next;
    } catch (error) {
      setStatus(errorText(error));
      return null;
    }
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    if (!unsaved.current) return;
    const timer = setTimeout(() => {
      flushRef.current();
      requestActiveWindowRedraw();
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [book]);
  useEffect(() => {
    onCloseGuard?.(() => {
      const accepted = flushRef.current();
      requestActiveWindowRedraw();
      return accepted;
    });
  }, [onCloseGuard]);
  return {
    book,
    status,
    setStatus,
    /** The latest notebook, including edits made earlier in the same event. */
    latest: () => current.current,
    hasUnsavedChanges: () => unsaved.current,
    commit,
    flush,
    edit,
    reload,
  };
}
