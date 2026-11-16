/**
 * Shared plumbing for the Settings-facing session interfaces (time, accounts): a JSON status with
 * a revision, a `Changed` signal, and methods whose failures come back as values.
 */
import { DbusRemoteError, type SessionBus } from "@moire/dbus";

export const SETTINGS_SERVICE_BUS = "org.moire.SystemManagement1";

/** Failure codes shared by the settings interfaces. Wire names are `<interface>.Error.<code>`. */
export type SettingsErrorCode =
  | "permission"
  /** The user dismissed the system's password prompt. Not a failure to show: say nothing. */
  | "cancelled"
  /**
   * The system's password prompt turned the request away without showing itself: a cool-down
   * after cancels, or too many requests waiting. Said calmly, near the control.
   */
  | "refused"
  | "wrong_password"
  | "rate_limited"
  | "invalid"
  | "unavailable"
  | "busy"
  | "failed"
  | "unknown";

const CODES: readonly SettingsErrorCode[] = [
  "permission",
  "cancelled",
  "refused",
  "wrong_password",
  "rate_limited",
  "invalid",
  "unavailable",
  "busy",
  "failed",
  "unknown",
];

/** The fixed sentences for a password prompt that ended without authorizing. */
export const PROMPT_CANCELLED = "The password request was cancelled.";
export const PROMPT_REFUSED = "Password requests are paused. Try again in a little while.";

export type SettingsFailure = { ok: false; code: SettingsErrorCode; message: string };
/** Every setter resolves to this; it never rejects. `value` is `undefined` for plain setters. */
export type SettingsResult<T = undefined> = { ok: true; value: T } | SettingsFailure;

export function settingsFailure(code: SettingsErrorCode, message: string): SettingsFailure {
  return { ok: false, code, message };
}

/** Thrown by service adapters; the session interface turns it into a typed D-Bus error. */
export class SettingsServiceError extends Error {
  constructor(
    readonly code: SettingsErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SettingsServiceError";
  }
  remote(iface: string): DbusRemoteError {
    return new DbusRemoteError(`${iface}.Error.${this.code}`, this.message);
  }
}

/** Map a reply error to a code. Only our own error names carry their (fixed) message through. */
export function remoteSettingsFailure(
  iface: string,
  error: unknown,
  fallback: string,
): SettingsFailure {
  if (error instanceof SettingsServiceError) return settingsFailure(error.code, error.message);
  if (error instanceof DbusRemoteError) {
    const prefix = `${iface}.Error.`;
    if (error.errorName.startsWith(prefix)) {
      const code = error.errorName.slice(prefix.length) as SettingsErrorCode;
      if (CODES.includes(code)) {
        // A service that throws a DbusRemoteError sends its message, which already begins
        // with the error name; the reply's error adds the name again. Show only the sentence.
        const lead = `${error.errorName}: `;
        let detail = error.message;
        while (detail.startsWith(lead)) detail = detail.slice(lead.length);
        return settingsFailure(code, detail.slice(0, 512) || fallback);
      }
    }
    if (
      error.errorName === "org.freedesktop.DBus.Error.ServiceUnknown" ||
      error.errorName === "org.freedesktop.DBus.Error.NameHasNoOwner"
    )
      return settingsFailure("unavailable", "The system settings service is not running.");
  }
  if (error instanceof Error && /timed out/i.test(error.message))
    return settingsFailure("unknown", "The request timed out; check the current state.");
  return settingsFailure("unknown", fallback);
}

export type ServiceClientState<S> =
  | { kind: "loading" | "unavailable" | "error"; message: string }
  | { kind: "ready"; owner: string; revision: number; status: S };

export type ServiceObserver<S> = {
  readonly state: ServiceClientState<S>;
  subscribe(listener: (state: ServiceClientState<S>) => void): () => void;
  /** Call a method on the current owner; re-reads the status afterwards. */
  call(member: string, signature: string, body: unknown[], timeoutMs?: number): Promise<unknown[]>;
  reload(): Promise<void>;
  dispose(): Promise<void>;
};

/**
 * Follow one JSON-status interface on the session service. Each owner change starts a new
 * generation so late replies from a previous owner never overwrite newer state.
 */
