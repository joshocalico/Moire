import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import React from "react";
import { withFixture } from "@moire/app-tools/testing";
import { musicHarness } from "./testing";
const source = process.env.MOIRE_TEST_ROOT;
const { MusicApp }: typeof import("./main") = source
  ? await import(pathToFileURL(path.join(source, "apps/bundled/music/src/main.tsx")).href)
  : await import("./main");
const { MusicLibraryStore }: typeof import("./library") = source
  ? await import(pathToFileURL(path.join(source, "apps/bundled/music/src/library.ts")).href)
  : await import("./library");
await withFixture(async (fixture) => {
  const store = new MusicLibraryStore(path.join(fixture, "library"));
  const tracks = ["First light", "Soft geometry"].map((title, index) => {
    const file = path.join(fixture, `${index}.flac`);
    return {
      id: createHash("sha256").update(file).digest("hex"),
      path: file,
      title,
      album: "Soft geometry",
      artist: "Lumen",
      number: index + 1,
      year: "2026",
      duration: 3,
      addedAt: index,
    };
  });
  for (const track of tracks)
    await fs.writeFile(track.path, "Source file is never changed by library navigation/removal");
  store.save({ tracks, revision: null });
  let queueLength = 0;
  const app = await musicHarness(
    (size, window) => (
      <MusicApp
        {...size}
        store={store}
        windowActions={window}
        onPlaybackStateChange={(_state, queue) => {
          queueLength = queue.length;
        }}
      />
    ),
    1280,
    800,
  );
  try {
    await app.settle();
    app.click(265, 136);
    await app.settle();
    app.click(460, 383);
    await app.settle();
    assert.equal(queueLength, 2);
    app.click(260, 71);
    await app.settle(); // Back from detail, without changing library view or queue.
    app.click(80, 190);
    await app.settle(); // Songs.
    app.click(360, 167);
    await app.settle();
    app.click(465, 121);
    await app.settle(() => store.load().tracks.length === 1);
    assert.equal(
      queueLength,
      2,
      "removing library metadata must preserve the existing playback queue",
    );
    assert.ok((await fs.readFile(tracks[0]!.path, "utf8")).startsWith("Source file"));
    assert.equal(store.load().tracks[0]?.title, "Soft geometry");
    app.native.setSize(640, 640);
    app.window.tick();
    await app.settle();
    assert.equal(app.native.lastFrame?.length, 640 * 640 * 4);
  } finally {
    app.destroy();
  }
  const reopened = await musicHarness(
    (size, window) => <MusicApp {...size} store={store} windowActions={window} />,
    1280,
    800,
  );
  try {
    await reopened.settle();
    assert.equal(store.load().tracks.length, 1);
  } finally {
    reopened.destroy();
  }
  console.log(
    "[music/navigation] public Window album queue/back/Songs removal, original bytes, queue retention, resize and library restart passed (metadata fixture; no audio claim)",
  );
});
