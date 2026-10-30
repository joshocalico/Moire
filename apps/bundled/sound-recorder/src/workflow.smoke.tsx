/**
 * Sound Recorder driven through its window with stand-in recorder and player processes: a
 * missing microphone and Try again, record → Save under the automatic name, record → Save as… in
 * the chooser, play and stop a recording, Show in Files, and Move to Trash.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import type { PlaybackState } from "@moire/app-tools";
import { mountWindow, withFixture } from "@moire/app-tools/testing";
import { SoundRecorderApp, type RecorderControls } from "./main";
import type { RecordingState } from "./backend";
import type { InputDevice } from "./model";

const KEY = { home: 102, enter: 28, end: 107 };

/** Records a fixed take: a real WAV header and a second of silence. */
class TakeRecorder implements RecorderControls {
  private take = "";
  constructor(
    private readonly directory: string,
    private readonly change: (state: RecordingState) => void,
    private readonly level: (peak: number) => void,
  ) {}
  async start() {
    this.change({ kind: "recording", startedAt: Date.now() });
    // The meter beside "Recording" takes the input's level while the take runs.
    this.level(0.5);
  }
  async stop() {
    this.take = path.join(this.directory, `take-${Date.now()}.wav`);
    const bytes = 192000;
    const wav = Buffer.alloc(44 + bytes);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + bytes, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt32LE(192000, 28);
    wav.write("data", 36);
    wav.writeUInt32LE(bytes, 40);
    await fs.writeFile(this.take, wav);
    this.change({ kind: "ready", file: this.take, seconds: 1 });
  }
  async save(destination: string) {
    await fs.link(this.take, destination);
    return destination;
  }
  async discard() {
    this.change({ kind: "idle" });
  }
  async close() {}
}

await withFixture(async (home) => {
  const recordings = path.join(home, "Music", "Recordings");
  const takes = path.join(home, "takes");
  await fs.mkdir(takes);
  await fs.mkdir(path.join(home, "Documents"));
  const bin = path.join(home, "bin");
  const shown = path.join(home, "shown.txt");
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, "xdg-open"), `#!/bin/sh\nprintf '%s' "$1" > '${shown}'\n`, {
    mode: 0o755,
  });
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;

  let inputs: InputDevice[] = [
    { kind: "no-device", message: "No microphone was found. Connect one, then choose Try again." },
    { kind: "ready", name: "Fixture Mic" },
  ];
  const played: string[] = [];
  let playerClosed = 0;
  const app = await mountWindow(
    (size) => (
      <SoundRecorderApp
        {...size}
        probeInput={async () => inputs.shift() ?? { kind: "ready", name: "Fixture Mic" }}
        recorderFactory={(change, level) => new TakeRecorder(takes, change, level)}
        playerFactory={(change: (state: PlaybackState) => void) => ({
          open: async (file: string) => {
            played.push(file);
            change({ kind: "ready", file, paused: true, position: 0, duration: 1, volume: 100 });
          },
          control: async () => {},
          close: async () => {
            playerClosed++;
          },
        })}
      />
    ),
    { width: 1020, height: 700 },
  );
  try {
    await app.settle();
    // No microphone: recording is off, the reason is shown, and Try again checks again.
    assert.ok(app.texts().includes("No microphone was found. Connect one, then choose Try again."));
    assert.throws(() => app.press({ focusId: "recorder:record" }), /No visible control/);
    app.press({ focusId: "recorder:retry" });
    await app.settle();
    assert.ok(app.texts().includes("Fixture Mic"), "the microphone's name is in the title");

    // Record, stop, Save: the take lands in Music/Recordings under its dated name.
    app.press({ focusId: "recorder:record" });
    await app.settle();
    app.press({ focusId: "recorder:record" });
    await app.until(() => app.texts().includes("New take"), "the take is ready");
    const takeName = app
      .texts()
      .find((text) => text.startsWith("Recording ") && text.endsWith(".wav"))!;
    app.press({ focusId: "recorder:save" });
    await app.until(() => existsSync(path.join(recordings, takeName)), "saved to Recordings");
    await app.until(() => app.texts().includes("1 recording"), "listed");

    // Record again and Save as… into Documents through the chooser.
    app.press({ focusId: "recorder:record" });
    await app.settle();
    app.press({ focusId: "recorder:record" });
    await app.until(() => app.texts().includes("New take"), "the second take is ready");
    app.press({ focusId: "recorder:save-as" });
    await app.settle();
    assert.ok(app.texts().includes("Save recording as"));
    app.press({ text: "Documents" });
    await app.settle();
    const field = app
      .texts()
      .find((text) => text.startsWith("Recording ") && text.endsWith(".wav"))!;
    // Rename "….wav" to "… interview": Save as adds .wav back.
    app.press({ focusId: "file-chooser:name" });
    app.key(KEY.end, "End");
    for (let index = 0; index < 4; index++) app.key(14, "Backspace");
    app.type(" interview");
    app.key(KEY.enter, "Enter");
    const elsewhere = path.join(home, "Documents", `${field.replace(/\.wav$/, "")} interview.wav`);
    await app.until(() => existsSync(elsewhere), "saved where the chooser said, with .wav added");
    await app.until(
      () => app.texts().includes("2 recordings"),
      "recordings saved elsewhere are listed too",
    );

    // Play the newest recording from the list, then stop it.
    app.press({ focusId: "recorder:recordings" });
    app.key(KEY.home, "Home");
    app.key(KEY.enter, "Enter");
    await app.settle();
    assert.deepEqual(played, [elsewhere], "Enter plays the selected recording");
    assert.ok(app.texts().includes("0:00 / 0:01"), "the row shows playback position");
    app.press({ focusId: "recorder:play" });
    await app.settle();
    assert.equal(playerClosed, 1, "pressing Stop ends playback");

    // Show in Files, then Move to Trash.
    app.press({ focusId: "recorder:show" });
    await app.until(() => existsSync(shown), "Files was asked to show the recording");
    assert.equal(await fs.readFile(shown, "utf8"), pathToFileURL(path.dirname(elsewhere)).href);
    app.press({ focusId: "recorder:trash" });
    await app.until(() => !existsSync(elsewhere), "moved out of Documents");
    assert.ok(existsSync(path.join(home, "data", "Trash", "files", path.basename(elsewhere))));
    await app.until(
      () => app.texts().includes("1 recording"),
      "the trashed recording leaves the list",
    );
  } finally {
    app.destroy();
    process.env.PATH = previousPath;
    inputs = [];
  }
});
console.log(
  "[sound-recorder/workflow] no-device + Try again, Save, Save as…, play/stop, Show in Files, Move to Trash passed",
);
