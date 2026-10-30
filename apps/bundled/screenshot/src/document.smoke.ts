import assert from "node:assert/strict";
import {
  changeEdits,
  documentImage,
  emptyDocument,
  isDirty,
  markSaved,
  replaceDocument,
  undoDocument,
} from "./document";
const image = {
  width: 8,
  height: 8,
  rgba: new Uint8Array(8 * 8 * 4).fill(255),
};
let document = replaceDocument(emptyDocument(), image, true);
assert.equal(isDirty(document), false);
const saved = document.revision;
document = changeEdits(document, [{ kind: "crop", bounds: { x: 1, y: 1, width: 4, height: 4 } }]);
assert.equal(isDirty(document), true);
assert.equal(documentImage(document)?.width, 4);
document = markSaved(document, document.revision);
assert.equal(isDirty(document), false);
document = changeEdits(document, []);
assert.equal(isDirty(document), true);
document = undoDocument(document);
assert.equal(isDirty(document), false, "undo to the saved revision restores clean state");
document = undoDocument(document);
assert.equal(document.revision, saved);
assert.equal(isDirty(document), true, "undoing away from the saved cropped state is dirty");
const nextRevision = document.nextRevision;
document = changeEdits(document, [
  { kind: "pen", points: [{ x: 0, y: 0 }], width: 2, color: [255, 0, 0, 255] },
]);
assert.equal(
  document.revision,
  nextRevision,
  "new branch cannot reuse a former saved revision identity",
);
const captured = replaceDocument(document, image, false);
assert.equal(isDirty(captured), true, "new capture needs saving even before an edit");
assert.equal(captured.undo.length, 0);
assert.equal(isDirty(emptyDocument()), false);
console.log(
  "Screenshot saved revisions, undo/reset branching, real crop pixels and unsaved capture passed",
);
