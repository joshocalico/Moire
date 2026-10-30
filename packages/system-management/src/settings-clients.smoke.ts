/** Wire parsers, validators and the fakes the Settings UI tests against. */
import assert from "node:assert/strict";
import {
  createFakeAccountsSettingsClient,
  FAKE_ACCOUNTS_PASSWORD,
  parseAccountsStatus,
  passwordProblem,
  realNameProblem,
  usernameProblem,
} from "./accounts-settings";
import { DbusRemoteError } from "@moire/dbus";
import { remoteSettingsFailure } from "./settings-service";
import { createFakeTimeSettingsClient, parseTimeStatus, parseZoneCatalog } from "./time-settings";
import { createFakeLoginSettingsClient, parseLoginStatus } from "./login-settings";

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

// Accounts fake mirrors the service's rules: changing another account raises the password
// prompt (here a stand-in), one's own doesn't, and a dismissed prompt changes nothing.
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
const dismissed = await accounts.setRealName(1001, "Visitor");
assert(!dismissed.ok && dismissed.code === "cancelled");
assert.equal(prompts, 1);
const unchanged = accounts.state;
assert(unchanged.kind === "ready" && unchanged.status.kind === "ready");
assert.equal(unchanged.status.users[1]!.realName, "Guest", "a dismissed prompt changes nothing");
answer = "authorized";
assert((await accounts.setRealName(1001, "Visitor")).ok);
const created = await accounts.createUser({
  username: "alice",
  realName: "Alice",
  accountType: "standard",
  password: "long enough",
});
assert(created.ok && created.value.uid === 1002);
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
assert((await standardAccounts.setRealName(1001, "Visitor")).ok);

// Login settings: status shape, and the fake's prompt.
assert.deepEqual(
  parseLoginStatus({ kind: "ready", available: true, enabled: true, user: "joshua" }),
  { kind: "ready", available: true, enabled: true, user: "joshua" },
);
assert.throws(() =>
  parseLoginStatus({ kind: "ready", available: true, enabled: true, user: null }),
);
assert.throws(() => parseLoginStatus({ kind: "ready", available: "yes" }));
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
const greetd = createFakeLoginSettingsClient({
  status: { kind: "ready", available: false, enabled: false, user: null },
});
const refusedLogin = await greetd.setAutologin(true);
assert(!refusedLogin.ok && refusedLogin.code === "unavailable");

console.log("[settings-clients.smoke] ok");
