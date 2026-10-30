/**
 * A tab's search: the query model over this folder, Home, everywhere or a drive (with tag and
 * folder completions), and the field that drives it.
 */
import { useCallback } from "react";
import type { IndexClient } from "@moire/system-management/index-status";
import type { FileCatalog } from "#files/catalog";
import type { Entry } from "#files/filesystem";
import type { FolderTab } from "#files/navigation";
import type { FilePlace } from "#files/places";
import type { useWorkspaceCommands } from "#files/use-commands";
import { usePageSearch } from "./use-page-search";
import { useSearchField } from "./use-search-field";

export function useWorkspaceSearch(options: {
  tab: FolderTab;
  cwd: string;
  home: string;
  includeHidden: boolean;
  /** The folder's own listing, searched first; absent in Trash and on special pages. */
  entries: readonly Entry[] | undefined;
  entryKeys: readonly string[];
  selection: Parameters<typeof useSearchField>[0]["selection"];
  client: IndexClient | null;
  catalog: FileCatalog;
  catalogReady: boolean;
  places: readonly FilePlace[];
  commands: ReturnType<typeof useWorkspaceCommands>;
  updateTab(change: (tab: FolderTab) => FolderTab): void;
}) {
  const { catalog, commands } = options;
  const tagsOf = useCallback((file: string) => catalog.tags(file), [catalog]);
  const search = usePageSearch({
    tab: options.tab,
    cwd: options.cwd,
    home: options.home,
    includeHidden: options.includeHidden,
    entries: options.entries,
    client: options.client,
    tagsOf,
    drives: commands.volumes.flatMap((volume) =>
      volume.mount.kind === "mounted" ? [{ path: volume.mount.paths[0], label: volume.label }] : [],
    ),
    completion: {
      tags: options.catalogReady ? catalog.allTags() : [],
      folders: options.places.map((place) => place.path),
      home: options.home,
    },
  });
  const field = useSearchField({
    tabId: options.tab.id,
    search,
    updateTab: options.updateTab,
    entryKeys: options.entryKeys,
    selection: options.selection,
    open: commands.openItems,
    showInFolder: (items) => commands.handlers.showInFiles?.(items),
  });
  return { search, field };
}
