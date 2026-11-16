/**
 * Users & Login with the system's password prompt (docs/polkit-agent.md). Settings has no
 * authorization sheet of its own any more:
 *
 * - **Automatic login:** the switch calls moire-dm-settings at once (Settings itself, so the
 *   prompt names Settings), raises exactly one prompt per change, says "Waiting for your
 *   password" while it is up, and shows nothing at all when the prompt is dismissed.
 * - **Other accounts:** no Unlock row. Add a user and the per-user actions are there for
 *   everyone; the data-entry sheets stay and wait in the same way.
 * - **A standard user** can ask too, and is told an administrator's password is needed.
 * - **greetd** (no moire-dm): no automatic-login switch.
 * - **Refused unseen** (paused after cancels, or a full queue): a calm line beside the control,
 *   no error banner.
 * - **Keyboard focus** goes back to the switch when its prompt ends, and to "Add a user…" when
 *   its sheet closes.
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
const PAUSED = "Password requests are paused. Try again in a little while.";
const ERROR_BANNER = "That didn't work";
const KEY = { tab: 15, space: 57 } as const;
type Answer = "authorized" | "cancelled" | "refused";
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
  const waiting: ((answer: Answer) => void)[] = [];
  let asked = 0;
  return {
    prompt: () =>
      new Promise<Answer>((resolve) => {
        asked++;
        waiting.push(resolve);
      }),
    get open() {
      return waiting.length;
    },
    /** Prompts raised so far: one per change (moire-accounts and moire-dm-settings ask once). */
    get asked() {
      return asked;
    },
    answer(answer: Answer) {
      const resolve = waiting.shift();
      assert.ok(resolve, "no prompt is open");
      resolve(answer);
    },
  };
}

/** The fake accounts, as a standard user sees them. */
function standardAccounts(prompt?: () => Promise<Answer>) {
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
    const askedBeforeOn = system.asked;
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
    await app.settle(3);
    assert.equal(system.asked, askedBeforeOn + 1, "one prompt to turn on automatic login");
    assert.equal(system.open, 0, "and no second one after it");
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
    const askedBeforeAdd = system.asked;
    app.press({ focusId: "users:submit" });
    await shows(app, WAITING);
    system.answer("authorized");
    await app.until(
      () => app.texts().some((text) => text.startsWith("alice · Standard")),
      `No new account: ${app.texts().slice(0, 80).join(" | ")}`,
    );
    assert.deepEqual(accounts.calls, ["CreateUser", "CreateUser"]);
    // A user with a password: one prompt, and no second one after it.
    await app.settle(3);
    assert.equal(system.asked, askedBeforeAdd + 1, "one prompt to add a user");
    assert.equal(system.open, 0);

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
    const askedBeforeDelete = system.asked;
    app.press({ focusId: "users:delete" });
    await shows(app, WAITING);
    system.answer("authorized");
    await hides(app, "Delete Guest?");
    await app.settle(3);
    assert.equal(system.asked, askedBeforeDelete + 1, "one prompt to delete a user");
    assert.equal(system.open, 0);
    await app.until(
      () => !app.texts().some((text) => text.startsWith("guest · Standard")),
      "Guest is still listed",
    );
    absent(app, GONE);
    app.destroy();
  }

  // ---- Keyboard only: focus stays with the control that raised the prompt, and a request the
  // system turns away unseen is said calmly beside it.
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
    const focused = () => (app.window as unknown as { focusedId: string | null }).focusedId;
    const tabTo = (focusId: string) => {
      for (let step = 0; step < 80 && focused() !== focusId; step++) app.key(KEY.tab, "Tab");
      assert.equal(focused(), focusId, `Tab never reached ${focusId}`);
    };
    const space = () => app.key(KEY.space, " ", { text: " " });

    // The switch is disabled while the prompt is up; Escape there brings focus back to it.
    tabTo(TOGGLE);
    space();
    await shows(app, WAITING);
    system.answer("cancelled");
    await hides(app, WAITING);
    assert.equal(focused(), TOGGLE, "focus is back on the switch");
    // ...so Space works at once, without a Tab first.
    space();
    await shows(app, WAITING);
    assert.deepEqual(login.calls, ["SetAutomaticLogin:true", "SetAutomaticLogin:true"]);

    // Turned away without a prompt: said beside the switch, calmly, and not as an error.
    system.answer("refused");
    await shows(app, PAUSED);
    absent(app, [ERROR_BANNER, CANCELLED]);
    assert.equal(focused(), TOGGLE);
    shot(app, "users-autologin-refused");
    // Trying again clears it; a dismissal still says nothing.
    space();
    await shows(app, WAITING);
    absent(app, [PAUSED]);
    system.answer("cancelled");
    await hides(app, WAITING);
    absent(app, [PAUSED, ERROR_BANNER]);
    // Queued behind another prompt, then refused unseen (a flood pause began meanwhile): the
    // row waits as long as it takes, then says the same calm sentence. The service learns the
    // reason from the compositor, not from how fast the answer came.
    space();
    await shows(app, WAITING);
    await new Promise((resolve) => setTimeout(resolve, 600));
    await app.settle(10);
    assert.ok(app.texts().includes(WAITING), "still waiting while queued");
    absent(app, [PAUSED]);
    system.answer("refused");
    await shows(app, PAUSED);
    await hides(app, WAITING);
    absent(app, [ERROR_BANNER, CANCELLED]);
    assert.equal(focused(), TOGGLE);
    space();
    await shows(app, WAITING);
    system.answer("cancelled");
    await hides(app, WAITING);
    absent(app, [PAUSED, ERROR_BANNER]);

    // Add a user from the keyboard: refused, the sheet stays and says so; then added, and the
    // sheet closes with focus back on "Add a user…".
    tabTo("setting:users:add");
    space();
    await shows(app, "Add a user");
    assert.equal(focused(), "users:field:realName");
    app.type("Alice Example");
    app.key(KEY.tab, "Tab");
    app.type("alice");
    app.key(KEY.tab, "Tab");
    app.type("long enough pw");
    tabTo("users:submit");
    space();
    await shows(app, WAITING);
    system.answer("refused");
    await shows(app, PAUSED);
    assert.ok(app.texts().includes("Add a user"), "the sheet stays open");
    absent(app, [ERROR_BANNER]);
    assert.equal(focused(), "users:submit", "focus is back on the button that asked");
    shot(app, "users-add-refused");
    space();
    await shows(app, WAITING);
    system.answer("authorized");
    await hides(app, "Username");
    await app.settle(6);
    assert.ok(app.texts().some((text) => text.startsWith("alice · Standard")));
    assert.equal(focused(), "setting:users:add", "focus is back on the row that opened it");
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
