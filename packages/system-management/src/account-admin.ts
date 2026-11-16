/**
 * Administrator changes to accounts: moire-accounts (`org.moire.AccountAdmin1` on the system
 * bus), called by Settings itself (docs/polkit-agent.md, "One prompt per change").
 *
 * - **One prompt per change.** moire-accounts asks polkit once, for
 *   `org.moire.accounts.administer`, about the calling connection, then makes every
 *   AccountsService call the change needs under its own grant.
 * - **The caller is polkit's subject**, so the prompt names the app that asked (Settings),
 *   from the kernel's pid for this connection, and the compositor keeps the reason for a
 *   dismissal for this process. `TakeDismissal` is asked from this process's session-bus
 *   connection: `refused` (turned away unseen) is said calmly; everything else is `cancelled`.
 * - **New passwords** go as UTF-8 bytes in the method body, never a log, argv or environment.
 *   moire-accounts hashes them and wipes its copy; this side wipes the buffer it made. The
 *   string the form holds is the form's (docs/polkit-agent.md, open question 6).
 */
import { ALLOW_INTERACTIVE_AUTHORIZATION, SessionBus } from "@moire/dbus";
import {
  PROMPT_CANCELLED,
  PROMPT_REFUSED,
  remoteSettingsFailure,
  settingsFailure,
  type SettingsResult,
} from "./settings-service";
import type { AccountType, NewAccount } from "./accounts-settings";
import type { PromptDismissalLookup } from "./prompt-outcome";

export const ACCOUNT_ADMIN_BUS = "org.moire.AccountAdmin1";
export const ACCOUNT_ADMIN_PATH = "/org/moire/AccountAdmin1";
export const ACCOUNT_ADMIN_INTERFACE = "org.moire.AccountAdmin1";
/** The one polkit action moire-accounts checks per change (nix/moire-accounts.policy). */
export const ACCOUNT_ADMIN_ACTION = "org.moire.accounts.administer";
export const SYSTEM_BUS_ADDRESS = "unix:path=/run/dbus/system_bus_socket";
/**
 * How long a change may wait: the prompt gives up after 120 s idle, moire-accounts withdraws
 * its polkit question after 140 s, and the AccountsService calls follow.
 */
export const ACCOUNT_ADMIN_TIMEOUT_MS = 170_000;

export type AccountAdmin = {
  addUser(account: NewAccount): Promise<SettingsResult<{ uid: number }>>;
  deleteUser(uid: number, options: { keepHome: boolean }): Promise<SettingsResult>;
  setAccountType(uid: number, accountType: AccountType): Promise<SettingsResult>;
  setPassword(uid: number, password: string): Promise<SettingsResult>;
  dispose(): Promise<void>;
};

const FALLBACK = "The account change did not complete.";

export function createAccountAdminClient(
  options: {
    /** The system bus; by default connected on first use, and again after it drops. */
    connect?: () => Promise<SessionBus>;
    /** Why the compositor's prompt dismissed this process's request. Without it: `cancelled`. */
    promptDismissal?: PromptDismissalLookup;
    timeoutMs?: number;
  } = {},
): AccountAdmin {
  const timeoutMs = options.timeoutMs ?? ACCOUNT_ADMIN_TIMEOUT_MS;
  let bus: SessionBus | null = null;
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
  const run = async <T = undefined>(
    member: string,
    signature: string,
    body: unknown[],
    map: (reply: unknown[]) => T = () => undefined as T,
  ): Promise<SettingsResult<T>> => {
    let failure;
    try {
      const reply = await (
        await connection()
      ).call(
        {
          destination: ACCOUNT_ADMIN_BUS,
          path: ACCOUNT_ADMIN_PATH,
          interface: ACCOUNT_ADMIN_INTERFACE,
          member,
          signature,
          body,
          // This caller waits for the prompt; without the flag polkit is asked with no prompt.
          flags: ALLOW_INTERACTIVE_AUTHORIZATION,
        },
        { timeoutMs },
      );
      return { ok: true, value: map(reply.body ?? []) };
    } catch (error) {
      failure = remoteSettingsFailure(ACCOUNT_ADMIN_INTERFACE, error, FALLBACK);
      if (failure.message.startsWith("The system settings service"))
        failure = settingsFailure("unavailable", "The accounts service is not running.");
    }
    if (failure.code !== "cancelled") return failure;
    // Polkit says only "dismissed"; the compositor says why, for this process's own request.
    const reason = await options.promptDismissal?.(ACCOUNT_ADMIN_ACTION).catch(() => null);
    return reason === "refused"
      ? settingsFailure("refused", PROMPT_REFUSED)
      : settingsFailure("cancelled", PROMPT_CANCELLED);
  };
  /** The password as bytes for the body, wiped once the call is written. */
  const withPassword = async <T>(
    password: string,
    call: (bytes: Buffer) => Promise<SettingsResult<T>>,
  ) => {
    const bytes = Buffer.from(password, "utf8");
    try {
      return await call(bytes);
    } finally {
      bytes.fill(0);
    }
  };
  return {
    addUser: (account) =>
      withPassword(account.password, (bytes) =>
        run(
          "AddUser",
          "ssbay",
          [
            account.username,
            account.realName.trim(),
            account.accountType === "administrator",
            bytes,
          ],
          ([uid]) => {
            if (typeof uid !== "number" || !Number.isInteger(uid) || uid < 0)
              throw new Error("Invalid uid");
            return { uid };
          },
        ),
      ),
    deleteUser: (uid, { keepHome }) => run("DeleteUser", "ub", [uid, !keepHome]),
    setAccountType: (uid, accountType) =>
      run("SetAccountType", "ub", [uid, accountType === "administrator"]),
    setPassword: (uid, password) =>
      withPassword(password, (bytes) => run("SetPassword", "uay", [uid, bytes])),
    async dispose() {
      bus?.close();
      bus = null;
    },
  };
}
