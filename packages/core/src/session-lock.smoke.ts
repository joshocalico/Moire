/**
 * The lock state machine on its own: lock and unlock, typing into the wiped buffer, the
 * authentication round trip (wrong, rate limited, unavailable, stale answers), and which locked
 * frame counts as presented. No compositor, no clock but a fake one.
 */
import assert from "node:assert/strict";
import { SessionLock, type LockAuthResult } from "./session-lock";
import { FakeClock } from "./idle-testing";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const utf8 = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));
const NO_MODS = { ctrl: false };
const KEY = { esc: 1, backspace: 14, enter: 28, u: 22, a: 30 };
let cases = 0;

/** A lock whose authenticator records (a copy of) what it was asked and answers on demand. */
function harness() {
  const clock = new FakeClock();
  const asked: { copy: string; secret: Uint8Array; answer(result: LockAuthResult): void }[] = [];
  let changes = 0;
  const lock = new SessionLock({
    timers: clock,
    wallNow: () => 1_000_000 + clock.now(),
    changed: () => changes++,
    authenticate: (secret) =>
      new Promise<LockAuthResult>((resolve) => {
        asked.push({ copy: Buffer.from(secret).toString("utf8"), secret, answer: resolve });
      }),
  });
  const type = (text: string) => {
    for (const char of Array.from(text)) lock.key(KEY.a, 1, utf8(char), NO_MODS);
  };
  const press = (code: number, mods = NO_MODS) => lock.key(code, 1, new Uint8Array(0), mods);
  return { clock, asked, lock, type, press, changes: () => changes };
}

// Lock, type, submit, unlock: the typed bytes are wiped at submit, the copy after the verdict.
{
  const h = harness();
  const events: string[] = [];
  h.lock.onLockedChanged((locked, reason) => events.push(`${locked}:${reason}`));
  assert.equal(h.lock.locked, false);
  h.type("hunter2");
  assert.equal(h.lock.typedBytes(), 0, "nothing is typed while unlocked");
  assert.equal(h.lock.lock("shortcut"), true);
  assert.equal(h.lock.lock("idle"), false, "an existing lock stands");
  assert.equal(h.lock.epoch, 1);
  h.type("hunter2");
  assert.equal(h.lock.entry().length, 7);
  assert.equal(h.lock.entry().phase, "entry");
  h.press(KEY.enter);
  assert.equal(h.lock.typedBytes(), 0, "submit wipes the field at once");
  assert.equal(h.lock.entry().phase, "checking");
  assert.equal(h.asked.length, 1);
  assert.equal(h.asked[0]!.copy, "hunter2");
  h.type("x");
  h.press(KEY.enter);
  assert.equal(h.asked.length, 1, "no second check while one is running");
  assert.equal(h.lock.typedBytes(), 0, "typing waits for the answer");
  h.asked[0]!.answer({ verdict: "ok" });
  await flush();
  assert.ok(
    h.asked[0]!.secret.every((byte) => byte === 0),
    "the secret handed out is zeroed",
  );
  assert.equal(h.lock.locked, false);
  assert.deepEqual(events, ["true:shortcut", "false:authenticated"]);
  cases++;
}

// Editing: UTF-8 backspace by code point, Escape and Ctrl+U clear, control text and shortcuts
// never become password bytes, the capacity holds.
{
  const h = harness();
  h.lock.lock("request");
  h.type("aé€😀");
  assert.equal(h.lock.entry().length, 4);
  assert.equal(h.lock.typedBytes(), 1 + 2 + 3 + 4);
  h.press(KEY.backspace);
  assert.equal(h.lock.entry().length, 3);
  assert.equal(h.lock.typedBytes(), 6, "the 4-byte emoji went as one");
  h.press(KEY.backspace);
  h.press(KEY.backspace);
  assert.equal(h.lock.typedBytes(), 1);
  h.lock.key(KEY.a, 1, new Uint8Array([0x09]), NO_MODS);
  h.lock.key(KEY.a, 1, new Uint8Array([0x7f]), NO_MODS);
  h.lock.key(KEY.a, 1, utf8("c"), { ctrl: true });
  h.lock.key(KEY.a, 1, utf8("l"), { ctrl: false, meta: true });
  assert.equal(h.lock.typedBytes(), 1, "tab, DEL, Ctrl+C and Super+L type nothing");
  h.lock.key(KEY.a, 2, utf8("a"), NO_MODS);
  assert.equal(h.lock.typedBytes(), 2, "auto-repeat types");
  h.lock.key(KEY.a, 0, utf8("a"), NO_MODS);
  assert.equal(h.lock.typedBytes(), 2, "releases do not");
  h.press(KEY.u, { ctrl: true });
  assert.equal(h.lock.typedBytes(), 0, "Ctrl+U clears");
  h.type("abc");
  h.press(KEY.esc);
  assert.equal(h.lock.typedBytes(), 0, "Escape clears");
  h.press(KEY.enter);
  assert.equal(h.asked.length, 0, "an empty field is never submitted");
  h.type("x".repeat(600));
  assert.equal(h.lock.typedBytes(), 512, "capacity holds");
  cases++;
}

