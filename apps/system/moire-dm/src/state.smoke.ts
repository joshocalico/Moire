import assert from "node:assert/strict";
import type { DmConfig } from "./config";
import type { GreeterRequest } from "./protocol";
import {
  GREETER_CRASH_LIMIT,
  GREETER_EXIT_MS,
  LOCKOUT_AFTER_FAILURES,
  LOCKOUT_MS,
  SEAT_RECHECK_MS,
  initialState,
  step,
  type DmEvent,
  type DmState,
  type Effect,
  type Mode,
} from "./state";
import type { SeatSnapshot } from "./seat";
import type { WorkerEvent } from "./worker-channel";

const DESKTOP = ["/nix/store/abc-moire/bin/moire-session"] as const;
const config: DmConfig = {
  vt: 1,
  socket: "/run/moire-dm-front/greeter.sock",
  frontUser: "moire-dm-front",
  path: "/run/current-system/sw/bin",
  greeter: { user: "greeter", argv: ["/nix/store/abc-moire/bin/moire-greeter"] },
  sessions: [
    { id: "moire", label: "Moire", argv: DESKTOP, desktop: "moire" },
    { id: "safe", label: "Moire (safe mode)", argv: [...DESKTOP, "--safe"], desktop: "moire" },
  ],
};
const SECRET = new TextEncoder().encode("SYNTHETIC-state-secret");
let cases = 0;
const FREE: SeatSnapshot = { ok: true, users: 0, greeterLeaders: [] };

class Seat {
  state: DmState = initialState;
  effects: Effect[] = [];
  now = 1_000;
  send(event: DmEvent): Effect[] {
    const result = step(config, this.state, event);
    this.state = result.state;
    this.effects = [...result.effects];
    cases++;
    return this.effects;
  }
  get mode(): Mode {
    return this.state.mode;
  }
  boot(
    autologin: DmEvent & { kind: "boot" } extends { autologin: infer A } ? A : never = {
      kind: "disabled",
    },
  ) {
    return this.send({ kind: "boot", now: this.now, autologin, seat: FREE });
  }
  request(request: GreeterRequest, connection = 1) {
    return this.send({ kind: "request", connection, request, now: this.now });
  }
  worker(worker: number, event: WorkerEvent) {
    return this.send({ kind: "worker", worker, event, now: this.now });
  }
  exited(worker: number) {
    return this.send({ kind: "worker-exited", worker, now: this.now });
  }
  of<K extends Effect["kind"]>(kind: K): Extract<Effect, { kind: K }>[] {
    return this.effects.filter(
      (effect): effect is Extract<Effect, { kind: K }> => effect.kind === kind,
    );
  }
  replies() {
    return this.of("reply").map((effect) => effect.reply);
  }
  greeter(): number {
    assert.equal(kindOf(this), "greeter");
    return (this.mode as Extract<Mode, { kind: "greeter" }>).greeter;
  }
}

/** Read through a function so one assertion's narrowing doesn't leak into the next. */
const kindOf = (seat: Seat): string => seat.mode.kind;

/** Boot to a connected greeter. */
function ready(): Seat {
  const seat = new Seat();
  const effects = seat.boot();
  const spawn = effects.find((effect) => effect.kind === "spawn-worker");
  assert(spawn?.kind === "spawn-worker");
  assert.equal(spawn.job.service, "moire-dm-greeter");
  assert.equal(spawn.job.sessionClass, "greeter");
  assert.equal(spawn.job.mode, "trusted");
  assert.equal(spawn.job.greeterSocket, config.socket);
  seat.send({ kind: "connected", connection: 1 });
  return seat;
}

