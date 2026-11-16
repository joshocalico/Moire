/**
 * Users & login settings. The account list and the session user's own name, picture and
 * password go through the management service, which talks to AccountsService
 * (`org.freedesktop.Accounts`) on the system bus and never raises a prompt.
 *
 * - **Administrator changes** (add, delete, account type, another user's password) go from this
 *   process straight to moire-accounts (`account-admin.ts`), which asks polkit once per change
 *   about this process. The system's password prompt (drawn by the compositor,
 *   docs/polkit-agent.md) therefore names the app that asked. The call resolves when the
 *   prompt does, up to `PROMPT_TIMEOUT_MS`. A dismissed prompt is `cancelled`; one the system
 *   turned away without showing it (a pause after cancels, a full queue) is `refused`. No
 *   password for it passes through here.
 * - **New passwords** (data entry) travel only in D-Bus method bodies; they are never logged,
 *   stored or put on a command line.
 */
import { SessionBus } from "@moire/dbus";
import type { AccountAdmin } from "./account-admin";
import {
  bounded,
  PROMPT_CANCELLED,
  PROMPT_REFUSED,
  observeSettingsService,
  remoteSettingsFailure,
  settingsFailure,
  type ServiceClientState,
  type SettingsErrorCode,
  type SettingsResult,
} from "./settings-service";

export const ACCOUNTS_SETTINGS_PATH = "/org/moire/Accounts1";
export const ACCOUNTS_SETTINGS_INTERFACE = "org.moire.Accounts1";

export type AccountType = "standard" | "administrator";

export type AccountUser = {
  uid: number;
  username: string;
  /** Full name; empty when unset (show the username). */
  realName: string;
  /** Absolute path of the avatar AccountsService keeps, or null for none. */
  iconFile: string | null;
  accountType: AccountType;
  /** Password login disabled. */
  locked: boolean;
  /** Last login from wtmp, or null if never. */
  lastLoginMs: number | null;
  /** The user running this session. */
  self: boolean;
};

export type AccountsPolicy = {
  /**
   * This session's user is an administrator (in `wheel`), so the password prompt asks for their
   * own password. A standard user's prompt asks for an administrator's.
   */
  canAdminister: boolean;
  minPasswordLength: number;
};

export type AccountsStatus =
  | { kind: "unavailable" | "error"; message: string }
  | { kind: "ready"; selfUid: number; users: readonly AccountUser[]; policy: AccountsPolicy };

export const MIN_PASSWORD_LENGTH = 8;
/** unix_chkpwd reads at most 512 bytes; stay well inside it. */
export const MAX_PASSWORD_BYTES = 256;
export const MAX_ICON_BYTES = 1024 * 1024;

/** Login names useradd accepts and the greeter shows: lower case, starting with a letter. */
export function usernameProblem(username: string): string | null {
  if (!/^[a-z][a-z0-9_-]{0,30}$/.test(username))
    return "Use 1–31 lower-case letters, digits, '-' or '_', starting with a letter.";
  if (["root", "nobody", "greeter", "polkituser", "messagebus"].includes(username))
    return "That name is reserved by the system.";
  return null;
}

/** /etc/passwd's GECOS field cannot hold ':', ',' or control characters. */
export function realNameProblem(name: string): string | null {
  if (name.length > 128) return "Use at most 128 characters.";
  if (/[:,\p{Cc}\p{Cf}]/u.test(name)) return "Names cannot contain ':', ',' or control characters.";
  return null;
}

export function passwordProblem(password: string): string | null {
  if ([...password].length < MIN_PASSWORD_LENGTH)
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) return "That password is too long.";
  if (/[\0\n\r]/.test(password)) return "Passwords cannot contain line breaks.";
  return null;
}

/**
 * `passwordProblem` for a password held as UTF-8 bytes, without making a string of it (the
 * account mechanism never turns a password into a JS string). Malformed UTF-8 is refused.
 */
export function passwordBytesProblem(bytes: Uint8Array): string | null {
  if (bytes.length > MAX_PASSWORD_BYTES) return "That password is too long.";
  let characters = 0;
  for (let index = 0; index < bytes.length;) {
    const lead = bytes[index]!;
    if (lead === 0 || lead === 0x0a || lead === 0x0d)
      return "Passwords cannot contain line breaks.";
    const length =
      lead < 0x80 ? 1 : lead < 0xc2 ? 0 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : lead < 0xf5 ? 4 : 0;
    if (length === 0 || index + length > bytes.length) return "That password can't be used.";
    for (let next = 1; next < length; next++) {
      const byte = bytes[index + next]!;
      // The second byte's range excludes overlong forms, surrogates and code points past U+10FFFF.
      const low = next > 1 ? 0x80 : lead === 0xe0 ? 0xa0 : lead === 0xf0 ? 0x90 : 0x80;
      const high = next > 1 ? 0xbf : lead === 0xed ? 0x9f : lead === 0xf4 ? 0x8f : 0xbf;
      if (byte < low || byte > high) return "That password can't be used.";
    }
    index += length;
    characters++;
  }
  if (characters < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  return null;
}

function uid(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffff_fffe)
    throw new Error("Invalid uid");
  return value;
}

