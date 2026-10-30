/**
 * moire-dm's seat state machine: pure, synchronous, no I/O.
 *
 * `step(config, state, event)` returns the next state and the effects the daemon must carry out
 * (spawn or stop a worker, reply to the greeter, arm a timer, log, exit). Time arrives inside
 * events. Workers are named by number and never reused, so a late message from a cancelled or
 * replaced worker can't be mistaken for the current one.
 *
 * Secrets: the only secret that passes through here is an answer's bytes, inside a `request`
 * event, forwarded unchanged in a `send-worker` effect. No state holds it; the daemon wipes it
 * after carrying out the effects.
 */
import { sessionById, validAccountName, type Autologin, type DmConfig } from "./config";
import type { ErrorCode, GreeterReply, GreeterRequest, PromptStyle } from "./protocol";
import type { SeatSnapshot } from "./seat";
import type { SessionSpec, WorkerCommand, WorkerEvent, WorkerJob } from "./worker-channel";

export type WorkerId = number;
export type ConnectionId = number;

/** Consecutive failures before the lockout hold starts. */
export const LOCKOUT_AFTER_FAILURES = 5;
/**
 * Hold on each new attempt once locked out. Kept under the greeter client's 30 s request
 * timeout, since the hold delays the reply to begin. PAM adds its own ~2 s per failure.
 */
export const LOCKOUT_MS = 20_000;
/** After start, the greeter has this long to exit before it is stopped. */
export const GREETER_EXIT_MS = 5_000;
/** More greeter exits than this within the window and moire-dm gives up (systemd restarts it). */
export const GREETER_CRASH_LIMIT = 5;
export const GREETER_CRASH_WINDOW_MS = 60_000;
/** While waiting for sessions from before a restart, how often logind is asked again. */
export const SEAT_RECHECK_MS = 1_000;

const SERVICE_LOGIN = "moire-dm";
const SERVICE_AUTOLOGIN = "moire-dm-autologin";
const SERVICE_GREETER = "moire-dm-greeter";

type Auth =
  | Readonly<{ kind: "idle" }>
  /** Locked out: the worker is not spawned until `until`; the greeter's reply waits too. */
  | Readonly<{ kind: "held"; worker: WorkerId; user: string; until: number }>
  | Readonly<{ kind: "starting"; worker: WorkerId }>
  | Readonly<{ kind: "prompt"; worker: WorkerId; style: PromptStyle }>
  | Readonly<{ kind: "verifying"; worker: WorkerId }>
  | Readonly<{ kind: "authorized"; worker: WorkerId; user: string }>;

export type Mode =
  | Readonly<{ kind: "idle" }>
  /** Restarted over sessions we opened before: wait for them; never draw a greeter on top. */
  | Readonly<{ kind: "recovering" }>
  | Readonly<{ kind: "autologin"; worker: WorkerId; user: string }>
  | Readonly<{
      kind: "greeter";
      greeter: WorkerId;
      connection: ConnectionId | null;
      /** A greeter request is waiting for its reply; a second one is a protocol violation. */
      pending: boolean;
      auth: Auth;
    }>
  | Readonly<{
      kind: "handoff";
      greeter: WorkerId;
      worker: WorkerId | null;
      user: string;
      session: SessionSpec;
    }>
  | Readonly<{ kind: "launching" | "running"; worker: WorkerId; user: string; autologin: boolean }>
  | Readonly<{ kind: "stopping" }>
  | Readonly<{ kind: "failed" }>;

export type DmState = Readonly<{
  mode: Mode;
  nextWorker: WorkerId;
  /** Every worker not yet seen to exit, including cancelled ones. */
  live: readonly WorkerId[];
  failures: number;
  greeterExits: readonly number[];
}>;

export type TimerToken =
  | Readonly<{ kind: "held"; worker: WorkerId }>
  | Readonly<{ kind: "handoff"; greeter: WorkerId }>;

export type DmEvent =
  | Readonly<{ kind: "boot"; now: number; autologin: Autologin; seat: SeatSnapshot }>
  | Readonly<{ kind: "seat"; seat: SeatSnapshot; now: number }>
  | Readonly<{ kind: "connected"; connection: ConnectionId }>
  | Readonly<{ kind: "disconnected"; connection: ConnectionId }>
  | Readonly<{ kind: "violation"; connection: ConnectionId }>
  | Readonly<{ kind: "request"; connection: ConnectionId; request: GreeterRequest; now: number }>
  | Readonly<{ kind: "worker"; worker: WorkerId; event: WorkerEvent; now: number }>
  | Readonly<{ kind: "worker-exited"; worker: WorkerId; now: number }>
  | Readonly<{ kind: "timer"; token: TimerToken; now: number }>
  | Readonly<{ kind: "shutdown" }>;

