/**
 * The search field's language: free words plus `kind:`, `when:`, `size:`, `tag:` and `in:`
 * tokens. Parsing keeps each part's span so the field can draw tokens as chips; serializing
 * writes the canonical text back, and completions offer values for a token being typed.
 */
import path from "node:path";
import { FILE_KINDS, kindLabel, parseFileKind, type FileKind } from "@moire/file-operations";
import {
  LARGE_FILE_BYTES,
  type IndexQuery,
  type IndexSize,
  type IndexWhen,
} from "@moire/system-management/index-status";

export type QueryKey = "kind" | "when" | "size" | "tag" | "in";
const QUERY_KEYS: readonly QueryKey[] = ["kind", "when", "size", "tag", "in"];
const WHEN_VALUES: readonly IndexWhen[] = ["today", "week", "month", "year"];

/** One piece of the field, with its span in the text. Invalid tokens are kept but ignored. */
export type QueryPart =
  | { type: "word"; text: string; start: number; end: number }
  | { type: "token"; key: QueryKey; value: string; valid: boolean; start: number; end: number };

/** What the text asks for; `within` keeps folders as typed (`~/Work`), resolved later. */
export type SearchQuery = {
  words: readonly string[];
  kinds: readonly FileKind[];
  when: IndexWhen | null;
  sizes: readonly IndexSize[];
  tags: readonly string[];
  within: readonly string[];
};

export type ParsedQuery = SearchQuery & { parts: readonly QueryPart[] };

const UNITS: Readonly<Record<string, number>> = {
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
};
/** Written back largest-first, so `size:>10mb` round-trips as itself. */
const SERIALIZED_UNITS: ReadonlyArray<readonly [string, number]> = [
  ["tb", 1024 ** 4],
  ["gb", 1024 ** 3],
  ["mb", 1024 ** 2],
  ["kb", 1024],
  ["b", 1],
];
/** `size:large` is the "Large files" chip: the same threshold the index counts. */
const LARGE = "large";

/** `>10mb`, `<1.5gb`, `100k` (a bare size means larger than), or `large`. */
export function parseSize(value: string): IndexSize | null {
  if (value.toLowerCase() === LARGE) return { op: ">", bytes: LARGE_FILE_BYTES };
  const match = /^([<>])?(\d+(?:\.\d+)?)(b|kb?|mb?|gb?|tb?)?$/i.exec(value.trim());
  if (!match) return null;
  const bytes = Math.round(Number(match[2]) * UNITS[(match[3] ?? "b").toLowerCase()]!);
  return Number.isSafeInteger(bytes)
    ? { op: (match[1] as "<" | ">" | undefined) ?? ">", bytes }
    : null;
}

function formatSize(size: IndexSize): string {
  const [unit, factor] = SERIALIZED_UNITS.find(([, factor]) => size.bytes % factor === 0) ?? [
    "b",
    1,
  ];
  return `${size.op}${size.bytes / factor}${unit}`;
}

function tokenKey(text: string): QueryKey | null {
  const key = text.toLowerCase();
  return (QUERY_KEYS as readonly string[]).includes(key) ? (key as QueryKey) : null;
}

function validValue(key: QueryKey, value: string): boolean {
  if (!value) return false;
  if (key === "kind") return parseFileKind(value) !== null;
  if (key === "when") return (WHEN_VALUES as readonly string[]).includes(value.toLowerCase());
  if (key === "size") return parseSize(value) !== null;
  return true;
}

