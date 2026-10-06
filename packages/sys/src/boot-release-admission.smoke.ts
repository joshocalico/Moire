import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  initBootAttemptLedger,
  readBootAttemptLedger,
  recordBootAttempt,
} from "./boot-attempt-ledger";
import { checkBootDesktopAdmission, parseBootAdmissionCheckpoint } from "./boot-release-admission";
import {
  beginBootService,
  readBootServiceLease,
  writeBootServiceRecord,
  type BootServicePaths,
} from "./boot-service-state";
import { cleanupBootService } from "./boot-service-release";
import type { BootManagerObservation } from "./boot-manager-observation";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-admission-"));
const expected = {
  bootId: "12345678-1234-1234-1234-123456789abc",
  unit: "moire-boot.service",
  invocationId: "a".repeat(32),
};
const paths: BootServicePaths = {
  cgroupMount: path.join(fixture, "cg"),
  procRoot: path.join(fixture, "proc"),
  selfPid: process.pid,
};
const group = `/system.slice/${expected.unit}`,
  root = path.join(paths.cgroupMount, group);
const stateDirectory = path.join(fixture, "state");
const initial: BootManagerObservation = {
  unit: expected.unit,
  loadState: "loaded",
  activeState: "inactive",
  invocationId: null,
  mainPid: 0,
  controlPid: 0,
  cgroupPath: null,
  jobId: null,
  timestamps: ["0", "0", "0", "0", "0", "0"],
  executed: false,
};
let manager = initial;
let observe = async () => manager;
const check = (checkpoint?: Parameters<typeof checkBootDesktopAdmission>[0]["checkpoint"]) =>
  checkBootDesktopAdmission({
    stateDirectory,
    current: expected,
    paths,
    observeManager: () => observe(),
    checkpoint,
  });
const prepare = (identity = expected) =>
  recordBootAttempt({ stateDirectory, expected: identity, paths, observeManager: () => observe() });