export type LogCode =
  | "autologin-start"
  | "autologin-skipped"
  | "autologin-failed"
  | "boot-display-released"
  | "greeter-start"
  | "greeter-exit"
  | "greeter-crash-loop"
  | "greeter-violation"
  | "auth-denied"
  | "auth-held"
  | "auth-unavailable"
  | "session-rejected"
  | "session-start"
  | "session-failed"
  | "session-end"
  | "seat-busy"
  | "seat-free"
  | "seat-unknown"
  | "front-exit";

/** Log lines carry a code and, only for sessions that really started, the account name. */
export type LogEntry = Readonly<{ code: LogCode; user?: string; detail?: string }>;

export type Effect =
  | Readonly<{ kind: "spawn-worker"; worker: WorkerId; job: WorkerJob }>
  | Readonly<{ kind: "send-worker"; worker: WorkerId; command: WorkerCommand }>
  /** Ask the worker to finish (cancel or SIGTERM); the daemon escalates to SIGKILL on a timer. */
  | Readonly<{ kind: "stop-worker"; worker: WorkerId }>
  | Readonly<{ kind: "reply"; connection: ConnectionId; reply: GreeterReply }>
  | Readonly<{ kind: "close-connection"; connection: ConnectionId }>
  | Readonly<{ kind: "timer"; at: number; token: TimerToken }>
  /** Ask logind about the seat again at `at`; the answer comes back as a "seat" event. */
  | Readonly<{ kind: "check-seat"; at: number }>
  /** SIGTERM to a session worker left from before a restart (it ends its session and PAM). */
  | Readonly<{ kind: "signal-leader"; pid: number }>
  | Readonly<{ kind: "log"; entry: LogEntry }>
  | Readonly<{ kind: "exit"; status: 0 | 1 }>;

export type Step = Readonly<{ state: DmState; effects: readonly Effect[] }>;

export const initialState: DmState = {
  mode: { kind: "idle" },
  nextWorker: 1,
  live: [],
  failures: 0,
  greeterExits: [],
};

function failure(code: ErrorCode): GreeterReply {
  return { type: "error", code };
}
const DENIED = failure("denied");

class Builder {
  readonly effects: Effect[] = [];
  constructor(public state: DmState) {}
  set(patch: Partial<DmState>): void {
    this.state = { ...this.state, ...patch };
  }
  mode(mode: Mode): void {
    this.set({ mode });
  }
  emit(effect: Effect): void {
    this.effects.push(effect);
  }
  log(code: LogCode, extra: Omit<LogEntry, "code"> = {}): void {
    this.emit({ kind: "log", entry: { code, ...extra } });
  }
  spawn(job: WorkerJob): WorkerId {
    const worker = this.state.nextWorker;
    this.set({ nextWorker: worker + 1, live: [...this.state.live, worker] });
    this.emit({ kind: "spawn-worker", worker, job });
    return worker;
  }
  /** Allocate an id for a worker spawned later (a held attempt). */
  reserve(): WorkerId {
    const worker = this.state.nextWorker;
    this.set({ nextWorker: worker + 1 });
    return worker;
  }
  spawnReserved(worker: WorkerId, job: WorkerJob): void {
    this.set({ live: [...this.state.live, worker] });
    this.emit({ kind: "spawn-worker", worker, job });
  }
  done(): Step {
    return { state: this.state, effects: this.effects };
  }
}

function loginJob(config: DmConfig, user: string): WorkerJob {
  return {
    service: SERVICE_LOGIN,
    user,
    mode: "authenticate",
    sessionClass: "user",
    session: null,
    vt: config.vt,
    greeterSocket: null,
  };
}