/** Split into words and tokens. Quoted text is always a word, so `"kind:image"` stays literal. */
export function tokenize(text: string): QueryPart[] {
  const parts: QueryPart[] = [];
  let at = 0;
  while (at < text.length) {
    if (/\s/.test(text[at]!)) {
      at++;
      continue;
    }
    const start = at;
    if (text[at] === '"') {
      const close = text.indexOf('"', at + 1);
      const end = close < 0 ? text.length : close + 1;
      const word = text.slice(at + 1, close < 0 ? text.length : close);
      if (word) parts.push({ type: "word", text: word, start, end });
      at = end;
      continue;
    }
    const keyMatch = /^([a-z]+):/i.exec(text.slice(at));
    const key = keyMatch ? tokenKey(keyMatch[1]!) : null;
    if (key && keyMatch) {
      at += keyMatch[0].length;
      let value: string;
      if (text[at] === '"') {
        const close = text.indexOf('"', at + 1);
        value = text.slice(at + 1, close < 0 ? text.length : close);
        at = close < 0 ? text.length : close + 1;
      } else {
        const end = text.slice(at).search(/\s/);
        value = text.slice(at, end < 0 ? text.length : at + end);
        at += value.length;
      }
      parts.push({ type: "token", key, value, valid: validValue(key, value), start, end: at });
      continue;
    }
    const end = text.slice(at).search(/\s/);
    at = end < 0 ? text.length : at + end;
    parts.push({ type: "word", text: text.slice(start, at), start, end: at });
  }
  return parts;
}

export function parseQuery(text: string): ParsedQuery {
  const parts = tokenize(text);
  const words: string[] = [];
  const kinds: FileKind[] = [];
  const sizes: IndexSize[] = [];
  const tags: string[] = [];
  const within: string[] = [];
  let when: IndexWhen | null = null;
  for (const part of parts) {
    if (part.type === "word") words.push(part.text);
    else if (!part.valid) continue;
    else if (part.key === "kind") {
      const kind = parseFileKind(part.value)!;
      if (!kinds.includes(kind)) kinds.push(kind);
    } else if (part.key === "when") when = part.value.toLowerCase() as IndexWhen;
    else if (part.key === "size") sizes.push(parseSize(part.value)!);
    else if (part.key === "tag") tags.push(part.value);
    else within.push(part.value);
  }
  return { parts, words, kinds, when, sizes, tags, within };
}

