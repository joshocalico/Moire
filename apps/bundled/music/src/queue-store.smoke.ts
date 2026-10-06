import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { retryStoreCleanup, StorageConflictError } from "@moire/app-tools/local-store";
import { MusicQueueStore, type QueueSnapshot } from "./queue-store";
import type { Track } from "./library";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-music-queue-"));
let cases = 0;
function check(run: () => void) {
  run();
  cases++;
}
const missingMedia = path.join(fixture, "missing-track.flac");
const track: Track = {
  id: createHash("sha256").update(missingMedia).digest("hex"),
  path: missingMedia,
  title: "Missing but retained",
  artist: "Fixture artist",
  album: "Fixture album",
  year: "2026",
  number: 1,
  duration: 123,
  addedAt: 1,
  artwork: path.join(fixture, "missing-cover.png"),
};
const empty = {
  entries: [],
  currentEntryId: null,
  position: 0,
  revision: null,
} satisfies QueueSnapshot;
try {
  const store = new MusicQueueStore(path.join(fixture, "queue"));
  check(() => assert.deepEqual(store.load(), empty));
  check(() => assert.equal(fs.existsSync(store.directory), false));
  const saved = store.save({
    ...empty,
    entries: [
      { id: "first", track },
      { id: "repeat", track },
    ],
    currentEntryId: "repeat",
    position: 41.5,
  });
  check(() => {
    assert.equal(saved.cleanup.kind, "complete");
    assert.ok(saved.revision);
    assert.deepEqual(new MusicQueueStore(store.directory).load(), {
      entries: saved.entries,
      currentEntryId: "repeat",
      position: 41.5,
      revision: saved.revision,
    });
    assert.equal(fs.existsSync(missingMedia), false);
    assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
  });
  const actor = new MusicQueueStore(store.directory);
  const stale = actor.load();
  const advanced = store.save({ ...saved, position: 70 });
  const committed = fs.readFileSync(store.file);
  check(() => {
    assert.throws(() => actor.save({ ...stale, position: 1 }), StorageConflictError);
    assert.deepEqual(fs.readFileSync(store.file), committed);
    assert.equal(actor.load().position, 70);
  });
  for (const draft of [
    { ...advanced, currentEntryId: "absent" },
    { ...advanced, currentEntryId: null },
    { ...advanced, entries: [saved.entries[0], saved.entries[0]] },
    { ...advanced, entries: [{ id: " ", track }] },
    { ...advanced, entries: [{ id: "x".repeat(1025), track }] },
    { ...advanced, entries: [{ id: "with\0nul", track }] },
    { ...advanced, position: -1 },
    { ...advanced, position: Infinity },
    { ...advanced, position: NaN },
    { ...advanced, entries: [], currentEntryId: null, position: 1 },
  ]) {
    check(() => {
      assert.throws(() => store.save(draft));
      assert.deepEqual(fs.readFileSync(store.file), committed);
    });
  }
  const external = new MusicQueueStore(path.join(fixture, "external"));
  fs.mkdirSync(external.directory);
  const record = {
    version: 1,
    entries: [{ id: "item", track }],
    currentEntryId: "item",
    position: 0,
  };
  for (const value of [
    {},
    [record, record],
    [{ ...record, version: 2 }],
    [{ ...record, entries: [null] }],
    [{ ...record, entries: [{ id: "item", track: { ...track, id: "wrong" } }] }],
    [{ ...record, entries: [{ id: "item", track: { ...track, path: "relative.flac" } }] }],
    [{ ...record, position: "0" }],
    [{ ...record, currentEntryId: "missing" }],
    [{ ...record, entries: [], currentEntryId: "item" }],
  ]) {
    const bytes = JSON.stringify(value);
    fs.writeFileSync(external.file, bytes);
    check(() => {
      assert.throws(() => external.load());
      assert.throws(() => external.save(empty));
      assert.equal(fs.readFileSync(external.file, "utf8"), bytes);
    });
  }
  fs.writeFileSync(external.file, "{broken");
  check(() => {
    assert.throws(() => external.load(), SyntaxError);
    assert.throws(() => external.save(empty), SyntaxError);
    assert.equal(fs.readFileSync(external.file, "utf8"), "{broken");
  });
  fs.writeFileSync(external.file, "[]\n");
  check(() => {
    const found = external.load();
    assert.deepEqual(found.entries, []);
    assert.equal(found.currentEntryId, null);
    assert.equal(found.position, 0);
    assert.equal(found.revision, createHash("sha256").update("[]\n").digest("hex"));
  });
  const large = new MusicQueueStore(path.join(fixture, "large"));
  const entries = Array.from({ length: 5000 }, (_, index) => ({ id: `entry-${index}`, track }));
  const maximum = large.save({ ...empty, entries, currentEntryId: "entry-4999" });
  check(() => assert.equal(large.load().entries.length, 5000));
  const maximumBytes = fs.readFileSync(large.file);
  check(() => {
    assert.throws(() => large.save({ ...maximum, entries: [...entries, { id: "over", track }] }));
    assert.deepEqual(fs.readFileSync(large.file), maximumBytes);
  });
  const originalRename = fs.renameSync;
  try {
    fs.renameSync = (source, target) => {
      if (String(target) === store.file) throw new Error("Fixture publication failure");
      return originalRename(source, target);
    };
    check(() => {
      assert.throws(() => store.save({ ...advanced, position: 80 }), /Fixture publication failure/);
      assert.deepEqual(fs.readFileSync(store.file), committed);
    });
  } finally {
    fs.renameSync = originalRename;
  }
  const originalRmdir = fs.rmdirSync;
  try {
    fs.rmdirSync = (directory, options) => {
      if (String(directory).startsWith(`${store.file}.write-lock.released-`))
        throw new Error("Fixture cleanup failure after publication");
      return originalRmdir(directory, options);
    };
    check(() => {
      const published = store.save({ ...advanced, position: 91 });
      assert.equal(published.cleanup.kind, "pending");
      assert.equal(published.position, 91);
      assert.equal(store.load().revision, published.revision);
      assert.equal(store.load().position, 91);
      assert.equal(store.load().entries.length, 2);
    });
  } finally {
    fs.rmdirSync = originalRmdir;
    assert.equal(retryStoreCleanup().kind, "complete");
  }
  check(() => {
    const cleared = store.save({ ...store.load(), entries: [], currentEntryId: null, position: 0 });
    assert.equal(cleared.cleanup.kind, "complete");
    assert.deepEqual(store.load(), { ...empty, revision: cleared.revision });
  });
  const previousData = process.env.XDG_DATA_HOME;
  try {
    process.env.XDG_DATA_HOME = path.join(fixture, "data");
    check(() =>
      assert.equal(new MusicQueueStore().file, path.join(fixture, "data/moire/music/queue.json")),
    );
  } finally {
    if (previousData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = previousData;
  }
  console.log(
    JSON.stringify({
      ok: true,
      cases,
      scope: "Private filesystem queue persistence; no media probing or playback.",
    }),
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
