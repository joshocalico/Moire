/**
 * Automatic login: Settings calls moire-dm-settings (`org.moire.LoginManager1` on the system
 * bus) itself, as it calls moire-accounts (docs/polkit-agent.md, "One prompt per change";
 * docs/moire-dm.md, "Automatic login").
 *
 * - **The caller is polkit's subject.** moire-dm-settings checks `org.moire.dm.set-autologin`
 *   for the calling connection, so the prompt names the app that asked (Settings), from the
 *   kernel's pid for this connection. One check, one prompt, per change.
 * - **Own account only:** moire-dm-settings takes the account from this connection's
 *   credentials; no method names one. Off turns it off for everyone.
 * - **A dismissed prompt** is `cancelled` from moire-dm-settings. The compositor keeps the reason
 *   for this process, and `TakeDismissal` is asked from this process's session-bus connection:
 *   `refused` (turned away unseen) is said calmly; everything else is `cancelled`, said as nothing.
 * - **Without moire-dm-settings** (a greetd image) the status says `available: false` and
 *   Settings shows no switch.
 * - Only fixed sentences reach Settings, never the daemon's own text.
 */
import os from "node:os";
import { ALLOW_INTERACTIVE_AUTHORIZATION, DbusRemoteError, SessionBus } from "@moire/dbus";
import { PROMPT_TIMEOUT_MS, fakePromptFailure, type FakePrompt } from "./accounts-settings";
import { SYSTEM_BUS_ADDRESS } from "./account-admin";
import type { PromptDismissalLookup } from "./prompt-outcome";
import {
  PROMPT_CANCELLED,
  PROMPT_REFUSED,
  settingsFailure,
  type ServiceClientState,
  type SettingsErrorCode,
  type SettingsFailure,
  type SettingsResult,
} from "./settings-service";

export const LOGIN_MANAGER_BUS = "org.moire.LoginManager1";
export const LOGIN_MANAGER_PATH = "/org/moire/LoginManager1";
export const LOGIN_MANAGER_INTERFACE = "org.moire.LoginManager1";
/** What moire-dm-settings asks polkit about, with this process as the subject. */
export const SET_AUTOLOGIN_ACTION = "org.moire.dm.set-autologin";

export type LoginStatus =
  | { kind: "unavailable" | "error"; message: string }
  | {
      kind: "ready";
      /** The login daemon supports it (moire-dm); false under greetd. */
      available: boolean;
      /** Automatic login is on for the session user. */
      enabled: boolean;
      /** Whose account automatic login is on for, or null when it is off. */
      user: string | null;
    };

const ACCOUNT = /^[a-z_][a-z0-9_-]{0,30}\$?$/;

/** moire-dm-settings' GetStatus JSON, as seen by `username`. Throws on anything odd. */
export function parseLoginManagerStatus(raw: unknown, username: string): LoginStatus {
  if (typeof raw !== "string" || raw.length > 4096) throw new Error("Invalid login status");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const user = parsed?.user;
  if (
    parsed?.version !== 1 ||
    typeof parsed.enabled !== "boolean" ||
    (user !== null && (typeof user !== "string" || !ACCOUNT.test(user))) ||
    parsed.enabled !== (user !== null)
  )
    throw new Error("Invalid login status");
  return {
    kind: "ready",
    available: true,
    enabled: user === username,
    user: user as string | null,
  };
}

export type LoginSettingsState = ServiceClientState<LoginStatus>;

export type LoginSettingsClient = {
  readonly state: LoginSettingsState;
  subscribe(listener: (state: LoginSettingsState) => void): () => void;
  refresh(): Promise<SettingsResult>;
  /**
   * Turn automatic login on for yourself, or off. Raises the password prompt for an
   * administrator; `cancelled` if it is dismissed, `refused` if the prompt turned it away
   * unseen, `permission` if policy refuses.
   */
  setAutologin(enabled: boolean): Promise<SettingsResult>;
  dispose(): Promise<void>;
};

const UNAVAILABLE = "Automatic login isn't available on this computer.";

function managerFailure(error: unknown): SettingsFailure {
  const name = error instanceof DbusRemoteError ? error.errorName : "";
  switch (name) {
    case `${LOGIN_MANAGER_INTERFACE}.Error.permission`:
    case "org.freedesktop.DBus.Error.AccessDenied":
      return settingsFailure(
        "permission",
        "System policy does not allow changing automatic login.",
      );
    case `${LOGIN_MANAGER_INTERFACE}.Error.cancelled`:
      return settingsFailure("cancelled", PROMPT_CANCELLED);
    case `${LOGIN_MANAGER_INTERFACE}.Error.busy`:
      return settingsFailure("busy", "Another change is running. Try again.");
    case `${LOGIN_MANAGER_INTERFACE}.Error.invalid`:
      return settingsFailure("invalid", "Invalid arguments.");
    case "org.freedesktop.DBus.Error.ServiceUnknown":
    case "org.freedesktop.DBus.Error.NameHasNoOwner":
      return settingsFailure("unavailable", UNAVAILABLE);
  }
  if (error instanceof Error && /timed out/i.test(error.message))
    return settingsFailure("unknown", "The request timed out; check the current state.");
  return settingsFailure("failed", "Automatic login could not be changed.");
}