// Wrong, then rate limited with a retry time; the lockout ends by itself.
{
  const h = harness();
  h.lock.lock("idle");
  h.type("nope");
  h.press(KEY.enter);
  h.asked[0]!.answer({ verdict: "wrong" });
  await flush();
  assert.equal(h.lock.locked, true);
  assert.deepEqual(
    { phase: h.lock.entry().phase, failures: h.lock.entry().failures },
    { phase: "wrong", failures: 1 },
  );
  h.type("n");
  assert.equal(h.lock.entry().phase, "entry", "typing again clears the notice");
  h.press(KEY.enter);
  h.asked[1]!.answer({ verdict: "rate_limited", retryInMs: 60_000 });
  await flush();
  assert.equal(h.lock.entry().phase, "rate-limited");
  assert.equal(h.lock.entry().retryAtMs, 1_000_000 + h.clock.now() + 60_000);
  h.type("again");
  h.press(KEY.enter);
  assert.equal(h.asked.length, 2, "no check during the lockout");
  assert.equal(h.lock.typedBytes(), 5, "typing is kept for after it");
  h.clock.advance(60_000);
  assert.equal(h.lock.entry().phase, "entry");
  assert.equal(h.lock.entry().retryAtMs, null);
  h.press(KEY.enter);
  assert.equal(h.asked.length, 3);
  cases++;
}

// Unavailable (helper missing or failing) and a throwing authenticator: still locked.
{
  const h = harness();
  h.lock.lock("idle");
  h.type("pw");
  h.press(KEY.enter);
  h.asked[0]!.answer({ verdict: "unavailable" });
  await flush();
  assert.equal(h.lock.locked, true);
  assert.equal(h.lock.entry().phase, "unavailable");
  const throwing = new SessionLock({
    authenticate: () => {
      throw new Error("boom");
    },
  });
  throwing.lock("request");
  throwing.key(KEY.a, 1, utf8("p"), NO_MODS);
  throwing.submit();
  await flush();
  assert.equal(throwing.locked, true, "a throwing check fails closed");
  assert.equal(throwing.entry().phase, "unavailable");
  const none = new SessionLock();
  none.lock("request");
  none.key(KEY.a, 1, utf8("p"), NO_MODS);
  none.submit();
  assert.equal(none.locked, true, "no authenticator: locked, never unlocked");
  assert.equal(none.typedBytes(), 0);
  cases++;
}

// An answer for an earlier lock never unlocks a later one.
{
  const h = harness();
  h.lock.lock("idle");
  h.type("old");
  h.press(KEY.enter);
  h.lock.unlock("logind");
  h.lock.lock("idle");
  h.asked[0]!.answer({ verdict: "ok" });
  await flush();
  assert.equal(h.lock.locked, true, "a stale 'ok' is ignored");
  assert.ok(
    h.asked[0]!.secret.every((byte) => byte === 0),
    "and its secret still wiped",
  );
  cases++;
}

// Presentation: only a locked frame for this lock's epoch counts; unlocking releases waiters.
{
  const h = harness();
  assert.equal(await h.lock.whenPresented(), false, "unlocked: nothing to wait for");
  h.lock.lock("suspend");
  let presented: boolean | null = null;
  void h.lock.whenPresented().then((value) => (presented = value));
  h.lock.markPresented(0);
  await flush();
  assert.equal(presented, null, "a frame from before the lock does not count");
  h.lock.markPresented(1);
  await flush();
  assert.equal(presented, true);
  assert.equal(await h.lock.whenPresented(), true, "already on screen: at once");
  h.lock.unlock("logind");
  h.lock.lock("suspend");
  let second: boolean | null = null;
  void h.lock.whenPresented().then((value) => (second = value));
  h.lock.markPresented(1);
  await flush();
  assert.equal(second, null, "the previous lock's frame does not count for this one");
  h.lock.unlock("logind");
  await flush();
  assert.equal(second, false, "unlocking first resolves false");
  cases++;
}

// The password never appears in the view, the change count, or anything logged.
{
  const logged: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  for (const name of ["log", "warn", "error"] as const)
    console[name] = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  try {
    const h = harness();
    h.lock.lock("request");
    h.type("Sup3r-Secret!");
    const view = JSON.stringify(h.lock.entry());
    assert.ok(!view.includes("Sup3r"), "the view carries only the length");
    h.press(KEY.enter);
    h.asked[0]!.answer({ verdict: "wrong" });
    await flush();
    assert.ok(h.changes() > 0);
  } finally {
    Object.assign(console, original);
  }
  assert.ok(!logged.join("\n").includes("Sup3r"), "nothing logged the password");
  cases++;
}

console.log(`[session-lock] ${cases} cases PASS`);
