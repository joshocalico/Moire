/** Music's browsing and queue transitions, without rendering, storage or playback. */
import assert from "node:assert/strict";
import type { Track } from "./library";
import type { QueueSnapshot } from "./queue-store";
import {
  INITIAL_BROWSE,
  albumsFor,
  appendToQueue,
  back,
  browseContent,
  clearUpcoming,
  highlight,
  importSummary,
  openAlbum,
  openArtist,
  removeFromQueue,
  replaceQueue,
  showImported,
  showView,
  shuffle,
} from "./model";

const track = (title: string, artist: string, album: string, number: number, addedAt: number) =>
  ({
    id: `${artist}/${album}/${title}`,
    path: `/music/${artist}/${album || "Loose"}/${title}.flac`,
    title,
    artist,
    album,
    year: "2026",
    number,
    duration: 60,
    addedAt,
  }) satisfies Track;
const tracks = [
  track("Second", "Lumen", "Geometry", 2, 1),
  track("First", "Lumen", "Geometry", 1, 2),
  track("Untagged", "", "", 0, 3),
  track("Alone", "Arc", "Bright", 1, 4),
];

// Albums sort by title, tracks by number; untagged files group by folder.
const albums = albumsFor(tracks);
assert.deepEqual(
  albums.map((album) => album.title),
  ["Bright", "Geometry", "Loose"],
);
assert.deepEqual(
  albums[1]!.tracks.map((item) => item.title),
  ["First", "Second"],
);

// Views and details.
assert.equal(browseContent(tracks, INITIAL_BROWSE).kind, "albums");
const artists = browseContent(tracks, showView(INITIAL_BROWSE, "Artists"));
assert.deepEqual(artists.kind === "artists" && artists.artists, [
  { name: "", count: 1 },
  { name: "Arc", count: 1 },
  { name: "Lumen", count: 2 },
]);
const lumen = browseContent(tracks, openArtist(showView(INITIAL_BROWSE, "Artists"), "Lumen"));
assert.equal(lumen.kind === "tracks" && lumen.tracks.length, 2);
const recent = browseContent(tracks, showView(INITIAL_BROWSE, "Recently added"));
assert.equal(recent.kind === "tracks" && recent.tracks[0]?.title, "Alone");
const opened = openAlbum(INITIAL_BROWSE, albums[1]!);
assert.equal(opened.track, "Lumen/Geometry/First", "opening an album selects its first track");
const searched = browseContent(tracks, { ...opened, query: "second" });
assert.ok(searched.kind === "album", "a search narrows an open album rather than closing it");
assert.deepEqual(
  searched.tracks.map((item) => item.title),
  ["Second"],
);
assert.deepEqual(back(opened).detail, { kind: "list", highlight: null });
assert.deepEqual(highlight(INITIAL_BROWSE, "x").detail, { kind: "list", highlight: "x" });
assert.equal(
  browseContent(tracks, { ...INITIAL_BROWSE, detail: { kind: "album", id: "gone" } }).kind,
  "albums",
  "an album that no longer exists falls back to the list",
);
const changed = showView({ ...opened, query: "lumen" }, "Songs");
assert.equal(changed.query, "lumen", "changing view keeps the search");
assert.deepEqual([changed.detail, changed.track], [{ kind: "list", highlight: null }, null]);
const imported = showImported([tracks[3]!]);
assert.deepEqual([imported.view, imported.track], ["Albums", "Arc/Bright/Alone"]);
assert.equal(browseContent(tracks, imported).kind, "album");

assert.equal(importSummary(1, []), "1 track imported");
assert.equal(importSummary(3, ["a: bad", "b: bad"]), "3 tracks imported; 2 items skipped: a: bad");
const sequence = [0.9, 0.1, 0.5];
assert.deepEqual(
  shuffle([1, 2, 3, 4], () => sequence.shift()!),
  [3, 2, 1, 4],
);

// Queue edits.
const entry = (id: string) => ({ id, track: tracks[0]! });
const empty: QueueSnapshot = { entries: [], currentEntryId: null, position: 0, revision: null };
const queue = replaceQueue(empty, ["a", "b", "c"].map(entry), 1);
assert.equal(queue.currentEntryId, "b");
assert.equal(replaceQueue(empty, [entry("a")], 9).currentEntryId, "a", "start is clamped");
assert.equal(appendToQueue(empty, [entry("x")]).currentEntryId, "x", "an empty queue starts");
assert.equal(appendToQueue(queue, [entry("x")]).currentEntryId, "b");
const playing = { ...queue, position: 12 };
assert.deepEqual(removeFromQueue(playing, "a"), { ...playing, entries: [entry("b"), entry("c")] });
const removedCurrent = removeFromQueue(playing, "b");
assert.deepEqual([removedCurrent.currentEntryId, removedCurrent.position], ["c", 0]);
assert.equal(removeFromQueue(removeFromQueue(playing, "c"), "b").currentEntryId, "a");
assert.equal(removeFromQueue(playing, "missing"), playing);
assert.deepEqual(
  clearUpcoming(queue).entries.map((item) => item.id),
  ["a", "b"],
);
console.log(
  "[music/model] albums, views, details, search, import summary, shuffle and queue edits passed",
);
