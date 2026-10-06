import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  beginBootService,
  currentCgroup,
  directoryIdentity,
  readBootServiceLease,
  readBootServiceRelease,
  serviceIdentity,
  writeBootServiceRecord,
  type BootServicePaths,
  type BootServiceLease,
} from "./boot-service-state";
import { observeBootServiceOwners, revalidateBootOwnerProof } from "./boot-service-cleanup";
import {
  openManagedBootConsole,
  releaseBootConsole,
  type BootConsoleIo,
} from "./boot-console-release";
import { initBootAttemptLedger, recordBootAttempt } from "./boot-attempt-ledger";
import type { BootManagerObservation } from "./boot-manager-observation";
import { cleanupBootService, checkBootServiceRelease } from "./boot-service-release";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-boot-service-"));
const paths: BootServicePaths = {
  cgroupMount: path.join(fixture, "cgroup"),
  procRoot: path.join(fixture, "proc"),
  selfPid: process.pid,
};
const group = "/system.slice/moire-boot.service",
  root = path.join(paths.cgroupMount, group);
const stateDirectory = path.join(fixture, "state");
const environment = {
  INVOCATION_ID: "1234567890abcdef1234567890abcdef",
  MOIRE_BOOT_UNIT: "moire-boot.service",
};
function membership(value: string) {
  fs.mkdirSync(path.join(paths.procRoot, String(paths.selfPid)), { recursive: true });
  fs.writeFileSync(path.join(paths.procRoot, String(paths.selfPid), "cgroup"), `0::${value}\n`);
}
function node(directory: string, pids: readonly number[], populated = Number(pids.length > 0)) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "cgroup.type"), "domain\n");
  fs.writeFileSync(
    path.join(directory, "cgroup.procs"),
    pids.join("\n") + (pids.length ? "\n" : ""),
  );
  fs.writeFileSync(path.join(directory, "cgroup.events"), `populated ${populated}\nfrozen 0\n`);
}
fs.mkdirSync(path.join(paths.procRoot, "sys/kernel/random"), { recursive: true });
fs.writeFileSync(
  path.join(paths.procRoot, "sys/kernel/random/boot_id"),
  "12345678-1234-1234-1234-123456789abc\n",
);
let mode = 0,
  activeVt = 1,
  rdev = "1025",
  readbackFails = false;
