/**
 * The secure prompt state machine on its own: typing into the wiped buffer, the check round trip
 * (rejected, throttled, unavailable, stale answers), the arming delay and held keys, the idle
 * timeout, the queue and its limit, the cancel cool-down, the lock, consent, and the answer in no
 * view. No compositor, no clock but a fake one.
 */
import assert from "node:assert/strict";
import { FakeClock } from "./idle-testing";
import {
  SECURE_PROMPT_ARMING_MS,
  SECURE_PROMPT_CAPACITY,
  SECURE_PROMPT_COOL_DOWN_MS,
  SECURE_PROMPT_FLOOD_COOL_DOWN_MS,
  SECURE_PROMPT_IDLE_MS,
  SECURE_PROMPT_WAIT_MS,
  SecurePromptQueue,
} from "./secure-prompt";
import type {
  SecurePromptIdentity,
  SecurePromptRequest,
  SecurePromptResult,
  SecurePromptVerdict,
} from "./secure-prompt-types";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const utf8 = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));
const NO_MODS = { ctrl: false };
const KEY = { esc: 1, backspace: 14, enter: 28, u: 22, a: 30, up: 103, down: 108 };
const ADA: SecurePromptIdentity = { account: "ada", displayName: "Ada Lovelace" };
const GRACE: SecurePromptIdentity = { account: "grace", displayName: "Grace Hopper" };
let cases = 0;

/** A queue whose checker records (a copy of) what it was asked and answers on demand. */
function harness() {
  const clock = new FakeClock();
  const asked: {
    account: string;
    copy: string;
    secret: Uint8Array;
    answer(verdict: SecurePromptVerdict): void;
  }[] = [];
  const shown: boolean[] = [];
  const floods: (string | null)[] = [];
  let changes = 0;
  const queue = new SecurePromptQueue({
    timers: clock,
    changed: () => changes++,
    shown: (visible) => shown.push(visible),
    flood: (requester) => floods.push(requester?.name ?? null),
  });
  const password = (patch: Partial<SecurePromptRequest> = {}): SecurePromptRequest => ({
    kind: "password",
    headline: "Authentication is required to add a user",
    requester: { name: "Settings", pid: 4242, x11: false },
    identities: [ADA],
    selected: 0,
    needsAdministrator: false,
    details: [{ label: "Action", value: "org.freedesktop.accounts.user-administration" }],
    check: (identity, secret) =>
      new Promise<SecurePromptVerdict>((resolve) => {
        asked.push({
          account: identity.account,
          copy: Buffer.from(secret).toString("utf8"),
          secret,
          answer: resolve,
        });
      }),
    ...patch,
  });
  /** Ask, and record the result when it settles. */
  const ask = (request: SecurePromptRequest) => {
    const handle = queue.request(request);
    const box: { result: SecurePromptResult | null; cancel(): void } = {
      result: null,
      cancel: () => handle.cancel(),
    };
    void handle.result.then((result) => (box.result = result));
    return box;
  };
  const arm = () => clock.advance(SECURE_PROMPT_ARMING_MS);
  const tap = (code: number, text = "", mods: { ctrl: boolean; meta?: boolean } = NO_MODS) => {
    queue.key(code, 1, utf8(text), mods);
    queue.key(code, 0, new Uint8Array(0), mods);
  };
  const type = (text: string) => {
    for (const char of Array.from(text)) tap(KEY.a, char);
  };
  return {
    clock,
    asked,
    shown,
    floods,
    queue,
    password,
    ask,
    arm,
    tap,
    type,
    changes: () => changes,
  };
}