let cases = 0;
async function expect(kind: string, checkpoint?: Parameters<typeof check>[0]) {
  const result = await check(checkpoint);
  assert.equal(result.kind, kind, JSON.stringify(result));
  cases++;
}
function membership(value: string) {
  const directory = path.join(paths.procRoot, String(paths.selfPid));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "cgroup"), `0::${value}\n`);
}
function node(directory: string, pids: readonly number[], populated = Number(pids.length > 0)) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "cgroup.type"), "domain\n");
  fs.writeFileSync(path.join(directory, "cgroup.procs"), pids.join("\n") + "\n");
  fs.writeFileSync(path.join(directory, "cgroup.events"), `populated ${populated}\n`);
}
function pre(identity = expected) {
  manager = {
    ...initial,
    activeState: "activating",
    invocationId: identity.invocationId,
    cgroupPath: group,
    controlPid: process.pid,
    jobId: 123,
    timestamps: ["0", "0", "0", "0", "0", "42"],
  };
}
try {
  fs.mkdirSync(paths.cgroupMount);
  membership("/admission.service");
  await expect("unresolved"); // Missing ledger is never inferred success.
  const never = initBootAttemptLedger(stateDirectory, expected);
  assert.equal(never.state, "never-attempted");
  assert.equal("invocationId" in never, false, "narrow schema even with structurally wider input");
  assert.deepEqual(initBootAttemptLedger(stateDirectory, expected), never);
  await expect("not-invoked", parseBootAdmissionCheckpoint("not-invoked"));
  await expect("not-invoked");
  manager = { ...initial, loadState: "not-found" };
  await expect("not-invoked");
  manager = initial;
  manager = { ...initial, jobId: 12 };
  await expect("unresolved");
  manager = initial;
  fs.writeFileSync(path.join(stateDirectory, ".lease-incomplete"), "partial");
  await expect("unresolved");
  fs.unlinkSync(path.join(stateDirectory, ".lease-incomplete"));
  node(root, []);
  await expect("unresolved");
  fs.rmSync(root, { recursive: true });
  const bytes = fs.readFileSync(path.join(stateDirectory, "attempt.json"));
  fs.chmodSync(path.join(stateDirectory, "attempt.json"), 0o666);
  await expect("unresolved");
  fs.chmodSync(path.join(stateDirectory, "attempt.json"), 0o600);
  fs.writeFileSync(
    path.join(stateDirectory, "attempt.json"),
    JSON.stringify({ ...never, bootId: "0".repeat(36) }),
  );
  assert.throws(() => initBootAttemptLedger(stateDirectory, expected), /foreign/);
  await expect("unresolved");
  fs.writeFileSync(path.join(stateDirectory, "attempt.json"), bytes);
  fs.unlinkSync(path.join(stateDirectory, "attempt.json"));
  fs.writeFileSync(path.join(stateDirectory, "lease.json"), "{}");
  assert.throws(() => initBootAttemptLedger(stateDirectory, expected), /existing state/);
  fs.unlinkSync(path.join(stateDirectory, "lease.json"));
  initBootAttemptLedger(stateDirectory, expected);

  // Actual pre-helper placement in .control, derived/pinned root, exact-self recursive proof.
  membership(group + "/.control");
  node(root, [], 1);
  node(path.join(root, ".control"), [process.pid]);
  pre();
  membership(group);
  const absentState = path.join(fixture, "absent-state");
  assert.throws(() => beginBootService(absentState, expected, paths), /ENOENT/);
  assert.equal(fs.existsSync(absentState), false, "guardian cannot recreate initializer state");
  membership(group + "/.control");
  node(path.join(root, "old-child"), [777]);
  await assert.rejects(prepare(), /owners remain/);
  assert.equal(readBootAttemptLedger(stateDirectory, expected).state, "never-attempted");
  fs.rmSync(path.join(root, "old-child"), { recursive: true });
  const wrong = manager;
  manager = { ...manager, invocationId: "f".repeat(32) };
  await assert.rejects(prepare(), /Manager/);
  manager = wrong;
  await prepare();
  assert.equal(readBootAttemptLedger(stateDirectory, expected).state, "attempted");
  assert.equal(
    initBootAttemptLedger(stateDirectory, expected).state,
    "attempted",
    "initializer cannot downgrade",
  );
  membership("/admission.service");
  node(root, []);
  node(path.join(root, ".control"), []);
  manager = initial;
  await expect("unresolved"); // Authenticated attempt without a lease never passes even after GC.
  membership(group);
  node(root, [process.pid]);
  assert.throws(
    () => beginBootService(stateDirectory, { ...expected, invocationId: "b".repeat(32) }, paths),
    /matching recorded/,
  );
  beginBootService(stateDirectory, expected, paths);
  membership("/admission.service");
  node(root, []);
  await expect("unresolved");
  membership(group);
  node(root, [process.pid]);
  assert.equal(cleanupBootService({ stateDirectory, expected, paths }).kind, "skipped");
  node(root, []);
  membership("/admission.service");
  const evidenceBefore = fs
    .readdirSync(stateDirectory)
    .map((name) => [name, fs.readFileSync(path.join(stateDirectory, name), "utf8")]);
  await expect("skipped");
  await expect("skipped", parseBootAdmissionCheckpoint(expected.invocationId));
  await expect("unresolved", parseBootAdmissionCheckpoint("b".repeat(32)));
  await expect("unresolved", parseBootAdmissionCheckpoint("not-invoked"));
  assert.deepEqual(
    fs
      .readdirSync(stateDirectory)
      .map((name) => [name, fs.readFileSync(path.join(stateDirectory, name), "utf8")]),
    evidenceBefore,
    "admission never mutates state",
  );
  manager = {
    ...initial,
    invocationId: expected.invocationId,
    cgroupPath: group,
    executed: true,
    timestamps: ["10", "20", "10", "20", "20", "10"],
  };
  await expect("skipped");
  manager = { ...manager, invocationId: "c".repeat(32) };
  await expect("unresolved");
  manager = initial;
  node(root, [], 1);
  node(path.join(root, "child"), [888]);
  await expect("unresolved");
  fs.rmSync(path.join(root, "child"), { recursive: true });
  node(root, []);
  let calls = 0;
  observe = async () => (++calls === 1 ? initial : { ...initial, jobId: 6 });
  await expect("unresolved");
  observe = async () => manager;
  calls = 0;
  observe = async () => {
    if (++calls === 2)
      writeBootServiceRecord(stateDirectory, "attempt", {
        version: 1,
        bootId: expected.bootId,
        unit: expected.unit,
        state: "attempted",
        invocationId: "d".repeat(32),
      });
    return initial;
  };
  await expect("unresolved");
  observe = async () => manager;
  writeBootServiceRecord(stateDirectory, "attempt", {
    version: 1,
    bootId: expected.bootId,
    unit: expected.unit,
    state: "attempted",
    invocationId: expected.invocationId,
  });
  fs.rmSync(root, { recursive: true });
  await expect("skipped"); // Healthy GC with authenticated closure.
  node(root, []);
  const lease = readBootServiceLease(stateDirectory);
  writeBootServiceRecord(stateDirectory, "lease", {
    ...lease,
    cgroupIdentity: { ...lease.cgroupIdentity, ino: "0" },
  });
  await expect("unresolved");
  writeBootServiceRecord(stateDirectory, "lease", lease);

  // New root intentionally differs from historical root: authenticate records, then solely current helper.
  const next = { ...expected, invocationId: "b".repeat(32) };
  membership(group);
  node(root, [process.pid]);
  pre(next);
  await prepare(next);
  beginBootService(stateDirectory, next, paths);
  const freshLease = readBootServiceLease(stateDirectory);
  writeBootServiceRecord(stateDirectory, "lease", {
    ...freshLease,
    phase: "graphics-intent",
    console: { ttyPath: "/dev/tty1", vt: 1, rdev: "1025", originalMode: 0 },
  });
  const preserved = fs.readFileSync(path.join(stateDirectory, "attempt.json"), "utf8");
  const preservedLease = fs.readFileSync(path.join(stateDirectory, "lease.json"), "utf8");
  const third = { ...expected, invocationId: "c".repeat(32) };
  pre(third);
  await assert.rejects(prepare(third), /ENOENT/);
  assert.equal(fs.readFileSync(path.join(stateDirectory, "attempt.json"), "utf8"), preserved);
  assert.equal(
    fs.readFileSync(path.join(stateDirectory, "lease.json"), "utf8"),
    preservedLease,
    "unresolved graphics cannot be overwritten",
  );
  console.log(
    `boot admission: ${cases} current-boot ledger/manager/history/owner/checkpoint checks + exact .control startup/restart boundaries PASS (filesystem fixtures, no systemd/device claim)`,
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