function quote(value: string): string {
  // The language has no escape for a quote, so one inside a value cannot survive; drop it.
  const plain = value.replace(/"/g, "");
  return /\s/.test(plain) || /^[a-z]+:/i.test(plain) || !plain ? `"${plain}"` : plain;
}

/** Canonical text: words, then tokens in key order. `parseQuery` reads it back unchanged. */
export function serializeQuery(query: SearchQuery): string {
  return [
    ...query.words.map(quote),
    ...query.kinds.map((kind) => `kind:${kind}`),
    ...(query.when ? [`when:${query.when}`] : []),
    ...query.sizes.map((size) => `size:${formatSize(size)}`),
    ...query.tags.map((tag) => `tag:${quote(tag)}`),
    ...query.within.map((folder) => `in:${quote(folder)}`),
  ].join(" ");
}

/** Add a token (from a kind chip or "Show all") unless the query already has it. */
export function withToken(text: string, key: QueryKey, value: string): string {
  const parsed = parseQuery(text);
  const present = parsed.parts.some(
    (part) =>
      part.type === "token" && part.key === key && part.value.toLowerCase() === value.toLowerCase(),
  );
  if (present) return text;
  return `${text.trimEnd()}${text.trim() ? " " : ""}${key}:${quote(value)}`;
}

/** Remove the part at `index` (Backspace on a chip), tidying the space it leaves. */
export function withoutPart(text: string, index: number): string {
  const part = tokenize(text)[index];
  if (!part) return text;
  return `${text.slice(0, part.start)}${text.slice(part.end)}`.replace(/\s{2,}/g, " ").trim();
}

export type ResolveContext = { home: string; cwd: string; includeHidden: boolean };

/** `in:` folders resolve against the current folder, with `~` for Home. */
function resolveFolder(folder: string, context: Pick<ResolveContext, "home" | "cwd">): string {
  if (folder === "~") return context.home;
  if (folder.startsWith("~/")) return path.join(context.home, folder.slice(2));
  return path.resolve(context.cwd, folder);
}

export function toIndexQuery(query: SearchQuery, context: ResolveContext): IndexQuery {
  return {
    words: query.words,
    kinds: query.kinds,
    when: query.when,
    sizes: query.sizes,
    tags: query.tags,
    within: query.within.map((folder) => resolveFolder(folder, context)),
    includeHidden: context.includeHidden,
  };
}

// ---- Completions for the token under the caret.

export type Completion = { label: string; insert: string; detail: string };
/** Replace `text.slice(start, end)` with an item's `insert`. */
export type CompletionSet = { start: number; end: number; items: readonly Completion[] };
export type CompletionContext = {
  /** Known tags, for `tag:`. */
  tags?: readonly string[];
  /** Folders to offer for `in:`, typically bookmarks and recent folders. */
  folders?: readonly string[];
  /** Folders under Home are offered as `~/…`. */
  home?: string;
};

const KEY_DETAILS: Readonly<Record<QueryKey, string>> = {
  kind: "Images, documents, audio…",
  when: "Modified today, this week…",
  size: "Larger or smaller than",
  tag: "Tagged with",
  in: "Inside a folder",
};
const WHEN_DETAILS: Readonly<Record<IndexWhen, string>> = {
  today: "Modified today",
  week: "In the last 7 days",
  month: "In the last 30 days",
  year: "In the last year",
};
const SIZE_SUGGESTIONS: ReadonlyArray<readonly [string, string]> = [
  [">10mb", "Larger than 10 MB"],
  [">100mb", "Larger than 100 MB"],
  [">1gb", "Larger than 1 GB"],
  ["<1mb", "Smaller than 1 MB"],
];
const MAX_COMPLETIONS = 8;

function startsWith(value: string, prefix: string): boolean {
  return value.toLowerCase().startsWith(prefix.toLowerCase());
}

/** Values to offer after `key:` for what has been typed so far. */
function valueCompletions(key: QueryKey, typed: string, context: CompletionContext): Completion[] {
  const value = (insert: string, label: string, detail: string) => ({
    label,
    insert: `${key}:${quote(insert)} `,
    detail,
  });
  switch (key) {
    case "kind":
      return FILE_KINDS.filter((kind) => startsWith(kind, typed)).map((kind) =>
        value(kind, kind, kindLabel(kind)),
      );
    case "when":
      return WHEN_VALUES.filter((when) => startsWith(when, typed)).map((when) =>
        value(when, when, WHEN_DETAILS[when]),
      );
    case "size":
      return SIZE_SUGGESTIONS.filter(([size]) => startsWith(size, typed)).map(([size, detail]) =>
        value(size, size, detail),
      );
    case "tag":
      return (context.tags ?? [])
        .filter((tag) => startsWith(tag, typed))
        .map((tag) => value(tag, tag, "Tag"));
    case "in":
      return (context.folders ?? [])
        .map((folder) =>
          context.home && folder.startsWith(context.home + path.sep)
            ? `~${folder.slice(context.home.length)}`
            : folder,
        )
        .filter((folder) => startsWith(folder, typed) || startsWith(path.basename(folder), typed))
        .map((folder) => value(folder, folder, "Folder"));
  }
}

/**
 * Completions for the part ending at `caret`: token names while typing a word (`ki` → `kind:`),
 * values while typing a token (`kind:im` → `kind:image`). Null when there is nothing to offer.
 */
export function completeQuery(
  text: string,
  caret: number,
  context: CompletionContext = {},
): CompletionSet | null {
  const part = tokenize(text).find((item) => item.start < caret && caret <= item.end);
  if (!part) return null;
  let items: Completion[];
  if (part.type === "token") {
    const typed = text
      .slice(part.start, caret)
      .slice(part.key.length + 1)
      .replace(/^"/, "");
    items = valueCompletions(part.key, typed, context).filter(
      (item) => item.insert.trimEnd() !== text.slice(part.start, part.end),
    );
  } else {
    if (text[part.start] === '"') return null;
    const typed = text.slice(part.start, caret);
    items = QUERY_KEYS.filter((key) => startsWith(key, typed)).map((key) => ({
      label: `${key}:`,
      insert: `${key}:`,
      detail: KEY_DETAILS[key],
    }));
  }
  return items.length
    ? { start: part.start, end: part.end, items: items.slice(0, MAX_COMPLETIONS) }
    : null;
}

export function applyCompletion(
  text: string,
  set: CompletionSet,
  item: Completion,
): { text: string; caret: number } {
  const after = text.slice(set.end);
  const insert = after.startsWith(" ") ? item.insert.trimEnd() : item.insert;
  return { text: text.slice(0, set.start) + insert + after, caret: set.start + insert.length };
}
