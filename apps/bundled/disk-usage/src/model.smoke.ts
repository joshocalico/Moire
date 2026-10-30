/** Disk Usage's states and orderings, on a hand-built tree: no scanning, no rendering. */
import assert from "node:assert/strict";
import type { UsageNode, UsageScan } from "./backend";
import {
  initialState,
  largestFiles,
  percent,
  reduce,
  statusText,
  tidyPath,
  visibleItems,
  type State,
} from "./model";

const file = (path: string, size: number): UsageNode => ({
  path,
  name: path.split("/").at(-1)!,
  kind: "file",
  allocated: size,
  logical: size,
  children: [],
});
const folder = (path: string, children: UsageNode[]): UsageNode => ({
  path,
  name: path.split("/").at(-1)!,
  kind: "directory",
  allocated: children.reduce((sum, child) => sum + child.allocated, 0),
  logical: children.reduce((sum, child) => sum + child.logical, 0),
  children,
});
const deep = folder("/r/a/deep", [file("/r/a/deep/huge.iso", 900), file("/r/a/deep/tiny", 1)]);
const a = folder("/r/a", [deep, file("/r/a/b.txt", 50)]);
const root = folder("/r", [a, file("/r/zebra.mov", 400), file("/r/Apple.txt", 10)]);
const result: UsageScan = { root, entries: 7, skipped: [], truncated: false };

let state: State = reduce(initialState, { type: "scan-started", root: "/r" });
state = reduce(state, { type: "scan-progress", entries: 250, bytes: 4096 });
assert.equal(statusText(state), "Scanning · 250 entries");
state = reduce(state, { type: "scan-finished", result });
const names = () => visibleItems(state).map((item) => item.name);
assert.deepEqual(names(), ["a", "zebra.mov", "Apple.txt"], "largest first");
state = reduce(state, { type: "sort", sort: "name" });
assert.deepEqual(names(), ["a", "Apple.txt", "zebra.mov"], "by name, ignoring case");
state = reduce(state, { type: "query", query: "ZEB" });
assert.deepEqual(names(), ["zebra.mov"], "the filter ignores case");
state = reduce(state, { type: "query", query: "" });
state = reduce(state, { type: "sort", sort: "size" });

// Largest files reach into every folder; entering one from there keeps the breadcrumb trail.
state = reduce(state, { type: "view", view: "largest" });
assert.deepEqual(names(), ["huge.iso", "zebra.mov", "b.txt", "Apple.txt", "tiny"]);
assert.deepEqual(
  largestFiles(root, 2).map((item) => item.name),
  ["huge.iso", "zebra.mov"],
);
state = reduce(state, { type: "enter", node: deep });
assert.equal(state.view, "contents");
assert.deepEqual(state.scan.kind === "ready" && state.scan.trail.map((node) => node.name), [
  "r",
  "a",
  "deep",
]);
state = reduce(state, { type: "go-to", depth: 0 });
assert.deepEqual(names(), ["a", "zebra.mov", "Apple.txt"]);
assert.equal(state.selected, "/r/a", "going up selects the folder you came from");

// Cancelling or failing ends the scan; a late result for it is ignored.
let cancelled = reduce(reduce(initialState, { type: "scan-started", root: "/r" }), {
  type: "scan-cancelled",
});
cancelled = reduce(cancelled, { type: "scan-finished", result });
assert.deepEqual(cancelled.scan, { kind: "cancelled", root: "/r" });
assert.equal(statusText(cancelled), "Scan cancelled");
const failed = reduce(reduce(initialState, { type: "scan-started", root: "/x" }), {
  type: "scan-failed",
  message: "Permission denied",
});
assert.equal(statusText(failed), "Scan failed: Permission denied");
assert.equal(statusText(reduce(failed, { type: "notice", notice: "No opener" })), "No opener");

assert.equal(percent(1, 1000), "<1%");
assert.equal(percent(0, 0), "0%");
assert.equal(tidyPath("/home/me/Music", "/home/me"), "~/Music");
assert.equal(tidyPath("/home/meg", "/home/me"), "/home/meg");
console.log(
  "[disk-usage/model] sort, filter, largest files, breadcrumbs, cancel/fail states passed",
);
