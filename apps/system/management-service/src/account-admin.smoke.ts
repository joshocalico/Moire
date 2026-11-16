/**
 * Settings' accounts client → moire-accounts (org.moire.AccountAdmin1) → a fake AccountsService,
 * with a fake polkit authority (the rule and the prompt) and a fake compositor (why a prompt
 * was dismissed), all on one private bus.
 *
 * - Exactly one polkit check per change, for org.moire.accounts.administer, about Settings' own
 *   connection (so the prompt names Settings), with interaction only when the caller waits.
 * - AccountsService is called by moire-accounts alone, never with interaction allowed.
 * - Arguments are checked before anyone is asked; a dismissed or refused prompt changes nothing;
 *   `refused` and `cancelled` come from the compositor's answer to Settings' own process.
 * - Passwords: bytes on the wire, hashed (never plain at AccountsService), the buffer wiped, and
 *   never in a log.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALLOW_INTERACTIVE_AUTHORIZATION, DbusRemoteError, variant } from "@moire/dbus";
import { SYSTEM_MANAGEMENT_BUS } from "@moire/system-management";
import {
  ACCOUNT_ADMIN_ACTION,
  ACCOUNT_ADMIN_BUS,
  ACCOUNT_ADMIN_INTERFACE,
  ACCOUNT_ADMIN_PATH,
  createAccountAdminClient,
} from "@moire/system-management/account-admin";
import {
  observeAccountsSettings,
  type AccountsSettingsClient,
} from "@moire/system-management/accounts-settings";
import { createPasswdChanger } from "@moire/system-management/password-check";
import {
  compositorDismissalLookup,
  SECURE_PROMPT_BUS,
  SECURE_PROMPT_INTERFACE,
  SECURE_PROMPT_PATH,
} from "@moire/system-management/prompt-outcome";
import { INTERACTIVE_CHECK_MS, attachAccountAdmin, polkitAuthorizer } from "./account-admin";
import { attachAccountsSettings, createAccountsServiceBackend } from "./accounts-settings";
import { ACCOUNTS_ROOT, fakeUser, startFakeAccounts } from "./fake-accounts.testing";
import { startPrivateBus, until } from "./private-bus.testing";
import { hashNewPassword, sha512Crypt } from "./sha512-crypt";

const OTHER_PASSWORD = "guest-secret-77";
const NEW_USER_PASSWORD = "fresh account pw";
const SECRETS = [OTHER_PASSWORD, NEW_USER_PASSWORD, "seventh pw 1", "rolled back pw"];
const PAUSED = {
  ok: false,
  code: "refused",
  message: "Password requests are paused. Try again in a little while.",
};
const CANCELLED = { ok: false, code: "cancelled", message: "The password request was cancelled." };
const POLKIT = "org.freedesktop.PolicyKit1";

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
// Bytes hash as their UTF-8 string does, and the caller's buffer is left for the caller to wipe.
const bytes = Buffer.from("Hello world!");
assert.equal(sha512Crypt(bytes, "$6$saltstring"), sha512Crypt("Hello world!", "$6$saltstring"));
assert.equal(bytes.toString(), "Hello world!");
const fresh = hashNewPassword(Buffer.from("x"), 1000);
assert.match(fresh, /^\$6\$rounds=1000\$[./0-9A-Za-z]{16}\$[./0-9A-Za-z]{86}$/);
assert.equal(sha512Crypt("x", fresh), fresh);
assert.notEqual(hashNewPassword("x", 1000), fresh, "salts are random");

const work = fs.mkdtempSync(path.join(os.tmpdir(), "moire-account-admin-smoke-"));
const bus = await startPrivateBus("moire-account-admin-smoke-");
const logged: string[] = [];
const originals = { log: console.log, warn: console.warn, error: console.error };
for (const key of Object.keys(originals) as (keyof typeof originals)[])
  console[key] = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
    originals[key](...args);
  };
let accounts: AccountsSettingsClient | null = null;
try {
  const fixture = await bus.connect();
  const fake = await startFakeAccounts(fixture, work);
  fake.exportUser(fakeUser(1000, "joshua", "Joshua Steele", 1));
  fake.exportUser(fakeUser(1001, "guest", "Guest", 0));
  fake.exportUser(
    fakeUser(990, "builder", "Nix build user", 0, { SystemAccount: variant("b", true) }),
  );
  fake.exportUser(fakeUser(1500, "daemon", "Service", 0, { Shell: variant("s", "/sbin/nologin") }));

  // Connections. Settings has a session-bus and a system-bus connection in one process; the
  // compositor keys a dismissal by the subject's pid, so the fake groups connections by process.
  const mechanism = await bus.connect();
  const service = await bus.connect();
  const settingsSystem = await bus.connect();
  const settingsSession = await bus.connect();
  const otherApp = await bus.connect();
  const processOf = new Map<string, string>([
    [settingsSystem.name!, "settings"],
    [settingsSession.name!, "settings"],
    [otherApp.name!, "other"],
    [service.name!, "management"],
    [mechanism.name!, "moire-accounts"],
  ]);
  /** GetConnectionUnixUser, as the bus daemon would answer moire-accounts. */
  const uidOf = new Map<string, number>([[otherApp.name!, 1000]]);

  // --- Fake polkit: the rule's answer and the prompt's outcome --------------------------------
  type Check = { sender: string; subject: string; action: unknown; flags: unknown; id: unknown };
  const checks: Check[] = [];
  const withdrawn: unknown[] = [];
  let polkitAnswer: "yes" | "dismissed" | "refused" | "no" | "challenge" = "yes";
  let polkitGate: Promise<void> | null = null;
  let dismissalReason: string | null = null;
  const reasons = new Map<string, string>();
  const authority = await bus.connect();
  authority.exportObject("/org/freedesktop/PolicyKit1/Authority", {
    name: `${POLKIT}.Authority`,
    methods: {
      CheckAuthorization: {
        inSignature: "(sa{sv})sa{ss}us",
        outSignature: "(bba{ss})",
        handler: async ({ message, body }) => {
          const [kind, details] = body[0] as [string, Record<string, { value: unknown }>];
          assert.equal(kind, "system-bus-name");
          const subject = String(details.name?.value);
          checks.push({
            sender: message.sender ?? "",
            subject,
            action: body[1],
            flags: body[3],
            id: body[4],
          });
          await polkitGate;
          const dismissed = polkitAnswer === "dismissed" || polkitAnswer === "refused";
          // The compositor records why, under the subject's process, before polkit answers.
          if (dismissed)
            reasons.set(
              `${processOf.get(subject)}|${String(body[1])}`,
              dismissalReason ?? (polkitAnswer === "refused" ? "refused" : "cancelled"),
            );
          return {
            body: [
              [
                polkitAnswer === "yes",
                polkitAnswer === "challenge",
                dismissed ? { "polkit.dismissed": "true" } : {},
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

  // --- Fake compositor: TakeDismissal answers only the caller's own process, once ------------
  const compositor = await bus.connect();
  const lookups: { sender: string; actionId: unknown }[] = [];
  compositor.exportObject(SECURE_PROMPT_PATH, {
    name: SECURE_PROMPT_INTERFACE,
    methods: {
      TakeDismissal: {
        inSignature: "s",
        outSignature: "s",
        handler: ({ message, body }) => {
          lookups.push({ sender: message.sender ?? "", actionId: body[0] });
          const key = `${processOf.get(message.sender ?? "")}|${String(body[0])}`;
          const reason = reasons.get(key) ?? "";
          reasons.delete(key);
          return { body: [reason] };
        },
      },
    },
  });
  assert.equal(await compositor.requestName(SECURE_PROMPT_BUS), 1);

  // --- moire-accounts ----------------------------------------------------------------------------
  const hashed: Buffer[] = [];
  const mechanismLog: string[] = [];
  const detach = attachAccountAdmin(mechanism, {
    callerUid: async (sender) => {
      const uid = uidOf.get(sender) ?? (processOf.get(sender) === "settings" ? 1000 : undefined);
      if (uid === undefined) throw new Error("unknown connection");
      return uid;
    },
    authorize: polkitAuthorizer(mechanism),
    backend: await createAccountsServiceBackend({ connect: async () => mechanism, selfUid: -1 }),
    hash: (password) => {
      hashed.push(password);
      // Fast rounds keep the smoke quick; the format is unchanged.
      return hashNewPassword(password, 1000);
    },
    log: (line) => {
      mechanismLog.push(line);
      console.log(line);
    },
  });
  assert.equal(await mechanism.requestName(ACCOUNT_ADMIN_BUS), 1);

  // --- The management service (the list, own account) and Settings ---------------------------
  assert.equal(await service.requestName(SYSTEM_MANAGEMENT_BUS), 1);
  const serviceSystem = await bus.connect();
  const attached = attachAccountsSettings(service, {
    backend: await createAccountsServiceBackend({
      connect: async () => serviceSystem,
      selfUid: 1000,
    }),
    changeOwnPassword: createPasswdChanger({ helper: path.join(work, "absent") }),
  });
  accounts = await observeAccountsSettings(settingsSession, {
    admin: createAccountAdminClient({
      connect: async () => settingsSystem,
      promptDismissal: compositorDismissalLookup(settingsSession),
    }),
  });
  const client = accounts;
  await until(() => client.state.kind === "ready", "accounts ready");
  const status = () => {
    const current = client.state;
    if (current.kind !== "ready" || current.status.kind !== "ready") throw new Error("not ready");
    return current.status;
  };
  const changes = (member: string) => fake.calls.filter((call) => call.member === member);
  /** Each change asked polkit exactly once, about Settings, with interaction. */
  const askedOnce = (before: number) => {
    assert.equal(checks.length, before + 1, "one polkit check for one change");
    const check = checks.at(-1)!;
    assert.equal(check.subject, settingsSystem.name, "the subject is Settings' connection");
    assert.equal(check.sender, mechanism.name, "moire-accounts asks");
    assert.equal(check.action, ACCOUNT_ADMIN_ACTION);
    assert.equal(check.flags, 1, "interaction allowed: Settings waits");
  };

  // --- Add a user with a password: one prompt, then CreateUser and SetPassword ----------------
  let before = checks.length;
  const created = await client.createUser({
    username: "alice",
    realName: " Alice ",
    accountType: "standard",
    password: NEW_USER_PASSWORD,
  });
  assert.deepEqual(created, { ok: true, value: { uid: 1002 } });
  askedOnce(before);
  assert.deepEqual(changes("CreateUser").at(-1)!.body, ["alice", "Alice", 0]);
  const createdHash = changes("SetPassword").at(-1)!;
  assert.equal(createdHash.path, `${ACCOUNTS_ROOT}/User1002`);
  assert.match(String(createdHash.body[0]), /^\$6\$rounds=1000\$/);
  assert.equal(sha512Crypt(NEW_USER_PASSWORD, String(createdHash.body[0])), createdHash.body[0]);
  assert.equal(createdHash.body[1], "", "no password hint");
  assert(
    hashed.at(-1)!.every((byte) => byte === 0),
    "the password buffer is wiped",
  );
  await until(() => status().users.some((user) => user.username === "alice"), "list refreshed");
  // Administrators are added in one prompt too.
  before = checks.length;
  const adminAdded = await client.createUser({
    username: "bob",
    realName: "",
    accountType: "administrator",
    password: "seventh pw 1",
  });
  assert(adminAdded.ok);
  askedOnce(before);
  assert.deepEqual(changes("CreateUser").at(-1)!.body, ["bob", "", 1]);

  // --- Account type, another user's password, delete: one prompt each -------------------------
  before = checks.length;
  assert((await client.setAccountType(1002, "administrator")).ok);
  askedOnce(before);
  assert.deepEqual(changes("SetAccountType").at(-1)!.body, [1]);
  before = checks.length;
  assert((await client.setPassword(1001, OTHER_PASSWORD)).ok);
  askedOnce(before);
  const sent = changes("SetPassword").at(-1)!;
  assert.equal(sent.path, `${ACCOUNTS_ROOT}/User1001`);
  assert.equal(sha512Crypt(OTHER_PASSWORD, String(sent.body[0])), sent.body[0]);
  before = checks.length;
  assert((await client.deleteUser(1003, { keepHome: false })).ok);
  askedOnce(before);
  assert.deepEqual(changes("DeleteUser").at(-1)!.body, [1003n, true], "files removed");
  before = checks.length;
  assert((await client.deleteUser(1002, { keepHome: true })).ok);
  askedOnce(before);
  assert.deepEqual(changes("DeleteUser").at(-1)!.body, [1002n, false], "home kept");
  await until(() => !status().users.some((user) => user.uid === 1002), "deletion published");

  // Every AccountsService change came from moire-accounts, never with interaction allowed: no
  // second prompt can come from them.
  for (const call of fake.calls) {
    assert.equal(call.sender, mechanism.name, `${call.member} from moire-accounts`);
    assert.equal(call.flags & ALLOW_INTERACTIVE_AUTHORIZATION, 0, `${call.member} not interactive`);
  }

  // --- Dismissed: nothing changes; the compositor tells Settings why --------------------------
  let reached = fake.calls.length;
  polkitAnswer = "dismissed";
  assert.deepEqual(await client.setAccountType(1001, "administrator"), CANCELLED);
  assert.deepEqual(lookups.at(-1), {
    sender: settingsSession.name,
    actionId: ACCOUNT_ADMIN_ACTION,
  });
  polkitAnswer = "refused";
  assert.deepEqual(await client.setPassword(1001, OTHER_PASSWORD), PAUSED);
  assert.deepEqual(
    await client.createUser({
      username: "carol",
      realName: "",
      accountType: "standard",
      password: NEW_USER_PASSWORD,
    }),
    PAUSED,
  );
  assert.deepEqual(await client.deleteUser(1001, { keepHome: true }), PAUSED);
  // Locked, timed out, withdrawn, or no reason kept: said as nothing.
  polkitAnswer = "dismissed";
  for (const reason of ["locked", "timed-out", "withdrawn", ""]) {
    dismissalReason = reason;
    assert.deepEqual(await client.setAccountType(1001, "administrator"), CANCELLED, reason);
  }
  dismissalReason = null;
  // Refused by the rule (remote, inactive, the greeter), or no agent: `permission`.
  for (const answer of ["no", "challenge"] as const) {
    polkitAnswer = answer;
    const denied = await client.setAccountType(1001, "administrator");
    assert(!denied.ok && denied.code === "permission", answer);
  }
  assert.equal(fake.calls.length, reached, "nothing reached AccountsService");
  // The mechanism never asks the compositor itself: only Settings' process does.
  assert(lookups.every((lookup) => lookup.sender === settingsSession.name));
  polkitAnswer = "yes";

  // --- Checked before the prompt: none of these asks for a password ----------------------------
  before = checks.length;
  const refusedUpFront: [string, () => Promise<{ ok: boolean; code?: string }>][] = [
    ["own password", () => client.setPassword(1000, "another pw 9")],
    ["delete self", () => client.deleteUser(1000, { keepHome: true })],
    ["unknown uid", () => client.deleteUser(4242, { keepHome: true })],
    ["system account", () => client.setPassword(990, "another pw 9")],
    ["nologin account", () => client.deleteUser(1500, { keepHome: true })],
    [
      "taken name",
      () =>
        client.createUser({
          username: "guest",
          realName: "",
          accountType: "standard",
          password: NEW_USER_PASSWORD,
        }),
    ],
  ];
  for (const [label, attempt] of refusedUpFront) {
    const result = await attempt();
    assert(!result.ok && result.code === "invalid", label);
  }
  // The last administrator can't be demoted or deleted.
  const lastAdmin = await client.setAccountType(1000, "standard");
  assert(!lastAdmin.ok && lastAdmin.code === "invalid", "keep one administrator");
  assert.equal(checks.length, before, "no prompt for a change that would be refused anyway");

  // Raw calls: bad signatures, malformed passwords and names never reach polkit.
  const raw = (
    member: string,
    signature: string,
    body: unknown[],
    flags = ALLOW_INTERACTIVE_AUTHORIZATION,
  ) =>
    otherApp.call({
      destination: ACCOUNT_ADMIN_BUS,
      path: ACCOUNT_ADMIN_PATH,
      interface: ACCOUNT_ADMIN_INTERFACE,
      member,
      signature,
      body,
      flags,
    });
  const invalid = (error: unknown) =>
    error instanceof DbusRemoteError &&
    error.errorName === `${ACCOUNT_ADMIN_INTERFACE}.Error.invalid`;
  const malformed = Buffer.from([0xc0, 0xaf, ...Buffer.from("overlong")]);
  await assert.rejects(raw("SetPassword", "uay", [1001, malformed]), invalid);
  await assert.rejects(raw("SetPassword", "uay", [1001, Buffer.from("short")]), invalid);
  await assert.rejects(raw("SetPassword", "uay", [1001, Buffer.from("new\nline pw")]), invalid);
  await assert.rejects(
    raw("AddUser", "ssbay", ["Root;rm", "", false, Buffer.from(NEW_USER_PASSWORD)]),
    invalid,
  );
  await assert.rejects(
    raw("AddUser", "ssbay", ["eve", "Eve:0", false, Buffer.from(NEW_USER_PASSWORD)]),
    invalid,
  );
  await assert.rejects(
    raw("SetAccountType", "us", [1001, "administrator"]),
    (error) =>
      error instanceof DbusRemoteError && /UnknownMethod|InvalidArgs|invalid/.test(error.errorName),
  );
  assert.equal(checks.length, before);

  // --- Any caller is asked about itself: another app is named as the requester ---------------
  before = checks.length;
  assert(await raw("SetAccountType", "ub", [1001, true]).then(() => true));
  assert.equal(checks.length, before + 1);
  assert.equal(checks.at(-1)!.subject, otherApp.name, "the prompt names the app that asked");
  // ...and without the interactive flag, polkit is asked with no prompt.
  await raw("SetAccountType", "ub", [1001, false], 0);
  assert.equal(checks.at(-1)!.flags, 0);
  // Its dismissals are its own: Settings learns nothing about them.
  polkitAnswer = "refused";
  await assert.rejects(
    raw("SetAccountType", "ub", [1001, true]),
    (error) =>
      error instanceof DbusRemoteError &&
      error.errorName === `${ACCOUNT_ADMIN_INTERFACE}.Error.cancelled`,
  );
  assert.equal(await compositorDismissalLookup(settingsSession)(ACCOUNT_ADMIN_ACTION), null);
  polkitAnswer = "yes";
  // A system account (the greeter) is refused before polkit is asked.
  uidOf.set(otherApp.name!, 977);
  before = checks.length;
  await assert.rejects(
    raw("SetAccountType", "ub", [1001, true]),
    (error) =>
      error instanceof DbusRemoteError &&
      error.errorName === `${ACCOUNT_ADMIN_INTERFACE}.Error.permission`,
  );
  assert.equal(checks.length, before);

  // --- One change at a time per person; another person isn't held up --------------------------
  uidOf.set(otherApp.name!, 1001);
  let release!: () => void;
  polkitGate = new Promise<void>((resolve) => (release = resolve));
  before = checks.length;
  const waiting = client.setAccountType(1001, "administrator");
  await until(() => checks.length === before + 1, "prompt raised");
  const second = await client.setPassword(1001, OTHER_PASSWORD);
  assert(!second.ok && second.code === "busy");
  // (Their own type: allowed, with an administrator's password.)
  const elsewhere = raw("SetAccountType", "ub", [1001, true]);
  await until(() => checks.length === before + 2, "another person's prompt");
  release();
  polkitGate = null;
  assert((await waiting).ok);
  await elsewhere;

  // --- A prompt nobody answers: the question is withdrawn and reads as cancelled --------------
  assert(INTERACTIVE_CHECK_MS > 120_000 && INTERACTIVE_CHECK_MS < 170_000);
  const impatient = polkitAuthorizer(mechanism, { interactiveTimeoutMs: 150 });
  polkitGate = new Promise<void>((resolve) => (release = resolve));
  assert.equal(await impatient(settingsSystem.name!, true), "dismissed");
  await until(() => withdrawn.length === 1, "check withdrawn");
  assert.equal(withdrawn[0], checks.at(-1)!.id);
  release();
  polkitGate = null;

  // --- A password AccountsService won't set: the new account is removed again ------------------
  fake.failNextPassword();
  const rolledBack = await client.createUser({
    username: "dave",
    realName: "",
    accountType: "standard",
    password: "rolled back pw",
  });
  assert.deepEqual(rolledBack, {
    ok: false,
    code: "failed",
    message: "The account could not be created.",
  });
  const daveUid = Number(changes("DeleteUser").at(-1)!.body[0]);
  assert(![...fake.users.values()].some((user) => user.props.UserName!.value === "dave"));
  assert.deepEqual(changes("DeleteUser").at(-1)!.body, [BigInt(daveUid), true]);

  // --- Secrets: never plain at AccountsService, never logged -----------------------------------
  for (const call of fake.calls) {
    const visible = JSON.stringify(call.body, (_key, value) =>
      typeof value === "bigint" ? String(value) : value,
    );
    for (const secret of SECRETS) assert(!visible.includes(secret), `${call.member} saw a secret`);
  }
  for (const line of logged)
    for (const secret of SECRETS) assert(!line.includes(secret), "a secret reached the log");
  for (const line of mechanismLog)
    assert.match(line, /^moire-accounts: code=[a-z-]+( [a-z]+=[a-z0-9]+)*$/);
  assert(
    hashed.every((buffer) => buffer.every((byte) => byte === 0)),
    "every buffer wiped",
  );

  detach();
  await attached.dispose();
  console.log("[account-admin.smoke] ok");
} finally {
  Object.assign(console, originals);
  await accounts?.dispose();
  await bus.close();
  fs.rmSync(work, { recursive: true, force: true });
}
