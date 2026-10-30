/**
 * The search vocabulary shared by the index service, its client and Files' name-only fallback:
 * the structured query, results with match reasons, and the ranking and grouping both sides use,
 * so a search reads the same whether the index answered it or a folder scan did.
 */
import path from "node:path";
import { FILE_KINDS, parseFileKind, type FileKind, type RecentFile } from "@moire/file-operations";

export type { RecentFile };

export type IndexWhen = "today" | "week" | "month" | "year";
export type IndexSize = { op: "<" | ">"; bytes: number };

/** Free words plus the filters the `kind:`, `when:`, `size:`, `tag:` and `in:` tokens set. */
export type IndexQuery = {
  /** Every word must match the name, a tag, an enclosing folder or the text. */
  words: readonly string[];
  /** Any of these kinds; empty means all kinds. */
  kinds: readonly FileKind[];
  when: IndexWhen | null;
  /** All bounds apply, so `size:>1mb size:<10mb` is a range. */
  sizes: readonly IndexSize[];
  /** Every tag must be present. */
  tags: readonly string[];
  /** Absolute folders; a result must be inside one of them. */
  within: readonly string[];
  includeHidden: boolean;
};

export const EMPTY_QUERY: IndexQuery = Object.freeze({
  words: [],
  kinds: [],
  when: null,
  sizes: [],
  tags: [],
  within: [],
  includeHidden: false,
});

export type TextHighlight = readonly [start: number, end: number];
export type MatchReason =
  | { kind: "name" }
  /** The words matched a folder above the result, not the result itself. */
  | { kind: "folder"; folder: string }
  | { kind: "tag"; tag: string }
  | { kind: "text"; excerpt: string; highlights: readonly TextHighlight[] }
  /** No words: the result is here only because it passes the filters. */
  | { kind: "filter" };

export type SearchHit = {
  path: string;
  name: string;
  kind: FileKind;
  isDir: boolean;
  size: number;
  modified: number;
  tags: readonly string[];
  reason: MatchReason;
  score: number;
};
export type SearchGroup = { kind: FileKind; total: number; hits: readonly SearchHit[] };
export type IndexSearchResult = {
  /** "names" when Files scanned folder names because the index was unavailable. */
  source: "index" | "names";
  best: SearchHit | null;
  /** In `FILE_KINDS` order; each group's hits are ranked and capped, `total` is not. */
  groups: readonly SearchGroup[];
  total: number;
  /** The candidate cap or scan budget was reached, so totals are lower bounds. */
  truncated: boolean;
};

export type KindCounts = {
  scope: string;
  total: number;
  kinds: Partial<Record<FileKind, number>>;
  /** Files at or above `LARGE_FILE_BYTES`, for the "Large files" chip. */
  large: number;
};

export type IndexState = "disabled" | "starting" | "crawling" | "ready" | "paused" | "error";
export type IndexStatus = {
  state: IndexState;
  message: string;
  revision: number;
  roots: readonly string[];
  files: number;
  folders: number;
  /** Files whose text is searchable, and files still waiting for extraction. */
  withText: number;
  pendingText: number;
  /** The current or last walk: folders read, entries seen and folders still queued. */
  crawl: { directories: number; entries: number; queued: number };
  /** How changes reach the index: a recursive watch, or only the periodic reconcile pass. */
  watching: "recursive" | "reconcile" | "off";
  lastCrawlAt: number | null;
};

export const LARGE_FILE_BYTES = 100 * 1024 * 1024;

/**
 * Folders that are dependencies, build output or version control: never what people look for.
 * The index skips them, and so does Files' name scan when there is no index.
 */
export const SKIPPED_FOLDER_NAMES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "target",
  "result",
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const WHEN_DAYS: Readonly<Record<Exclude<IndexWhen, "today">, number>> = {
  week: 7,
  month: 30,
  year: 365,
};

/** The earliest modification time `when` accepts; "today" starts at local midnight. */
export function whenCutoff(when: IndexWhen, now: number): number {
  if (when === "today") {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime();
  }
  return now - WHEN_DAYS[when] * DAY_MS;
}

export function sizeMatches(size: number, sizes: readonly IndexSize[]): boolean {
  return sizes.every((bound) => (bound.op === ">" ? size > bound.bytes : size < bound.bytes));
}

export function insideAny(file: string, folders: readonly string[]): boolean {
  return !folders.length || folders.some((folder) => isInside(file, folder));
}

/** Strictly below `folder`; the folder itself is not inside itself. */
export function isInside(file: string, folder: string): boolean {
  const base = folder.endsWith(path.sep) ? folder : folder + path.sep;
  return file.startsWith(base);
}

