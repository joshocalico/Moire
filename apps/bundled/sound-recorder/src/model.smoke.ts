/** Sound Recorder's naming, states, close rules and WAV lengths, without processes or windows. */
import assert from "node:assert/strict";
import {
  closeBlockReason,
  defaultRecordingName,
  describe,
  sortRecordings,
  wavSeconds,
  withWavExtension,
} from "./model";

assert.equal(defaultRecordingName(new Date(2026, 9, 3, 7, 5, 9)), "Recording 2026-10-03 07.05.09");
assert.equal(withWavExtension("/m/take"), "/m/take.wav");
assert.equal(withWavExtension("/m/take.WAV"), "/m/take.WAV");

const ready = { kind: "ready", file: "/tmp/t.wav", seconds: 2.5 } as const;
assert.match(
  closeBlockReason({ kind: "recording", startedAt: 0 }, false, false)!,
  /recording is active/,
);
assert.match(closeBlockReason(ready, false, false)!, /unsaved/);
assert.match(closeBlockReason({ kind: "idle" }, false, true)!, /wait for the current operation/);
assert.equal(closeBlockReason(ready, true, false), null);
assert.equal(closeBlockReason({ kind: "idle" }, false, false), null);

const mic = { kind: "ready", name: "USB Mic" } as const;
assert.equal(describe({ kind: "idle" }, null, mic).detail, "Records from USB Mic.");
assert.equal(
  describe({ kind: "recording", startedAt: 0 }, null, mic).detail,
  "Recording from USB Mic",
);
const missing = { kind: "no-device", message: "No microphone was found." } as const;
assert.deepEqual(describe({ kind: "idle" }, null, missing), {
  label: "Can't record",
  detail: "No microphone was found.",
});
assert.equal(describe(ready, "/m/a.wav", mic).label, "Saved");

// A 48 kHz stereo 16-bit WAV: 192000 bytes a second.
function wav(seconds: number, options: { list?: boolean; unsetSize?: boolean } = {}): Buffer {
  const data = Math.round(seconds * 192000);
  const list = options.list
    ? Buffer.concat([Buffer.from("LIST"), u32(4), Buffer.from("INFO")])
    : Buffer.alloc(0);
  const fmt = Buffer.alloc(24);
  fmt.write("fmt ", 0);
  fmt.writeUInt32LE(16, 4);
  fmt.writeUInt16LE(1, 8);
  fmt.writeUInt16LE(2, 10);
  fmt.writeUInt32LE(48000, 12);
  fmt.writeUInt32LE(192000, 16);
  fmt.writeUInt16LE(4, 20);
  fmt.writeUInt16LE(16, 22);
  const body = Buffer.concat([
    Buffer.from("WAVE"),
    fmt,
    list,
    Buffer.from("data"),
    u32(options.unsetSize ? 0xffffffff : data),
    Buffer.alloc(data),
  ]);
  return Buffer.concat([Buffer.from("RIFF"), u32(body.length), body]);
}
function u32(value: number): Buffer {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value);
  return buffer;
}
for (const options of [{}, { list: true }, { unsetSize: true }]) {
  const file = wav(1.5, options);
  assert.equal(wavSeconds(file.subarray(0, 4096), file.length), 1.5, JSON.stringify(options));
}
assert.equal(wavSeconds(Buffer.from("not a wav file at all"), 21), null);

assert.deepEqual(
  sortRecordings([
    { file: "/a", name: "a", modified: 1, seconds: 1 },
    { file: "/b", name: "b", modified: 3, seconds: 1 },
  ]).map((item) => item.name),
  ["b", "a"],
);
console.log("[sound-recorder/model] names, close rules, device states and WAV lengths passed");
