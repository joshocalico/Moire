/**
 * moire-accounts: administrator changes to people's accounts, `org.moire.AccountAdmin1` on the
 * system bus (docs/polkit-agent.md, "One prompt per change"). It runs as its own unprivileged
 * account, `moire-accounts`, never root.
 *
 * - **One polkit check per change.** Each method asks polkit once, for
 *   `org.moire.accounts.administer`, about the calling connection. nix/moire-admin.rules answers
 *   "an administrator's password" (every time, never kept) for active, local sessions, and NO
 *   for the greeter and everyone else. Then it makes every AccountsService call the change
 *   needs under its own grant: nix/moire-accounts.rules gives the `moire-accounts` account, and
 *   no one else, `org.freedesktop.accounts.user-administration`. AccountsService's calls are
 *   sent without interaction, so they can never raise a second prompt.
 * - **The caller is polkit's subject**, so the prompt names the app that asked, from the
 *   kernel's pid for the caller's connection, and the compositor keeps a dismissal's reason
 *   for that process (docs/polkit-agent.md, "Why a request was dismissed"). This service adds
 *   nothing a caller couldn't get from AccountsService directly with a prompt per call: it
 *   bundles one change's calls behind one prompt, and refuses more than AccountsService does.
 * - **Arguments are checked before the prompt**, so nobody types a password for a change that
 *   would be refused. Only people's accounts (uid ≥ 1000, local, a login shell, not a system
 *   account) can be changed, never the caller's own password or account, and never the last
 *   administrator away.
 * - **Interaction** only for a caller that set D-Bus's ALLOW_INTERACTIVE_AUTHORIZATION flag
 *   (and so waits); anyone else gets polkit's answer without a prompt. A dismissal is the fixed
 *   error `cancelled`; the caller asks the compositor why.
 * - **Passwords** arrive as UTF-8 bytes (`ay`), are checked and hashed (SHA-512 crypt) without
 *   ever becoming a JS string, and the buffer is wiped when the call ends. Only the hash goes to
 *   AccountsService. Nothing about a password is logged; log lines carry a fixed code and uids.
 */
import {
  ALLOW_INTERACTIVE_AUTHORIZATION,
  variant,
  type DbusMethodContext,
  type SessionBus,
} from "@moire/dbus";
import {
  PROMPT_CANCELLED,
  SettingsServiceError,
  type SettingsErrorCode,
} from "@moire/system-management/settings-service";
import {
  ACCOUNT_ADMIN_ACTION,
  ACCOUNT_ADMIN_INTERFACE,
  ACCOUNT_ADMIN_PATH,
} from "@moire/system-management/account-admin";
import {
  passwordBytesProblem,
  realNameProblem,
  usernameProblem,
  type AccountType,
} from "@moire/system-management/accounts-settings";
import { DENIED, accountsFailure, type AccountsBackend, type ListedUser } from "./accounts-service";

/** People's accounts start here (NixOS's normal users; moire-dm's MIN_USER_UID). */
export const MIN_USER_UID = 1000;

export type PolkitAnswer = "yes" | "no" | "dismissed";

export type AccountAdminDeps = Readonly<{
  /** The bus's own answer for who owns a connection (GetConnectionUnixUser). */
  callerUid: (sender: string) => Promise<number>;
  /**
   * Polkit's answer for `org.moire.accounts.administer` and the calling connection. With
   * `interactive`, polkit may raise its password prompt and this waits for it.
   */
  authorize: (sender: string, interactive: boolean) => Promise<PolkitAnswer>;
  /** AccountsService as `moire-accounts`, which polkit lets administer accounts. */
  backend: AccountsBackend;
  /** A crypt(3) hash of the password bytes; the bytes are the caller's to wipe. */
  hash: (password: Buffer) => string;
  log: (line: string) => void;
}>;

const POLKIT = "org.freedesktop.PolicyKit1";
const AUTHORITY = {
  destination: POLKIT,
  path: "/org/freedesktop/PolicyKit1/Authority",
  interface: `${POLKIT}.Authority`,
};
/** CheckAuthorization flag: polkit may ask the user, through their session's agent. */
const ALLOW_USER_INTERACTION = 1;
/**
 * The prompt gives up after 120 s without input (docs/polkit-agent.md); Settings waits 170 s
 * for this service. In between, so the answer still has someone to go to.
 */
