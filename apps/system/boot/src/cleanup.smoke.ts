import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseBootCleanupCommand, runBootCleanupCommand } from "./cleanup";
assert.deepEqual(parseBootCleanupCommand([]), { kind: "cleanup" });
assert.deepEqual(parseBootCleanupCommand(["--check"]), { kind: "check" });
assert.deepEqual(parseBootCleanupCommand(["--init-ledger"]), { kind: "init-ledger" });
assert.deepEqual(parseBootCleanupCommand(["--record-attempt"]), { kind: "record-attempt" });
assert.deepEqual(parseBootCleanupCommand(["--desktop-admission-check"]), {
  kind: "desktop-admission-check",
});
assert.deepEqual(parseBootCleanupCommand(["--admission-check", "--checkpoint"]), {
  kind: "admission-check",
  checkpointOutput: true,
});
assert.deepEqual(parseBootCleanupCommand(["--admission-check", "--expect", "not-invoked"]), {
  kind: "admission-check",
  checkpointOutput: false,
  checkpoint: { kind: "never-attempted" },
});
assert.deepEqual(parseBootCleanupCommand(["--admission-check", "--expect", "a".repeat(32)]), {
  kind: "admission-check",
  checkpointOutput: false,
  checkpoint: { kind: "invocation", invocationId: "a".repeat(32) },
});
const invalid = [
  ["--desktop-admission-check", "--expect", "not-invoked"],
  ["--desktop-admission-check", "--checkpoint"],
  ["--checkpoint"],
  ["--check", "--checkpoint"],
  ["--init-ledger", "--expect", "not-invoked"],
  ["--record-attempt", "--check"],
  ["--admission-check", "--expect"],
  ["--admission-check", "--expect", ""],
  ["--admission-check", "--expect", "A".repeat(32)],
  ["--admission-check", "--checkpoint", "--expect", "not-invoked"],
];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-cleanup-cli-"));
const prior = process.env.MOIRE_BOOT_SERVICE_STATE;
try {
  const record = path.join(directory, "release.json");
  fs.writeFileSync(record, "immutable fixture\n");
  process.env.MOIRE_BOOT_SERVICE_STATE = directory;
  for (const args of invalid) {
    assert.throws(() => parseBootCleanupCommand(args));
    assert.equal(await runBootCleanupCommand(args), 1);
  }
  assert.equal(fs.readFileSync(record, "utf8"), "immutable fixture\n");
  assert.deepEqual(
    fs.readdirSync(directory),
    ["release.json"],
    "invalid commands leave state untouched",
  );
  console.log(
    "boot cleanup CLI: canonical mutually exclusive modes/checkpoints, invalid executor arguments before IO PASS (no device/manager execution)",
  );
} finally {
  if (prior === undefined) delete process.env.MOIRE_BOOT_SERVICE_STATE;
  else process.env.MOIRE_BOOT_SERVICE_STATE = prior;
  fs.rmSync(directory, { recursive: true, force: true });
}