/** Drive one successful password login up to "authorized"; returns the auth worker id. */
function authorize(seat: Seat, user = "alice"): number {
  seat.request({ type: "begin", account: user });
  const spawn = seat.of("spawn-worker")[0];
  assert(spawn, "create_session spawns an authentication worker");
  assert.deepEqual(
    { service: spawn.job.service, user: spawn.job.user, mode: spawn.job.mode },
    { service: "moire-dm", user, mode: "authenticate" },
  );
  assert.equal(spawn.job.greeterSocket, null);
  assert.deepEqual(seat.replies(), [], "no reply until the worker speaks");
  const worker = spawn.worker;
  seat.worker(worker, { kind: "prompt", style: "secret", text: "Password: " });
  assert.deepEqual(seat.replies(), [{ type: "prompt", style: "secret", text: "Password: " }]);
  seat.request({ type: "answer", response: SECRET });
  const forwarded = seat.of("send-worker")[0];
  assert(forwarded?.command.kind === "answer");
  assert.equal(forwarded.command.response, SECRET, "answer bytes are forwarded, not copied");
  seat.worker(worker, { kind: "authorized", user });
  assert.deepEqual(seat.replies(), [{ type: "authorized" }]);
  return worker;
}

function noSecretIn(value: unknown) {
  const text = JSON.stringify(value, (_key, item) =>
    item instanceof Uint8Array ? Buffer.from(item).toString("utf8") : item,
  );
  assert(!text.includes("SYNTHETIC-state-secret"), "state never retains an answer");
}

// 1. Full vertical: greeter → login → handoff → session → logout → fresh greeter.
{
  const seat = ready();
  const greeter = seat.greeter();
  const worker = authorize(seat);
  noSecretIn(seat.state);
  seat.request({ type: "sessions" });
  assert.deepEqual(seat.replies(), [
    {
      type: "sessions",
      sessions: [
        { id: "moire", label: "Moire" },
        { id: "safe", label: "Moire (safe mode)" },
      ],
    },
  ]);
  seat.request({ type: "start", session: "moire" });
  assert.deepEqual(seat.replies(), [{ type: "scheduled" }]);
  assert.equal(kindOf(seat), "handoff");
  const timer = seat.of("timer")[0];
  assert.equal(timer?.at, seat.now + GREETER_EXIT_MS);
  assert.equal(seat.of("send-worker").length, 0, "session waits for the greeter to leave");
  // The greeter disconnects, then exits.
  seat.send({ kind: "disconnected", connection: 1 });
  seat.exited(greeter);
  const start = seat.of("send-worker")[0];
  assert.equal(start?.worker, worker);
  assert.deepEqual(start?.command, { kind: "start", session: config.sessions[0] });
  assert.equal(kindOf(seat), "launching");
  seat.worker(worker, { kind: "started", pid: 4242 });
  assert.equal(kindOf(seat), "running");
  assert.deepEqual(seat.of("log")[0]?.entry, { code: "session-start", user: "alice" });
  // A late handoff timer is harmless.
  seat.send({ kind: "timer", token: timer!.token, now: seat.now + GREETER_EXIT_MS });
  assert.deepEqual(seat.effects, []);
  // Logout: the session (and its worker) end; a new greeter with a new id appears.
  seat.worker(worker, { kind: "ended", status: 0 });
  seat.exited(worker);
  assert.deepEqual(seat.of("log")[0]?.entry, { code: "session-end", user: "alice" });
  const fresh = seat.greeter();
  assert.notEqual(fresh, greeter);
  assert.deepEqual(seat.state.live, [fresh]);
  // A fresh login needs fresh authentication: start_session alone is refused.
  seat.send({ kind: "connected", connection: 2 });
  seat.request({ type: "start", session: "moire" }, 2);
  assert.equal(seat.replies()[0]?.type, "error");
}

