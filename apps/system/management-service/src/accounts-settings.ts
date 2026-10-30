/**
 * Users & login: AccountsService on the system bus, exported to Settings as org.moire.Accounts1.
 *
 * Security model (docs/settings-redesign.md, "Time, region & accounts backend";
 * docs/polkit-agent.md):
 * - Polkit lets an active, local session change its own name and icon without a prompt
 *   (nix/moire-settings.rules). Changing anyone else's account is
 *   `org.freedesktop.accounts.user-administration`, which asks for an administrator's password
 *   (nix/moire-admin.rules, AUTH_ADMIN_KEEP). The compositor's authentication agent draws that
 *   prompt; this service never sees the password.
 * - This service holds no authorization state. Before an administrator action it asks polkit,
 *   with interaction allowed, about its own system-bus connection. That is where a dismissed
 *   prompt is told apart from a refusal (AccountsService reports both as PermissionDenied).
 *   Polkit keeps the authorization for this process for five minutes, so the AccountsService
 *   call that follows doesn't prompt again; it is still sent with interaction allowed.
 * - A standard user may ask too: the prompt then wants an administrator's password.
 * - One's own password changes through `passwd`, whose PAM stack checks the current password;
 *   no polkit grant covers it.
 * - New passwords never reach a log, argv or the environment; other users' new passwords are
 *   hashed here and only the hash goes to AccountsService.
 */
import fs from "node:fs";
import path from "node:path";
import {
  ALLOW_INTERACTIVE_AUTHORIZATION,
  DbusRemoteError,
  SessionBus,
  variant,
  type DbusMethodContext,
} from "@moire/dbus";
import { SettingsServiceError } from "@moire/system-management/settings-service";
import {
  ACCOUNTS_SETTINGS_INTERFACE,
  ACCOUNTS_SETTINGS_PATH,
  MAX_ICON_BYTES,
  MIN_PASSWORD_LENGTH,
  passwordProblem,
  realNameProblem,
  usernameProblem,
  type AccountType,
  type AccountUser,
  type AccountsStatus,
} from "@moire/system-management/accounts-settings";
import {
  createPasswordThrottle,
  type OwnPasswordChanger,
} from "@moire/system-management/password-check";
import { hashNewPassword } from "./sha512-crypt";
import { SYSTEM_BUS_ADDRESS } from "./time-settings";

const ACCOUNTS = "org.freedesktop.Accounts";
const ACCOUNTS_PATH = "/org/freedesktop/Accounts";
const USER = `${ACCOUNTS}.User`;
const PROPERTIES = "org.freedesktop.DBus.Properties";
const USER_PATH = /^\/org\/freedesktop\/Accounts\/User[0-9]+$/;
const POLKIT = "org.freedesktop.PolicyKit1";
const POLKIT_AUTHORITY = "/org/freedesktop/PolicyKit1/Authority";
const ADMINISTRATION_ACTION = "org.freedesktop.accounts.user-administration";
/** CheckAuthorization flag: polkit may ask the user (through the session's agent). */
const ALLOW_USER_INTERACTION = 1;
const STALE_MS = 15_000;
/**
 * How long a call that may raise the password prompt waits. The prompt gives up after 120 s
 * without input (docs/polkit-agent.md, "Cancel, timeout and queueing").
 */
export const INTERACTIVE_TIMEOUT_MS = 150_000;
const CANCELLED = "The password request was cancelled.";
const DENIED = "System policy does not allow this change.";

/** Polkit's answer to an interactive check: `cancelled` when the prompt was dismissed. */
export type AdminAuthorization = "authorized" | "cancelled" | "denied";

type Ready = Extract<AccountsStatus, { kind: "ready" }>;
type ListedUser = AccountUser & { path: string };

/** The AccountsService calls this service makes; a fake implements it in the smoke. */
export type AccountsBackend = {
  list(): Promise<ListedUser[]>;
  setRealName(user: string, name: string): Promise<void>;
  setIconFile(user: string, file: string): Promise<void>;
  setAccountType(user: string, type: AccountType): Promise<void>;
  setPasswordHash(user: string, hash: string): Promise<void>;
  createUser(username: string, realName: string, type: AccountType): Promise<number>;
  deleteUser(uid: number, removeFiles: boolean): Promise<void>;
  /** Ask polkit, prompting if it must, whether this process may change other accounts. */
  authorizeAdministration(): Promise<AdminAuthorization>;
  dispose(): Promise<void>;
};

