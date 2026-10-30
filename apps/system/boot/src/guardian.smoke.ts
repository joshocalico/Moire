import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BootGuardian, type GuardianOptions } from "./guardian";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-boot-guardian-"));
const children = new Set<ChildProcess>();
const childFile = path.join(fixture, "renderer.mjs");
fs.writeFileSync(
  childFile,
  `
const feedback = {sequence:7, seconds:1, nanoseconds:23, vsync:false, hardwareClock:false, hardwareCompletion:false};
process.on('SIGTERM', () => {
  if (process.argv[2] === 'ignore-term') return;
  if (process.argv[2] === 'late-frame') process.send({kind:'scanout-accepted',feedback});
  process.exit(0);
});
process.send({kind: process.argv[2] === 'invalid' ? 'wrong-message' : 'scanout-accepted',feedback}, () => {
  if (process.argv[2] === 'loop') while (true) {}
  if (process.argv[2] === 'exit') process.exit(23);
});
setInterval(() => {}, 1000);
`,
);
for (const name of ["home", "config", "data", "cache", "runtime"])
  fs.mkdirSync(path.join(fixture, name), { mode: 0o700 });
const environment = {
  ...process.env,
  HOME: path.join(fixture, "home"),
  XDG_CONFIG_HOME: path.join(fixture, "config"),
  XDG_DATA_HOME: path.join(fixture, "data"),
  XDG_CACHE_HOME: path.join(fixture, "cache"),
  XDG_RUNTIME_DIR: path.join(fixture, "runtime"),
};

