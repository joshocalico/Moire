/** Tag colours persist beside the tags, old catalogs still load, and suggestions per kind. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileCatalog, TAG_COLOURS, tagSuggestions } from "./catalog";
import type { Preview } from "./preview/model";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "files-catalog-"));
try {
  // A catalog written before colours existed loads, with default colours.
  const file = path.join(root, "config", "files-tags.json");
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    JSON.stringify({ version: 1, records: [{ path: "/home/u/a.jpg", tags: ["Trip", "2024"] }] }),
  );
  const catalog = new FileCatalog(file);
  await catalog.load();
  assert.deepEqual(catalog.tags("/home/u/a.jpg"), ["Trip", "2024"]);
  assert.ok(TAG_COLOURS.includes(catalog.colourOf("Trip")));
  assert.equal(catalog.colourOf("Trip"), catalog.colourOf("Trip"), "the default is stable");
  assert.equal(new FileCatalog(file).colourOf("Trip"), catalog.colourOf("Trip"));
  assert.ok(
    new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((tag) => catalog.colourOf(tag))).size > 2,
    "defaults spread across the palette",
  );

  // A chosen colour is saved with the records and survives a reload.
  await catalog.setColour("Trip", TAG_COLOURS[4]!);
  await catalog.update(["/home/u/b.jpg"], ["Work"], "add");
  assert.equal(catalog.colourOf("Trip"), TAG_COLOURS[4]);
  const stored = JSON.parse(await fs.readFile(file, "utf8"));
  assert.equal(stored.version, 1);
  assert.equal(stored.records.length, 2, "writing keeps the records");
  assert.deepEqual(stored.colours, { Trip: TAG_COLOURS[4] });
  const reloaded = new FileCatalog(file);
  await reloaded.load();
  assert.equal(reloaded.colourOf("Trip"), TAG_COLOURS[4]);
  assert.deepEqual(reloaded.allTags(), ["2024", "Trip", "Work"]);
  await assert.rejects(catalog.setColour("Trip", -1));

  // Garbled colours are ignored, not fatal.
  await fs.writeFile(
    file,
    JSON.stringify({ version: 1, records: [], colours: { Ok: 0xff112233, Bad: "red" } }),
  );
  const garbled = new FileCatalog(file);
  await garbled.load();
  assert.equal(garbled.colourOf("Ok"), 0xff112233);
  assert.ok(TAG_COLOURS.includes(garbled.colourOf("Bad")));
} finally {
  await fs.rm(root, { recursive: true, force: true });
}

// Suggestions, by kind of preview.
const photo: Preview = {
  kind: "image",
  format: "JPEG",
  width: 10,
  height: 10,
  exposure: {
    camera: "FUJIFILM X-T4",
    lens: null,
    taken: new Date(2024, 5, 1).getTime(),
    settings: null,
  },
};
assert.deepEqual(
  tagSuggestions({ preview: photo, path: "/home/u/Pictures/Trip/a.jpg", existing: [] }),
  ["2024", "Fujifilm", "Trip"],
);
assert.deepEqual(
  tagSuggestions({ preview: photo, path: "/home/u/Pictures/a.jpg", existing: ["fujifilm"] }),
  ["2024"],
  "existing tags (any case) and generic folders are left out",
);
assert.deepEqual(
  tagSuggestions({
    preview: photo,
    path: "/home/u/trip/a.jpg",
    existing: [],
    known: ["TRIP", "fujiFilm"],
  }),
  ["2024", "fujiFilm", "TRIP"],
  "known tags keep their spelling",
);
assert.deepEqual(
  tagSuggestions({ preview: null, path: path.join(os.homedir(), "a.txt"), existing: [] }),
  [],
  "Home is not a tag",
);
assert.deepEqual(tagSuggestions({ preview: null, path: "/a.txt", existing: [] }), []);

const song: Preview = {
  kind: "audio",
  duration: 200,
  title: "Song",
  artist: "Moire Band",
  album: "Patterns",
  year: "2019-03-02",
  track: "1",
  codec: null,
  sampleRate: null,
  channels: null,
  bitrate: null,
  hasArt: false,
};
assert.deepEqual(tagSuggestions({ preview: song, path: "/m/Music/a.mp3", existing: [] }), [
  "Moire Band",
  "Patterns",
  "2019",
]);
assert.deepEqual(
  tagSuggestions({ preview: song, path: "/m/Live/a.mp3", existing: ["patterns"] }),
  ["Moire Band", "2019", "Live"],
  "at most three",
);
const sameNames: Preview = { ...song, album: "Moire Band", year: null };
assert.deepEqual(
  tagSuggestions({ preview: sameNames, path: "/m/Music/a.mp3", existing: [] }),
  ["Moire Band"],
  "duplicates collapse",
);

const pdf: Preview = {
  kind: "pdf",
  pages: 2,
  title: "Report",
  author: "Ada Lovelace",
  excerpt: "",
  encrypted: false,
};
assert.deepEqual(tagSuggestions({ preview: pdf, path: "/d/Documents/r.pdf", existing: [] }), [
  "Ada Lovelace",
]);
const video: Preview = {
  kind: "video",
  duration: 3,
  width: 1,
  height: 1,
  codec: null,
  title: "Lisbon 2023",
};
assert.deepEqual(tagSuggestions({ preview: video, path: "/v/Videos/x.mp4", existing: [] }), [
  "2023",
]);
assert.deepEqual(
  tagSuggestions({ preview: { ...video, title: null }, path: "/v/Holiday/x.mp4", existing: [] }),
  ["Holiday"],
);

console.log("catalog smoke passed");
