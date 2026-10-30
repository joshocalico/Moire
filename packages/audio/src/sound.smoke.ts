/**
 * The sound API above the stream layer, with a fake stream opener: WAV decode/encode, the alert
 * asset against its generator, the EnumFormat POD, playSound's pumping, gain, errors and
 * timeouts, recordLevels, recordStream's draining, the alert player's rate limit, and the input meter adapter.
 * (The stream layer itself: packages/sys/src/pipewire-stream.smoke.ts.)
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PipeWireStream, PipeWireStreamOptions, PipeWireStreamState } from "@moire/sys";
import { ALERT_SOUND_PATH, alertPcm } from "./alert";
import { createInputMeter, type InputMeterState, type LevelRecorder } from "./input-meter";
import { decodePod, encodePod, podNumber, podNumbers, podProp } from "./pod";
import {
  audioFormatPod,
  createAlertPlayer,
  playSound,
  recordLevels,
  recordStream,
  type StreamOpener,
} from "./sound";
import { SpaAudioFormat, SpaChannel, SpaFormat } from "./spa";
import {
  decodeWav,
  durationMs,
  encodePcm16,
  encodeWav,
  WAV_HEADER_BYTES,
  wavHeader,
  WavError,
} from "./wav";

let cases = 0;
async function test(label: string, check: () => Promise<void> | void) {
  await check();
  console.log(`ok ${++cases} ${label}`);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function wav(
  tag: number,
  channels: number,
  rate: number,
  bits: number,
  data: number[],
  extensible = false,
) {
  const fmtSize = extensible ? 40 : 16;
  const out = Buffer.alloc(12 + 8 + fmtSize + 8 + data.length);
  out.write("RIFF", 0, "latin1");
  out.writeUInt32LE(out.length - 8, 4);
  out.write("WAVE", 8, "latin1");
  out.write("fmt ", 12, "latin1");
  out.writeUInt32LE(fmtSize, 16);
  out.writeUInt16LE(extensible ? 0xfffe : tag, 20);
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE((rate * channels * bits) / 8, 28);
  out.writeUInt16LE((channels * bits) / 8, 32);
  out.writeUInt16LE(bits, 34);
  if (extensible) out.writeUInt16LE(tag, 20 + 24);
  const at = 20 + fmtSize;
  out.write("data", at, "latin1");
  out.writeUInt32LE(data.length, at + 4);
  Buffer.from(data).copy(out, at + 8);
  return new Uint8Array(out);
}

await test("WAV: every supported encoding decodes to F32; malformed files are refused", () => {
  const f32 = Buffer.alloc(8);
  f32.writeFloatLE(0.5, 0);
  f32.writeFloatLE(-0.25, 4);
  const f64 = Buffer.alloc(8);
  f64.writeDoubleLE(-1, 0);
  const cases: [Uint8Array, number[]][] = [
    [wav(1, 1, 8000, 8, [0, 128, 255]), [-1, 0, 127 / 128]],
    [wav(1, 2, 44100, 16, [0x00, 0x80, 0xff, 0x7f]), [-1, 32767 / 32768]],
    [wav(1, 1, 48000, 24, [0x00, 0x00, 0x40]), [0.5]],
    [wav(1, 1, 48000, 32, [0, 0, 0, 0xc0]), [-0.5]],
    [wav(3, 2, 48000, 32, [...f32]), [0.5, -0.25]],
    [wav(3, 1, 48000, 64, [...f64]), [-1]],
    [wav(1, 1, 48000, 16, [0x00, 0x40], true), [0.5]],
  ];
  for (const [bytes, expected] of cases) assert.deepEqual([...decodeWav(bytes).samples], expected);
  const stereo = decodeWav(wav(1, 2, 44100, 16, [0, 0, 0, 0]));
  assert.deepEqual([stereo.rate, stereo.channels], [44100, 2]);
  const bad = [
    new Uint8Array(8),
    wav(2, 1, 48000, 4, [0]), // ADPCM
    wav(1, 9, 48000, 16, [0, 0]),
    wav(1, 1, 100, 16, [0, 0]),
    wav(1, 1, 48000, 12, [0, 0]),
  ];
  for (const bytes of bad) assert.throws(() => decodeWav(bytes), WavError);
  const roundTrip = decodeWav(
    encodeWav({ rate: 22050, channels: 2, samples: Float32Array.from([0.5, -0.5, 1, -1, 2]) }),
  );
  assert.deepEqual(
    [...roundTrip.samples].map((x) => Math.round(x * 1000) / 1000),
    [0.5, -0.5, 1, -1],
  );
});

await test("the alert asset is the generator's output: 180 ms, mono, never clipping", () => {
  const generated = encodeWav(alertPcm());
  assert.deepEqual(
    new Uint8Array(fs.readFileSync(ALERT_SOUND_PATH)),
    generated,
    "run src/generate-alert-sound.ts",
  );
  const alert = decodeWav(generated);
  assert.deepEqual([alert.rate, alert.channels, Math.round(durationMs(alert))], [48000, 1, 180]);
  const peak = alert.samples.reduce((max, x) => Math.max(max, Math.abs(x)), 0);
  assert.ok(peak > 0.2 && peak < 0.9, `peak ${peak}`);
  assert.ok(Math.abs(alert.samples.at(-1)!) < 0.01, "ends without a click");
});

await test("EnumFormat: F32LE, rate, channels and positions", () => {
  const pod = decodePod(encodePod(audioFormatPod(44100, 2))).pod;
  assert.equal(podNumber(podProp(pod, SpaFormat.audioFormat)), SpaAudioFormat.F32LE);
  assert.equal(podNumber(podProp(pod, SpaFormat.audioRate)), 44100);
  assert.equal(podNumber(podProp(pod, SpaFormat.audioChannels)), 2);
  assert.deepEqual(podNumbers(podProp(pod, SpaFormat.audioPosition)), [
    SpaChannel.FL,
    SpaChannel.FR,
  ]);
  assert.equal(
    podProp(decodePod(encodePod(audioFormatPod(48000, 3))).pod, SpaFormat.audioPosition),
    undefined,
  );
});

type FakeStream = {
  options: PipeWireStreamOptions;
  written: number[];
  state: PipeWireStreamState;
  error: string | null;
  played: number;
  finished: boolean;
  closed: boolean;
  room: number;
  peak: number;
};

/** A stream that accepts `room` frames per write and plays 480 frames per 10 ms. */
function fakeOpener(configure: (stream: FakeStream) => void = () => {}) {
  const streams: FakeStream[] = [];
  const open: StreamOpener = (options) => {
    const fake: FakeStream = {
      options,
      written: [],
      state: "streaming",
      error: null,
      played: 0,
      finished: false,
      closed: false,
      room: 4800,
      peak: 0.3,
    };
    configure(fake);
    streams.push(fake);
    const started = performance.now();
    const playedBy = () =>
      fake.state === "streaming"
        ? Math.min(
            fake.written.length / options.channels,
            Math.floor(((performance.now() - started) / 10) * 480),
          )
        : 0;
    const stream = {
      channels: options.channels,
      write(samples: Float32Array) {
        const frames = Math.min(
          samples.length / options.channels,
          fake.room - (fake.written.length / options.channels - playedBy()),
        );
        if (frames <= 0) return 0;
        fake.written.push(...samples.subarray(0, frames * options.channels));
        return frames;
      },
      get bufferedFrames() {
        return fake.written.length / options.channels - playedBy();
      },
      counters: () => ({ frames: playedBy(), underruns: 0, overruns: 0 }),
      state: () => ({ state: fake.state, error: fake.error }),
      takeLevels: () => ({ peak: fake.peak, rms: fake.peak / 2, samples: 100 }),
      finish: () => {
        fake.finished = true;
      },
      close: () => {
        fake.closed = true;
      },
    };
    return { kind: "ok", stream: stream as unknown as PipeWireStream };
  };
  return { open, streams };
}

