/**
 * Search as you type. `SearchController` owns the timing: listing matches show at once, the
 * index (or, without it, a name scan) is asked 80 ms after the last keystroke, and a newer
 * request cancels the one in flight so stale results never replace fresh ones. `useSearch`
 * binds a controller to a component.
 */
import { useEffect, useRef, useState } from "react";
import {
  indexSearchable,
  type IndexClient,
  type IndexSearchResult,
} from "@moire/system-management/index-status";
import { scanNames } from "./fallback";
import type { SearchEntry, TagLookup } from "./filters";
import { parseQuery, toIndexQuery, type ParsedQuery } from "./query";
import { localResult, mergeLocal, presentResults, rankLocal, type SearchView } from "./results";
import { sameScope, scanRoot, scopePath, type SearchScope } from "./scope";

const SEARCH_DEBOUNCE_MS = 80;
/** Results fetched per kind: enough for a section and a little re-ranking room. */
const PER_GROUP = 12;

/** "names only" when the fallback scan answered: the UI says indexing is off or unavailable. */
export type SearchStatus = "idle" | "searching" | "indexed" | "names only";

export type SearchRequest = {
  text: string;
  scope: SearchScope;
  home: string;
  cwd: string;
  includeHidden: boolean;
  /** The current folder's listing, in display order; ranks type-to-select matches instantly. */
  entries?: readonly SearchEntry[];
};

export type SearchSnapshot = {
  status: SearchStatus;
  query: ParsedQuery | null;
  view: SearchView | null;
  /** Why results are names only, or what went wrong; null when the index answered. */
  notice: string | null;
};

export const IDLE_SEARCH: SearchSnapshot = {
  status: "idle",
  query: null,
  view: null,
  notice: null,
};

export type SearchDependencies = {
  client: IndexClient | null;
  tagsOf?: TagLookup;
  scan?: typeof scanNames;
  debounceMs?: number;
  now?: () => number;
};

function sameRequest(a: SearchRequest | null, b: SearchRequest | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.text === b.text &&
    sameScope(a.scope, b.scope) &&
    a.home === b.home &&
    a.cwd === b.cwd &&
    a.includeHidden === b.includeHidden &&
    a.entries === b.entries
  );
}

function fallbackNotice(client: IndexClient | null): string {
  if (client?.state.kind === "ready" && client.state.status.state === "disabled")
    return "Searching names only; indexing is off";
  return "Searching names only; the index is unavailable";
}

export class SearchController {
  private request: SearchRequest | null = null;
  private current: SearchSnapshot = IDLE_SEARCH;
  private timer: NodeJS.Timeout | null = null;
  private running: AbortController | null = null;
  private ticket = 0;
  private readonly listeners = new Set<(snapshot: SearchSnapshot) => void>();

  constructor(private readonly dependencies: SearchDependencies) {}

  get snapshot(): SearchSnapshot {
    return this.current;
  }

  subscribe(listener: (snapshot: SearchSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A new field value, scope or listing. Null or empty text ends the search. */
  update(request: SearchRequest | null): void {
    if (sameRequest(request, this.request)) return;
    this.request = request;
    this.cancel();
    const ticket = ++this.ticket;
    if (!request?.text.trim()) return this.publish(IDLE_SEARCH);
    const query = parseQuery(request.text);
    const local = this.local(request, query);
    this.publish({
      status: "searching",
      query,
      view: local ? presentResults(localResult(local, PER_GROUP)) : (this.current.view ?? null),
      notice: null,
    });
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(request, query, local, ticket);
    }, this.dependencies.debounceMs ?? SEARCH_DEBOUNCE_MS);
  }

  dispose(): void {
    this.cancel();
    this.ticket++;
    this.listeners.clear();
  }

  private cancel(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running?.abort();
    this.running = null;
  }

  /** Listing matches for "This folder" (and Home when it is the current folder). */
  private local(request: SearchRequest, query: ParsedQuery) {
    if (!request.entries || scopePath(request.scope, request.home) !== request.cwd) return null;
    return rankLocal(request.entries, query.words.join(" "), {
      query: toIndexQuery(query, request),
      now: (this.dependencies.now ?? Date.now)(),
      tagsOf: this.dependencies.tagsOf,
    });
  }

  private async run(
    request: SearchRequest,
    query: ParsedQuery,
    local: ReturnType<SearchController["local"]>,
    ticket: number,
  ): Promise<void> {
    const controller = new AbortController();
    this.running = controller;
    const { client, tagsOf } = this.dependencies;
    const indexQuery = toIndexQuery(query, request);
    const now = (this.dependencies.now ?? Date.now)();
    let result: IndexSearchResult | null = null;
    let notice: string | null = null;
    try {
      if (client && indexSearchable(client.state)) {
        try {
          result = await client.search(
            indexQuery,
            scopePath(request.scope, request.home),
            PER_GROUP,
            {
              signal: controller.signal,
            },
          );
        } catch (error) {
          if (controller.signal.aborted) return;
          notice = `Searching names only; ${error instanceof Error ? error.message : "the index failed"}`;
        }
      } else notice = fallbackNotice(client);
      if (!result)
        result = await (this.dependencies.scan ?? scanNames)(
          indexQuery,
          scanRoot(request.scope, request.home),
          {
            signal: controller.signal,
            perGroup: PER_GROUP,
            tagsOf,
            now,
          },
        );
    } catch (error) {
      if (controller.signal.aborted) return;
      notice = error instanceof Error ? error.message : "Search failed";
      result = null;
    } finally {
      if (this.running === controller) this.running = null;
    }
    if (ticket !== this.ticket) return;
    const merged = result && local ? mergeLocal(result, local, PER_GROUP) : result;
    this.publish({
      status: result?.source === "index" ? "indexed" : "names only",
      query,
      view: merged ? presentResults(merged) : null,
      notice,
    });
  }

  private publish(snapshot: SearchSnapshot): void {
    this.current = snapshot;
    for (const listener of this.listeners) listener(snapshot);
  }
}

/** Search state for a page; pass null to leave search. */
export function useSearch(
  request: SearchRequest | null,
  client: IndexClient | null,
  tagsOf?: TagLookup,
): SearchSnapshot {
  const [snapshot, setSnapshot] = useState<SearchSnapshot>(IDLE_SEARCH);
  const controller = useRef<SearchController | null>(null);
  const tags = useRef(tagsOf);
  tags.current = tagsOf;
  useEffect(() => {
    const next = new SearchController({ client, tagsOf: (file) => tags.current?.(file) ?? [] });
    controller.current = next;
    const unsubscribe = next.subscribe(setSnapshot);
    return () => {
      unsubscribe();
      next.dispose();
      controller.current = null;
    };
  }, [client]);
  useEffect(() => {
    controller.current?.update(request);
  });
  return snapshot;
}
