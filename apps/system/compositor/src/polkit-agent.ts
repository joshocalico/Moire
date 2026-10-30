/**
 * Moire's polkit authentication agent (docs/polkit-agent.md).
 *
 * The compositor registers with polkitd for its own logind session before it starts any client,
 * exports `org.freedesktop.PolicyKit1.AuthenticationAgent` on the system bus, and answers
 * `BeginAuthentication` with a compositor-drawn secure prompt. A typed password goes to polkit's
 * own helper (polkit-helper.ts); the helper, not this process, tells polkitd who authenticated.
 *
 * Only the connection that owns `org.freedesktop.PolicyKit1` may call the agent. Nothing from a
 * request is logged except its validated action id: never the details, the cookie or an answer.
 */
import fs from "node:fs";
import {
  DbusRemoteError,
  SessionBus,
  variant,
  type DbusMessage,
  type DbusMethodResult,
} from "@moire/dbus";
import type {
  SecurePromptHandle,
  SecurePromptIdentity,
  SecurePromptRequest,
  SecurePromptVerdict,
  SecurePrompts,
} from "@moire/core";
import {
  createPasswordThrottle,
  type PasswordThrottle,
} from "@moire/system-management/password-check";
import { LOGIND_BUS, SYSTEM_BUS_ADDRESS } from "./logind-power";
import {
  createPolkitHelper,
  polkitAccountName,
  polkitCookie,
  type PolkitHelper,
} from "./polkit-helper";
import type { RequesterResolver } from "./polkit-requester";

export const POLKIT_AUTHORITY = "org.freedesktop.PolicyKit1";
const AUTHORITY_PATH = "/org/freedesktop/PolicyKit1/Authority";
const AUTHORITY_INTERFACE = "org.freedesktop.PolicyKit1.Authority";
export const POLKIT_AGENT_PATH = "/org/moire/PolicyKit1/AuthenticationAgent";
export const POLKIT_AGENT_INTERFACE = "org.freedesktop.PolicyKit1.AuthenticationAgent";
/** polkitd reads this error as "the user dismissed the prompt" (`polkit.dismissed`). */
export const POLKIT_CANCELLED = "org.freedesktop.PolicyKit1.Error.Cancelled";
export const POLKIT_FAILED = "org.freedesktop.PolicyKit1.Error.Failed";
const ACCESS_DENIED = "org.freedesktop.DBus.Error.AccessDenied";
const BEGIN_SIGNATURE = "sssa{ss}sa(sa{sv})";

const ACTION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;
const SESSION_ID = /^[A-Za-z0-9_-]{1,64}$/;
const LOCALE = /^[A-Za-z0-9_.@-]{1,64}$/;
const PID = /^[1-9][0-9]{0,6}$/;
const HEADLINE_MAX = 200;
const MAX_IDENTITIES = 8;
/** polkitd sends at most a group's members; anything larger is not a list a person picks from. */
const MAX_OFFERED_IDENTITIES = 256;
/** One visible prompt and three queued is the prompt's limit; this only bounds bookkeeping. */
const MAX_SESSIONS = 16;
const MIN_LOGIN_UID = 1000;
const NOBODY_UID = 65534;

export type PolkitAgentStatus = "starting" | "registered" | "agent-taken" | "unavailable";

/** The fixed set of log codes. A line is `polkit-agent: code=<code> action=<id or ->`. */
export type PolkitAgentLogCode =
  | "registered"
  | "agent-taken"
  | "register-failed"
  | "no-session"
  | "bus-lost"
  | "refused-sender"
  | "invalid-request"
  | "no-identity"
  | "begin"
  | "rejected"
  | "throttled"
  | "helper-unavailable"
  | "completed"
  | "cancelled"
  | "authority-cancelled"
  | "timed-out"
  | "locked"
  | "refused"
  | "failed";

export type PolkitAccount = {
  uid: number;
  username: string;
  displayName: string;
  shell: string;
};
/** The local account database, as polkitd itself reads it (passwd and group). */
export type PolkitAccounts = {
  users(): readonly PolkitAccount[];
  /** Account names listed as members of the group. */
  groupMembers(gid: number): readonly string[];
};