function startGreeter(config: DmConfig, b: Builder): void {
  const greeter = b.spawn({
    service: SERVICE_GREETER,
    user: config.greeter.user,
    mode: "trusted",
    sessionClass: "greeter",
    session: {
      id: "greeter",
      label: "Greeter",
      argv: config.greeter.argv,
      desktop: "moire-greeter",
    },
    vt: config.vt,
    greeterSocket: config.socket,
  });
  b.mode({ kind: "greeter", greeter, connection: null, pending: false, auth: { kind: "idle" } });
  b.log("greeter-start");
}

/** End whatever authentication attempt is in flight, without replying to anyone. */
function dropAuth(auth: Auth, b: Builder): void {
  if (auth.kind === "idle" || auth.kind === "held") return;
  b.emit({ kind: "stop-worker", worker: auth.worker });
}

function authWorker(auth: Auth): WorkerId | null {
  return auth.kind === "idle" ? null : auth.worker;
}

function greeterRequest(
  config: DmConfig,
  mode: Extract<Mode, { kind: "greeter" }>,
  connection: ConnectionId,
  request: GreeterRequest,
  now: number,
  b: Builder,
): void {
  if (connection !== mode.connection || mode.pending) {
    // A stranger, or pipelining: both are protocol violations from the greeter's side.
    b.log("greeter-violation");
    b.emit({ kind: "close-connection", connection });
    if (connection === mode.connection) {
      dropAuth(mode.auth, b);
      b.mode({ ...mode, connection: null, pending: false, auth: { kind: "idle" } });
    }
    return;
  }
  const reply = (r: GreeterReply, next: Partial<typeof mode> = {}) => {
    b.emit({ kind: "reply", connection, reply: r });
    b.mode({ ...mode, pending: false, ...next });
  };
  const auth = mode.auth;
  switch (request.type) {
    case "begin": {
      if (auth.kind !== "idle") return reply(failure("busy"));
      if (!validAccountName(request.account)) {
        // Syntax alone reveals nothing about which accounts exist.
        b.set({ failures: b.state.failures + 1 });
        b.log("auth-denied");
        return reply(DENIED);
      }
      if (b.state.failures >= LOCKOUT_AFTER_FAILURES) {
        const worker = b.reserve();
        const until = now + LOCKOUT_MS;
        b.emit({ kind: "timer", at: until, token: { kind: "held", worker } });
        b.log("auth-held");
        b.mode({
          ...mode,
          pending: true,
          auth: { kind: "held", worker, user: request.account, until },
        });
        return;
      }
      const worker = b.spawn(loginJob(config, request.account));
      b.mode({ ...mode, pending: true, auth: { kind: "starting", worker } });
      return;
    }
    case "answer": {
      if (auth.kind !== "prompt") return reply(failure("bad-state"));
      const question = auth.style === "secret" || auth.style === "visible";
      if (question !== (request.response !== null)) return reply(failure("bad-state"));
      b.emit({
        kind: "send-worker",
        worker: auth.worker,
        command: { kind: "answer", response: request.response },
      });
      b.mode({ ...mode, pending: true, auth: { kind: "verifying", worker: auth.worker } });
      return;
    }
    case "start": {
      if (auth.kind !== "authorized") return reply(failure("bad-state"));
      const session = sessionById(config, request.session);
      if (!session) {
        b.log("session-rejected");
        return reply(failure("unknown-session"));
      }
      b.emit({ kind: "reply", connection, reply: { type: "scheduled" } });
      b.emit({
        kind: "timer",
        at: now + GREETER_EXIT_MS,
        token: { kind: "handoff", greeter: mode.greeter },
      });
      b.mode({
        kind: "handoff",
        greeter: mode.greeter,
        worker: auth.worker,
        user: auth.user,
        session,
      });
      return;
    }
    case "cancel": {
      dropAuth(auth, b);
      return reply({ type: "cancelled" }, { auth: { kind: "idle" } });
    }
    case "sessions":
      return reply({
        type: "sessions",
        sessions: config.sessions.map(({ id, label }) => ({ id, label })),
      });
  }
}

