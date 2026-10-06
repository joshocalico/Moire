import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { measureTextBounds } from "@moire/react-host";
import { installUiFonts } from "#ui/font";
import { plainDocument, toggleDocumentMark } from "./document-model";
import { layoutDocument, documentCaretRect, documentOffsetAt } from "./document-layout";
await installUiFonts();
const measure = (text: string, marks: { bold: boolean }) =>
  measureTextBounds(text, { fontSize: 16, fontWeight: marks.bold ? "bold" : "regular" }).width;
for (const size of [10_000, 50_000]) {
  const text =
    "A quiet idea, wrapped into a measured paragraph. 😀 We keep the useful details close.\n"
      .repeat(Math.ceil(size / 85))
      .slice(0, size);
  let document = plainDocument(text);
  document = toggleDocumentMark(document, { anchor: 10, focus: 37 }, "bold");
  const begin = performance.now();
  let measurements = 0;
  const measured: typeof measure = (text, marks) => {
    measurements++;
    return measure(text, marks);
  };
  const layout = layoutDocument(document, 560, 26, measured);
  const elapsed = performance.now() - begin;
  assert.ok(
    measurements < text.length * 3,
    "native-font measurement work must not revisit every prefix for every candidate glyph",
  );
  for (const row of layout.lines) {
    for (const fragment of row.fragments) {
      assert.equal(fragment.width, measure(fragment.text, fragment.marks));
      for (const boundary of row.boundaries.filter(
        (item) => item.offset > fragment.from && item.offset <= fragment.to,
      )) {
        assert.equal(
          boundary.x,
          fragment.x +
            measure(fragment.text.slice(0, boundary.offset - fragment.from), fragment.marks),
          "caret boundaries preserve native kerning of painted styled fragments",
        );
      }
    }
  }
  assert.equal(layout.lines[0]?.from, 0);
  assert.equal(layout.lines.at(-1)?.to, text.length);
  for (const row of layout.lines)
    for (const boundary of row.boundaries) {
      const caret = documentCaretRect(layout, boundary.offset);
      if (caret.y !== row.y) continue; // The next wrapped line owns the shared boundary.
      assert.equal(documentOffsetAt(layout, caret.x, caret.y), boundary.offset);
    }
  console.log(
    `[document-layout] ${text.length} UTF16 units/${layout.lines.length} lines: ${elapsed.toFixed(1)}ms native-font layout`,
  );
  const editBegin = performance.now();
  layoutDocument({ ...document, text: document.text + " one more thought" }, 560, 26, measure);
  console.log(
    `[document-layout] ${text.length} edit: ${(performance.now() - editBegin).toFixed(1)}ms`,
  );
}
