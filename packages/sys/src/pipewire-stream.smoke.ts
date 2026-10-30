/**
 * The PipeWire stream layer against a fake libpipewire: the shim (native/moire-pwring.c) and the
 * fake (native/fake-pipewire/) are compiled with the host C compiler, then the ring is exercised
 * directly and real playback and capture streams run through koffi with the fake's data thread
 * calling the shim's `process` concurrently. Prints SKIP without a C compiler.
 */
import assert from "node:assert/strict";
import koffi from "koffi";
import { buildFakePipeWire, fakePipeWireHooks } from "./fake-pipewire";

const build = buildFakePipeWire();
if (!build) {
  console.log(`SKIP pipewire stream smoke: no C compiler (${process.env.CC ?? "cc"})`);
  process.exit(0);
}

process.env.MOIRE_PIPEWIRE_LIBRARY = build.pipewire;
process.env.MOIRE_PWRING_LIBRARY = build.pwring;
const { openPipeWireStream } = await import("./pipewire-stream");

const {
  sinkTake,
  format: formatBytes,
  connectFlags,
  connectDirection,
  setCaptureAmplitude: setAmplitude,
  streamsAlive,
  prop,
  failAll,
} = fakePipeWireHooks(build.pipewire);
const shim = koffi.load(build.pwring);
const ringNew = shim.func("void *moire_pwring_new(uint32_t capacity, uint32_t stride)");
const ringFree = shim.func("void moire_pwring_free(void *ring)");
const ringWrite = shim.func(
  "uint32_t moire_pwring_write(void *ring, const void *src, uint32_t bytes)",
);
const ringRead = shim.func("uint32_t moire_pwring_read(void *ring, void *dst, uint32_t bytes)");
const ringReadable = shim.func("uint32_t moire_pwring_readable(void *ring)");
const ringWritable = shim.func("uint32_t moire_pwring_writable(void *ring)");

let cases = 0;
async function test(label: string, check: () => Promise<void> | void) {
  await check();
  console.log(`ok ${++cases} ${label}`);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string, ms = 3000) {
  const deadline = performance.now() + ms;
  while (!check()) {
    if (performance.now() > deadline) throw new Error(`Timed out: ${label}`);
    await sleep(5);
  }
}

await test("ring: power-of-two capacity, whole frames, wraparound, full and empty", () => {
  assert.equal(ringNew(4096, 0), null, "zero stride refused");
  assert.equal(ringNew(1 << 27, 4), null, "oversized refused");
  const ring = ringNew(5000, 8);
  try {
    assert.equal(ringWritable(ring), 8192);
    const data = Uint8Array.from({ length: 8192 + 100 }, (_, i) => i & 0xff);
    assert.equal(ringWrite(ring, data, 13), 8, "partial frame left for later");
    assert.equal(ringWrite(ring, data.subarray(8), 8192 + 92), 8184, "only what fits");
    assert.equal(ringWritable(ring), 0);
    assert.equal(ringWrite(ring, data, 8), 0, "full");
    const out = new Uint8Array(8192);
    assert.equal(ringRead(ring, out, 6000), 6000);
    assert.deepEqual(out.subarray(0, 6000), data.subarray(0, 6000));
    // Wrap: 6000 free at the start, 2192 left at the end.
    const more = Uint8Array.from({ length: 4000 }, (_, i) => (i * 7) & 0xff);
    assert.equal(ringWrite(ring, more, 4000), 4000);
    assert.equal(ringReadable(ring), 2192 + 4000);
    const rest = new Uint8Array(8000);
    assert.equal(ringRead(ring, rest, 8000), 6192);
    assert.deepEqual(rest.subarray(0, 2192), data.subarray(6000, 8192));
    assert.deepEqual(rest.subarray(2192, 6192), more);
    assert.equal(ringRead(ring, rest, 8), 0, "empty");
  } finally {
    ringFree(ring);
  }
  const meterOnly = ringNew(0, 4);
  assert.equal(ringWrite(meterOnly, new Uint8Array(8), 8), 0);
  assert.equal(ringRead(meterOnly, new Uint8Array(8), 8), 0);
  ringFree(meterOnly);
});