function launch(mode: string, executable = process.execPath): ChildProcess {
  const child = spawn(executable, [childFile, mode], {
    env: environment,
    detached: true,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  children.add(child);
  child.once("close", () => children.delete(child));
  return child;
}

function absent(pid: number | undefined): boolean {
  if (!pid) return true;
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH")
      return true;
    throw error;
  }
}

function scenario(mode: string, overrides: Partial<GuardianOptions> = {}) {
  let escape = () => {};
  let child: ChildProcess | null = null;
  let presentedCount = 0;
  let resolvePresented: () => void = () => {};
  const presented = new Promise<void>((resolve) => {
    resolvePresented = resolve;
  });
  const calls: string[] = [];
  const guardian = new BootGuardian({
    gracefulMs: 40,
    hardStopMs: 1000,
    console: {
      enterGraphics() {
        calls.push("enter");
      },
      restore() {
        assert.ok(absent(child?.pid), "child must exit before console restoration");
        calls.push("restore");
      },
      close() {
        calls.push("close");
      },
    },
    observeEscape(handler) {
      escape = handler;
      calls.push("observe");
      return () => {
        calls.push("unobserve");
      };
    },
    startRenderer() {
      calls.push("launch");
      child = launch(mode);
      return child;
    },
    onScanoutAccepted(feedback) {
      assert.deepEqual(feedback, {
        sequence: 7,
        seconds: 1,
        nanoseconds: 23,
        vsync: false,
        hardwareClock: false,
        hardwareCompletion: false,
      });
      presentedCount++;
      resolvePresented();
    },
    onEscape() {
      calls.push("escape-latch");
    },
    ...overrides,
  });
  return {
    guardian,
    calls,
    presented,
    escape: () => escape(),
    child: () => child,
    count: () => presentedCount,
  };
}

try {
  // A loaded builder can take longer than the default 40 ms to deliver SIGTERM to a healthy child.
  const healthy = scenario("normal", { gracefulMs: 800 });
  healthy.guardian.start();
  healthy.guardian.start();
  await healthy.presented;
  const started = performance.now();
  const first = healthy.guardian.release("stage-complete");
  assert.strictEqual(healthy.guardian.release("escape"), first);
  assert.deepEqual(await first, { kind: "released", reason: "stage-complete", forced: false });
  assert.ok(performance.now() - started < 1000, "healthy release must not wait for an animation");
  assert.deepEqual(healthy.calls, ["observe", "enter", "launch", "unobserve", "restore", "close"]);
  assert.equal(healthy.count(), 1);

  for (const mode of ["loop", "ignore-term", "normal"]) {
    const stalled = scenario(mode);
    stalled.guardian.start();
    await stalled.presented;
    const child = stalled.child();
    assert.ok(child?.pid);
    if (mode === "normal") process.kill(child.pid, "SIGSTOP");
    const at = performance.now();
    stalled.escape();
    stalled.escape();
    assert.deepEqual(await stalled.guardian.result, {
      kind: "released",
      reason: "escape",
      forced: true,
    });
    assert.ok(
      performance.now() - at < 1000,
      `${mode}: independent guardian must recover stalled child within bound`,
    );
    assert.equal(stalled.calls.filter((call) => call === "escape-latch").length, 1);
    assert.equal(stalled.calls.filter((call) => call === "restore").length, 1);
    assert.ok(absent(child.pid));
  }

  const late = scenario("late-frame");
  late.guardian.start();
  await late.presented;
  await late.guardian.release("service-stop");
  assert.equal(late.count(), 1, "late first-frame message must not republish after release");

  const rejectedReadiness = scenario("normal", {
    onScanoutAccepted() {
      throw new Error("Manager readiness datagram rejected");
    },
  });
  rejectedReadiness.guardian.start();
  const rejectedResult = await rejectedReadiness.guardian.result;
  assert.equal(rejectedResult.kind, "failed");
  assert.equal(rejectedResult.reason, "renderer-failure");
  assert.ok(absent(rejectedReadiness.child()?.pid), "notify failure retires the real renderer");
  assert.equal(rejectedReadiness.calls.filter((call) => call === "restore").length, 1);

  let deadlineObserved: () => void = () => {};
  const deadline = new Promise<void>((resolve) => {
    deadlineObserved = resolve;
  });
  const unconfirmed = scenario("normal", {
    gracefulMs: 10,
    hardStopMs: 30,
    signalRenderer() {},
    onDiagnostic(error) {
      if (/deadline/.test(error.message)) deadlineObserved();
    },
  });
  unconfirmed.guardian.start();
  await unconfirmed.presented;
  const pending = unconfirmed.guardian.release("escape");
  await deadline;
  assert.equal(unconfirmed.guardian.phase, "termination-failed");
  assert.ok(!unconfirmed.calls.includes("restore"));
  assert.ok(!unconfirmed.calls.includes("close"));
  assert.ok(!unconfirmed.calls.includes("unobserve"));
  const unconfirmedChild = unconfirmed.child();
  assert.ok(unconfirmedChild?.pid);
  assert.ok(!absent(unconfirmedChild.pid), "unconfirmed owner really remains alive");
  process.kill(-unconfirmedChild.pid, "SIGKILL");
  assert.equal((await pending).kind, "failed");
  assert.equal(unconfirmed.calls.filter((call) => call === "restore").length, 1);

  for (const mode of ["invalid", "exit"]) {
    const failed = scenario(mode);
    failed.guardian.start();
    const result = await failed.guardian.result;
    assert.equal(result.kind, "failed");
    assert.equal(result.reason, "renderer-failure");
    assert.equal(failed.calls.filter((call) => call === "restore").length, 1);
  }

  const signalled = scenario("normal");
  signalled.guardian.start();
  await signalled.presented;
  const signalledChild = signalled.child();
  assert.ok(signalledChild?.pid);
  process.kill(signalledChild.pid, "SIGKILL");
  const signalResult = await signalled.guardian.result;
  assert.equal(signalResult.kind, "failed");
  if (signalResult.kind === "failed") assert.match(signalResult.errors[0]!.message, /SIGKILL/);

  const missing = scenario("normal", {
    startRenderer: () => launch("normal", path.join(fixture, "missing-node")),
  });
  missing.guardian.start();
  assert.equal((await missing.guardian.result).kind, "failed");
  assert.equal(missing.calls.filter((call) => call === "restore").length, 1);

  const noInput = scenario("normal", {
    observeEscape: () => {
      throw new Error("No Escape-capable keyboard");
    },
  });
  noInput.guardian.start();
  assert.equal((await noInput.guardian.result).reason, "input-unavailable");
  assert.ok(!noInput.calls.includes("launch"), "no renderer before verified recovery input");
  assert.ok(!noInput.calls.includes("enter"), "no graphics before verified recovery input");

  const immediate = scenario("normal", {
    observeEscape(handler) {
      handler();
      return () => {};
    },
  });
  immediate.guardian.start();
  assert.equal((await immediate.guardian.result).reason, "escape");
  assert.ok(!immediate.calls.includes("launch"));
  assert.ok(!immediate.calls.includes("enter"));

  const badRestore = scenario("normal", {
    console: {
      enterGraphics() {},
      restore() {
        throw new Error("Fixture VT restore failed");
      },
      close() {},
    },
  });
  badRestore.guardian.start();
  await badRestore.presented;
  const restoreResult = await badRestore.guardian.release("stage-complete");
  assert.equal(restoreResult.kind, "failed", "never claim release if native restoration failed");
  if (restoreResult.kind === "failed")
    assert.match(restoreResult.errors[0]!.message, /VT restore failed/);
  console.log(
    "[boot/guardian] real children: healthy, blocked JS, SIGSTOP, ignored TERM, signals, launch errors, late messages and fail-closed input/restore passed; no device recovery claim",
  );
} finally {
  for (const child of children) {
    if (child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
  }
  await Promise.all(
    [...children].map(
      (child) => new Promise<void>((resolve) => child.once("close", () => resolve())),
    ),
  );
  fs.rmSync(fixture, { recursive: true, force: true });
}