// Type, submit, accepted: the typed bytes are wiped at submit, the copy after the verdict.
{
  const h = harness();
  assert.equal(h.queue.visible, false);
  assert.equal(h.queue.entry(), null);
  h.type("hunter2");
  assert.equal(h.queue.typedBytes(), 0, "nothing is typed with no prompt");
  const first = h.ask(h.password());
  assert.equal(h.queue.visible, true);
  assert.deepEqual(h.shown, [true]);
  h.arm();
  h.type("hunter2");
  const entry = h.queue.entry()!;
  assert.equal(entry.length, 7);
  assert.equal(entry.phase, "entry");
  assert.equal(entry.headline, "Authentication is required to add a user");
  assert.equal(entry.requester?.name, "Settings");
  h.tap(KEY.enter);
  assert.equal(h.queue.typedBytes(), 0, "submit wipes the field at once");
  assert.equal(h.queue.entry()!.phase, "checking");
  assert.equal(h.asked.length, 1);
  assert.equal(h.asked[0]!.copy, "hunter2");
  assert.equal(h.asked[0]!.account, "ada");
  h.type("x");
  h.tap(KEY.enter);
  assert.equal(h.asked.length, 1, "no second check while one is running");
  assert.equal(h.queue.typedBytes(), 0, "typing waits for the answer");
  h.asked[0]!.answer("accepted");
  await flush();
  assert.deepEqual(first.result, { outcome: "completed", identity: ADA });
  assert.ok(
    h.asked[0]!.secret.every((byte) => byte === 0),
    "the checker's copy is wiped after the verdict",
  );
  assert.equal(h.queue.visible, false);
  assert.deepEqual(h.shown, [true, false]);
  cases++;
}

// Editing: UTF-8 backspace, Ctrl+U, control text, shortcuts, the capacity, an empty submit.
{
  const h = harness();
  h.ask(h.password());
  h.arm();
  h.tap(KEY.enter);
  assert.equal(h.asked.length, 0, "an empty answer is not checked");
  h.type("aé😀");
  assert.equal(h.queue.entry()!.length, 3);
  assert.equal(h.queue.typedBytes(), 1 + 2 + 4);
  h.tap(KEY.backspace);
  assert.equal(h.queue.typedBytes(), 3, "backspace removes one whole character");
  h.tap(KEY.backspace);
  h.tap(KEY.backspace);
  h.tap(KEY.backspace);
  assert.equal(h.queue.typedBytes(), 0);
  h.tap(KEY.a, "\t");
  h.tap(KEY.a, "\u001b");
  h.tap(KEY.a, "a", { ctrl: true });
  h.tap(KEY.a, "a", { ctrl: false, meta: true });
  assert.equal(h.queue.typedBytes(), 0, "controls and shortcuts never type");
  h.type("abc");
  h.tap(KEY.u, "u", { ctrl: true });
  assert.equal(h.queue.typedBytes(), 0, "Ctrl+U clears");
  h.type("x".repeat(SECURE_PROMPT_CAPACITY));
  assert.equal(h.queue.typedBytes(), SECURE_PROMPT_CAPACITY);
  h.type("é");
  assert.equal(h.queue.typedBytes(), SECURE_PROMPT_CAPACITY, "nothing past the capacity");
  cases++;
}

// The arming delay: nothing counts for 400 ms, and a key held from before never types.
{
  const h = harness();
  const pending = h.ask(h.password());
  // Held since before the prompt: only repeats arrive.
  h.queue.key(KEY.a, 2, utf8("a"), NO_MODS);
  h.type("early");
  h.tap(KEY.esc);
  h.queue.action({ type: "cancel" });
  assert.equal(h.queue.typedBytes(), 0, "nothing types before the prompt is armed");
  assert.equal(h.queue.visible, true, "nor does Escape or a click cancel it");
  // A key pressed inside the window and still held afterwards stays ignored.
  h.queue.key(KEY.u, 1, utf8("u"), NO_MODS);
  h.arm();
  h.queue.key(KEY.u, 2, utf8("u"), NO_MODS);
  h.queue.key(KEY.a, 2, utf8("a"), NO_MODS);
  h.queue.key(KEY.enter, 2, new Uint8Array(0), NO_MODS);
  assert.equal(h.queue.typedBytes(), 0, "a held key's repeats never type");
  assert.equal(h.asked.length, 0, "and a held Enter never submits");
  // Released and pressed again, it types and repeats.
  h.queue.key(KEY.a, 0, new Uint8Array(0), NO_MODS);
  h.queue.key(KEY.a, 1, utf8("a"), NO_MODS);
  h.queue.key(KEY.a, 2, utf8("a"), NO_MODS);
  assert.equal(h.queue.typedBytes(), 2);
  h.tap(KEY.esc);
  await flush();
  assert.deepEqual(pending.result, { outcome: "cancelled" });
  assert.equal(h.queue.typedBytes(), 0, "cancel wipes");
  cases++;
}