export function createFileAccounts(passwd = "/etc/passwd", group = "/etc/group"): PolkitAccounts {
  const rows = (file: string): string[][] => {
    try {
      return fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => line.split(":"));
    } catch {
      return [];
    }
  };
  return {
    users: () =>
      rows(passwd).flatMap((fields) => {
        const uid = Number(fields[2]);
        if (fields.length < 7 || !fields[0] || !/^[0-9]{1,10}$/.test(fields[2] ?? "")) return [];
        const displayName = (fields[4] ?? "")
          .split(",")[0]!
          .replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "")
          .trim()
          .slice(0, 128);
        return [{ uid, username: fields[0], displayName, shell: fields[6] ?? "" }];
      }),
    groupMembers: (gid) =>
      rows(group)
        .filter((fields) => fields.length >= 4 && fields[2] === String(gid))
        .flatMap((fields) => fields[3]!.split(",").filter(Boolean)),
  };
}

export type PolkitAgentOptions = {
  prompts: SecurePrompts;
  /** The session user's account name: preselected, and the test for `needsAdministrator`. */
  sessionUser: string;
  /** Kernel pid to a name for the prompt. Without one, prompts name no requester. */
  resolveRequester?: RequesterResolver;
  accounts?: PolkitAccounts;
  helper?: PolkitHelper;
  /** A system-bus connection. Called again after the connection drops. */
  connect?: () => Promise<SessionBus>;
  /** The pid whose logind session the agent registers for: this process. */
  pid?: number;
  locale?: string;
  timeoutMs?: number;
  /** First reconnect delay; it doubles up to `reconnectMaxMs`. */
  reconnectMs?: number;
  reconnectMaxMs?: number;
  now?: () => number;
  log?: (line: string) => void;
  onStatus?: (status: PolkitAgentStatus) => void;
};

export type PolkitAgent = {
  readonly status: PolkitAgentStatus;
  dispose(): Promise<void>;
};

type Session = {
  actionId: string;
  controller: AbortController;
  handle: SecurePromptHandle | null;
  accepted: boolean;
  authorityCancelled: boolean;
};

/** Polkit's message as plain, bounded text: no control or format characters, one line. */
export function polkitHeadline(message: unknown): string {
  const text = (typeof message === "string" ? message : "")
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return [...text].slice(0, HEADLINE_MAX).join("") || "Authentication is required";
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value)
    ? (value as Record<string, unknown>)
    : null;
}

function own(raw: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(raw, key) ? raw[key] : undefined;
}

