/** Actual discovery/probe/storage boundaries; no playback devices. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { runTool } from "@moire/app-tools";
import { withFixture } from "@moire/app-tools/testing";
import { MusicLibraryStore, importMusic } from "./library";

await withFixture(async (fixture) => {
  const file = path.join(fixture, "valid song.wav"),
    missing = path.join(fixture, "missing folder"),
    broken = path.join(fixture, "broken.wav"),
    empty = path.join(fixture, "empty folder");
  await fs.mkdir(empty);
  await fs.writeFile(broken, "not audio");
  await runTool("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=330:duration=1",
    file,
  ]);
  const original = await fs.readFile(file);
  for (const values of [
    [missing, file, empty, broken, file],
    [file, missing],
  ]) {
    const store = new MusicLibraryStore(path.join(fixture, `library-${values.length}`));
    const progress: number[][] = [];
    const result = await importMusic(values, store, new AbortController().signal, (done, total) =>
      progress.push([done, total]),
    );
    assert.equal(
      result.imported.length,
      1,
      "valid selected media survives another root's discovery failure",
    );
    assert.equal(result.library.tracks.length, 1, "duplicate canonical paths are probed once");
    assert.equal(result.warnings.length, values.length === 5 ? 3 : 1);
    assert.match(result.warnings[0] ?? "", /missing folder/);
    assert.deepEqual(
      progress,
      values.length === 5
        ? [
            [1, 2],
            [2, 2],
          ]
        : [[1, 1]],
    );
    assert.equal(store.load().tracks[0]?.path, await fs.realpath(file));
    assert.ok((await fs.readFile(file)).equals(original), "import preserves original media bytes");
    const published = await fs.readFile(store.file);
    await assert.rejects(
      importMusic([missing, empty, broken], store, new AbortController().signal),
    );
    assert.ok(
      (await fs.readFile(store.file)).equals(published),
      "all-invalid selection leaves stored library exact",
    );
    const cancel = new AbortController();
    await assert.rejects(importMusic([file], store, cancel.signal, () => cancel.abort()));
    assert.ok(
      (await fs.readFile(store.file)).equals(published),
      "cancelled import cannot publish partial metadata",
    );
    assert.equal(
      (await fs.readdir(store.directory)).some(
        (name) => name.startsWith(".library") || name === ".write-lock",
      ),
      false,
    );
  }
  const oversized = path.join(fixture, "too many tracks");
  await fs.mkdir(oversized);
  for (let index = 0; index <= 5000; index++)
    await fs.writeFile(path.join(oversized, `${String(index).padStart(5, "0")}.wav`), "");
  const boundedStore = new MusicLibraryStore(path.join(fixture, "bounded-library"));
  await assert.rejects(
    importMusic([file, oversized], boundedStore, new AbortController().signal),
    /at most 5000/,
  );
  await assert.rejects(fs.stat(boundedStore.file), { code: "ENOENT" });
  console.log(
    "[music/import] actual valid/missing/empty/broken root selections, deduplication, progress, atomic cancellation, global cap and original bytes passed",
  );
});