export const INTERACTIVE_CHECK_MS = 140_000;

/**
 * Polkit's CheckAuthorization for `org.moire.accounts.administer`, about the calling connection
 * (`system-bus-name`: polkit takes its pid and uid from the bus daemon, never from us). A check
 * nobody answers in time is withdrawn and reads as dismissed.
 */
export function polkitAuthorizer(
  bus: SessionBus,
  options: { interactiveTimeoutMs?: number } = {},
): AccountAdminDeps["authorize"] {
  const interactiveTimeoutMs = options.interactiveTimeoutMs ?? INTERACTIVE_CHECK_MS;
  let checks = 0;
  return async (sender, interactive) => {
    const cancellation = `moire-accounts-${++checks}`;
    let reply;
    try {
      reply = await bus.call(
        {
          ...AUTHORITY,
          member: "CheckAuthorization",
          signature: "(sa{sv})sa{ss}us",
          body: [
            ["system-bus-name", { name: variant("s", sender) }],
            ACCOUNT_ADMIN_ACTION,
            {},
            interactive ? ALLOW_USER_INTERACTION : 0,
            cancellation,
          ],
        },
        { timeoutMs: interactive ? interactiveTimeoutMs : 10_000 },
      );
    } catch (error) {
      if (!(error instanceof Error) || !/timed out/i.test(error.message)) throw error;
      // Nobody answered in time: withdraw the question, so no prompt outlives this call.
      void bus
        .call({
          ...AUTHORITY,
          member: "CancelCheckAuthorization",
          signature: "s",
          body: [cancellation],
        })
        .catch(() => {});
      return "dismissed";
    }
    const result = reply.signature === "(bba{ss})" ? reply.body?.[0] : null;
    if (!Array.isArray(result)) return "no";
    if (result[0] === true) return "yes";
    const details = result[2];
    return details && typeof details === "object" && "polkit.dismissed" in details
      ? "dismissed"
      : "no";
  };
}

type Change = Readonly<{
  /** People's accounts, with the caller's marked `self`. */
  users: readonly ListedUser[];
  /** Another person's account, by uid. */
  other(uid: unknown): ListedUser;
  administrators(): number;
  /** The one polkit check for this call; throws unless authorized. */
  authorize(): Promise<void>;
}>;

function failure(code: SettingsErrorCode, message: string) {
  return new SettingsServiceError(code, message);
}

function password(value: unknown): Buffer {
  if (!Buffer.isBuffer(value)) throw failure("invalid", "Invalid arguments.");
  const problem = passwordBytesProblem(value);
  if (problem) throw failure("invalid", problem);
  return value;
}

