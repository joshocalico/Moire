/**
 * The automatic-login file as written by moire-dm-settings and read by the broker: the writer
 * only produces what the reader accepts, writes atomically with mode 0644, and the reader never
 * follows a link and turns anything odd into "off".
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  encodeAutologin,
  loadAutologin,
  readAutologinFile,
  writeAutologinFile,
} from "./autologin-file";
import { parseConfig, type DmConfig } from "./config";

const config = parseConfig(
  JSON.stringify({
    vt: 1,
    socket: "/run/moire-dm-front/greeter.sock",
    frontUser: "moire-dm-front",
    path: "/run/current-system/sw/bin",
    greeter: { user: "greeter", argv: ["/nix/store/x-greeter/bin/greeter"] },
    sessions: [{ id: "moire", label: "Moire", desktop: "moire", argv: ["/nix/store/x/bin/moire"] }],
  }),
) as DmConfig;
assert(config);
const self = process.getuid?.() ?? 0;
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-dm-autologin-"));
const file = path.join(directory, "autologin.json");
let cases = 0;
const check = (expected: unknown, writer = self) => {
  assert.deepEqual(loadAutologin(config, file, writer), expected);
  cases++;
};

try {
  // No file: off, quietly.
  check({ kind: "disabled" });
  assert.deepEqual(readAutologinFile(file), { facts: null, text: null });

  // On for an account with the catalog's session: exactly what the broker reads back.
  writeAutologinFile(config, file, { user: "alice", session: "moire" }, self);
  check({ kind: "enabled", user: "alice", session: config.sessions[0] });
  assert.equal(fs.readFileSync(file, "utf8"), '{"version":1,"user":"alice","session":"moire"}\n');
  assert.equal(fs.statSync(file).mode & 0o777, 0o644);
  // Owned by the writer: accepted for the writer, refused for anyone else (here: root only).
  if (self !== 0) check({ kind: "invalid", reason: "owner" }, 0);

  // Off: the explicit "no one" record.
  writeAutologinFile(config, file, null, self);
  check({ kind: "disabled" });
  assert.equal(fs.readFileSync(file, "utf8"), encodeAutologin(null));

  // The writer refuses what the broker would refuse, and leaves the old file alone.
  for (const record of [
    { user: "alice", session: "other" },
    { user: "greeter", session: "moire" },
    { user: "Alice;rm", session: "moire" },
  ]) {
    assert.throws(() => writeAutologinFile(config, file, record, self), /would not be accepted/);
    check({ kind: "disabled" });
  }
  // No temporary files are left behind.
  assert.deepEqual(fs.readdirSync(directory), ["autologin.json"]);

  // Odd files are off: group- or world-writable, oversized, a symlink, a directory, garbage.
  writeAutologinFile(config, file, { user: "alice", session: "moire" }, self);
  fs.chmodSync(file, 0o666);
  check({ kind: "invalid", reason: "mode" });
  fs.chmodSync(file, 0o644);
  fs.writeFileSync(file, " ".repeat(5000));
  check({ kind: "invalid", reason: "size" });
  fs.writeFileSync(file, "{not json");
  check({ kind: "invalid", reason: "shape" });
  const target = path.join(directory, "target.json");
  fs.writeFileSync(target, encodeAutologin({ user: "alice", session: "moire" }));
  fs.rmSync(file);
  fs.symlinkSync(target, file);
  check({ kind: "invalid", reason: "owner" });
  fs.rmSync(file);
  fs.mkdirSync(file);
  check({ kind: "invalid", reason: "owner" });
  fs.rmdirSync(file);

  // A rename replaces a symlink rather than writing through it.
  fs.symlinkSync(target, file);
  writeAutologinFile(config, file, null, self);
  assert(!fs.lstatSync(file).isSymbolicLink());
  assert.equal(
    fs.readFileSync(target, "utf8"),
    encodeAutologin({ user: "alice", session: "moire" }),
  );
  check({ kind: "disabled" });
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
console.log(`moire-dm autologin file smoke ok (${cases} cases)`);
