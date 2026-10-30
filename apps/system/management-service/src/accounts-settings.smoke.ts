/**
 * AccountsService → org.moire.Accounts1 → AccountsSettingsClient, against a fake AccountsService,
 * a fake polkit authority (standing in for the rule and the password prompt) and fake
 * unix_chkpwd / passwd helpers.
 *
 * - Administrator actions ask polkit with interaction allowed, about the service's own
 *   connection; a dismissed prompt is `cancelled`, a refusal `permission`.
 * - The service keeps no unlock: there is no Authenticate or Lock, and no `auth_required`.
 * - No password reaches a log, a helper's argv or environment, or AccountsService in plain text.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ALLOW_INTERACTIVE_AUTHORIZATION,
  DbusRemoteError,
  variant,
  type DbusVariant,
  type SessionBus,
} from "@moire/dbus";
import { SYSTEM_MANAGEMENT_BUS } from "@moire/system-management";
import {
  observeAccountsSettings,
  type AccountsSettingsClient,
} from "@moire/system-management/accounts-settings";
import {
  INTERACTIVE_TIMEOUT_MS,
  attachAccountsSettings,
  createAccountsServiceBackend,
} from "./accounts-settings";
import { attachLoginSettings, createLoginManagerBackend } from "./login-settings";
import {
  observeLoginSettings,
  type LoginSettingsClient,
  type LoginStatus,
} from "@moire/system-management/login-settings";
import {
  createPasswdChanger,
  createPasswordThrottle,
  createUnixPasswordChecker,
} from "@moire/system-management/password-check";
import { startPrivateBus, until } from "./private-bus.testing";
import { hashNewPassword, sha512Crypt } from "./sha512-crypt";

const ACCOUNTS = "org.freedesktop.Accounts";
const ROOT = "/org/freedesktop/Accounts";
const USER = `${ACCOUNTS}.User`;
const CURRENT = "correct horse battery";
const NEXT = "tr0ub4dor & 3";
const OTHER_PASSWORD = "guest-secret-77";
const NEW_USER_PASSWORD = "fresh account pw";
const SECRETS = [CURRENT, NEXT, OTHER_PASSWORD, NEW_USER_PASSWORD, "wrong guess 1"];

// --- SHA-512 crypt against the specification's vectors --------------------------------------
assert.equal(
  sha512Crypt("Hello world!", "$6$saltstring"),
  "$6$saltstring$svn8UoSVapNtMuq1ukKS4tPQd8iKwSMHWjl/O817G3uBnIFNjnQJuesI68u4OTLiBFdcbYEdFCoEOfaS35inz1",
);
assert.equal(
  sha512Crypt("Hello world!", "$6$rounds=10000$saltstringsaltstring"),
  "$6$rounds=10000$saltstringsaltst$OW1/O6BYHV6BcXZu8QVeXbDWra3Oeqh0sbHbbMCVNSnCM/UrjmM0Dp8vOuZeHBy/YTBmSK6H9qs/y3RnOaw5v.",
);
assert.equal(
  sha512Crypt("This is just a test", "$6$rounds=5000$toolongsaltstring"),
  "$6$rounds=5000$toolongsaltstrin$lQ8jolhgVRVhY4b5pZKaysCLi0QBxGoNeKQzQ3glMhwllF7oGDZxUhx1yxdYcz/e1JSbq3y6JMxxl8audkUEm0",
);
const fresh = hashNewPassword("x", 1000);
assert.match(fresh, /^\$6\$rounds=1000\$[./0-9A-Za-z]{16}\$[./0-9A-Za-z]{86}$/);
assert.equal(sha512Crypt("x", fresh), fresh);
assert.notEqual(hashNewPassword("x", 1000), fresh, "salts are random");

// --- Fake helpers: record argv and environment, read the secret only from stdin -------------
const work = fs.mkdtempSync(path.join(os.tmpdir(), "moire-accounts-smoke-"));
const helperLog = path.join(work, "helpers.jsonl");
const state = path.join(work, "password");
fs.writeFileSync(state, CURRENT);
const header = `#!${process.execPath}
const fs = require("node:fs");
const log = (entry) => fs.appendFileSync(${JSON.stringify(helperLog)}, JSON.stringify(entry) + "\\n");
const readSome = () => {
  const buffer = Buffer.alloc(1024);
  for (;;) {
    try { return buffer.subarray(0, fs.readSync(0, buffer, 0, 1024, null)).toString("utf8"); }
    catch (error) { if (error.code !== "EAGAIN") throw error; }
  }
};
const password = fs.readFileSync(${JSON.stringify(state)}, "utf8");
`;
const chkpwd = path.join(work, "unix_chkpwd");
fs.writeFileSync(
  chkpwd,
  `${header}
log({ helper: "unix_chkpwd", argv: process.argv.slice(2), env: process.env, isatty: require("node:tty").isatty(0) });
let input = "";
for (let chunk = readSome(); chunk; chunk = readSome()) input += chunk;
process.exit(input === password + "\\0" ? 0 : 7);
`,
  { mode: 0o755 },
);
const passwd = path.join(work, "passwd");
fs.writeFileSync(
  passwd,
  `${header}
log({ helper: "passwd", argv: process.argv.slice(2), env: process.env });
const ask = (prompt) => { process.stderr.write(prompt); return readSome().replace(/\\n$/, ""); };
process.stderr.write("Changing password for joshua.\\n");
if (ask("Current password: ") !== password) {
  process.stderr.write("passwd: Authentication token manipulation error\\n");
  process.exit(10);
}
const next = ask("New password: ");
if (ask("Retype new password: ") !== next) process.exit(10);
fs.writeFileSync(${JSON.stringify(state)}, next);
process.stderr.write("passwd: password updated successfully\\n");
process.exit(0);
`,
  { mode: 0o755 },
);

// --- Fake AccountsService --------------------------------------------------------------------
type FakeUser = { path: string; props: Record<string, DbusVariant> };
function fakeUser(uid: number, name: string, real: string, type: number, extra = {}): FakeUser {
  return {
    path: `${ROOT}/User${uid}`,
    props: {
      Uid: variant("t", BigInt(uid)),
      UserName: variant("s", name),
      RealName: variant("s", real),
      AccountType: variant("i", type),
      IconFile: variant("s", ""),
      Locked: variant("b", false),
      LoginTime: variant("x", uid === 1000 ? 1_790_000_000n : 0n),
      SystemAccount: variant("b", false),
      LocalAccount: variant("b", true),
      Shell: variant("s", "/run/current-system/sw/bin/bash"),
      ...extra,
    },
  };
}
const users = new Map<number, FakeUser>();
const accountCalls: { member: string; path: string; body: unknown[]; flags: number }[] = [];
let nextUid = 1002;
function exportUser(bus: SessionBus, user: FakeUser) {
  users.set(Number(user.props.Uid!.value), user);
  bus.exportObject(user.path, {
    name: "org.freedesktop.DBus.Properties",
    methods: {
      GetAll: {
        inSignature: "s",
        outSignature: "a{sv}",
        handler: ({ body }) => {
          assert.equal(body[0], USER);
          return { body: [user.props] };
        },
      },
    },
  });
  const setter = (signature: string, apply: (body: unknown[]) => void) => ({
    inSignature: signature,
    outSignature: "",
    handler: ({ body, message }: { body: unknown[]; message: { flags?: number } }) => {
      accountCalls.push({ member: "set", path: user.path, body, flags: message.flags ?? 0 });
      apply(body);
      return {};
    },
  });
  bus.exportObject(user.path, {
    name: USER,
    methods: {
      SetRealName: setter("s", ([name]) => (user.props.RealName = variant("s", name))),
      SetIconFile: setter("s", ([file]) => {
        // AccountsService copies the file into its own store.
        const stored = file ? path.join(work, `icon-${user.props.UserName!.value}`) : "";
        if (file) fs.copyFileSync(String(file), stored);
        user.props.IconFile = variant("s", stored);
      }),
      SetAccountType: setter("i", ([type]) => (user.props.AccountType = variant("i", type))),
      SetPassword: {
        inSignature: "ss",
        outSignature: "",
        handler: ({ body, message }) => {
          accountCalls.push({
            member: "SetPassword",
            path: user.path,
            body,
            flags: message.flags ?? 0,
          });
          return {};
        },
      },
    },
  });
}

const bus = await startPrivateBus("moire-accounts-smoke-");
const logged: string[] = [];
const originals = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
};
for (const key of Object.keys(originals) as (keyof typeof originals)[])
  console[key] = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
    originals[key](...args);
  };
let client: AccountsSettingsClient | null = null;
let loginClient: LoginSettingsClient | null = null;
try {
  const fixture = await bus.connect();
  exportUser(fixture, fakeUser(1000, "joshua", "Joshua Steele", 1));
  exportUser(fixture, fakeUser(1001, "guest", "Guest", 0));
  exportUser(
    fixture,
    fakeUser(990, "builder", "Nix build user", 0, { SystemAccount: variant("b", true) }),
  );
  fixture.exportObject(ROOT, {
    name: ACCOUNTS,
    methods: {
      ListCachedUsers: {
        inSignature: "",
        outSignature: "ao",
        handler: () => ({
          body: [
            [...users.values()].filter((u) => u.path !== `${ROOT}/User1000`).map((u) => u.path),
          ],
        }),
      },
      FindUserById: {
        inSignature: "x",
        outSignature: "o",
        handler: ({ body }) => {
          const user = users.get(Number(body[0]));
          if (!user) throw new DbusRemoteError(`${ACCOUNTS}.Error.UserDoesNotExist`, "none");
          return { body: [user.path] };
        },
      },
      CreateUser: {
        inSignature: "ssi",
        outSignature: "o",
        handler: ({ body, message }) => {
          accountCalls.push({ member: "CreateUser", path: ROOT, body, flags: message.flags ?? 0 });
          if ([...users.values()].some((u) => u.props.UserName!.value === body[0]))
            throw new DbusRemoteError(`${ACCOUNTS}.Error.UserExists`, "exists");
          const user = fakeUser(nextUid++, String(body[0]), String(body[1]), Number(body[2]));
          exportUser(fixture, user);
          return { body: [user.path] };
        },
      },
      DeleteUser: {
        inSignature: "xb",
        outSignature: "",
        handler: ({ body, message }) => {
          accountCalls.push({ member: "DeleteUser", path: ROOT, body, flags: message.flags ?? 0 });
          users.delete(Number(body[0]));
          return {};
        },
      },
    },
  });
  assert.equal(await fixture.requestName(ACCOUNTS), 1);

  // --- Fake polkit authority: the rule's answer and the prompt's outcome ----------------------
  const POLKIT = "org.freedesktop.PolicyKit1";
  const authority = await bus.connect();
  type Check = { sender: string; body: unknown[] };
  const checks: Check[] = [];
  const withdrawn: unknown[] = [];
  // yes: authorized (after a prompt, or kept). dismissed: the prompt was closed. no: the rule
  // refused. challenge: a password is needed but no agent could ask.
  let polkitAnswer: "yes" | "dismissed" | "no" | "challenge" = "yes";
  let polkitGate: Promise<void> | null = null;
  authority.exportObject("/org/freedesktop/PolicyKit1/Authority", {
    name: `${POLKIT}.Authority`,
    methods: {
      CheckAuthorization: {
        inSignature: "(sa{sv})sa{ss}us",
        outSignature: "(bba{ss})",
        handler: async ({ message, body }) => {
          checks.push({ sender: message.sender ?? "", body });
          await polkitGate;
          return {
            body: [
              [
                polkitAnswer === "yes",
                polkitAnswer === "challenge",
                polkitAnswer === "dismissed" ? { "polkit.dismissed": "true" } : {},
              ],
            ],
          };
        },
      },
      CancelCheckAuthorization: {
        inSignature: "s",
        outSignature: "",
        handler: ({ body }) => {
          withdrawn.push(body[0]);
          return {};
        },
      },
    },
  });
  assert.equal(await authority.requestName(POLKIT), 1);

  const serviceBus = await bus.connect();
  assert.equal(await serviceBus.requestName(SYSTEM_MANAGEMENT_BUS), 1);
  // The service's one "system bus" connection: polkit's subject, and AccountsService's caller.
  const backendBus = await bus.connect();
  const attached = attachAccountsSettings(serviceBus, {
    backend: await createAccountsServiceBackend({ connect: async () => backendBus, selfUid: 1000 }),
    changeOwnPassword: createPasswdChanger({ helper: passwd }),
    throttle: createPasswordThrottle({ failureDelayMs: 0, limit: 3, lockoutMs: 300 }),
    // Fast rounds keep the smoke quick; the format is unchanged.
    hash: (password) => hashNewPassword(password, 1000),
  });

  // --- Fake moire-dm-settings (org.moire.LoginManager1) on the "system" bus ------------------
  const manager = await bus.connect();
  let autologinUser: string | null = null;
  let managerAnswer: string | null = null;
  const managerCalls: { sender: string; enabled: unknown; flags: number }[] = [];
  manager.exportObject("/org/moire/LoginManager1", {
    name: "org.moire.LoginManager1",
    methods: {
      GetStatus: {
        inSignature: "",
        outSignature: "s",
        handler: () => ({
          body: [
            JSON.stringify({
              version: 1,
              enabled: autologinUser !== null,
              user: autologinUser,
              session: autologinUser ? "moire" : null,
              problem: null,
            }),
          ],
        }),
      },
      SetAutomaticLogin: {
        inSignature: "b",
        outSignature: "",
        handler: ({ message, body }) => {
          managerCalls.push({
            sender: message.sender ?? "",
            enabled: body[0],
            flags: message.flags ?? 0,
          });
          if (managerAnswer)
            throw new DbusRemoteError(managerAnswer, "daemon detail that must not leak");
          // The real service takes the account from the caller; this one plays "joshua".
          autologinUser = body[0] === true ? "joshua" : null;
          return {};
        },
      },
    },
  });
  assert.equal(await manager.requestName("org.moire.LoginManager1"), 1);
  const managerClient = await bus.connect();
  const login = attachLoginSettings(serviceBus, {
    backend: await createLoginManagerBackend({ connect: async () => managerClient }),
    username: "joshua",
  });

  const clientBus = await bus.connect();
  client = await observeAccountsSettings(clientBus);
  loginClient = await observeLoginSettings(clientBus);
  const autologin = loginClient;
  const loginStatus = (): Extract<LoginStatus, { kind: "ready" }> => {
    const current = autologin.state;
    if (current.kind !== "ready" || current.status.kind !== "ready") throw new Error("not ready");
    return current.status;
  };
  const accounts = client;
  await until(() => accounts.state.kind === "ready", "accounts ready");
  const status = () => {
    const current = accounts.state;
    if (current.kind !== "ready" || current.status.kind !== "ready") throw new Error("not ready");
    return current.status;
  };
  assert.equal(status().selfUid, 1000);
  assert.deepEqual(
    status().users.map((user) => [user.username, user.accountType, user.self]),
    [
      ["joshua", "administrator", true],
      ["guest", "standard", false],
    ],
    "self first, system accounts hidden",
  );
  assert.equal(status().users[0]!.lastLoginMs, 1_790_000_000_000);
  assert.equal(status().policy.canAdminister, true);

  // Own name: polkit allows it outright, so the service doesn't ask first. The call to
  // AccountsService still says the caller will wait for a prompt.
  assert((await accounts.setRealName(1000, "Josh Steele")).ok);
  await until(() => status().users[0]!.realName === "Josh Steele", "name published");
  assert.equal(checks.length, 0, "no polkit question for one's own account");
  assert.equal(accountCalls.at(-1)!.flags & ALLOW_INTERACTIVE_AUTHORIZATION, 4);
  const gecos = await accounts.setRealName(1000, "Evil:Name");
  assert(!gecos.ok && gecos.code === "invalid");

  // Another user's name: polkit is asked, with interaction, about the service's own connection.
  // A dismissed prompt is `cancelled`, with a fixed sentence, and AccountsService is not called.
  const before = accountCalls.length;
  polkitAnswer = "dismissed";
  const dismissed = await accounts.setRealName(1001, "Visitor");
  assert.deepEqual(dismissed, {
    ok: false,
    code: "cancelled",
    message: "The password request was cancelled.",
  });
  assert.equal(checks.length, 1);
  assert.equal(checks[0]!.sender, backendBus.name);
  assert.deepEqual(checks[0]!.body.slice(0, 4), [
    ["system-bus-name", { name: variant("s", backendBus.name) }],
    "org.freedesktop.accounts.user-administration",
    {},
    1,
  ]);
  assert.match(String(checks[0]!.body[4]), /^moire-accounts-\d+-\d+$/, "a cancellation id");
  // Refused by the rule (inactive, remote), or no agent to ask: `permission`.
  polkitAnswer = "no";
  const refusedByRule = await accounts.setRealName(1001, "Visitor");
  assert(!refusedByRule.ok && refusedByRule.code === "permission");
  polkitAnswer = "challenge";
  const noAgent = await accounts.setRealName(1001, "Visitor");
  assert(!noAgent.ok && noAgent.code === "permission");
  assert.equal(accountCalls.length, before, "nothing reached AccountsService");
  assert.equal(status().users[1]!.realName, "Guest");
  // Authorized.
  polkitAnswer = "yes";
  assert((await accounts.setRealName(1001, "Visitor")).ok);
  assert.equal(accountCalls.at(-1)!.flags & ALLOW_INTERACTIVE_AUTHORIZATION, 4);

  // The unlock is gone from the wire: no Authenticate, no Lock, no unlock time in the status.
  for (const member of ["Authenticate", "Lock"])
    await assert.rejects(
      clientBus.call({
        destination: SYSTEM_MANAGEMENT_BUS,
        path: "/org/moire/Accounts1",
        interface: "org.moire.Accounts1",
        member,
        signature: member === "Authenticate" ? "s" : "",
        body: member === "Authenticate" ? [CURRENT] : [],
      }),
      (error) => error instanceof DbusRemoteError && /UnknownMethod/.test(error.errorName),
    );
  assert.deepEqual(Object.keys(status().policy).sort(), ["canAdminister", "minPasswordLength"]);

  // Avatar: PNG accepted (AccountsService copies it), other files refused.
  const png = path.join(work, "avatar.png");
  fs.writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]));
  assert((await accounts.setIcon(1000, png)).ok);
  await until(() => status().users[0]!.iconFile !== null, "icon published");
  const text = path.join(work, "notes.txt");
  fs.writeFileSync(text, "not an image");
  const notImage = await accounts.setIcon(1000, text);
  assert(!notImage.ok && notImage.code === "invalid");
  assert((await accounts.setIcon(1000, null)).ok);

  // Other users' passwords: hashed here, plaintext never sent.
  assert((await accounts.setPassword(1001, OTHER_PASSWORD)).ok);
  const sent = accountCalls.filter((call) => call.member === "SetPassword").at(-1)!;
  assert.equal(sent.path, `${ROOT}/User1001`);
  assert.equal(sha512Crypt(OTHER_PASSWORD, String(sent.body[0])), sent.body[0]);
  assert.equal(sent.body[1], "", "no password hint");
  assert.equal(sent.flags & ALLOW_INTERACTIVE_AUTHORIZATION, 4);

  // Arguments are checked before anyone is asked for a password: none of these prompts.
  const asked = checks.length;
  const ownViaAdmin = await accounts.setPassword(1000, NEXT);
  assert(!ownViaAdmin.ok && ownViaAdmin.code === "invalid", "own password needs the current one");
  const lastAdmin = await accounts.setAccountType(1000, "standard");
  assert(!lastAdmin.ok && lastAdmin.code === "invalid", "keep one administrator");
  const deleteSelf = await accounts.deleteUser(1000, { keepHome: true });
  assert(!deleteSelf.ok && deleteSelf.code === "invalid");
  const gone = await accounts.deleteUser(4242, { keepHome: true });
  assert(!gone.ok && gone.code === "invalid");
  const takenName = await accounts.createUser({
    username: "guest",
    realName: "",
    accountType: "standard",
    password: NEW_USER_PASSWORD,
  });
  assert(!takenName.ok && takenName.code === "invalid");
  const badName = await accounts.createUser({
    username: "Root;rm",
    realName: "",
    accountType: "standard",
    password: NEW_USER_PASSWORD,
  });
  assert(!badName.ok && badName.code === "invalid");
  assert.equal(checks.length, asked, "no prompt for a change that would be refused anyway");

  // Create, retype and delete accounts. A dismissed prompt creates nothing.
  polkitAnswer = "dismissed";
  const notCreated = await accounts.createUser({
    username: "alice",
    realName: "Alice",
    accountType: "standard",
    password: NEW_USER_PASSWORD,
  });
  assert(!notCreated.ok && notCreated.code === "cancelled");
  assert(!accountCalls.some((call) => call.member === "CreateUser"));
  polkitAnswer = "yes";
  const created = await accounts.createUser({
    username: "alice",
    realName: "Alice",
    accountType: "standard",
    password: NEW_USER_PASSWORD,
  });
  assert(created.ok);
  assert.equal(created.value.uid, 1002);
  const createdHash = accountCalls.filter((call) => call.member === "SetPassword").at(-1)!;
  assert.equal(createdHash.path, `${ROOT}/User1002`);
  assert.equal(sha512Crypt(NEW_USER_PASSWORD, String(createdHash.body[0])), createdHash.body[0]);
  assert((await accounts.setAccountType(1002, "administrator")).ok);
  assert((await accounts.setAccountType(1002, "standard")).ok);
  polkitAnswer = "dismissed";
  const notDeleted = await accounts.deleteUser(1002, { keepHome: true });
  assert(!notDeleted.ok && notDeleted.code === "cancelled");
  assert(!accountCalls.some((call) => call.member === "DeleteUser"));
  polkitAnswer = "yes";
  assert((await accounts.deleteUser(1002, { keepHome: true })).ok);
  const deletion = accountCalls.find((call) => call.member === "DeleteUser")!;
  assert.deepEqual(deletion.body, [1002n, false]);
  assert.equal(deletion.flags & ALLOW_INTERACTIVE_AUTHORIZATION, 4);
  await until(() => !status().users.some((user) => user.uid === 1002), "deletion published");

  // Nothing is remembered per connection: another client is asked about in the same way, and
  // polkit (which keeps the authorization for the service's process) is asked every time.
  const elsewhere = await observeAccountsSettings(await bus.connect());
  await until(() => elsewhere.state.kind === "ready", "second accounts client");
  const askedBefore = checks.length;
  polkitAnswer = "dismissed";
  const elsewhereDismissed = await elsewhere.setAccountType(1001, "administrator");
  assert(!elsewhereDismissed.ok && elsewhereDismissed.code === "cancelled");
  polkitAnswer = "yes";
  assert((await elsewhere.setAccountType(1001, "administrator")).ok);
  assert((await accounts.setAccountType(1001, "standard")).ok);
  assert.equal(checks.length, askedBefore + 3);
  assert(checks.every((check) => check.sender === backendBus.name));
  await elsewhere.dispose();

  // While the prompt is up, the status still reads and a second change is refused as busy.
  let release!: () => void;
  polkitGate = new Promise<void>((resolve) => (release = resolve));
  const waiting = accounts.setRealName(1001, "Guest");
  await until(() => checks.length === askedBefore + 4, "prompt raised");
  const second = await accounts.setRealName(1000, "Joshua Steele");
  assert(!second.ok && second.code === "busy");
  assert.equal(status().users[1]!.realName, "Visitor", "nothing changes while waiting");
  release();
  polkitGate = null;
  assert((await waiting).ok);
  await until(() => status().users[1]!.realName === "Guest", "applied after the prompt");

  // A prompt nobody answers: the question is withdrawn, and it reads as cancelled.
  assert(INTERACTIVE_TIMEOUT_MS > 120_000, "outlasts the prompt's own two-minute limit");
  const impatient = await createAccountsServiceBackend({
    connect: () => bus.connect(),
    selfUid: 1000,
    promptTimeoutMs: 150,
  });
  polkitGate = new Promise<void>((resolve) => (release = resolve));
  assert.equal(await impatient.authorizeAdministration(), "cancelled");
  await until(() => withdrawn.length === 1, "check withdrawn");
  assert.equal(withdrawn[0], checks.at(-1)!.body[4]);
  release();
  polkitGate = null;
  await impatient.dispose();

  // Automatic login: available under moire-dm and off.
  await until(() => autologin.state.kind === "ready", "login settings ready");
  assert.deepEqual(loginStatus(), { kind: "ready", available: true, enabled: false, user: null });
  // On, for the session user: moire-dm-settings is asked straight away, by a caller that says it
  // will wait for the prompt. This service asks polkit nothing itself.
  const loginChecks = checks.length;
  assert.deepEqual(await autologin.setAutologin(true), { ok: true, value: undefined });
  assert.equal(managerCalls.at(-1)!.enabled, true);
  assert.equal(managerCalls.at(-1)!.flags & ALLOW_INTERACTIVE_AUTHORIZATION, 4);
  assert.equal(
    managerCalls.at(-1)!.sender,
    managerClient.name,
    "asked from the service's own identity",
  );
  assert.equal(checks.length, loginChecks);
  await until(() => loginStatus().enabled, "automatic login on");
  assert.equal(loginStatus().user, "joshua");
  // Someone else's: shown as theirs, not as on for this user.
  autologinUser = "guest";
  assert((await autologin.refresh()).ok);
  await until(() => loginStatus().user === "guest", "other user's automatic login");
  assert.equal(loginStatus().enabled, false);
  // The prompt was dismissed: `cancelled`, and nothing changed.
  managerAnswer = "org.moire.LoginManager1.Error.cancelled";
  const loginDismissed = await autologin.setAutologin(true);
  assert.deepEqual(loginDismissed, {
    ok: false,
    code: "cancelled",
    message: "The password request was cancelled.",
  });
  assert.equal(loginStatus().user, "guest");
  // moire-dm-settings refuses (polkit): our own sentence, never the daemon's text.
  managerAnswer = "org.moire.LoginManager1.Error.permission";
  const denied = await autologin.setAutologin(true);
  assert(!denied.ok && denied.code === "permission");
  assert(!denied.message.includes("daemon detail"));
  assert(!/administrators/i.test(denied.message), "a standard user may ask too");
  managerAnswer = "org.moire.LoginManager1.Error.failed";
  const broken = await autologin.setAutologin(false);
  assert(!broken.ok && broken.code === "failed" && !broken.message.includes("daemon detail"));
  managerAnswer = null;
  assert((await autologin.setAutologin(false)).ok);
  await until(() => loginStatus().user === null, "automatic login off");

  // Own password through passwd: wrong current, then right.
  const badCurrent = await accounts.changePassword("wrong guess 1", NEXT);
  assert(!badCurrent.ok && badCurrent.code === "wrong_password");
  const short = await accounts.changePassword(CURRENT, "short");
  assert(!short.ok && short.code === "invalid");
  assert.deepEqual(await accounts.changePassword(CURRENT, NEXT), { ok: true, value: undefined });
  assert.equal(fs.readFileSync(state, "utf8"), NEXT);
  assert(
    !accountCalls.some((call) => call.member === "SetPassword" && call.path === `${ROOT}/User1000`),
    "own password never goes through AccountsService",
  );

  // Throttle: three wrong guesses lock checks for a moment, even with the right password.
  for (let attempt = 0; attempt < 3; attempt++)
    assert.equal((await accounts.changePassword("wrong guess 1", CURRENT)).ok, false);
  const limited = await accounts.changePassword(NEXT, CURRENT);
  assert(!limited.ok && limited.code === "rate_limited");
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert((await accounts.changePassword(NEXT, CURRENT)).ok);
  assert((await accounts.changePassword(CURRENT, NEXT)).ok);

  // A standard user may ask for the same changes: the prompt wants an administrator's password,
  // and polkit's answer decides. This service doesn't refuse on the account type.
  users.get(1000)!.props.AccountType = variant("i", 0);
  users.get(1001)!.props.AccountType = variant("i", 1);
  assert((await accounts.refresh()).ok);
  await until(() => !status().policy.canAdminister, "standard user");
  const standardAsked = checks.length;
  assert((await accounts.setRealName(1001, "Admin Guest")).ok);
  assert.equal(checks.length, standardAsked + 1);
  polkitAnswer = "dismissed";
  const standardDismissed = await accounts.setRealName(1001, "Nope");
  assert(!standardDismissed.ok && standardDismissed.code === "cancelled");
  polkitAnswer = "yes";
  // ...and automatic login, for their own account.
  assert((await autologin.setAutologin(true)).ok);
  await until(() => loginStatus().enabled, "standard user's automatic login");
  assert((await autologin.setAutologin(false)).ok);
  // Without moire-dm-settings (a greetd image): not available, so Settings shows no switch.
  const callsBefore = managerCalls.length;
  manager.close();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert((await autologin.refresh()).ok);
  await until(() => !loginStatus().available, "login: unavailable without moire-dm");
  const missingManager = await autologin.setAutologin(false);
  assert(!missingManager.ok && missingManager.code === "unavailable");
  assert.equal(managerCalls.length, callsBefore);

  // unix_chkpwd is the lock screen's now. The service never runs it; the checker itself still
  // keeps the password out of argv and the environment (asserted below).
  assert.equal(
    fs.existsSync(helperLog) && /unix_chkpwd/.test(fs.readFileSync(helperLog, "utf8")),
    false,
  );
  const checker = createUnixPasswordChecker({ helper: chkpwd });
  assert.equal(await checker("joshua", NEXT), "ok");
  assert.equal(await checker("joshua", "wrong guess 1"), "wrong");

  // A missing helper is "unavailable", not a wrong password.
  const missing = createUnixPasswordChecker({ helper: path.join(work, "absent") });
  assert.equal(await missing("joshua", CURRENT), "unavailable");

  // Secrets: never in any helper's argv or environment, never logged.
  const entries = fs
    .readFileSync(helperLog, "utf8")
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as { helper: string; argv: string[]; env: object; isatty?: boolean },
    );
  assert(entries.some((entry) => entry.helper === "unix_chkpwd"));
  assert(entries.some((entry) => entry.helper === "passwd"));
  for (const entry of entries) {
    const visible = JSON.stringify([entry.argv, entry.env]);
    for (const secret of SECRETS) assert(!visible.includes(secret), `${entry.helper} saw a secret`);
    if (entry.helper === "unix_chkpwd") {
      assert.deepEqual(entry.argv, ["joshua", "nonull"]);
      assert.deepEqual(
        Object.keys(entry.env).filter((key) => !key.startsWith("__CF")),
        [],
      );
      assert.equal(entry.isatty, false, "unix_chkpwd refuses a terminal on stdin");
    } else {
      assert.deepEqual(entry.argv, []);
      assert.deepEqual(
        Object.keys(entry.env)
          .filter((key) => !key.startsWith("__CF"))
          .sort(),
        ["LANG", "LC_ALL"],
      );
    }
  }
  for (const line of logged)
    for (const secret of SECRETS) assert(!line.includes(secret), "a secret reached the log");

  await login.dispose();
  await attached.dispose();
  console.log("[accounts-settings.smoke] ok");
} finally {
  Object.assign(console, originals);
  await loginClient?.dispose();
  await client?.dispose();
  await bus.close();
  fs.rmSync(work, { recursive: true, force: true });
}
