import assert from "node:assert/strict";
import { PAM_DELETE_CRED, PAM_ESTABLISH_CRED, PAM_SILENT } from "@moire/sys/pam";
import { parseAutologin, parseConfig, sessionById, type DmConfig } from "./config";
import { runConversation, type WorkerIo } from "./conversation";
import { FAKE_PASSWORD, createFakePam, type FakeAccount } from "./fake-pam.testing";
import { sessionEnvironment } from "./session-env";
import type { SessionSpec, WorkerCommand, WorkerEvent, WorkerJob } from "./worker-channel";

const SESSION: SessionSpec = {
  id: "moire",
  label: "Moire",
  argv: ["/nix/store/abc-moire/bin/moire-session"],
  desktop: "moire",
};
const login = (user: string): WorkerJob => ({
  service: "moire-dm",
  user,
  mode: "authenticate",
  sessionClass: "user",
  session: null,
  vt: 1,
  greeterSocket: null,
});
const bytes = (text: string) => new TextEncoder().encode(text);
let cases = 0;

/** Scripted daemon: answers each prompt from a queue; records what the worker sent. */
function scripted(commands: (WorkerCommand | null)[]) {
  const sent: WorkerEvent[] = [];
  const handed: Uint8Array[] = [];
  const io: WorkerIo = {
    receive() {
      const command = commands.shift() ?? null;
      if (command?.kind === "answer" && command.response) handed.push(command.response);
      return command;
    },
    send: (event) => sent.push(event),
  };
  return { io, sent, handed };
}

function run(
  accounts: Record<string, FakeAccount>,
  job: WorkerJob,
  commands: (WorkerCommand | null)[],
) {
  const pam = createFakePam(accounts);
  const daemon = scripted(commands);
  const result = runConversation(pam, job, daemon.io, "/fixture/pam.d");
  cases++;
  return { pam, result, ...daemon };
}

const answer = (text: string | null): WorkerCommand => ({
  kind: "answer",
  response: text === null ? null : bytes(text),
});
const start: WorkerCommand = { kind: "start", session: SESSION };

// 1. Success: info then secret prompt, PAM call order, environment, session close order.
{
  const { pam, result, sent, handed } = run(
    { alice: { password: FAKE_PASSWORD, notice: "Welcome back" } },
    login("alice"),
    [answer(null), answer(FAKE_PASSWORD), start],
  );
  assert.deepEqual(sent, [
    { kind: "prompt", style: "info", text: "Welcome back" },
    { kind: "prompt", style: "secret", text: "Password: " },
    { kind: "authorized", user: "alice" },
  ]);
  assert.equal(result.kind, "open");
  assert(result.kind === "open");
  assert.deepEqual(pam.record.calls, [
    "start:moire-dm:alice:/fixture/pam.d",
    "tty:tty1",
    "authenticate",
    "acct",
    `setcred:${PAM_ESTABLISH_CRED}`,
    "open",
  ]);
  // pam_systemd reads these from the PAM environment at pam_open_session.
  assert.deepEqual(pam.record.env, [
    "XDG_SEAT=seat0",
    "XDG_VTNR=1",
    "XDG_SESSION_CLASS=user",
    "XDG_SESSION_TYPE=wayland",
    "XDG_SESSION_DESKTOP=moire",
  ]);
  assert.equal(pam.record.received.at(-1), FAKE_PASSWORD);
  assert(handed.length === 1 && handed[0]!.every((byte) => byte === 0), "answer wiped after use");
  result.session.close();
  result.session.close();
  assert.deepEqual(pam.record.calls.slice(-3), [
    "close",
    `setcred:${PAM_DELETE_CRED | PAM_SILENT}`,
    "end:0",
  ]);
}

// 2. Wrong password and unknown account look identical: "denied", PAM ended.
for (const user of ["alice", "nobody-here"]) {
  const { pam, result, sent } = run({ alice: { password: FAKE_PASSWORD } }, login(user), [
    answer("wrong"),
  ]);
  assert.equal(result.kind, "finished");
  assert.deepEqual(sent.at(-1), { kind: "denied" });
  assert.equal(pam.record.calls.at(-1)?.startsWith("end:"), true);
  assert(!pam.record.calls.includes("open"));
}

// 3. Cancel while PAM waits on the conversation: PAM sees a conversation error; "cancelled".
{
  const { pam, result, sent } = run({ alice: { password: FAKE_PASSWORD } }, login("alice"), [
    { kind: "cancel" },
  ]);
  assert.equal(result.kind, "finished");
  assert.deepEqual(sent.at(-1), { kind: "cancelled" });
  assert.deepEqual(pam.record.calls.slice(-1), ["end:26"]);
}

// 4. Daemon disappears mid-conversation (EOF): fail closed exactly like a cancel.
{
  const { result, sent } = run({ alice: { password: FAKE_PASSWORD } }, login("alice"), [null]);
  assert.equal(result.kind, "finished");
  assert.deepEqual(sent.at(-1), { kind: "cancelled" });
}

