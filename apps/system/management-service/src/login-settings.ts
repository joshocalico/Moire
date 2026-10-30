/**
 * Automatic login for Settings: `org.moire.LoginSettings1` on the session service, backed by
 * moire-dm-settings (`org.moire.LoginManager1`) on the system bus. See docs/moire-dm.md,
 * "Automatic login".
 *
 * - Turning it on or off is an administrator action. This service holds no authorization
 *   state: it calls moire-dm-settings with interaction allowed, and moire-dm-settings asks
 *   polkit (`org.moire.dm.set-autologin`: an administrator's password, kept five minutes). The
 *   compositor's authentication agent draws the prompt (docs/polkit-agent.md).
 * - A standard user may ask too: the prompt then wants an administrator's password.
 * - moire-dm-settings takes the account from this process's credentials, so it is always the
 *   session user's.
 * - A dismissed prompt comes back as `cancelled`, which Settings shows as nothing at all.
 * - Under greetd there is no moire-dm-settings; the status says `available: false` and Settings
 *   shows no switch.
 */
import os from "node:os";
import {
  ALLOW_INTERACTIVE_AUTHORIZATION,
  DbusRemoteError,
  SessionBus,
  type DbusMethodContext,
} from "@moire/dbus";
import { SettingsServiceError } from "@moire/system-management/settings-service";
import {
  LOGIN_SETTINGS_INTERFACE,
  LOGIN_SETTINGS_PATH,
  type LoginStatus,
} from "@moire/system-management/login-settings";
import { INTERACTIVE_TIMEOUT_MS } from "./accounts-settings";
import { SYSTEM_BUS_ADDRESS } from "./time-settings";

const MANAGER = "org.moire.LoginManager1";
const MANAGER_PATH = "/org/moire/LoginManager1";
const STALE_MS = 15_000;
const ACCOUNT = /^[a-z_][a-z0-9_-]{0,30}\$?$/;

/** What moire-dm-settings reports; `available: false` when it isn't running (greetd images). */
export type LoginManagerState = { available: false } | { available: true; user: string | null };

export type LoginManagerBackend = {
  status(): Promise<LoginManagerState>;
  setAutomaticLogin(enabled: boolean): Promise<void>;
  dispose(): Promise<void>;
};

function managerFailure(error: unknown): SettingsServiceError {
  if (error instanceof SettingsServiceError) return error;
  const name = error instanceof DbusRemoteError ? error.errorName : "";
  switch (name) {
    case `${MANAGER}.Error.permission`:
    case "org.freedesktop.DBus.Error.AccessDenied":
      return new SettingsServiceError(
        "permission",
        "System policy does not allow changing automatic login.",
      );
    case `${MANAGER}.Error.cancelled`:
      return new SettingsServiceError("cancelled", "The password request was cancelled.");
    case `${MANAGER}.Error.busy`:
      return new SettingsServiceError("busy", "Another change is running. Try again.");
    case "org.freedesktop.DBus.Error.ServiceUnknown":
    case "org.freedesktop.DBus.Error.NameHasNoOwner":
      return new SettingsServiceError(
        "unavailable",
        "Automatic login isn't available on this computer.",
      );
    default:
      return new SettingsServiceError("failed", "Automatic login could not be changed.");
  }
}

/** moire-dm-settings over the system bus; connects lazily. */
export async function createLoginManagerBackend(
  options: { connect?: () => Promise<SessionBus>; timeoutMs?: number } = {},
): Promise<LoginManagerBackend> {
  const timeoutMs = options.timeoutMs ?? 5000;
  let bus: SessionBus | null = null;
  const connection = async () => {
    if (bus) return bus;
    bus = await (options.connect
      ? options.connect()
      : SessionBus.connect(SYSTEM_BUS_ADDRESS, { timeoutMs }));
    bus.onDisconnect(() => {
      bus = null;
    });
    return bus;
  };
  const call = async (member: string, signature = "", body: unknown[] = [], interactive = false) =>
    (await connection()).call(
      {
        destination: MANAGER,
        path: MANAGER_PATH,
        interface: MANAGER,
        member,
        signature,
        body,
        // moire-dm-settings lets polkit prompt only for a caller that says it will wait.
        flags: interactive ? ALLOW_INTERACTIVE_AUTHORIZATION : 0,
      },
      { timeoutMs: interactive ? INTERACTIVE_TIMEOUT_MS : 15_000 },
    );
  return {
    async status() {
      let reply;
      try {
        reply = await call("GetStatus");
      } catch (error) {
        const known = managerFailure(error);
        if (known.code === "unavailable") return { available: false };
        throw known;
      }
      const raw = reply.signature === "s" ? reply.body?.[0] : null;
      if (typeof raw !== "string" || raw.length > 4096) throw new Error("Invalid login status");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const user = parsed.user;
      if (
        parsed.version !== 1 ||
        typeof parsed.enabled !== "boolean" ||
        (user !== null && (typeof user !== "string" || !ACCOUNT.test(user))) ||
        parsed.enabled !== (user !== null)
      )
        throw new Error("Invalid login status");
      return { available: true, user: user as string | null };
    },
    async setAutomaticLogin(enabled) {
      try {
        await call("SetAutomaticLogin", "b", [enabled], true);
      } catch (error) {
        throw managerFailure(error);
      }
    },
    async dispose() {
      bus?.close();
      bus = null;
    },
  };
}

