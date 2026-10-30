/**
 * Search over the index. Each source (names, enclosing folders, tags, text) contributes ranked
 * candidates under the same filters; the best reason per file wins, and the shared grouping turns
 * them into the result Files shows. Every source is capped so a search stays a few milliseconds.
 */
import type { SQLInputValue } from "node:sqlite";
import { parseFileKind, type FileKind } from "@moire/file-operations";
import {
  LARGE_FILE_BYTES,
  SCORE,
  foldText,
  groupSearchHits,
  nameMatchScore,
  recencyBonus,
  whenCutoff,
  type IndexQuery,
  type IndexSearchResult,
  type KindCounts,
  type MatchReason,
  type SearchHit,
  type TextHighlight,
} from "@moire/system-management/index-status";
import { descendantRange, type IndexStore } from "./store";

/** Candidates read from each source before ranking. */
const CANDIDATE_LIMIT = 2000;
/** Folders whose names match, and files read below each, for "folder" matches. */
const FOLDER_LIMIT = 20;
const FILES_PER_FOLDER = 100;
/** Trigram matching needs three characters; shorter words fall back to a name scan. */
const TRIGRAM = 3;
/** Words of context on each side of a text match. */
const EXCERPT_TOKENS = 12;
const MARK_START = "\u0002";
const MARK_END = "\u0003";

type Filter = { sql: string; params: SQLInputValue[] };
type Row = Record<string, unknown>;

function filterFor(query: IndexQuery, scope: string, now: number): Filter {
  const clauses: string[] = [];
  const params: SQLInputValue[] = [];
  if (!query.includeHidden) clauses.push("f.hidden = 0");
  if (scope) {
    clauses.push("f.path >= ? AND f.path < ?");
    params.push(...descendantRange(scope));
  }
  if (query.within.length) {
    clauses.push(`(${query.within.map(() => "(f.path >= ? AND f.path < ?)").join(" OR ")})`);
    for (const folder of query.within) params.push(...descendantRange(folder));
  }
  if (query.kinds.length) {
    clauses.push(`f.kind IN (${query.kinds.map(() => "?").join(", ")})`);
    params.push(...query.kinds);
  }
  if (query.when) {
    clauses.push("f.mtime >= ?");
    params.push(whenCutoff(query.when, now));
  }
  for (const bound of query.sizes) {
    clauses.push(`f.is_dir = 0 AND f.size ${bound.op} ?`);
    params.push(bound.bytes);
  }
  for (const tag of query.tags) {
    clauses.push("EXISTS (SELECT 1 FROM tags t WHERE t.path = f.path AND t.folded = ?)");
    params.push(foldText(tag));
  }
  return { sql: clauses.length ? clauses.join(" AND ") : "1", params };
}

/** FTS5 phrase syntax: quote every word so operators and punctuation are taken literally. */
function phrase(word: string): string {
  return `"${word.replace(/"/g, '""')}"`;
}

function hitFrom(row: Row, reason: MatchReason, score: number): SearchHit {
  const isDir = row.is_dir === 1;
  return {
    path: String(row.path),
    name: String(row.name),
    kind: parseFileKind(String(row.kind)) ?? "other",
    isDir,
    size: Number(row.size),
    modified: Number(row.mtime),
    tags: [],
    reason,
    score,
  };
}

/** Turn FTS5 snippet markers into plain text plus highlight ranges. */
function excerptFrom(marked: string): { excerpt: string; highlights: TextHighlight[] } {
  let excerpt = "";
  const highlights: TextHighlight[] = [];
  let start = -1;
  for (const character of marked.replace(/\s+/g, " ").trim()) {
    if (character === MARK_START) start = excerpt.length;
    else if (character === MARK_END) {
      if (start >= 0) highlights.push([start, excerpt.length]);
      start = -1;
    } else excerpt += character;
  }
  return { excerpt, highlights };
}

class Candidates {
  readonly byPath = new Map<string, SearchHit>();
  truncated = false;

