/**
 * What a page reads besides its own folder: Recent files and kind counts (Home and Recent), the
 * volume's free space (Home and drives), and the ancestor folders shown as columns.
 */
import { useMemo } from "react";
import type { IndexClient } from "@moire/system-management/index-status";
import type { FilesPreferences } from "./filesystem";
import type { PageKind } from "./model";
import { columnChain, useColumnListings } from "./use-columns";
import { useRecent } from "./use-recent";
import { useVolumeSpace } from "./use-volume";

export function usePageData(options: {
  client: IndexClient | null;
  home: string;
  cwd: string;
  kind: PageKind;
  preferences: FilesPreferences;
  /** Bumped by refresh; `listingRevision` also by finished operations and tag edits. */
  revision: number;
  listingRevision: number;
}) {
  const { home, cwd, kind, preferences } = options;
  const recent = useRecent(
    options.client,
    home,
    kind === "overview" || kind === "recent",
    options.revision,
  );
  const space = useVolumeSpace(cwd, kind === "overview" || kind === "drive", options.revision);
  const columnDirectories = useMemo(
    () => (preferences.view === "columns" ? columnChain(home, cwd).slice(0, -1) : []),
    [preferences.view, home, cwd],
  );
  const ancestorColumns = useColumnListings(columnDirectories, {
    hidden: preferences.hidden,
    sort: preferences.sort,
    descending: preferences.descending,
    revision: options.listingRevision,
  });
  return { recent: recent.recent, kindCounts: recent.kinds, space, ancestorColumns };
}