// Rejected keeps the prompt open and counts; throttled and unavailable show; typing clears.
{
  const h = harness();
  const pending = h.ask(h.password());
  h.arm();
  h.type("wrong");
  h.tap(KEY.enter);
  h.asked[0]!.answer("rejected");
  await flush();
  assert.equal(pending.result, null, "a wrong password keeps the prompt open");
  assert.equal(h.queue.entry()!.phase, "wrong");
  assert.equal(h.queue.entry()!.failures, 1);
  h.type("a");
  assert.equal(h.queue.entry()!.phase, "entry", "typing clears the notice");
  h.tap(KEY.enter);
  h.asked[1]!.answer("throttled");
  await flush();
  assert.equal(h.queue.entry()!.phase, "throttled");
  assert.equal(h.queue.entry()!.failures, 1, "only a rejection shakes");
  h.type("a");
  h.tap(KEY.enter);
  h.asked[2]!.answer("unavailable");
  await flush();
  assert.equal(h.queue.entry()!.phase, "unavailable");
  assert.equal(pending.result, null);
  // A checker that throws, rejects or answers nonsense is "unavailable", never a grant.
  for (const check of [
    () => {
      throw new Error("boom");
    },
    () => Promise.reject(new Error("boom")),
    () => Promise.resolve("yes" as SecurePromptVerdict),
  ]) {
    const broken = harness();
    const result = broken.ask(broken.password({ check }));
    broken.arm();
    broken.type("a");
    broken.tap(KEY.enter);
    await flush();
    assert.equal(broken.queue.entry()!.phase, "unavailable");
    assert.equal(result.result, null);
  }
  const none = harness();
  none.ask(none.password({ check: undefined }));
  none.arm();
  none.type("a");
  none.tap(KEY.enter);
  assert.equal(none.queue.entry()!.phase, "unavailable", "no checker: unavailable");
  assert.equal(none.queue.typedBytes(), 0);
  cases++;
}

// A verdict for a prompt that already ended is dropped: a late "accepted" grants nothing.
{
  const h = harness();
  const first = h.ask(h.password());
  const second = h.ask(h.password({ headline: "Second" }));
  h.arm();
  h.type("secret");
  h.tap(KEY.enter);
  h.tap(KEY.esc);
  await flush();
  assert.deepEqual(first.result, { outcome: "cancelled" }, "Escape cancels even while checking");
  assert.equal(h.queue.entry()!.headline, "Second");
  h.asked[0]!.answer("accepted");
  await flush();
  assert.equal(second.result, null, "the stale verdict does not answer the next prompt");
  assert.equal(h.queue.entry()!.phase, "entry");
  assert.ok(h.asked[0]!.secret.every((byte) => byte === 0));
  cases++;
}

// Identities: the chooser clears what was typed and the check names the chosen account.
{
  const h = harness();
  const pending = h.ask(h.password({ identities: [ADA, GRACE], selected: 1 }));
  h.arm();
  assert.equal(h.queue.entry()!.selected, 1);
  h.type("for-grace");
  h.queue.action({ type: "identity", index: 0 });
  assert.equal(h.queue.entry()!.selected, 0);
  assert.equal(h.queue.typedBytes(), 0, "changing identity wipes the buffer");
  h.type("x");
  h.tap(KEY.down);
  assert.equal(h.queue.entry()!.selected, 1, "the arrow keys choose too");
  assert.equal(h.queue.typedBytes(), 0);
  h.tap(KEY.down);
  h.queue.action({ type: "identity", index: 7 });
  assert.equal(h.queue.entry()!.selected, 1, "never outside the list");
  h.type("pw");
  h.queue.action({ type: "submit" });
  assert.equal(h.asked[0]!.account, "grace");
  h.queue.action({ type: "identity", index: 0 });
  assert.equal(h.queue.entry()!.selected, 1, "no change while a check runs");
  h.asked[0]!.answer("accepted");
  await flush();
  assert.deepEqual(pending.result, { outcome: "completed", identity: GRACE });
  // More than eight are cut, a bad index falls back to the first, and none at all is refused.
  const many = harness();
  many.ask(
    many.password({
      identities: Array.from({ length: 12 }, (_, index) => ({
        account: `admin${index}`,
        displayName: `Admin ${index}`,
      })),
      selected: 11,
    }),
  );
  assert.equal(many.queue.entry()!.identities.length, 8);
  assert.equal(many.queue.entry()!.selected, 0);
  const nobody = harness();
  const refused = nobody.ask(nobody.password({ identities: [] }));
  await flush();
  assert.deepEqual(refused.result, { outcome: "refused" });
  assert.equal(nobody.queue.visible, false);
  cases++;
}

