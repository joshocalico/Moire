/**
 * Daemon side of a worker process: spawn, write the job, relay events, stop with escalation.
 * A worker that sends anything malformed is killed; the state machine then sees it exit.
 */
import { spawn } from "node:child_process";
import type { Socket } from "node:net";
import type { FrontLauncher, WorkerLauncher } from "./daemon";
import { ChannelReader, decodeFrontEvent, encodeBrokerCommand } from "./front-channel";
import { FrameAssembler, decodeEvent, encodeCommand } from "./worker-channel";

/** Between a cancel and SIGTERM: time for PAM to unwind through pam_end. */
const CANCEL_GRACE_MS = 1_000;
/** Between SIGTERM and SIGKILL: time for a worker to end its session and close PAM. */
const TERMINATE_GRACE_MS = 10_000;

export type ProcessLauncherOptions = Readonly<{
  /** Node arguments for the worker entry, e.g. ["/…/worker.mjs"]. */
  entry: readonly string[];
  /** The worker's whole environment; moire-dm's own is not inherited. */
  env: Readonly<Record<string, string>>;
}>;

export function processWorkerLauncher(options: ProcessLauncherOptions): WorkerLauncher {
  return (job, onEvent, onExit) => {
    const child = spawn(process.execPath, [...options.entry], {
      stdio: ["ignore", "inherit", "inherit", "pipe"],
      env: { ...options.env },
    });
    const channel = child.stdio[3] as Socket;
    const assembler = new FrameAssembler();
    let exited = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const kill = (signal: NodeJS.Signals) => {
      if (!exited) child.kill(signal);
    };
    channel.on("error", () => kill("SIGKILL"));
    channel.on("data", (chunk: Buffer) => {
      const frames = assembler.push(chunk);
      if (!frames) return kill("SIGKILL");
      for (const frame of frames) {
        const event = decodeEvent(frame.type, frame.payload);
        if (!event) return kill("SIGKILL");
        onEvent(event);
      }
    });
    child.once("exit", () => {
      exited = true;
      for (const timer of timers) clearTimeout(timer);
      channel.destroy();
      onExit();
    });
    // spawn failures surface as "error" then "exit"; ENOENT alone has no exit, so report it.
    child.once("error", () => {
      if (child.pid === undefined && !exited) {
        exited = true;
        onExit();
      }
    });
    channel.write(encodeCommand(job));
    return {
      send(command) {
        if (exited) {
          if (command.kind === "answer") command.response?.fill(0);
          return;
        }
        const frame = encodeCommand(command);
        channel.write(frame, () => frame.fill(0));
      },
      stop() {
        if (exited || timers.length) return;
        if (!channel.destroyed) channel.write(encodeCommand({ kind: "cancel" }));
        timers.push(setTimeout(() => kill("SIGTERM"), CANCEL_GRACE_MS));
        timers.push(setTimeout(() => kill("SIGKILL"), CANCEL_GRACE_MS + TERMINATE_GRACE_MS));
      },
    };
  };
}

export type FrontLauncherOptions = Readonly<{
  entry: readonly string[];
  env: Readonly<Record<string, string>>;
  /** The front's account. spawn() sets gid then uid and clears supplementary groups. */
  uid?: number;
  gid?: number;
}>;

/** Broker side of the front: spawn it unprivileged, relay its events, kill it if it misbehaves. */
export function processFrontLauncher(options: FrontLauncherOptions): FrontLauncher {
  return (onEvent, onExit) => {
    const child = spawn(process.execPath, [...options.entry], {
      stdio: ["ignore", "inherit", "inherit", "pipe"],
      env: { ...options.env },
      ...(options.uid === undefined ? {} : { uid: options.uid, gid: options.gid }),
    });
    const channel = child.stdio[3] as Socket;
    const reader = new ChannelReader();
    let exited = false;
    const kill = () => {
      if (!exited) child.kill("SIGKILL");
    };
    channel.on("error", kill);
    channel.on("data", (chunk: Buffer) => {
      const frames = reader.push(chunk);
      if (!frames) return kill();
      for (const raw of frames) {
        const event = decodeFrontEvent(raw);
        if (!event) return kill();
        onEvent(event);
      }
    });
    const finished = () => {
      if (exited) return;
      exited = true;
      reader.wipe();
      channel.destroy();
      onExit();
    };
    child.once("exit", finished);
    child.once("error", () => {
      if (child.pid === undefined) finished();
    });
    return {
      send(command) {
        if (!exited && !channel.destroyed) channel.write(encodeBrokerCommand(command));
      },
      stop() {
        if (!exited) child.kill("SIGTERM");
      },
    };
  };
}