export function attachAccountAdmin(bus: SessionBus, deps: AccountAdminDeps): () => void {
  /** One change at a time per person, so one prompt can't hide behind another of theirs. */
  const busy = new Set<number>();

  const method = (
    inSignature: string,
    outSignature: string,
    handler: (change: Change, body: unknown[]) => Promise<unknown[] | void>,
  ) => ({
    inSignature,
    outSignature,
    handler: async ({ message, body }: DbusMethodContext) => {
      try {
        if ((message.signature ?? "") !== inSignature)
          throw failure("invalid", "Invalid arguments.");
        const sender = message.sender;
        if (!sender) throw failure("invalid", "Invalid caller.");
        let uid: number;
        try {
          uid = await deps.callerUid(sender);
        } catch {
          throw failure("unavailable", "Your account could not be identified.");
        }
        // System accounts (the greeter among them) have no business here; the rule refuses
        // them too.
        if (!Number.isInteger(uid) || uid < MIN_USER_UID) throw failure("permission", DENIED);
        if (busy.has(uid)) throw failure("busy", "Another account change is running.");
        busy.add(uid);
        try {
          const users = await deps.backend.list(uid);
          let asked = false;
          const change: Change = {
            users,
            other(value) {
              const found = users.find((user) => user.uid === value);
              if (!found) throw failure("invalid", "That account no longer exists.");
              if (found.self)
                throw failure("invalid", "Change your own account from your own settings.");
              return found;
            },
            administrators: () =>
              users.filter((user) => user.accountType === "administrator").length,
            async authorize() {
              // One question per call, by construction.
              if (asked) throw failure("failed", "The account change did not complete.");
              asked = true;
              const interactive = ((message.flags ?? 0) & ALLOW_INTERACTIVE_AUTHORIZATION) !== 0;
              let answer: PolkitAnswer;
              try {
                answer = await deps.authorize(sender, interactive);
              } catch {
                throw failure("unavailable", "The system policy could not be checked.");
              }
              if (answer === "dismissed") throw failure("cancelled", PROMPT_CANCELLED);
              if (answer !== "yes") throw failure("permission", DENIED);
            },
          };
          const reply = await handler(change, body);
          return reply ? { body: reply } : {};
        } finally {
          busy.delete(uid);
        }
      } catch (error) {
        // Only fixed messages leave: never an exception that might quote an argument.
        const known = error instanceof SettingsServiceError ? error : accountsFailure(error);
        throw known.remote(ACCOUNT_ADMIN_INTERFACE);
      } finally {
        for (const value of body) if (Buffer.isBuffer(value)) value.fill(0);
      }
    },
  });

  return bus.exportObject(ACCOUNT_ADMIN_PATH, {
    name: ACCOUNT_ADMIN_INTERFACE,
    methods: {
      // A new account with its password: one prompt for the create and the password.
      AddUser: method("ssbay", "u", async (change, body) => {
        const [name, rawRealName, administrator] = body;
        if (typeof name !== "string" || typeof rawRealName !== "string")
          throw failure("invalid", "Invalid arguments.");
        const realName = rawRealName.trim();
        const problem = usernameProblem(name) ?? realNameProblem(realName);
        if (problem) throw failure("invalid", problem);
        const secret = password(body[3]);
        if (change.users.some((user) => user.username === name))
          throw failure("invalid", "That username is taken.");
        const type: AccountType = administrator === true ? "administrator" : "standard";
        await change.authorize();
        // Hashed first, so a failure here creates nothing.
        const hash = deps.hash(secret);
        const created = await deps.backend.createUser(name, realName, type);
        try {
          await deps.backend.setPasswordHash(created.path, hash);
        } catch {
          // Never leave an account behind that the person didn't get a password for.
          const removed = await deps.backend.deleteUser(created.uid, true).then(
            () => true,
            () => false,
          );
          deps.log(`moire-accounts: code=add-rolled-back uid=${created.uid} removed=${removed}`);
          throw failure(
            "failed",
            removed
              ? "The account could not be created."
              : "The account was created without a password. Set its password before signing in.",
          );
        }
        deps.log(`moire-accounts: code=user-added uid=${created.uid} type=${type}`);
        return [created.uid];
      }),
      DeleteUser: method("ub", "", async (change, body) => {
        const user = change.other(body[0]);
        if (user.accountType === "administrator" && change.administrators() <= 1)
          throw failure("invalid", "Keep at least one administrator.");
        const removeFiles = body[1] === true;
        await change.authorize();
        await deps.backend.deleteUser(user.uid, removeFiles);
        deps.log(`moire-accounts: code=user-deleted uid=${user.uid} files=${removeFiles}`);
      }),
      // Anyone's type, the caller's own included (a standard user may be promoted with an
      // administrator's password), but never the last administrator away.
      SetAccountType: method("ub", "", async (change, body) => {
        const user = change.users.find((listed) => listed.uid === body[0]);
        if (!user) throw failure("invalid", "That account no longer exists.");
        const type: AccountType = body[1] === true ? "administrator" : "standard";
        if (
          type === "standard" &&
          user.accountType === "administrator" &&
          change.administrators() <= 1
        )
          throw failure("invalid", "Keep at least one administrator.");
        await change.authorize();
        await deps.backend.setAccountType(user.path, type);
        deps.log(`moire-accounts: code=type-set uid=${user.uid} type=${type}`);
      }),
      // Another person's password. One's own goes through passwd, with the current password.
      SetPassword: method("uay", "", async (change, body) => {
        const user = change.other(body[0]);
        const secret = password(body[1]);
        await change.authorize();
        await deps.backend.setPasswordHash(user.path, deps.hash(secret));
        deps.log(`moire-accounts: code=password-set uid=${user.uid}`);
      }),
    },
  });
}