// The idle timeout: 120 s without a key or pointer event cancels; activity starts it over.
{
  const h = harness();
  const pending = h.ask(h.password());
  h.arm();
  h.type("half");
  h.clock.advance(SECURE_PROMPT_IDLE_MS - SECURE_PROMPT_ARMING_MS - 1000);
  h.queue.activity();
  h.clock.advance(SECURE_PROMPT_IDLE_MS - 1);
  await flush();
  assert.equal(pending.result, null, "activity restarted the timeout");
  assert.equal(h.queue.typedBytes(), 4);
  h.clock.advance(1);
  await flush();
  assert.deepEqual(pending.result, { outcome: "timed-out" });
  assert.equal(h.queue.typedBytes(), 0, "the timeout wipes");
  assert.equal(h.queue.visible, false);
  assert.equal(h.clock.pending, 0, "no timer is left behind");
  cases++;
}

// The queue: one visible, three waiting in arrival order, a fifth refused at once.
{
  const h = harness();
  const asks = ["A", "B", "C", "D", "E"].map((headline) => h.ask(h.password({ headline })));
  await flush();
  assert.deepEqual(asks[4]!.result, { outcome: "refused" }, "a fifth is refused at once");
  assert.equal(asks[3]!.result, null);
  assert.equal(h.queue.entry()!.headline, "A");
  assert.equal(h.queue.entry()!.waiting, 3);
  // The requester of C goes away while waiting: it leaves the queue without a prompt.
  asks[2]!.cancel();
  await flush();
  assert.deepEqual(asks[2]!.result, { outcome: "cancelled" });
  assert.equal(h.queue.entry()!.waiting, 2);
  h.arm();
  h.type("pw");
  h.tap(KEY.enter);
  h.asked[0]!.answer("accepted");
  await flush();
  assert.equal(h.queue.entry()!.headline, "B", "arrival order");
  assert.equal(h.queue.typedBytes(), 0);
  h.type("early");
  assert.equal(h.queue.typedBytes(), 0, "each prompt arms afresh");
  assert.deepEqual(h.shown, [true], "the layer stays up between prompts");
  // The visible one's requester goes away: closed without a message, and no cool-down.
  asks[1]!.cancel();
  await flush();
  assert.deepEqual(asks[1]!.result, { outcome: "cancelled" });
  assert.equal(h.queue.entry()!.headline, "D");
  asks[1]!.cancel(); // again: nothing
  // A request waits at most 120 s behind another prompt.
  const waiting = h.ask(h.password({ headline: "F" }));
  for (let step = 0; step < 4; step++) {
    h.clock.advance(SECURE_PROMPT_WAIT_MS / 4);
    h.queue.activity(); // the visible prompt is in use the whole time
  }
  await flush();
  assert.deepEqual(waiting.result, { outcome: "timed-out" });
  assert.equal(h.queue.entry()!.headline, "D");
  assert.equal(h.queue.entry()!.waiting, 0);
  cases++;
}

// The cancel cool-down: 2 s per key after a cancel; three within two minutes make it 5 minutes
// and raise one notification naming the program.
{
  const h = harness();
  const keyed = (coolDownKey: string) => h.password({ coolDownKey });
  const cancel = () => {
    h.arm();
    h.tap(KEY.esc);
  };
  const first = h.ask(keyed("settings:add-user"));
  cancel();
  await flush();
  assert.deepEqual(first.result, { outcome: "cancelled" });
  const again = h.ask(keyed("settings:add-user"));
  const other = h.ask(keyed("settings:autologin"));
  await flush();
  assert.deepEqual(again.result, { outcome: "refused" }, "the same key is refused unseen");
  assert.equal(other.result, null, "another key is not");
  assert.equal(h.queue.visible, true);
  other.cancel(); // the requester went away: no cool-down for that key
  await flush();
  const otherAgain = h.ask(keyed("settings:autologin"));
  assert.equal(h.queue.visible, true, "a withdrawn request starts no cool-down");
  otherAgain.cancel();
  h.clock.advance(SECURE_PROMPT_COOL_DOWN_MS);
  const later = h.ask(keyed("settings:add-user"));
  assert.equal(h.queue.visible, true, "asked again after the cool-down");
  assert.deepEqual(h.floods, []);
  cancel(); // second cancel, 30.4 s after the first
  await flush();
  assert.deepEqual(later.result, { outcome: "cancelled" });
  h.clock.advance(SECURE_PROMPT_COOL_DOWN_MS);
  const third = h.ask(keyed("settings:add-user"));
  cancel(); // third cancel, a minute after the first
  await flush();
  assert.deepEqual(third.result, { outcome: "cancelled" });
  assert.deepEqual(h.floods, ["Settings"], "one notification names the program");
  h.clock.advance(SECURE_PROMPT_FLOOD_COOL_DOWN_MS - 1);
  const blocked = h.ask(keyed("settings:add-user"));
  await flush();
  assert.deepEqual(blocked.result, { outcome: "refused" }, "refused for five minutes");
  h.clock.advance(1);
  const free = h.ask(keyed("settings:add-user"));
  assert.equal(h.queue.visible, true, "and asked again after them");
  free.cancel();
  assert.deepEqual(h.floods, ["Settings"], "still one notification");
  cases++;
}

