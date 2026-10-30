/**
 * Users & Login with the system's password prompt (docs/polkit-agent.md). Settings has no
 * authorization sheet of its own any more:
 *
 * - **Automatic login:** the switch calls the service at once, says "Waiting for your password"
 *   while the system's prompt is up, and shows nothing at all when the prompt is dismissed.
 * - **Other accounts:** no Unlock row. Add a user and the per-user actions are there for
 *   everyone; the data-entry sheets stay and wait in the same way.
 * - **A standard user** can ask too, and is told an administrator's password is needed.
 * - **greetd** (no moire-dm): no automatic-login switch.
 *
 * The fakes' `prompt` stands in for the compositor's prompt. `SETTINGS_PNG_DIR` saves pictures.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { loadSettings } from "@moire/prefs";
import { withFixture } from "@moire/app-tools/testing";
import {
  createFakeAccountsSettingsClient,
  type AccountsStatus,
} from "@moire/system-management/accounts-settings";
import { createFakeLoginSettingsClient } from "@moire/system-management/login-settings";
import { settingsFixture } from "./testing";
import { mountSettings, overflow } from "./testing-ui";

const pictures = process.env.SETTINGS_PNG_DIR;
type App = Awaited<ReturnType<typeof mountSettings>>;
const shot = (app: App, name: string) => {
  if (pictures) app.screenshot(path.join(pictures, `${name}.png`));
};
const TOGGLE = "setting:users.autologin";
const SIZE = { width: 1020, height: 900 };
const WAITING = "Waiting for your password";
const WAITING_ADMIN = "Waiting for an administrator's password";
const NEEDS_ADMIN = "Needs an administrator's password";
const CANCELLED = "The password request was cancelled.";
/** Text of the sheets that are gone. */
const GONE = [
  "Unlock to change accounts",
  "Unlock…",
  "Unlock account changes",
  "Turn on automatic login",
  "Turn off automatic login",
  "Your password",
  "Only administrators can turn this on",
];

/** The system's prompt, held open until the smoke answers it. */
function heldPrompt() {
  const waiting: ((answer: "authorized" | "cancelled") => void)[] = [];
  return {
    prompt: () => new Promise<"authorized" | "cancelled">((resolve) => waiting.push(resolve)),
    get open() {
      return waiting.length;
    },
    answer(answer: "authorized" | "cancelled") {
      const resolve = waiting.shift();
      assert.ok(resolve, "no prompt is open");
      resolve(answer);
    },
  };
}

/** The fake accounts, as a standard user sees them. */
function standardAccounts(prompt?: () => Promise<"authorized" | "cancelled">) {
  const accounts = createFakeAccountsSettingsClient({ prompt });
  const state = accounts.state;
  assert(state.kind === "ready" && state.status.kind === "ready");
  const status: AccountsStatus = {
    ...state.status,
    users: state.status.users.map((user) => ({
      ...user,
      accountType: user.self ? "standard" : "administrator",
    })),
    policy: { ...state.status.policy, canAdminister: false },
  };
  accounts.emit(status);
  return accounts;
}