/** A `u` inside an `a{sv}`. */
function id(details: unknown, key: string): number | null {
  const entry = record(own(record(details) ?? {}, key));
  const value = entry?.signature === "u" ? entry.value : null;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function defaultLocale(): string {
  const value = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || "C";
  return LOCALE.test(value) ? value : "C";
}

/**
 * Connect, export the agent object and register it. Resolves once the first attempt has ended,
 * whatever its result, so the caller can hold back its first client until then.
 */
export async function startPolkitAgent(options: PolkitAgentOptions): Promise<PolkitAgent> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const reconnectMs = options.reconnectMs ?? 1000;
  const reconnectMaxMs = options.reconnectMaxMs ?? 30_000;
  const now = options.now ?? Date.now;
  const accounts = options.accounts ?? createFileAccounts();
  const helper = options.helper ?? createPolkitHelper();
  const locale = options.locale ?? defaultLocale();
  const connect = options.connect ?? (() => SessionBus.connect(SYSTEM_BUS_ADDRESS, { timeoutMs }));
  const print = options.log ?? ((line: string) => console.log(line));
  const log = (code: PolkitAgentLogCode, actionId?: string) =>
    print(`polkit-agent: code=${code} action=${actionId ?? "-"}`);

  let status: PolkitAgentStatus = "starting";
  let disposed = false;
  let bus: SessionBus | null = null;
  /** The unique name that owns org.freedesktop.PolicyKit1, as the bus daemon reports it. */
  let authorityOwner: string | null = null;
  /** The authority owner the last registration attempt was made with. */
  let attemptedOwner: string | null = null;
  let subject: [string, Record<string, unknown>] | null = null;
  let registration: Promise<void> = Promise.resolve();
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectDelay = reconnectMs;
  const sessions = new Map<string, Session>();
  // Wrong passwords are counted per identity and across requests: five in a row pause that
  // identity's checks for a minute. pam_unix adds its own delay inside the helper.
  const throttles = new Map<string, PasswordThrottle>();

  const setStatus = (next: PolkitAgentStatus) => {
    if (status === next) return;
    status = next;
    options.onStatus?.(next);
  };
  /** The authority went away or changed: its cookies are dead, so every prompt closes. */
  const endSessions = () => {
    for (const session of sessions.values()) {
      session.authorityCancelled = true;
      session.controller.abort();
      session.handle?.cancel();
    }
  };

  const authorize = (message: DbusMessage) => {
    if (authorityOwner !== null && message.sender === authorityOwner) return;
    log("refused-sender");
    throw new DbusRemoteError(ACCESS_DENIED, "Only the polkit authority may call this agent");
  };

  /** Who may answer: local login accounts among polkit's identities, the session user first. */
  const identitiesFor = (offered: unknown): SecurePromptIdentity[] => {
    if (!Array.isArray(offered) || offered.length > MAX_OFFERED_IDENTITIES) return [];
    const users = accounts
      .users()
      .filter(
        (user) =>
          user.uid >= MIN_LOGIN_UID &&
          user.uid !== NOBODY_UID &&
          polkitAccountName(user.username) &&
          user.shell.startsWith("/") &&
          !/\/(?:nologin|false)$/.test(user.shell),
      );
    const found = new Map<string, SecurePromptIdentity>();
    const add = (user: PolkitAccount | undefined) => {
      if (user && !found.has(user.username))
        found.set(user.username, {
          account: user.username,
          displayName: user.displayName || user.username,
        });
    };
    for (const entry of offered) {
      if (!Array.isArray(entry)) continue;
      const [kind, details] = entry as [unknown, unknown];
      if (kind === "unix-user") {
        const uid = id(details, "uid");
        if (uid !== null) add(users.find((user) => user.uid === uid));
      } else if (kind === "unix-group") {
        // polkitd 127 expands groups itself; this covers an authority that does not.
        const gid = id(details, "gid");
        if (gid === null) continue;
        for (const name of accounts.groupMembers(gid))
          add(users.find((user) => user.username === name));
      }
    }
    const mine = found.get(options.sessionUser);
    const others = [...found.values()].filter((identity) => identity !== mine);
    return (mine ? [mine, ...others] : others).slice(0, MAX_IDENTITIES);
  };

  const throttleFor = (account: string): PasswordThrottle => {
    let throttle = throttles.get(account);
    if (!throttle) {
      throttle = createPasswordThrottle({ now, failureDelayMs: 0 });
      throttles.set(account, throttle);
    }
    return throttle;
  };

  const begin = async (message: DbusMessage, body: unknown[]): Promise<DbusMethodResult> => {
    authorize(message);
    const [actionId, text, , rawDetails, cookie, offered] = body;
    const details = record(rawDetails);
    if (
      message.signature !== BEGIN_SIGNATURE ||
      typeof actionId !== "string" ||
      !ACTION_ID.test(actionId) ||
      typeof cookie !== "string" ||
      !polkitCookie(cookie) ||
      !details ||
      sessions.has(cookie) ||
      sessions.size >= MAX_SESSIONS
    ) {
      log("invalid-request");
      throw new DbusRemoteError(POLKIT_FAILED, "Invalid authentication request");
    }
    const identities = identitiesFor(offered);
    if (identities.length === 0) {
      log("no-identity", actionId);
      throw new DbusRemoteError(POLKIT_FAILED, "No local account can answer this request");
    }

    // The subject is the process the authorization is for; the caller is the mechanism asking.
    const pidText = own(details, "polkit.subject-pid") ?? own(details, "polkit.caller-pid");
    const pid = typeof pidText === "string" && PID.test(pidText) ? Number(pidText) : null;
    const resolved = pid !== null ? (options.resolveRequester?.(pid) ?? null) : null;

    const session: Session = {
      actionId,
      controller: new AbortController(),
      handle: null,
      accepted: false,
      authorityCancelled: false,
    };
    const check = async (
      identity: SecurePromptIdentity,
      secret: Uint8Array,
    ): Promise<SecurePromptVerdict> => {
      const account = identities.find((entry) => entry.account === identity.account)?.account;
      if (!account || session.accepted || session.controller.signal.aborted) return "unavailable";
      const verdict = await throttleFor(account).run(async () => {
        const result = await helper({
          account,
          cookie,
          secret,
          signal: session.controller.signal,
        });
        return result === "accepted" ? "ok" : result === "rejected" ? "wrong" : "unavailable";
      });
      if (verdict === "ok") {
        session.accepted = true;
        return "accepted";
      }
      if (verdict === "wrong") {
        log("rejected", actionId);
        return "rejected";
      }
      if (verdict === "rate_limited") {
        log("throttled", actionId);
        return "throttled";
      }
      if (!session.controller.signal.aborted) log("helper-unavailable", actionId);
      return "unavailable";
    };
    const request: SecurePromptRequest = {
      kind: "password",
      headline: polkitHeadline(text),
      requester: resolved?.requester ?? null,
      identities,
      selected: 0,
      needsAdministrator: !identities.some((entry) => entry.account === options.sessionUser),
      details: [
        { label: "Action", value: actionId },
        ...(pid !== null ? [{ label: "Process ID", value: String(pid) }] : []),
      ],
      coolDownKey: `${resolved?.executable ?? "-"}\n${actionId}`,
      check,
    };

    sessions.set(cookie, session);
    try {
      session.handle = options.prompts.request(request);
      log("begin", actionId);
      const result = await session.handle.result;
      if (result.outcome === "completed" && session.accepted) {
        // The helper has already told polkitd who authenticated; an empty reply ends the call.
        log("completed", actionId);
        return {};
      }
      if (result.outcome === "completed" || result.outcome === "failed") {
        log("failed", actionId);
        throw new DbusRemoteError(POLKIT_FAILED, "The authentication prompt failed");
      }
      log(
        result.outcome === "cancelled" && session.authorityCancelled
          ? "authority-cancelled"
          : result.outcome,
        actionId,
      );
      throw new DbusRemoteError(POLKIT_CANCELLED, "Authentication was cancelled");
    } catch (error) {
      if (error instanceof DbusRemoteError) throw error;
      log("failed", actionId);
      throw new DbusRemoteError(POLKIT_FAILED, "The authentication prompt failed");
    } finally {
      sessions.delete(cookie);
      session.controller.abort();
    }
  };

  const cancel = (message: DbusMessage, body: unknown[]): DbusMethodResult => {
    authorize(message);
    const session = typeof body[0] === "string" ? sessions.get(body[0]) : undefined;
    if (message.signature === "s" && session) {
      // The requester went away: close without a message.
      session.authorityCancelled = true;
      session.controller.abort();
      session.handle?.cancel();
    }
    return {};
  };

  /** Register with the current authority owner, once per owner: no retry loop. */
  const register = (target: SessionBus): Promise<void> => {
    registration = registration.then(async () => {
      if (disposed || bus !== target || !subject) return;
      if (authorityOwner !== null && attemptedOwner === authorityOwner) return;
      try {
        const reply = await target.call(
          {
            destination: POLKIT_AUTHORITY,
            path: AUTHORITY_PATH,
            interface: AUTHORITY_INTERFACE,
            member: "RegisterAuthenticationAgent",
            signature: "(sa{sv})ss",
            body: [subject, locale, POLKIT_AGENT_PATH],
          },
          { timeoutMs },
        );
        attemptedOwner = reply.sender ?? authorityOwner;
        reconnectDelay = reconnectMs;
        log("registered");
        setStatus("registered");
      } catch (error) {
        attemptedOwner = authorityOwner;
        // Polkit allows one agent per session. Another one here means some process got in first
        // and may be collecting passwords: report it, never fall back or fight for the slot.
        const taken =
          error instanceof DbusRemoteError &&
          error.errorName === POLKIT_FAILED &&
          error.message.includes("already exists");
        log(taken ? "agent-taken" : "register-failed");
        setStatus(taken ? "agent-taken" : "unavailable");
      }
    });
    return registration;
  };

  const sessionId = async (target: SessionBus): Promise<string | null> => {
    try {
      const found = await target.call(
        {
          destination: LOGIND_BUS,
          path: "/org/freedesktop/login1",
          interface: "org.freedesktop.login1.Manager",
          member: "GetSessionByPID",
          signature: "u",
          body: [options.pid ?? process.pid],
        },
        { timeoutMs },
      );
      const path = found.body?.[0];
      if (typeof path !== "string" || !/^\/org\/freedesktop\/login1\/session\/\w+$/.test(path))
        return null;
      const reply = await target.call(
        {
          destination: LOGIND_BUS,
          path,
          interface: "org.freedesktop.DBus.Properties",
          member: "Get",
          signature: "ss",
          body: ["org.freedesktop.login1.Session", "Id"],
        },
        { timeoutMs },
      );
      const value = record(reply.body?.[0]);
      return value?.signature === "s" &&
        typeof value.value === "string" &&
        SESSION_ID.test(value.value)
        ? value.value
        : null;
    } catch {
      return null;
    }
  };

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void attach();
    }, reconnectDelay);
    reconnectTimer.unref();
    reconnectDelay = Math.min(reconnectDelay * 2, reconnectMaxMs);
  };

  const attach = async (): Promise<void> => {
    if (disposed) return;
    let target: SessionBus;
    try {
      target = await connect();
    } catch {
      log("bus-lost");
      setStatus("unavailable");
      scheduleReconnect();
      return;
    }
    if (disposed) {
      target.close();
      return;
    }
    bus = target;
    authorityOwner = null;
    attemptedOwner = null;
    subject = null;
    target.onDisconnect(() => {
      if (bus !== target) return;
      bus = null;
      authorityOwner = null;
      endSessions();
      if (disposed) return;
      log("bus-lost");
      setStatus("unavailable");
      scheduleReconnect();
    });
    // The object exists before polkitd learns of it, so its first call always finds it.
    target.exportObject(POLKIT_AGENT_PATH, {
      name: POLKIT_AGENT_INTERFACE,
      methods: {
        BeginAuthentication: {
          inSignature: BEGIN_SIGNATURE,
          outSignature: "",
          handler: ({ message, body }) => begin(message, body),
        },
        CancelAuthentication: {
          inSignature: "s",
          outSignature: "",
          handler: ({ message, body }) => cancel(message, body),
        },
      },
    });
    try {
      let watching = false;
      await target.watchName(
        POLKIT_AUTHORITY,
        (owner) => {
          if (bus !== target || owner === authorityOwner) return;
          // A new polkitd knows neither the old cookies nor this agent.
          authorityOwner = owner;
          endSessions();
          if (owner === null) setStatus("unavailable");
          else if (watching) void register(target);
        },
        { timeoutMs },
      );
      watching = true;
      const session = await sessionId(target);
      if (bus !== target) return;
      if (session === null) {
        // Outside a logind session (a development run) there is nothing to register for.
        log("no-session");
        setStatus("unavailable");
        return;
      }
      subject = ["unix-session", { "session-id": variant("s", session) }];
      await register(target);
    } catch {
      if (bus !== target) return;
      log("register-failed");
      setStatus("unavailable");
    }
  };

  await attach();

  return {
    get status() {
      return status;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      endSessions();
      const target = bus;
      bus = null;
      if (!target) return;
      if (status === "registered" && subject) {
        await target
          .call(
            {
              destination: POLKIT_AUTHORITY,
              path: AUTHORITY_PATH,
              interface: AUTHORITY_INTERFACE,
              member: "UnregisterAuthenticationAgent",
              signature: "(sa{sv})s",
              body: [subject, POLKIT_AGENT_PATH],
            },
            { timeoutMs: Math.min(timeoutMs, 1000) },
          )
          .catch(() => {});
      }
      target.close();
    },
  };
}
