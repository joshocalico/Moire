/**
 * The session worker's PAM sequence, independent of how messages and PAM are provided.
 *
 * Order follows Linux-PAM's application guide and greetd:
 *   pam_start → PAM_TTY + XDG_* environment → pam_authenticate (unless trusted)
 *   → pam_acct_mgmt (→ pam_chauthtok on an expired password) → [daemon says start]
 *   → pam_setcred(ESTABLISH) → pam_open_session → pam_getenvlist
 * and on the way out pam_close_session → pam_setcred(DELETE) → pam_end.
 *
 * Every refusal from PAM after start (unknown user included) is reported as "denied", so the
 * greeter can't tell an unknown account from a wrong password.
 */
import {
  PAM_ABORT,
  PAM_CHANGE_EXPIRED_AUTHTOK,
  PAM_DELETE_CRED,
  PAM_DISALLOW_NULL_AUTHTOK,
  PAM_ESTABLISH_CRED,
  PAM_NEW_AUTHTOK_REQD,
  PAM_SILENT,
  PAM_SUCCESS,
  type Pam,
  type PamHandle,
  type PamPrompt,
} from "@moire/sys/pam";
import type { SessionSpec, WorkerCommand, WorkerEvent, WorkerJob } from "./worker-channel";

/** The worker's view of the daemon: blocking receive (null on EOF), fire-and-forget send. */
export type WorkerIo = {
  receive(): WorkerCommand | null;
  send(event: WorkerEvent): void;
};

export type OpenSession = Readonly<{
  user: string;
  session: SessionSpec;
  /** pam_getenvlist(): XDG_RUNTIME_DIR, XDG_SESSION_ID and whatever pam_env adds. */
  pamEnvironment: readonly string[];
  /** Close the PAM session: close_session → setcred(DELETE) → end. Idempotent. */
  close(): void;
}>;

export type ConversationResult =
  | Readonly<{ kind: "open"; session: OpenSession }>
  | Readonly<{ kind: "finished" }>;

const SEAT = "seat0";

function finish(io: WorkerIo, handle: PamHandle, status: number, event: WorkerEvent) {
  handle.end(status);
  io.send(event);
  return { kind: "finished" } as const;
}

/**
 * Drive PAM for one job. Blocks in `io.receive()` while PAM waits on the greeter. Never throws
 * for PAM refusals; those are events. `confdir` is null outside tests.
 */
export function runConversation(
  pam: Pam,
  job: WorkerJob,
  io: WorkerIo,
  confdir: string | null = null,
): ConversationResult {
  // Set when the daemon cancels (or disappears) mid-conversation; PAM then sees PAM_CONV_ERR.
  let aborted = false;
  const conversation = (prompts: readonly PamPrompt[]): (Uint8Array | null)[] | null => {
    const answers: (Uint8Array | null)[] = [];
    for (const prompt of prompts) {
      const question = prompt.style === "secret" || prompt.style === "visible";
      if (job.mode === "trusted") {
        // Nobody to ask: messages are dropped, questions fail closed.
        if (question) return abandon(answers);
        answers.push(null);
        continue;
      }
      io.send({ kind: "prompt", style: prompt.style, text: prompt.text });
      const command = io.receive();
      if (!command || command.kind !== "answer") {
        aborted = true;
        return abandon(answers);
      }
      if (question !== (command.response !== null)) {
        command.response?.fill(0);
        aborted = true;
        return abandon(answers);
      }
      answers.push(command.response);
    }
    return answers;
  };

  const started = pam.start(job.service, job.user, conversation, confdir);
  if (!started.ok) {
    io.send({ kind: "failed", reason: "pam-start" });
    return { kind: "finished" };
  }
  const handle = started.handle;
  const environment = [
    `XDG_SEAT=${SEAT}`,
    `XDG_VTNR=${job.vt}`,
    `XDG_SESSION_CLASS=${job.sessionClass}`,
  ];
  if (handle.setTty(`tty${job.vt}`) !== PAM_SUCCESS)
    return finish(io, handle, PAM_ABORT, { kind: "failed", reason: "pam-start" });
  for (const entry of environment)
    if (handle.putEnv(entry) !== PAM_SUCCESS)
      return finish(io, handle, PAM_ABORT, { kind: "failed", reason: "pam-start" });

  if (job.mode === "authenticate") {
    const status = handle.authenticate(PAM_DISALLOW_NULL_AUTHTOK);
    if (aborted) return finish(io, handle, PAM_ABORT, { kind: "cancelled" });
    if (status !== PAM_SUCCESS) return finish(io, handle, status, { kind: "denied" });
  }
  let account = handle.accountManagement(PAM_DISALLOW_NULL_AUTHTOK);
  if (account === PAM_NEW_AUTHTOK_REQD && job.mode === "authenticate") {
    // An expired password is changed here, through the same conversation, before any session.
    account = handle.changeAuthToken(PAM_CHANGE_EXPIRED_AUTHTOK);
    if (aborted) return finish(io, handle, PAM_ABORT, { kind: "cancelled" });
  }
  if (account !== PAM_SUCCESS)
    return finish(
      io,
      handle,
      account,
      job.mode === "authenticate" ? { kind: "denied" } : { kind: "failed", reason: "account" },
    );
  const user = handle.user() ?? job.user;

  let session = job.session;
  if (job.mode === "authenticate") {
    io.send({ kind: "authorized", user });
    const command = io.receive();
    if (!command || command.kind !== "start") {
      if (command?.kind === "answer") command.response?.fill(0);
      return finish(io, handle, PAM_ABORT, { kind: "cancelled" });
    }
    session = command.session;
  }
  if (!session) return finish(io, handle, PAM_ABORT, { kind: "failed", reason: "protocol" });
  for (const entry of ["XDG_SESSION_TYPE=wayland", `XDG_SESSION_DESKTOP=${session.desktop}`])
    if (handle.putEnv(entry) !== PAM_SUCCESS)
      return finish(io, handle, PAM_ABORT, { kind: "failed", reason: "session" });

  const credentials = handle.setCredentials(PAM_ESTABLISH_CRED);
  if (credentials !== PAM_SUCCESS)
    return finish(io, handle, credentials, { kind: "failed", reason: "credentials" });
  const opened = handle.openSession(0);
  if (opened !== PAM_SUCCESS) {
    handle.setCredentials(PAM_DELETE_CRED | PAM_SILENT);
    return finish(io, handle, opened, { kind: "failed", reason: "session" });
  }
  let closed = false;
  return {
    kind: "open",
    session: {
      user,
      session,
      pamEnvironment: handle.environment() ?? [],
      close() {
        if (closed) return;
        closed = true;
        const status = handle.closeSession(PAM_SILENT);
        handle.setCredentials(PAM_DELETE_CRED | PAM_SILENT);
        handle.end(status);
      },
    },
  };
}

/** Wipe answers gathered so far in a multi-prompt round that is being abandoned. */
function abandon(answers: (Uint8Array | null)[]): null {
  for (const answer of answers) answer?.fill(0);
  return null;
}