function accountsFailure(error: unknown): SettingsServiceError {
  if (error instanceof SettingsServiceError) return error;
  const name = error instanceof DbusRemoteError ? error.errorName : "";
  switch (name) {
    case `${ACCOUNTS}.Error.PermissionDenied`:
    case "org.freedesktop.DBus.Error.AccessDenied":
    case "org.freedesktop.DBus.Error.InteractiveAuthorizationRequired":
      return new SettingsServiceError("permission", DENIED);
    case `${ACCOUNTS}.Error.UserExists`:
      return new SettingsServiceError("invalid", "That username is taken.");
    case `${ACCOUNTS}.Error.UserDoesNotExist`:
      return new SettingsServiceError("invalid", "That account no longer exists.");
    case `${ACCOUNTS}.Error.NotSupported`:
      return new SettingsServiceError(
        "unavailable",
        "Accounts are fixed by the system configuration on this computer.",
      );
    case "org.freedesktop.DBus.Error.ServiceUnknown":
    case "org.freedesktop.DBus.Error.NameHasNoOwner":
      return new SettingsServiceError("unavailable", "The accounts service is not running.");
    default:
      return new SettingsServiceError("failed", "The accounts service refused the change.");
  }
}

function prop(raw: Record<string, unknown>, key: string, signature: string): unknown {
  const value = raw[key] as { signature?: string; value?: unknown } | undefined;
  if (!value || value.signature !== signature) throw new Error(`Invalid account ${key}`);
  return value.value;
}
function text(raw: Record<string, unknown>, key: string, limit: number): string {
  const value = prop(raw, key, "s");
  if (typeof value !== "string" || value.length > limit || value.includes("\0"))
    throw new Error(`Invalid account ${key}`);
  return value;
}
function flag(raw: Record<string, unknown>, key: string): boolean {
  const value = prop(raw, key, "b");
  if (typeof value !== "boolean") throw new Error(`Invalid account ${key}`);
  return value;
}

