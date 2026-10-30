/** Filters and hits for entries Files already holds: a folder listing, or the fallback scan. */
import { fileKind } from "@moire/file-operations";
import {
  foldText,
  insideAny,
  sizeMatches,
  whenCutoff,
  type IndexQuery,
  type MatchReason,
  type SearchHit,
} from "@moire/system-management/index-status";

/** The fields search needs; Files' listing `Entry` has them. */
export type SearchEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modified: number;
};

/** Tags for a path, from Files' tag catalog; the index has its own copy. */
export type TagLookup = (file: string) => readonly string[];

/** Everything but the words: kind, when, size, tags, `in:` and hidden files. */
export function passesFilters(
  entry: SearchEntry,
  query: IndexQuery,
  now: number,
  tagsOf?: TagLookup,
): boolean {
  if (!query.includeHidden && entry.name.startsWith(".")) return false;
  if (query.kinds.length && !query.kinds.includes(fileKind(entry.name, entry.isDir))) return false;
  if (query.when && entry.modified < whenCutoff(query.when, now)) return false;
  if (query.sizes.length && (entry.isDir || !sizeMatches(entry.size, query.sizes))) return false;
  if (!insideAny(entry.path, query.within)) return false;
  if (query.tags.length) {
    const tags = (tagsOf?.(entry.path) ?? []).map(foldText);
    if (!query.tags.every((tag) => tags.includes(foldText(tag)))) return false;
  }
  return true;
}

export function hitFromEntry(
  entry: SearchEntry,
  reason: MatchReason,
  score: number,
  tagsOf?: TagLookup,
): SearchHit {
  return {
    path: entry.path,
    name: entry.name,
    kind: fileKind(entry.name, entry.isDir),
    isDir: entry.isDir,
    size: entry.isDir ? 0 : entry.size,
    modified: entry.modified,
    tags: tagsOf?.(entry.path) ?? [],
    reason,
    score,
  };
}
