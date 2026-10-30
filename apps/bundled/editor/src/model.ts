/** Editor state that is not the document itself: prompts, find/replace and cursor positions. */
import path from "node:path";
import type { TextRange } from "@moire/ui";

export const EDITOR_APP_ID = "org.moire.Editor";

/** What to do once unsaved changes are dealt with. */
export type Action = { kind: "new" } | { kind: "open"; path: string } | { kind: "close" };

/** At most one modal surface is open over the editor. */
export type Prompt =
  | { kind: "none" }
  | { kind: "choose-open" }
  | { kind: "choose-save"; after: Action | null }
  | { kind: "discard"; after: Action }
  | { kind: "overwrite"; path: string; after: Action | null }
  | { kind: "go-to-line"; input: string; error: string };

export type FindState = {
  /** Closed, finding only, or finding with the replace row. */
  mode: "closed" | "find" | "replace";
  query: string;
  replacement: string;
  matchCase: boolean;
};

export const closedFind: FindState = {
  mode: "closed",
  query: "",
  replacement: "",
  matchCase: false,
};

/** Upper bound on painted matches; counting stops here so huge files stay responsive. */
export const MAX_MATCHES = 10_000;

/** Every non-overlapping occurrence of `query`, in document order. */
export function findMatches(text: string, query: string, matchCase: boolean): TextRange[] {
  if (!query) return [];
  const haystack = matchCase ? text : text.toLowerCase();
  const needle = matchCase ? query : query.toLowerCase();
  const matches: TextRange[] = [];
  for (
    let at = haystack.indexOf(needle);
    at >= 0 && matches.length < MAX_MATCHES;
    at = haystack.indexOf(needle, at + needle.length)
  )
    matches.push({ from: at, to: at + needle.length });
  return matches;
}

/**
 * The match to move to from a selection: forward, the first starting at or after its end (so the
 * selected match is skipped); backward, the last ending at or before its start. Wraps around.
 */
export function stepMatch(
  matches: readonly TextRange[],
  selection: TextRange,
  direction: 1 | -1,
): number {
  if (!matches.length) return -1;
  if (direction === 1) {
    const next = matches.findIndex((match) => match.from >= selection.to);
    return next >= 0 ? next : 0;
  }
  for (let index = matches.length - 1; index >= 0; index--)
    if (matches[index]!.to <= selection.from) return index;
  return matches.length - 1;
}

/** The match the selection is exactly on, or -1. */
export function matchAt(matches: readonly TextRange[], selection: TextRange): number {
  return matches.findIndex((match) => match.from === selection.from && match.to === selection.to);
}

export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  matchCase: boolean,
): { text: string; count: number } {
  const matches = findMatches(text, query, matchCase);
  let result = "",
    last = 0;
  for (const match of matches) {
    result += text.slice(last, match.from) + replacement;
    last = match.to;
  }
  return { text: result + text.slice(last), count: matches.length };
}

/** 1-based line and column of an offset. */
export function cursorPosition(text: string, offset: number): { line: number; column: number } {
  let line = 1,
    start = 0;
  for (let at = text.indexOf("\n"); at >= 0 && at < offset; at = text.indexOf("\n", at + 1)) {
    line++;
    start = at + 1;
  }
  return { line, column: offset - start + 1 };
}

export function lineCount(text: string): number {
  let count = 1;
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) count++;
  return count;
}

/** The offset where a 1-based line starts, or an error a person can act on. */
export function lineOffset(text: string, input: string): number | { error: string } {
  const total = lineCount(text);
  const line = Number(input.trim());
  if (!/^\d+$/.test(input.trim()) || line < 1 || line > total)
    return { error: `Enter a line number from 1 to ${total}.` };
  let offset = 0;
  for (let current = 1; current < line; current++) offset = text.indexOf("\n", offset) + 1;
  return offset;
}

export function documentName(file: string | null): string {
  return file ? path.basename(file) : "Untitled";
}