/** Real AccountsService over the system bus. Reads never activate anything else. */
export async function createAccountsServiceBackend(
  options: {
    connect?: () => Promise<SessionBus>;
    selfUid?: number;
    timeoutMs?: number;
    /** How long to wait where the password prompt may be up. */
    promptTimeoutMs?: number;
  } = {},
): Promise<AccountsBackend> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const promptTimeoutMs = options.promptTimeoutMs ?? INTERACTIVE_TIMEOUT_MS;
  const selfUid = options.selfUid ?? process.getuid?.() ?? -1;
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
  const call = async (
    objectPath: string,
    iface: string,
    member: string,
    signature = "",
    body: unknown[] = [],
    interactive = false,
  ) => {
    try {
      return await (
        await connection()
      ).call(
        {
          destination: ACCOUNTS,
          path: objectPath,
          interface: iface,
          member,
          signature,
          body,
          flags: interactive ? ALLOW_INTERACTIVE_AUTHORIZATION : 0,
        },
        { timeoutMs: interactive ? promptTimeoutMs : timeoutMs },
      );
    } catch (error) {
      throw accountsFailure(error);
    }
  };
  /** A change: AccountsService may ask polkit, and polkit may ask the user. */
  const change = (
    objectPath: string,
    iface: string,
    member: string,
    signature: string,
    body: unknown[],
  ) => call(objectPath, iface, member, signature, body, true);
  let checks = 0;
  const objectPath = (value: unknown): string => {
    if (typeof value !== "string" || !USER_PATH.test(value))
      throw new SettingsServiceError("failed", "The accounts service sent an invalid reply.");
    return value;
  };
  const read = async (userPath: string): Promise<ListedUser | null> => {
    const reply = await call(userPath, PROPERTIES, "GetAll", "s", [USER]);
    const raw = reply.body?.[0] as Record<string, unknown> | undefined;
    if (reply.signature !== "a{sv}" || !raw) throw new Error("Invalid account reply");
    const uidValue = prop(raw, "Uid", "t");
    if (typeof uidValue !== "bigint" || uidValue > 0xffff_fffen) throw new Error("Invalid uid");
    const uid = Number(uidValue);
    const self = uid === selfUid;
    const shell = text(raw, "Shell", 4096);
    if (
      !self &&
      (uid === 0 ||
        flag(raw, "SystemAccount") ||
        !flag(raw, "LocalAccount") ||
        /\/(?:nologin|false)$/.test(shell))
    )
      return null;
    const iconFile = text(raw, "IconFile", 4096);
    const login = prop(raw, "LoginTime", "x");
    const type = prop(raw, "AccountType", "i");
    return {
      path: userPath,
      uid,
      username: text(raw, "UserName", 64),
      realName: text(raw, "RealName", 256),
      iconFile: iconFile.startsWith("/") && fs.existsSync(iconFile) ? iconFile : null,
      accountType: type === 1 ? "administrator" : "standard",
      locked: flag(raw, "Locked"),
      lastLoginMs: typeof login === "bigint" && login > 0n ? Number(login) * 1000 : null,
      self,
    };
  };
  const typeCode = (type: AccountType) => (type === "administrator" ? 1 : 0);
  return {
    async list() {
      const listed = await call(ACCOUNTS_PATH, ACCOUNTS, "ListCachedUsers");
      const paths = listed.body?.[0];
      if (!Array.isArray(paths) || paths.length > 256) throw new Error("Invalid account list");
      const all = new Set(paths.map(objectPath));
      if (selfUid >= 0) {
        // The session user may be absent from the cache (never logged in through a DM).
        const found = await call(ACCOUNTS_PATH, ACCOUNTS, "FindUserById", "x", [BigInt(selfUid)]);
        all.add(objectPath(found.body?.[0]));
      }
      const users = (await Promise.all([...all].map(read))).filter(
        (user): user is ListedUser => user !== null,
      );
      return users.sort(
        (a, b) => Number(b.self) - Number(a.self) || a.username.localeCompare(b.username),
      );
    },
    async setRealName(user, name) {
      await change(user, USER, "SetRealName", "s", [name]);
    },
    async setIconFile(user, file) {
      await change(user, USER, "SetIconFile", "s", [file]);
    },
    async setAccountType(user, type) {
      await change(user, USER, "SetAccountType", "i", [typeCode(type)]);
    },
    async setPasswordHash(user, hash) {
      // The hint is left empty: hints are readable by every local user.
      await change(user, USER, "SetPassword", "ss", [hash, ""]);
    },
    async createUser(username, realName, type) {
      const created = await change(ACCOUNTS_PATH, ACCOUNTS, "CreateUser", "ssi", [
        username,
        realName,
        typeCode(type),
      ]);
      const user = await read(objectPath(created.body?.[0]));
      if (!user) throw new SettingsServiceError("failed", "The new account could not be read.");
      return user.uid;
    },
    async deleteUser(uid, removeFiles) {
      await change(ACCOUNTS_PATH, ACCOUNTS, "DeleteUser", "xb", [BigInt(uid), removeFiles]);
    },
    async authorizeAdministration() {
      const system = await connection().catch((error: unknown) => {
        throw accountsFailure(error);
      });
      const cancellation = `moire-accounts-${process.pid}-${++checks}`;
      let reply;
      try {
        reply = await system.call(
          {
            destination: POLKIT,
            path: POLKIT_AUTHORITY,
            interface: `${POLKIT}.Authority`,
            member: "CheckAuthorization",
            signature: "(sa{sv})sa{ss}us",
            // The subject is this connection: the one the AccountsService calls come from.
            body: [
              ["system-bus-name", { name: variant("s", system.name ?? "") }],
              ADMINISTRATION_ACTION,
              {},
              ALLOW_USER_INTERACTION,
              cancellation,
            ],
          },
          { timeoutMs: promptTimeoutMs },
        );
      } catch (error) {
        if (error instanceof DbusRemoteError) {
          if (error.errorName === `${POLKIT}.Error.Cancelled`) return "cancelled";
          throw new SettingsServiceError("unavailable", "The system policy could not be checked.");
        }
        if (!(error instanceof Error) || !/timed out/i.test(error.message))
          throw new SettingsServiceError("unavailable", "The system policy could not be checked.");
        // Timed out: withdraw the question, so no prompt outlives its caller.
        void system
          .call({
            destination: POLKIT,
            path: POLKIT_AUTHORITY,
            interface: `${POLKIT}.Authority`,
            member: "CancelCheckAuthorization",
            signature: "s",
            body: [cancellation],
          })
          .catch(() => {});
        return "cancelled";
      }
      const result = reply.signature === "(bba{ss})" ? reply.body?.[0] : null;
      if (!Array.isArray(result) || typeof result[0] !== "boolean")
        throw new SettingsServiceError("failed", "The system policy sent an invalid reply.");
      if (result[0]) return "authorized";
      const details = result[2] as Record<string, unknown> | null | undefined;
      return details && typeof details === "object" && "polkit.dismissed" in details
        ? "cancelled"
        : "denied";
    },
    async dispose() {
      bus?.close();
      bus = null;
    },
  };
}

