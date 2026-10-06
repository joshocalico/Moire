import assert from "node:assert/strict";
import koffi from "koffi";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DrmPageFlipHandler2, PageFlipEvents } from "./page-flip-events";

const events = new PageFlipEvents<{ crtc: number; generation: number }>();
const oldOutput = { crtc: 7, generation: 1 };
const newOutput = { crtc: 7, generation: 2 };
const old = events.allocate(oldOutput, 100);
const next = events.allocate(newOutput, 101);
assert.notEqual(koffi.address(old), koffi.address(next));
const received: {
  output: { crtc: number; generation: number };
  token: number;
  sequence: number;
}[] = [];
const directory = mkdtempSync(path.join(tmpdir(), "moire-page-flip-abi-"));
try {
  const source = path.join(directory, "invoke.c");
  const libraryPath = path.join(
    directory,
    process.platform === "darwin" ? "invoke.dylib" : "invoke.so",
  );
  writeFileSync(
    source,
    `
typedef void (*Flip)(int, unsigned int, unsigned int, unsigned int, unsigned int, void *);
void moire_test_flip(Flip callback, unsigned int sequence, void *data) {
  callback(5, sequence, 2, 3, 7, data);
}
`,
  );
  const compiled = spawnSync(
    process.env.CC ?? "cc",
    [process.platform === "darwin" ? "-dynamiclib" : "-shared", "-fPIC", source, "-o", libraryPath],
    { encoding: "utf8" },
  );
  assert.equal(
    compiled.status,
    0,
    `C ABI fixture compilation failed: ${compiled.stderr || compiled.error}`,
  );
  const library = koffi.load(libraryPath);
  const invoke = library.func(
    "void moire_test_flip(MoireDrmPageFlipHandler2 *callback, unsigned int sequence, void *data)",
  );
  const callback = koffi.register(
    (
      _fd: number,
      sequence: number,
      _seconds: number,
      _microseconds: number,
      _crtc: number,
      userData: unknown,
    ) => {
      const event = events.consume(userData);
      if (event) received.push({ ...event, sequence });
    },
    koffi.pointer(DrmPageFlipHandler2),
  );
  try {
    // Cross the actual C callback ABI, including the sixth opaque pointer argument.
    invoke(callback, 17, old);
    assert.deepEqual(received, [{ output: oldOutput, token: 100, sequence: 17 }]);
    invoke(callback, 18, old);
    assert.equal(received.length, 1, "duplicate kernel event consumed another flip");
    invoke(callback, 19, next);
    assert.deepEqual(received[1], { output: newOutput, token: 101, sequence: 19 });
    const rejected = events.allocate(newOutput, 102);
    events.cancel(rejected);
    assert.equal(events.consume(rejected), null);
    events.allocate(newOutput, 103);
    events.destroy();
    events.destroy();
  } finally {
    koffi.unregister(callback);
    library.unload();
  }
} finally {
  events.destroy();
  rmSync(directory, { recursive: true, force: true });
}
console.log("page flip C ABI: opaque tokens, stale-generation/duplicate events and cleanup passed");