// 2. Wrong password, then right; denial is auth_error; failures reset on success.
{
  const seat = ready();
  seat.request({ type: "begin", account: "alice" });
  const first = seat.of("spawn-worker")[0]!.worker;
  seat.worker(first, { kind: "prompt", style: "secret", text: "Password: " });
  seat.request({ type: "answer", response: SECRET });
  seat.worker(first, { kind: "denied" });
  assert.deepEqual(seat.replies(), [{ type: "error", code: "denied" }]);
  assert.equal(seat.state.failures, 1);
  assert.deepEqual(seat.of("log")[0]?.entry, { code: "auth-denied" }, "no account name on failure");
  // Clients may cancel after a denial; it must succeed with nothing to cancel.
  seat.request({ type: "cancel" });
  assert.deepEqual(seat.replies(), [{ type: "cancelled" }]);
  assert.equal(seat.of("stop-worker").length, 0);
  // The denied worker's late events are ignored.
  seat.worker(first, { kind: "prompt", style: "secret", text: "late" });
  assert.deepEqual(seat.effects, []);
  authorize(seat);
  assert.equal(seat.state.failures, 0);
}

// 3. Lockout: after five failures the next attempt is held, reply and worker both wait.
{
  const seat = ready();
  for (let attempt = 0; attempt < LOCKOUT_AFTER_FAILURES; attempt++) {
    seat.request({ type: "begin", account: "alice" });
    const worker = seat.of("spawn-worker")[0]!.worker;
    seat.worker(worker, { kind: "denied" });
  }
  seat.request({ type: "begin", account: "alice" });
  assert.equal(seat.of("spawn-worker").length, 0, "held: no worker yet");
  assert.deepEqual(seat.replies(), []);
  const hold = seat.of("timer")[0]!;
  assert.equal(hold.at, seat.now + LOCKOUT_MS);
  // Pipelining while held is a violation.
  seat.request({ type: "cancel" });
  assert.deepEqual(seat.of("close-connection"), [{ kind: "close-connection", connection: 1 }]);
  // The stale timer after the connection dropped does nothing.
  seat.send({ kind: "timer", token: hold.token, now: hold.at });
  assert.equal(seat.of("spawn-worker").length, 0);
  // Reconnect: still locked out until a success.
  seat.send({ kind: "connected", connection: 2 });
  seat.request({ type: "begin", account: "alice" }, 2);
  const next = seat.of("timer")[0]!;
  seat.now = next.at;
  seat.send({ kind: "timer", token: next.token, now: next.at });
  const spawned = seat.of("spawn-worker")[0];
  assert(spawned && next.token.kind === "held" && spawned.worker === next.token.worker);
  seat.worker(spawned.worker, { kind: "authorized", user: "alice" });
  assert.equal(seat.state.failures, 0);
}

// 4. Cancel mid-prompt stops the worker; a stale prompt from it changes nothing.
{
  const seat = ready();
  seat.request({ type: "begin", account: "alice" });
  const worker = seat.of("spawn-worker")[0]!.worker;
  seat.worker(worker, { kind: "prompt", style: "secret", text: "Password: " });
  seat.request({ type: "cancel" });
  assert.deepEqual(seat.of("stop-worker"), [{ kind: "stop-worker", worker }]);
  assert.deepEqual(seat.replies(), [{ type: "cancelled" }]);
  seat.worker(worker, { kind: "cancelled" });
  seat.exited(worker);
  assert.deepEqual(seat.effects, []);
  assert.equal(kindOf(seat), "greeter");
}

// 5. Answer shape must match the prompt; requests out of phase get errors, not crashes.
{
  const seat = ready();
  seat.request({ type: "answer", response: SECRET });
  assert.equal(seat.replies()[0]?.type, "error");
  seat.request({ type: "start", session: "moire" });
  assert.equal(seat.replies()[0]?.type, "error");
  seat.request({ type: "begin", account: "alice" });
  const worker = seat.of("spawn-worker")[0]!.worker;
  seat.worker(worker, { kind: "prompt", style: "info", text: "Welcome" });
  seat.request({ type: "answer", response: SECRET });
  assert.equal(seat.replies()[0]?.type, "error", "info needs a null acknowledgement");
  assert.equal(seat.of("send-worker").length, 0);
  seat.request({ type: "answer", response: null });
  assert.deepEqual(seat.of("send-worker")[0]?.command, { kind: "answer", response: null });
  seat.worker(worker, { kind: "prompt", style: "secret", text: "Password: " });
  seat.request({ type: "answer", response: null });
  assert.equal(seat.replies()[0]?.type, "error", "secret needs bytes");
  seat.request({ type: "begin", account: "bob" });
  assert.equal(seat.replies()[0]?.type, "error", "one attempt at a time");
}

