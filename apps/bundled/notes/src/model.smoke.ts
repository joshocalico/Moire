/** Notes' browsing and editing transitions, without rendering or storage. */
import assert from "node:assert/strict";
import { createNote, emptyNotebook, type Notebook } from "./store";
import {
  ALL_NOTES,
  editNote,
  exportName,
  exportText,
  initialBrowse,
  notebookForNewNote,
  notesInView,
  parseViewKey,
  removeNote,
  reselect,
  search,
  showView,
  viewKey,
  viewTitle,
  wordCount,
} from "./model";

const local = { ...createNote(), title: "Groceries", body: "eggs and tea", updatedAt: 3 };
const pinned = {
  ...createNote("work"),
  title: "Plan",
  body: "ship it",
  pinned: true,
  updatedAt: 2,
};
const old = { ...createNote("work"), title: "Old", body: "archive", updatedAt: 1 };
const book: Notebook = {
  ...emptyNotebook(),
  notebooks: [...emptyNotebook().notebooks, { id: "work", title: "Work" }],
  notes: [old, local, pinned],
};

// Views round-trip through sidebar ids, including notebook ids that look like view names.
for (const view of [
  ALL_NOTES,
  { kind: "pinned" as const },
  { kind: "notebook" as const, id: "pinned" },
])
  assert.deepEqual(parseViewKey(viewKey(view)), view);
assert.equal(viewTitle(book, { kind: "notebook", id: "work" }), "Work");
assert.equal(notebookForNewNote({ kind: "pinned" }), "local");
assert.equal(notebookForNewNote({ kind: "notebook", id: "work" }), "work");

// Lists are newest first; search matches titles and text, case-insensitively.
assert.deepEqual(
  notesInView(book.notes, ALL_NOTES, "").map((note) => note.title),
  ["Groceries", "Plan", "Old"],
);
assert.deepEqual(
  notesInView(book.notes, { kind: "pinned" }, "").map((note) => note.id),
  [pinned.id],
);
assert.deepEqual(
  notesInView(book.notes, ALL_NOTES, "SHIP").map((note) => note.id),
  [pinned.id],
);

// The editor only ever holds a listed note.
const start = initialBrowse(book);
assert.equal(start.selected, local.id, "the newest note opens first");
const work = showView(book, start, { kind: "notebook", id: "work" });
assert.equal(work.selected, pinned.id, "switching notebook selects one of its notes");
assert.equal(showView(book, work, ALL_NOTES).selected, pinned.id, "a still-listed note stays open");
assert.equal(search(book, work, "archive").selected, old.id);
assert.equal(search(book, work, "nothing like this").selected, null);
assert.equal(showView(book, work, ALL_NOTES).query, "", "changing view clears the search");

// Unpinning inside Pinned notes moves the selection off the note that left the list.
const pinnedView = showView(book, start, { kind: "pinned" });
const unpinned = editNote(book, pinned.id, { pinned: false }, 10);
assert.equal(reselect(unpinned, pinnedView).selected, null);
assert.equal(unpinned.notes.find((note) => note.id === pinned.id)?.updatedAt, 10);
assert.equal(
  unpinned.notes.find((note) => note.id === old.id),
  old,
  "other notes are untouched",
);
assert.equal(reselect(removeNote(book, local.id), start).selected, pinned.id);

assert.equal(wordCount("  one\ttwo\nthree "), 3);
assert.equal(wordCount("   "), 0);
assert.equal(exportName({ ...local, title: 'a/b: "c"' }), "a b c.txt");
assert.equal(exportName({ ...local, title: "  " }), "Untitled note.txt");
assert.equal(exportText(local, "/tmp/x.txt"), "Groceries\n\neggs and tea\n");
assert.equal(exportText(local, "/tmp/x.md"), "# Groceries\n\neggs and tea\n");
console.log("[notes/model] views, search, selection, edits and export text passed");
