/**
 * Automatic login through the management service (`org.moire.LoginSettings1`), which asks
 * moire-dm-settings on the system bus. Only for the session user's own account. Changing it
 * raises the system's password prompt for an administrator (docs/polkit-agent.md); the call
 * resolves when the prompt does, and a dismissed prompt is `cancelled`.
 * See docs/moire-dm.md, "Automatic login".
 */
import { SessionBus } from "@moire/dbus";
import { PROMPT_TIMEOUT_MS, type FakePrompt } from "./accounts-settings";
import {
  bounded,
  observeSettingsService,
  remoteSettingsFailure,
  settingsFailure,
  type ServiceClientState,
  type SettingsErrorCode,
  type SettingsResult,
} from "./settings-service";

export const LOGIN_SETTINGS_PATH = "/org/moire/LoginSettings1";
export const LOGIN_SETTINGS_INTERFACE = "org.moire.LoginSettings1";

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

export function parseLoginStatus(value: unknown): LoginStatus {
  if (!value || typeof value !== "object") throw new Error("Invalid login status");
  const raw = value as Record<string, unknown>;
  if (raw.kind === "unavailable" || raw.kind === "error")
    return { kind: raw.kind, message: bounded(raw.message, 512, "login message") };
  if (
    raw.kind !== "ready" ||
    typeof raw.available !== "boolean" ||
    typeof raw.enabled !== "boolean"
  )
    throw new Error("Invalid login status");
  const user = raw.user === null ? null : bounded(raw.user, 64, "login user");
  if (raw.enabled && user === null) throw new Error("Invalid login status");
  return { kind: "ready", available: raw.available, enabled: raw.enabled, user };
}

export type LoginSettingsState = ServiceClientState<LoginStatus>;

export type LoginSettingsClient = {
  readonly state: LoginSettingsState;
  subscribe(listener: (state: LoginSettingsState) => void): () => void;
  refresh(): Promise<SettingsResult>;
  /**
   * Turn automatic login on for yourself, or off. Raises the password prompt for an
   * administrator; `cancelled` if it is dismissed, `permission` if policy refuses.
   */
  setAutologin(enabled: boolean): Promise<SettingsResult>;
  dispose(): Promise<void>;
};

const FALLBACK = "Automatic login did not change.";

export async function observeLoginSettings(bus: SessionBus): Promise<LoginSettingsClient> {
  const observer = await observeSettingsService(bus, {
    path: LOGIN_SETTINGS_PATH,
    iface: LOGIN_SETTINGS_INTERFACE,
    parse: parseLoginStatus,
    label: "login settings",
  });
  const run = async (member: string, signature: string, body: unknown[]) => {
    try {
      await observer.call(member, signature, body, PROMPT_TIMEOUT_MS);
      return { ok: true, value: undefined } as const;
    } catch (error) {
      return remoteSettingsFailure(LOGIN_SETTINGS_INTERFACE, error, FALLBACK);
    }
  };
  return {
    get state() {
      return observer.state;
    },
    subscribe: observer.subscribe,
    refresh: () => run("Refresh", "", []),
    setAutologin: (enabled) => run("SetAutomaticLogin", "b", [enabled]),
    dispose: observer.dispose,
  };
}

/** Its own connection. */
export async function connectLoginSettings(): Promise<LoginSettingsClient> {
  const bus = await SessionBus.connect();
  try {
    const client = await observeLoginSettings(bus);
    let disposal: Promise<void> | null = null;
    return {
      ...client,
      get state() {
        return client.state;
      },
      dispose() {
        disposal ??= client.dispose().finally(() => bus.close());
        return disposal;
      },
    };
  } catch (error) {
    bus.close();
    throw error;
  }
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
      if ((await prompt()) === "cancelled")
        return settingsFailure("cancelled", "The password request was cancelled.");
      emit({ ...status, enabled, user: enabled ? username : null });
      return { ok: true, value: undefined };
    },
    async dispose() {
      listeners.clear();
    },
  };
}

export type { SettingsErrorCode, SettingsFailure, SettingsResult } from "./settings-service";