// 6. Invalid account syntax is a denial without PAM, and counts as a failure.
{
  const seat = ready();
  seat.request({ type: "begin", account: "Robert'); DROP" });
  assert.equal(seat.of("spawn-worker").length, 0);
  assert.equal(seat.replies()[0]?.type, "error");
  assert.equal(seat.state.failures, 1);
}

// 7. start: only a catalog id; an unknown id leaves the attempt authorized.
{
  const seat = ready();
  authorize(seat);
  seat.request({ type: "start", session: "/bin/sh" });
  assert.deepEqual(seat.replies(), [{ type: "error", code: "unknown-session" }]);
  assert.deepEqual(seat.of("log")[0]?.entry, { code: "session-rejected" });
  assert.equal(kindOf(seat), "greeter", "still authorized, can retry with the right session");
  seat.request({ type: "start", session: "safe" });
  assert.equal(kindOf(seat), "handoff");
  const greeter = (seat.state.mode as Extract<Mode, { kind: "handoff" }>).greeter;
  seat.exited(greeter);
  assert.deepEqual(seat.of("send-worker")[0]?.command, {
    kind: "start",
    session: config.sessions[1],
  });
}

// 8. Handoff timeout stops a greeter that won't leave; the session still starts after it exits.
{
  const seat = ready();
  const greeter = seat.greeter();
  const worker = authorize(seat);
  seat.request({ type: "start", session: "moire" });
  const timer = seat.of("timer")[0]!;
  seat.send({ kind: "timer", token: timer.token, now: timer.at });
  assert.deepEqual(seat.of("stop-worker"), [{ kind: "stop-worker", worker: greeter }]);
  seat.exited(greeter);
  assert.equal(seat.of("send-worker")[0]?.worker, worker);
}

// 9. Auth worker dies after authorization but before start: greeter is respawned, no session.
{
  const seat = ready();
  const greeter = seat.greeter();
  const worker = authorize(seat);
  seat.request({ type: "start", session: "moire" });
  seat.exited(worker);
  assert.deepEqual(seat.of("log")[0]?.entry, { code: "session-failed", detail: "worker-exit" });
  seat.exited(greeter);
  assert.equal(seat.of("send-worker").length, 0);
  assert.equal(kindOf(seat), "greeter");
  assert.notEqual(seat.greeter(), greeter);
}

// 10. Session fails to open (worker exits while launching): back to a greeter.
{
  const seat = ready();
  const greeter = seat.greeter();
  const worker = authorize(seat);
  seat.request({ type: "start", session: "moire" });
  seat.exited(greeter);
  seat.worker(worker, { kind: "failed", reason: "session" });
  seat.exited(worker);
  assert.equal(kindOf(seat), "greeter");
}

// 11. Worker crash mid-authentication with a pending request: an error reply, attempt cleared.
{
  const seat = ready();
  seat.request({ type: "begin", account: "alice" });
  const worker = seat.of("spawn-worker")[0]!.worker;
  seat.exited(worker);
  assert.equal(seat.replies()[0]?.type, "error");
  const mode = seat.mode as Extract<Mode, { kind: "greeter" }>;
  assert.equal(mode.auth.kind, "idle");
  assert.equal(mode.pending, false);
}

// 12. Worker failure event (PAM unavailable) is an error reply, not a denial.
{
  const seat = ready();
  seat.request({ type: "begin", account: "alice" });
  const worker = seat.of("spawn-worker")[0]!.worker;
  seat.worker(worker, { kind: "failed", reason: "pam-start" });
  assert.deepEqual(seat.replies(), [{ type: "error", code: "unavailable" }]);
  assert.equal(seat.state.failures, 0, "infrastructure failures don't count against the user");
}

