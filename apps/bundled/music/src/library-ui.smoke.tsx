/** Add a folder through the file chooser, then browse albums by keyboard. No playback. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import React from "react";
import { runTool } from "@moire/app-tools";
import { windowControl, windowTexts, withFixture } from "@moire/app-tools/testing";
import { MusicApp } from "./main";
import { MusicLibraryStore } from "./library";
import { musicHarness } from "./testing";

await withFixture(async (home) => {
  for (const album of ["Alpha", "Beta"]) {
    const folder = path.join(home, "Music", album);
    await fs.mkdir(folder, { recursive: true });
    await runTool("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=1",
      "-metadata",
      `title=${album} song`,
      "-metadata",
      `album=${album}`,
      "-metadata",
      "artist=Fixture",
      path.join(folder, "1.flac"),
    ]);
  }
  const store = new MusicLibraryStore(path.join(home, "library"));
  const app = await musicHarness(
    (size, window) => <MusicApp {...size} store={store} windowActions={window} />,
    1280,
    820,
  );
  const press = async (match: { focusId: string } | { text: string }) => {
    const point = windowControl(app.window, match);
    app.click(point.x, point.y);
    await app.settle();
  };
  const texts = () => windowTexts(app.window);
  try {
    await app.settle();
    await press({ focusId: "music:empty-import" });
    await press({ focusId: "music:choose-folder" });
    assert.ok(texts().includes("Choose a music folder"), "Choose folder opens the chooser");
    assert.ok(texts().includes("Alpha") && texts().includes("Beta"), "it starts in ~/Music");
    // Escape returns to the import panel without importing anything.
    app.key(1, "Escape");
    await app.settle();
    assert.ok(!texts().includes("Choose a music folder"));
    assert.ok(texts().includes("Import local music"));
    assert.equal(store.load().tracks.length, 0);
    await press({ focusId: "music:choose-folder" });
    await press({ text: "Choose this folder" });
    await app.settle(() => store.load().tracks.length === 2);
    await app.settle(() => texts().includes("2 tracks imported"));
    assert.ok(!texts().includes("Import local music"), "a finished import closes the panel");

    // Arrow keys move through the album list without opening; Enter opens the highlighted one.
    await press({ focusId: "music:back" });
    assert.ok(texts().includes("Alpha") && texts().includes("Beta"));
    const albums = windowControl(app.window, { focusId: "music:albums" });
    app.click(albums.x, albums.y); // The list centre is below its two rows: focus, no press.
    app.key(108, "ArrowDown");
    app.key(108, "ArrowDown");
    await app.settle();
    assert.ok(!texts().includes("Play album"), "arrow keys must not open an album");
    app.key(28, "Enter");
    await app.settle();
    assert.ok(texts().includes("Play album"), "Enter opens the highlighted album");
    assert.ok(texts().includes("1   Beta song"), "the second album was highlighted");
  } finally {
    app.destroy();
  }
});
console.log("[music/library-ui] chooser folder import, cancel and keyboard album browsing passed");
