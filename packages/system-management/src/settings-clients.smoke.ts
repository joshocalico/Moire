/** Wire parsers, validators and the fakes the Settings UI tests against. */
import assert from "node:assert/strict";
import {
  createFakeAccountsSettingsClient,
  FAKE_ACCOUNTS_PASSWORD,
  parseAccountsStatus,
  passwordBytesProblem,
  passwordProblem,
  realNameProblem,
  usernameProblem,
} from "./accounts-settings";
import { DbusRemoteError } from "@moire/dbus";
import { remoteSettingsFailure } from "./settings-service";
import { createFakeTimeSettingsClient, parseTimeStatus, parseZoneCatalog } from "./time-settings";
import { createFakeLoginSettingsClient, parseLoginManagerStatus } from "./login-settings";

// Validators shared by the client and the service.
assert.equal(usernameProblem("alice"), null);
for (const name of ["", "Alice", "1abc", "root", "a".repeat(32), "a b", "a;b"])
  assert.notEqual(usernameProblem(name), null, name);
assert.equal(realNameProblem("Zoë O'Brien"), null);
for (const name of ["a:b", "a,b", "a\nb", "x".repeat(129)])
  assert.notEqual(realNameProblem(name), null);
assert.equal(passwordProblem("eight ch"), null);
for (const password of ["short", "line\nbreak!", "x".repeat(257)])
  assert.notEqual(passwordProblem(password), null);
// The same rules on UTF-8 bytes (moire-accounts never makes a string of a password); characters,
// not bytes, are counted, and malformed UTF-8 is refused.
for (const password of ["eight ch", "Zoë · 密码 ok", "🔑🔑🔑🔑🔑🔑🔑🔑", "x".repeat(256)]) {
  assert.equal(passwordBytesProblem(Buffer.from(password)), null, password);
  assert.equal(passwordProblem(password), null, password);
}
for (const password of [
  "short",
  "line\nbreak!",
  "nul\0inside",
  "cr\rinside",
  "x".repeat(257),
  "密码密码密码7",
])
  assert.equal(
    passwordBytesProblem(Buffer.from(password)) === null,
    passwordProblem(password) === null,
    JSON.stringify(password),
  );
assert.notEqual(passwordBytesProblem(Buffer.from("密码密码密码7")), null, "seven characters");
for (const bytes of [
  [0xc0, 0xaf, ...Buffer.from("overlong")], // overlong '/'
  [0xed, 0xa0, 0x80, ...Buffer.from("surrogate")],
  [0xf4, 0x90, 0x80, 0x80, ...Buffer.from("too high!")],
  [0xff, ...Buffer.from("not utf-8")],
  [...Buffer.from("truncated"), 0xe2, 0x82],
  [...Buffer.from("loose cont"), 0x80],
])
  assert.equal(passwordBytesProblem(Buffer.from(bytes)), "That password can't be used.");

// Remote errors: our names map to codes; foreign names never leak their text.
assert.deepEqual(
  remoteSettingsFailure(
    "org.moire.Accounts1",
    new DbusRemoteError(
      "org.moire.Accounts1.Error.wrong_password",
      "That password is not correct.",
    ),
    "fallback",
  ),
  { ok: false, code: "wrong_password", message: "That password is not correct." },
);
assert.deepEqual(
  remoteSettingsFailure(
    "org.moire.Accounts1",
    new DbusRemoteError("org.freedesktop.Accounts.Error.Failed", "usermod: secret detail"),
    "fallback",
  ),
  { ok: false, code: "unknown", message: "fallback" },
);

// Parsers reject malformed status.
assert.throws(() => parseTimeStatus({ kind: "ready", timeZone: "../x" }));
assert.throws(() => parseAccountsStatus({ kind: "ready", users: [{ uid: -1 }] }));
assert.equal(parseZoneCatalog("").length, 1);

// Time fake.
const time = createFakeTimeSettingsClient();
const seen: string[] = [];
time.subscribe((state) => {
  if (state.kind === "ready" && state.status.kind === "ready") seen.push(state.status.timeZone);
});
assert((await time.setTimeZone("Asia/Tokyo")).ok);
time.failNext("permission");
const denied = await time.setTimeZone("Europe/Paris");
assert(!denied.ok && denied.code === "permission");
assert.deepEqual(seen, ["Europe/London", "Asia/Tokyo"]);

