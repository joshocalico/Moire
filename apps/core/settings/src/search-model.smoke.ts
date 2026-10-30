/** Settings › Search's pure rules: status wording, exclude edits and the drive list. */
import assert from "node:assert/strict";
import { SKIPPED_FOLDER_NAMES } from "@moire/system-management/index-status";
import {
  addExclude,
  builtInExcludes,
  removableDrives,
  searchEnvironment,
  summarizeIndex,
  withInclude,
} from "./search-model";
import { fakeStorage, indexStatus, mountedVolume } from "./testing";

const env = searchEnvironment({}, "/home/ada");
const ready = (overrides: Parameters<typeof indexStatus>[0]) =>
  ({ kind: "ready", status: indexStatus(overrides) }) as const;

// ---- Status wording for every service state, and for no service at all.
assert.equal(summarizeIndex(null, true).title, "The search service isn't running");
assert.match(summarizeIndex(null, true).detail, /apply when it starts/);
assert.equal(summarizeIndex({ kind: "connecting" }, true).tone, "busy");
assert.equal(summarizeIndex(ready({ state: "disabled" }), false).title, "Indexing is off");
assert.equal(summarizeIndex(ready({ state: "disabled" }), false).hasIndex, false);
const crawling = summarizeIndex(
  ready({ state: "crawling", crawl: { directories: 30, entries: 900, queued: 10 } }),
  true,
);
assert.equal(crawling.progress, 0.75);
assert.equal(crawling.detail, "30 folders read · 10 waiting");
const paused = summarizeIndex(
  ready({ state: "paused", message: "Paused while the battery is low" }),
  true,
);
assert.equal(paused.detail, "Paused while the battery is low");
assert.equal(paused.progress, null);
assert.equal(summarizeIndex(ready({}), true).detail, "Watching for changes");
assert.match(summarizeIndex(ready({ watching: "reconcile" }), true).detail, /every few minutes/);
assert.equal(summarizeIndex(ready({ state: "error", message: "disk full" }), true).tone, "error");

// ---- The built-in list says what the service skips.
const builtIn = builtInExcludes(env, (file) => file.replace("/home/ada", "~"));
assert.deepEqual(builtIn.map((entry) => entry.detail).slice(1), [
  "~/.cache",
  "~/.local/share/Trash",
  [...SKIPPED_FOLDER_NAMES].join(", "),
]);

// ---- Excludes: no duplicates, no home, hidden folders already skipped, parents replace children.
assert.deepEqual(addExclude([], "/home/ada/Videos", env), {
  ok: true,
  value: ["/home/ada/Videos"],
});
assert.equal(addExclude([], "/home/ada", env).ok, false);
assert.equal(addExclude([], "/home", env).ok, false);
assert.equal(addExclude([], "/home/ada/.config/app", env).ok, false);
assert.equal(addExclude(["~/Videos"], "/home/ada/Videos/raw", env).ok, false);
assert.deepEqual(addExclude(["~/Videos/raw", "*.iso"], "/home/ada/Videos", env), {
  ok: true,
  value: ["*.iso", "/home/ada/Videos"],
});

// ---- Drives: mounted volumes with their opt-in, then opted-in drives not connected now.
const storage = fakeStorage([mountedVolume("USB", "/run/media/ada/USB", 2048)]);
const drives = removableDrives(storage.state, ["/run/media/ada/Old"], (bytes) => `${bytes} B`);
assert.equal(drives.kind, "ready");
assert.deepEqual(
  drives.kind === "ready" ? drives.drives.map((drive) => [drive.label, drive.included]) : [],
  [
    ["USB", false],
    ["Old", true],
  ],
);
assert.equal(removableDrives(null, [], String).kind, "unavailable");
assert.deepEqual(withInclude(["/a"], "/b", true), ["/a", "/b"]);
assert.deepEqual(withInclude(["/a", "/b"], "/a", false), ["/b"]);

console.log("[settings/search-model] status wording, excludes and drives passed");
