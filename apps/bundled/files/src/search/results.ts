/**
 * Results as Files shows them: a best match, then sections by kind with counts, "Show all"
 * tokens and a reason line per result. Index and fallback results arrive in the same shape.
 *
 * Search also does type-to-select: in "This folder", entries of the current listing whose names
 * start with the typed text rank first, in listing order, so the best match is the file
 * type-ahead would have picked. `rankLocal` computes that from the listing Files already holds,
 * so it is instant; `mergeLocal` lays it over whatever the index or the scan returns.
 */
import path from "node:path";
import { kindLabel, type FileKind } from "@moire/file-operations";
import {
  SCORE,
  compareHits,
  groupSearchHits,
  nameMatchScore,
  recencyBonus,
  type IndexQuery,
  type IndexSearchResult,
  type MatchReason,
  type SearchHit,
} from "@moire/system-management/index-status";
import { hitFromEntry, passesFilters, type SearchEntry, type TagLookup } from "./filters";

/** An order of magnitude above any index score, so a listing prefix match is always best. */
const LOCAL_PREFIX_SCORE = 10 * SCORE.exact;
/** Keeps listing order among prefix matches without letting it reach other scores. */
const LISTING_ORDER_STEP = 1e-4;
const RESULTS_PER_SECTION = 8;

export type LocalFilter = { query: IndexQuery; now: number; tagsOf?: TagLookup };

/**
 * Rank the current folder's entries for `text`. `entries` must be in listing order (folders
 * first, then the folder's sort), the order type-ahead walks.
 */
export function rankLocal(
  entries: readonly SearchEntry[],
  text: string,
  filter?: LocalFilter,
): SearchHit[] {
  const typed = text.trim().toLocaleLowerCase();
  if (!typed && !filter) return [];
  const words = typed.split(/\s+/).filter(Boolean);
  const now = filter?.now ?? Date.now();
  const hits: SearchHit[] = [];
  entries.forEach((entry, index) => {
    if (filter && !passesFilters(entry, filter.query, now, filter.tagsOf)) return;
    let score: number;
    if (!typed) score = SCORE.filter + recencyBonus(entry.modified, now);
    else if (entry.name.toLocaleLowerCase().startsWith(typed))
      score = LOCAL_PREFIX_SCORE - index * LISTING_ORDER_STEP;
    else {
      const nameScore = nameMatchScore(entry.name, words);
      if (!nameScore) return;
      score = nameScore + recencyBonus(entry.modified, now);
    }
    hits.push(
      hitFromEntry(entry, typed ? { kind: "name" } : { kind: "filter" }, score, filter?.tagsOf),
    );
  });
  return hits;
}

/** Lay the listing's own ranking over a search result; the listing wins ties on a path. */
export function mergeLocal(
  result: IndexSearchResult,
  local: readonly SearchHit[],
  perGroup: number,
): IndexSearchResult {
  const merged = new Map<string, SearchHit>();
  for (const hit of [
    ...(result.best ? [result.best] : []),
    ...result.groups.flatMap((group) => group.hits),
  ])
    merged.set(hit.path, hit);
  for (const hit of local) {
    const previous = merged.get(hit.path);
    if (!previous || previous.score <= hit.score)
      merged.set(hit.path, previous && !hit.tags.length ? { ...hit, tags: previous.tags } : hit);
  }
  const regrouped = groupSearchHits(
    [...merged.values()],
    perGroup,
    result.source,
    result.truncated,
  );
  // The result's totals count hits beyond its caps; never report fewer than it did.
  const remoteTotals = new Map(result.groups.map((group) => [group.kind, group.total]));
  return {
    ...regrouped,
    groups: regrouped.groups.map((group) => ({
      ...group,
      total: Math.max(group.total, remoteTotals.get(group.kind) ?? 0),
    })),
    total: Math.max(regrouped.total, result.total),
  };
}

/** Results from the listing alone, shown before the index or scan answers. */
export function localResult(local: readonly SearchHit[], perGroup: number): IndexSearchResult {
  return groupSearchHits(local, perGroup, "names", false);
}

// ---- Sections.

export type SectionId = "folders" | "images" | "documents" | "audio" | "other";
const SECTIONS: ReadonlyArray<{ id: SectionId; label: string; kinds: readonly FileKind[] }> = [
  { id: "folders", label: kindLabel("folder"), kinds: ["folder"] },
  { id: "images", label: kindLabel("image"), kinds: ["image"] },
  { id: "documents", label: kindLabel("document"), kinds: ["document"] },
  { id: "audio", label: kindLabel("audio"), kinds: ["audio"] },
  { id: "other", label: kindLabel("other"), kinds: ["video", "archive", "code", "font", "other"] },
];

export type ResultSection = {
  id: SectionId;
  label: string;
  total: number;
  hits: readonly SearchHit[];
  /** The token "Show all N" adds; null when the section spans several kinds. */
  showAll: { key: "kind"; value: FileKind } | null;
};

export type SearchView = {
  source: IndexSearchResult["source"];
  best: SearchHit | null;
  sections: readonly ResultSection[];
  total: number;
  truncated: boolean;
};

/** Sections in display order; the best match is shown above them, not repeated in its section. */
export function presentResults(
  result: IndexSearchResult,
  perSection = RESULTS_PER_SECTION,
): SearchView {
  const best = result.best;
  const sections = SECTIONS.flatMap((section): ResultSection[] => {
    const groups = result.groups.filter((group) => section.kinds.includes(group.kind));
    if (!groups.length) return [];
    const hits = groups
      .flatMap((group) => group.hits)
      .filter((hit) => hit.path !== best?.path)
      .sort(compareHits)
      .slice(0, perSection);
    const total = groups.reduce((sum, group) => sum + group.total, 0);
    if (!hits.length) return [];
    return [
      {
        id: section.id,
        label: section.label,
        total,
        hits,
        showAll: section.kinds.length === 1 ? { key: "kind", value: section.kinds[0]! } : null,
      },
    ];
  });
  return {
    source: result.source,
    best,
    sections,
    total: result.total,
    truncated: result.truncated,
  };
}

/** Why a result matched, as its secondary line says it. Empty when filters alone chose it. */
export function reasonLabel(reason: MatchReason): string {
  switch (reason.kind) {
    case "name":
      return "Name";
    case "folder":
      return `In ${path.basename(reason.folder)}`;
    case "tag":
      return `Tag: ${reason.tag}`;
    case "text":
      return `Text: …${reason.excerpt}…`;
    case "filter":
      return "";
  }
}
