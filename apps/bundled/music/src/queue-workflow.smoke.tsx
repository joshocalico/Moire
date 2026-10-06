/** Public Window queue workflows. Full playback mode requires actual mpv, never an IPC substitute. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { runTool, type PlaybackState } from "@moire/app-tools";
import { withFixture } from "@moire/app-tools/testing";
import {
  Window,
  TextBlock,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  setUiScaleFactor,
  getUiScaleFactor,
  formatPlaybackTime,
  type WidgetTheme,
  playbackBarHeight,
} from "@moire/ui";
import { MusicApp } from "./main";
import { MusicLibraryStore, probeTrack, type Track } from "./library";
import { MusicQueueStore, type QueueEntry } from "./queue-store";
import { musicHarness } from "./testing";

const storageOnly = process.argv.includes("--storage-only");
const defaultWindow = process.argv.includes("--default-window");
const binary = process.env.MOIRE_MUSIC_TEST_MPV ?? "mpv";
if (!storageOnly) {
  const version = await runTool(binary, ["--version"]);
  assert.match(
    version,
    /mpv\s+v?\d+/,
    "actual mpv is required; use --storage-only for non-playback host coverage",
  );
  process.stdout.write(`Actual playback backend: ${version.split("\n")[0]}\n`);
}
const isPaused = (state: PlaybackState) => state.kind === "ready" && state.paused;
const position = (state: PlaybackState) => (state.kind === "ready" ? state.position : -1);
const output = process.env.MOIRE_MUSIC_QUEUE_CAPTURE_DIR;
const themes = (scheme: "light" | "dark") =>
  createPersonalizedWidgetTheme(
    discoverPersonalization("linux", {
      themeFamily: "moire",
      colorScheme: scheme,
      reducedMotion: true,
    }),
  );
type Harness = Awaited<ReturnType<typeof musicHarness>>;
type Observation = { state: PlaybackState; queue: readonly QueueEntry[]; index: number };
const glyphs = new Map<
  string,
  {
    points: [number, number][];
    holes: [number, number][];
    right: number;
    bottom: number;
    color: number;
  }
>();

/** Independent TextBlock pixels, never a second live Music/persistence actor. */
function locate(
  harness: Harness,
  width: number,
  height: number,
  theme: WidgetTheme,
  text: string,
  size: "small" | "medium" = "medium",
  variant: "secondary" | "primary" = "secondary",
) {
  const style = theme.recipes.button[variant][size].label.base;
  const key = JSON.stringify({ text, style, scale: getUiScaleFactor() });
  let glyph = glyphs.get(key);
  if (!glyph) {
    const probeWidth = 500,
      probeHeight = 60;
    const probe = new Window({
      title: "Queue label oracle",
      width: probeWidth,
      height: probeHeight,
      decorated: false,
    });
    probe.setContent(
      <WidgetThemeProvider theme={theme}>
        <TextBlock
          width={probeWidth}
          height={probeHeight}
          text={text}
          fontSize={style.fontSize}
          fontWeight={style.fontWeight}
          color={style.color}
        />
      </WidgetThemeProvider>,
    );
    probe.mount(harness.backend);
    probe.tick();
    const frame = harness.backend.getWindows().at(-1)?.lastFrame;
    assert.ok(frame);
    const points: [number, number][] = [];
    for (let y = 0; y < probeHeight; y++)
      for (let x = 0; x < probeWidth; x++) {
        const at = (y * probeWidth + x) * 4;
        if (
          frame[at + 3] === 255 &&
          frame[at] === (style.color & 255) &&
          frame[at + 1] === ((style.color >>> 8) & 255) &&
          frame[at + 2] === ((style.color >>> 16) & 255)
        )
          points.push([x, y]);
      }
    assert.ok(points.length > 4, `reference ${text} paints full glyph ink`);
    const left = Math.min(...points.map(([x]) => x)),
      top = Math.min(...points.map(([, y]) => y));
    const right = Math.max(...points.map(([x]) => x)),
      bottom = Math.max(...points.map(([, y]) => y));
    const holes: [number, number][] = [];
    for (let y = top; y <= bottom; y++)
      for (let x = left; x <= right; x++)
        if (frame[(y * probeWidth + x) * 4 + 3] === 0) holes.push([x - left, y - top]);
    assert.ok(holes.length > 2, `${text} has negative glyph spaces, excluding solid surfaces`);
    glyph = {
      points: points.map(([x, y]) => [x - left, y - top]),
      holes,
      right: right - left,
      bottom: bottom - top,
      color: style.color,
    };
    glyphs.set(key, glyph);
    probe.destroy();
  }
  harness.window.tick();
  const frame = harness.native.lastFrame;
  assert.ok(frame);
  const rgb = [glyph.color & 255, (glyph.color >>> 8) & 255, (glyph.color >>> 16) & 255];
  const matches = (x: number, y: number) =>
    rgb.every((channel, index) => frame[(y * width + x) * 4 + index] === channel);
  const [anchorX, anchorY] = glyph.points[0]!;
  for (let y = 0; y < height - glyph.bottom; y++)
    for (let x = 0; x < width - glyph.right; x++) {
      if (!matches(x + anchorX, y + anchorY)) continue;
      if (
        glyph.points.every(([px, py]) => matches(x + px, y + py)) &&
        glyph.holes.every(([px, py]) => !matches(x + px, y + py))
      )
        return { x: x + glyph.right / 2, y: y + glyph.bottom / 2 };
    }
  return null;
}
async function press(
  harness: Harness,
  width: number,
  height: number,
  theme: WidgetTheme,
  label: string,
  size: "small" | "medium" = "medium",
  variant: "secondary" | "primary" = "secondary",
) {
  let point = locate(harness, width, height, theme, label, size, variant);
  // Queue error/recovery actions may be below its bounded viewport; actual wheel input reveals them.
  for (let attempt = 0; !point && attempt < 8; attempt++) {
    harness.native.injectPointer({
      type: "wheel",
      x: width - 100,
      y: height / 2,
      deltaY: 220,
      timeMs: 3 + attempt,
    });
    harness.window.tick();
    await harness.settle();
    point = locate(harness, width, height, theme, label, size, variant);
  }
  assert.ok(point, `${label} is visibly reachable in the actual Window`);
  harness.click(point.x, point.y);
  await harness.settle();
}
async function capture(harness: Harness, label: string) {
  if (output) await harness.capture(path.join(output, `${label}.png`));
}