// A flood: four of one key are waiting; one cancel answers them all and reports it once.
{
  const h = harness();
  const asks = Array.from({ length: 6 }, () => h.ask(h.password({ coolDownKey: "busctl:loop" })));
  const bystander = h.ask(h.password({ headline: "Other", coolDownKey: "files:mount" }));
  await flush();
  assert.deepEqual(
    asks.map((entry) => entry.result?.outcome ?? null),
    [null, null, null, null, "refused", "refused"],
    "one prompt, three waiting, the rest refused",
  );
  assert.deepEqual(bystander.result, { outcome: "refused" }, "the queue was full");
  h.arm();
  h.tap(KEY.esc);
  await flush();
  assert.deepEqual(
    asks.map((entry) => entry.result?.outcome),
    ["cancelled", "refused", "refused", "refused", "refused", "refused"],
    "no new prompt after the cancel",
  );
  assert.equal(h.queue.visible, false);
  assert.deepEqual(h.floods, ["Settings"], "one notification for the flood");
  assert.deepEqual(h.shown, [true, false]);
  cases++;
}

// The session lock cancels the visible prompt and holds the queue; nothing shows while locked.
{
  const h = harness();
  const visible = h.ask(h.password({ headline: "Visible" }));
  const queued = h.ask(h.password({ headline: "Queued" }));
  h.arm();
  h.type("partly");
  h.tap(KEY.enter);
  h.queue.setLocked(true);
  await flush();
  assert.deepEqual(visible.result, { outcome: "locked" });
  assert.equal(h.queue.visible, false, "no prompt over the lock screen");
  assert.equal(h.queue.entry(), null);
  assert.equal(h.queue.typedBytes(), 0, "the lock wipes");
  assert.deepEqual(h.shown, [true, false]);
  h.asked[0]!.answer("accepted");
  await flush();
  assert.deepEqual(
    visible.result,
    { outcome: "locked" },
    "a verdict after the lock changes nothing",
  );
  h.type("typed at the lock");
  assert.equal(h.queue.typedBytes(), 0);
  assert.equal(h.queue.verify(), false);
  // Arriving while locked: it waits, at most 120 s.
  const stale = h.ask(h.password({ headline: "Stale" }));
  h.clock.advance(SECURE_PROMPT_WAIT_MS / 2);
  const fresh = h.ask(h.password({ headline: "Fresh" }));
  assert.equal(h.queue.visible, false);
  h.clock.advance(SECURE_PROMPT_WAIT_MS / 2);
  await flush();
  assert.deepEqual(queued.result, { outcome: "timed-out" });
  assert.deepEqual(stale.result, { outcome: "timed-out" });
  assert.equal(fresh.result, null);
  h.queue.setLocked(false);
  assert.equal(h.queue.entry()!.headline, "Fresh", "shown after unlock");
  assert.deepEqual(h.shown, [true, false, true]);
  h.type("early");
  assert.equal(h.queue.typedBytes(), 0, "armed afresh after unlock");
  // Shown, it no longer has a waiting deadline, only the idle one.
  h.clock.advance(SECURE_PROMPT_WAIT_MS / 2 + 1);
  await flush();
  assert.equal(fresh.result, null);
  cases++;
}

