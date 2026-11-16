/**
 * AccountsService (`org.freedesktop.Accounts`) on the system bus, as the management service and
 * moire-accounts use it. No call here allows interactive authorization: the management service
 * changes only its user's own account (a plain YES in nix/moire-settings.rules), and
 * moire-accounts holds its own grant (nix/moire-accounts.rules) after asking polkit once itself.
 * So nothing here can raise a password prompt.
 */
import fs from "node:fs";
import { DbusRemoteError, SessionBus } from "@moire/dbus";
import { SettingsServiceError } from "@moire/system-management/settings-service";
import type { AccountType, AccountUser } from "@moire/system-management/accounts-settings";

export const SYSTEM_BUS_ADDRESS = "unix:path=/run/dbus/system_bus_socket";
const ACCOUNTS = "org.freedesktop.Accounts";
const ACCOUNTS_PATH = "/org/freedesktop/Accounts";
const USER = `${ACCOUNTS}.User`;
const PROPERTIES = "org.freedesktop.DBus.Properties";
const USER_PATH = /^\/org\/freedesktop\/Accounts\/User[0-9]+$/;
export const DENIED = "System policy does not allow this change.";

export type ListedUser = AccountUser & { path: string };

/** The AccountsService calls the services make; the smokes run them against a fake. */
export type AccountsBackend = {
  /** People's accounts, with `self` set for `selfUid` (default: this process's uid). */
  list(selfUid?: number): Promise<ListedUser[]>;
  setRealName(user: string, name: string): Promise<void>;
  setIconFile(user: string, file: string): Promise<void>;
  setAccountType(user: string, type: AccountType): Promise<void>;
  setPasswordHash(user: string, hash: string): Promise<void>;
  /** The new account, as listed (its object path is where its password is set). */
  createUser(username: string, realName: string, type: AccountType): Promise<ListedUser>;
  deleteUser(uid: number, removeFiles: boolean): Promise<void>;
  dispose(): Promise<void>;
};

/** A fixed failure for an AccountsService error; its own text never leaves. */
export function accountsFailure(error: unknown): SettingsServiceError {
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

/** Real AccountsService over the system bus, connected on first use. */
export async function createAccountsServiceBackend(
  options: {
    connect?: () => Promise<SessionBus>;
    selfUid?: number;
    timeoutMs?: number;
    /** Account creation and deletion run useradd/userdel; allow them longer. */
    changeTimeoutMs?: number;
  } = {},
): Promise<AccountsBackend> {
  const timeoutMs = options.timeoutMs ?? 5000;
  const changeTimeoutMs = options.changeTimeoutMs ?? 25_000;
  const ownUid = options.selfUid ?? process.getuid?.() ?? -1;
  let bus: SessionBus | null = null;
  const connection = async () => {
    if (bus) return bus;
    const next = await (options.connect
      ? options.connect()
      : SessionBus.connect(SYSTEM_BUS_ADDRESS, { timeoutMs }));
    next.onDisconnect(() => {
      if (bus === next) bus = null;
    });
    bus = next;
    return next;
  };
  const call = async (
    objectPath: string,
    iface: string,
    member: string,
    signature = "",
    body: unknown[] = [],
    change = false,
  ) => {
    try {
      return await (
        await connection()
      ).call(
        { destination: ACCOUNTS, path: objectPath, interface: iface, member, signature, body },
        { timeoutMs: change ? changeTimeoutMs : timeoutMs },
      );
    } catch (error) {
      throw accountsFailure(error);
    }
  };
  const change = (
    objectPath: string,
    iface: string,
    member: string,
    signature: string,
    body: unknown[],
  ) => call(objectPath, iface, member, signature, body, true);
  const objectPath = (value: unknown): string => {
    if (typeof value !== "string" || !USER_PATH.test(value))
      throw new SettingsServiceError("failed", "The accounts service sent an invalid reply.");
    return value;
  };
  const read = async (userPath: string, selfUid: number): Promise<ListedUser | null> => {
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
    async list(selfUid = ownUid) {
      const listed = await call(ACCOUNTS_PATH, ACCOUNTS, "ListCachedUsers");
      const paths = listed.body?.[0];
      if (!Array.isArray(paths) || paths.length > 256) throw new Error("Invalid account list");
      const all = new Set(paths.map(objectPath));
      if (selfUid >= 0) {
        // The session user may be absent from the cache (never logged in through a DM).
        const found = await call(ACCOUNTS_PATH, ACCOUNTS, "FindUserById", "x", [BigInt(selfUid)]);
        all.add(objectPath(found.body?.[0]));
      }
      const users = (await Promise.all([...all].map((user) => read(user, selfUid)))).filter(
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
      const user = await read(objectPath(created.body?.[0]), -1);
      if (!user) throw new SettingsServiceError("failed", "The new account could not be read.");
      return user;
    },
    async deleteUser(uid, removeFiles) {
      await change(ACCOUNTS_PATH, ACCOUNTS, "DeleteUser", "xb", [BigInt(uid), removeFiles]);
    },
    async dispose() {
      bus?.close();
      bus = null;
    },
  };
}