/** moire-dm-settings over the system bus, from this process. Reads the status at once. */
export function createLoginSettingsClient(
  options: {
    /** The system bus; by default connected on first use, and again after it drops. */
    connect?: () => Promise<SessionBus>;
    /** The session user's login name; this process's by default. */
    username?: string;
    /** Why the compositor's prompt dismissed this process's request. Without it: `cancelled`. */
    promptDismissal?: PromptDismissalLookup;
    timeoutMs?: number;
  } = {},
): LoginSettingsClient {
  // The prompt gives up after 120 s idle, and moire-dm-settings withdraws its polkit question
  // after 140 s; this waits longer than both.
  const timeoutMs = options.timeoutMs ?? PROMPT_TIMEOUT_MS;
  const username = options.username ?? os.userInfo().username;
  let bus: SessionBus | null = null;
  let disposed = false;
  let revision = 0;
  let state: LoginSettingsState = { kind: "loading", message: "Reading automatic login" };
  const listeners = new Set<(state: LoginSettingsState) => void>();
  const connection = async () => {
    if (bus) return bus;
    const next = await (options.connect
      ? options.connect()
      : SessionBus.connect(SYSTEM_BUS_ADDRESS, { timeoutMs: 5000 }));
    next.onDisconnect(() => {
      if (bus === next) bus = null;
    });
    bus = next;
    return next;
  };
  const call = async (member: string, signature = "", body: unknown[] = [], interactive = false) =>
    (await connection()).call(
      {
        destination: LOGIN_MANAGER_BUS,
        path: LOGIN_MANAGER_PATH,
        interface: LOGIN_MANAGER_INTERFACE,
        member,
        signature,
        body,
        // This caller waits for the prompt; without the flag polkit is asked with no prompt.
        flags: interactive ? ALLOW_INTERACTIVE_AUTHORIZATION : 0,
      },
      { timeoutMs: interactive ? timeoutMs : 15_000 },
    );
  const publish = (status: LoginStatus) => {
    if (disposed) return;
    if (state.kind === "ready" && JSON.stringify(state.status) === JSON.stringify(status)) return;
    state = { kind: "ready", owner: LOGIN_MANAGER_BUS, revision: ++revision, status };
    for (const listener of [...listeners]) listener(state);
  };
  /** Read moire-dm-settings' status; a missing daemon is `available: false`. */
  const read = async (): Promise<SettingsResult> => {
    let status: LoginStatus;
    try {
      const reply = await call("GetStatus");
      status = parseLoginManagerStatus(reply.signature === "s" ? reply.body?.[0] : null, username);
    } catch (error) {
      const failure = managerFailure(error);
      status =
        failure.code === "unavailable"
          ? { kind: "ready", available: false, enabled: false, user: null }
          : { kind: "error", message: "Unable to read automatic login." };
    }
    publish(status);
    return status.kind === "ready"
      ? { ok: true, value: undefined }
      : settingsFailure("failed", status.message);
  };
  let busy = false;
  void read();
  return {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    refresh: read,
    async setAutologin(enabled) {
      if (busy) return settingsFailure("busy", "Another change is running. Try again.");
      if (state.kind === "ready" && state.status.kind === "ready" && !state.status.available)
        return settingsFailure("unavailable", UNAVAILABLE);
      busy = true;
      let failure: SettingsFailure;
      try {
        await call("SetAutomaticLogin", "b", [enabled], true);
        return { ok: true, value: undefined };
      } catch (error) {
        failure = managerFailure(error);
      } finally {
        busy = false;
        await read();
      }
      if (failure.code !== "cancelled") return failure;
      // Polkit says only "dismissed"; the compositor says why, for this process's own request.
      const reason = await options.promptDismissal?.(SET_AUTOLOGIN_ACTION).catch(() => null);
      return reason === "refused"
        ? settingsFailure("refused", PROMPT_REFUSED)
        : settingsFailure("cancelled", PROMPT_CANCELLED);
    },
    async dispose() {
      disposed = true;
      listeners.clear();
      bus?.close();
      bus = null;
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Fake for UI smokes and the gallery.

export type FakeLoginSettings = LoginSettingsClient & {
  emit(status: LoginStatus): void;
  failNext(code: SettingsErrorCode): void;
  readonly calls: readonly string[];
};

export function createFakeLoginSettingsClient(
  options: {
    status?: LoginStatus;
    /** The session user's name, recorded when they turn it on. */
    username?: string;
    /** Asked for each change; authorizes at once unless given. */
    prompt?: FakePrompt;
  } = {},
): FakeLoginSettings {
  const username = options.username ?? "joshua";
  const prompt = options.prompt ?? (async () => "authorized" as const);
  let revision = 1;
  let status: LoginStatus = options.status ?? {
    kind: "ready",
    available: true,
    enabled: false,
    user: null,
  };
  let state: LoginSettingsState = { kind: "ready", owner: ":fake.2", revision, status };
  let failure: SettingsErrorCode | null = null;
  const listeners = new Set<(state: LoginSettingsState) => void>();
  const calls: string[] = [];
  const emit = (next: LoginStatus) => {
    status = next;
    state = { kind: "ready", owner: ":fake.2", revision: ++revision, status };
    for (const listener of [...listeners]) listener(state);
  };
  return {
    get state() {
      return state;
    },
    calls,
    emit,
    failNext(code) {
      failure = code;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    async refresh() {
      calls.push("Refresh");
      return { ok: true, value: undefined };
    },
    async setAutologin(enabled) {
      calls.push(`SetAutomaticLogin:${enabled}`);
      if (failure) {
        const code = failure;
        failure = null;
        return settingsFailure(code, `Fake ${code}`);
      }
      if (status.kind !== "ready" || !status.available)
        return settingsFailure("unavailable", "Automatic login isn't available on this computer.");
      const refusal = fakePromptFailure(await prompt());
      if (refusal) return refusal;
      emit({ ...status, enabled, user: enabled ? username : null });
      return { ok: true, value: undefined };
    },
    async dispose() {
      listeners.clear();
    },
  };
}

export type { SettingsErrorCode, SettingsFailure, SettingsResult } from "./settings-service";
