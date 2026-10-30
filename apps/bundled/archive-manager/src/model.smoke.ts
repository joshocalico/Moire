/** Archive Manager's change set and states, without rendering or I/O. */
import assert from "node:assert/strict";
import {
  applyChange,
  archiveStem,
  entriesFromListing,
  entryTag,
  initialState,
  isDirty,
  openDocument,
  readOnlyReason,
  reduce,
  statusText,
  suggestedName,
  targetFolder,
  withWritableExtension,
  writableFormat,
  type State,
} from "./model";

const paths = (entries: { path: string }[]) => entries.map((entry) => entry.path);

// Listings: folders implied by members are filled in, "./" and "." are dropped, folders sort first.
const listed = entriesFromListing(["./notes.txt", "docs/a.txt", "docs/", "pics/b.png", "."]);
assert.deepEqual(paths(listed), ["docs", "docs/a.txt", "pics", "pics/b.png", "notes.txt"]);
assert.ok(listed.find((entry) => entry.path === "pics")?.folder, "implied parent is a folder");

// Add, create folder, rename (with descendants) and remove (with descendants).
let entries = applyChange(listed, {
  kind: "add",
  parent: "docs",
  source: "/home/me/plan.pdf",
  folder: false,
});
assert.ok(paths(entries).includes("docs/plan.pdf"));
assert.equal(entryTag(entries.find((entry) => entry.path === "docs/plan.pdf")!), "Added");
assert.throws(
  () =>
    applyChange(entries, {
      kind: "add",
      parent: "docs",
      source: "/elsewhere/plan.pdf",
      folder: false,
    }),
  /already an item named "plan.pdf"/,
);
assert.throws(
  () => applyChange(entries, { kind: "add", parent: "notes.txt", source: "/x", folder: false }),
  /folder/,
);
entries = applyChange(entries, { kind: "create-folder", parent: "", name: "New folder" });
assert.ok(entries.find((entry) => entry.path === "New folder")?.folder);
assert.throws(
  () => applyChange(entries, { kind: "create-folder", parent: "", name: "a/b" }),
  /can't contain/,
);
entries = applyChange(entries, { kind: "rename", path: "docs", name: "Papers" });
assert.deepEqual(
  paths(entries)
    .filter((entry) => entry.startsWith("Papers"))
    .sort(),
  ["Papers", "Papers/a.txt", "Papers/plan.pdf"],
);
assert.equal(entryTag(entries.find((entry) => entry.path === "Papers/a.txt")!), "Renamed");
assert.throws(
  () => applyChange(entries, { kind: "rename", path: "Papers", name: "pics" }),
  /already/,
);
entries = applyChange(entries, { kind: "remove", path: "pics" });
assert.ok(!paths(entries).some((entry) => entry.startsWith("pics")), "remove takes descendants");

// Formats: Save rewrites .tar.gz/.tgz/.tar/.zip; others and plain .gz are read-only with a reason.
assert.equal(writableFormat("a.TGZ"), "tar.gz");
assert.equal(writableFormat("a.tar.xz"), null);
assert.equal(withWritableExtension("/tmp/out"), "/tmp/out.tar.gz");
assert.equal(withWritableExtension("/tmp/out.zip"), "/tmp/out.zip");
assert.equal(archiveStem("/x/photos.tar.gz"), "photos");
assert.equal(archiveStem("/x/.zip"), ".zip");
const xz = openDocument("/x/a.tar.xz", ["a.txt"]);
assert.match(readOnlyReason(xz)!, /Editing isn't available for \.tar\.xz archives/);
assert.equal(openDocument("/x/a.gz", ["a"], "gzip").format, null);
assert.equal(readOnlyReason(openDocument("/x/a.zip", ["a"])), null);

// The reducer: edits accumulate as the change set; a bad edit becomes a notice, not an exception.
let state: State = reduce(initialState, {
  type: "opened",
  doc: openDocument("/x/a.zip", ["docs/", "docs/a.txt"]),
});
const doc = () =>
  state.screen.kind === "document" ? state.screen.doc : assert.fail("no document");
assert.equal(isDirty(doc()), false);
state = reduce(state, { type: "select", path: "docs/a.txt" });
assert.equal(targetFolder(doc()), "docs", "items are added beside the selected file");
state = reduce(state, {
  type: "edit",
  change: { kind: "rename", path: "docs/a.txt", name: "b.txt" },
});
assert.equal(doc().selected, "docs/b.txt", "the renamed entry stays selected");
assert.equal(isDirty(doc()), true);
assert.match(statusText(state), /Unsaved changes/);
state = reduce(state, {
  type: "edit",
  change: { kind: "create-folder", parent: "docs", name: "b.txt" },
});
assert.match(state.notice, /already an item/);
assert.equal(doc().changes.length, 1, "a refused edit is not recorded");
assert.equal(suggestedName(doc()), "a.zip");
state = reduce(state, { type: "new" });
assert.equal(suggestedName(doc()), "Archive.tar.gz");

// Tasks report progress and end in a result or a failure.
state = reduce(state, { type: "task-started", job: "extract", target: "/x/a", total: 4 });
state = reduce(state, { type: "task-progress", done: 2 });
assert.equal(statusText(state), "Extracting · 2 of 4 items");
state = reduce(state, { type: "task-finished", output: "/x/a" });
assert.deepEqual(state.task, { kind: "finished", job: "extract", output: "/x/a" });
console.log(
  "[archive-manager/model] listing, add/rename/remove/new-folder change set, formats and tasks passed",
);