// 13. Out-of-turn worker message (a prompt while one is already open) ends the attempt.
{
  const seat = ready();
  seat.request({ type: "begin", account: "alice" });
  const worker = seat.of("spawn-worker")[0]!.worker;
  seat.worker(worker, { kind: "prompt", style: "secret", text: "Password: " });
  seat.worker(worker, { kind: "authorized", user: "alice" });
  assert.deepEqual(seat.of("stop-worker"), [{ kind: "stop-worker", worker }]);
  seat.request({ type: "answer", response: SECRET });
  assert.equal(seat.replies()[0]?.type, "error");
}

// 14. One connection at a time; strangers and pipelined requests are dropped.
{
  const seat = ready();
  seat.send({ kind: "connected", connection: 9 });
  assert.deepEqual(seat.of("close-connection"), [{ kind: "close-connection", connection: 9 }]);
  seat.request({ type: "cancel" }, 9);
  assert.deepEqual(seat.of("close-connection"), [{ kind: "close-connection", connection: 9 }]);
  seat.request({ type: "begin", account: "alice" });
  const worker = seat.of("spawn-worker")[0]!.worker;
  seat.request({ type: "cancel" });
  assert.deepEqual(seat.of("stop-worker"), [{ kind: "stop-worker", worker }]);
  assert.deepEqual(seat.of("close-connection"), [{ kind: "close-connection", connection: 1 }]);
  seat.send({ kind: "violation", connection: 1 });
  assert.equal(kindOf(seat), "greeter");
}

// 15. Disconnect mid-attempt cancels it; the greeter can reconnect.
{
  const seat = ready();
  seat.request({ type: "begin", account: "alice" });
  const worker = seat.of("spawn-worker")[0]!.worker;
  seat.send({ kind: "disconnected", connection: 1 });
  assert.deepEqual(seat.of("stop-worker"), [{ kind: "stop-worker", worker }]);
  seat.send({ kind: "connected", connection: 2 });
  assert.equal((seat.mode as Extract<Mode, { kind: "greeter" }>).connection, 2);
}

// 16. Greeter crash loop fails closed: exit(1), never a session.
{
  const seat = ready();
  for (let crash = 0; crash <= GREETER_CRASH_LIMIT; crash++) {
    seat.now += 1_000;
    seat.exited(seat.greeter());
  }
  assert.equal(kindOf(seat), "failed");
  assert.deepEqual(seat.of("exit"), [{ kind: "exit", status: 1 }]);
  assert.equal(seat.of("spawn-worker").length, 0);
  // Slow crashes (outside the window) keep respawning.
  const slow = ready();
  for (let crash = 0; crash < GREETER_CRASH_LIMIT * 3; crash++) {
    slow.now += 61_000;
    slow.exited(slow.greeter());
  }
  assert.equal(kindOf(slow), "greeter");
}

// 17. Automatic login: trusted job, then the greeter after logout; invalid state → greeter.
{
  const seat = new Seat();
  seat.boot({ kind: "enabled", user: "alice", session: config.sessions[0]! });
  const spawn = seat.of("spawn-worker")[0]!;
  assert.deepEqual(
    { service: spawn.job.service, mode: spawn.job.mode, session: spawn.job.session },
    { service: "moire-dm-autologin", mode: "trusted", session: config.sessions[0] },
  );
  seat.send({ kind: "connected", connection: 1 });
  assert.deepEqual(seat.of("close-connection"), [{ kind: "close-connection", connection: 1 }]);
  seat.worker(spawn.worker, { kind: "started", pid: 77 });
  assert.equal(kindOf(seat), "running");
  seat.exited(spawn.worker);
  assert.equal(kindOf(seat), "greeter");
  // A failed automatic login (account expired, say) falls back to the greeter.
  const failed = new Seat();
  failed.boot({ kind: "enabled", user: "alice", session: config.sessions[0]! });
  failed.exited(failed.of("spawn-worker")[0]!.worker);
  assert.deepEqual(failed.of("log")[0]?.entry, { code: "autologin-failed" });
  assert.equal(kindOf(failed), "greeter");
  const invalid = new Seat();
  invalid.boot({ kind: "invalid", reason: "mode" });
  assert.deepEqual(invalid.of("log")[0]?.entry, { code: "autologin-skipped", detail: "mode" });
  assert.equal(kindOf(invalid), "greeter");
  // Boot twice is ignored.
  invalid.boot();
  assert.deepEqual(invalid.effects, []);
}

