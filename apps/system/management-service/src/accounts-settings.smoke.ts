/**
 * AccountsService → org.moire.Accounts1 → AccountsSettingsClient, against a fake AccountsService,
 * a fake polkit authority and fake unix_chkpwd / passwd helpers.
 *
 * - The service changes only the session user's own name, picture and password. It never asks
 *   polkit and never lets AccountsService prompt: administrator changes are moire-accounts'
 *   (account-admin.smoke.ts), called by Settings itself, so this service has no
 *   CreateUser, DeleteUser, SetAccountType or SetPassword.
 * - Automatic login is not on this service either: Settings calls moire-dm-settings itself
 *   (autologin-client.smoke.ts), so org.moire.LoginSettings1 is gone.
 * - No password reaches a log, a helper's argv or environment.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ALLOW_INTERACTIVE_AUTHORIZATION, DbusRemoteError, variant } from "@moire/dbus";
import { SYSTEM_MANAGEMENT_BUS } from "@moire/system-management";
import {
  observeAccountsSettings,
  type AccountsSettingsClient,
} from "@moire/system-management/accounts-settings";
import { attachAccountsSettings, createAccountsServiceBackend } from "./accounts-settings";
import {
  createPasswdChanger,
  createPasswordThrottle,
  createUnixPasswordChecker,
} from "@moire/system-management/password-check";
import { ACCOUNTS_ROOT as ROOT, fakeUser, startFakeAccounts } from "./fake-accounts.testing";
import { startPrivateBus, until } from "./private-bus.testing";

const CURRENT = "correct horse battery";
const NEXT = "tr0ub4dor & 3";
const SECRETS = [CURRENT, NEXT, "wrong guess 1"];

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
try {
  const fixture = await bus.connect();
  const fake = await startFakeAccounts(fixture, work);
  const users = fake.users;
  const accountCalls = fake.calls;
  fake.exportUser(fakeUser(1000, "joshua", "Joshua Steele", 1));
  fake.exportUser(fakeUser(1001, "guest", "Guest", 0));
  fake.exportUser(
    fakeUser(990, "builder", "Nix build user", 0, { SystemAccount: variant("b", true) }),
  );

  // --- Fake polkit authority: a sentinel. This service must never ask it anything. -----------
  const POLKIT = "org.freedesktop.PolicyKit1";
  const authority = await bus.connect();
  const checks: unknown[] = [];
  authority.exportObject("/org/freedesktop/PolicyKit1/Authority", {
    name: `${POLKIT}.Authority`,
    methods: {
      CheckAuthorization: {
        inSignature: "(sa{sv})sa{ss}us",
        outSignature: "(bba{ss})",
        handler: ({ body }) => {
          checks.push(body);
          return { body: [[true, false, {}]] };
        },
      },
    },
  });
  assert.equal(await authority.requestName(POLKIT), 1);

  const serviceBus = await bus.connect();
  assert.equal(await serviceBus.requestName(SYSTEM_MANAGEMENT_BUS), 1);
  // The service's "system bus" connection: AccountsService's caller.
  const backendBus = await bus.connect();
  const attached = attachAccountsSettings(serviceBus, {
    backend: await createAccountsServiceBackend({ connect: async () => backendBus, selfUid: 1000 }),
    changeOwnPassword: createPasswdChanger({ helper: passwd }),
    throttle: createPasswordThrottle({ failureDelayMs: 0, limit: 3, lockoutMs: 300 }),
  });

  const clientBus = await bus.connect();
  client = await observeAccountsSettings(clientBus);
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

  // Own name: polkit allows it outright (nix/moire-settings.rules). The service asks polkit
  // nothing, and AccountsService is called without interaction, so no prompt can follow.
  assert((await accounts.setRealName(1000, "Josh Steele")).ok);
  await until(() => status().users[0]!.realName === "Josh Steele", "name published");
  assert.equal(accountCalls.at(-1)!.flags & ALLOW_INTERACTIVE_AUTHORIZATION, 0);
  const gecos = await accounts.setRealName(1000, "Evil:Name");
  assert(!gecos.ok && gecos.code === "invalid");

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

  // Another user's name or picture: refused by the service itself, whoever asks over the bus,
  // before AccountsService or polkit hears of it.
  const before = accountCalls.length;
  for (const [member, body] of [
    ["SetRealName", [1001, "Visitor"]],
    ["SetIcon", [1001, png]],
  ] as const)
    await assert.rejects(
      clientBus.call({
        destination: SYSTEM_MANAGEMENT_BUS,
        path: "/org/moire/Accounts1",
        interface: "org.moire.Accounts1",
        member,
        signature: "us",
        body: [...body],
      }),
      (error) =>
        error instanceof DbusRemoteError && error.errorName === "org.moire.Accounts1.Error.invalid",
    );
  // The client refuses it too, without a call.
  const othersName = await accounts.setRealName(1001, "Visitor");
  assert(!othersName.ok && othersName.code === "invalid");
  assert.equal(accountCalls.length, before, "nothing reached AccountsService");
  assert.equal(status().users[1]!.realName, "Guest");

  // Administrator changes are not on this service: no unlock, and none of the old admin calls.
  for (const [member, signature, body] of [
    ["Authenticate", "s", [CURRENT]],
    ["Lock", "", []],
    ["CreateUser", "ssss", ["alice", "", "standard", "long enough pw"]],
    ["DeleteUser", "ub", [1001, true]],
    ["SetAccountType", "us", [1001, "administrator"]],
    ["SetPassword", "us", [1001, "long enough pw"]],
  ] as const)
    await assert.rejects(
      clientBus.call({
        destination: SYSTEM_MANAGEMENT_BUS,
        path: "/org/moire/Accounts1",
        interface: "org.moire.Accounts1",
        member,
        signature,
        body: [...body],
      }),
      (error) => error instanceof DbusRemoteError && /UnknownMethod/.test(error.errorName),
      member,
    );
  assert.deepEqual(Object.keys(status().policy).sort(), ["canAdminister", "minPasswordLength"]);
  // ...and the client without moire-accounts says so rather than calling this service.
  const noMechanism = await accounts.setAccountType(1001, "administrator");
  assert(!noMechanism.ok && noMechanism.code === "unavailable");
  assert.equal(accountCalls.length, before);

  // ...nor automatic login: Settings calls moire-dm-settings itself.
  await assert.rejects(
    clientBus.call({
      destination: SYSTEM_MANAGEMENT_BUS,
      path: "/org/moire/LoginSettings1",
      interface: "org.moire.LoginSettings1",
      member: "SetAutomaticLogin",
      signature: "b",
      body: [true],
    }),
    (error) =>
      error instanceof DbusRemoteError && /UnknownMethod|UnknownObject/.test(error.errorName),
  );

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

  // A standard user: their own name still needs no prompt, and nothing here asks polkit.
  users.get(1000)!.props.AccountType = variant("i", 0);
  users.get(1001)!.props.AccountType = variant("i", 1);
  assert((await accounts.refresh()).ok);
  await until(() => !status().policy.canAdminister, "standard user");
  assert((await accounts.setRealName(1000, "Joshua Steele")).ok);
  assert.equal(checks.length, 0, "the management service never asks polkit");

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

  await attached.dispose();
  console.log("[accounts-settings.smoke] ok");
} finally {
  Object.assign(console, originals);
  await client?.dispose();
  await bus.close();
  fs.rmSync(work, { recursive: true, force: true });
}
