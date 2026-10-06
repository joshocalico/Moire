import assert from "node:assert/strict";
import { type ChildProcess } from "node:child_process";
import {
  createFixtureLifecycle,
  type FixtureLaunchContext,
  type FixtureLifecycle,
} from "./session-lifecycle";
import { spawnFixtureProcess, fixtureProcessArgv } from "./testing/fixture-process";
import { loginId, type SessionSelection } from "./types";
const selection: SessionSelection = {
  id: loginId("configured-fixture"),
  generation: "descriptor-1",
  label: "Fixture",
  protocol: "wayland",
  desktop: "Moire fixture",
  descriptorPath: "/explicit-fixture/session.desktop",
  argv: fixtureProcessArgv(),
};
const request = (id: string) => ({ attemptId: loginId(id), selection });
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function wait(check: () => boolean, label: string) {
  const deadline = performance.now() + 6000;
  while (!check()) {
    if (performance.now() >= deadline) throw new Error("Timeout: " + label);
    await delay(10);
  }
}
function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const authorities: FixtureLifecycle[] = [],
  parents: { child: ChildProcess; context: FixtureLaunchContext; members: number[] }[] = [];
let cases = 0;
function own(options: Parameters<typeof spawnFixtureProcess>[0], context: FixtureLaunchContext) {
  const child = spawnFixtureProcess(options);
  const owned: { child: ChildProcess; context: FixtureLaunchContext; members: number[] } = {
    child,
    context,
    members: [],
  };
  child.on("message", (value) => {
    if (
      !value ||
      typeof value !== "object" ||
      !("type" in value) ||
      value.type !== "fixture-owned" ||
      !("nonce" in value) ||
      value.nonce !== context.nonce ||
      !("generation" in value) ||
      value.generation !== context.generation ||
      !("members" in value) ||
      !Array.isArray(value.members)
    )
      return;
    for (const member of value.members)
      if (member && typeof member === "object" && "pid" in member && typeof member.pid === "number")
        owned.members.push(member.pid);
  });
  parents.push(owned);
  context.onSpawn(child);
  return child;
}
function control(
  parent: { child: ChildProcess; context: FixtureLaunchContext },
  type: string,
  nonce = parent.context.nonce,
  generation = parent.context.generation,
) {
  if (parent.child.connected) parent.child.send({ type, nonce, generation }, () => {});
}
function create(options: Partial<Parameters<typeof createFixtureLifecycle>[0]> = {}) {
  const authority = createFixtureLifecycle({
    qualification: "fixture",
    launchSession: (_, context) => own({}, context),
    ...options,
  });
  authorities.push(authority);
  return authority;
}
try {
  const lifecycle = create();
  const greeter = await lifecycle.createGreeter();
  assert.equal(lifecycle.diagnostics()[0]?.descendantCount, 1);
  await assert.rejects(() => lifecycle.observeStarted(request("before-retirement")), /not retired/);
  assert.equal(
    (await lifecycle.retireGreeter({ ...greeter, generation: greeter.generation + 1 })).kind,
    "unresolved",
  );
  assert.equal(lifecycle.diagnostics()[0]?.parentClosed, false);
  cases++;
  const released = await Promise.all([
    lifecycle.retireGreeter(greeter),
    lifecycle.retireGreeter(greeter),
  ]);
  assert(released.every((value) => value.kind === "released"));
  assert.equal(lifecycle.diagnostics()[0]?.parentClosed, true);
  assert.equal(lifecycle.diagnostics()[0]?.released, true);
  cases++;
  const session = await lifecycle.observeStarted(request("successful-session"));
  assert.equal(lifecycle.diagnostics()[1]?.descendantCount, 1);
  await assert.rejects(() => lifecycle.createGreeter(), /owned lifetime/);
  await assert.rejects(() => lifecycle.observeStarted(request("successful-session")), /already/);
  assert.equal(
    (await lifecycle.retireSession({ ...session, id: loginId("wrong-id") })).kind,
    "unresolved",
  );
  assert.equal((await lifecycle.retireSession(session)).kind, "released");
  const fresh = await lifecycle.createGreeter();
  assert(fresh.generation > session.generation && fresh.id !== greeter.id);
  assert.equal((await lifecycle.retireGreeter(fresh)).kind, "released");
  cases++;
  assert.equal((await lifecycle.cancelLaunch(loginId("not-yet-started"))).kind, "released");
  await assert.rejects(() => lifecycle.observeStarted(request("not-yet-started")), /canceled/);
  cases++;
  // Delayed callback cancellation must not report release before the handle arrives.
  const gate = deferred<ChildProcess>();
  let lateContext: FixtureLaunchContext | null = null;
  const late = create({
    cleanupTimeoutMs: 60,
    launchSession: (_, context) => {
      lateContext = context;
      return gate.promise;
    },
  });
  const starting = late.observeStarted(request("late-launch"));
  const failedStart = assert.rejects(() => starting, /unproven/);
  await wait(() => lateContext !== null, "held launcher entered");
  assert.equal((await late.cancelLaunch(loginId("late-launch"))).kind, "unresolved");
  await assert.rejects(() => late.createGreeter(), /owned lifetime/);
  const captured = lateContext;
  assert(captured);
  const child = own({}, captured);
  gate.resolve(child);
  await failedStart;
  await wait(() => late.diagnostics()[0]?.parentClosed === true, "late child retired");
  assert.equal((await late.cancelLaunch(loginId("late-launch"))).kind, "released");
  assert.equal(late.diagnostics()[0]?.released, true);
  cases++;
  // onSpawn readiness alone cannot settle a still-pending injected launch callback.
  const returnGate = deferred<ChildProcess>();
  const boundContext: { parent: ChildProcess | null } = { parent: null };
  const heldReturn = create({
    cleanupTimeoutMs: 80,
    launchSession: (_, context) => {
      boundContext.parent = own({}, context);
      return returnGate.promise;
    },
  });
  let returnedObserved = false;
  const returnStart = heldReturn.observeStarted(request("held-callback-return"));
  void returnStart.then(
    () => {
      returnedObserved = true;
    },
    () => {},
  );
  const returnReject = assert.rejects(() => returnStart, /unproven/);
  await wait(() => heldReturn.diagnostics()[0]?.descendantCount === 1, "bound callback inventory");
  await delay(30);
  assert.equal(returnedObserved, false);
  assert.equal((await heldReturn.cancelLaunch(loginId("held-callback-return"))).kind, "unresolved");
  await assert.rejects(() => heldReturn.createGreeter(), /owned lifetime/);
  assert(boundContext.parent);
  returnGate.resolve(boundContext.parent);
  await returnReject;
  await wait(() => heldReturn.diagnostics()[0]?.parentClosed === true, "bound return cleanup");
  assert.equal((await heldReturn.cancelLaunch(loginId("held-callback-return"))).kind, "released");
  cases++;
  // Held readiness is not running; cancellation retires even without a startup ack.
  const held = create({ launchSession: (_, context) => own({ holdReady: true }, context) });
  let heldObserved = false;
  const heldStart = held.observeStarted(request("held-ready"));
  void heldStart.then(
    () => {
      heldObserved = true;
    },
    () => {},
  );
  const heldReject = assert.rejects(() => heldStart, /unproven/);
  await wait(() => held.diagnostics()[0]?.descendantCount === 1, "held ready inventory");
  const heldParent = parents.at(-1);
  assert(heldParent);
  control(heldParent, "fixture-stale-ready");
  await delay(50);
  assert.equal(
    heldObserved,
    false,
    "foreign nonce/generation startup replies cannot accept a session",
  );
  assert.equal((await held.cancelLaunch(loginId("held-ready"))).kind, "released");
  await heldReject;
  cases++;
  // Holding retirement blocks fresh greeter; foreign nonce/generation cannot release it.
  const slow = create({
    cleanupTimeoutMs: 80,
    launchSession: (_, context) => own({ holdRetirement: true }, context),
  });
  const slowSession = await slow.observeStarted(request("held-retirement"));
  const slowParent = parents.at(-1);
  assert(slowParent);
  assert.equal((await slow.retireSession(slowSession)).kind, "unresolved");
  control(slowParent, "fixture-release-retirement", "00000000-0000-0000-0000-000000000000");
  control(
    slowParent,
    "fixture-release-retirement",
    slowParent.context.nonce,
    slowParent.context.generation + 1,
  );
  await delay(30);
  assert.equal(slow.diagnostics()[0]?.parentClosed, false);
  await assert.rejects(() => slow.createGreeter(), /owned lifetime/);
  control(slowParent, "fixture-release-retirement");
  await wait(() => slow.diagnostics()[0]?.parentClosed === true, "held retirement release");
  assert.equal((await slow.retireSession(slowSession)).kind, "released");
  cases++;
  const greeterHold = create({
    cleanupTimeoutMs: 80,
    launchGreeter: (context) => own({ holdRetirement: true }, context),
  });
  const heldGreeter = await greeterHold.createGreeter();
  const greeterParent = parents.at(-1);
  assert(greeterParent);
  const blockedGreeter = await Promise.all([
    greeterHold.retireGreeter(heldGreeter),
    greeterHold.retireGreeter(heldGreeter),
  ]);
  assert(blockedGreeter.every((result) => result.kind === "unresolved"));
  await assert.rejects(
    () => greeterHold.observeStarted(request("before-held-greeter-release")),
    /not retired/,
  );
  control(greeterParent, "fixture-release-retirement");
  await wait(
    () => greeterHold.diagnostics()[0]?.parentClosed === true,
    "greeter complete retirement",
  );
  assert.equal((await greeterHold.retireGreeter(heldGreeter)).kind, "released");
  cases++;
  const timeout = create({
    startupTimeoutMs: 80,
    launchSession: (_, context) => own({ holdReady: true }, context),
  });
  await assert.rejects(() => timeout.observeStarted(request("startup-timeout")), /unproven/);
  assert.equal(
    timeout.diagnostics()[0]?.released,
    true,
    "startup timeout retires actual unacknowledged parent and descendants",
  );
  assert.equal(timeout.diagnostics()[0]?.parentClosed, true);
  assert.equal((await timeout.cancelLaunch(loginId("startup-timeout"))).kind, "released");
  cases++;
  // Parent exit while its actual child survives can never stand in for cleanup proof.
  const orphan = create({ cleanupTimeoutMs: 60 });
  const orphanSession = await orphan.observeStarted(request("parent-exit"));
  const orphanParent = parents.at(-1);
  assert(orphanParent);
  const memberPid = orphanParent.members[0];
  assert(memberPid && alive(memberPid), "actual declared descendant is live before parent exit");
  control(orphanParent, "fixture-exit-parent");
  await wait(() => orphan.diagnostics()[0]?.parentClosed === true, "parent exited");
  assert(alive(memberPid), "actual child remains live after parent close");
  assert.equal((await orphan.retireSession(orphanSession)).kind, "unresolved");
  await assert.rejects(() => orphan.createGreeter(), /owned lifetime/);
  await assert.rejects(() => orphan.dispose(), /unresolved/);
  // Parent's helper owns the descendant timeout, not this authority; no PID rescue.
  await wait(() => !alive(memberPid), "fixture-owned orphan lifetime ended");
  assert.equal(
    (await orphan.retireSession(orphanSession)).kind,
    "unresolved",
    "later PID absence without supervisor proof cannot release",
  );
  cases++;
  // An invoked callback rejecting without a handle does not prove no launch.
  const unknown = create({
    cleanupTimeoutMs: 40,
    launchSession: () => {
      throw new Error("unknown fixture outcome");
    },
  });
  await assert.rejects(() => unknown.observeStarted(request("unknown-launch")), /unproven/);
  assert.equal((await unknown.cancelLaunch(loginId("unknown-launch"))).kind, "unresolved");
  await assert.rejects(() => unknown.createGreeter(), /owned lifetime/);
  await assert.rejects(() => unknown.dispose(), /unresolved/);
  cases++;
  // A callback rejection after onSpawn still leaves its real handle owned for cleanup.
  const rejectAfterSpawn = create({
    launchSession: (_, context) => {
      own({}, context);
      throw new Error("fixture rejected after spawn");
    },
  });
  await assert.rejects(
    () => rejectAfterSpawn.observeStarted(request("spawn-then-reject")),
    /unproven/,
  );
  assert.equal(rejectAfterSpawn.diagnostics()[0]?.released, true);
  assert.equal(rejectAfterSpawn.diagnostics()[0]?.parentClosed, true);
  cases++;
  console.log(
    JSON.stringify({
      actualCode: 0,
      actualExitCode: 0,
      processReceipts: authorities.flatMap((authority) => authority.diagnostics()),
      cases,
      scope: "real harmless fixture parent+descendant IPC; not native seat/PAM/logind/cgroup",
      descendantCleanup:
        "owned supervisor waits ChildProcess close, authority waits matching ack+parent close+member PID absence",
    }),
  );
} finally {
  for (const parent of parents) control(parent, "fixture-release-retirement");
  await Promise.allSettled(authorities.map((authority) => authority.dispose()));
  await Promise.all(
    parents.map(async ({ child }) => {
      if (child.exitCode === null && child.signalCode === null)
        await new Promise<void>((resolve) => child.once("close", () => resolve()));
    }),
  );
}