function greeterWorkerEvent(
  mode: Extract<Mode, { kind: "greeter" }>,
  worker: WorkerId,
  event: WorkerEvent,
  b: Builder,
): void {
  const auth = mode.auth;
  if (worker !== authWorker(auth) || mode.connection === null) return;
  const connection = mode.connection;
  const awaiting = auth.kind === "starting" || auth.kind === "verifying";
  const reply = (r: GreeterReply, next: Auth) => {
    b.emit({ kind: "reply", connection, reply: r });
    b.mode({ ...mode, pending: false, auth: next });
  };
  if (!awaiting) {
    // The worker spoke out of turn (a prompt while one is open, say): end the attempt.
    b.emit({ kind: "stop-worker", worker });
    b.mode({ ...mode, auth: { kind: "idle" } });
    return;
  }
  switch (event.kind) {
    case "prompt":
      return reply(
        { type: "prompt", style: event.style, text: event.text },
        { kind: "prompt", worker, style: event.style },
      );
    case "authorized":
      b.set({ failures: 0 });
      return reply({ type: "authorized" }, { kind: "authorized", worker, user: event.user });
    case "denied":
      b.set({ failures: b.state.failures + 1 });
      b.log("auth-denied");
      return reply(DENIED, { kind: "idle" });
    case "failed":
    case "cancelled":
    case "started":
    case "ended":
      b.log("auth-unavailable", { detail: event.kind === "failed" ? event.reason : event.kind });
      b.emit({ kind: "stop-worker", worker });
      return reply(failure("unavailable"), { kind: "idle" });
  }
}

function greeterGone(config: DmConfig, now: number, b: Builder): void {
  const recent = [...b.state.greeterExits, now].filter((at) => now - at <= GREETER_CRASH_WINDOW_MS);
  b.set({ greeterExits: recent });
  if (recent.length > GREETER_CRASH_LIMIT) {
    // Fail closed: no greeter means no login, never a fallback session. systemd restarts us.
    b.log("greeter-crash-loop");
    b.mode({ kind: "failed" });
    b.emit({ kind: "exit", status: 1 });
    return;
  }
  startGreeter(config, b);
}

function workerExited(config: DmConfig, worker: WorkerId, now: number, b: Builder): void {
  const mode = b.state.mode;
  switch (mode.kind) {
    case "autologin":
      if (worker !== mode.worker) return;
      b.log("autologin-failed");
      return startGreeter(config, b);
    case "greeter":
      if (worker === mode.greeter) {
        b.log("greeter-exit");
        dropAuth(mode.auth, b);
        if (mode.connection !== null)
          b.emit({ kind: "close-connection", connection: mode.connection });
        return greeterGone(config, now, b);
      }
      if (worker === authWorker(mode.auth)) {
        const pending = mode.pending && mode.connection !== null;
        if (pending)
          b.emit({
            kind: "reply",
            connection: mode.connection!,
            reply: failure("unavailable"),
          });
        b.log("auth-unavailable", { detail: "exit" });
        b.mode({ ...mode, pending: false, auth: { kind: "idle" } });
      }
      return;
    case "handoff":
      if (worker === mode.worker) {
        // The authorized worker died before its session started; the greeter is leaving anyway.
        b.log("session-failed", { detail: "worker-exit" });
        b.mode({ ...mode, worker: null });
        return;
      }
      if (worker !== mode.greeter) return;
      if (mode.worker === null) return startGreeter(config, b);
      b.emit({
        kind: "send-worker",
        worker: mode.worker,
        command: { kind: "start", session: mode.session },
      });
      b.mode({ kind: "launching", worker: mode.worker, user: mode.user, autologin: false });
      return;
    case "launching":
      if (worker !== mode.worker) return;
      b.log("session-failed", { detail: "worker-exit" });
      return startGreeter(config, b);
    case "running":
      if (worker !== mode.worker) return;
      b.log("session-end", { user: mode.user });
      return startGreeter(config, b);
    case "idle":
    case "recovering":
    case "stopping":
    case "failed":
      return;
  }
}

