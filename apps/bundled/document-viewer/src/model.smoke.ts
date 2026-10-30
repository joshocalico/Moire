/** Document Viewer's paging, go-to-page parsing and sidebar state, without rendering. */
import assert from "node:assert/strict";
import { initialState, pageForKey, parsePage, reduce } from "./model";

assert.equal(pageForKey("PageDown", 3, 5), 4);
assert.equal(pageForKey("PageDown", 5, 5), 5, "Page Down stops at the last page");
assert.equal(pageForKey("PageUp", 1, 5), 1, "Page Up stops at the first page");
assert.equal(pageForKey("Home", 4, 5), 1);
assert.equal(pageForKey("End", 2, 5), 5);
assert.equal(pageForKey("a", 2, 5), null);

assert.deepEqual(parsePage(" 4 ", 5), { page: 4 });
for (const bad of ["0", "6", "2.5", "two", ""])
  assert.deepEqual(parsePage(bad, 5), { error: "Enter a page from 1 to 5." }, bad);

let state = initialState("file:///docs/a.pdf", true);
assert.deepEqual(state, { kind: "open", file: "/docs/a.pdf", attempt: 0, page: 1, sidebar: true });
state = reduce(state, { type: "go", page: 9, pages: 5 });
assert.equal(state.kind === "open" && state.page, 5, "go clamps to the document");
state = reduce(state, { type: "toggle-sidebar" });
assert.equal(state.kind === "open" && state.sidebar, false);
state = reduce(state, { type: "retry" });
assert.equal(state.kind === "open" && state.page, 1, "Try again starts from the first page");
state = reduce(state, { type: "open", file: "/docs/b.pdf", sidebar: false });
assert.deepEqual(state, { kind: "open", file: "/docs/b.pdf", attempt: 0, page: 1, sidebar: false });
assert.deepEqual(initialState("ftp://x/a.pdf", true), {
  kind: "empty",
  error: "Only local files are supported.",
});
console.log("[document-viewer/model] paging keys, go-to-page parsing, clamping and sidebar passed");