// Accounts fake mirrors the services' rules: an administrator change raises the password
// prompt (here a stand-in) exactly once, one's own name doesn't, another user's name and
// picture aren't offered, and a dismissed prompt changes nothing.
let prompts = 0;
let answer: "authorized" | "cancelled" = "cancelled";
const accounts = createFakeAccountsSettingsClient({
  prompt: async () => {
    prompts++;
    return answer;
  },
});
assert((await accounts.setRealName(1000, "Josh")).ok, "own name needs no prompt");
assert.equal(prompts, 0);
const othersName = await accounts.setRealName(1001, "Visitor");
assert(!othersName.ok && othersName.code === "invalid");
const othersIcon = await accounts.setIcon(1001, null);
assert(!othersIcon.ok && othersIcon.code === "invalid");
assert.equal(prompts, 0, "nothing to ask a password for");
const dismissed = await accounts.setAccountType(1001, "administrator");
assert(!dismissed.ok && dismissed.code === "cancelled");
assert.equal(prompts, 1);
const unchanged = accounts.state;
assert(unchanged.kind === "ready" && unchanged.status.kind === "ready");
assert.equal(
  unchanged.status.users[1]!.accountType,
  "standard",
  "a dismissed prompt changes nothing",
);
answer = "authorized";
const created = await accounts.createUser({
  username: "alice",
  realName: "Alice",
  accountType: "standard",
  password: "long enough",
});
assert(created.ok && created.value.uid === 1002);
assert.equal(prompts, 2, "adding a user with a password is one prompt");
const self = await accounts.deleteUser(1000, { keepHome: true });
assert(!self.ok && self.code === "invalid");
const last = await accounts.setAccountType(1000, "standard");
assert(!last.ok && last.code === "invalid");
const wrong = await accounts.changePassword("nope nope", "long enough");
assert(!wrong.ok && wrong.code === "wrong_password");
assert((await accounts.changePassword(FAKE_ACCOUNTS_PASSWORD, "long enough")).ok);
assert(!accounts.calls.some((call) => call.includes(FAKE_ACCOUNTS_PASSWORD)));
// The unlock is gone from the client, the status and the codes.
assert(!("authenticate" in accounts) && !("lock" in accounts));
assert(unchanged.status.policy && !("unlockSeconds" in unchanged.status.policy));
assert.deepEqual(
  remoteSettingsFailure(
    "org.moire.Accounts1",
    new DbusRemoteError(
      "org.moire.Accounts1.Error.cancelled",
      "The password request was cancelled.",
    ),
    "fallback",
  ),
  { ok: false, code: "cancelled", message: "The password request was cancelled." },
);
assert.equal(
  remoteSettingsFailure(
    "org.moire.Accounts1",
    new DbusRemoteError("org.moire.Accounts1.Error.auth_required", "Unlock first."),
    "fallback",
  ).code,
  "unknown",
  "auth_required is no longer a code",
);
// A standard user is prompted like anyone: an administrator answers.
const standardAccounts = createFakeAccountsSettingsClient();
const ready = standardAccounts.state;
assert(ready.kind === "ready" && ready.status.kind === "ready");
standardAccounts.emit({
  ...ready.status,
  policy: { ...ready.status.policy, canAdminister: false },
});
assert((await standardAccounts.setPassword(1001, "visitor pw 1")).ok);

// Login settings: moire-dm-settings' status as the session user sees it, and the fake's prompt.
const dmStatus = (user: string | null) =>
  JSON.stringify({ version: 1, enabled: user !== null, user, session: null, problem: null });
assert.deepEqual(parseLoginManagerStatus(dmStatus("joshua"), "joshua"), {
  kind: "ready",
  available: true,
  enabled: true,
  user: "joshua",
});
assert.equal(parseLoginManagerStatus(dmStatus("guest"), "joshua").kind, "ready");
assert.deepEqual(parseLoginManagerStatus(dmStatus(null), "joshua"), {
  kind: "ready",
  available: true,
  enabled: false,
  user: null,
});
assert.throws(() =>
  parseLoginManagerStatus(JSON.stringify({ version: 1, enabled: true, user: null }), "joshua"),
);
assert.throws(() => parseLoginManagerStatus(JSON.stringify({ version: 1, enabled: "yes" }), "x"));
assert.throws(() => parseLoginManagerStatus({ version: 1 }, "joshua"), "only the wire string");
let loginAnswer: "authorized" | "cancelled" = "cancelled";
const login = createFakeLoginSettingsClient({ prompt: async () => loginAnswer });
const loginDismissed = await login.setAutologin(true);
assert(!loginDismissed.ok && loginDismissed.code === "cancelled");
assert.equal(
  login.state.kind === "ready" && login.state.status.kind === "ready" && login.state.status.user,
  null,
);
loginAnswer = "authorized";
assert((await login.setAutologin(true)).ok);
assert.equal(
  login.state.kind === "ready" && login.state.status.kind === "ready" && login.state.status.user,
  "joshua",
);
let loginRefusal: "authorized" | "refused" = "refused";
const pausedLogin = createFakeLoginSettingsClient({ prompt: async () => loginRefusal });
const refusedOnce = await pausedLogin.setAutologin(true);
assert(!refusedOnce.ok && refusedOnce.code === "refused");
loginRefusal = "authorized";
assert((await pausedLogin.setAutologin(true)).ok);
const greetd = createFakeLoginSettingsClient({
  status: { kind: "ready", available: false, enabled: false, user: null },
});
const refusedLogin = await greetd.setAutologin(true);
assert(!refusedLogin.ok && refusedLogin.code === "unavailable");

console.log("[settings-clients.smoke] ok");
