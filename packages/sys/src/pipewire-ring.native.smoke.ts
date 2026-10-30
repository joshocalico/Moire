/**
 * The image's own libmoire-pwring, built against the real PipeWire headers, loads with the real
 * libpipewire and passes the ring cases; a stream opened with no PipeWire daemon (the Nix build
 * sandbox) fails as a value. Set MOIRE_PWRING_LIBRARY; MOIRE_REQUIRE_PWRING=1 turns SKIP into a
 * failure. The fake-backed stream smoke (src/pipewire-stream.smoke.ts) covers process itself.
 */
import assert from "node:assert/strict";
import koffi from "koffi";
import { openPipeWireStream } from "./pipewire-stream";

const library = process.env.MOIRE_PWRING_LIBRARY;
if (process.platform !== "linux" || !library) {
  if (process.env.MOIRE_REQUIRE_PWRING === "1") throw new Error("MOIRE_PWRING_LIBRARY is required");
  console.log("SKIP pipewire ring native smoke: Linux and MOIRE_PWRING_LIBRARY required");
  process.exit(0);
}

const shim = koffi.load(library);
const ringNew = shim.func("void *moire_pwring_new(uint32_t capacity, uint32_t stride)");
const ringFree = shim.func("void moire_pwring_free(void *ring)");
const ringWrite = shim.func(
  "uint32_t moire_pwring_write(void *ring, const void *src, uint32_t bytes)",
);
const ringRead = shim.func("uint32_t moire_pwring_read(void *ring, void *dst, uint32_t bytes)");
const events = shim.func("const void *moire_pwring_playback_events(void)");

const ring = ringNew(4096, 8);
const data = Uint8Array.from({ length: 4096 }, (_, i) => i & 0xff);
assert.equal(ringWrite(ring, data, 4100), 4096);
const out = new Uint8Array(4096);
// 3003 bytes is 375 whole 8-byte frames plus 3 stray bytes: only the whole frames come back.
assert.equal(ringRead(ring, out, 3003), 3000, "whole frames only");
assert.deepEqual(out.subarray(0, 3000), data.subarray(0, 3000));
assert.equal(ringWrite(ring, data, 2000), 2000, "wraps");
assert.equal(ringRead(ring, out, 4096), 1096 + 2000);
assert.deepEqual(out.subarray(1096, 3096), data.subarray(0, 2000));
ringFree(ring);
assert.ok(events(), "process callbacks exported");

// No daemon here: opening must come back as a value, never crash or hang.
const opened = openPipeWireStream({
  direction: "playback",
  name: "moire-native-smoke",
  properties: { "media.type": "Audio" },
  // Object(Format, EnumFormat) { mediaType: audio, mediaSubtype: raw }
  format: new Uint8Array(
    Buffer.from(
      "38000000 0f000000 03000400 03000000 01000000 00000000 04000000 03000000 01000000 00000000 02000000 00000000 04000000 03000000 01000000 00000000".replace(
        / /g,
        "",
      ),
      "hex",
    ),
  ),
  channels: 1,
  ringBytes: 4096,
});
if (opened.kind === "ok") {
  const state = opened.stream.state().state;
  assert.ok(state === "error" || state === "unconnected" || state === "connecting", state);
  opened.stream.close();
}
console.log(`pipewire ring native smoke: ok (stream without daemon: ${opened.kind})`);
