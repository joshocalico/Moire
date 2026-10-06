import assert from "node:assert/strict";
import {
  plainDocument,
  parseDocument,
  documentBoundary,
  previousDocumentCharacter,
  nextDocumentCharacter,
  toggleDocumentMark,
  replaceDocumentRange,
  documentFragments,
  selectionHasDocumentMark,
  createDocumentHistory,
  commitDocumentEdit,
  undoDocumentEdit,
  redoDocumentEdit,
} from "./document-model";

const text = "A 😀 word\nsecond line";
let value = plainDocument(text);
const emoji = { anchor: 2, focus: 4 };
value = toggleDocumentMark(value, emoji, "bold");
assert.deepEqual(value.runs, [
  { from: 2, to: 4, marks: { bold: true, underline: false, highlight: false } },
]);
value = toggleDocumentMark(value, { anchor: 0, focus: 8 }, "underline");
assert.equal(selectionHasDocumentMark(value, emoji, "bold"), true);
assert.equal(selectionHasDocumentMark(value, { anchor: 0, focus: 8 }, "underline"), true);
assert.equal(selectionHasDocumentMark(value, { anchor: 0, focus: 8 }, "bold"), false);
assert.deepEqual(parseDocument(value), value);
assert.equal(documentBoundary(text, 3), 2);
assert.equal(previousDocumentCharacter(text, 4), 2);
assert.equal(nextDocumentCharacter(text, 2), 4);
assert.equal(
  nextDocumentCharacter("\ud800A", 0),
  1,
  "an unpaired surrogate cannot consume the next code point",
);
const replaced = replaceDocumentRange(value, emoji, "X");
assert.equal(replaced.text, "A X word\nsecond line");
assert.equal(selectionHasDocumentMark(replaced, { anchor: 2, focus: 3 }, "bold"), true);
assert.equal(selectionHasDocumentMark(replaced, { anchor: 0, focus: 7 }, "underline"), true);
assert.deepEqual(parseDocument(replaced), replaced);
const cleared = toggleDocumentMark(replaced, { anchor: 0, focus: 7 }, "underline");
assert.equal(selectionHasDocumentMark(cleared, { anchor: 0, focus: 7 }, "underline"), false);
assert.equal(
  documentFragments(cleared)
    .map((run) => cleared.text.slice(run.from, run.to))
    .join(""),
  cleared.text,
);
const pasted = replaceDocumentRange(cleared, { anchor: 2, focus: 2 }, "new\n");
assert.deepEqual(parseDocument(pasted), pasted);
const deleted = replaceDocumentRange(pasted, { anchor: pasted.text.length, focus: 0 }, "");
assert.deepEqual(deleted, plainDocument(""));

let history = createDocumentHistory(value);
history = commitDocumentEdit(history, {
  ...history.present,
  document: replaced,
  selection: { anchor: 3, focus: 3 },
});
history = commitDocumentEdit(history, { ...history.present, document: cleared });
history = undoDocumentEdit(history);
assert.deepEqual(history.present.document, replaced);
history = undoDocumentEdit(history);
assert.deepEqual(history.present.document, value);
history = redoDocumentEdit(history);
assert.deepEqual(history.present.document, replaced);
history = commitDocumentEdit(history, { ...history.present, document: plainDocument("branch") });
assert.equal(history.future.length, 0, "new edit must discard the prior redo branch");

assert.throws(
  () =>
    parseDocument({
      text,
      runs: [{ from: 3, to: 4, marks: { bold: true, underline: false, highlight: false } }],
    }),
  /invalid range/,
);
assert.throws(
  () =>
    parseDocument({
      text,
      runs: [
        { from: 0, to: 4, marks: { bold: true, underline: false, highlight: false, italic: true } },
      ],
    }),
  /unsupported mark/,
);
assert.throws(() => parseDocument({ text, runs: [value.runs[1], value.runs[0]] }), /invalid range/);
console.log(
  "[document-model] persisted sparse runs, mixed formatting, Unicode boundaries, replacement and undo/redo passed",
);
