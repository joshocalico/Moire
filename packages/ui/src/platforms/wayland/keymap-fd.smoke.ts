import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { nodeKeymapFdIo, readKeymapFd } from "./keymap-fd";
import type { KeymapFdIo } from "./keymap-types";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-keymap-fd-"));
const filename = path.join(directory, "synthetic-keymap");
let cases = 0;
function exercise(bytes: Buffer, size: number, accepted: boolean) {
  fs.writeFileSync(filename, bytes);
  const fd = fs.openSync(filename, "r");
  let closes = 0,
    reads = 0;
  const io: KeymapFdIo = {
    read(file, count) {
      reads++;
      return nodeKeymapFdIo.read(file, count);
    },
    close(file) {
      assert.equal(file, fd);
      closes++;
      nodeKeymapFdIo.close(file);
    },
  };
  if (accepted) {
    assert.deepEqual(readKeymapFd(io, fd, size), bytes.subarray(0, size));
  } else {
    assert.throws(() => readKeymapFd(io, fd, size), /Keymap unavailable/);
  }
  assert.equal(closes, 1);
  assert.throws(
    () => fs.fstatSync(fd),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "EBADF",
  );
  if (size < 2 || size > 1024 * 1024 || !Number.isSafeInteger(size)) assert.equal(reads, 0);
  cases++;
}
try {
  exercise(Buffer.from("synthetic\0"), 10, true);
  exercise(Buffer.from("å\0"), 3, true);
  exercise(Buffer.from("unterminated"), 12, false);
  exercise(Buffer.from("a\0b\0"), 4, false);
  exercise(Buffer.from([0xff, 0]), 2, false);
  exercise(Buffer.from("short\0"), 20, false);
  for (const size of [0, 1, -1, 1.5, 1024 * 1024 + 1]) exercise(Buffer.from("x\0"), size, false);
  const fd = fs.openSync(directory, "r");
  assert.throws(() => readKeymapFd(nodeKeymapFdIo, fd, 2), /Keymap unavailable/);
  assert.throws(() => fs.fstatSync(fd));
  cases++;
  let closes = 0;
  const readFailure: KeymapFdIo = {
    read() {
      throw new Error("synthetic private context");
    },
    close() {
      closes++;
    },
  };
  assert.throws(() => readKeymapFd(readFailure, 123, 2), /^Error: Keymap unavailable$/);
  assert.equal(closes, 1);
  cases++;
  const malformedReturn: KeymapFdIo = {
    read() {
      return Buffer.from("x\0");
    },
    close() {
      closes++;
    },
  };
  assert.throws(() => readKeymapFd(malformedReturn, 123, 3), /Keymap unavailable/);
  assert.equal(closes, 2);
  cases++;
  const closeFailure: KeymapFdIo = {
    read() {
      return Buffer.from("x\0");
    },
    close() {
      closes++;
      throw new Error("synthetic close context");
    },
  };
  assert.throws(() => readKeymapFd(closeFailure, 123, 2), /^Error: Keymap descriptor unavailable$/);
  assert.equal(closes, 3);
  cases++;
  console.log(
    JSON.stringify({
      suite: "keymap real file descriptor ownership",
      cases,
      actualExitCode: 0,
      deviceAccess: 0,
      nativeXkb: false,
    }),
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