await withFixture(async (directory) => {
  const files = [path.join(directory, "One.flac"), path.join(directory, "Two.flac")];
  for (const [index, file] of files.entries())
    await runTool("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=frequency=${220 + index * 110}:duration=20`,
      "-metadata",
      `title=${index === 0 ? "One" : "Two"}`,
      "-metadata",
      "album=Private Queue",
      "-metadata",
      "artist=Fixture",
      "-metadata",
      `track=${index + 1}`,
      file,
    ]);
  const tracks: Track[] = [];
  for (const file of files) tracks.push(await probeTrack(file, path.join(directory, "artwork")));
  const cases: string[] = [];
  const configurations: [number, "dark" | "light", number, number][] = defaultWindow
    ? [[1, "dark", 1020, 700]]
    : [
        [1, "dark", 1280, 900],
        [1.5, "light", 800, 1100],
      ];
  for (const [scale, scheme, width, height] of configurations) {
    setUiScaleFactor(scale);
    const theme = themes(scheme),
      store = new MusicLibraryStore(path.join(directory, `ui-${scale}`)),
      queueStore = new MusicQueueStore(store.directory);
    store.save({ tracks, revision: null });
    let observation: Observation = { state: { kind: "idle" }, queue: [], index: 0 };
    const read = (): Observation => observation;
    const open = () =>
      musicHarness(
        (size, window) => (
          <WidgetThemeProvider theme={theme}>
            <MusicApp
              {...size}
              windowActions={window}
              store={store}
              queueStore={queueStore}
              playbackOptions={{
                binary,
                extraArgs: ["--ao=null", "--vo=null", "--ao-null-buffer=0.01"],
              }}
              onPlaybackStateChange={(state, queue, index) => {
                observation = { state, queue, index };
              }}
            />
          </WidgetThemeProvider>
        ),
        width,
        height,
      );
    let harness = await open();
    try {
      await harness.settle();
      // A real album row selects the album; no controller method called by the test.
      harness.click(
        width > 1000 ? 360 : width / 2,
        (44 + (width <= 1000 ? 28 : 0) + 54 + 38) * scale,
      );
      await harness.settle();
      await capture(harness, `album-before-add-${scale}`);
      await press(harness, width, height, theme, "Add to queue");
      await harness.settle(() => read().queue.length === 2);
      await press(harness, width, height, theme, "Add to queue");
      await harness.settle(() => read().queue.length === 4);
      const added = queueStore.load();
      assert.equal(new Set(added.entries.map((entry) => entry.id)).size, 4);
      assert.deepEqual(
        added.entries.map((entry) => entry.track.id),
        [tracks[0]!.id, tracks[1]!.id, tracks[0]!.id, tracks[1]!.id],
      );
      assert.equal(read().state.kind, "idle", "enqueue does not start a decoder");
      await capture(harness, `added-${scheme}-${scale}`);
      harness.native.requestClose();
      harness.destroy();
      harness = await open();
      await harness.settle();
      assert.equal(read().state.kind, "idle", "reopen does not autoplay");
      assert.deepEqual(
        read().queue.map((entry) => entry.id),
        added.entries.map((entry) => entry.id),
      );
      // Compact layout exposes Queue through the real transport control.
      if (width <= 1000) {
        harness.click(width - 50 * scale, height - playbackBarHeight(width) + 24 * scale);
        await harness.settle();
      }
      await capture(harness, `restored-${scheme}-${scale}`);
      if (!storageOnly) {
        await press(harness, width, height, theme, "Resume at 0:00", "medium", "primary");
        await harness.settle(() => read().state.kind === "ready", 15000);
        assert.equal(isPaused(read().state), false);
        // Actual PlaybackBar seek then pause; private audio goes to mpv null output.
        harness.click(
          60 * scale + Math.max(1, width - (width >= 900 * scale ? 332 : 124) * scale) * 0.2,
          height - playbackBarHeight(width) + (width >= 900 * scale ? 83 : 127) * scale,
        );
        await harness.settle(() => position(read().state) > 3, 10000);
        harness.click(
          width / 2 - (width >= 900 * scale ? 0 : 25 * scale),
          height - playbackBarHeight(width) + (width >= 900 * scale ? 32 : 80) * scale,
        );
        await harness.settle(() => isPaused(read().state));
        const savedPosition = queueStore.load().position;
        assert.ok(
          savedPosition > 3 && savedPosition < 8,
          `observed paused position ${savedPosition}`,
        );
        harness.native.requestClose();
        harness.destroy();
        harness = await open();
        await harness.settle();
        assert.equal(read().state.kind, "idle");
        assert.ok(Math.abs(queueStore.load().position - savedPosition) < 0.1);
        if (width <= 1000) {
          harness.click(width - 50 * scale, height - playbackBarHeight(width) + 24 * scale);
          await harness.settle();
        }
        await capture(harness, `restored-position-${scheme}-${scale}`);
        const positions: number[] = [];
        // Store reads before/after explicit Resume prove no transient initial-zero publication.
        positions.push(queueStore.load().position);
        await press(
          harness,
          width,
          height,
          theme,
          `Resume at ${formatPlaybackTime(savedPosition)}`,
          "medium",
          "primary",
        );
        await harness.settle(() => read().state.kind === "ready", 15000);
        positions.push(queueStore.load().position);
        assert.ok(
          positions.every((value) => value >= savedPosition - 0.15),
          `resume checkpoint ${positions}`,
        );
        assert.ok(position(read().state) >= savedPosition - 0.15);
        harness.click(
          width / 2 - (width >= 900 * scale ? 0 : 25 * scale),
          height - playbackBarHeight(width) + (width >= 900 * scale ? 32 : 80) * scale,
        );
        await harness.settle(() => isPaused(read().state));
        // Queue selection and remove through actual pointer; replacement must preserve pause.
        if (width <= 1000) {
          harness.click(width - 50 * scale, height - playbackBarHeight(width) + 24 * scale);
          await harness.settle();
        }
        harness.click(width - 120 * scale, (44 + (width <= 1000 ? 28 : 0) + 86 + 36) * scale);
        await harness.settle();
        await press(harness, width, height, theme, "Remove selected", "small");
        await harness.settle(
          () => read().queue.length === 3 && read().state.kind === "ready",
          15000,
        );
        assert.equal(
          isPaused(read().state),
          true,
          "paused current removal keeps replacement paused",
        );
      }
      cases.push(`window-${scheme}-${scale}`);
    } finally {
      harness.destroy();
    }
  }
  if (!defaultWindow) {
    setUiScaleFactor(1);
    const theme = themes("dark"),
      width = 1280,
      height = 1000;
    const store = new MusicLibraryStore(path.join(directory, "failures")),
      queueStore = new MusicQueueStore(store.directory);
    store.save({ tracks, revision: null });
    queueStore.save({
      entries: [
        {
          id: "missing",
          track: {
            ...tracks[0]!,
            path: path.join(directory, "absent.flac"),
            id: (await import("node:crypto"))
              .createHash("sha256")
              .update(path.join(directory, "absent.flac"))
              .digest("hex"),
          },
        },
        { id: "good", track: tracks[1]! },
      ],
      currentEntryId: "missing",
      position: 2,
      revision: null,
    });
    let observation: Observation = { state: { kind: "idle" }, queue: [], index: 0 };
    const read = (): Observation => observation;
    const open = () =>
      musicHarness(
        (size, window) => (
          <WidgetThemeProvider theme={theme}>
            <MusicApp
              {...size}
              windowActions={window}
              store={store}
              queueStore={queueStore}
              playbackOptions={{
                binary,
                extraArgs: ["--ao=null", "--vo=null", "--ao-null-buffer=0.01"],
              }}
              onPlaybackStateChange={(state, queue, index) => {
                observation = { state, queue, index };
              }}
            />
          </WidgetThemeProvider>
        ),
        width,
        height,
      );
    let harness = await open();
    try {
      await harness.settle();
      if (!storageOnly) {
        await press(harness, width, height, theme, "Resume at 0:02", "medium", "primary");
        await harness.settle(() => read().state.kind === "error", 15000);
        assert.equal(queueStore.load().currentEntryId, "missing");
        await capture(harness, "missing-media");
        await press(harness, width, height, theme, "Next entry");
        await harness.settle(() => read().state.kind === "ready", 15000);
        assert.equal(queueStore.load().currentEntryId, "good");
        harness.destroy();
        queueStore.save({ ...queueStore.load(), currentEntryId: "missing", position: 2 });
        harness = await open();
        await harness.settle();
        await press(harness, width, height, theme, "Resume at 0:02", "medium", "primary");
        await harness.settle(() => read().state.kind === "error", 15000);
        await press(harness, width, height, theme, "Remove current entry");
        await harness.settle(() => read().queue.length === 1);
        assert.equal(read().queue[0]?.id, "good");
        cases.push("missing-next-remove");
      }
      harness.destroy();
      // A prepublication error happens inside a real Add action, not a fake QueueStore.
      harness = await open();
      await harness.settle();
      const before = fs.readFileSync(queueStore.file);
      const rename = fs.renameSync;
      fs.renameSync = (source, target) => {
        if (target === queueStore.file) throw new Error("private publication EIO");
        return rename(source, target);
      };
      try {
        harness.click(360, 136);
        await harness.settle();
        await press(harness, width, height, theme, "Add to queue");
      } finally {
        fs.renameSync = rename;
      }
      assert.deepEqual(fs.readFileSync(queueStore.file), before);
      const draftIds = read().queue.map((entry) => entry.id);
      await press(harness, width, height, theme, "Retry save");
      assert.deepEqual(
        queueStore.load().entries.map((entry) => entry.id),
        draftIds,
      );
      const competing = new MusicQueueStore(store.directory);
      competing.save({ ...competing.load(), position: 9 });
      const winner = fs.readFileSync(queueStore.file);
      await press(harness, width, height, theme, "Add to queue");
      assert.deepEqual(fs.readFileSync(queueStore.file), winner);
      const conflictDraft = read().queue.map((entry) => entry.id);
      await press(harness, width, height, theme, "Reload saved queue…");
      await press(harness, width, height, theme, "Keep draft");
      assert.deepEqual(
        read().queue.map((entry) => entry.id),
        conflictDraft,
      );
      await press(harness, width, height, theme, "Reload saved queue…");
      await press(harness, width, height, theme, "Discard draft and reload");
      assert.deepEqual(
        read().queue.map((entry) => entry.id),
        competing.load().entries.map((entry) => entry.id),
      );
      assert.equal(read().state.kind, "idle");
      await capture(harness, "reloaded-conflict");
      cases.push("publication-failure-retry-conflict-cancel-discard");
    } finally {
      harness.destroy();
      setUiScaleFactor(1);
    }
  }
  setUiScaleFactor(1);
  process.stdout.write(
    `${JSON.stringify({ actualCode: 0, cases, defaultWindow, actualMpv: !storageOnly, scope: "private media/files + actual public Window input; null audio output, no desktop/native input claim" })}\n`,
  );
});
