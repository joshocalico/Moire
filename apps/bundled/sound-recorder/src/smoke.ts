/**
 * Sound Recorder's backend: the recorder against a missing PipeWire and a silent input, then real
 * capture streams through koffi against the fake libpipewire (whose data thread delivers a ±0.5
 * square wave), written to WAV in TS; the input probe; and the recordings list. With
 * MOIRE_TEST_AUDIO_INPUT=1 it records from the session's real PipeWire input instead.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { AudioControl, decodeWav, type StreamOpener } from "@moire/audio";
import {
  buildFakePipeWire,
  fakePipeWireHooks,
  FakePipeWireServer,
  type FakePipeWireBuild,
} from "@moire/audio/testing";
import { withFixture } from "@moire/app-tools/testing";
import { Recorder, listRecordings, probeInput, type RecordingState } from "./backend";

const live = process.env.MOIRE_TEST_AUDIO_INPUT === "1";
// Built before the fixture swaps TMPDIR, and pointed at before the first stream loads libpipewire.
const build: FakePipeWireBuild | null = live ? null : buildFakePipeWire();
if (build) {
  process.env.MOIRE_PIPEWIRE_LIBRARY = build.pipewire;
  process.env.MOIRE_PWRING_LIBRARY = build.pwring;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string, ms = 5000) {
  const deadline = performance.now() + ms;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(10);
  }
}

/** A recorder whose state the test can read at any time. */
function recorderWith(options: ConstructorParameters<typeof Recorder>[1] = {}) {
  const box: { state: RecordingState; levels: number[] } = { state: { kind: "idle" }, levels: [] };
  const recorder = new Recorder(
    (value) => {
      box.state = value;
    },
    { onLevel: (peak) => box.levels.push(peak), ...options },
  );
  return { recorder, box, state: () => box.state };
}

