import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  loginId,
  type LoginController,
  type LoginControllerOptions,
  type LoginState,
  type LoginBroker,
  type BrokerReply,
  type GreeterIdentity,
  type UserSessionIdentity,
  type SessionSelection,
  type ReleaseResult,
} from "./types";

type Attempt = {
  id: ReturnType<typeof loginId>;
  generation: number;
  selection: SessionSelection;
  account: string;
  greeter: GreeterIdentity;
  broker: LoginBroker | null;
  canceled: boolean;
  busy: boolean;
  retirement: Promise<ReleaseResult<GreeterIdentity>> | null;
  cleanup: Promise<void> | null;
};
function sameIdentity(
  a: GreeterIdentity | UserSessionIdentity,
  b: GreeterIdentity | UserSessionIdentity,
): boolean {
  return (
    a.qualification === "fixture" &&
    b.qualification === "fixture" &&
    a.id === b.id &&
    a.generation === b.generation
  );
}
function freeze(value: unknown): void {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
}
function released<T>(result: ReleaseResult<T>, expected: T): boolean {
  return result.kind === "released" && isDeepStrictEqual(result.identity, expected);
}
/** Source fixture orchestration. Broker authorization and scheduling never establish running-session proof. */
export function createLoginController(options: LoginControllerOptions): LoginController {
  const timeout = options.timeoutMs ?? 1000;
  if (
    options.qualification !== "fixture" ||
    options.lifecycle.qualification !== "fixture" ||
    !Number.isSafeInteger(timeout) ||
    timeout < 10 ||
    timeout > 30000
  )
    throw new Error("Invalid fixture login authority");
  let state: LoginState = { kind: "inactive" },
    generation = 0,
    disposed = false,
    disposing = false;
  let greeter: GreeterIdentity | null = null,
    active: Attempt | null = null;
  let initializing: Promise<void> | null = null,
    stopping: Promise<void> | null = null,
    disposal: Promise<void> | null = null;
  let beginning = false;
  const listeners = new Set<() => void>();
  function publish(next: LoginState) {
    if (disposed) return;
    state = structuredClone(next);
    freeze(state);
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch {}
    }
  }
  async function bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Fixture login operation timed out")), timeout);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  function current(a: Attempt): boolean {
    return !disposed && !disposing && active === a && generation === a.generation && !a.canceled;
  }
  function graphical() {
    if (options.consoleRequested()) throw new Error("Console intent blocks graphical admission");
  }
  async function admitGreeter(message: string): Promise<void> {
    if (disposing || options.consoleRequested()) {
      publish({ kind: "inactive" });
      return;
    }
    const version = ++generation;
    const creation = options.lifecycle.createGreeter();
    void creation
      .then((identity) => {
        if (disposed || version !== generation)
          void options.lifecycle.retireGreeter(identity).catch(() => {});
      })
      .catch(() => {});
    const identity = await bounded(creation);
    if (disposed || version !== generation) return;
    if (
      identity.qualification !== "fixture" ||
      !Number.isSafeInteger(identity.generation) ||
      identity.generation < 1
    )
      throw new Error("Invalid fixture greeter identity");
    loginId(identity.id);
    if (options.consoleRequested()) {
      const result = await bounded(options.lifecycle.retireGreeter(identity));
      if (!released(result, identity)) throw new Error("Fixture greeter cleanup is unresolved");
      publish({ kind: "inactive" });
      return;
    }
    greeter = identity;
    publish({ kind: "ready", greeter: identity, message });
  }
  async function cleanup(a: Attempt, message: string): Promise<void> {
    if (a.cleanup) return a.cleanup;
    a.canceled = true;
    // Own the cleanup promise before notifying potentially reentrant observers.
    a.cleanup = Promise.resolve().then(async () => {
      publish({
        kind: "authenticating",
        attemptId: a.id,
        selection: a.selection,
        account: a.account,
      });
      let confirmed = true;
      try {
        if (a.broker && (await bounded(a.broker.cancel())).kind !== "success") confirmed = false;
      } catch {
        confirmed = false;
      }
      a.broker?.close();
      try {
        if (!released(await bounded(options.lifecycle.cancelLaunch(a.id)), a.id)) confirmed = false;
      } catch {
        confirmed = false;
      }
      if (a.retirement) {
        try {
          if (!released(await bounded(a.retirement), a.greeter)) confirmed = false;
          else greeter = null;
        } catch {
          confirmed = false;
        }
      }
      if (active !== a) return;
      active = null;
      if (!confirmed) {
        publish({
          kind: "blocked",
          message: "Fixture login cleanup is unresolved; another login is blocked",
        });
        return;
      }
      if (disposing || options.consoleRequested()) {
        if (greeter) {
          const identity = greeter;
          try {
            if (!released(await bounded(options.lifecycle.retireGreeter(identity)), identity))
              throw new Error("Unresolved greeter");
            greeter = null;
          } catch {
            publish({ kind: "blocked", message: "Fixture greeter cleanup is unresolved" });
            return;
          }
        }
        publish({ kind: "inactive" });
        return;
      }
      if (greeter) publish({ kind: "ready", greeter, message });
      else {
        try {
          await admitGreeter(message);
        } catch {
          publish({ kind: "blocked", message: "Fresh fixture greeter admission failed" });
        }
      }
    });
    return a.cleanup;
  }
  async function advance(a: Attempt, reply: BrokerReply): Promise<void> {
    if (!current(a)) return;
    if (reply.kind === "prompt") {
      publish({
        kind: "prompt",
        attemptId: a.id,
        selection: a.selection,
        account: a.account,
        prompt: {
          id: loginId("prompt_" + randomUUID()),
          style: reply.style,
          message:
            reply.style === "secret"
              ? "Enter the requested secret"
              : reply.style === "visible"
                ? "Enter the requested response"
                : "Acknowledge the authentication message",
        },
      });
      return;
    }
    if (reply.kind !== "success") {
      await cleanup(a, "Fixture authentication did not complete");
      return;
    }
    graphical();
    const fresh = await bounded(options.loadSelection());
    if (!current(a)) return;
    if (!isDeepStrictEqual(fresh, a.selection)) throw new Error("Session catalog changed");
    graphical();
    const launch = options.brokerLaunch(fresh);
    if (!a.broker || (await bounded(a.broker.start(launch))).kind !== "success")
      throw new Error("Fixture launch scheduling failed");
    if (!current(a)) return;
    graphical();
    publish({ kind: "retiring-greeter", attemptId: a.id, selection: a.selection });
    a.retirement = options.lifecycle.retireGreeter(a.greeter);
    if (!released(await bounded(a.retirement), a.greeter))
      throw new Error("Fixture greeter cleanup is unresolved");
    if (!current(a)) return;
    greeter = null;
    graphical();
    publish({ kind: "starting-session", attemptId: a.id, selection: a.selection });
    const observation = options.lifecycle.observeStarted({
      attemptId: a.id,
      selection: a.selection,
    });
    void observation
      .then((identity) => {
        if (!current(a)) void options.lifecycle.retireSession(identity).catch(() => {});
      })
      .catch(() => {});
    const session = await bounded(observation);
    if (!current(a)) return;
    if (
      session.qualification !== "fixture" ||
      !Number.isSafeInteger(session.generation) ||
      session.generation < 1
    )
      throw new Error("Invalid fixture session identity");
    loginId(session.id);
    if (options.consoleRequested()) {
      if (!released(await bounded(options.lifecycle.retireSession(session)), session))
        throw new Error("Fixture session cleanup is unresolved");
      await cleanup(a, "Console requested");
      return;
    }
    a.broker.close();
    active = null;
    publish({ kind: "running", session, selection: a.selection });
  }
  async function perform(a: Attempt, operation: () => Promise<BrokerReply>) {
    if (!current(a) || a.busy) throw new Error("Fixture login attempt changed");
    a.busy = true;
    try {
      await advance(a, await bounded(operation()));
    } catch {
      if (active === a && !a.canceled) await cleanup(a, "Fixture login did not complete");
    } finally {
      a.busy = false;
    }
  }
  const controller: LoginController = {
    get state() {
      return state;
    },
    subscribe(listener) {
      if (listeners.size >= 64) throw new Error("Too many login observers");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async initialize() {
      if (disposed || disposing || state.kind === "blocked" || active || stopping)
        throw new Error("Fixture login is unavailable");
      if (initializing) return initializing;
      if (state.kind !== "inactive") return;
      initializing = Promise.resolve()
        .then(() => admitGreeter("Fixture login ready"))
        .catch(() => {
          generation++;
          publish({ kind: "blocked", message: "Fixture greeter admission failed" });
        })
        .finally(() => {
          initializing = null;
        });
      return initializing;
    },
    async beginLogin(request) {
      if (
        disposed ||
        disposing ||
        beginning ||
        active ||
        state.kind !== "ready" ||
        !greeter ||
        !sameIdentity(request.greeter, greeter)
      )
        throw new Error("Fixture greeter identity changed");
      if (
        typeof request.account !== "string" ||
        !request.account ||
        request.account.length > 64 ||
        Array.from(request.account).some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        )
      )
        throw new Error("Invalid fixture account");
      graphical();
      beginning = true;
      try {
        const identity = greeter,
          version = generation;
        const selection = await bounded(options.loadSelection());
        if (
          disposed ||
          generation !== version ||
          greeter !== identity ||
          state.kind !== "ready" ||
          selection.id !== request.sessionId ||
          selection.generation !== request.catalogGeneration
        )
          throw new Error("Session catalog or greeter changed");
        graphical();
        const a: Attempt = {
          id: loginId("attempt_" + randomUUID()),
          generation: version,
          selection,
          account: request.account,
          greeter: identity,
          broker: null,
          canceled: false,
          busy: false,
          retirement: null,
          cleanup: null,
        };
        active = a;
        publish({ kind: "authenticating", attemptId: a.id, selection, account: request.account });
        await perform(a, async () => {
          const creation = options.createBroker();
          void creation
            .then((b) => {
              if (!current(a)) b.close();
            })
            .catch(() => {});
          const broker = await bounded(creation);
          if (!current(a)) {
            broker.close();
            throw new Error("Login attempt retired");
          }
          if (broker.qualification !== "fixture") {
            broker.close();
            throw new Error("Invalid broker qualification");
          }
          a.broker = broker;
          return broker.begin(request.account);
        });
      } finally {
        beginning = false;
      }
    },
    async answerPrompt(request) {
      const a = active;
      if (
        !a ||
        !current(a) ||
        a.busy ||
        state.kind !== "prompt" ||
        request.attemptId !== a.id ||
        request.promptId !== state.prompt.id
      )
        throw new Error("Fixture login prompt changed");
      const style = state.prompt.style;
      if (
        style === "info" || style === "error"
          ? request.response !== null
          : typeof request.response !== "string" ||
            request.response.length > 4096 ||
            request.response.includes("\0")
      )
        throw new Error("Invalid fixture authentication response");
      publish({
        kind: "authenticating",
        attemptId: a.id,
        selection: a.selection,
        account: a.account,
      });
      await perform(a, async () => {
        if (!a.broker) throw new Error("Fixture broker unavailable");
        return a.broker.answer(request.response);
      });
    },
    async cancelLogin(attemptId) {
      const a = active;
      if (!a || a.id !== attemptId) throw new Error("Fixture login attempt changed");
      await cleanup(a, "Fixture login canceled");
    },
    async logout(identity) {
      if (stopping) {
        if (state.kind !== "stopping" || !sameIdentity(state.session, identity))
          throw new Error("Fixture session identity changed");
        return stopping;
      }
      if (disposed || state.kind !== "running" || !sameIdentity(state.session, identity))
        throw new Error("Fixture session identity changed");
      const session = state.session,
        selection = state.selection;
      stopping = Promise.resolve()
        .then(async () => {
          try {
            if (!released(await bounded(options.lifecycle.retireSession(session)), session))
              throw new Error("Unresolved fixture session");
            await admitGreeter("Fixture session ended; fresh authentication required");
          } catch {
            publish({
              kind: "blocked",
              message: "Fixture logout cleanup is unresolved; another login is blocked",
            });
          }
        })
        .finally(() => {
          stopping = null;
        });
      publish({ kind: "stopping", session, selection });
      return stopping;
    },
    async dispose() {
      if (disposal) return disposal;
      disposing = true;
      disposal = Promise.resolve().then(async () => {
        if (initializing) await initializing;
        if (active) await cleanup(active, "Fixture login closed");
        if (state.kind === "running") await controller.logout(state.session);
        if (stopping) await stopping;
        generation++;
        if (greeter) {
          const identity = greeter;
          const result = await bounded(options.lifecycle.retireGreeter(identity));
          if (!released(result, identity)) {
            publish({ kind: "blocked", message: "Fixture greeter disposal is unresolved" });
            throw new Error("Fixture disposal is unresolved");
          }
          greeter = null;
        }
        if (state.kind === "blocked") throw new Error("Fixture disposal is unresolved");
        disposed = true;
        listeners.clear();
      });
      return disposal;
    },
  };
  return controller;
}
