/**
 * Stage handoff files are readable by the next stage even when the writer has a strict umask
 * (moire-dm's broker republishes the boot frame for an automatic-login desktop).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monotonicMs, publishStageHandoff, readStageHandoff } from "./boot-handoff";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moire-stage-"));
const previous = process.umask(0o077);
try {
  const published = publishStageHandoff(
    {
      pid: process.pid,
      scene: "silk",
      width: 2,
      height: 1,
      startedAtMs: 0,
      sceneSeconds: 1,
      releasedAtMs: monotonicMs(),
    },
    { pixels: new Uint8Array(8), width: 2, height: 1 },
    dir,
  );
  assert.ok(published);
  for (const name of ["released.json", "frame.bgra"])
    assert.equal(fs.statSync(path.join(dir, name)).mode & 0o777, 0o644, name);
  assert.equal(readStageHandoff(20_000, dir)?.frame, "frame.bgra");
} finally {
  process.umask(previous);
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log("boot-handoff smoke ok (stage files 0644 under umask 077)");