/** One transition. Unknown or stale inputs leave the state alone (apart from bookkeeping). */
export function step(config: DmConfig, state: DmState, event: DmEvent): Step {
  const b = new Builder(state);
  const mode = state.mode;

  if (event.kind === "worker-exited") {
    b.set({ live: state.live.filter((id) => id !== event.worker) });
    if (mode.kind === "stopping") {
      if (b.state.live.length === 0) b.emit({ kind: "exit", status: 0 });
      return b.done();
    }
    workerExited(config, event.worker, event.now, b);
    return b.done();
  }

  if (event.kind === "shutdown") {
    if (mode.kind === "stopping" || mode.kind === "failed") return b.done();
    if (mode.kind === "greeter" && mode.connection !== null)
      b.emit({ kind: "close-connection", connection: mode.connection });
    for (const worker of state.live) b.emit({ kind: "stop-worker", worker });
    b.mode({ kind: "stopping" });
    if (state.live.length === 0) b.emit({ kind: "exit", status: 0 });
    return b.done();
  }

  switch (event.kind) {
    case "boot": {
      if (mode.kind !== "idle") return b.done();
      if (!event.seat.ok) b.log("seat-unknown");
      else if (event.seat.users > 0 || event.seat.greeterLeaders.length > 0) {
        // We were restarted. Sessions we opened survive in their own scopes; attach by
        // waiting for them, and end any old greeter, which talked to the previous broker.
        b.log("seat-busy", { detail: `users=${event.seat.users}` });
        for (const pid of event.seat.greeterLeaders) b.emit({ kind: "signal-leader", pid });
        b.emit({ kind: "check-seat", at: event.now + SEAT_RECHECK_MS });
        b.mode({ kind: "recovering" });
        return b.done();
      }
      if (event.autologin.kind === "enabled") {
        const { user, session } = event.autologin;
        const worker = b.spawn({
          service: SERVICE_AUTOLOGIN,
          user,
          mode: "trusted",
          sessionClass: "user",
          session,
          vt: config.vt,
          greeterSocket: null,
        });
        b.mode({ kind: "autologin", worker, user });
        b.log("autologin-start", { user });
        return b.done();
      }
      if (event.autologin.kind === "invalid")
        b.log("autologin-skipped", { detail: event.autologin.reason });
      startGreeter(config, b);
      return b.done();
    }
    case "seat": {
      if (mode.kind !== "recovering") return b.done();
      const busy = event.seat.ok && (event.seat.users > 0 || event.seat.greeterLeaders.length > 0);
      if (busy) {
        for (const pid of event.seat.ok ? event.seat.greeterLeaders : [])
          b.emit({ kind: "signal-leader", pid });
        b.emit({ kind: "check-seat", at: event.now + SEAT_RECHECK_MS });
        return b.done();
      }
      // Automatic login is a boot-time decision; after a recovery it is always the greeter.
      b.log(event.seat.ok ? "seat-free" : "seat-unknown");
      startGreeter(config, b);
      return b.done();
    }
    case "connected":
      if (mode.kind === "greeter" && mode.connection === null) {
        b.mode({ ...mode, connection: event.connection, pending: false });
        return b.done();
      }
      // One greeter connection at a time, and only while a greeter is the seat's owner.
      b.emit({ kind: "close-connection", connection: event.connection });
      return b.done();
    case "disconnected":
    case "violation":
      if (event.kind === "violation") {
        b.log("greeter-violation");
        b.emit({ kind: "close-connection", connection: event.connection });
      }
      if (mode.kind === "greeter" && mode.connection === event.connection) {
        dropAuth(mode.auth, b);
        b.mode({ ...mode, connection: null, pending: false, auth: { kind: "idle" } });
      }
      return b.done();
    case "request":
      if (mode.kind !== "greeter") {
        b.emit({ kind: "close-connection", connection: event.connection });
        return b.done();
      }
      greeterRequest(config, mode, event.connection, event.request, event.now, b);
      return b.done();
    case "worker": {
      if (mode.kind === "greeter") {
        if (event.worker !== mode.greeter) greeterWorkerEvent(mode, event.worker, event.event, b);
        return b.done();
      }
      if (
        (mode.kind === "autologin" || mode.kind === "launching") &&
        event.worker === mode.worker &&
        event.event.kind === "started"
      ) {
        const autologin = mode.kind === "autologin" || mode.autologin;
        b.mode({ kind: "running", worker: mode.worker, user: mode.user, autologin });
        b.log("session-start", { user: mode.user });
      }
      return b.done();
    }
    case "timer": {
      const token = event.token;
      if (
        token.kind === "held" &&
        mode.kind === "greeter" &&
        mode.auth.kind === "held" &&
        mode.auth.worker === token.worker
      ) {
        b.spawnReserved(token.worker, loginJob(config, mode.auth.user));
        b.mode({ ...mode, auth: { kind: "starting", worker: token.worker } });
      } else if (
        token.kind === "handoff" &&
        mode.kind === "handoff" &&
        mode.greeter === token.greeter
      ) {
        b.emit({ kind: "stop-worker", worker: mode.greeter });
      }
      return b.done();
    }
  }
}