  offer(hit: SearchHit): void {
    const previous = this.byPath.get(hit.path);
    if (!previous || previous.score < hit.score) this.byPath.set(hit.path, hit);
  }

  read(rows: Row[], limit: number): Row[] {
    if (rows.length >= limit) this.truncated = true;
    return rows;
  }
}

function nameRows(
  store: IndexStore,
  words: readonly string[],
  where: string,
  params: SQLInputValue[],
  limit: number,
): Row[] {
  if (words.every((word) => [...word].length >= TRIGRAM))
    return store
      .prepare(
        `SELECT f.* FROM names JOIN files f ON f.id = names.rowid
         WHERE names MATCH ? AND ${where} LIMIT ?`,
      )
      .all(words.map(phrase).join(" AND "), ...params, limit);
  // SQLite's LIKE is case-insensitive for ASCII, which covers what one or two letters can say.
  const like = words.map((word) => `%${word.replace(/[\\%_]/g, "\\$&")}%`);
  return store
    .prepare(
      `SELECT f.* FROM files f WHERE ${like.map(() => "f.name LIKE ? ESCAPE '\\'").join(" AND ")}
       AND ${where} LIMIT ?`,
    )
    .all(...like, ...params, limit);
}

function searchNames(
  store: IndexStore,
  words: readonly string[],
  filter: Filter,
  candidates: Candidates,
  now: number,
): void {
  for (const row of candidates.read(
    nameRows(store, words, filter.sql, filter.params, CANDIDATE_LIMIT),
    CANDIDATE_LIMIT,
  )) {
    const score = nameMatchScore(String(row.name), words);
    if (score)
      candidates.offer(
        hitFrom(row, { kind: "name" }, score + recencyBonus(Number(row.mtime), now)),
      );
  }
}

/** Files below folders whose names match, for queries that name a project rather than a file. */
function searchFolders(
  store: IndexStore,
  query: IndexQuery,
  scope: string,
  filter: Filter,
  candidates: Candidates,
  now: number,
): void {
  const folderFilter = filterFor(
    { ...query, kinds: [], sizes: [], tags: [], when: null },
    scope,
    now,
  );
  const folders = nameRows(
    store,
    query.words,
    `f.is_dir = 1 AND ${folderFilter.sql}`,
    folderFilter.params,
    FOLDER_LIMIT * 4,
  )
    .map((row) => ({
      path: String(row.path),
      score: nameMatchScore(String(row.name), query.words),
    }))
    .filter((folder) => folder.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, FOLDER_LIMIT);
  const below = store.prepare(
    `SELECT f.* FROM files f WHERE f.path >= ? AND f.path < ? AND ${filter.sql}
     ORDER BY f.mtime DESC LIMIT ?`,
  );
  for (const folder of folders) {
    const rows = below.all(...descendantRange(folder.path), ...filter.params, FILES_PER_FOLDER);
    for (const row of candidates.read(rows, FILES_PER_FOLDER)) {
      const depth =
        String(row.path)
          .slice(folder.path.length + 1)
          .split("/").length - 1;
      const score = SCORE.folder - Math.min(depth, 5) + recencyBonus(Number(row.mtime), now);
      candidates.offer(hitFrom(row, { kind: "folder", folder: folder.path }, score));
    }
  }
}

/** Files carrying a tag that starts with each word. */
function searchTags(
  store: IndexStore,
  words: readonly string[],
  filter: Filter,
  candidates: Candidates,
  now: number,
): void {
  let matched: Map<string, string> | null = null;
  const byPrefix = store.prepare("SELECT path, tag FROM tags WHERE folded >= ? AND folded < ?");
  for (const word of words) {
    const folded = foldText(word);
    const upper =
      folded.slice(0, -1) + String.fromCodePoint(folded.codePointAt(folded.length - 1)! + 1);
    const next = new Map<string, string>();
    for (const row of byPrefix.all(folded, upper)) {
      const file = String(row.path);
      if (!matched || matched.has(file)) next.set(file, matched?.get(file) ?? String(row.tag));
    }
    matched = next;
    if (!matched.size) return;
  }
  const one = store.prepare(`SELECT f.* FROM files f WHERE f.path = ? AND ${filter.sql}`);
  for (const [file, tag] of [...(matched ?? [])].slice(0, CANDIDATE_LIMIT)) {
    const row = one.get(file, ...filter.params);
    if (row)
      candidates.offer(
        hitFrom(row, { kind: "tag", tag }, SCORE.tag + recencyBonus(Number(row.mtime), now)),
      );
  }
}