/** Case- and accent-insensitive comparison, the same folding SQLite's FTS applies. */
export function foldText(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Ranking weights: a name match outranks a tag, a tag a folder, a folder the file's text. */
export const SCORE = {
  exact: 100,
  prefix: 80,
  word: 60,
  substring: 40,
  tag: 35,
  folder: 25,
  text: 20,
  filter: 10,
  /** At most this much for being modified recently, decaying over `RECENCY_DECAY_DAYS`. */
  recency: 8,
} as const;
const RECENCY_DECAY_DAYS = 30;
/** Shorter names that match the same words rank a little higher. */
const NAME_LENGTH_BONUS = 5;

function wordScore(name: string, stem: string, word: string): number {
  if (stem === word) return SCORE.exact;
  if (name.startsWith(word)) return SCORE.prefix;
  const index = name.indexOf(word);
  if (index < 0) return 0;
  // A word boundary: "report" in "q3-report.pdf", not "port" in "report.pdf".
  for (let at = index; at >= 0; at = name.indexOf(word, at + 1))
    if (!/[\p{L}\p{N}]/u.test(name[at - 1] ?? "")) return SCORE.word;
  return SCORE.substring;
}

/** How well `name` matches every word, or 0 when one is missing. The weakest word decides. */
export function nameMatchScore(name: string, words: readonly string[]): number {
  if (!words.length) return 0;
  const folded = foldText(name);
  const extension = path.extname(folded);
  const stem = extension ? folded.slice(0, -extension.length) : folded;
  let weakest: number = SCORE.exact;
  let matched = 0;
  for (const word of words) {
    const score = wordScore(folded, stem, foldText(word));
    if (!score) return 0;
    weakest = Math.min(weakest, score);
    matched += word.length;
  }
  return weakest + NAME_LENGTH_BONUS * Math.min(1, matched / Math.max(1, stem.length));
}

export function recencyBonus(modified: number, now: number): number {
  const ageDays = Math.max(0, now - modified) / DAY_MS;
  return SCORE.recency * Math.exp(-ageDays / RECENCY_DECAY_DAYS);
}

/** Rank, best first; ties go to the newer file, then the shorter path, so order is stable. */
export function compareHits(a: SearchHit, b: SearchHit): number {
  return (
    b.score - a.score ||
    b.modified - a.modified ||
    a.path.length - b.path.length ||
    a.path.localeCompare(b.path)
  );
}

/** Group ranked hits by kind. `perGroup` caps each group's hits; totals count every hit. */
export function groupSearchHits(
  hits: readonly SearchHit[],
  perGroup: number,
  source: IndexSearchResult["source"],
  truncated: boolean,
): IndexSearchResult {
  const ranked = [...hits].sort(compareHits);
  const byKind = new Map<FileKind, SearchHit[]>();
  for (const hit of ranked) {
    const group = byKind.get(hit.kind) ?? [];
    group.push(hit);
    byKind.set(hit.kind, group);
  }
  const groups = FILE_KINDS.flatMap((kind) => {
    const group = byKind.get(kind);
    return group ? [{ kind, total: group.length, hits: group.slice(0, perGroup) }] : [];
  });
  return { source, best: ranked[0] ?? null, groups, total: ranked.length, truncated };
}

// ---- Wire validation. The service and its clients exchange JSON; parse it once at the edge.

const MAX_TEXT = 4096;
const MAX_WORDS = 32;
const MAX_LIST = 64;

function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Invalid ${what}`);
  return value as Record<string, unknown>;
}
function text(value: unknown, what: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error(`Invalid ${what}`);
  return value;
}
function count(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`Invalid ${what}`);
  return value;
}
function time(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Invalid ${what}`);
  return value;
}
function list<T>(value: unknown, what: string, item: (value: unknown) => T, max = MAX_LIST): T[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${what}`);
  return value.map(item);
}
function kind(value: unknown): FileKind {
  const parsed = parseFileKind(text(value, "kind", 32));
  if (!parsed || parsed !== value) throw new Error("Invalid kind");
  return parsed;
}
function absolute(value: unknown, what: string): string {
  const file = text(value, what);
  if (!path.isAbsolute(file)) throw new Error(`Invalid ${what}`);
  return file;
}
function nullableTime(value: unknown, what: string): number | null {
  return value === null ? null : time(value, what);
}

export function parseIndexQuery(value: unknown): IndexQuery {
  const raw = record(value, "query");
  const when = raw.when;
  if (when !== null && when !== "today" && when !== "week" && when !== "month" && when !== "year")
    throw new Error("Invalid when filter");
  return {
    words: list(raw.words, "words", (word) => text(word, "word", 256), MAX_WORDS).filter(Boolean),
    kinds: list(raw.kinds, "kinds", kind, FILE_KINDS.length),
    when,
    sizes: list(raw.sizes, "sizes", (item) => {
      const bound = record(item, "size");
      if (bound.op !== "<" && bound.op !== ">") throw new Error("Invalid size bound");
      return { op: bound.op, bytes: count(bound.bytes, "size") };
    }),
    tags: list(raw.tags, "tags", (tag) => text(tag, "tag", 64)),
    within: list(raw.within, "within", (folder) => absolute(folder, "folder")),
    includeHidden: raw.includeHidden === true,
  };
}

function parseReason(value: unknown): MatchReason {
  const raw = record(value, "match reason");
  switch (raw.kind) {
    case "name":
    case "filter":
      return { kind: raw.kind };
    case "folder":
      return { kind: "folder", folder: absolute(raw.folder, "folder") };
    case "tag":
      return { kind: "tag", tag: text(raw.tag, "tag", 64) };
    case "text": {
      const excerpt = text(raw.excerpt, "excerpt");
      const highlights = list(raw.highlights, "highlights", (item) => {
        const pair = list(item, "highlight", (offset) => count(offset, "highlight"), 2);
        const [start, end] = pair;
        if (start === undefined || end === undefined || start > end || end > excerpt.length)
          throw new Error("Invalid highlight");
        return [start, end] as const;
      });
      return { kind: "text", excerpt, highlights };
    }
    default:
      throw new Error("Invalid match reason");
  }
}

function parseHit(value: unknown): SearchHit {
  const raw = record(value, "search hit");
  if (typeof raw.isDir !== "boolean") throw new Error("Invalid search hit");
  return {
    path: absolute(raw.path, "path"),
    name: text(raw.name, "name", 1024),
    kind: kind(raw.kind),
    isDir: raw.isDir,
    size: count(raw.size, "size"),
    modified: time(raw.modified, "modified"),
    tags: list(raw.tags, "tags", (tag) => text(tag, "tag", 64)),
    reason: parseReason(raw.reason),
    score: time(raw.score, "score"),
  };
}

export function parseSearchResult(value: unknown): IndexSearchResult {
  const raw = record(value, "search result");
  if (raw.source !== "index" && raw.source !== "names") throw new Error("Invalid result source");
  if (typeof raw.truncated !== "boolean") throw new Error("Invalid search result");
  return {
    source: raw.source,
    best: raw.best === null ? null : parseHit(raw.best),
    groups: list(
      raw.groups,
      "groups",
      (item) => {
        const group = record(item, "group");
        return {
          kind: kind(group.kind),
          total: count(group.total, "total"),
          hits: list(group.hits, "hits", parseHit, 1000),
        };
      },
      FILE_KINDS.length,
    ),
    total: count(raw.total, "total"),
    truncated: raw.truncated,
  };
}

export function parseRecentFiles(value: unknown): RecentFile[] {
  return list(
    value,
    "recent files",
    (item) => {
      const raw = record(item, "recent file");
      if (raw.source !== "opened" && raw.source !== "modified")
        throw new Error("Invalid recent source");
      return {
        path: absolute(raw.path, "path"),
        name: text(raw.name, "name", 1024),
        kind: kind(raw.kind),
        size: count(raw.size, "size"),
        modified: time(raw.modified, "modified"),
        usedAt: time(raw.usedAt, "usedAt"),
        source: raw.source,
        app: raw.app === null ? null : text(raw.app, "app", 256),
      };
    },
    1000,
  );
}

export function parseKindCounts(value: unknown): KindCounts {
  const raw = record(value, "kind counts");
  const kinds: Partial<Record<FileKind, number>> = {};
  for (const [name, total] of Object.entries(record(raw.kinds, "kinds")))
    kinds[kind(name)] = count(total, "kind count");
  return {
    scope: text(raw.scope, "scope"),
    total: count(raw.total, "total"),
    kinds,
    large: count(raw.large, "large"),
  };
}

const STATES: readonly IndexState[] = [
  "disabled",
  "starting",
  "crawling",
  "ready",
  "paused",
  "error",
];

export function parseIndexStatus(value: unknown): IndexStatus {
  const raw = record(value, "index status");
  const crawl = record(raw.crawl, "crawl progress");
  if (!STATES.includes(raw.state as IndexState)) throw new Error("Invalid index state");
  if (raw.watching !== "recursive" && raw.watching !== "reconcile" && raw.watching !== "off")
    throw new Error("Invalid watch mode");
  return {
    state: raw.state as IndexState,
    message: text(raw.message, "message"),
    revision: count(raw.revision, "revision"),
    roots: list(raw.roots, "roots", (root) => absolute(root, "root")),
    files: count(raw.files, "files"),
    folders: count(raw.folders, "folders"),
    withText: count(raw.withText, "withText"),
    pendingText: count(raw.pendingText, "pendingText"),
    crawl: {
      directories: count(crawl.directories, "directories"),
      entries: count(crawl.entries, "entries"),
      queued: count(crawl.queued, "queued"),
    },
    watching: raw.watching,
    lastCrawlAt: nullableTime(raw.lastCrawlAt, "lastCrawlAt"),
  };
}
