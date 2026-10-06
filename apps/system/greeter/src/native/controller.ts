import type {
  AuthReply,
  // oxlint-disable-next-line import/no-relative-parent-imports -- Native source adapter has no package export.
} from "../../../display-manager/src/native-greetd-client";
import {
  newAttemptId,
  newPromptId,
  type AttemptId,
  type NativeGreeterController,
  type NativeGreeterControllerOptions,
  type NativeGreeterOutcome,
  type NativeGreeterState,
} from "./types";

type AuthResult = AuthReply | Readonly<{ kind: "unavailable" }>;
type Attempt = {
  id: AttemptId;
  phase: "auth" | "cancelling" | "launching";
  pendingAuth: Promise<AuthResult> | null;
  cancellation: Promise<void> | null;
  launch: Promise<void> | null;
};
const unavailableMessage = "The login service is unavailable. The greeter will close.";

/** Owns frontend actions only. A start acknowledgement is not running-session proof. */
export function createNativeGreeterController(
  options: NativeGreeterControllerOptions,
): NativeGreeterController {
  let revision = 0;
  let state: NativeGreeterState = Object.freeze({
    kind: "ready",
    revision,
    message: "Sign in",
  });
  let active: Attempt | null = null;
  let disposing = false;
  let closed = false;
  let disposal: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  let finish: (outcome: NativeGreeterOutcome) => void = () => {};
  const finished = new Promise<NativeGreeterOutcome>((resolve) => {
    finish = resolve;
  });

  function publish(next: NativeGreeterState): void {
    state = Object.freeze(next);
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch {
        // Presentation observers cannot alter operation ownership.
      }
    }
  }
  function close(): void {
    if (closed) return;
    closed = true;
    try {
      options.client.close();
    } catch {
      // Transport shutdown must not leak broker error text.
    }
  }
  function terminal(kind: NativeGreeterOutcome["kind"]): void {
    active = null;
    finish(Object.freeze({ kind }));
    publish(kind === "launch-committed" ? { kind } : { kind, message: unavailableMessage });
    close();
  }
  function current(a: Attempt): boolean {
    return !disposing && active === a;
  }

  function cancelAttempt(a: Attempt, message: string): Promise<void> {
    if (a.cancellation) return a.cancellation;
    a.phase = "cancelling";
    const pending = a.pendingAuth;
    // Reserve the cancellation before notifying reentrant observers.
    a.cancellation = Promise.resolve().then(async () => {
      if (pending) {
        const reply = await pending;
        if (!current(a)) return;
        if (reply.kind === "unavailable") {
          terminal("unavailable");
          return;
        }
      }
      if (!current(a)) return;
      try {
        const reply = await options.client.cancel();
        if (!current(a)) return;
        if (reply.kind !== "cancelled") {
          terminal("unavailable");
          return;
        }
        active = null;
        publish({ kind: "ready", revision: ++revision, message });
      } catch {
        if (current(a)) terminal("unavailable");
      }
    });
    publish({ kind: "cancelling", attemptId: a.id });
    return a.cancellation;
  }

  function launch(a: Attempt): Promise<void> {
    a.phase = "launching";
    // All launch actions are forbidden from this point until the start reply is known.
    a.launch = Promise.resolve().then(async () => {
      try {
        const reply = await options.client.start();
        if (reply.kind === "committed") {
          terminal("launch-committed");
        } else {
          // The fixed launch command cannot be repaired by replaying credentials.
          terminal("unavailable");
        }
      } catch {
        terminal("unavailable");
      }
    });
    publish({ kind: "launching", attemptId: a.id });
    return a.launch;
  }

  async function authenticate(a: Attempt, operation: () => Promise<AuthReply>): Promise<void> {
    const pending = Promise.resolve()
      .then<AuthResult>(() => {
        if (disposing) return { kind: "unavailable" } satisfies AuthResult;
        return operation();
      })
      .catch(() => ({ kind: "unavailable" }) satisfies AuthResult);
    a.pendingAuth = pending;
    publish({ kind: "authenticating", attemptId: a.id });
    const reply = await pending;
    if (a.pendingAuth === pending) a.pendingAuth = null;
    if (!current(a) || a.phase !== "auth") return;
    switch (reply.kind) {
      case "prompt":
        publish({
          kind: "prompt",
          attemptId: a.id,
          promptId: newPromptId(),
          style: reply.style,
          message:
            reply.style === "secret"
              ? "Enter the requested secret"
              : reply.style === "visible"
                ? "Enter the requested response"
                : "Acknowledge the authentication message",
        });
        return;
      case "authorized":
        await launch(a);
        return;
      case "denied":
        await cancelAttempt(a, "Authentication did not complete. Try again.");
        return;
      case "unavailable":
        terminal("unavailable");
        return;
      default: {
        const exhaustive: never = reply;
        return exhaustive;
      }
    }
  }

  const controller: NativeGreeterController = {
    snapshot: () => state,
    subscribe(listener) {
      if (disposing || closed) throw new Error("The greeter is unavailable");
      if (listeners.size >= 64) throw new Error("Too many greeter observers");
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async begin(username, expectedRevision) {
      if (disposing || active || state.kind !== "ready" || state.revision !== expectedRevision)
        throw new Error("The sign-in form changed");
      if (
        typeof username !== "string" ||
        username.length === 0 ||
        username.length > 64 ||
        Array.from(username).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      )
        throw new Error("Invalid account name");
      const a: Attempt = {
        id: newAttemptId(),
        phase: "auth",
        pendingAuth: null,
        cancellation: null,
        launch: null,
      };
      active = a;
      await authenticate(a, () => options.client.authenticate(username));
    },
    async answer(attemptId, promptId, response) {
      const a = active;
      if (
        !a ||
        !current(a) ||
        a.phase !== "auth" ||
        a.pendingAuth ||
        state.kind !== "prompt" ||
        attemptId !== a.id ||
        attemptId !== state.attemptId ||
        promptId !== state.promptId
      )
        throw new Error("The authentication prompt changed");
      if (
        state.style === "info" || state.style === "error"
          ? response !== null
          : typeof response !== "string" || response.length > 4096 || response.includes("\0")
      )
        throw new Error("Invalid authentication response");
      await authenticate(a, () => options.client.respond(response));
    },
    async cancel(attemptId) {
      const a = active;
      if (!a || !current(a) || attemptId !== a.id) throw new Error("The sign-in attempt changed");
      if (a.phase === "launching") throw new Error("Session launch is already pending");
      await cancelAttempt(a, "Sign-in cancelled");
    },
    dispose() {
      if (disposal) return disposal;
      disposing = true;
      listeners.clear();
      const pendingLaunch = active?.phase === "launching" ? active.launch : null;
      disposal = Promise.resolve().then(async () => {
        if (pendingLaunch) await pendingLaunch;
        if (state.kind !== "launch-committed" && state.kind !== "unavailable")
          terminal("unavailable");
        close();
      });
      return disposal;
    },
    finished,
  };
  return controller;
}