export function parseAccountsStatus(value: unknown): AccountsStatus {
  if (!value || typeof value !== "object") throw new Error("Invalid accounts status");
  const raw = value as Record<string, unknown>;
  if (raw.kind === "unavailable" || raw.kind === "error")
    return { kind: raw.kind, message: bounded(raw.message, 512, "accounts message") };
  if (raw.kind !== "ready" || !Array.isArray(raw.users) || raw.users.length > 256)
    throw new Error("Invalid accounts status");
  const policy = raw.policy as Record<string, unknown> | undefined;
  if (
    !policy ||
    typeof policy.canAdminister !== "boolean" ||
    typeof policy.minPasswordLength !== "number"
  )
    throw new Error("Invalid accounts policy");
  const users = raw.users.map((item: Record<string, unknown>): AccountUser => {
    const iconFile = item?.iconFile === null ? null : bounded(item?.iconFile, 4096, "icon");
    if (iconFile !== null && !iconFile.startsWith("/")) throw new Error("Invalid icon path");
    if (item.accountType !== "standard" && item.accountType !== "administrator")
      throw new Error("Invalid account type");
    const last = item.lastLoginMs;
    if (last !== null && (typeof last !== "number" || !Number.isFinite(last) || last < 0))
      throw new Error("Invalid last login");
    if (typeof item.locked !== "boolean" || typeof item.self !== "boolean")
      throw new Error("Invalid account flags");
    return {
      uid: uid(item.uid),
      username: bounded(item.username, 64, "username"),
      realName: bounded(item.realName, 256, "real name"),
      iconFile,
      accountType: item.accountType,
      locked: item.locked,
      lastLoginMs: last,
      self: item.self,
    };
  });
  return {
    kind: "ready",
    selfUid: uid(raw.selfUid),
    users,
    policy: {
      canAdminister: policy.canAdminister,
      minPasswordLength: policy.minPasswordLength,
    },
  };
}

export type AccountsSettingsState = ServiceClientState<AccountsStatus>;

export type NewAccount = {
  username: string;
  realName: string;
  accountType: AccountType;
  password: string;
};

export type AccountsSettingsClient = {
  readonly state: AccountsSettingsState;
  subscribe(listener: (state: AccountsSettingsState) => void): () => void;
  refresh(): Promise<SettingsResult>;
  /** The session user's own name; no prompt. */
  setRealName(uid: number, realName: string): Promise<SettingsResult>;
  /** The session user's own picture: an image path (≤ 1 MiB PNG or JPEG) AccountsService
   *  copies, or null to clear. No prompt. */
  setIcon(uid: number, path: string | null): Promise<SettingsResult>;
  /** The session user's own password; the current one is verified first. */
  changePassword(current: string, next: string): Promise<SettingsResult>;
  /** Raises the password prompt: set another user's password. */
  setPassword(uid: number, next: string): Promise<SettingsResult>;
  /** Raises the password prompt. */
  createUser(account: NewAccount): Promise<SettingsResult<{ uid: number }>>;
  /** Raises the password prompt. Never the session user. */
  deleteUser(uid: number, options: { keepHome: boolean }): Promise<SettingsResult>;
  /** Raises the password prompt. The last administrator cannot be demoted. */
  setAccountType(uid: number, accountType: AccountType): Promise<SettingsResult>;
  dispose(): Promise<void>;
};

const FALLBACK = "The account change did not complete.";
/**
 * How long a client waits for a call that may raise the password prompt: longer than the
 * service's own 150 s, which is longer than the prompt's 120 s idle limit.
 */
export const PROMPT_TIMEOUT_MS = 170_000;

function localProblem(...problems: (string | null)[]) {
  const problem = problems.find(Boolean);
  return problem ? Promise.resolve(settingsFailure("invalid", problem)) : null;
}

/** Another account's name or picture: Settings offers no way to, and nothing does it. */
const OWN_ONLY = "Only your own name and picture can be changed here.";