await test("playSound: notification stream, gain from the cubic volume, every sample in order", async () => {
  const { open, streams } = fakeOpener((stream) => (stream.room = 1000));
  const samples = Float32Array.from({ length: 6000 }, (_, i) => ((i % 100) - 50) / 50);
  const result = await playSound(
    { pcm: { rate: 48000, channels: 2, samples } },
    { volume: 0.5, open },
  );
  assert.deepEqual(result, { kind: "played" });
  const [stream] = streams;
  assert.equal(stream!.options.direction, "playback");
  assert.equal(stream!.options.properties["media.role"], "Notification");
  assert.equal(stream!.options.properties["media.type"], "Audio");
  assert.equal(stream!.options.channels, 2);
  assert.equal(
    podNumber(podProp(decodePod(stream!.options.format).pod, SpaFormat.audioRate)),
    48000,
  );
  assert.equal(stream!.written.length, samples.length);
  assert.ok(stream!.written.every((x, i) => Math.abs(x - samples[i]! * 0.125) < 1e-6));
  assert.ok(stream!.finished && stream!.closed);
});

await test("playSound: errors are values and the stream is always closed", async () => {
  const pcm = { rate: 8000, channels: 1, samples: new Float32Array(800) };
  const failing = fakeOpener((stream) => {
    stream.state = "error";
    stream.error = "no target";
  });
  assert.deepEqual(await playSound({ pcm }, { open: failing.open }), {
    kind: "error",
    message: "PipeWire stopped the sound: no target",
  });
  assert.ok(failing.streams[0]!.closed);
  const missing: StreamOpener = () => ({
    kind: "unavailable",
    message: "PipeWire's library isn't available",
  });
  assert.equal((await playSound({ pcm }, { open: missing })).kind, "unavailable");
  assert.equal((await playSound({ pcm }, { volume: 2, open: missing })).kind, "error");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-sound-"));
  fs.writeFileSync(path.join(directory, "bad.wav"), "not a wav");
  const bad = await playSound({ path: path.join(directory, "bad.wav") }, { open: missing });
  assert.deepEqual(bad, { kind: "error", message: "Can't read the sound: Not a WAV file." });
  assert.equal(
    (await playSound({ path: path.join(directory, "missing.wav") }, { open: missing })).kind,
    "error",
  );
  fs.rmSync(directory, { recursive: true });
  const stuck = fakeOpener((stream) => (stream.state = "connecting"));
  const started = performance.now();
  const result = await playSound({ pcm }, { open: stuck.open });
  assert.deepEqual(result, { kind: "error", message: "PipeWire didn't start playing the sound." });
  assert.ok(performance.now() - started < 4000);
  assert.ok(stuck.streams[0]!.closed);
  const aborted = new AbortController();
  aborted.abort();
  const { open } = fakeOpener();
  assert.equal((await playSound({ pcm }, { open, signal: aborted.signal })).kind, "error");
});

