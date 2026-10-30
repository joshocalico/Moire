/**
 * A tab's search: the field's text and scope live in the tab; this binds them to the search
 * controller with the folder's listing for instant type-to-select ranking, and tracks which
 * result the arrow keys have reached.
 */
import { useEffect, useMemo, useState } from "react";
import type { IndexClient, SearchHit } from "@moire/system-management/index-status";
import type { FolderTab } from "#files/navigation";
import type { SearchEntry, TagLookup } from "./filters";
import type { CompletionContext } from "./query";
import {
  defaultScope,
  scopeChoices,
  searchPlaceholder,
  widerScope,
  type MountedDrive,
  type SearchScope,
} from "./scope";
import { useSearch, type SearchRequest } from "./use-search";

export function usePageSearch(options: {
  tab: FolderTab;
  cwd: string;
  home: string;
  includeHidden: boolean;
  /** The folder's listing in display order; only "This folder" ranks it. */
  entries: readonly SearchEntry[] | undefined;
  client: IndexClient | null;
  tagsOf: TagLookup;
  drives: readonly MountedDrive[];
  completion: CompletionContext;
}) {
  const { tab, cwd, home } = options;
  const text = tab.query;
  const scope: SearchScope = tab.scope ?? defaultScope(cwd, home);
  const active = text.trim().length > 0;
  const request = useMemo<SearchRequest | null>(
    () =>
      active
        ? { text, scope, home, cwd, includeHidden: options.includeHidden, entries: options.entries }
        : null,
    [active, text, scope, home, cwd, options.includeHidden, options.entries],
  );
  const snapshot = useSearch(request, options.client, options.tagsOf);
  const view = active ? snapshot.view : null;
  const results = useMemo<SearchHit[]>(
    () =>
      view
        ? [...(view.best ? [view.best] : []), ...view.sections.flatMap((section) => section.hits)]
        : [],
    [view],
  );
  // The arrow keys' place among the results; a new result list starts again at the best match.
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => setHighlight(null), [view]);
  const highlighted =
    results.find((hit) => hit.path === highlight)?.path ?? results[0]?.path ?? null;
  const move = (delta: number) => {
    if (!results.length) return;
    const index = results.findIndex((hit) => hit.path === highlighted);
    const next = Math.max(0, Math.min(results.length - 1, index + delta));
    setHighlight(results[next]!.path);
  };
  return {
    text,
    active,
    scope,
    scopes: scopeChoices(cwd, home, options.drives),
    placeholder: searchPlaceholder(scope),
    view,
    searching: active && snapshot.status === "searching",
    notice: active ? snapshot.notice : null,
    results,
    highlighted,
    highlightedHit: results.find((hit) => hit.path === highlighted) ?? null,
    setHighlight,
    move,
    wider: widerScope(scope),
    completion: options.completion,
    total: view?.total ?? 0,
  };
}

export type PageSearch = ReturnType<typeof usePageSearch>;
