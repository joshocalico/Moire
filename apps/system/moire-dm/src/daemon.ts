/**
 * The broker's I/O shell around the state machine: the front process, worker processes,
 * timers and the logind seat check. Policy lives in state.ts; this file moves bytes and wipes
 * them. It never reads a greeter socket: the unprivileged front does, and hands over typed
 * requests, which are parsed here once more before the state machine sees them.
 */
import type { Autologin, DmConfig } from "./config";
import type { BrokerCommand, FrontEvent } from "./front-channel";
import { encodeReplyMessage, parseRequest } from "./protocol";
import type { SeatSnapshot } from "./seat";
import {
  initialState,
  step,
  type DmEvent,
  type DmState,
  type Effect,
  type LogEntry,
  type WorkerId,
} from "./state";
import type { WorkerCommand, WorkerEvent, WorkerJob } from "./worker-channel";

export type WorkerHandle = {
  send(command: WorkerCommand): void;
  /** Polite stop (cancel / SIGTERM), escalating to SIGKILL after a grace period. */
  stop(): void;
};

export type WorkerLauncher = (
  job: WorkerJob,
  onEvent: (event: WorkerEvent) => void,
  onExit: () => void,
) => WorkerHandle;

export type FrontHandle = {
  send(command: BrokerCommand): void;
  stop(): void;
};

export type FrontLauncher = (
  onEvent: (event: FrontEvent) => void,
  onExit: () => void,
) => FrontHandle;

export type DaemonOptions = Readonly<{
  config: DmConfig;
  launchFront: FrontLauncher;
  launchWorker: WorkerLauncher;
  autologin: () => Autologin;
  /**
   * Before an automatic login: take the display from a live boot stage for the session. Its
   * handoff directory is the greeter's, so the user's compositor can't ask for it itself.
   */
  releaseBootDisplay?: () => Promise<void>;
  observeSeat: () => SeatSnapshot;
  /** SIGTERM to a session worker left over from before a restart. */
  signalLeader: (pid: number) => void;
  log: (entry: LogEntry) => void;
  onExit: (status: 0 | 1) => void;
  now?: () => number;
}>;

export type Daemon = {
  readonly state: DmState;
  /** Starts the front, waits until it listens, then boots the seat. */
  start(): Promise<void>;
  shutdown(): void;
};

export function createDaemon(options: DaemonOptions): Daemon {
  const now = options.now ?? (() => Date.now());
  let state = initialState;
  const workers = new Map<WorkerId, WorkerHandle>();
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let front: FrontHandle | null = null;
  let exited = false;

  function dispatch(event: DmEvent): void {
    if (exited) return;
    const result = step(options.config, state, event);
    state = result.state;
    for (const effect of result.effects) apply(effect);
  }

  function later(at: number, run: () => void): void {
    const timer = setTimeout(
      () => {
        timers.delete(timer);
        run();
      },
      Math.max(0, at - now()),
    );
    timers.add(timer);
  }

  function apply(effect: Effect): void {
    switch (effect.kind) {
      case "spawn-worker": {
        const id = effect.worker;
        const handle = options.launchWorker(
          effect.job,
          (event) => dispatch({ kind: "worker", worker: id, event, now: now() }),
          () => {
            workers.delete(id);
            dispatch({ kind: "worker-exited", worker: id, now: now() });
          },
        );
        workers.set(id, handle);
        return;
      }
      case "send-worker":
        workers.get(effect.worker)?.send(effect.command);
        return;
      case "stop-worker":
        workers.get(effect.worker)?.stop();
        return;
      case "reply":
        front?.send({
          kind: "reply",
          connection: effect.connection,
          message: encodeReplyMessage(effect.reply),
        });
        return;
      case "close-connection":
        front?.send({ kind: "close", connection: effect.connection });
        return;
      case "timer": {
        const token = effect.token;
        later(effect.at, () => dispatch({ kind: "timer", token, now: now() }));
        return;
      }
      case "check-seat":
        later(effect.at, () => dispatch({ kind: "seat", seat: options.observeSeat(), now: now() }));
        return;
      case "signal-leader":
        options.signalLeader(effect.pid);
        return;
      case "log":
        options.log(effect.entry);
        return;
      case "exit":
        finish(effect.status);
        return;
    }
  }

  function finish(status: 0 | 1): void {
    if (exited) return;
    exited = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    front?.stop();
    options.onExit(status);
  }

  function frontEvent(event: FrontEvent): void {
    switch (event.kind) {
      case "ready":
        return;
      case "connected":
      case "disconnected":
      case "violation":
        dispatch({ kind: event.kind, connection: event.connection });
        return;
      case "request": {
        // The front already parsed and re-encoded this; parse again so root trusts no one.
        const parsed = parseRequest(event.message);
        event.message.fill(0);
        if (!parsed.ok) {
          dispatch({ kind: "violation", connection: event.connection });
          return;
        }
        try {
          dispatch({
            kind: "request",
            connection: event.connection,
            request: parsed.request,
            now: now(),
          });
        } finally {
          // Workers have copied the answer into their frame by now; this is the last copy.
          if (parsed.request.type === "answer") parsed.request.response?.fill(0);
        }
      }
    }
  }

  return {
    get state() {
      return state;
    },
    async start() {
      await new Promise<void>((resolve, reject) => {
        let ready = false;
        front = options.launchFront(
          (event) => {
            if (event.kind === "ready" && !ready) {
              ready = true;
              resolve();
            }
            frontEvent(event);
          },
          () => {
            front = null;
            if (!ready) reject(new Error("moire-dm front exited before listening"));
            // Fail closed: without the front nobody can log in. systemd restarts the broker,
            // and the restarted broker re-attaches to live sessions through logind.
            options.log({ code: "front-exit" });
            finish(1);
          },
        );
      });
      const autologin = options.autologin();
      if (autologin.kind === "enabled") await options.releaseBootDisplay?.();
      dispatch({ kind: "boot", now: now(), autologin, seat: options.observeSeat() });
    },
    shutdown() {
      dispatch({ kind: "shutdown" });
    },
  };
}