await test("recordLevels: a meter-only capture stream; levels per tick; PipeWire stopping ends it", async () => {
  const { open, streams } = fakeOpener();
  const levels: number[] = [];
  const ends: string[] = [];
  const result = recordLevels({
    open,
    intervalMs: 10,
    onLevels: ({ peak }) => levels.push(peak),
    onEnd: (m) => ends.push(m),
  });
  assert.equal(result.kind, "recording");
  const [stream] = streams;
  assert.equal(stream!.options.direction, "capture");
  assert.equal(stream!.options.ringBytes, 0, "levels only, no audio kept");
  assert.equal(stream!.options.properties["node.name"], "moire-input-meter");
  await sleep(40);
  assert.ok(levels.length >= 2 && levels.every((peak) => peak === 0.3));
  stream!.state = "error";
  await sleep(30);
  assert.deepEqual(ends, ["PipeWire stopped the input."]);
  assert.ok(stream!.closed);
  const second = fakeOpener();
  const recording = recordLevels({ open: second.open, intervalMs: 10, onLevels: () => {} });
  if (recording.kind === "recording") recording.recording.stop();
  assert.ok(second.streams[0]!.closed);
});

await test("recordStream: drains the ring in order, levels per tick, stop hands over the rest", async () => {
  // A capture ring the test fills: `pending` is what PipeWire has written and JS hasn't read.
  let options: PipeWireStreamOptions | null = null;
  let pending: number[] = [];
  let produced = 0;
  let state: PipeWireStreamState = "streaming";
  let closed = false;
  const open: StreamOpener = (o) => {
    options = o;
    return {
      kind: "ok",
      stream: {
        channels: o.channels,
        read(into: Float32Array) {
          const frames = Math.min(into.length, pending.length) / o.channels;
          into.set(pending.splice(0, frames * o.channels));
          return frames;
        },
        takeLevels: () => ({ peak: 1.5, rms: 0.25, samples: 10 }),
        counters: () => ({ frames: produced, underruns: 0, overruns: 3 }),
        state: () => ({ state, error: state === "error" ? "gone" : null }),
        close: () => {
          closed = true;
        },
      } as unknown as PipeWireStream,
    };
  };
  const push = (count: number) => {
    for (let i = 0; i < count; i++) pending.push(produced * 2 + i);
    produced += count / 2;
  };
  const chunks: number[] = [];
  const levels: number[] = [];
  const ends: string[] = [];
  const result = recordStream({
    open,
    rate: 8000,
    channels: 2,
    target: "usb-mic",
    intervalMs: 10,
    onChunk: (samples) => chunks.push(...samples),
    onLevels: ({ peak }) => levels.push(peak),
    onEnd: (message) => ends.push(message),
  });
  assert.equal(result.kind, "recording");
  if (result.kind !== "recording") return;
  const opened = options as PipeWireStreamOptions | null;
  assert.equal(opened?.direction, "capture");
  assert.equal(opened?.properties["target.object"], "usb-mic", "device selection by node name");
  assert.equal(opened?.ringBytes, 8000 * 2 * 4 * 2, "two seconds of headroom");
  // More than one scratch buffer's worth in one tick.
  push(8000);
  // Wait for ticks rather than a fixed time: a loaded builder can stretch a 10 ms interval.
  for (let i = 0; i < 200 && levels.length < 2; i++) await sleep(10);
  push(6);
  const end = result.recording.stop();
  assert.deepEqual(end, { frames: 4003, overruns: 3 });
  assert.ok(closed);
  assert.deepEqual(
    chunks,
    Array.from({ length: 8006 }, (_, i) => i),
    "every sample, in order, including what was buffered at stop",
  );
  assert.ok(levels.length >= 2 && levels.every((peak) => peak === 1), "levels are clamped");
  assert.deepEqual(result.recording.stop(), end, "stopping twice is harmless");
  assert.equal(ends.length, 0, "stop is silent");

  // PipeWire stopping the stream: the rest is delivered, then onEnd.
  pending = [];
  produced = 0;
  closed = false;
  chunks.length = 0;
  const second = recordStream({
    open,
    intervalMs: 10,
    onChunk: (samples) => chunks.push(...samples),
    onEnd: (message) => ends.push(message),
  });
  assert.equal(second.kind, "recording");
  push(4);
  state = "error";
  await sleep(40);
  assert.deepEqual(chunks, [0, 1, 2, 3]);
  assert.deepEqual(ends, ["PipeWire stopped the recording: gone"]);
  assert.ok(closed);
  state = "streaming";

  assert.equal(recordStream({ open, rate: 1, onChunk: () => {} }).kind, "error");
  assert.equal(recordStream({ open, channels: 9, onChunk: () => {} }).kind, "error");
  const missing: StreamOpener = () => ({ kind: "unavailable", message: "no PipeWire" });
  assert.deepEqual(recordStream({ open: missing, onChunk: () => {} }), {
    kind: "unavailable",
    message: "no PipeWire",
  });
});

