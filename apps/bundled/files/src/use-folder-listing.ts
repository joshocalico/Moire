/**
 * A tab's folder as the page shows it: listed, sorted, filtered by its kind chip, with the tab's
 * selection over it. Folders past the first eight hide behind "Show all" until asked for, or until
 * keyboard focus moves onto one of them.
 */
import { useEffect, useMemo, useState } from "react";
import type { TrashLocation } from "@moire/file-operations";
import { sortEntries, type FilesPreferences } from "./filesystem";
import { useFolderTabSelection, type FolderTab } from "./navigation";
import { filterByKind, kindChips } from "./search/kind-counts";
import { pathsOf } from "./use-commands";
import { useDirectory } from "./use-directory";

/** With more folders than this, only the first `FOLDERS_SHOWN` show until "Show all". */
const FOLDERS_COLLAPSE = 12;
const FOLDERS_SHOWN = 8;

export function useFolderListing(options: {
  tab: FolderTab;
  cwd: string;
  preferences: FilesPreferences;
  trash: TrashLocation;
  revision: number;
  blocked: string | null;
  updateTab(change: (tab: FolderTab) => FolderTab): void;
}) {
  const { tab, cwd, preferences } = options;
  const listing = useDirectory({
    cwd,
    hidden: preferences.hidden,
    trash: options.trash,
    revision: options.revision,
    blocked: options.blocked,
  });
  const sorted = useMemo(
    () => sortEntries(listing.entries, preferences.sort, preferences.descending),
    [listing.entries, preferences.sort, preferences.descending],
  );
  const chips = useMemo(() => kindChips(sorted), [sorted]);
  const kindFilter = chips.some((chip) => chip.filter === tab.kindFilter) ? tab.kindFilter : "all";
  const entries = useMemo(() => filterByKind(sorted, kindFilter), [sorted, kindFilter]);
  const entryKeys = useMemo(() => entries.map((entry) => entry.path), [entries]);
  const selection = useFolderTabSelection(tab, entryKeys, !listing.loading, options.updateTab);
  const selectedEntries = useMemo(
    () => entries.filter((entry) => selection.selectedKeys.has(entry.path)),
    [entries, selection.selectedKeys],
  );
  const [showAllFolders, setShowAllFolders] = useState(false);
  useEffect(() => setShowAllFolders(false), [cwd, tab.id]);
  const focusIndex = selection.focusKey ? entryKeys.indexOf(selection.focusKey) : -1;
  useEffect(() => {
    if (focusIndex >= 0 && entries[focusIndex]?.isDir && !showAllFolders) {
      const folders = entries.filter((entry) => entry.isDir);
      if (
        folders.indexOf(entries[focusIndex]!) >= FOLDERS_SHOWN &&
        folders.length > FOLDERS_COLLAPSE
      )
        setShowAllFolders(true);
    }
  }, [focusIndex, entries, showAllFolders]);
  return {
    listing,
    sorted,
    chips,
    kindFilter,
    entries,
    entryKeys,
    selection,
    selectedEntries,
    selectedPaths: pathsOf(selectedEntries),
    showAllFolders,
    setShowAllFolders,
  };
}
