/**
 * Files' search model without rendering: the query language, completions, scopes, the
 * name-only fallback's caps and cancellation, grouping, type-to-select ranking, recent groups
 * and kind chips, and the controller's debounce, cancellation and index/fallback choice.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  EMPTY_QUERY,
  LARGE_FILE_BYTES,
  createLocalIndexClient,
  groupSearchHits,
  type IndexBackend,
  type IndexQuery,
  type IndexStatus,
  type SearchHit,
} from "@moire/system-management/index-status";
import { fieldCompletions, joinField, splitField } from "./field";
import { scanNames } from "./fallback";
import type { SearchEntry } from "./filters";
import { filterByKind, kindChips } from "./kind-counts";
import {
  applyCompletion,
  completeQuery,
  parseQuery,
  parseSize,
  serializeQuery,
  toIndexQuery,
  withToken,
  withoutPart,
  type SearchQuery,
} from "./query";
import { groupRecent } from "./recent";
import { mergeLocal, presentResults, rankLocal, reasonLabel } from "./results";
import {
  defaultScope,
  scanRoot,
  scopeChoices,
  scopePath,
  searchPlaceholder,
  widerScope,
} from "./scope";
import { SearchController, type SearchSnapshot } from "./use-search";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const structured = ({ words, kinds, when, sizes, tags, within }: SearchQuery): SearchQuery => ({
  words,
  kinds,
  when,
  sizes,
  tags,
  within,
});

// ---- Query language.
let parsed = parseQuery(
  'quarterly kind:image when:week size:>10mb tag:travel in:"~/My Work" "kind:literal"',
);
assert.deepEqual(parsed.words, ["quarterly", "kind:literal"]);
assert.deepEqual(parsed.kinds, ["image"]);
assert.equal(parsed.when, "week");
assert.deepEqual(parsed.sizes, [{ op: ">", bytes: 10 * 1024 * 1024 }]);
assert.deepEqual(parsed.tags, ["travel"]);
assert.deepEqual(parsed.within, ["~/My Work"]);
assert.equal(parsed.parts.filter((part) => part.type === "token").length, 5);
for (const text of [
  "report",
  "kind:document when:today",
  'two words "a phrase" tag:"road trip" size:<1.5mb size:>1kb kind:audio kind:video in:../src',
  "size:large",
  "",
]) {
  const once = structured(parseQuery(text));
  assert.deepEqual(structured(parseQuery(serializeQuery(once))), once, `round trip: ${text}`);
}
assert.equal(
  serializeQuery(parseQuery("KIND:Photos  when:WEEK report")),
  "report kind:image when:week",
);
assert.deepEqual(parseSize("large"), { op: ">", bytes: LARGE_FILE_BYTES });
assert.deepEqual(parseSize("100k"), { op: ">", bytes: 102400 });
assert.equal(parseSize("big"), null);
parsed = parseQuery("kind:spaceship when:soon size:huge kind:");
assert(
  parsed.parts.every((part) => part.type === "token" && !part.valid),
  "bad tokens are kept, marked invalid",
);
assert.deepEqual(structured(parsed), structured(parseQuery("")), "and ignored");
assert.equal(parseQuery("foo:bar").words[0], "foo:bar", "unknown keys are words");
assert.equal(withToken("report", "kind", "image"), "report kind:image");
assert.equal(withToken("report kind:image", "kind", "image"), "report kind:image");
assert.equal(withoutPart("report kind:image when:week", 1), "report when:week");
const resolved = toIndexQuery(parseQuery("in:~/Work in:sub in:/abs"), {
  home: "/home/u",
  cwd: "/home/u/Docs",
  includeHidden: false,
});
assert.deepEqual(resolved.within, ["/home/u/Work", "/home/u/Docs/sub", "/abs"]);

// ---- Completions.
let set = completeQuery("ki", 2);
assert.deepEqual(
  set?.items.map((item) => item.insert),
  ["kind:"],
);
let applied = applyCompletion("ki", set!, set!.items[0]!);
assert.deepEqual(applied, { text: "kind:", caret: 5 });
set = completeQuery(applied.text, applied.caret);
assert(set && set.items.length >= 8 && set.items[0]!.insert === "kind:folder ");
set = completeQuery("report kind:im", 14);
assert.deepEqual(
  set?.items.map((item) => item.label),
  ["image"],
);
applied = applyCompletion("report kind:im", set!, set!.items[0]!);
assert.deepEqual(applied, { text: "report kind:image ", caret: 18 });
assert.equal(completeQuery("report kind:image", 17), null, "a complete token offers nothing");
assert.deepEqual(
  completeQuery("when:w", 6)?.items.map((item) => item.label),
  ["week"],
);
assert.deepEqual(
  completeQuery("tag:tr", 6, { tags: ["Travel", "work", "trains"] })?.items.map(
    (item) => item.label,
  ),
  ["Travel", "trains"],
);
assert.deepEqual(
  completeQuery("in:Pro", 6, { folders: ["/home/u/Projects"], home: "/home/u" })?.items.map(
    (item) => item.insert,
  ),
  ["in:~/Projects "],
);
applied = applyCompletion("kind:au when:week", completeQuery("kind:au when:week", 7)!, {
  label: "audio",
  insert: "kind:audio ",
  detail: "",
});
assert.equal(applied.text, "kind:audio when:week", "no doubled space before the next part");
assert.equal(completeQuery('"ki', 3), null, "quoted text is literal");

// ---- The search field: finished tokens as chips, the rest as editable text.
{
  let parts = splitField("kind:image lisbon when:week ");
  assert.deepEqual(
    parts.tokens.map((token) => token.label),
    ["kind: image", "when: this week"],
  );
  assert.equal(parts.value, "lisbon ");
  // A token still being typed, or an invalid one, stays text.
  assert.deepEqual(splitField("kind:im").tokens, []);
  assert.equal(splitField("kind:im").value, "kind:im");
  assert.deepEqual(splitField("kind:nothing x").tokens, []);
  // Joining keeps chips as chips, and a removed chip leaves the rest.
  let text = joinField(parts.tokens, parts.value);
  assert.deepEqual(
    splitField(text).tokens.map((token) => token.id),
    ["kind:image", "when:week"],
  );
  text = joinField(parts.tokens.slice(1), parts.value);
  assert.deepEqual(parseQuery(text).kinds, []);
  assert.equal(parseQuery(text).when, "week");
  assert.equal(joinField([], "plain"), "plain");
  // Completions only for a token's value, and accepting one makes a chip.
  assert.deepEqual(fieldCompletions("ki", {}), [], "bare words are never completed (Enter opens)");
  const offered = fieldCompletions("trip kind:im", {});
  assert.deepEqual(
    offered.map((item) => item.label),
    ["image"],
  );
  parts = splitField(joinField([], offered[0]!.text));
  assert.deepEqual(
    parts.tokens.map((token) => token.id),
    ["kind:image"],
  );
  assert.equal(parts.value, "trip ");
  // The same token twice keeps distinct ids.
  assert.deepEqual(
    splitField("tag:a tag:A x").tokens.map((token) => token.id),
    ["tag:a", "tag:a#1"],
  );
}

// ---- Scopes.
const home = "/home/u";
assert.deepEqual(defaultScope(home, home), { kind: "home" });
assert.deepEqual(defaultScope("/home/u/Projects", home), {
  kind: "folder",
  path: "/home/u/Projects",
});
assert.deepEqual(
  scopeChoices("/home/u/Projects", home, [{ path: "/run/media/u/USB", label: "USB" }]).map(
    (choice) => choice.label,
  ),
  ["This folder", "Home", "Everywhere", "USB"],
);
assert.deepEqual(
  scopeChoices(home, home, []).map((choice) => choice.label),
  ["Home", "Everywhere"],
);
assert.equal(scopePath({ kind: "everywhere" }, home), "");
assert.equal(scanRoot({ kind: "everywhere" }, home), home);
assert.equal(searchPlaceholder({ kind: "folder", path: "/home/u/Projects" }), "Search Projects");
assert.deepEqual(widerScope({ kind: "home" }), { kind: "everywhere" });
assert.equal(widerScope({ kind: "everywhere" }), null);

// ---- Type-to-select through search: listing prefix matches rank first, in listing order.
const now = Date.now();
const entry = (name: string, isDir = false, size = 10, modified = now): SearchEntry => ({
  name,
  path: path.join("/home/u/Docs", name),
  isDir,
  size,
  modified,
});
// Listing order as Files shows it: folders first, then names.
const listing = [
  entry("Reports", true),
  entry("area.txt"),
  entry("readme.md"),
  entry("zebra-report.txt"),
];
let local = rankLocal(listing, "rea");
let view = presentResults(groupSearchHits(local, 8, "names", false));
assert.equal(view.best?.name, "readme.md", "rea: readme.md is what type-ahead picks");
assert(
  view.sections.flatMap((section) => section.hits).some((hit) => hit.name === "area.txt"),
  "substring matches still listed",
);
local = rankLocal(listing, "re");
assert.equal(
  presentResults(groupSearchHits(local, 8, "names", false)).best?.name,
  "Reports",
  "re: the folder, first in listing order",
);
assert.equal(
  presentResults(groupSearchHits(rankLocal(listing, "RE"), 8, "names", false)).best?.name,
  "Reports",
  "case-insensitive",
);
// The index may rank a deeper exact match higher; the listing's prefix match still wins.
const deep: SearchHit = {
  path: "/home/u/Docs/old/rea",
  name: "rea",
  kind: "other",
  isDir: false,
  size: 1,
  modified: now,
  tags: ["x"],
  reason: { kind: "name" },
  score: 200,
};
const remote = groupSearchHits(
  [
    deep,
    { ...local[0]!, path: "/home/u/Docs/readme.md", name: "readme.md", score: 70, tags: ["kept"] },
  ],
  8,
  "index",
  false,
);
const merged = mergeLocal(remote, rankLocal(listing, "rea"), 8);
assert.equal(merged.best?.name, "readme.md");
assert.deepEqual(merged.best?.tags, ["kept"], "index tags survive the merge");
assert.equal(merged.source, "index");
// Filters apply to listing matches too.
assert.deepEqual(
  rankLocal(listing, "rea", { query: { ...EMPTY_QUERY, kinds: ["folder"] }, now }).map(
    (hit) => hit.name,
  ),
  [],
);

// ---- Sections and reasons.
const hit = (name: string, kind: SearchHit["kind"], score: number): SearchHit => ({
  path: `/f/${name}`,
  name,
  kind,
  isDir: kind === "folder",
  size: 1,
  modified: now,
  tags: [],
  reason: { kind: "name" },
  score,
});
view = presentResults(
  groupSearchHits(
    [
      hit("a.png", "image", 90),
      hit("b.png", "image", 50),
      hit("c.mp4", "video", 40),
      hit("d.zip", "archive", 30),
      hit("Dir", "folder", 20),
    ],
    8,
    "index",
    false,
  ),
);
assert.equal(view.best?.name, "a.png");
assert.deepEqual(
  view.sections.map((section) => [section.id, section.total, section.hits.length]),
  [
    ["folders", 1, 1],
    ["images", 2, 1],
    ["other", 2, 2],
  ],
);
assert.deepEqual(view.sections[1]!.showAll, { key: "kind", value: "image" });
assert.equal(view.sections[2]!.showAll, null);
assert.equal(reasonLabel({ kind: "folder", folder: "/home/u/Atlas" }), "In Atlas");
assert.equal(
  reasonLabel({ kind: "text", excerpt: "the budget", highlights: [[4, 10]] }),
  "Text: …the budget…",
);
assert.equal(reasonLabel({ kind: "tag", tag: "travel" }), "Tag: travel");

// ---- Kind chips.
assert.deepEqual(
  kindChips(listing).map((chip) => [chip.label, chip.count]),
  [
    ["All", 4],
    ["Folders", 1],
    ["Documents", 3],
  ],
);
assert.deepEqual(
  filterByKind(listing, "folder").map((item) => item.name),
  ["Reports"],
);

// ---- Recent groups.
const day = 24 * 60 * 60 * 1000;
const noon = new Date();
noon.setHours(12, 0, 0, 0);
const at = noon.getTime();
const groups = groupRecent(
  [
    { usedAt: at - 1000 },
    { usedAt: at - day },
    { usedAt: at - 3 * day },
    { usedAt: at - 30 * day },
    { usedAt: at - 2000 },
  ],
  at,
);
assert.deepEqual(
  groups.map((group) => [group.id, group.items.length]),
  [
    ["today", 2],
    ["yesterday", 1],
    ["week", 1],
    ["earlier", 1],
  ],
);
assert.equal(groups[0]!.items[0]!.usedAt, at - 1000, "newest first");
assert.deepEqual(groupRecent([], at), []);

// ---- Fallback scan: names, filters, caps and cancellation.
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "moire-files-search-")));
try {
  const write = (relative: string, size = 1) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), Buffer.alloc(size));
  };
  write("Projects/report-final.txt");
  write("Projects/node_modules/report.js");
  write(".hidden/report.txt");
  write("big/report.iso", 2048);
  for (let index = 0; index < 2500; index++) write(`many/file-${index}.dat`);
  const query = (patch: Partial<IndexQuery>): IndexQuery => ({ ...EMPTY_QUERY, ...patch });
  let result = await scanNames(query({ words: ["report"] }), root, { perGroup: 8 });
  assert.equal(result.source, "names");
  const found = result.groups
    .flatMap((group) => group.hits.map((item) => path.relative(root, item.path)))
    .sort();
  assert.deepEqual(
    found,
    ["Projects/report-final.txt", "big/report.iso"],
    "skipped and hidden folders are not walked",
  );
  result = await scanNames(query({ words: ["report"], sizes: [{ op: ">", bytes: 1024 }] }), root, {
    perGroup: 8,
  });
  assert.equal(result.best?.name, "report.iso");
  result = await scanNames(query({ words: ["file"] }), path.join(root, "many"), { perGroup: 8 });
  assert.equal(result.truncated, true, "the entry cap stops the scan");
  assert.equal(result.total, 2000);
  let ticks = 0;
  result = await scanNames(query({ words: ["file"] }), path.join(root, "many"), {
    perGroup: 8,
    budgetMs: 300,
    clock: () => (ticks += 10),
  });
  assert(result.truncated && result.total < 40, "the time budget stops the scan");
  const abort = new AbortController();
  const pending = scanNames(query({ words: ["file"] }), path.join(root, "many"), {
    perGroup: 8,
    signal: abort.signal,
  });
  abort.abort();
  await assert.rejects(pending, { name: "AbortError" });

  // ---- Controller: debounce, stale cancellation, index first and fallback otherwise.
  const status = (state: IndexStatus["state"]): IndexStatus => ({
    state,
    message: "",
    revision: 1,
    roots: [root],
    files: 0,
    folders: 0,
    withText: 0,
    pendingText: 0,
    crawl: { directories: 0, entries: 0, queued: 0 },
    watching: "recursive",
    lastCrawlAt: null,
  });
  const searches: string[] = [];
  let indexState: IndexStatus["state"] = "ready";
  const backend: IndexBackend = {
    async search(indexQuery, _scope, perGroup) {
      searches.push(indexQuery.words.join(" "));
      await sleep(20);
      return groupSearchHits(
        [{ ...hit("indexed.txt", "document", 50), path: path.join(root, "indexed.txt") }],
        perGroup,
        "index",
        false,
      );
    },
    recent: async () => [],
    kindCounts: async (scope) => ({ scope, total: 0, kinds: {}, large: 0 }),
    status: () => status(indexState),
    reindex: async () => {},
    subscribe: () => () => {},
  };
  const client = createLocalIndexClient(backend);
  const controller = new SearchController({ client, debounceMs: 30 });
  const seen: SearchSnapshot[] = [];
  controller.subscribe((snapshot) => seen.push(snapshot));
  const request = { scope: { kind: "home" } as const, home: root, cwd: root, includeHidden: false };
  controller.update({ ...request, text: "r" });
  controller.update({ ...request, text: "re" });
  controller.update({ ...request, text: "rep" });
  assert.equal(controller.snapshot.status, "searching");
  await sleep(120);
  assert.deepEqual(searches, ["rep"], "only the last keystroke reaches the index");
  assert.equal(controller.snapshot.status, "indexed");
  assert.equal(controller.snapshot.view?.best?.name, "indexed.txt");
  // A request superseded mid-flight never publishes.
  controller.update({ ...request, text: "repo" });
  await sleep(40);
  controller.update({ ...request, text: "report" });
  await sleep(120);
  assert.equal(controller.snapshot.query?.words[0], "report");
  assert(
    !seen.some((snapshot) => snapshot.status === "indexed" && snapshot.query?.words[0] === "repo"),
    "stale results are dropped",
  );
  // The current folder's listing answers at once, before the debounce.
  controller.update({
    ...request,
    text: "rea",
    entries: listing.map((item) => ({ ...item, path: path.join(root, item.name) })),
  });
  assert.equal(controller.snapshot.view?.best?.name, "readme.md", "listing matches are instant");
  await sleep(120);
  assert.equal(
    controller.snapshot.view?.best?.name,
    "readme.md",
    "and still first once the index answers",
  );
  // Indexing off: names only, with the notice.
  indexState = "disabled";
  const off = new SearchController({ client: createLocalIndexClient(backend), debounceMs: 0 });
  off.update({ ...request, text: "report" });
  await sleep(200);
  assert.equal(off.snapshot.status, "names only");
  assert.equal(off.snapshot.notice, "Searching names only; indexing is off");
  assert.equal(off.snapshot.view?.best?.name, "report.iso", "an exact stem beats a prefix");
  // No client at all behaves the same.
  const none = new SearchController({ client: null, debounceMs: 0 });
  none.update({ ...request, text: "report" });
  await sleep(200);
  assert.equal(none.snapshot.status, "names only");
  // Clearing the field ends the search.
  none.update({ ...request, text: "  " });
  assert.equal(none.snapshot.status, "idle");
  controller.dispose();
  off.dispose();
  none.dispose();
  console.log("[files/search.smoke] ok");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