// 5. Wrong answer shape (bytes for an info message) aborts and wipes what it was given.
{
  const { result, sent, handed } = run(
    { alice: { password: FAKE_PASSWORD, notice: "Hi" } },
    login("alice"),
    [answer("unexpected")],
  );
  assert.equal(result.kind, "finished");
  assert.deepEqual(sent.at(-1), { kind: "cancelled" });
  assert(handed[0]!.every((byte) => byte === 0));
}

// 6. Account refused after a correct password (expired account) is still just "denied".
{
  const { pam, sent } = run(
    { bob: { password: FAKE_PASSWORD, account: "expired-account" } },
    login("bob"),
    [answer(FAKE_PASSWORD)],
  );
  assert.deepEqual(sent.at(-1), { kind: "denied" });
  assert(!pam.record.calls.includes("open"));
}

// 7. Expired password: changed through the same conversation before any session opens.
{
  const { pam, result, sent } = run(
    { carol: { password: FAKE_PASSWORD, account: "expired-password" } },
    login("carol"),
    [answer(FAKE_PASSWORD), answer("new-SYNTHETIC"), answer("new-SYNTHETIC"), start],
  );
  assert.equal(result.kind, "open");
  assert.deepEqual(
    sent.map((event) => event.kind),
    ["prompt", "prompt", "prompt", "authorized"],
  );
  assert(pam.record.calls.indexOf("chauthtok") < pam.record.calls.indexOf("open"));
  const mismatch = run(
    { carol: { password: FAKE_PASSWORD, account: "expired-password" } },
    login("carol"),
    [answer(FAKE_PASSWORD), answer("one"), answer("two")],
  );
  assert.deepEqual(mismatch.sent.at(-1), { kind: "denied" });
}

// 8. Authorized but the daemon cancels instead of starting: no session, PAM ended.
{
  const { pam, result, sent } = run({ alice: { password: FAKE_PASSWORD } }, login("alice"), [
    answer(FAKE_PASSWORD),
    { kind: "cancel" },
  ]);
  assert.equal(result.kind, "finished");
  assert.deepEqual(sent.at(-1), { kind: "cancelled" });
  assert(!pam.record.calls.includes("open"));
}

// 9. pam_open_session failure: credentials deleted, PAM ended, reported as "session".
{
  const { pam, sent } = run(
    { alice: { password: FAKE_PASSWORD, failOpenSession: true } },
    login("alice"),
    [answer(FAKE_PASSWORD), start],
  );
  assert.deepEqual(sent.at(-1), { kind: "failed", reason: "session" });
  assert.deepEqual(pam.record.calls.slice(-3), [
    "open",
    `setcred:${PAM_DELETE_CRED | PAM_SILENT}`,
    "end:4",
  ]);
}

// 10. Trusted jobs (greeter, automatic login) never authenticate and never prompt.
{
  const greeterJob: WorkerJob = {
    service: "moire-dm-greeter",
    user: "greeter",
    mode: "trusted",
    sessionClass: "greeter",
    session: {
      id: "greeter",
      label: "Greeter",
      argv: ["/nix/store/abc-moire/bin/greeter"],
      desktop: "moire-greeter",
    },
    vt: 1,
    greeterSocket: "/run/moire-dm/greeter.sock",
  };
  const { pam, result, sent } = run({ greeter: { password: "" } }, greeterJob, []);
  assert.equal(result.kind, "open");
  assert.deepEqual(sent, []);
  assert(!pam.record.calls.includes("authenticate"));
  assert(pam.record.env.includes("XDG_SESSION_CLASS=greeter"));
  // A trusted job whose account needs a password change can't ask anyone: it fails closed.
  const expired = run(
    { alice: { password: FAKE_PASSWORD, account: "expired-password" } },
    { ...greeterJob, service: "moire-dm-autologin", user: "alice", sessionClass: "user" },
    [],
  );
  assert.deepEqual(expired.sent, [{ kind: "failed", reason: "account" }]);
}

// 11. A module that maps the account name: the mapped name is what gets authorized.
{
  const { sent } = run(
    { alias: { password: FAKE_PASSWORD, mappedUser: "alice" } },
    login("alias"),
    [answer(FAKE_PASSWORD)],
  );
  assert.deepEqual(sent.at(-2), { kind: "authorized", user: "alice" });
}