const format = Uint8Array.from([8, 0, 0, 0, 15, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);

await test("playback: props, format and flags reach PipeWire; samples arrive in order", async () => {
  const opened = openPipeWireStream({
    direction: "playback",
    name: "moire-test",
    properties: { "media.role": "Notification", "node.name": "moire-alert" },
    format,
    channels: 2,
    ringBytes: 1 << 16,
  });
  assert.equal(opened.kind, "ok", opened.kind === "ok" ? "" : opened.message);
  if (opened.kind !== "ok") return;
  const stream = opened.stream;
  try {
    assert.equal(prop("media.role"), "Notification");
    assert.equal(prop("node.name"), "moire-alert");
    assert.equal(connectDirection(), 1);
    assert.equal(connectFlags(), 1 | 4 | 16, "autoconnect, map buffers, realtime process");
    const seen = new Uint8Array(64);
    assert.deepEqual(seen.subarray(0, formatBytes(seen, 64)), format);
    assert.equal(stream.state().state, "streaming");
    sinkTake(new Uint8Array(1 << 20), 1 << 20); // drop the leading silence
    const frames = 3000;
    const samples = Float32Array.from({ length: frames * 2 }, (_, i) => (i + 1) / (frames * 2));
    assert.equal(stream.write(samples), frames);
    stream.finish();
    await until(() => stream.bufferedFrames === 0, "ring drained");
    await sleep(20);
    const sink = new Uint8Array(1 << 20);
    const got = new Float32Array(sink.buffer, 0, Number(sinkTake(sink, sink.length)) / 4);
    const start = got.indexOf(samples[0]!);
    assert.ok(start >= 0, "first sample reached the sink");
    assert.deepEqual(got.subarray(start, start + samples.length), samples);
    assert.ok(
      got.subarray(start + samples.length).every((x) => x === 0),
      "silence after the end",
    );
    const counters = stream.counters();
    assert.equal(counters.frames, frames);
    assert.equal(counters.underruns, 0, "silence after finish is not an underrun");
  } finally {
    stream.close();
  }
  assert.equal(streamsAlive(), 0);
});

await test("playback: running dry mid-sound counts underruns", async () => {
  const opened = openPipeWireStream({
    direction: "playback",
    name: "t",
    properties: {},
    format,
    channels: 1,
    ringBytes: 4096,
  });
  assert.equal(opened.kind, "ok");
  if (opened.kind !== "ok") return;
  opened.stream.write(new Float32Array(64).fill(0.25));
  await until(() => opened.stream.counters().underruns > 0, "underrun after the ring emptied");
  opened.stream.close();
  assert.equal(opened.stream.write(new Float32Array(4)), 0, "closed streams take nothing");
});

await test("capture: levels from the realtime thread; audio kept when there is room", async () => {
  setAmplitude(0.5);
  const opened = openPipeWireStream({
    direction: "capture",
    name: "meter",
    properties: {},
    format,
    channels: 1,
    ringBytes: 1 << 16,
  });
  assert.equal(opened.kind, "ok");
  if (opened.kind !== "ok") return;
  const stream = opened.stream;
  try {
    assert.equal(connectDirection(), 0);
    await sleep(30);
    let levels = stream.takeLevels();
    assert.ok(levels.samples > 0);
    assert.ok(
      Math.abs(levels.peak - 0.5) < 1e-6 && Math.abs(levels.rms - 0.5) < 1e-4,
      JSON.stringify(levels),
    );
    const audio = new Float32Array(256);
    assert.equal(stream.read(audio), 256);
    assert.ok(audio.every((x) => Math.abs(x) === 0.5));
    setAmplitude(0.125);
    stream.takeLevels();
    await sleep(30);
    levels = stream.takeLevels();
    assert.ok(Math.abs(levels.peak - 0.125) < 1e-6, JSON.stringify(levels));
    // Nobody reads: the ring fills and further buffers are dropped and counted.
    await until(() => stream.counters().overruns > 0, "overrun once full", 5000);
    failAll(1);
    assert.deepEqual(stream.state(), { state: "error", error: "fake failure" });
    failAll(0);
  } finally {
    stream.close();
  }
  const meterOnly = openPipeWireStream({
    direction: "capture",
    name: "m",
    properties: {},
    format,
    channels: 1,
    ringBytes: 0,
  });
  assert.equal(meterOnly.kind, "ok");
  if (meterOnly.kind === "ok") {
    await sleep(20);
    assert.ok(meterOnly.stream.takeLevels().samples > 0);
    assert.equal(meterOnly.stream.counters().overruns, 0, "a meter keeps no audio");
    meterOnly.stream.close();
  }
  assert.equal(streamsAlive(), 0);
});

await test("bad options are errors, not crashes", () => {
  const opened = openPipeWireStream({
    direction: "playback",
    name: "t",
    properties: {},
    format,
    channels: 9,
    ringBytes: 4096,
  });
  assert.equal(opened.kind, "error");
});

build.remove();
console.log(`PipeWire streams: ${cases} cases passed against the fake libpipewire.`);
