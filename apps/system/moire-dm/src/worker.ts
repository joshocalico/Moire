/**
 * One session worker (root, one per login attempt, greeter or automatic login).
 *
 * The daemon spawns it with the channel on fd 3. It reads its job, runs the PAM sequence
 * synchronously (blocking on fd 3 inside the conversation), and if a session opens, starts it
 * through the exec helper and stays as its parent until it ends, then closes the PAM session.
 * pam_systemd moves this process into the user's session scope at pam_open_session, so it and
 * the session live and die with the session, not with moire-dm.service.
 */
import { spawn } from "node:child_process";
import type { Pam } from "@moire/sys/pam";
import { MIN_USER_UID } from "./config";
import { runConversation, type WorkerIo } from "./conversation";
import { sessionEnvironment, type EnvironmentAccount } from "./session-env";
import {
  decodeCommand,
  decodeJob,
  encodeEvent,
  readFrameSync,
  writeFrameSync,
  type WorkerEvent,
} from "./worker-channel";

/** How long a session gets after SIGTERM before its process group is killed. */
const SESSION_STOP_GRACE_MS = 5_000;

export type SessionAccount = EnvironmentAccount & Readonly<{ gid: number }>;

/** What the exec helper receives on its fd 3; no secrets, ever. */
export type ExecPlan = Readonly<{
  account: SessionAccount;
  argv: readonly [string, ...string[]];
  env: readonly string[];
  tty: string;
}>;

export type LaunchedSession = Readonly<{
  pid: number;
  exited: Promise<number | null>;
  terminate(): void;
}>;

export type WorkerDeps = Readonly<{
  pam: Pam;
  fd: number;
  confdir: string | null;
  path: string;
  lookupAccount: (name: string) => SessionAccount | null;
  launchSession: (plan: ExecPlan) => LaunchedSession | null;
}>;

function channel(fd: number): WorkerIo {
  return {
    receive() {
      const frame = readFrameSync(fd);
      if (!frame) return null;
      const command = decodeCommand(frame.type, frame.payload);
      // A non-answer frame's payload is no longer needed; an answer's payload *is* the answer.
      if (!command || command.kind !== "answer") frame.payload.fill(0);
      return command;
    },
    send(event: WorkerEvent) {
      writeFrameSync(fd, encodeEvent(event));
    },
  };
}

function accountAllowed(
  account: SessionAccount,
  sessionClass: "user" | "greeter",
  expected: string,
): boolean {
  if (account.uid === 0 || account.gid === 0) return false;
  return sessionClass === "greeter" ? account.name === expected : account.uid >= MIN_USER_UID;
}

/** Returns the process exit status. Never throws for PAM or account refusals. */
export async function runWorker(deps: WorkerDeps): Promise<number> {
  const io = channel(deps.fd);
  const first = readFrameSync(deps.fd);
  const job = first ? decodeJob(first.type, first.payload) : null;
  if (!job) {
    io.send({ kind: "failed", reason: "protocol" });
    return 1;
  }
  const result = runConversation(deps.pam, job, io, deps.confdir);
  if (result.kind === "finished") return 0;
  const open = result.session;
  const account = deps.lookupAccount(open.user);
  if (!account || !accountAllowed(account, job.sessionClass, job.user)) {
    open.close();
    io.send({ kind: "failed", reason: "account" });
    return 1;
  }
  const env = sessionEnvironment({
    account,
    session: open.session,
    sessionClass: job.sessionClass,
    vt: job.vt,
    path: deps.path,
    pamEnvironment: open.pamEnvironment,
    greeterSocket: job.greeterSocket,
  });
  const launched = deps.launchSession({
    account,
    argv: open.session.argv,
    env,
    tty: `/dev/tty${job.vt}`,
  });
  if (!launched) {
    open.close();
    io.send({ kind: "failed", reason: "launch" });
    return 1;
  }
  io.send({ kind: "started", pid: launched.pid });
  // Logout from the daemon side (shutdown) arrives as SIGTERM; end the session, then PAM.
  const terminate = () => launched.terminate();
  process.on("SIGTERM", terminate);
  const status = await launched.exited;
  process.removeListener("SIGTERM", terminate);
  open.close();
  io.send({ kind: "ended", status });
  return 0;
}

/**
 * Production session start: a fresh Node process (still root) runs exec-entry.ts, which drops
 * privileges and execve()s the session. Node can't fork() safely, and spawn's own uid/gid
 * options would strip supplementary groups.
 */
export function execHelperLauncher(execEntry: readonly string[]) {
  return (plan: ExecPlan): LaunchedSession | null => {
    const child = spawn(process.execPath, [...execEntry], {
      stdio: ["ignore", "inherit", "inherit", "pipe"],
      env: {},
    });
    if (child.pid === undefined) return null;
    const pid = child.pid;
    const pipe = child.stdio[3] as NodeJS.WritableStream;
    pipe.end(JSON.stringify(plan));
    const exited = new Promise<number | null>((resolve) =>
      child.once("exit", (code, signal) => resolve(signal ? null : code)),
    );
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    void exited.then(() => {
      if (killTimer) clearTimeout(killTimer);
    });
    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        // The helper called setsid(), so the session is its own process group.
        process.kill(-pid, signal);
      } catch {
        child.kill(signal);
      }
    };
    return {
      pid,
      exited,
      terminate() {
        signalGroup("SIGTERM");
        killTimer ??= setTimeout(() => signalGroup("SIGKILL"), SESSION_STOP_GRACE_MS);
      },
    };
  };
}