/** A PNG or JPEG, a regular file the user can read, at most 1 MiB (AccountsService's limit). */
export function checkIconFile(file: string): string {
  const fail = (message: string) => new SettingsServiceError("invalid", message);
  if (!path.isAbsolute(file)) throw fail("Choose an image file.");
  let resolved: string;
  let stat: fs.Stats;
  try {
    resolved = fs.realpathSync(file);
    stat = fs.statSync(resolved);
  } catch {
    throw fail("That image could not be opened.");
  }
  if (!stat.isFile()) throw fail("Choose an image file.");
  if (stat.size > MAX_ICON_BYTES) throw fail("Choose an image of at most 1 MB.");
  const head = Buffer.alloc(4);
  try {
    const fd = fs.openSync(resolved, "r");
    try {
      fs.readSync(fd, head, 0, 4, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    throw fail("That image could not be opened.");
  }
  const png = head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
  if (!png && !jpeg) throw fail("Choose a PNG or JPEG image.");
  return resolved;
}

export type AccountsSettingsOptions = {
  backend: AccountsBackend;
  /** Changes the session user's own password, verifying the current one (passwd + PAM). */
  changeOwnPassword: OwnPasswordChanger;
  now?: () => number;
  throttle?: ReturnType<typeof createPasswordThrottle>;
  hash?: (password: string) => string;
};

/** Export org.moire.Accounts1 on the already-owned session name. */
export function attachAccountsSettings(bus: SessionBus, options: AccountsSettingsOptions) {
  const { backend, changeOwnPassword } = options;
  const now = options.now ?? Date.now;
  const throttle = options.throttle ?? createPasswordThrottle();
  const hash = options.hash ?? hashNewPassword;
  let revision = 0;
  let published: AccountsStatus | null = null;
  let users: ListedUser[] = [];
  let readAt = 0;
  let busy = false;
  const failure = (code: SettingsServiceError["code"], message: string) =>
    new SettingsServiceError(code, message);

  const status = async (fresh: boolean): Promise<AccountsStatus> => {
    if (!fresh && published && now() - readAt < STALE_MS) return published;
    let next: AccountsStatus;
    try {
      users = await backend.list();
      const self = users.find((user) => user.self);
      if (!self) throw failure("unavailable", "Your account is not known to the accounts service.");
      const ready: Ready = {
        kind: "ready",
        selfUid: self.uid,
        users: users.map(({ path: _path, ...user }) => user),
        policy: {
          canAdminister: self.accountType === "administrator",
          minPasswordLength: MIN_PASSWORD_LENGTH,
        },
      };
      next = ready;
    } catch (error) {
      const known = error instanceof SettingsServiceError ? error : accountsFailure(error);
      users = [];
      next =
        known.code === "unavailable"
          ? { kind: "unavailable", message: known.message }
          : { kind: "error", message: "Unable to read the accounts on this computer." };
    }
    readAt = now();
    if (JSON.stringify(next) !== JSON.stringify(published)) {
      published = next;
      revision++;
      bus.emitSignal({
        path: ACCOUNTS_SETTINGS_PATH,
        interface: ACCOUNTS_SETTINGS_INTERFACE,
        member: "Changed",
        signature: "s",
        body: [JSON.stringify({ revision, status: next })],
      });
    }
    return next;
  };
  const ready = async (): Promise<Ready> => {
    const current = await status(false);
    if (current.kind !== "ready") throw failure("unavailable", current.message);
    return current;
  };
  const target = (uidValue: unknown): ListedUser => {
    const found = users.find((user) => user.uid === uidValue);
    if (!found) throw failure("invalid", "That account no longer exists.");
    return found;
  };
  /**
   * Polkit's prompt for an administrator's password, unless this process was authorized in the
   * last five minutes. Called after an action's arguments are checked, so nobody types a
   * password for a change that would be refused anyway.
   */
  const authorizeAdmin = async () => {
    const answer = await backend.authorizeAdministration();
    if (answer === "cancelled") throw failure("cancelled", CANCELLED);
    if (answer === "denied") throw failure("permission", DENIED);
  };
  /** Own account: polkit allows it outright. Anyone else's: an administrator's password. */
  const authorizeOwnerOrAdmin = async (user: ListedUser) => {
    if (!user.self) await authorizeAdmin();
  };
  const newPassword = (password: unknown): string => {
    const value = typeof password === "string" ? password : "";
    const problem = passwordProblem(value);
    if (problem) throw failure("invalid", problem);
    return value;
  };
  const adminCount = () => users.filter((user) => user.accountType === "administrator").length;

  type Handler = (context: DbusMethodContext) => Promise<unknown[] | void>;
  const method = (
    inSignature: string,
    outSignature: string,
    handler: Handler,
    mutation = true,
  ) => ({
    inSignature,
    outSignature,
    handler: async (context: DbusMethodContext) => {
      if ((context.message.signature ?? "") !== inSignature)
        throw failure("invalid", "Invalid arguments.").remote(ACCOUNTS_SETTINGS_INTERFACE);
      if (mutation && busy)
        throw failure("busy", "Another account change is running.").remote(
          ACCOUNTS_SETTINGS_INTERFACE,
        );
      if (mutation) busy = true;
      try {
        const body = await handler(context);
        return body ? { body } : {};
      } catch (error) {
        // Only fixed messages leave: never an exception that might quote an argument.
        const known = error instanceof SettingsServiceError ? error : accountsFailure(error);
        throw known.remote(ACCOUNTS_SETTINGS_INTERFACE);
      } finally {
        if (mutation) {
          busy = false;
          await status(true).catch(() => {});
        }
      }
    },
  });

  const unexport = bus.exportObject(ACCOUNTS_SETTINGS_PATH, {
    name: ACCOUNTS_SETTINGS_INTERFACE,
    methods: {
      GetStatus: method(
        "",
        "s",
        async () => {
          const current = await status(false);
          return [JSON.stringify({ revision, status: current })];
        },
        false,
      ),
      Refresh: method("", "", async () => {}),
      SetRealName: method("us", "", async ({ body }) => {
        await ready();
        const user = target(body[0]);
        const name = String(body[1]).trim();
        const problem = realNameProblem(name);
        if (problem) throw failure("invalid", problem);
        await authorizeOwnerOrAdmin(user);
        await backend.setRealName(user.path, name);
      }),
      SetIcon: method("us", "", async ({ body }) => {
        await ready();
        const user = target(body[0]);
        const file = String(body[1]);
        // AccountsService copies the file into its icon store, reading it as this user.
        const icon = file ? checkIconFile(file) : "";
        await authorizeOwnerOrAdmin(user);
        await backend.setIconFile(user.path, icon);
      }),
      ChangePassword: method("ss", "", async ({ body }) => {
        await ready();
        const current = String(body[0]);
        const next = newPassword(body[1]);
        if (!current || Buffer.byteLength(current) > 512)
          throw failure("wrong_password", "That password is not correct.");
        if (next === current)
          throw failure("invalid", "Choose a password different from the current one.");
        const verdict = await throttle.run(() => changeOwnPassword(current, next));
        if (verdict === "rate_limited")
          throw failure("rate_limited", "Too many attempts. Wait a minute and try again.");
        if (verdict === "wrong") throw failure("wrong_password", "That password is not correct.");
        if (verdict === "rejected")
          throw failure("invalid", "The system did not accept that new password.");
        if (verdict === "unavailable")
          throw failure("unavailable", "Passwords cannot be changed on this computer.");
      }),
      SetPassword: method("us", "", async ({ body }) => {
        await ready();
        const user = target(body[0]);
        if (user.self)
          throw failure("invalid", "Change your own password with your current password.");
        const password = newPassword(body[1]);
        await authorizeAdmin();
        await backend.setPasswordHash(user.path, hash(password));
      }),
      CreateUser: method("ssss", "u", async ({ body }) => {
        await ready();
        const [name, realName, type] = body.map(String);
        const problem =
          usernameProblem(name!) ??
          realNameProblem(realName!.trim()) ??
          (type === "standard" || type === "administrator" ? null : "Choose an account type.");
        if (problem) throw failure("invalid", problem);
        const password = newPassword(body[3]);
        if (users.some((user) => user.username === name))
          throw failure("invalid", "That username is taken.");
        await authorizeAdmin();
        const created = await backend.createUser(name!, realName!.trim(), type as AccountType);
        try {
          await status(true);
          await backend.setPasswordHash(target(created).path, hash(password));
        } catch {
          throw failure(
            "failed",
            "The account was created without a password. Set its password before signing in.",
          );
        }
        return [created];
      }),
      DeleteUser: method("ub", "", async ({ body }) => {
        await ready();
        const user = target(body[0]);
        if (user.self) throw failure("invalid", "You cannot delete the account you are using.");
        if (user.accountType === "administrator" && adminCount() <= 1)
          throw failure("invalid", "Keep at least one administrator.");
        await authorizeAdmin();
        await backend.deleteUser(user.uid, body[1] !== true);
      }),
      SetAccountType: method("us", "", async ({ body }) => {
        await ready();
        const user = target(body[0]);
        const type = body[1];
        if (type !== "standard" && type !== "administrator")
          throw failure("invalid", "Choose an account type.");
        if (type === "standard" && user.accountType === "administrator" && adminCount() <= 1)
          throw failure("invalid", "Keep at least one administrator.");
        await authorizeAdmin();
        await backend.setAccountType(user.path, type);
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