export async function observeAccountsSettings(
  bus: SessionBus,
  options: {
    /** Administrator changes (moire-accounts). Without it they are unavailable. */
    admin?: AccountAdmin;
  } = {},
): Promise<AccountsSettingsClient> {
  const observer = await observeSettingsService(bus, {
    path: ACCOUNTS_SETTINGS_PATH,
    iface: ACCOUNTS_SETTINGS_INTERFACE,
    parse: parseAccountsStatus,
    label: "account settings",
  });
  const run = async <T = undefined>(
    member: string,
    signature: string,
    body: unknown[],
    map: (reply: unknown[]) => T = () => undefined as T,
  ): Promise<SettingsResult<T>> => {
    try {
      return {
        ok: true,
        value: map(await observer.call(member, signature, body, PROMPT_TIMEOUT_MS)),
      };
    } catch (error) {
      return remoteSettingsFailure(ACCOUNTS_SETTINGS_INTERFACE, error, FALLBACK);
    }
  };
  const selfUid = () => {
    const state = observer.state;
    return state.kind === "ready" && state.status.kind === "ready" ? state.status.selfUid : null;
  };
  const ownOnly = (target: number) => localProblem(target === selfUid() ? null : OWN_ONLY);
  /** An administrator change through moire-accounts, then the list read again. */
  const admin = async <T>(
    change: (admin: AccountAdmin) => Promise<SettingsResult<T>>,
  ): Promise<SettingsResult<T>> => {
    if (!options.admin)
      return settingsFailure("unavailable", "Accounts can't be changed on this computer.");
    const result = await change(options.admin);
    if (result.ok) await run("Refresh", "", []);
    return result;
  };
  return {
    get state() {
      return observer.state;
    },
    subscribe: observer.subscribe,
    refresh: () => run("Refresh", "", []),
    setRealName: (target, name) =>
      localProblem(realNameProblem(name)) ??
      ownOnly(target) ??
      run("SetRealName", "us", [target, name.trim()]),
    setIcon: (target, path) =>
      localProblem(path === null || path.startsWith("/") ? null : "Choose an image file.") ??
      ownOnly(target) ??
      run("SetIcon", "us", [target, path ?? ""]),
    changePassword: (current, next) =>
      localProblem(
        current ? null : "Enter your current password.",
        passwordProblem(next),
        current === next ? "Choose a password different from the current one." : null,
      ) ?? run("ChangePassword", "ss", [current, next]),
    setPassword: (target, next) =>
      localProblem(passwordProblem(next)) ??
      admin((accounts) => accounts.setPassword(target, next)),
    createUser: (account) =>
      localProblem(
        usernameProblem(account.username),
        realNameProblem(account.realName),
        passwordProblem(account.password),
      ) ?? admin((accounts) => accounts.addUser(account)),
    deleteUser: (target, deletion) => admin((accounts) => accounts.deleteUser(target, deletion)),
    setAccountType: (target, accountType) =>
      admin((accounts) => accounts.setAccountType(target, accountType)),
    dispose: observer.dispose,
  };
}

