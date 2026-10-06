/** Plain text is stored once; sparse, non-overlapping runs carry supported marks. */
export type DocumentMark = "bold" | "underline" | "highlight";
export type DocumentMarks = Readonly<Record<DocumentMark, boolean>>;
export type DocumentRun = { from: number; to: number; marks: DocumentMarks };
export type DocumentValue = { text: string; runs: readonly DocumentRun[] };
export type DocumentSelection = { anchor: number; focus: number };
export type DocumentEditState = {
  document: DocumentValue;
  selection: DocumentSelection;
  typingMarks: DocumentMarks;
};
export type DocumentHistory = {
  past: readonly DocumentEditState[];
  present: DocumentEditState;
  future: readonly DocumentEditState[];
};
export const PLAIN_DOCUMENT_MARKS: DocumentMarks = Object.freeze({
  bold: false,
  underline: false,
  highlight: false,
});
const marked = (marks: DocumentMarks) => marks.bold || marks.underline || marks.highlight;
export const equalDocumentMarks = (a: DocumentMarks, b: DocumentMarks) =>
  a.bold === b.bold && a.underline === b.underline && a.highlight === b.highlight;

/** Offsets use UTF-16, as native key text does; never leave a caret inside a surrogate pair. */
export function documentBoundary(text: string, offset: number): number {
  const bounded = Math.max(0, Math.min(text.length, Math.trunc(offset)));
  return bounded > 0 &&
    /[\uD800-\uDBFF]/u.test(text[bounded - 1]!) &&
    /[\uDC00-\uDFFF]/u.test(text[bounded] ?? "")
    ? bounded - 1
    : bounded;
}
export function previousDocumentCharacter(text: string, offset: number): number {
  return documentBoundary(text, Math.max(0, offset - 1));
}
export function nextDocumentCharacter(text: string, offset: number): number {
  return Math.min(
    text.length,
    offset +
      (/[\uD800-\uDBFF]/u.test(text[offset] ?? "") &&
      /[\uDC00-\uDFFF]/u.test(text[offset + 1] ?? "")
        ? 2
        : 1),
  );
}
export function documentRange(
  value: DocumentValue,
  selection: DocumentSelection,
): { from: number; to: number } {
  return {
    from: documentBoundary(value.text, Math.min(selection.anchor, selection.focus)),
    to: documentBoundary(value.text, Math.max(selection.anchor, selection.focus)),
  };
}
function compactRuns(runs: readonly DocumentRun[]): DocumentRun[] {
  const result: DocumentRun[] = [];
  for (const run of [...runs].sort((a, b) => a.from - b.from)) {
    if (run.from >= run.to || !marked(run.marks)) continue;
    const previous = result.at(-1);
    if (previous && previous.to === run.from && equalDocumentMarks(previous.marks, run.marks))
      previous.to = run.to;
    else result.push({ ...run, marks: { ...run.marks } });
  }
  return result;
}
export const plainDocument = (text: string): DocumentValue => ({ text, runs: [] });
export function equalDocuments(a: DocumentValue, b: DocumentValue): boolean {
  return (
    a.text === b.text &&
    a.runs.length === b.runs.length &&
    a.runs.every((run, index) => {
      const other = b.runs[index];
      return (
        other != null &&
        run.from === other.from &&
        run.to === other.to &&
        equalDocumentMarks(run.marks, other.marks)
      );
    })
  );
}

/** Validate persisted input at the storage boundary, including unsupported formatting. */
export function parseDocument(value: unknown): DocumentValue {
  if (
    typeof value !== "object" ||
    value === null ||
    !("text" in value) ||
    typeof value.text !== "string" ||
    !("runs" in value) ||
    !Array.isArray(value.runs)
  )
    throw new Error("Document text or formatting is invalid.");
  const runs: DocumentRun[] = [];
  let end = 0;
  for (const entry of value.runs) {
    const run: unknown = entry;
    if (
      typeof run !== "object" ||
      run === null ||
      !("from" in run) ||
      typeof run.from !== "number" ||
      !("to" in run) ||
      typeof run.to !== "number" ||
      !Number.isInteger(run.from) ||
      !Number.isInteger(run.to) ||
      run.from < end ||
      run.from >= run.to ||
      run.to > value.text.length ||
      documentBoundary(value.text, run.from) !== run.from ||
      documentBoundary(value.text, run.to) !== run.to ||
      !("marks" in run) ||
      typeof run.marks !== "object" ||
      run.marks === null ||
      !("bold" in run.marks) ||
      typeof run.marks.bold !== "boolean" ||
      !("underline" in run.marks) ||
      typeof run.marks.underline !== "boolean" ||
      !("highlight" in run.marks) ||
      typeof run.marks.highlight !== "boolean" ||
      Object.keys(run.marks).some(
        (mark) => mark !== "bold" && mark !== "underline" && mark !== "highlight",
      )
    )
      throw new Error("Document formatting has an invalid range or unsupported mark.");
    runs.push({
      from: run.from,
      to: run.to,
      marks: {
        bold: run.marks.bold,
        underline: run.marks.underline,
        highlight: run.marks.highlight,
      },
    });
    end = run.to;
  }
  return { text: value.text, runs: compactRuns(runs) };
}