// Consent: Allow and Deny by pointer, Escape denies, Enter and typing do nothing.
{
  const h = harness();
  const consent = (): SecurePromptRequest => ({
    kind: "consent",
    headline: "Allow Mail to use the Login keyring?",
    requester: { name: "Mail", x11: false },
    identities: [ADA],
    selected: 0,
    needsAdministrator: false,
    details: [],
  });
  const allowed = h.ask(consent());
  h.queue.action({ type: "allow" });
  assert.equal(h.queue.visible, true, "not before the prompt is armed");
  h.arm();
  assert.equal(h.queue.entry()!.kind, "consent");
  assert.deepEqual(h.queue.entry()!.identities, [], "consent has nobody to sign");
  h.type("abc");
  h.tap(KEY.enter);
  assert.equal(h.queue.typedBytes(), 0);
  assert.equal(h.queue.visible, true, "Enter never allows");
  h.queue.action({ type: "submit" });
  assert.equal(h.queue.visible, true);
  h.queue.action({ type: "allow" });
  await flush();
  assert.deepEqual(allowed.result, { outcome: "completed" });
  const denied = h.ask(consent());
  h.arm();
  h.queue.action({ type: "deny" });
  await flush();
  assert.deepEqual(denied.result, { outcome: "cancelled" });
  const escaped = h.ask(consent());
  h.arm();
  h.tap(KEY.esc);
  await flush();
  assert.deepEqual(escaped.result, { outcome: "cancelled" });
  // "allow" means nothing on a password prompt.
  const password = h.ask(h.password());
  h.arm();
  h.queue.action({ type: "allow" });
  await flush();
  assert.equal(password.result, null);
  cases++;
}

// The verification key, a failed draw, text hygiene and dispose.
{
  const h = harness();
  assert.equal(h.queue.verify(), false, "no prompt: the caller says so");
  const pending = h.ask(
    h.password({
      headline: `Run\u0007 \u202eevil\u2066 ${"x".repeat(400)}`,
      requester: { name: "sys\ntemctl", via: "Term\u0000inal", x11: true },
      details: [{ label: "Ac\ttion", value: "a\r\nb" }],
    }),
  );
  const entry = h.queue.entry()!;
  for (const text of [
    entry.headline,
    entry.requester!.name,
    entry.requester!.via!,
    entry.details[0]!.label,
    entry.details[0]!.value,
  ])
    assert.ok(!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(text), "no controls");
  assert.equal(entry.requester!.name, "sys temctl");
  assert.equal(Array.from(entry.headline).length, 200, "the headline is cut at 200 characters");
  assert.equal(entry.requester?.x11, true);
  assert.equal(h.queue.verify(), true);
  assert.equal(h.queue.entry()!.verifications, 1);
  h.arm();
  h.type("typed");
  h.queue.drawFailed();
  await flush();
  assert.deepEqual(pending.result, { outcome: "failed" }, "a prompt nobody can see is not kept");
  assert.equal(h.queue.typedBytes(), 0);
  const visible = h.ask(h.password());
  const queued = h.ask(h.password());
  h.queue.dispose();
  await flush();
  assert.deepEqual(visible.result, { outcome: "cancelled" });
  assert.deepEqual(queued.result, { outcome: "cancelled" });
  const late = h.ask(h.password());
  await flush();
  assert.deepEqual(late.result, { outcome: "refused" });
  assert.equal(h.clock.pending, 0);
  cases++;
}

// The answer is in no view, however it is serialised, and nothing here logs.
{
  const logged: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  for (const name of ["log", "warn", "error"] as const)
    console[name] = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  const views: string[] = [];
  try {
    const h = harness();
    const SECRET = "correct horse";
    h.ask(h.password({ identities: [ADA, GRACE] }));
    h.arm();
    for (const char of Array.from(SECRET)) {
      h.tap(KEY.a, char);
      views.push(JSON.stringify(h.queue.entry()));
    }
    h.tap(KEY.enter);
    views.push(JSON.stringify(h.queue.entry()));
    h.asked[0]!.answer("rejected");
    await flush();
    views.push(JSON.stringify(h.queue.entry()));
    assert.ok(h.changes() > SECRET.length, "every change is announced");
    for (const view of views) {
      assert.ok(!view.includes(SECRET) && !view.includes("horse"), "no view carries the answer");
      assert.ok(!view.includes(Buffer.from(SECRET).toString("base64")));
    }
    assert.ok(
      !Object.keys(h.queue.entry()!).some((key) => /secret|password|buffer|bytes/i.test(key)),
    );
  } finally {
    Object.assign(console, original);
  }
  assert.deepEqual(logged, [], "the state machine logs nothing");
  cases++;
}

console.log(`[secure-prompt] ${cases} cases PASS`);
