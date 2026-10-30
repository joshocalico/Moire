/**
 * Search without the index: a breadth-first walk of names under the scope, stopped at 2,000
 * entries or 300 ms, whichever comes first. It is cancellable and yields while it walks, so a
 * keystroke that supersedes it is never kept waiting.
 */
import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  SCORE,
  SKIPPED_FOLDER_NAMES,
  groupSearchHits,
  nameMatchScore,
  recencyBonus,
  type IndexQuery,
  type IndexSearchResult,
  type SearchHit,
} from "@moire/system-management/index-status";
import { hitFromEntry, passesFilters, type TagLookup } from "./filters";

const FALLBACK_MAX_ENTRIES = 2000;
const FALLBACK_BUDGET_MS = 300;
/** Entries between yields to the event loop. */
const YIELD_EVERY = 200;

export type ScanOptions = {
  signal?: AbortSignal;
  perGroup: number;
  maxEntries?: number;
  budgetMs?: number;
  tagsOf?: TagLookup;
  now?: number;
  /** For smokes: a clock that can be made slow. */
  clock?: () => number;
};

export async function scanNames(
  query: IndexQuery,
  root: string,
  options: ScanOptions,
): Promise<IndexSearchResult> {
  const maxEntries = options.maxEntries ?? FALLBACK_MAX_ENTRIES;
  const clock = options.clock ?? (() => performance.now());
  const deadline = clock() + (options.budgetMs ?? FALLBACK_BUDGET_MS);
  const now = options.now ?? Date.now();
  const hits: SearchHit[] = [];
  const queue = [root];
  let seen = 0;
  let truncated = false;
  walk: while (queue.length) {
    const dir = queue.shift()!;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Unreadable folders are skipped; the scan reports names it could see.
      continue;
    }
    for (const entry of entries) {
      options.signal?.throwIfAborted();
      if (seen >= maxEntries || clock() > deadline) {
        truncated = true;
        break walk;
      }
      if (++seen % YIELD_EVERY === 0) await nextTurn(undefined, { signal: options.signal });
      const file = path.join(dir, entry.name);
      const isDir = entry.isDirectory();
      const hidden = entry.name.startsWith(".");
      if (isDir && !SKIPPED_FOLDER_NAMES.has(entry.name) && (!hidden || query.includeHidden))
        queue.push(file);
      const nameScore = query.words.length ? nameMatchScore(entry.name, query.words) : SCORE.filter;
      if (!nameScore) continue;
      let size = 0;
      let modified = 0;
      try {
        // Only names that already match pay for a stat.
        const stat = await fs.lstat(file);
        size = stat.size;
        modified = stat.mtimeMs;
      } catch {
        continue;
      }
      const candidate = { name: entry.name, path: file, isDir, size, modified };
      if (!passesFilters(candidate, query, now, options.tagsOf)) continue;
      hits.push(
        hitFromEntry(
          candidate,
          query.words.length ? { kind: "name" } : { kind: "filter" },
          nameScore + recencyBonus(modified, now),
          options.tagsOf,
        ),
      );
    }
  }
  options.signal?.throwIfAborted();
  return groupSearchHits(hits, options.perGroup, "names", truncated);
}
