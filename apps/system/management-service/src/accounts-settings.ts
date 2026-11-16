/**
 * Users & login: AccountsService on the system bus, exported to Settings as org.moire.Accounts1.
 *
 * Security model (docs/settings-redesign.md, "Time, region & accounts backend";
 * docs/polkit-agent.md, "One prompt per change"):
 * - This service reads the account list and changes only the session user's own account: name
 *   and picture (polkit allows an active, local session that outright,
 *   nix/moire-settings.rules) and password (through `passwd`, whose PAM stack checks the
 *   current password; no polkit grant covers it). None of its calls can raise a prompt.
 * - Administrator changes (add, delete, account type, another user's password) are not here.
 *   Settings calls moire-accounts (`org.moire.AccountAdmin1`, account-admin.ts) itself, which
 *   asks polkit once per change about Settings, so the prompt names Settings and a process that
 *   is not Settings can't borrow this service's name for one.
 * - New passwords never reach a log, argv or the environment.
 */
import fs from "node:fs";
import path from "node:path";
import type { SessionBus, DbusMethodContext } from "@moire/dbus";
import { SettingsServiceError } from "@moire/system-management/settings-service";
import {
  ACCOUNTS_SETTINGS_INTERFACE,
  ACCOUNTS_SETTINGS_PATH,
  MAX_ICON_BYTES,
  MIN_PASSWORD_LENGTH,
  passwordProblem,
  realNameProblem,
  type AccountsStatus,
} from "@moire/system-management/accounts-settings";
import {
  createPasswordThrottle,
  type OwnPasswordChanger,
} from "@moire/system-management/password-check";
import { accountsFailure, type AccountsBackend, type ListedUser } from "./accounts-service";

export { createAccountsServiceBackend } from "./accounts-service";

const STALE_MS = 15_000;
/** Another account: moire-accounts' job, through Settings (above). */
const OWN_ONLY = "Only your own name and picture can be changed here.";

type Ready = Extract<AccountsStatus, { kind: "ready" }>;

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
};

/** Export org.moire.Accounts1 on the already-owned session name. */
export function attachAccountsSettings(bus: SessionBus, options: AccountsSettingsOptions) {
  const { backend, changeOwnPassword } = options;
  const now = options.now ?? Date.now;
  const throttle = options.throttle ?? createPasswordThrottle();
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
  /** The session user's own account, never anyone else's. */
  const own = (uidValue: unknown): ListedUser => {
    const user = target(uidValue);
    if (!user.self) throw failure("invalid", OWN_ONLY);
    return user;
  };
  const newPassword = (password: unknown): string => {
    const value = typeof password === "string" ? password : "";
    const problem = passwordProblem(value);
    if (problem) throw failure("invalid", problem);
    return value;
  };

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
        const user = own(body[0]);
        const name = String(body[1]).trim();
        const problem = realNameProblem(name);
        if (problem) throw failure("invalid", problem);
        await backend.setRealName(user.path, name);
      }),
      SetIcon: method("us", "", async ({ body }) => {
        await ready();
        const user = own(body[0]);
        const file = String(body[1]);
        // AccountsService copies the file into its icon store, reading it as this user.
        const icon = file ? checkIconFile(file) : "";
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
    },
  });
  return {
    async dispose() {
      unexport();
      await backend.dispose();
    },
  };
}
