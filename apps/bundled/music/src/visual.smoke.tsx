import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { runTool } from "@moire/app-tools";
import { withFixture } from "@moire/app-tools/testing";
import {
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
} from "@moire/ui";
import { musicHarness } from "./testing";
const source = process.env.MOIRE_TEST_ROOT;
const { MusicApp }: typeof import("./main") = source
  ? await import(pathToFileURL(path.join(source, "apps/bundled/music/src/main.tsx")).href)
  : await import("./main");
const { MusicLibraryStore, importMusic }: typeof import("./library") = source
  ? await import(pathToFileURL(path.join(source, "apps/bundled/music/src/library.ts")).href)
  : await import("./library");
const width = Number(process.env.MOIRE_CAPTURE_WIDTH ?? 1280),
  height = Number(process.env.MOIRE_CAPTURE_HEIGHT ?? 800);
assert.ok(
  Number.isInteger(width) &&
    width >= 640 &&
    width <= 1600 &&
    Number.isInteger(height) &&
    height >= 480 &&
    height <= 1000,
);
const scheme = process.env.MOIRE_CAPTURE_SCHEME === "light" ? "light" : "dark";
const output =
  process.env.MOIRE_CAPTURE_DIR ??
  (await fs.mkdtemp(path.join(os.tmpdir(), "moire-music-captures-")));
await withFixture(async (fixture) => {
  const folder = path.join(fixture, "Soft geometry");
  await fs.mkdir(folder);
  for (const [number, title] of [
    [1, "First light"],
    [2, "Soft geometry"],
    [3, "Leaves in the current"],
  ] as const)
    await runTool("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${220 + number * 110}:duration=3`,
      "-metadata",
      `title=${title}`,
      "-metadata",
      "artist=Lumen",
      "-metadata",
      "album=Soft geometry",
      "-metadata",
      "date=2026",
      "-metadata",
      `track=${number}/3`,
      path.join(folder, `${number}.flac`),
    ]);
  const botanical = fileURLToPath(
    new URL("../../../../themes/default/botanical-wisteria.png", import.meta.url),
  );
  await runTool("ffmpeg", [
    "-v",
    "error",
    "-i",
    botanical,
    "-vf",
    "scale=512:512:force_original_aspect_ratio=increase,crop=512:512",
    "-frames:v",
    "1",
    "-update",
    "1",
    path.join(folder, "cover.png"),
  ]);
  const store = new MusicLibraryStore(path.join(fixture, "library"));
  const result = await importMusic([folder], store, new AbortController().signal);
  assert.equal(result.library.tracks.length, 3);
  const theme = createPersonalizedWidgetTheme(
    discoverPersonalization("linux", {
      themeFamily: "moire",
      colorScheme: scheme,
      reducedMotion: true,
    }),
  );
  let queueLength = 0;
  const app = await musicHarness(
    (size, window) => (
      <WidgetThemeProvider theme={theme}>
        <MusicApp
          {...size}
          windowActions={window}
          store={store}
          onPlaybackStateChange={(_state, queue) => {
            queueLength = queue.length;
          }}
        />
      </WidgetThemeProvider>
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
    if (queueLength !== 3) await app.capture(path.join(output, "music-queue-debug.png"));
    assert.equal(
      queueLength,
      3,
      "actual album Add to queue control must populate the capture, without playing audio",
    );
    if (width !== 1280 || height !== 800) {
      app.native.setSize(width, height);
      app.window.tick();
      await app.settle();
    }
    await app.capture(path.join(output, "music-album-queue.png"));
    assert.equal(app.native.lastFrame?.length, width * height * 4);
    console.log(
      JSON.stringify({
        kind: "music-reference-capture",
        source: source ?? "workspace",
        width,
        height,
        scheme,
        output,
        tracks: result.library.tracks.length,
        queueLength,
        scope:
          "actual ffprobe metadata + public Window pixels; no decoded/audio/native acceptance claim",
      }),
    );
  } finally {
    app.destroy();
  }
});