const calls: string[] = [];
const io: BootConsoleIo = {
  open(tty) {
    assert.equal(tty, "/dev/tty1");
    calls.push("open");
    return 91;
  },
  inspect() {
    calls.push("inspect");
    return { activeVt, mode, rdev };
  },
  setMode(_fd, next) {
    calls.push(`mode:${next}`);
    if (!(readbackFails && next === 0)) mode = next;
  },
  close() {
    calls.push("close");
  },
};
try {
  node(root, [process.pid]);
  membership(group);
  const expected = serviceIdentity(environment, paths);
  initBootAttemptLedger(stateDirectory, expected);
  const prepare = (identity: typeof expected) =>
    recordBootAttempt({
      stateDirectory,
      expected: identity,
      paths,
      observeManager: async (): Promise<BootManagerObservation> => ({
        unit: identity.unit,
        loadState: "loaded",
        activeState: "activating",
        invocationId: identity.invocationId,
        mainPid: 0,
        controlPid: process.pid,
        cgroupPath: group,
        jobId: 1,
        timestamps: ["0", "0", "0", "0", "0", "1"],
        executed: false,
      }),
    });
  await prepare(expected);
  const base = beginBootService(stateDirectory, expected, paths);
  assert.equal(readBootServiceLease(stateDirectory).phase, "skipped");
  const managed = openManagedBootConsole({ ttyPath: "/dev/tty1", stateDirectory, base, io });
  assert.equal(readBootServiceLease(stateDirectory).phase, "armed");
  managed.enterGraphics();
  managed.enterGraphics();
  managed.closeHandle();
  managed.closeHandle();
  assert.equal(mode, 1, "managed close cannot restore");
  assert.equal(calls.filter((value) => value === "mode:1").length, 1);
  const lease = readBootServiceLease(stateDirectory);
  assert.equal(lease.phase, "graphics-intent");
  const nextInvocation = { ...expected, invocationId: "0".repeat(32) };
  assert.throws(
    () => beginBootService(stateDirectory, nextInvocation, paths),
    /Prior boot graphics lease/,
  );
  assert.deepEqual(
    readBootServiceLease(stateDirectory),
    lease,
    "unresolved graphics intent must survive a refused restart",
  );
  assert.equal(mode, 1);
  assert.ok(!fs.existsSync(path.join(stateDirectory, "release.json")));

  assert.equal(observeBootServiceOwners(lease, paths).kind, "exited");
  // A .control subtree is traversed; only the exact helper PID is excluded.
  membership(group + "/.control");
  node(root, [], 1);
  node(path.join(root, ".control"), [process.pid, 777]);
  assert.deepEqual(observeBootServiceOwners(lease, paths), {
    kind: "other-processes",
    pids: [777],
  });
  const blocked = cleanupBootService({ stateDirectory, expected, paths, consoleIo: io });
  assert.equal(blocked.kind, "pending");
  assert.equal(mode, 1);
  assert.ok(!fs.existsSync(path.join(stateDirectory, "release.json")));
  node(root, [process.pid], 1);
  node(path.join(root, ".control"), []);
  assert.equal(
    observeBootServiceOwners(lease, paths).kind,
    "unresolved",
    "self must match its exact observed subgroup",
  );
  node(root, [], 1);
  node(path.join(root, ".control"), [process.pid, process.pid]);
  const ownership = observeBootServiceOwners(lease, paths);
  assert.equal(ownership.kind, "exited");
  if (ownership.kind !== "exited") throw new Error("Expected fixture proof");
  node(path.join(root, ".control"), [process.pid, 888]);
  assert.throws(
    () =>
      releaseBootConsole(ownership.proof, io, () =>
        assert.deepEqual(readBootServiceLease(stateDirectory), ownership.proof.lease),
      ),
    /owners remain/,
  );
  assert.equal(mode, 1);
  node(path.join(root, ".control"), [process.pid]);
  const changingIo: BootConsoleIo = {
    ...io,
    open(tty) {
      const fd = io.open(tty);
      writeBootServiceRecord(stateDirectory, "lease", {
        ...base,
        phase: "skipped",
        reason: "before-graphics",
      });
      return fd;
    },
  };
  assert.equal(
    cleanupBootService({ stateDirectory, expected, paths, consoleIo: changingIo }).kind,
    "unresolved",
  );
  assert.equal(mode, 1, "changed lease cannot reach KD_TEXT ioctl");
  writeBootServiceRecord(stateDirectory, "lease", lease);
  activeVt = 2;
  assert.equal(
    cleanupBootService({ stateDirectory, expected, paths, consoleIo: io }).kind,
    "unresolved",
  );
  activeVt = 1;
  rdev = "1026";
  assert.equal(
    cleanupBootService({ stateDirectory, expected, paths, consoleIo: io }).kind,
    "unresolved",
  );
  rdev = "1025";
  let inspections = 0;
  const switchingIo: BootConsoleIo = {
    ...io,
    inspect(fd) {
      const value = io.inspect(fd);
      return ++inspections === 2 ? { ...value, activeVt: 2 } : value;
    },
  };
  assert.equal(
    cleanupBootService({ stateDirectory, expected, paths, consoleIo: switchingIo }).kind,
    "unresolved",
  );
  assert.equal(mode, 1, "VT switch after proof still blocks ioctl");
  readbackFails = true;
  assert.equal(
    cleanupBootService({ stateDirectory, expected, paths, consoleIo: io }).kind,
    "unresolved",
  );
  readbackFails = false;
  assert.ok(!fs.existsSync(path.join(stateDirectory, "release.json")));
  const released = cleanupBootService({ stateDirectory, expected, paths, consoleIo: io });
  assert.equal(released.kind, "released");
  assert.equal(mode, 0);
  assert.equal(readBootServiceRelease(stateDirectory).kind, "released");
  const acknowledged = readBootServiceRelease(stateDirectory);
  membership(group);
  node(root, [process.pid]);
  node(path.join(root, ".control"), []);
  await prepare(nextInvocation);
  assert.equal(
    beginBootService(stateDirectory, nextInvocation, paths).invocationId,
    nextInvocation.invocationId,
  );
  assert.equal(readBootServiceLease(stateDirectory).phase, "skipped");
  writeBootServiceRecord(stateDirectory, "lease", lease);
  writeBootServiceRecord(stateDirectory, "release", acknowledged);

  membership("/system.slice/desktop.service");
  node(root, []);
  node(path.join(root, ".control"), []);
  assert.equal(checkBootServiceRelease({ stateDirectory, expected, paths }).kind, "released");
  assert.equal(
    checkBootServiceRelease({
      stateDirectory,
      expected: { ...expected, invocationId: "0".repeat(32) },
      paths,
    }).kind,
    "unresolved",
  );
  // Historical exact-invocation success survives legitimate stopped-root removal.
  fs.renameSync(root, root + "-retired");
  assert.equal(checkBootServiceRelease({ stateDirectory, expected, paths }).kind, "released");
  assert.equal(
    cleanupBootService({ stateDirectory, expected, paths, consoleIo: io }).kind,
    "unresolved",
    "missing root is never proof before restoration",
  );
  // Cleanup deliberately invalidates the old acknowledgement on failed retries.
  assert.equal(checkBootServiceRelease({ stateDirectory, expected, paths }).kind, "unresolved");
  node(root, []);
  assert.equal(
    observeBootServiceOwners(lease, paths, false).kind,
    "unresolved",
    "recreated root is not original ownership",
  );
  fs.rmSync(root, { recursive: true });
  fs.renameSync(root + "-retired", root);
  membership(group);
  node(root, [process.pid]);
  fs.rmSync(path.join(root, ".control"), { recursive: true });
  // Explicit skips are current-invocation, proven exits, and perform no console ioctl.
  const skipLease: BootServiceLease = { ...base, phase: "skipped", reason: "display-unavailable" };
  writeBootServiceRecord(stateDirectory, "lease", skipLease);
  const before = calls.length;
  assert.equal(
    cleanupBootService({ stateDirectory, expected, paths, consoleIo: io }).kind,
    "skipped",
  );
  assert.equal(calls.length, before);
  const beforeGraphics: BootServiceLease = {
    ...base,
    phase: "armed",
    console: { ttyPath: "/dev/tty1", vt: 1, rdev: "1025", originalMode: 0 },
  };
  writeBootServiceRecord(stateDirectory, "lease", beforeGraphics);
  assert.equal(
    cleanupBootService({ stateDirectory, expected, paths, consoleIo: io }).kind,
    "skipped",
  );
  assert.equal(calls.length, before);
  fs.writeFileSync(path.join(root, "cgroup.procs"), "not-a-pid\n");
  assert.equal(observeBootServiceOwners(lease, paths).kind, "unresolved");
  node(root, [process.pid]);
  fs.writeFileSync(path.join(root, "cgroup.events"), "populated 0\n");
  assert.equal(observeBootServiceOwners(lease, paths).kind, "unresolved");
  node(root, [process.pid]);
  fs.writeFileSync(path.join(root, "cgroup.type"), "domain threaded\n");
  assert.equal(observeBootServiceOwners(lease, paths).kind, "unresolved");
  node(root, []);
  assert.equal(
    observeBootServiceOwners(lease, paths).kind,
    "unresolved",
    "self must appear explicitly",
  );
  membership("/system.slice/other.service");
  assert.equal(observeBootServiceOwners(lease, paths).kind, "unresolved");
  membership(group);
  node(root, [process.pid]);
  fs.symlinkSync(root, path.join(root, "unexpected-link"));
  assert.equal(observeBootServiceOwners(lease, paths).kind, "unresolved");
  fs.unlinkSync(path.join(root, "unexpected-link"));
  // Structural forgery cannot authorize an ioctl.
  assert.throws(() => revalidateBootOwnerProof({ ...ownership.proof }), /Unrecognized/);
  fs.writeFileSync(
    path.join(root, "cgroup.procs"),
    Array.from({ length: 4097 }, (_, i) => String(i + 1)).join("\n"),
  );
  assert.equal(observeBootServiceOwners(lease, paths).kind, "unresolved");
  node(root, [process.pid]);
  for (let i = 0; i < 256; i++) node(path.join(root, `child-${i}`), []);
  assert.equal(observeBootServiceOwners(lease, paths).kind, "unresolved");
  for (let i = 0; i < 256; i++) fs.rmSync(path.join(root, `child-${i}`), { recursive: true });
  assert.equal(currentCgroup(paths), group);
  assert.deepEqual(directoryIdentity(root), base.cgroupIdentity);
  membership("/");
  assert.equal(currentCgroup(paths), "/", "outside gate may be in unified root");
  fs.chmodSync(stateDirectory, 0o722);
  assert.throws(() => readBootServiceLease(stateDirectory), /not writable/);
  fs.chmodSync(stateDirectory, 0o700);
  fs.chmodSync(path.join(stateDirectory, "lease.json"), 0o622);
  assert.throws(() => readBootServiceLease(stateDirectory), /Invalid boot state/);
  fs.chmodSync(path.join(stateDirectory, "lease.json"), 0o600);
  fs.writeFileSync(path.join(stateDirectory, "lease.json"), "x".repeat(8193));
  assert.throws(() => readBootServiceLease(stateDirectory), /Invalid boot state/);
  console.log(
    "boot service cleanup: exact-self subtree ownership, current invocation, managed lease, revalidation, restore/readback, historical gate and bounds PASS (ioctls injected; no devices)",
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}