// 18. Shutdown stops every live worker (including cancelled ones) and exits when all are gone.
{
  const seat = ready();
  const greeter = seat.greeter();
  seat.request({ type: "begin", account: "alice" });
  const cancelled = seat.of("spawn-worker")[0]!.worker;
  seat.worker(cancelled, { kind: "prompt", style: "secret", text: "Password: " });
  seat.request({ type: "cancel" });
  seat.request({ type: "begin", account: "alice" });
  const current = seat.of("spawn-worker")[0]!.worker;
  seat.send({ kind: "shutdown" });
  assert.deepEqual(
    seat
      .of("stop-worker")
      .map((effect) => effect.worker)
      .sort(),
    [greeter, cancelled, current].sort(),
  );
  assert.equal(seat.of("exit").length, 0);
  seat.exited(greeter);
  seat.exited(cancelled);
  assert.equal(seat.of("exit").length, 0);
  assert.equal(seat.of("spawn-worker").length, 0, "no greeter respawn while stopping");
  seat.exited(current);
  assert.deepEqual(seat.of("exit"), [{ kind: "exit", status: 0 }]);
  seat.send({ kind: "shutdown" });
  assert.deepEqual(seat.effects, []);
  const empty = new Seat();
  assert.deepEqual(empty.send({ kind: "shutdown" }), [{ kind: "exit", status: 0 }]);
}

// 19. Requests outside greeter mode (during a session) close the connection.
{
  const seat = new Seat();
  seat.boot({ kind: "enabled", user: "alice", session: config.sessions[0]! });
  seat.request({ type: "begin", account: "alice" });
  assert.deepEqual(seat.of("close-connection"), [{ kind: "close-connection", connection: 1 }]);
  assert.equal(seat.of("spawn-worker").length, 0);
}

// 21. Restart over a live session: wait for it, stop old greeters, never draw on top.
{
  const seat = new Seat();
  seat.send({
    kind: "boot",
    now: seat.now,
    autologin: { kind: "enabled", user: "alice", session: config.sessions[0]! },
    seat: { ok: true, users: 1, greeterLeaders: [4321] },
  });
  assert.equal(kindOf(seat), "recovering");
  assert.equal(seat.of("spawn-worker").length, 0, "no greeter, no automatic login over a session");
  assert.deepEqual(seat.of("signal-leader"), [{ kind: "signal-leader", pid: 4321 }]);
  assert.deepEqual(seat.of("check-seat"), [{ kind: "check-seat", at: seat.now + SEAT_RECHECK_MS }]);
  assert.deepEqual(seat.of("log")[0]?.entry, { code: "seat-busy", detail: "users=1" });
  // A greeter connecting meanwhile is turned away.
  seat.send({ kind: "connected", connection: 1 });
  assert.deepEqual(seat.of("close-connection"), [{ kind: "close-connection", connection: 1 }]);
  seat.request({ type: "begin", account: "alice" });
  assert.equal(seat.of("spawn-worker").length, 0);
  // Still busy: keep waiting.
  seat.now += SEAT_RECHECK_MS;
  seat.send({ kind: "seat", seat: { ok: true, users: 1, greeterLeaders: [] }, now: seat.now });
  assert.equal(kindOf(seat), "recovering");
  assert.equal(seat.of("check-seat").length, 1);
  // The user logs out of the old session: a greeter (never automatic login) appears.
  seat.send({ kind: "seat", seat: FREE, now: seat.now });
  assert.equal(kindOf(seat), "greeter");
  assert.equal(seat.of("spawn-worker")[0]?.job.service, "moire-dm-greeter");
  assert.deepEqual(seat.of("log")[0]?.entry, { code: "seat-free" });
  // Late seat events after recovery are ignored.
  seat.send({ kind: "seat", seat: { ok: true, users: 3, greeterLeaders: [1] }, now: seat.now });
  assert.deepEqual(seat.effects, []);
  // logind unavailable at boot: log it and boot normally (no logind means no pam_systemd sessions).
  const unknown = new Seat();
  unknown.send({ kind: "boot", now: 0, autologin: { kind: "disabled" }, seat: { ok: false } });
  assert.deepEqual(unknown.of("log")[0]?.entry, { code: "seat-unknown" });
  assert.equal(kindOf(unknown), "greeter");
  // Shutdown while waiting: nothing of ours is running, so exit at once.
  const waiting = new Seat();
  waiting.send({
    kind: "boot",
    now: 0,
    autologin: { kind: "disabled" },
    seat: { ok: true, users: 1, greeterLeaders: [] },
  });
  assert.deepEqual(waiting.send({ kind: "shutdown" }), [{ kind: "exit", status: 0 }]);
}

