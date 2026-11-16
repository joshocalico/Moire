/**
 * Settings' automatic-login client → moire-dm-settings (org.moire.LoginManager1), with a fake
 * moire-dm-settings standing in for its polkit check and a fake compositor (why a prompt was
 * dismissed), on one private bus. The real service's own checks are in
 * apps/system/moire-dm/src/login-manager.smoke.ts.
 *
 * - Settings calls moire-dm-settings itself, from its own system-bus connection, once per
 *   change and with interaction allowed: polkit's subject is Settings, so the prompt names it.
 *   The management service is not in the path.
 * - A dismissal's reason comes from the compositor, asked on Settings' own session-bus
 *   connection: `refused` (at once or after queueing) is `refused`; cancelled, locked, unknown
 *   or no compositor is `cancelled`.
 * - Only fixed sentences reach Settings; without moire-dm-settings the switch is unavailable.
 */
import assert from "node:assert/strict";
import { ALLOW_INTERACTIVE_AUTHORIZATION, DbusRemoteError } from "@moire/dbus";
import {
  LOGIN_MANAGER_BUS,
  LOGIN_MANAGER_INTERFACE,
  LOGIN_MANAGER_PATH,
  SET_AUTOLOGIN_ACTION,
  createLoginSettingsClient,
  parseLoginManagerStatus,
  type LoginSettingsClient,
  type LoginStatus,
} from "@moire/system-management/login-settings";
import { PROMPT_TIMEOUT_MS } from "@moire/system-management/accounts-settings";
import {
  compositorDismissalLookup,
  SECURE_PROMPT_BUS,
  SECURE_PROMPT_INTERFACE,
  SECURE_PROMPT_PATH,
} from "@moire/system-management/prompt-outcome";
import { startPrivateBus, until } from "./private-bus.testing";

/** A person takes this long to dismiss a prompt, longer than the prompt's 400 ms arming. */
const HUMAN_MS = 450;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PAUSED = {
  ok: false,
  code: "refused",
  message: "Password requests are paused. Try again in a little while.",
};
const CANCELLED = { ok: false, code: "cancelled", message: "The password request was cancelled." };

// The status parser: moire-dm-settings' JSON, seen by the session user.
const raw = (user: string | null) =>
  JSON.stringify({
    version: 1,
    enabled: user !== null,
    user,
    session: user ? "moire" : null,
    problem: null,
  });
assert.deepEqual(parseLoginManagerStatus(raw("joshua"), "joshua"), {
  kind: "ready",
  available: true,
  enabled: true,
  user: "joshua",
});
assert.deepEqual(parseLoginManagerStatus(raw("guest"), "joshua"), {
  kind: "ready",
  available: true,
  enabled: false,
  user: "guest",
});
for (const bad of [
  "{}",
  JSON.stringify({ version: 2, enabled: false, user: null }),
  JSON.stringify({ version: 1, enabled: true, user: null }),
  JSON.stringify({ version: 1, enabled: false, user: "joshua" }),
  JSON.stringify({ version: 1, enabled: true, user: "Not An Account" }),
  "x".repeat(5000),
  42,
])
  assert.throws(() => parseLoginManagerStatus(bad, "joshua"));
// Waits longer than the prompt (120 s) and moire-dm-settings' polkit question (140 s).
assert(PROMPT_TIMEOUT_MS > 140_000);

