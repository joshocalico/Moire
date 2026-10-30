/**
 * End to end without root: the real broker, the real front process (greeter socket, parsing,
 * fd 3 channel), real worker processes (blocking reads inside the conversation), fake PAM and
 * placeholder sessions. The greeter side is the greeter's own client (picked by
 * `loginBackend`, as the installed greeter does) and display-manager's LoginBroker.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// oxlint-disable import/no-relative-parent-imports -- The smoke drives the greeter's and display-manager's own clients against a live broker.
import { connectLoginClient, loginBackend } from "../../greeter/src/native/login-client";
import { connectMoireDmBroker } from "../../display-manager/src/moire-dm-broker";
// oxlint-enable import/no-relative-parent-imports
import type { DmConfig } from "./config";
import { createDaemon } from "./daemon";
import { FAKE_PASSWORD } from "./fake-pam.testing";
import { encodeRequest } from "./protocol";
import { processFrontLauncher, processWorkerLauncher } from "./process-launcher";
import type { SeatSnapshot } from "./seat";
import type { LogEntry } from "./state";

const here = path.dirname(fileURLToPath(import.meta.url));
const loader = path.resolve(here, "../../compositor/node_modules/tsx/dist/loader.mjs");
const DESKTOP = "/nix/store/0123456789abcdfghijklmnpqrsvwxyz-moire-session/bin/moire-session";
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "moire-dm-"));
fs.chmodSync(directory, 0o700);
const socketPath = path.join(directory, "greeter.sock");
const recordPath = path.join(directory, "launches.jsonl");
const denyPath = path.join(directory, "deny-peers");
fs.writeFileSync(recordPath, "");

const config: DmConfig = {
  vt: 1,
  socket: socketPath,
  frontUser: "moire-dm-front",
  path: "/run/current-system/sw/bin",
  greeter: { user: "greeter", argv: ["/nix/store/abc-moire/bin/moire-greeter"] },
  sessions: [{ id: "moire", label: "Moire", argv: [DESKTOP], desktop: "moire" }],
};
const FREE: SeatSnapshot = { ok: true, users: 0, greeterLeaders: [] };

type Launch = { user: string; argv: string[]; env: string[]; pid: number };
const launches = (): Launch[] =>
  fs
    .readFileSync(recordPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Launch);
const greeters = () => launches().filter((launch) => launch.user === "greeter");

async function waitFor<T>(probe: () => T | undefined | false, what: string, ms = 10_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const closed = (socket: net.Socket) =>
  new Promise<void>((resolve) => socket.once("close", () => resolve()));

const logs: LogEntry[] = [];
function broker(
  seat: () => SeatSnapshot,
  signalled: number[] = [],
  extra: Partial<Parameters<typeof createDaemon>[0]> = {},
) {
  let exitStatus: number | null = null;
  const daemon = createDaemon({
    config,
    launchFront: processFrontLauncher({
      entry: ["--import", loader, path.join(here, "fake-front.testing.ts")],
      env: { MOIRE_DM_FRONT_SOCKET: socketPath, MOIRE_DM_FAKE_DENY: denyPath },
    }),
    launchWorker: processWorkerLauncher({
      entry: ["--import", loader, path.join(here, "fake-worker.testing.ts")],
      env: { MOIRE_DM_FAKE_RECORD: recordPath, PATH: process.env.PATH ?? "" },
    }),
    autologin: () => ({ kind: "disabled" }),
    observeSeat: seat,
    signalLeader: (pid) => signalled.push(pid),
    log: (entry) => logs.push(entry),
    onExit: (status) => {
      exitStatus = status;
    },
    ...extra,
  });
  return { daemon, exitStatus: () => exitStatus };
}

let bootReleases = 0;
const first = broker(() => FREE, [], { releaseBootDisplay: async () => void bootReleases++ });
const daemon = first.daemon;
await daemon.start();

// The greeter session starts first, as the greeter account, told where moire-dm is.
const greeter1 = await waitFor(() => greeters()[0], "greeter launch");
assert(greeter1.env.includes(`MOIRE_DM_SOCK=${socketPath}`));
assert(!greeter1.env.some((entry) => entry.startsWith("GREETD_SOCK=")));
assert(greeter1.env.includes("XDG_SESSION_CLASS=greeter"));

// A peer that fails the front's SO_PEERCRED check is dropped unread.
fs.writeFileSync(denyPath, "");
const stranger = net.connect(socketPath);
stranger.on("error", () => {});
await closed(stranger);
fs.rmSync(denyPath);

// Garbage and pipelining are violations: the front closes the connection.
for (const bytes of [
  Buffer.from([3, 0, 0, 0, 9, 1, 0]),
  Buffer.concat([
    encodeRequest({ type: "begin", account: "alice" }),
    encodeRequest({ type: "cancel" }),
  ]),
]) {
  const peer = net.connect(socketPath);
  peer.on("error", () => {});
  peer.on("connect", () => peer.write(bytes));
  await closed(peer);
}
await waitFor(() => logs.some((entry) => entry.code === "greeter-violation"), "violation log");

// The greeter's own client, chosen exactly as the installed greeter chooses it.
const backend = loginBackend({ MOIRE_DM_SOCK: socketPath, GREETD_SOCK: "/run/greetd.sock" });
assert.equal(backend?.kind, "moire-dm", "the moire-dm socket wins when present");
assert.equal(loginBackend({ GREETD_SOCK: "/run/greetd.sock" })?.kind, "greetd");
const client = await connectLoginClient(backend!, DESKTOP, 10_000);
assert.deepEqual(await client.authenticate("alice"), {
  kind: "prompt",
  style: "info",
  message: "Acknowledge the authentication message",
});
assert.equal((await client.respond(null)).kind, "prompt");
assert.deepEqual(await client.respond("not the password"), { kind: "denied" });
assert.deepEqual(await client.cancel(), { kind: "cancelled" });
assert.equal(
  (await client.authenticate("nobody-here")).kind,
  "prompt",
  "unknown users get a prompt",
);
assert.deepEqual(await client.respond(FAKE_PASSWORD), { kind: "denied" });
assert.deepEqual(await client.cancel(), { kind: "cancelled" });
assert.equal((await client.authenticate("alice")).kind, "prompt");
assert.equal((await client.respond(null)).kind, "prompt");
assert.deepEqual(await client.respond(FAKE_PASSWORD), { kind: "authorized" });
assert.deepEqual(await client.start(), { kind: "committed" });
client.close();
assert.equal(daemon.state.mode.kind, "handoff");

// The greeter exits; only then does the user's session start.
assert.equal(launches().length, 1);
process.kill(greeter1.pid, "SIGTERM");
const session1 = await waitFor(() => launches().find((l) => l.user === "alice"), "alice session");
await waitFor(() => daemon.state.mode.kind === "running", "running");
const env = new Map(
  session1.env.map((e) => [e.slice(0, e.indexOf("=")), e.slice(e.indexOf("=") + 1)]),
);
assert.equal(env.get("HOME"), "/home/alice", "identity comes from the account, not PAM");
assert.equal(env.get("XDG_SESSION_CLASS"), "user");
assert.equal(env.get("XDG_RUNTIME_DIR"), "/run/user/1000");
assert(!env.has("LD_PRELOAD") && !env.has("MOIRE_DM_SOCK") && !env.has("MOIRE_DM_FAKE_RECORD"));
assert.deepEqual(session1.argv, [DESKTOP]);

// Logout: the session ends, PAM closes, and a fresh greeter appears.
process.kill(session1.pid, "SIGTERM");
const greeter2 = await waitFor(() => greeters()[1], "second greeter");
await waitFor(() => daemon.state.mode.kind === "greeter", "greeter mode");

// An account PAM maps to a system account (uid < 1000) never gets a session.
const mapped = await connectMoireDmBroker({ socketPath, timeoutMs: 10_000 });
assert.equal((await mapped.begin("mapped")).kind, "prompt");
assert.deepEqual(await mapped.answer(FAKE_PASSWORD), { kind: "success" });
assert.deepEqual(await mapped.start({ command: ["moire"], environment: [] }), { kind: "success" });
mapped.close();
process.kill(greeter2.pid, "SIGTERM");
const greeter3 = await waitFor(() => greeters()[2], "third greeter after a refused account");
assert(!launches().some((l) => l.user === "daemon"));
assert(logs.some((entry) => entry.code === "session-failed"));

// display-manager's LoginBroker: a session is picked by catalog id; a command is refused.
await waitFor(() => daemon.state.mode.kind === "greeter", "greeter mode again");
const login = await connectMoireDmBroker({ socketPath, timeoutMs: 10_000 });
assert.equal((await login.begin("alice")).kind, "prompt");
assert.deepEqual(await login.answer(null), {
  kind: "prompt",
  style: "secret",
  message: "Enter the requested secret",
});
assert.deepEqual(await login.answer(FAKE_PASSWORD), { kind: "success" });
await assert.rejects(login.start({ command: [DESKTOP, "--x"], environment: [] }));
assert.equal((await login.start({ command: ["/bin/sh"], environment: [] })).kind, "error");
assert.deepEqual(await login.start({ command: ["moire"], environment: [] }), { kind: "success" });
login.close();
process.kill(greeter3.pid, "SIGTERM");
const session2 = await waitFor(
  () => launches().filter((l) => l.user === "alice")[1],
  "second alice session",
);

// Shutdown stops every worker; their sessions end with them; the broker exits 0.
daemon.shutdown();
await waitFor(() => first.exitStatus() !== null, "broker exit", 15_000);
assert.equal(first.exitStatus(), 0);
await waitFor(() => !alive(session2.pid), "session to end with its worker");
await waitFor(() => !fs.existsSync(socketPath), "front to remove its socket");

// Restart over a live session: no greeter until logind says the seat is free, and the old
// greeter's worker is signalled.
let busyChecks = 2;
const signalled: number[] = [];
const restarted = broker(
  () => (busyChecks-- > 0 ? { ok: true, users: 1, greeterLeaders: [999_999] } : FREE),
  signalled,
);
const before = greeters().length;
await restarted.daemon.start();
assert.equal(restarted.daemon.state.mode.kind, "recovering");
assert.deepEqual(signalled, [999_999]);
await new Promise((resolve) => setTimeout(resolve, 500));
assert.equal(greeters().length, before, "nothing drawn over the live session");
await waitFor(() => greeters().length === before + 1, "greeter once the seat is free", 5_000);
assert(logs.some((entry) => entry.code === "seat-busy"));
assert(logs.some((entry) => entry.code === "seat-free"));
restarted.daemon.shutdown();
await waitFor(() => restarted.exitStatus() !== null, "restarted broker exit", 15_000);

// Automatic login: the boot stage's display is released for the session before it starts
// (the user's compositor can't reach the boot handoff); without automatic login it never is.
assert.equal(bootReleases, 0, "no release for a greeter boot");
const order: string[] = [];
const autologin = broker(() => FREE, [], {
  autologin: () => ({ kind: "enabled", user: "alice", session: config.sessions[0]! }),
  releaseBootDisplay: async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    order.push("release");
  },
  log: (entry) => {
    order.push(entry.code);
    logs.push(entry);
  },
});
await autologin.daemon.start();
assert.deepEqual(order.slice(0, 2), ["release", "autologin-start"]);
autologin.daemon.shutdown();
await waitFor(() => autologin.exitStatus() !== null, "autologin broker exit", 15_000);

// Nothing secret anywhere we can see: logs, launch records (environments), broker state.
const visible =
  JSON.stringify(logs) + fs.readFileSync(recordPath, "utf8") + JSON.stringify(daemon.state);
assert(!visible.includes(FAKE_PASSWORD));
assert(!visible.includes("not the password"));
assert(!logs.some((entry) => entry.code === "auth-denied" && entry.user), "no names on failure");

const total = launches().length;
fs.rmSync(directory, { recursive: true, force: true });
console.log(`moire-dm daemon smoke ok (${total} launches, ${logs.length} log lines)`);