export type LoginSettingsOptions = {
  backend: LoginManagerBackend;
  /** The session user's login name. */
  username?: string;
  now?: () => number;
};

/** Export org.moire.LoginSettings1 on the already-owned session name. */
export function attachLoginSettings(bus: SessionBus, options: LoginSettingsOptions) {
  const { backend } = options;
  const username = options.username ?? os.userInfo().username;
  const now = options.now ?? Date.now;
  let revision = 0;
  let published: LoginStatus | null = null;
  let readAt = 0;
  let busy = false;
  const failure = (code: SettingsServiceError["code"], message: string) =>
    new SettingsServiceError(code, message);

  const status = async (fresh: boolean): Promise<LoginStatus> => {
    if (!fresh && published && now() - readAt < STALE_MS) return published;
    let next: LoginStatus;
    try {
      const manager = await backend.status();
      next = manager.available
        ? {
            kind: "ready",
            available: true,
            enabled: manager.user === username,
            user: manager.user,
          }
        : { kind: "ready", available: false, enabled: false, user: null };
    } catch {
      next = { kind: "error", message: "Unable to read automatic login." };
    }
    readAt = now();
    if (JSON.stringify(next) !== JSON.stringify(published)) {
      published = next;
      revision++;
      bus.emitSignal({
        path: LOGIN_SETTINGS_PATH,
        interface: LOGIN_SETTINGS_INTERFACE,
        member: "Changed",
        signature: "s",
        body: [JSON.stringify({ revision, status: next })],
      });
    }
    return next;
  };

  const method = (
    inSignature: string,
    outSignature: string,
    handler: (context: DbusMethodContext) => Promise<unknown[] | void>,
    mutation = true,
  ) => ({
    inSignature,
    outSignature,
    handler: async (context: DbusMethodContext) => {
      if ((context.message.signature ?? "") !== inSignature)
        throw failure("invalid", "Invalid arguments.").remote(LOGIN_SETTINGS_INTERFACE);
      if (mutation && busy)
        throw failure("busy", "Another change is running.").remote(LOGIN_SETTINGS_INTERFACE);
      if (mutation) busy = true;
      try {
        const body = await handler(context);
        return body ? { body } : {};
      } catch (error) {
        // Only fixed messages leave.
        const known = error instanceof SettingsServiceError ? error : managerFailure(error);
        throw known.remote(LOGIN_SETTINGS_INTERFACE);
      } finally {
        if (mutation) {
          busy = false;
          await status(true).catch(() => {});
        }
      }
    },
  });

  const unexport = bus.exportObject(LOGIN_SETTINGS_PATH, {
    name: LOGIN_SETTINGS_INTERFACE,
    methods: {
      GetStatus: method(
        "",
        "s",
        async () => [JSON.stringify({ revision, status: await status(false) })],
        false,
      ),
      Refresh: method("", "", async () => {}),
      SetAutomaticLogin: method("b", "", async ({ body }) => {
        const enabled = body[0];
        if (typeof enabled !== "boolean") throw failure("invalid", "Invalid arguments.");
        const current = await status(true);
        if (current.kind !== "ready" || !current.available)
          throw failure("unavailable", "Automatic login isn't available on this computer.");
        await backend.setAutomaticLogin(enabled);
      }),
    },
  });
  return {
    async dispose() {
      unexport();
      await backend.dispose();
    },
  };
}
