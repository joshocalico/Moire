/**
 * Why the secure prompt dismissed a request, told only to the process it was for: the record is
 * keyed by polkit's subject pid and that process's start time, answered for the caller's pid as
 * a fake bus daemon reports it, once, within 60 s.
 */
import assert from "node:assert/strict";
import { DbusRemoteError, type DbusInterface, type SessionBus } from "@moire/dbus";
import {
  SECURE_PROMPT_INTERFACE,
  SECURE_PROMPT_PATH,
  compositorDismissalLookup,
} from "@moire/system-management/prompt-outcome";
import { createPromptOutcomes, exportPromptOutcomes } from "./prompt-outcomes";

let cases = 0;
const ADMIN = "org.freedesktop.accounts.user-administration";
const AUTOLOGIN = "org.moire.dm.set-autologin";
let clock = 0;
const starts = new Map<number, number>([
  [500, 7000], // the management service
  [600, 8000], // another app
]);
const outcomes = createPromptOutcomes({
  now: () => clock,
  startTime: (pid) => starts.get(pid) ?? null,
});

// Kept per process and action, newest first, and forgotten once read.
outcomes.record(500, ADMIN, "cancelled");
outcomes.record(500, ADMIN, "refused");
outcomes.record(500, AUTOLOGIN, "locked");
assert.equal(outcomes.take(600, ADMIN), null, "another process learns nothing");
assert.equal(outcomes.take(500, ADMIN), "refused");
assert.equal(outcomes.take(500, ADMIN), "cancelled");
assert.equal(outcomes.take(500, ADMIN), null);
assert.equal(outcomes.take(500, AUTOLOGIN), "locked");
cases++;

// Expires after 60 s.
outcomes.record(500, ADMIN, "refused");
clock += 60_001;
assert.equal(outcomes.take(500, ADMIN), null);
cases++;

// A reused pid is a different process: the earlier one's record is dropped, never answered.
outcomes.record(500, ADMIN, "refused");
starts.set(500, 7100);
assert.equal(outcomes.take(500, ADMIN), null);
starts.set(500, 7000);
assert.equal(outcomes.take(500, ADMIN), null, "and not kept for later");
// No start time, no record; bad pids and action ids are ignored.
outcomes.record(700, ADMIN, "refused");
starts.set(700, 9000);
assert.equal(outcomes.take(700, ADMIN), null);
outcomes.record(1, ADMIN, "refused");
outcomes.record(500, "bad action\n", "refused");
assert.equal(outcomes.take(500, "bad action\n"), null);
cases++;

// Bounded: the oldest of more than 32 records go.
for (let n = 0; n < 40; n++) outcomes.record(500, `org.moire.test.a${n}`, "refused");
assert.equal(outcomes.take(500, "org.moire.test.a0"), null);
assert.equal(outcomes.take(500, "org.moire.test.a39"), "refused");
assert.equal(outcomes.take(500, "org.moire.test.a8"), "refused");
assert.equal(outcomes.take(500, "org.moire.test.a7"), null);
cases++;

// On the bus: the caller's pid comes from the bus daemon, never from the caller.
const pids = new Map<string, number>([
  [":1.5", 500], // the management service
  [":1.6", 600], // another app, asking about the same action
  [":1.7", 1],
]);
let exported: DbusInterface | null = null;
let unexported = false;
const bus = {
  exportObject(path: string, object: DbusInterface) {
    assert.equal(path, SECURE_PROMPT_PATH);
    assert.equal(object.name, SECURE_PROMPT_INTERFACE);
    exported = object;
    return () => {
      unexported = true;
    };
  },
  async call(message: { member: string; body: unknown[] }) {
    assert.equal(message.member, "GetConnectionUnixProcessID");
    const sender = String(message.body[0]);
    if (!pids.has(sender))
      throw new DbusRemoteError("org.freedesktop.DBus.Error.NameHasNoOwner", sender);
    return { body: [pids.get(sender)] };
  },
} as unknown as SessionBus;
const unexport = exportPromptOutcomes(bus, outcomes);
const take = async (sender: string | undefined, actionId: unknown, signature = "s") => {
  const reply = await exported!.methods.TakeDismissal!.handler({
    message: { type: 1, serial: 1, sender, signature, body: [actionId] } as never,
    body: [actionId],
    fds: [],
    keepFd: () => {
      throw new Error("no descriptors");
    },
  });
  return reply.body?.[0];
};
outcomes.record(500, ADMIN, "refused");
assert.equal(await take(":1.6", ADMIN), "", "another app gets nothing");
assert.equal(await take(":1.7", ADMIN), "");
assert.equal(await take(":1.99", ADMIN), "", "left the bus");
assert.equal(await take(undefined, ADMIN), "");
assert.equal(await take(":1.5", ADMIN), "refused", "the subject itself");
assert.equal(await take(":1.5", ADMIN), "", "once");
await assert.rejects(take(":1.5", 7, "u"));
unexport();
assert.equal(unexported, true);
cases++;

// The management service's client: a reason, or null for anything it can't trust.
const reply = (signature: string, value: unknown) =>
  ({
    async call() {
      return { signature, body: [value] };
    },
  }) as unknown as SessionBus;
assert.equal(await compositorDismissalLookup(reply("s", "refused"))(ADMIN), "refused");
assert.equal(await compositorDismissalLookup(reply("s", "locked"))(ADMIN), "locked");
assert.equal(await compositorDismissalLookup(reply("s", ""))(ADMIN), null);
assert.equal(await compositorDismissalLookup(reply("s", "granted"))(ADMIN), null);
assert.equal(await compositorDismissalLookup(reply("u", 1))(ADMIN), null);
const absent = {
  async call() {
    throw new DbusRemoteError("org.freedesktop.DBus.Error.ServiceUnknown", "none");
  },
} as unknown as SessionBus;
assert.equal(await compositorDismissalLookup(absent)(ADMIN), null, "no compositor");
cases++;

console.log(`[prompt-outcomes.smoke] ok (${cases} cases)`);
