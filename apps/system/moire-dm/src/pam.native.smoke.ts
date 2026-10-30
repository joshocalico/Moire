/**
 * Real libpam through `@moire/sys/pam`, without root and without system PAM configuration:
 * pam_start_confdir() reads a private service file whose auth step is pam_exec handing the
 * password (obtained through *our* conversation trampoline) to a checker program.
 *
 * Linux only. Needs MOIRE_PAM_MODULES_DIR (…/lib/security) and MOIRE_PAM_CHECKER (an
 * executable that exits 0 iff stdin holds NATIVE_PASSWORD). nix/moire-dm-check.nix provides
 * both in the build sandbox; elsewhere this prints SKIP.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listSeatSessions } from "@moire/sys/login-sessions";
import { openPam } from "@moire/sys/pam";
import { dropPrivileges, execute, lookupAccount, resetSignals } from "@moire/sys/privilege";
import { runConversation, type WorkerIo } from "./conversation";
import type { WorkerCommand, WorkerEvent, WorkerJob } from "./worker-channel";

const NATIVE_PASSWORD = "SYNTHETIC-native-pam-password";
const SERVICE = "moire-dm-native-test";
const EXEC_PROBE = "MOIRE_DM_EXEC_PROBE";
const EXEC_PROBE_STATUS = 7;

if (process.env[EXEC_PROBE] === "1") {
  if (!resetSignals()) process.exit(3);
  // Only ONLY=1 may reach the new image: no PATH, no probe flag, nothing inherited.
  const check = `process.exit(process.env.ONLY === "1" && Object.keys(process.env).length === 1 ? ${EXEC_PROBE_STATUS} : 4)`;
  execute(process.execPath, [process.execPath, "-e", check], ["ONLY=1"]);
  process.exit(5);
}

const modules = process.env.MOIRE_PAM_MODULES_DIR;
const checker = process.env.MOIRE_PAM_CHECKER;
if (process.platform !== "linux" || !modules || !checker) {
  console.log(
    "SKIP moire-dm native PAM smoke (needs Linux, MOIRE_PAM_MODULES_DIR, MOIRE_PAM_CHECKER)",
  );
  process.exit(0);
}

const confdir = fs.mkdtempSync(path.join(os.tmpdir(), "moire-dm-pam-"));
fs.writeFileSync(
  path.join(confdir, SERVICE),
  [
    `auth required ${modules}/pam_exec.so expose_authtok quiet ${checker}`,
    // pam_exec ignores setcred; one module that succeeds keeps pam_setcred from failing.
    `auth optional ${modules}/pam_permit.so`,
    `account required ${modules}/pam_permit.so`,
    `session required ${modules}/pam_permit.so`,
    `password required ${modules}/pam_deny.so`,
    "",
  ].join("\n"),
);

const job: WorkerJob = {
  service: SERVICE,
  user: os.userInfo().username,
  mode: "authenticate",
  sessionClass: "user",
  session: null,
  vt: 1,
  greeterSocket: null,
};
const session = {
  id: "moire",
  label: "Moire",
  argv: ["/nix/store/x-moire/bin/moire"] as [string],
  desktop: "moire",
};
let cases = 0;

function run(answers: (string | null)[], after: WorkerCommand | null) {
  const sent: WorkerEvent[] = [];
  const handed: Uint8Array[] = [];
  const io: WorkerIo = {
    receive() {
      const event = sent.at(-1);
      if (event?.kind === "authorized") return after;
      const next = answers.shift();
      if (next === undefined) return null;
      if (next === null) return { kind: "cancel" };
      const response = new TextEncoder().encode(next);
      handed.push(response);
      return { kind: "answer", response };
    },
    send: (event) => sent.push(event),
  };
  const result = runConversation(openPam(), job, io, confdir);
  cases++;
  return { result, sent, handed };
}

// Right password: the prompt came from pam_exec through the koffi trampoline, the answer was
// copied into PAM-owned memory and our array wiped; a session opens with our XDG variables.
{
  const { result, sent, handed } = run([NATIVE_PASSWORD], { kind: "start", session });
  assert.equal(sent[0]?.kind, "prompt");
  assert.equal(sent[0]?.kind === "prompt" && sent[0].style, "secret");
  assert.deepEqual(sent.at(-1), { kind: "authorized", user: job.user });
  assert(
    handed[0]!.every((byte) => byte === 0),
    "answer wiped once copied into PAM memory",
  );
  assert.equal(result.kind, "open");
  if (result.kind === "open") {
    assert(result.session.pamEnvironment.includes("XDG_SESSION_TYPE=wayland"));
    assert(result.session.pamEnvironment.includes("XDG_SESSION_CLASS=user"));
    result.session.close();
  }
}

// Wrong password: denied, no session.
{
  const { result, sent } = run(["wrong"], null);
  assert.equal(result.kind, "finished");
  assert.deepEqual(sent.at(-1), { kind: "denied" });
}

// Cancel inside the conversation: PAM gets PAM_CONV_ERR and unwinds through pam_end.
{
  const { result, sent } = run([null], null);
  assert.equal(result.kind, "finished");
  assert.deepEqual(sent.at(-1), { kind: "cancelled" });
}

// An over-long answer is refused by the trampoline (PAM_CONV_ERR), not truncated.
{
  const { sent } = run(["x".repeat(600)], null);
  assert.notEqual(sent.at(-1)?.kind, "authorized");
}

// A missing service file is a value, not an exception.
{
  const sent: WorkerEvent[] = [];
  const result = runConversation(
    openPam(),
    { ...job, service: "moire-dm-no-such-service" },
    { receive: () => null, send: (event) => sent.push(event) },
    confdir,
  );
  assert.equal(result.kind, "finished");
  assert.notEqual(sent.at(-1)?.kind, "authorized");
  cases++;
}

// NSS lookup and the privilege-drop guard rails (unprivileged here, so the drop must fail closed).
{
  const self = lookupAccount(os.userInfo().username);
  assert.equal(self?.uid, process.getuid?.());
  assert.equal(lookupAccount("moire-dm-no-such-user"), null);
  if (self && self.uid !== 0)
    assert.deepEqual(dropPrivileges(self), { ok: false, step: "initgroups" });
  assert.deepEqual(dropPrivileges({ name: "root", uid: 0, gid: 0, home: "/", shell: "/bin/sh" }), {
    ok: false,
    step: "verify",
  });
  cases += 2;
}

// execve through koffi with an explicit environment, after resetting signal dispositions:
// this same file re-runs as the probe, which replaces itself with a Node that checks its env.
{
  const child = spawnSync(process.execPath, [...process.execArgv, process.argv[1]!], {
    env: { ...process.env, [EXEC_PROBE]: "1" },
    encoding: "utf8",
  });
  assert.equal(child.status, EXEC_PROBE_STATUS, `exec probe: ${child.stderr}`);
  cases++;
}

// sd-login through koffi: never throws. With MOIRE_DM_EXPECT_SEAT (a JSON list of
// [id, class, service, state, leader] written as fake /run/systemd state by the container
// test) the decoded sessions must match exactly.
{
  const seat = listSeatSessions("seat0");
  assert.equal(typeof seat.ok, "boolean");
  const expected = process.env.MOIRE_DM_EXPECT_SEAT;
  if (expected) {
    assert(seat.ok, "sd-login read the seat");
    assert.deepEqual(
      seat.sessions.map((s) => [s.id, s.sessionClass, s.service, s.state, s.leader]),
      JSON.parse(expected),
    );
  }
  cases++;
}

fs.rmSync(confdir, { recursive: true, force: true });
console.log(`moire-dm native PAM smoke ok (${cases} cases)`);