export async function connectAccountsSettings(
  options: { admin?: AccountAdmin } = {},
): Promise<AccountsSettingsClient> {
  const bus = await SessionBus.connect();
  try {
    const client = await observeAccountsSettings(bus, options);
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
// Fake for UI smokes and the gallery. The fake's own (current) password is "correct horse".

/** Stands in for the system's password prompt: how it ended. `refused`: it never showed. */
export type FakePrompt = () => Promise<"authorized" | "cancelled" | "refused">;

/** The failure a fake reports for a prompt that did not authorize, as the service words it. */
export function fakePromptFailure(answer: "authorized" | "cancelled" | "refused") {
  if (answer === "cancelled") return settingsFailure("cancelled", PROMPT_CANCELLED);
  if (answer === "refused") return settingsFailure("refused", PROMPT_REFUSED);
  return null;
}

export type FakeAccountsSettings = AccountsSettingsClient & {
  emit(status: AccountsStatus): void;
  failNext(code: SettingsErrorCode): void;
  /** Method names only: arguments may hold passwords and are deliberately not recorded. */
  readonly calls: readonly string[];
};

export const FAKE_ACCOUNTS_PASSWORD = "correct horse";

export function createFakeAccountsSettingsClient(
  options: {
    status?: AccountsStatus;
    /** Asked for each change to another account; authorizes at once unless given. */
    prompt?: FakePrompt;
  } = {},
): FakeAccountsSettings {
  const prompt = options.prompt ?? (async () => "authorized" as const);
  let revision = 1;
  let status: AccountsStatus = options.status ?? {
    kind: "ready",
    selfUid: 1000,
    users: [
      {
        uid: 1000,
        username: "joshua",
        realName: "Joshua Steele",
        iconFile: null,
        accountType: "administrator",
        locked: false,
        lastLoginMs: Date.UTC(2026, 9, 10, 8, 0),
        self: true,
      },
      {
        uid: 1001,
        username: "guest",
        realName: "Guest",
        iconFile: null,
        accountType: "standard",
        locked: false,
        lastLoginMs: null,
        self: false,
      },
    ],
    policy: {
      canAdminister: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
    },
  };
  let state: AccountsSettingsState = { kind: "ready", owner: ":fake.1", revision, status };
  let failure: SettingsErrorCode | null = null;
  const listeners = new Set<(state: AccountsSettingsState) => void>();
  const calls: string[] = [];
  const emit = (next: AccountsStatus) => {
    status = next;
    state = { kind: "ready", owner: ":fake.1", revision: ++revision, status };
    for (const listener of [...listeners]) listener(state);
  };
  type Ready = Extract<AccountsStatus, { kind: "ready" }>;
  const step = async <T = undefined>(
    member: string,
    options: { admin?: boolean; target?: number },
    apply: (ready: Ready) => { status?: Ready; value?: T } | SettingsResult<T>,
  ): Promise<SettingsResult<T>> => {
    calls.push(member);
    if (failure) {
      const code = failure;
      failure = null;
      return settingsFailure(code, `Fake ${code}`);
    }
    if (status.kind !== "ready") return settingsFailure("unavailable", status.message);
    // One prompt per administrator change, as moire-accounts asks polkit once per call.
    const needsAdmin = options.admin === true;
    if (options.target !== undefined && !status.users.some((user) => user.uid === options.target))
      return settingsFailure("invalid", "That account no longer exists.");
    // Standard users are prompted too: an administrator answers for them.
    const refusal = needsAdmin ? fakePromptFailure(await prompt()) : null;
    if (refusal) return refusal;
    const outcome = apply(status);
    if ("ok" in outcome) return outcome;
    if (outcome.status) emit(outcome.status);
    return { ok: true, value: outcome.value as T };
  };
  const patchUser = (ready: Ready, target: number, patch: Partial<AccountUser>): Ready => ({
    ...ready,
    users: ready.users.map((user) => (user.uid === target ? { ...user, ...patch } : user)),
  });
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
    refresh: () => step("Refresh", {}, () => ({})),
    setRealName: (target, realName) =>
      localProblem(realNameProblem(realName)) ??
      step("SetRealName", { target }, (ready) =>
        target === ready.selfUid
          ? { status: patchUser(ready, target, { realName: realName.trim() }) }
          : settingsFailure("invalid", OWN_ONLY),
      ),
    setIcon: (target, path) =>
      step("SetIcon", { target }, (ready) =>
        target === ready.selfUid
          ? { status: patchUser(ready, target, { iconFile: path }) }
          : settingsFailure("invalid", OWN_ONLY),
      ),
    changePassword: (current, next) =>
      localProblem(passwordProblem(next)) ??
      step("ChangePassword", {}, () =>
        current === FAKE_ACCOUNTS_PASSWORD
          ? {}
          : settingsFailure("wrong_password", "That password is not correct."),
      ),
    setPassword: (target, next) =>
      localProblem(passwordProblem(next)) ??
      step("SetPassword", { target, admin: true }, () => ({})),
    createUser: (account) =>
      localProblem(
        usernameProblem(account.username),
        realNameProblem(account.realName),
        passwordProblem(account.password),
      ) ??
      step("CreateUser", { admin: true }, (ready) => {
        if (ready.users.some((user) => user.username === account.username))
          return settingsFailure("invalid", "That username is taken.");
        const created = Math.max(999, ...ready.users.map((user) => user.uid)) + 1;
        return {
          value: { uid: created },
          status: {
            ...ready,
            users: [
              ...ready.users,
              {
                uid: created,
                username: account.username,
                realName: account.realName.trim(),
                iconFile: null,
                accountType: account.accountType,
                locked: false,
                lastLoginMs: null,
                self: false,
              },
            ],
          },
        };
      }),
    deleteUser: (target) =>
      step("DeleteUser", { target, admin: true }, (ready) =>
        target === ready.selfUid
          ? settingsFailure("invalid", "You cannot delete the account you are using.")
          : { status: { ...ready, users: ready.users.filter((user) => user.uid !== target) } },
      ),
    setAccountType: (target, accountType) =>
      step("SetAccountType", { target, admin: true }, (ready) => {
        const admins = ready.users.filter((user) => user.accountType === "administrator");
        if (accountType === "standard" && admins.length === 1 && admins[0]!.uid === target)
          return settingsFailure("invalid", "Keep at least one administrator.");
        return { status: patchUser(ready, target, { accountType }) };
      }),
    async dispose() {
      listeners.clear();
    },
  };
}

export type { SettingsErrorCode, SettingsFailure, SettingsResult } from "./settings-service";