function searchText(
  store: IndexStore,
  words: readonly string[],
  filter: Filter,
  candidates: Candidates,
  now: number,
): void {
  const searchable = words.filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (searchable.length !== words.length) return;
  const rows = store
    .prepare(
      `SELECT f.*, snippet(content, 0, char(2), char(3), '…', ${EXCERPT_TOKENS}) AS excerpt,
              bm25(content) AS relevance
       FROM content JOIN files f ON f.id = content.rowid
       WHERE content MATCH ? AND ${filter.sql}
       ORDER BY relevance LIMIT ?`,
    )
    .all(
      searchable.map((word) => `${phrase(word)}*`).join(" AND "),
      ...filter.params,
      CANDIDATE_LIMIT,
    );
  for (const row of candidates.read(rows, CANDIDATE_LIMIT)) {
    // bm25 is negative, more negative for better matches; a strong match adds up to 5.
    const relevance = Math.min(5, Math.max(0, -Number(row.relevance)));
    candidates.offer(
      hitFrom(
        row,
        { kind: "text", ...excerptFrom(String(row.excerpt)) },
        SCORE.text + relevance + recencyBonus(Number(row.mtime), now),
      ),
    );
  }
}

export function searchIndex(
  store: IndexStore,
  query: IndexQuery,
  scope: string,
  perGroup: number,
  now = Date.now(),
): IndexSearchResult {
  const filter = filterFor(query, scope, now);
  const candidates = new Candidates();
  if (!query.words.length) {
    const rows = store
      .prepare(`SELECT f.* FROM files f WHERE ${filter.sql} ORDER BY f.mtime DESC LIMIT ?`)
      .all(...filter.params, CANDIDATE_LIMIT);
    for (const row of candidates.read(rows, CANDIDATE_LIMIT))
      candidates.offer(
        hitFrom(row, { kind: "filter" }, SCORE.filter + recencyBonus(Number(row.mtime), now)),
      );
  } else {
    searchNames(store, query.words, filter, candidates, now);
    searchFolders(store, query, scope, filter, candidates, now);
    searchTags(store, query.words, filter, candidates, now);
    searchText(store, query.words, filter, candidates, now);
  }
  const result = groupSearchHits(
    [...candidates.byPath.values()],
    perGroup,
    "index",
    candidates.truncated,
  );
  const tagsOf = store.prepare("SELECT tag FROM tags WHERE path = ? ORDER BY tag");
  const shown = new Set([
    ...(result.best ? [result.best] : []),
    ...result.groups.flatMap((group) => group.hits),
  ]);
  for (const hit of shown) hit.tags = tagsOf.all(hit.path).map((row) => String(row.tag));
  return result;
}

export function countKinds(store: IndexStore, scope: string): KindCounts {
  const range = scope ? "AND path >= ? AND path < ?" : "";
  const params = scope ? descendantRange(scope) : [];
  const kinds: Partial<Record<FileKind, number>> = {};
  let total = 0;
  for (const row of store
    .prepare(`SELECT kind, COUNT(*) AS n FROM files WHERE hidden = 0 ${range} GROUP BY kind`)
    .all(...params)) {
    const kind = parseFileKind(String(row.kind));
    if (!kind) continue;
    kinds[kind] = Number(row.n);
    total += Number(row.n);
  }
  const large = store
    .prepare(
      `SELECT COUNT(*) AS n FROM files WHERE hidden = 0 AND is_dir = 0 AND size >= ? ${range}`,
    )
    .get(LARGE_FILE_BYTES, ...params);
  return { scope, total, kinds, large: Number(large?.n ?? 0) };
}