// Session environment: built from scratch; PAM can't override identity or inject loaders.
{
  const env = sessionEnvironment({
    account: { name: "alice", uid: 1000, home: "/home/alice", shell: "/bin/sh" },
    session: SESSION,
    sessionClass: "user",
    vt: 1,
    path: "/run/wrappers/bin:/run/current-system/sw/bin",
    pamEnvironment: [
      "XDG_RUNTIME_DIR=/run/user/1000",
      "LANG=en_GB.UTF-8",
      "HOME=/tmp/elsewhere",
      "LD_PRELOAD=/tmp/evil.so",
      "NODE_OPTIONS=--require=/tmp/x",
      "BAD NAME=x",
      "=empty",
      "NOEQUALS",
    ],
    greeterSocket: "/run/moire-dm/greeter.sock",
  });
  const map = new Map(
    env.map((entry) => [entry.split("=")[0], entry.slice(entry.indexOf("=") + 1)]),
  );
  assert.equal(map.get("HOME"), "/home/alice");
  assert.equal(map.get("XDG_RUNTIME_DIR"), "/run/user/1000");
  assert.equal(map.get("LANG"), "en_GB.UTF-8");
  assert.equal(map.get("XDG_SESSION_TYPE"), "wayland");
  assert.equal(map.get("XDG_CURRENT_DESKTOP"), "moire");
  assert(!map.has("LD_PRELOAD") && !map.has("NODE_OPTIONS") && !map.has("BAD NAME"));
  assert(!map.has("MOIRE_DM_SOCK"), "only the greeter learns the socket");
  assert(!env.some((entry) => entry.includes(process.env.PATH ?? "\0")), "daemon env never leaks");
  const greeterEnv = sessionEnvironment({
    account: { name: "greeter", uid: 990, home: "/var/empty", shell: "/bin/nologin" },
    session: { id: "greeter", label: "Greeter", argv: ["/g"], desktop: "moire-greeter" },
    sessionClass: "greeter",
    vt: 1,
    path: "/bin",
    pamEnvironment: [],
    greeterSocket: "/run/moire-dm/greeter.sock",
  });
  assert(greeterEnv.includes("MOIRE_DM_SOCK=/run/moire-dm/greeter.sock"));
  assert(!greeterEnv.some((entry) => entry.startsWith("GREETD_SOCK=")));
  cases += 2;
}

// Configuration and automatic-login state parse strictly and fail closed.
{
  const text = JSON.stringify({
    vt: 1,
    socket: "/run/moire-dm-front/greeter.sock",
    frontUser: "moire-dm-front",
    path: "/run/current-system/sw/bin",
    greeter: { user: "greeter", argv: ["/nix/store/abc-moire/bin/greeter"] },
    sessions: [SESSION],
  });
  const config = parseConfig(text) as DmConfig;
  assert(config);
  assert.equal(sessionById(config, "moire")?.label, "Moire");
  assert.equal(sessionById(config, "/nix/store/abc-moire/bin/moire-session"), null);
  for (const broken of [
    "",
    "{}",
    text.replace('"vt":1', '"vt":0'),
    text.replace('"/run/moire-dm-front/greeter.sock"', '"relative.sock"'),
    text.replace('"/nix/store/abc-moire/bin/greeter"', '"greeter"'),
    JSON.stringify({ ...JSON.parse(text), sessions: [SESSION, SESSION] }),
    JSON.stringify({ ...JSON.parse(text), sessions: [] }),
    JSON.stringify({ ...JSON.parse(text), frontUser: "greeter" }),
    JSON.stringify({ ...JSON.parse(text), sessions: [{ ...SESSION, id: "Bad Id" }] }),
  ])
    assert.equal(parseConfig(broken), null, broken);
  const facts = { regularFile: true, ownerUid: 0, mode: 0o100644, size: 64 };
  const state = (value: unknown) => JSON.stringify(value);
  const enabled = state({ version: 1, user: "alice", session: "moire" });
  assert.deepEqual(parseAutologin(config, facts, enabled, 977), {
    kind: "enabled",
    user: "alice",
    session: SESSION,
  });
  assert.deepEqual(
    parseAutologin(config, { ...facts, ownerUid: 977 }, enabled, 977).kind,
    "enabled",
  );
  assert.deepEqual(parseAutologin(config, null, null, 977), { kind: "disabled" });
  assert.deepEqual(parseAutologin(config, facts, state({ version: 1, user: null }), 977), {
    kind: "disabled",
  });
  const problems: [Parameters<typeof parseAutologin>[1], string, string][] = [
    [{ ...facts, ownerUid: 1000 }, enabled, "owner"],
    [{ ...facts, regularFile: false }, enabled, "owner"],
    [{ ...facts, mode: 0o100666 }, enabled, "mode"],
    [{ ...facts, mode: 0o100664 }, enabled, "mode"],
    [{ ...facts, size: 5000 }, enabled, "size"],
    [facts, "not json", "shape"],
    [facts, state({ version: 2, user: "alice", session: "moire" }), "shape"],
    [facts, state({ version: 1, user: "alice", session: "moire", extra: 1 }), "shape"],
    [facts, state({ version: 1, user: "Alice!", session: "moire" }), "user"],
    [facts, state({ version: 1, user: "greeter", session: "moire" }), "user"],
    [facts, state({ version: 1, user: "alice", session: "other" }), "session"],
  ];
  for (const [fileFacts, body, reason] of problems)
    assert.deepEqual(parseAutologin(config, fileFacts, body, 977), { kind: "invalid", reason });
  cases += 3;
}

console.log(`moire-dm conversation smoke ok (${cases} cases)`);
