/** The listing for a tab's location: a folder or Trash, kept current as it changes. */
import fs from "node:fs";
import { useEffect, useState } from "react";
import { operationError, type TrashLocation } from "@moire/file-operations";
import { readDirectory, readTrash, type Entry } from "./filesystem";

type Listing = {
  path: string;
  entries: Entry[];
  error: string | null;
  loading: boolean;
};

export type DirectoryState = {
  entries: Entry[];
  error: string | null;
  loading: boolean;
};

export function useDirectory(options: {
  cwd: string;
  hidden: boolean;
  trash: TrashLocation;
  /** Bumped by the caller to force a re-read (refresh, finished operations). */
  revision: number;
  /** A reason the location cannot be read (its drive went away). */
  blocked: string | null;
}): DirectoryState {
  const { cwd, hidden, trash, revision, blocked } = options;
  const [changes, setChanges] = useState(0);
  const [listing, setListing] = useState<Listing>({
    path: cwd,
    entries: [],
    error: null,
    loading: true,
  });

  // Watch the folder itself so external changes appear without a manual refresh.
  useEffect(() => {
    if (blocked) return;
    let watcher: fs.FSWatcher | null = null;
    try {
      watcher = fs.watch(cwd === trash.files ? trash.files : cwd, () =>
        setChanges((value) => value + 1),
      );
    } catch {
      // Unwatchable folders still refresh after operations and on request.
    }
    return () => watcher?.close();
  }, [cwd, blocked, trash.files]);

  useEffect(() => {
    let alive = true;
    if (blocked) {
      setListing({ path: cwd, entries: [], error: blocked, loading: false });
      return;
    }
    // Keep the previous rows while re-reading the same location, so a refresh never flashes empty.
    setListing((current) => ({
      path: cwd,
      entries: current.path === cwd ? current.entries : [],
      error: null,
      loading: true,
    }));
    const read = cwd === trash.files ? readTrash(trash) : readDirectory(cwd, hidden);
    void read.then(
      (entries) => {
        if (alive) setListing({ path: cwd, entries, error: null, loading: false });
      },
      (error) => {
        if (alive)
          setListing({ path: cwd, entries: [], error: operationError(error), loading: false });
      },
    );
    return () => {
      alive = false;
    };
  }, [cwd, hidden, trash, revision, changes, blocked]);

  const current = listing.path === cwd;
  return {
    entries: current ? listing.entries : [],
    error: current ? listing.error : null,
    loading: !current || listing.loading,
  };
}