// 20. Exhaustive no-crash sweep: every event kind in every reachable mode keeps invariants.
{
  const requests: GreeterRequest[] = [
    { type: "begin", account: "alice" },
    { type: "answer", response: SECRET },
    { type: "answer", response: null },
    { type: "start", session: "moire" },
    { type: "cancel" },
    { type: "sessions" },
    { type: "start", session: "nope" },
  ];
  const workerEvents: WorkerEvent[] = [
    { kind: "prompt", style: "secret", text: "Password: " },
    { kind: "prompt", style: "info", text: "Hi" },
    { kind: "authorized", user: "alice" },
    { kind: "denied" },
    { kind: "cancelled" },
    { kind: "failed", reason: "session" },
    { kind: "started", pid: 1 },
    { kind: "ended", status: 0 },
  ];
  let seed = 7;
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  for (let run = 0; run < 300; run++) {
    const seat = new Seat();
    seat.boot(
      random(3) === 0
        ? { kind: "enabled", user: "alice", session: config.sessions[0]! }
        : undefined,
    );
    for (let move = 0; move < 60; move++) {
      seat.now += random(30_000);
      const ids = [...seat.state.live, seat.state.nextWorker - 1, 99];
      const pick = random(8);
      if (pick < 3) seat.request(requests[random(requests.length)]!, 1 + random(2));
      else if (pick === 3)
        seat.worker(ids[random(ids.length)]!, workerEvents[random(workerEvents.length)]!);
      else if (pick === 4) seat.exited(ids[random(ids.length)]!);
      else if (pick === 5)
        seat.send({ kind: random(2) ? "connected" : "disconnected", connection: 1 + random(2) });
      else if (pick === 6)
        seat.send({
          kind: "timer",
          token: { kind: "held", worker: ids[random(ids.length)]! },
          now: seat.now,
        });
      else
        seat.send({
          kind: "timer",
          token: { kind: "handoff", greeter: ids[random(ids.length)]! },
          now: seat.now,
        });
      noSecretIn(seat.state);
      const live = seat.state.live;
      assert.equal(new Set(live).size, live.length, "live workers are unique");
      for (const effect of seat.effects)
        if (effect.kind === "spawn-worker")
          assert(effect.worker >= 1 && effect.worker < seat.state.nextWorker);
      const mode = seat.state.mode;
      if (mode.kind === "running" || mode.kind === "launching" || mode.kind === "autologin")
        assert(live.includes(mode.worker), "the seat's session worker is live");
      if (mode.kind === "greeter") assert(live.includes(mode.greeter), "the greeter is live");
      if (mode.kind === "failed") break;
    }
  }
}

console.log(`moire-dm state smoke ok (${cases} transitions)`);