/** Include unformatted gaps so layout and editing share one authoritative sequence. */
export function documentFragments(
  value: DocumentValue,
  from = 0,
  to = value.text.length,
): DocumentRun[] {
  const result: DocumentRun[] = [];
  let cursor = from;
  for (const run of value.runs) {
    if (run.to <= from || run.from >= to) continue;
    const start = Math.max(from, run.from),
      end = Math.min(to, run.to);
    if (start > cursor) result.push({ from: cursor, to: start, marks: PLAIN_DOCUMENT_MARKS });
    result.push({ from: start, to: end, marks: run.marks });
    cursor = end;
  }
  if (cursor < to) result.push({ from: cursor, to, marks: PLAIN_DOCUMENT_MARKS });
  return result;
}
export function documentMarksAt(value: DocumentValue, offset: number): DocumentMarks {
  const position =
    offset === value.text.length && offset > 0
      ? previousDocumentCharacter(value.text, offset)
      : offset;
  return (
    value.runs.find((run) => position >= run.from && position < run.to)?.marks ??
    PLAIN_DOCUMENT_MARKS
  );
}
export function selectionHasDocumentMark(
  value: DocumentValue,
  selection: DocumentSelection,
  mark: DocumentMark,
): boolean {
  const { from, to } = documentRange(value, selection);
  return from === to
    ? documentMarksAt(value, from)[mark]
    : documentFragments(value, from, to).every((run) => run.marks[mark]);
}
export function replaceDocumentRange(
  value: DocumentValue,
  selection: DocumentSelection,
  text: string,
  marks = documentMarksAt(value, documentRange(value, selection).from),
): DocumentValue {
  const { from, to } = documentRange(value, selection),
    delta = text.length - (to - from);
  const runs: DocumentRun[] = [];
  for (const run of value.runs) {
    if (run.from < from) runs.push({ ...run, to: Math.min(run.to, from) });
    if (run.to > to)
      runs.push({ ...run, from: Math.max(run.from, to) + delta, to: run.to + delta });
  }
  if (text.length) runs.push({ from, to: from + text.length, marks });
  return { text: value.text.slice(0, from) + text + value.text.slice(to), runs: compactRuns(runs) };
}
export function toggleDocumentMark(
  value: DocumentValue,
  selection: DocumentSelection,
  mark: DocumentMark,
): DocumentValue {
  const { from, to } = documentRange(value, selection);
  if (from === to) return value;
  const enabled = !selectionHasDocumentMark(value, selection, mark),
    runs: DocumentRun[] = [];
  for (const run of documentFragments(value)) {
    if (run.to <= from || run.from >= to) runs.push(run);
    else {
      if (run.from < from) runs.push({ ...run, to: from });
      runs.push({
        from: Math.max(run.from, from),
        to: Math.min(run.to, to),
        marks: { ...run.marks, [mark]: enabled },
      });
      if (run.to > to) runs.push({ ...run, from: to });
    }
  }
  return { text: value.text, runs: compactRuns(runs) };
}
export function createDocumentHistory(value: DocumentValue): DocumentHistory {
  return {
    past: [],
    present: {
      document: value,
      selection: { anchor: value.text.length, focus: value.text.length },
      typingMarks: documentMarksAt(value, value.text.length),
    },
    future: [],
  };
}
export function commitDocumentEdit(
  history: DocumentHistory,
  next: DocumentEditState,
): DocumentHistory {
  return equalDocuments(history.present.document, next.document)
    ? { ...history, present: next }
    : { past: [...history.past, history.present].slice(-100), present: next, future: [] };
}
export function undoDocumentEdit(history: DocumentHistory): DocumentHistory {
  const previous = history.past.at(-1);
  return previous
    ? {
        past: history.past.slice(0, -1),
        present: previous,
        future: [history.present, ...history.future],
      }
    : history;
}
export function redoDocumentEdit(history: DocumentHistory): DocumentHistory {
  const next = history.future[0];
  return next
    ? { past: [...history.past, history.present], present: next, future: history.future.slice(1) }
    : history;
}