await test("streaming WAV: header plus 16-bit data is what encodeWav writes", () => {
  const samples = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2, 0.25]);
  const data = encodePcm16(samples);
  const streamed = new Uint8Array(WAV_HEADER_BYTES + data.length);
  streamed.set(wavHeader(16000, 2, data.length));
  streamed.set(data, WAV_HEADER_BYTES);
  assert.deepEqual(streamed, encodeWav({ rate: 16000, channels: 2, samples }));
  const back = decodeWav(streamed);
  assert.equal(back.rate, 16000);
  assert.ok(
    back.samples.every((x, i) => Math.abs(x - Math.max(-1, Math.min(1, samples[i]!))) < 1e-4),
  );
});

await test("alert player: one at a time, at most one per gap, each failure reported once", async () => {
  let clock = 1000;
  const releases: (() => void)[] = [];
  const errors: string[] = [];
  let outcome: "played" | "unavailable" = "played";
  const player = createAlertPlayer({
    now: () => clock,
    onError: (message) => errors.push(message),
    play: () =>
      new Promise((resolve) =>
        releases.push(() =>
          resolve(
            outcome === "played"
              ? { kind: "played" }
              : { kind: "unavailable", message: "no PipeWire" },
          ),
        ),
      ),
  });
  assert.equal(player.play(), true);
  clock += 1000;
  assert.equal(player.play(), false, "still playing");
  releases.shift()!();
  await sleep(0);
  assert.equal(player.play(), true);
  releases.shift()!();
  await sleep(0);
  clock += 100;
  assert.equal(player.play(), false, "inside the gap");
  outcome = "unavailable";
  for (let i = 0; i < 3; i++) {
    clock += 1000;
    assert.equal(player.play(), true);
    releases.shift()!();
    await sleep(0);
  }
  assert.deepEqual(errors, ["no PipeWire"]);
});

