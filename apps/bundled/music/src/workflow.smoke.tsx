/** Real tagged media, atomic storage and Window input; no public requests or audible output. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import React from "react";
import { runTool, PlayerApp, type PlaybackState } from "@moire/app-tools";
import { withFixture } from "@moire/app-tools/testing";
import {
  THEME_FAMILIES,
  WidgetThemeProvider,
  createPersonalizedWidgetTheme,
  discoverPersonalization,
  setUiScaleFactor,
} from "@moire/ui";
import { MusicApp } from "./main";
import { MusicLibraryStore, albumsFor, filterTracks, importMusic, probeTrack } from "./library";
import { musicHarness } from "./testing";
import type { QueueEntry, MusicPlaybackOptions } from "./controller";
const captureDirectory = process.env.MOIRE_MUSIC_CAPTURE_DIR ?? "/tmp/moire-music-v0-captures";
await withFixture(async (directory) => {
  const source = path.join(directory, "album with spaces λ");
  await fs.mkdir(source);
  for (const [number, title] of [
    [1, "First light"],
    [2, "Soft geometry"],
    [3, "Leaves in the current"],
  ] as const) {
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
      path.join(source, `${number}.flac`),
    ]);
  }
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
    path.join(source, "cover.png"),
  ]);
  const embeddedDirectory = path.join(directory, "embedded");
  await fs.mkdir(embeddedDirectory);
  const embedded = path.join(embeddedDirectory, "embedded.flac");
  await runTool("ffmpeg", [
    "-v",
    "error",
    "-i",
    path.join(source, "1.flac"),
    "-i",
    path.join(source, "cover.png"),
    "-map",
    "0:a",
    "-map",
    "1:v",
    "-c:a",
    "copy",
    "-c:v",
    "png",
    "-disposition:v",
    "attached_pic",
    embedded,
  ]);
  const embeddedTrack = await probeTrack(embedded, path.join(directory, "embedded-cache"));
  assert.ok(
    embeddedTrack.artwork && fsSync.existsSync(embeddedTrack.artwork),
    "embedded PNG artwork was not extracted",
  );
  assert.ok(
    fsSync
      .readFileSync(embeddedTrack.artwork)
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  );
  await fs.writeFile(path.join(source, "broken.flac"), "not audio");
  await fs.symlink(source, path.join(source, "cycle"));
  const baseline = await musicHarness((size) => <PlayerApp {...size} />);
  try {
    await baseline.capture(path.join(captureDirectory, "music-before-player-wrapper-1280x820.png"));
  } finally {
    baseline.destroy();
  }
  const store = new MusicLibraryStore(path.join(directory, "library"));
  const result = await importMusic([source], store, new AbortController().signal);
  assert.equal(result.library.tracks.length, 3);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.library.tracks[0]?.artist, "Lumen");
  assert.equal(result.library.tracks[0]?.number, 1);
  const canonicalCover = await fs.realpath(path.join(source, "cover.png"));
  assert.ok(
    result.library.tracks.every((track) => track.duration >= 3 && track.artwork === canonicalCover),
  );
  assert.equal(albumsFor(result.library.tracks).length, 1);
  assert.equal(filterTracks(result.library.tracks, "GEOMETRY").length, 3);
  assert.equal(fsSync.statSync(store.file).mode & 0o777, 0o600);
  const alias = path.join(directory, "song-alias"),
    untyped = path.join(directory, "audio-without-extension");
  await fs.symlink(path.join(source, "1.flac"), alias);
  await fs.copyFile(path.join(source, "2.flac"), untyped);
  const aliasResult = await importMusic(
    [alias, untyped],
    new MusicLibraryStore(path.join(directory, "aliases")),
    new AbortController().signal,
  );
  assert.equal(
    aliasResult.library.tracks.length,
    2,
    "direct audio associations must support symlinks and missing extensions",
  );
  const stale = store.load(),
    saved = store.save({
      ...stale,
      tracks: stale.tracks.map((track, index) =>
        index ? track : { ...track, addedAt: track.addedAt + 1 },
      ),
    });
  assert.throws(() => store.save(stale), /another window/);
  const lock = path.join(store.directory, ".write-lock");
  await fs.writeFile(lock, "");
  const old = new Date(Date.now() - 31000);
  await fs.utimes(lock, old, old);
  store.save(saved);
  assert.ok(!fsSync.existsSync(lock), "crashed partial lock was not recovered");
  const before = await fs.readFile(store.file, "utf8");
  await fs.writeFile(store.file, "{ broken");
  assert.throws(() => store.load());
  assert.throws(() => store.save(saved));
  assert.equal(await fs.readFile(store.file, "utf8"), "{ broken");
  await fs.writeFile(store.file, before);
  // The null AO simulates device buffering. Keep its delay below the paused-seek
  // oracle's precision; its default buffer reports a stale PTS until playback resumes.
  let options: MusicPlaybackOptions = {
    extraArgs: ["--ao=null", "--ao-null-buffer=0.01", "--vo=null"],
  };
  let realMpv = true;
  try {
    execFileSync("mpv", ["--version"], { stdio: "ignore" });
  } catch {
    realMpv = false;
  }
  if (!realMpv) {
    // A real child process exercises PlaybackSession's IPC/EOF boundary on hosts without mpv.
    // This is a protocol fixture, never reported as decoded/audio playback.
    const executable = path.join(directory, "mpv-protocol-fixture"),
      log = path.join(directory, "ipc.log");
    await fs.writeFile(
      executable,
      `#!/usr/bin/env node
import net from 'node:net';import fs from 'node:fs';
const endpoint=process.argv.find(v=>v.startsWith('--input-ipc-server=')).split('=').slice(1).join('=');
let socket,paused=true,position=0,volume=100,duration=3,loaded=false;
const send=value=>socket?.write(JSON.stringify(value)+'\\n');
const server=net.createServer(client=>{socket=client;let text='';client.on('data',bytes=>{text+=bytes.toString();for(;;){const at=text.indexOf('\\n');if(at<0)break;
const value=JSON.parse(text.slice(0,at));text=text.slice(at+1);const c=value.command;fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(c)+'\\n');let data=null;
if(c[0]==='loadfile'){loaded=true;position=0;send({event:'file-loaded'});send({event:'playback-restart'});}
if(c[0]==='get_property')data=({'pause':paused,'time-pos':position,'duration':duration,'volume':volume})[c[1]]??null;
if(c[0]==='set_property'){if(c[1]==='pause')paused=c[2];if(c[1]==='volume')volume=c[2];}
if(c[0]==='cycle'&&c[1]==='pause')paused=!paused;
if(c[0]==='seek')position=c[1];send({request_id:value.request_id,error:'success',data});}});});
server.listen(endpoint);const timer=setInterval(()=>{if(loaded&&!paused){position+=.1;if(position>=duration){loaded=false;send({event:'end-file',reason:'eof'});}}},100);
process.on('SIGTERM',()=>{clearInterval(timer);socket?.destroy();server.close(()=>process.exit(0));});
`,
      { mode: 0o700 },
    );
    options = { binary: executable };
  }
  const theme = createPersonalizedWidgetTheme(
    discoverPersonalization("linux", {
      themeFamily: "moire",
      colorScheme: "dark",
      reducedMotion: true,
    }),
  );
  let observed: { state: PlaybackState; queue: readonly QueueEntry[]; index: number } = {
    state: { kind: "idle" },
    queue: [],
    index: 0,
  };
  const observe = (state: PlaybackState, queue: readonly QueueEntry[], index: number) => {
    observed = { state, queue, index };
  };
  const files = store.load().tracks.map((track) => track.path);
  const app = await musicHarness((size, window) => (
    <WidgetThemeProvider theme={theme}>
      <MusicApp
        {...size}
        windowActions={window}
        store={store}
        initialPaths={files}
        playbackOptions={options}
        onPlaybackStateChange={observe}
      />
    </WidgetThemeProvider>
  ));
  try {
    await app.settle(() => observed.state.kind === "ready" && observed.state.duration >= 3);
    assert.equal(observed.queue.length, 3);
    assert.equal(observed.index, 0);
    assert.equal(
      observed.state.kind === "ready" && observed.state.paused,
      true,
      "file association played unsolicited audio",
    );
    await app.capture(path.join(captureDirectory, "music-wide-1280x820.png"));
    // Real keyboard activation of transport; the Play button is below the centre pane.
    app.click(1280 / 2, 820 - 112 + 24);
    await app.settle(() => observed.state.kind === "ready" && !observed.state.paused);
    await app.settle(() => observed.state.kind === "ready" && observed.state.position >= 0.2);
    app.key(57, " ");
    await app.settle(() => observed.state.kind === "ready" && observed.state.paused);
    const pausedPosition = observed.state.kind === "ready" ? observed.state.position : 0;
    await app.settle();
    await app.settle();
    assert.ok(
      observed.state.kind === "ready" && Math.abs(observed.state.position - pausedPosition) < 0.2,
      "paused playback continued advancing",
    );
    const seekPaused = async (fraction: number) => {
      const target = (Math.round(fraction * 100) / 100) * 3;
      app.click(60 + (1280 - 332) * fraction, 820 - 112 + 83);
      await app.settle(
        () =>
          observed.state.kind === "ready" &&
          observed.state.paused &&
          Math.abs(observed.state.position - target) < 0.05,
      );
      await app.settle();
      await app.settle();
      assert.ok(
        observed.state.kind === "ready" &&
          observed.state.paused &&
          Math.abs(observed.state.position - target) < 0.05,
        `paused seek to ${target} did not remain stable: ${JSON.stringify(observed.state)}`,
      );
    };
    await seekPaused(1 / 3);
    await seekPaused(0.5);
    await seekPaused(0.25);
    app.click(1280 / 2, 820 - 112 + 24);
    await app.settle(() => observed.state.kind === "ready" && !observed.state.paused);
    assert.ok(
      observed.state.kind === "ready" &&
        observed.state.position >= 0.7 &&
        observed.state.position <= 1.1,
      "resuming playback lost the paused seek target",
    );
    // Seek to the end through the actual slider pointer boundary; EOF must advance the queue.
    app.click(60 + (1280 - 332) * 0.995, 820 - 112 + 83);
    await app.settle(() => observed.index === 1 && observed.state.kind === "ready");
    assert.equal(observed.queue[1]?.track.title, "Soft geometry");
    await app.settle(() => observed.state.kind === "ready" && !observed.state.paused);
    app.click(1280 / 2, 820 - 112 + 24);
    await app.settle(
      () => observed.index === 1 && observed.state.kind === "ready" && observed.state.paused,
    );
    app.native.setSize(640, 760);
    app.window.tick();
    await app.settle();
    await app.capture(path.join(captureDirectory, "music-compact-640x760.png"));
    assert.equal(observed.index, 1, "resize reset playback");
    // Compact Queue opens its own active pane; Escape returns to the music content.
    app.click(640 - 50, 760 - 190 + 24);
    await app.settle();
    await app.capture(path.join(captureDirectory, "music-compact-queue-640x760.png"));
    app.key(1, "Escape");
    await app.settle();
    assert.equal(observed.queue.length, 3);
    // Return to the wide queue and activate its second track with Enter.
    app.native.setSize(1280, 820);
    app.window.tick();
    await app.settle();
    app.click(1230, 820 - 112 + 24);
    await app.settle();
    app.click(1170, 204);
    app.key(28, "Enter");
    await app.settle(
      () => observed.index === 1 && observed.state.kind === "ready" && !observed.state.paused,
    );
    // Stop, restart and Next are separate supported controls.
    app.click(1280 / 2 + 108, 820 - 112 + 24);
    await app.settle(() => observed.state.kind === "idle");
    app.click(1280 / 2, 820 - 112 + 24);
    await app.settle(() => observed.state.kind === "ready");
    app.click(1170, 310);
    await app.settle();
    app.click(1130, 600);
    await app.settle(() => observed.queue.length === 2);
    assert.equal(observed.index, 1, "removing an upcoming track reset the current index");
    app.click(400, 650);
    await app.settle(() => store.load().tracks.length === 2);
    assert.ok(fsSync.existsSync(files[0]!), "library removal deleted the source audio");
    assert.ok(app.native.lastFrame?.some((value) => value !== 0));
  } finally {
    app.destroy();
  }
  // A fresh instance reloads local metadata without scanning or starting any backend.
  setUiScaleFactor(1.5);
  const next = await musicHarness(
    (size, window) => (
      <WidgetThemeProvider theme={theme}>
        <MusicApp {...size} windowActions={window} store={store} />
      </WidgetThemeProvider>
    ),
    1530,
    1050,
  );
  try {
    await next.settle();
    await next.capture(path.join(captureDirectory, "music-library-1020-scale1.5.png"));
  } finally {
    next.destroy();
    setUiScaleFactor(1);
  }
  let frames = 0;
  for (const family of THEME_FAMILIES)
    for (const colorScheme of ["dark", "light"] as const)
      for (const scale of [1, 1.5]) {
        setUiScaleFactor(scale);
        const variant = createPersonalizedWidgetTheme(
          discoverPersonalization("linux", {
            themeFamily: family,
            colorScheme,
            reducedMotion: true,
          }),
        );
        const themed = await musicHarness(
          (size, window) => (
            <WidgetThemeProvider theme={variant}>
              <MusicApp {...size} windowActions={window} store={store} />
            </WidgetThemeProvider>
          ),
          1280 * scale,
          820 * scale,
        );
        try {
          await themed.settle();
          // Actual album selection from the collection opens detail; no playback is started.
          themed.click((208 + 7 + 50) * scale, 136 * scale);
          await themed.settle();
          assert.ok(themed.native.lastFrame?.some((value) => value !== 0));
          frames++;
          themed.native.setSize(640 * scale, 480 * scale);
          themed.window.tick();
          await themed.settle();
          assert.equal(themed.native.lastFrame?.length, 640 * scale * 480 * scale * 4);
          frames++;
          if (family === "moire" && colorScheme === "light" && scale === 1.5)
            await themed.capture(
              path.join(captureDirectory, "music-album-light-640x480-scale1.5.png"),
            );
        } finally {
          themed.destroy();
        }
      }
  setUiScaleFactor(1);
  console.log(
    `Music ${frames} actual themed/scaled wide/short-compact Window frames passed; fixture tags are generated local media, artwork comes from Moire's bundled botanical asset.`,
  );
  console.log(
    `Music actual Window file-association/paused load/play/seek/EOF-next/resize/queue/stop/restart and local metadata/storage passed (${realMpv ? "actual mpv null audio" : "real child IPC protocol fixture; mpv unavailable"}); captures ${captureDirectory}`,
  );
});
