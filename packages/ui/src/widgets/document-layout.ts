import {
  documentFragments,
  equalDocumentMarks,
  type DocumentValue,
  type DocumentMarks,
  type DocumentSelection,
} from "./document-model";

export type DocumentRect = { x: number; y: number; width: number; height: number };
export type DocumentFragment = {
  from: number;
  to: number;
  text: string;
  marks: DocumentMarks;
  x: number;
  width: number;
};
export type DocumentLine = {
  from: number;
  to: number;
  end: number;
  y: number;
  fragments: DocumentFragment[];
  boundaries: Array<{ offset: number; x: number }>;
};
export type DocumentLayout = { lines: DocumentLine[]; lineHeight: number; height: number };
type Glyph = { from: number; to: number; text: string; marks: DocumentMarks };
type Measure = (text: string, marks: DocumentMarks) => number;

/** Append only one measured styled prefix per glyph; flushed lines reuse its boundaries. */
class PendingLine {
  readonly glyphs: Glyph[] = [];
  readonly fragments: DocumentFragment[] = [];
  readonly boundaries: Array<{ offset: number; x: number }>;
  lastSpace = -1;
  constructor(
    readonly from: number,
    readonly measure: Measure,
  ) {
    this.boundaries = [{ offset: from, x: 0 }];
  }
  candidate(glyph: Glyph): { text: string; width: number; x: number; same: boolean } {
    const previous = this.fragments.at(-1);
    const same = !!previous && equalDocumentMarks(previous.marks, glyph.marks);
    const text = same ? previous.text + glyph.text : glyph.text;
    const x = same ? previous.x : previous ? previous.x + previous.width : 0;
    return { same, text, x, width: this.measure(text, glyph.marks) };
  }
  append(glyph: Glyph, candidate = this.candidate(glyph)): void {
    const previous = this.fragments.at(-1);
    if (candidate.same && previous) {
      previous.text = candidate.text;
      previous.to = glyph.to;
      previous.width = candidate.width;
    } else this.fragments.push({ ...glyph, x: candidate.x, width: candidate.width });
    if (glyph.text === " " || glyph.text === "\t") this.lastSpace = this.glyphs.length;
    this.glyphs.push(glyph);
    this.boundaries.push({ offset: glyph.to, x: candidate.x + candidate.width });
  }
  snapshot(to: number, end: number, y: number, count = this.glyphs.length): DocumentLine {
    const boundary = this.boundaries[count]!;
    const fragments = this.fragments
      .filter((fragment) => fragment.from < to)
      .map((fragment) =>
        fragment.to <= to
          ? { ...fragment }
          : {
              ...fragment,
              to,
              text: fragment.text.slice(0, to - fragment.from),
              width: boundary.x - fragment.x,
            },
      );
    return {
      from: this.from,
      to,
      end,
      y,
      fragments,
      boundaries: this.boundaries.slice(0, count + 1),
    };
  }
}
/** The same measured styled fragments determine drawing, wrapping, caret and selection. */
export function layoutDocument(
  value: DocumentValue,
  width: number,
  lineHeight: number,
  measure: Measure,
): DocumentLayout {
  // Repeated paragraphs reuse exact prefix metrics without sacrificing kerning or styled boundaries.
  const metrics = new Map<string, number>();
  const measured: Measure = (text, marks) => {
    const key = `${Number(marks.bold)}${Number(marks.underline)}${Number(marks.highlight)}:${text}`;
    const previous = metrics.get(key);
    if (previous !== undefined) return previous;
    const result = measure(text, marks);
    metrics.set(key, result);
    return result;
  };
  const lines: DocumentLine[] = [];
  let pending = new PendingLine(0, measured);
  const flush = (to: number, end = to, count = pending.glyphs.length) => {
    lines.push(pending.snapshot(to, end, lines.length * lineHeight, count));
  };
  for (const run of documentFragments(value)) {
    let offset = run.from;
    for (const character of value.text.slice(run.from, run.to)) {
      const glyph = {
        from: offset,
        to: offset + character.length,
        text: character,
        marks: run.marks,
      };
      offset = glyph.to;
      if (character === "\n") {
        flush(glyph.from, glyph.to);
        pending = new PendingLine(glyph.to, measured);
        continue;
      }
      let candidate = pending.candidate(glyph);
      while (pending.glyphs.length > 0 && candidate.x + candidate.width > Math.max(1, width)) {
        const split = pending.lastSpace >= 0 ? pending.lastSpace + 1 : pending.glyphs.length;
        const carry = pending.glyphs.slice(split),
          end = carry[0]?.from ?? glyph.from;
        flush(end, end, split);
        pending = new PendingLine(end, measured);
        for (const carried of carry) pending.append(carried);
        candidate = pending.candidate(glyph);
      }
      pending.append(glyph, candidate);
    }
  }
  flush(value.text.length);
  return { lines, lineHeight, height: lines.length * lineHeight };
}
function rowAt(layout: DocumentLayout, offset: number): DocumentLine {
  let result = layout.lines[0]!;
  for (const row of layout.lines) {
    if (row.from > offset) break;
    result = row;
  }
  return result;
}
function xAt(row: DocumentLine, offset: number): number {
  let x = 0;
  for (const boundary of row.boundaries) {
    if (boundary.offset > offset) break;
    x = boundary.x;
  }
  return x;
}
export function documentCaretRect(layout: DocumentLayout, offset: number): DocumentRect {
  const row = rowAt(layout, offset);
  return { x: xAt(row, offset), y: row.y, width: 1, height: layout.lineHeight };
}
export function documentOffsetAt(layout: DocumentLayout, x: number, y: number): number {
  const row =
    layout.lines[
      Math.max(0, Math.min(layout.lines.length - 1, Math.floor(y / layout.lineHeight)))
    ]!;
  let offset = row.from,
    distance = Infinity;
  for (const boundary of row.boundaries) {
    const next = Math.abs(boundary.x - x);
    if (next < distance) {
      distance = next;
      offset = boundary.offset;
    }
  }
  return offset;
}
export function documentSelectionRects(
  layout: DocumentLayout,
  selection: DocumentSelection,
): DocumentRect[] {
  const from = Math.min(selection.anchor, selection.focus),
    to = Math.max(selection.anchor, selection.focus);
  if (from === to) return [];
  const rects: DocumentRect[] = [];
  for (const row of layout.lines) {
    if (from >= row.end || to <= row.from) continue;
    const x = xAt(row, Math.max(from, row.from));
    rects.push({
      x,
      y: row.y,
      width: Math.max(4, xAt(row, Math.min(to, row.to)) - x),
      height: layout.lineHeight,
    });
  }
  return rects;
}