await test("input meter: on with a recording, levels pass through, stops, times out, reports why", async () => {
  const states: InputMeterState[] = [];
  const levels: number[] = [];
  let stops = 0;
  let deliver: ((peak: number) => void) | null = null;
  let end: ((message: string) => void) | null = null;
  let available = true;
  const record: LevelRecorder = (options) => {
    if (!available) return { kind: "unavailable", message: "PipeWire's library isn't available" };
    deliver = (peak) => options.onLevels({ peak, rms: peak / 2 });
    end = options.onEnd;
    return { kind: "recording", recording: { stop: () => stops++ } };
  };
  const meter = createInputMeter({
    record,
    onLevel: (level) => levels.push(level),
    onState: (state) => states.push(state),
    maxMs: 60,
  });
  meter.start();
  meter.start();
  assert.deepEqual(meter.state, { kind: "on" });
  deliver!(0.42);
  assert.deepEqual(levels, [0.42]);
  meter.stop();
  assert.deepEqual([meter.state, stops], [{ kind: "off" }, 1]);
  deliver!(0.9);
  assert.deepEqual(levels, [0.42], "nothing after stop");
  meter.start();
  await sleep(100);
  assert.deepEqual([meter.state, stops], [{ kind: "off" }, 2], "stopped itself after maxMs");
  meter.start();
  end!("device gone");
  assert.deepEqual(meter.state, {
    kind: "unavailable",
    message: "The input level can't be read: device gone",
  });
  available = false;
  meter.start();
  assert.deepEqual(meter.state, {
    kind: "unavailable",
    message: "The input level can't be shown: PipeWire's library isn't available",
  });
  assert.deepEqual(
    states.map((state) => state.kind),
    ["on", "off", "on", "off", "on", "unavailable", "unavailable"],
  );
});

console.log(`Sound: ${cases} cases passed.`);