await withFixture(async () => {
  const shows = (app: App, text: string) =>
    app.until(
      () => app.texts().includes(text),
      `Missing “${text}”: ${app.texts().slice(0, 80).join(" | ")}`,
    );
  const hides = (app: App, text: string) =>
    app.until(() => !app.texts().includes(text), `Still showing “${text}”`);
  const absent = (app: App, texts: readonly string[]) => {
    for (const text of texts) assert.ok(!app.texts().includes(text), `Unexpected “${text}”`);
  };

  // ---- Administrator: the switch calls the service; the system asks for the password.
  {
    const system = heldPrompt();
    const accounts = createFakeAccountsSettingsClient({ prompt: system.prompt });
    const login = createFakeLoginSettingsClient({ prompt: system.prompt });
    const fixture = settingsFixture(loadSettings(), {
      page: "users",
      services: { accounts, login },
    });
    const app = await mountSettings(fixture, SIZE);
    await shows(app, "Automatic login");
    await shows(app, "Start without asking for your password");
    absent(app, [...GONE, NEEDS_ADMIN]);
    assert.deepEqual(overflow(app, SIZE.width, SIZE.height), []);
    shot(app, "users-autologin-off");

    // On: no sheet, the call is made at once, and the row says what it is waiting for.
    app.press({ focusId: TOGGLE });
    await shows(app, WAITING);
    assert.deepEqual(login.calls, ["SetAutomaticLogin:true"]);
    assert.equal(system.open, 1);
    absent(app, GONE);
    assert.throws(() => app.press({ focusId: "users:field:password" }), /No visible control/);
    assert.throws(
      () => app.press({ focusId: TOGGLE }),
      /No visible control/,
      "one request at a time",
    );
    assert.deepEqual(overflow(app, SIZE.width, SIZE.height), []);
    shot(app, "users-autologin-waiting");
    system.answer("authorized");
    await shows(app, "On · starts without asking for your password");
    absent(app, [WAITING]);
    shot(app, "users-autologin-on");

    // Off, but the prompt is dismissed: still on, and nothing is said.
    app.press({ focusId: TOGGLE });
    await shows(app, WAITING);
    system.answer("cancelled");
    await hides(app, WAITING);
    await app.settle(3);
    assert.ok(app.texts().includes("On · starts without asking for your password"));
    absent(app, [CANCELLED, "Fake cancelled", ...GONE]);
    assert.deepEqual(login.calls, ["SetAutomaticLogin:true", "SetAutomaticLogin:false"]);

    // A real refusal is still shown, as the service's sentence.
    login.failNext("permission");
    app.press({ focusId: TOGGLE });
    await shows(app, "Fake permission");
    // Off for real.
    app.press({ focusId: TOGGLE });
    await shows(app, WAITING);
    system.answer("authorized");
    await shows(app, "Start without asking for your password");
    await hides(app, "Fake permission");
    // Someone else's automatic login is named, and isn't shown as on for you.
    login.emit({ kind: "ready", available: true, enabled: false, user: "guest" });
    await shows(app, "On for guest");

    // Other accounts: no unlock step. Add a user is a data-entry sheet that waits for the prompt.
    app.press({ text: "Add a user…" });
    await shows(app, "Add a user");
    app.press({ focusId: "users:field:realName" });
    app.type("Alice Example");
    app.press({ focusId: "users:field:username" });
    app.type("alice");
    app.press({ focusId: "users:field:password" });
    app.type("long enough pw");
    assert.deepEqual(accounts.calls, [], "nothing is asked before the form is submitted");
    app.press({ focusId: "users:submit" });
    await shows(app, WAITING);
    assert.deepEqual(accounts.calls, ["CreateUser"]);
    assert.deepEqual(overflow(app, SIZE.width, SIZE.height), []);
    shot(app, "users-add-waiting");
    // Dismissed: the sheet and what was typed stay, with no error.
    system.answer("cancelled");
    await hides(app, WAITING);
    await app.settle(3);
    assert.ok(app.texts().includes("Add a user"), "the sheet stays open");
    absent(app, [CANCELLED, "Fake cancelled"]);
    assert.ok(!app.texts().includes("Alice Example · alice"), "nothing was created");
    // Again, answered: the account appears and the sheet closes.
    app.press({ focusId: "users:submit" });
    await shows(app, WAITING);
    system.answer("authorized");
    await app.until(
      () => app.texts().some((text) => text.startsWith("alice · Standard")),
      `No new account: ${app.texts().slice(0, 80).join(" | ")}`,
    );
    assert.deepEqual(accounts.calls, ["CreateUser", "CreateUser"]);

    // A user's sheet opens straight away; deleting is a confirmation that waits the same way.
    await hides(app, "Username");
    await app.settle(6);
    app.press({ text: "guest · Standard · never logged in" });
    await shows(app, "Delete account");
    app.press({ focusId: "setting:delete" });
    await shows(app, "Delete Guest?");
    app.press({ focusId: "users:delete" });
    await shows(app, WAITING);
    system.answer("cancelled");
    await hides(app, WAITING);
    assert.ok(app.texts().includes("Delete Guest?"), "the confirmation stays open");
    absent(app, [CANCELLED]);
    app.press({ focusId: "users:delete" });
    await shows(app, WAITING);
    system.answer("authorized");
    await hides(app, "Delete Guest?");
    await app.until(
      () => !app.texts().some((text) => text.startsWith("guest · Standard")),
      "Guest is still listed",
    );
    absent(app, GONE);
    app.destroy();
  }

  // ---- Standard user: the switch works, and says whose password it takes.
  {
    const system = heldPrompt();
    const accounts = standardAccounts(system.prompt);
    const login = createFakeLoginSettingsClient({ prompt: system.prompt });
    const fixture = settingsFixture(loadSettings(), {
      page: "users",
      services: { accounts, login },
    });
    const app = await mountSettings(fixture, SIZE);
    await shows(app, NEEDS_ADMIN);
    absent(app, GONE);
    assert.ok(app.texts().includes("Add a user…"), "a standard user may ask to add a user");
    assert.deepEqual(overflow(app, SIZE.width, SIZE.height), []);
    shot(app, "users-autologin-standard");
    app.press({ focusId: TOGGLE });
    await shows(app, WAITING_ADMIN);
    absent(app, [WAITING]);
    assert.deepEqual(login.calls, ["SetAutomaticLogin:true"]);
    shot(app, "users-autologin-standard-waiting");
    system.answer("cancelled");
    await shows(app, NEEDS_ADMIN);
    absent(app, [CANCELLED, WAITING_ADMIN]);
    app.press({ focusId: TOGGLE });
    await shows(app, WAITING_ADMIN);
    system.answer("authorized");
    await shows(app, "On · starts without asking for your password");
    app.destroy();
  }

  // ---- Standard user while an administrator has it on: whose it is; the switch still asks.
  {
    const login = createFakeLoginSettingsClient({
      status: { kind: "ready", available: true, enabled: false, user: "moire-admin-test" },
    });
    const fixture = settingsFixture(loadSettings(), {
      page: "users",
      services: { accounts: standardAccounts(), login },
    });
    const app = await mountSettings(fixture, SIZE);
    await shows(app, "On for moire-admin-test");
    app.press({ focusId: TOGGLE });
    await shows(app, "On · starts without asking for your password");
    assert.deepEqual(login.calls, ["SetAutomaticLogin:true"]);
    app.destroy();
  }

  // ---- greetd (no moire-dm-settings): no switch at all.
  {
    const login = createFakeLoginSettingsClient({
      status: { kind: "ready", available: false, enabled: false, user: null },
    });
    const fixture = settingsFixture(loadSettings(), { page: "users", services: { login } });
    const app = await mountSettings(fixture, SIZE);
    await shows(app, "Your picture");
    await app.settle(3);
    assert.ok(!app.texts().includes("Automatic login"));
    app.destroy();
  }
});
console.log(
  "[settings/users] system prompt: waiting, dismissed silently, sheets for data only, standard users, greetd hidden",
);
