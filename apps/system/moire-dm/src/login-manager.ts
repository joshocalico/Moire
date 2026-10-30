/**
 * moire-dm-settings: the automatic-login writer, `org.moire.LoginManager1` on the system bus.
 * It runs as its own unprivileged account and owns only /var/lib/moire-dm (docs/moire-dm.md,
 * "Automatic login").
 *
 * - **Own account only, structurally:** the account to sign in is the caller's, taken from the
 *   bus's credentials for the calling connection. No method takes an account name.
 * - **Polkit:** `org.moire.dm.set-autologin`, checked for the calling connection.
 *   nix/moire-admin.rules answers "an administrator's password" (kept five minutes) for active,
 *   local sessions; the fallback denies everyone else. Polkit raises the prompt through the
 *   caller's session agent, the compositor (docs/polkit-agent.md). This service never sees a
 *   password.
 * - **Interaction** is allowed only for a caller that set D-Bus's
 *   ALLOW_INTERACTIVE_AUTHORIZATION flag, and so waits. Any other caller gets polkit's answer
 *   without a prompt. A dismissed prompt is the fixed error `cancelled`.
 * - **A standard user** may ask: an administrator then types their password at the prompt.
 * - **Writes** go through `writeAutologinFile`, checked by the broker's own parser first.
 *
 * Nothing about a caller is logged except the account an enable or disable was for.
 */
import {
  ALLOW_INTERACTIVE_AUTHORIZATION,
  DbusRemoteError,
  type DbusMethodContext,
  type SessionBus,
} from "@moire/dbus";
import { MIN_USER_UID, validAccountName, type DmConfig } from "./config";

export const LOGIN_MANAGER_BUS = "org.moire.LoginManager1";
export const LOGIN_MANAGER_PATH = "/org/moire/LoginManager1";
export const LOGIN_MANAGER_INTERFACE = "org.moire.LoginManager1";
export const SET_AUTOLOGIN_ACTION = "org.moire.dm.set-autologin";

/** What GetStatus returns, as JSON. `problem` is set when the file on disk is odd (treated as off). */
export type LoginManagerStatus = Readonly<{
  version: 1;
  enabled: boolean;
  user: string | null;
  session: string | null;
  problem: string | null;
}>;

export type StoredAutologin =
  | Readonly<{ kind: "disabled" }>
  | Readonly<{ kind: "enabled"; user: string; session: string }>
  | Readonly<{ kind: "invalid"; reason: string }>;

export type LoginManagerDeps = Readonly<{
  config: DmConfig;
  /** The bus's own answer for who owns a connection (GetConnectionUnixUser). */
  callerUid: (sender: string) => Promise<number>;
  /**
   * Polkit's answer for the calling connection. With `interactive`, polkit may raise its
   * password prompt and this waits for it; `dismissed` is the user closing that prompt.
   */
  authorize: (sender: string, interactive: boolean) => Promise<PolkitAnswer>;
  /** The login name for a uid, or null (from /etc/passwd in production). */
  accountName: (uid: number) => string | null;
  read: () => StoredAutologin;
  write: (record: { user: string; session: string } | null) => void;
  log: (line: string) => void;
}>;

export type PolkitAnswer = "yes" | "no" | "dismissed";

type Code = "permission" | "cancelled" | "invalid" | "unavailable" | "busy" | "failed";

function failure(code: Code, message: string): DbusRemoteError {
  return new DbusRemoteError(`${LOGIN_MANAGER_INTERFACE}.Error.${code}`, message);
}

export function attachLoginManager(bus: SessionBus, deps: LoginManagerDeps): () => void {
  const defaultSession = deps.config.sessions[0]!.id;
  let busy = false;

  const status = (): LoginManagerStatus => {
    const stored = deps.read();
    return {
      version: 1,
      enabled: stored.kind === "enabled",
      user: stored.kind === "enabled" ? stored.user : null,
      session: stored.kind === "enabled" ? stored.session : null,
      problem: stored.kind === "invalid" ? stored.reason : null,
    };
  };

  const caller = async (sender: string, interactive: boolean): Promise<string> => {
    let uid: number;
    try {
      uid = await deps.callerUid(sender);
    } catch {
      throw failure("unavailable", "Your account could not be identified.");
    }
    const name = deps.accountName(uid);
    if (uid < MIN_USER_UID || !name || !validAccountName(name) || name === deps.config.greeter.user)
      throw failure("permission", "Automatic login is only for people's own accounts.");
    let answer: PolkitAnswer;
    try {
      answer = await deps.authorize(sender, interactive);
    } catch {
      throw failure("unavailable", "The system policy could not be checked.");
    }
    if (answer === "dismissed") throw failure("cancelled", "The password request was cancelled.");
    if (answer !== "yes")
      throw failure("permission", "System policy does not allow changing automatic login.");
    return name;
  };

  return bus.exportObject(LOGIN_MANAGER_PATH, {
    name: LOGIN_MANAGER_INTERFACE,
    methods: {
      GetStatus: {
        inSignature: "",
        outSignature: "s",
        handler: ({ message }: DbusMethodContext) => {
          if ((message.signature ?? "") !== "") throw failure("invalid", "Invalid arguments.");
          return { body: [JSON.stringify(status())] };
        },
      },
      // On: the caller's own account, with the catalog's default session. Off: no automatic
      // login for anyone (the same authorization turns it off; docs/moire-dm.md).
      SetAutomaticLogin: {
        inSignature: "b",
        outSignature: "",
        handler: async ({ message, body }: DbusMethodContext) => {
          if (message.signature !== "b" || typeof body[0] !== "boolean")
            throw failure("invalid", "Invalid arguments.");
          const sender = message.sender;
          if (!sender) throw failure("invalid", "Invalid caller.");
          if (busy) throw failure("busy", "Another change is running.");
          busy = true;
          try {
            const interactive = ((message.flags ?? 0) & ALLOW_INTERACTIVE_AUTHORIZATION) !== 0;
            const user = await caller(sender, interactive);
            const enable = body[0];
            try {
              deps.write(enable ? { user, session: defaultSession } : null);
            } catch {
              throw failure("failed", "Automatic login could not be saved.");
            }
            deps.log(
              `moire-dm-settings: code=${enable ? "autologin-on" : "autologin-off"} user=${user}`,
            );
            return {};
          } finally {
            busy = false;
          }
        },
      },
    },
  });
}

/** Login name for a uid from passwd(5) text; the first exact match wins. */
export function passwdName(passwd: string, uid: number): string | null {
  for (const line of passwd.split("\n")) {
    const fields = line.split(":");
    if (fields.length < 7) continue;
    if (/^\d+$/.test(fields[2]!) && Number(fields[2]) === uid) return fields[0]!;
  }
  return null;
}
