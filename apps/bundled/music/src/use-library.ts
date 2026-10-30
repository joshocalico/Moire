/** The music library as loaded, with cancellable imports and their progress. */
import { useEffect, useRef, useState } from "react";
import { errorText } from "@moire/app-tools";
import { importMusic, type Library, type MusicLibraryStore, type Track } from "./library";
import { importSummary } from "./model";

export function useLibrary(store: MusicLibraryStore) {
  // Read once, before the first frame, so a saved library never flashes the empty state.
  const [initial] = useState(() => {
    try {
      return { library: store.load(), error: "" };
    } catch (error) {
      return { library: { tracks: [], revision: null } as Library, error: errorText(error) };
    }
  });
  const [library, setLibrary] = useState(initial.library);
  const [error, setError] = useState(initial.error);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef<AbortController | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      running.current?.abort();
    };
  }, []);
  const succeeded = (text: string) => {
    setError("");
    setMessage(text);
  };
  /** Imports files or folders; resolves to the imported tracks, or null if it failed or was cancelled. */
  const importPaths = async (values: readonly string[]): Promise<Track[] | null> => {
    if (running.current) return null;
    const controller = new AbortController();
    running.current = controller;
    setBusy(true);
    setError("");
    setMessage("Reading local music…");
    try {
      const result = await importMusic(values, store, controller.signal, (done, total) => {
        if (alive.current) setMessage(`Reading music ${done} of ${total}…`);
      });
      if (!alive.current) return null;
      setLibrary(result.library);
      succeeded(importSummary(result.imported.length, result.warnings));
      return result.imported;
    } catch (failure) {
      if (alive.current)
        if (controller.signal.aborted) setMessage("Import cancelled");
        else setError(errorText(failure));
      return null;
    } finally {
      if (running.current === controller) running.current = null;
      if (alive.current) setBusy(false);
    }
  };
  const reload = () => {
    try {
      setLibrary(store.load());
      succeeded("Library reloaded");
    } catch (failure) {
      setError(errorText(failure));
    }
  };
  /** Forgets a track; the audio file itself is never touched. */
  const remove = (track: Track): boolean => {
    try {
      const saved = store.save({
        ...library,
        tracks: library.tracks.filter((item) => item.id !== track.id),
      });
      setLibrary(saved);
      succeeded(
        saved.cleanup.kind === "pending"
          ? saved.cleanup.message
          : "Removed from the library. The original audio file remains in place.",
      );
      return true;
    } catch (failure) {
      setError(errorText(failure));
      return false;
    }
  };
  return {
    library,
    error,
    message,
    busy,
    importPaths,
    cancelImport: () => running.current?.abort(),
    reload,
    remove,
  };
}
