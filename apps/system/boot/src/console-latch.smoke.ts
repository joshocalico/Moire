import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readConsoleRequestLatch } from "./console-latch";
const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "moire-console-latch-")));
const file = path.join(directory, "console-requested");
try {
  fs.chmodSync(directory, 0o700);
  assert.deepEqual(readConsoleRequestLatch(file), { kind: "absent" });
  fs.writeFileSync(file, "escape\n", { mode: 0o600 });
  assert.deepEqual(readConsoleRequestLatch(file), { kind: "requested" });
  for (const content of ["escape", "escape\r\n", "escape\nextra", "manual\n", "x".repeat(10000)]) {
    fs.writeFileSync(file, content);
    assert.throws(() => readConsoleRequestLatch(file));
  }
  fs.writeFileSync(file, "escape\n");
  fs.chmodSync(file, 0o644);
  assert.throws(() => readConsoleRequestLatch(file), /private/);
  fs.chmodSync(file, 0o600);
  fs.linkSync(file, path.join(directory, "alias"));
  assert.throws(() => readConsoleRequestLatch(file), /private/);
  fs.unlinkSync(path.join(directory, "alias"));
  fs.unlinkSync(file);
  fs.symlinkSync("absent", file);
  assert.throws(() => readConsoleRequestLatch(file), /private/);
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  assert.throws(() => readConsoleRequestLatch(file), /private/);
  fs.rmdirSync(file);
  fs.chmodSync(directory, 0o755);
  assert.throws(() => readConsoleRequestLatch(file), /private/);
  fs.chmodSync(directory, 0o700);
  const linked = directory + "-symlink";
  fs.symlinkSync(directory, linked);
  try {
    assert.throws(() => readConsoleRequestLatch(path.join(linked, "console-requested")), /private/);
  } finally {
    fs.unlinkSync(linked);
  }
  assert.throws(() => readConsoleRequestLatch("relative"), /absolute/);
  assert.deepEqual(
    fs.readdirSync(directory),
    [],
    "reader creates no records or repairs permissions",
  );
  console.log(
    "console latch: exact private escape record, absent, malformed/bounded, symlink/ancestor/hardlink/nonregular/mode rejection PASS (temporary files, no input)",
  );
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