try {
  await withFixture(async (directory) => {
    const tmp = path.join(directory, "tmp");
    const leftovers = async () =>
      (await fs.readdir(tmp)).filter((name) => name.startsWith("moire-recording-"));

    // No PipeWire library: an error state, no process, nothing left behind.
    const missing: StreamOpener = () => ({
      kind: "unavailable",
      message: "PipeWire's library isn't available: libpipewire-0.3.so.0: not found",
    });
    {
      const { recorder, state } = recorderWith({ open: missing });
      try {
        await assert.rejects(recorder.start(), /PipeWire isn't available/);
        const current = state();
        assert.equal(current.kind, "error");
        assert.match(current.kind === "error" ? current.message : "", /libpipewire/);
        await assert.rejects(recorder.stop(), /no active recording/);
        await assert.rejects(
          recorder.save(path.join(directory, "not-recorded.wav")),
          /captured audio/,
        );
        assert.deepEqual(await leftovers(), []);
      } finally {
        await recorder.close();
      }
    }

    // A stream that connects but never delivers audio ends with an error, not a silent take.
    {
      let closed = false;
      const silent: StreamOpener = () => ({
        kind: "ok",
        stream: {
          channels: 2,
          read: () => 0,
          takeLevels: () => ({ peak: 0, rms: 0, samples: 0 }),
          counters: () => ({ frames: 0, underruns: 0, overruns: 0 }),
          state: () => ({ state: "connecting", error: null }),
          close: () => {
            closed = true;
          },
        } as never,
      });
      const { recorder, state } = recorderWith({ open: silent });
      try {
        await recorder.start();
        assert.equal(state().kind, "recording");
        await until(() => state().kind === "error", "no-audio error");
        const current = state();
        assert.match(current.kind === "error" ? current.message : "", /No audio arrived/);
        assert.ok(closed, "the stream is closed");
        await assert.rejects(recorder.stop(), /no active recording/);
      } finally {
        await recorder.close();
      }
      assert.deepEqual(await leftovers(), []);
    }

    if (build) {
      const fake = fakePipeWireHooks(build.pipewire);
      fake.setCaptureAmplitude(0.5);

      // A take: a capture stream from the default source, metered, written as 16-bit WAV.
      const { recorder, box, state } = recorderWith();
      try {
        await recorder.start();
        assert.equal(state().kind, "recording");
        assert.equal(fake.connectDirection(), 0, "a capture stream");
        assert.equal(fake.prop("media.category"), "Capture");
        assert.equal(fake.prop("node.name"), "moire-sound-recorder");
        assert.equal(fake.streamsAlive(), 1);
        await until(() => box.levels.length >= 3, "level reports");
        assert.ok(
          box.levels.every((peak) => Math.abs(peak - 0.5) < 1e-6),
          JSON.stringify(box.levels),
        );
        await recorder.stop();
        assert.equal(fake.streamsAlive(), 0, "the stream is destroyed on stop");
        const take = state();
        assert.equal(take.kind, "ready", JSON.stringify(take));
        if (take.kind !== "ready") return;
        assert.equal(take.note, undefined);
        const bytes = await fs.readFile(take.file);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        assert.equal(view.getUint32(4, true), bytes.length - 8, "RIFF size finalised");
        assert.equal(view.getUint32(40, true), bytes.length - 44, "data size finalised");
        const pcm = decodeWav(bytes);
        assert.equal(pcm.rate, 48000);
        assert.equal(pcm.channels, 2);
        assert.ok(pcm.samples.length > 0);
        assert.ok(
          pcm.samples.every((x) => Math.abs(Math.abs(x) - 0.5) < 1e-4),
          "every captured sample reached the file, in whole frames",
        );
        assert.equal(take.seconds, pcm.samples.length / 2 / 48000);

        // Save without overwriting, then discard.
        const output = path.join(directory, "saved.wav");
        await recorder.save(output);
        assert.deepEqual(await fs.readFile(output), bytes);
        await assert.rejects(recorder.save(output), { code: "EEXIST" });
        assert.deepEqual(await fs.readFile(output), bytes);
        await recorder.discard();
        assert.equal(state().kind, "idle");
        await assert.rejects(fs.stat(take.file), { code: "ENOENT" });

        // PipeWire stopping mid-take keeps what was captured and says so.
        await recorder.start();
        await until(() => box.levels.length >= 6, "more level reports");
        fake.failAll(1);
        await until(() => state().kind !== "recording", "the take ends");
        fake.failAll(0);
        const early = state();
        assert.equal(early.kind, "ready", JSON.stringify(early));
        assert.match(early.kind === "ready" ? (early.note ?? "") : "", /ended early.*fake failure/);
        assert.equal(fake.streamsAlive(), 0);
        await recorder.discard();

        // Closing the window mid-take stops the stream and removes the private file.
        await recorder.start();
        await sleep(50);
      } finally {
        await recorder.close();
      }
      assert.equal(fake.streamsAlive(), 0);
      assert.deepEqual(await leftovers(), []);
    } else if (!live) console.log("SKIP capture through the fake libpipewire: no C compiler");

    // The input check: PipeWire's answer: a named default source, none, or no PipeWire at all.
    const server = FakePipeWireServer.standard(await FakePipeWireServer.start());
    const control = new AudioControl({ socketPath: server.path });
    try {
      const read = () => control.read();
      assert.deepEqual(await probeInput({ read }), { kind: "ready", name: "Microphone" });
      server.setMetadata("default.audio.source", null);
      assert.equal((await probeInput({ read })).kind, "no-device");
    } finally {
      control.close();
      await server.close();
    }
    const absent = new AudioControl({ socketPath: path.join(directory, "no-pipewire") });
    const gone = await probeInput({ read: () => absent.read() });
    absent.close();
    assert.deepEqual(gone, {
      kind: "unavailable",
      message: "PipeWire isn't running, so nothing can be recorded.",
    });
    assert.deepEqual(
      await probeInput({
        read: async () => {
          throw new Error("PipeWire didn't answer in time.");
        },
      }),
      { kind: "ready", name: "Default input" },
      "when PipeWire can't say, the default input is assumed",
    );

    // The recordings list: WAVs in the folder plus saved files elsewhere, newest first.
    const folder = path.join(directory, "Recordings");
    await fs.mkdir(folder);
    const header = (bytes: number) => {
      const buffer = Buffer.alloc(44 + bytes);
      buffer.write("RIFF", 0);
      buffer.writeUInt32LE(36 + bytes, 4);
      buffer.write("WAVEfmt ", 8);
      buffer.writeUInt32LE(16, 16);
      buffer.writeUInt32LE(192000, 28);
      buffer.write("data", 36);
      buffer.writeUInt32LE(bytes, 40);
      return buffer;
    };
    await fs.writeFile(path.join(folder, "old.wav"), header(192000));
    await fs.utimes(path.join(folder, "old.wav"), 1000, 1000);
    await fs.writeFile(path.join(folder, "notes.txt"), "not audio");
    const elsewhere = path.join(directory, "elsewhere.wav");
    await fs.writeFile(elsewhere, header(384000));
    const listed = await listRecordings(folder, [elsewhere, path.join(directory, "gone.wav")]);
    assert.deepEqual(
      listed.map((item) => [item.name, item.seconds]),
      [
        ["elsewhere.wav", 2],
        ["old.wav", 1],
      ],
    );
    assert.deepEqual(await listRecordings(path.join(directory, "missing")), []);

    if (live) {
      const { recorder: capture, state: get } = recorderWith();
      try {
        await capture.start();
        await sleep(1200);
        await capture.stop();
        assert.equal(get().kind, "ready", "the disposable PipeWire input must deliver audio");
        const output = path.join(directory, "live.wav");
        await capture.save(output);
        assert.ok((await fs.stat(output)).size > 44);
        await capture.discard();
        assert.equal(get().kind, "idle");
        console.log("[sound-recorder] real PipeWire capture, save and discard passed");
      } finally {
        await capture.close();
      }
    }
    console.log(
      `[sound-recorder] missing PipeWire, silent input, ${build ? "fake-libpipewire capture to WAV, early end, close mid-take, " : ""}input probe and recordings list passed${live ? "" : "; real capture needs MOIRE_TEST_AUDIO_INPUT=1 with a disposable PipeWire input"}`,
    );
  });
} finally {
  build?.remove();
}