const bus = await startPrivateBus("moire-autologin-client-smoke-");
let client: LoginSettingsClient | null = null;
try {
  // Settings' two connections: the system bus (moire-dm-settings) and the session bus (the
  // compositor). In production both are the Settings process; the compositor keys the reason
  // by its pid, which this fake stands in for by the session connection's name.
  const settingsSystem = await bus.connect();
  const settingsSession = await bus.connect();

  // --- Fake compositor -----------------------------------------------------------------------
  const compositor = await bus.connect();
  const reasons = new Map<string, string>();
  const lookups: { sender: string; actionId: unknown }[] = [];
  compositor.exportObject(SECURE_PROMPT_PATH, {
    name: SECURE_PROMPT_INTERFACE,
    methods: {
      TakeDismissal: {
        inSignature: "s",
        outSignature: "s",
        handler: ({ message, body }) => {
          lookups.push({ sender: message.sender ?? "", actionId: body[0] });
          const reason =
            message.sender === settingsSession.name ? (reasons.get(String(body[0])) ?? "") : "";
          reasons.delete(String(body[0]));
          return { body: [reason] };
        },
      },
    },
  });
  assert.equal(await compositor.requestName(SECURE_PROMPT_BUS), 1);

  // --- Fake moire-dm-settings: its polkit check is "answer" ----------------------------------
  const manager = await bus.connect();
  let autologinUser: string | null = null;
  let statusOverride: string | null = null;
  /** null: authorized. "refused"/"cancelled"/"locked": a dismissal. Else an error name. */
  let answer: string | null = null;
  let dismissDelayMs = 0;
  let gate: Promise<void> | null = null;
  const managerCalls: { sender: string; enabled: unknown; flags: number }[] = [];
  /** polkit's subject for each check moire-dm-settings makes: the calling connection. */
  const subjects: string[] = [];
  manager.exportObject(LOGIN_MANAGER_PATH, {
    name: LOGIN_MANAGER_INTERFACE,
    methods: {
      GetStatus: {
        inSignature: "",
        outSignature: "s",
        handler: () => ({ body: [statusOverride ?? raw(autologinUser)] }),
      },
      SetAutomaticLogin: {
        inSignature: "b",
        outSignature: "",
        handler: async ({ message, body }) => {
          const sender = message.sender ?? "";
          managerCalls.push({ sender, enabled: body[0], flags: message.flags ?? 0 });
          subjects.push(sender);
          await gate;
          if (answer === "refused" || answer === "cancelled" || answer === "locked") {
            await pause(dismissDelayMs);
            reasons.set(SET_AUTOLOGIN_ACTION, answer);
            throw new DbusRemoteError(`${LOGIN_MANAGER_INTERFACE}.Error.cancelled`, "dismissed");
          }
          if (answer) throw new DbusRemoteError(answer, "daemon detail that must not leak");
          // The real service takes the account from the caller; this one plays "joshua".
          autologinUser = body[0] === true ? "joshua" : null;
          return {};
        },
      },
    },
  });
  assert.equal(await manager.requestName(LOGIN_MANAGER_BUS), 1);

  client = createLoginSettingsClient({
    connect: async () => settingsSystem,
    username: "joshua",
    promptDismissal: compositorDismissalLookup(settingsSession),
  });
  const login = client;
  const status = (): Extract<LoginStatus, { kind: "ready" }> => {
    const current = login.state;
    if (current.kind !== "ready" || current.status.kind !== "ready") throw new Error("not ready");
    return current.status;
  };
  const seen: string[] = [];
  login.subscribe((state) => seen.push(state.kind));
  await until(() => login.state.kind === "ready", "login ready");
  assert.deepEqual(status(), { kind: "ready", available: true, enabled: false, user: null });

  // On: one call per change, straight from Settings' own connection (polkit's subject, so the
  // prompt names Settings), saying it will wait for the prompt.
  assert.deepEqual(await login.setAutologin(true), { ok: true, value: undefined });
  assert.equal(managerCalls.length, 1);
  assert.equal(managerCalls[0]!.enabled, true);
  assert.equal(managerCalls[0]!.flags & ALLOW_INTERACTIVE_AUTHORIZATION, 4);
  assert.deepEqual(subjects, [settingsSystem.name], "Settings is the subject");
  assert.deepEqual(status(), { kind: "ready", available: true, enabled: true, user: "joshua" });
  assert.equal(lookups.length, 0, "no dismissal, no question to the compositor");

  // Someone else's: shown as theirs, not as on for this user.
  autologinUser = "guest";
  assert((await login.refresh()).ok);
  assert.deepEqual(status(), { kind: "ready", available: true, enabled: false, user: "guest" });

  // The prompt was dismissed by a person: `cancelled`, nothing changed, and the reason was
  // asked on Settings' own session connection, for the autologin action.
  answer = "cancelled";
  dismissDelayMs = HUMAN_MS;
  assert.deepEqual(await login.setAutologin(true), CANCELLED);
  assert.equal(status().user, "guest");
  assert.deepEqual(lookups.at(-1), {
    sender: settingsSession.name,
    actionId: SET_AUTOLOGIN_ACTION,
  });
  // Turned away unseen: `refused`, said calmly, at once or after queueing.
  answer = "refused";
  for (const delay of [0, HUMAN_MS]) {
    dismissDelayMs = delay;
    assert.deepEqual(await login.setAutologin(true), PAUSED, `refused after ${delay} ms`);
  }
  // Locked: `cancelled` (the person locked the screen themselves).
  answer = "locked";
  dismissDelayMs = 0;
  assert.deepEqual(await login.setAutologin(true), CANCELLED);
  // Policy refuses, or the daemon fails: our own sentences, never the daemon's text.
  answer = `${LOGIN_MANAGER_INTERFACE}.Error.permission`;
  const denied = await login.setAutologin(true);
  assert(!denied.ok && denied.code === "permission");
  assert(!denied.message.includes("daemon detail"));
  assert(!/administrators/i.test(denied.message), "a standard user may ask too");
  answer = `${LOGIN_MANAGER_INTERFACE}.Error.failed`;
  const broken = await login.setAutologin(false);
  assert(!broken.ok && broken.code === "failed" && !broken.message.includes("daemon detail"));
  answer = "org.example.Unknown";
  const odd = await login.setAutologin(false);
  assert(!odd.ok && odd.code === "failed" && !odd.message.includes("daemon detail"));
  // Every one of those was a single call: one polkit check, one prompt, per change.
  assert.equal(managerCalls.length, 8);
  assert(subjects.every((subject) => subject === settingsSystem.name));
  answer = null;

  // One change at a time from Settings: a second while the first waits is `busy`, uncalled.
  let release!: () => void;
  gate = new Promise<void>((resolve) => (release = resolve));
  const first = login.setAutologin(true);
  await until(() => managerCalls.length === 9, "first change asked");
  const second = await login.setAutologin(false);
  assert(!second.ok && second.code === "busy");
  release();
  assert((await first).ok);
  gate = null;
  assert.equal(managerCalls.length, 9);
  assert.equal(status().user, "joshua");
  assert((await login.setAutologin(false)).ok);
  assert.equal(status().user, null);

  // A status moire-dm-settings shouldn't send: an error state, not a guess.
  statusOverride = JSON.stringify({ version: 1, enabled: true, user: null });
  const unreadable = await login.refresh();
  assert(!unreadable.ok && unreadable.code === "failed");
  assert.equal(login.state.kind === "ready" && login.state.status.kind, "error");
  statusOverride = null;
  assert((await login.refresh()).ok);

  // No compositor to ask: no guessing from timing; a dismissal is said as nothing.
  compositor.close();
  await pause(50);
  answer = "refused";
  assert.deepEqual(await login.setAutologin(true), CANCELLED);
  answer = null;

  // Without moire-dm-settings (a greetd image): not available, so Settings shows no switch,
  // and a change is refused without a call.
  const before = managerCalls.length;
  manager.close();
  await pause(50);
  assert((await login.refresh()).ok);
  assert.deepEqual(status(), { kind: "ready", available: false, enabled: false, user: null });
  const missing = await login.setAutologin(true);
  assert(!missing.ok && missing.code === "unavailable");
  assert.equal(managerCalls.length, before);
  assert.equal(seen[0], "loading");

  console.log("[autologin-client.smoke] ok");
} finally {
  await client?.dispose();
  await bus.close();
}