export async function observeSettingsService<S>(
  bus: SessionBus,
  options: {
    path: string;
    iface: string;
    parse: (status: unknown) => S;
    label: string;
    readTimeoutMs?: number;
    /** The owning bus name; the management service unless given (the compositor is `org.moire.Display1`). */
    name?: string;
  },
): Promise<ServiceObserver<S>> {
  const readTimeoutMs = options.readTimeoutMs ?? 3000;
  let state: ServiceClientState<S> = { kind: "loading", message: `Connecting to ${options.label}` };
  let generation = 0;
  let disposed = false;
  let owner: string | null = null;
  let removeSignal: (() => Promise<void>) | null = null;
  const listeners = new Set<(state: ServiceClientState<S>) => void>();
  const pending = new Set<Promise<void>>();
  const publish = (next: ServiceClientState<S>) => {
    if (disposed) return;
    state = next;
    for (const listener of [...listeners]) listener(next);
  };
  const accept = (from: string, raw: unknown) => {
    if (typeof raw !== "string" || raw.length > 8 * 1024 * 1024)
      throw new Error("Invalid settings status");
    const parsed = JSON.parse(raw) as { revision?: unknown; status?: unknown };
    const revision = parsed.revision;
    if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 0)
      throw new Error("Invalid settings revision");
    const status = options.parse(parsed.status);
    if (state.kind === "ready" && state.owner === from && revision < state.revision) return;
    publish({ kind: "ready", owner: from, revision, status });
  };
  const load = async (from: string, ticket: number) => {
    const reply = await bus.call(
      { destination: from, path: options.path, interface: options.iface, member: "GetStatus" },
      { timeoutMs: readTimeoutMs },
    );
    if (ticket !== generation || disposed) return;
    if (reply.signature !== "s" || reply.body?.length !== 1)
      throw new Error("Invalid settings reply");
    accept(from, reply.body[0]);
  };
  const track = (work: Promise<void>) => {
    pending.add(work);
    void work.finally(() => pending.delete(work));
  };
  const removeDisconnect = bus.onDisconnect(() => {
    generation++;
    owner = null;
    publish({ kind: "unavailable", message: `${options.label} disconnected` });
  });
  let removeOwner: () => Promise<void>;
  try {
    removeOwner = await bus.watchName(
      options.name ?? SETTINGS_SERVICE_BUS,
      (next) => {
        const ticket = ++generation;
        owner = next;
        const previous = removeSignal;
        removeSignal = null;
        publish(
          next
            ? { kind: "loading", message: `Reading ${options.label}` }
            : { kind: "unavailable", message: `${options.label} is not running` },
        );
        track(
          (async () => {
            await previous?.().catch(() => {});
            if (!next || ticket !== generation || disposed) return;
            const remove = await bus.subscribeSignal(
              { sender: next, path: options.path, interface: options.iface, member: "Changed" },
              (message) => {
                if (ticket !== generation || disposed) return;
                try {
                  if (message.signature !== "s" || message.body?.length !== 1)
                    throw new Error("Invalid settings signal");
                  accept(next, message.body[0]);
                } catch {
                  publish({ kind: "error", message: `Invalid ${options.label} status` });
                }
              },
              { timeoutMs: readTimeoutMs },
            );
            if (ticket !== generation || disposed) {
              await remove();
              return;
            }
            removeSignal = remove;
            await load(next, ticket);
          })().catch(() => {
            if (ticket === generation)
              publish({ kind: "error", message: `Unable to read ${options.label}` });
          }),
        );
      },
      { timeoutMs: readTimeoutMs },
    );
  } catch (error) {
    removeDisconnect();
    throw error;
  }
  let disposal: Promise<void> | null = null;
  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    async call(member, signature, body, timeoutMs = 30000) {
      if (disposed || !owner)
        throw new SettingsServiceError("unavailable", `${options.label} is not running.`);
      const from = owner,
        ticket = generation;
      try {
        const reply = await bus.call(
          {
            destination: from,
            path: options.path,
            interface: options.iface,
            member,
            signature,
            body,
          },
          { timeoutMs },
        );
        return reply.body ?? [];
      } finally {
        if (ticket === generation && !disposed) await load(from, ticket).catch(() => {});
      }
    },
    async reload() {
      if (owner && !disposed) await load(owner, generation);
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      generation++;
      listeners.clear();
      removeDisconnect();
      const remove = removeSignal;
      removeSignal = null;
      disposal = Promise.allSettled([removeOwner(), remove?.(), ...pending]).then(() => {});
      return disposal;
    },
  };
}

/** A bounded, NUL-free string from the wire. */
export function bounded(value: unknown, max: number, what: string): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error(`Invalid ${what}`);
  return value;
}
