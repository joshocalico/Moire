import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  beginBootService,
  initBootAttemptLedger,
  recordBootAttempt,
  serviceIdentity,
  readBootServiceLease,
  openManagedBootConsole,
  cleanupBootService,
  type BootConsoleIo,
  type BootServicePaths,
} from "@moire/sys";
import { BootGuardian } from "./guardian";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "moire-managed-guardian-"));
const paths: BootServicePaths = {
  cgroupMount: path.join(fixture, "cgroup"),
  procRoot: path.join(fixture, "proc"),
  selfPid: process.pid,
};
const cgroupPath = "/system.slice/moire-boot.service",
  root = path.join(paths.cgroupMount, cgroupPath),
  stateDirectory = path.join(fixture, "state");
const parentFile = path.join(fixture, "parent.mjs"),
  descendantFile = path.join(fixture, "descendant.mjs");
fs.writeFileSync(
  descendantFile,
  `
import fs from 'node:fs';
fs.fstatSync(3); // a real ordinary descriptor inherited from the renderer parent
fs.writeSync(4, JSON.stringify({pid:process.pid})+'\\n');
process.on('SIGTERM',()=>{});
setInterval(()=>{},1000);
`,
);
fs.writeFileSync(
  parentFile,
  `
import fs from 'node:fs'; import {spawn} from 'node:child_process';
const fd=fs.openSync(process.argv[3],'r');
spawn(process.execPath,[process.argv[2]],{detached:true,stdio:['ignore','ignore','ignore',fd,4]});
fs.closeSync(fd); fs.closeSync(4);
process.on('SIGTERM',()=>process.exit(0));
setInterval(()=>{},1000);
`,
);
fs.writeFileSync(path.join(fixture, "owned.txt"), "owned fixture descriptor\n");
fs.mkdirSync(path.join(paths.procRoot, "sys/kernel/random"), { recursive: true });
fs.writeFileSync(
  path.join(paths.procRoot, "sys/kernel/random/boot_id"),
  "12345678-1234-1234-1234-123456789abc\n",
);
fs.mkdirSync(path.join(paths.procRoot, String(process.pid)), { recursive: true });
fs.writeFileSync(path.join(paths.procRoot, String(process.pid), "cgroup"), `0::${cgroupPath}\n`);
fs.mkdirSync(root, { recursive: true });
fs.writeFileSync(path.join(root, "cgroup.type"), "domain\n");
function members(pids: readonly number[]) {
  fs.writeFileSync(path.join(root, "cgroup.procs"), pids.join("\n") + "\n");
  fs.writeFileSync(path.join(root, "cgroup.events"), `populated ${Number(pids.length > 0)}\n`);
}
let mode = 0;
const modes: number[] = [];
const io: BootConsoleIo = {
  open: () => 42,
  inspect: () => ({ activeVt: 1, mode, rdev: "1025" }),
  setMode(_fd, next) {
    mode = next;
    modes.push(next);
  },
  close() {},
};
const running: { renderer: ChildProcess | null; descendantClosed: Promise<void> | null } = {
  renderer: null,
  descendantClosed: null,
};
let descendantPid: number | null = null;
try {
  members([process.pid]);
  const expected = serviceIdentity({ INVOCATION_ID: "1234567890abcdef1234567890abcdef" }, paths);
  initBootAttemptLedger(stateDirectory, expected);
  await recordBootAttempt({
    stateDirectory,
    expected,
    paths,
    observeManager: async () => ({
      unit: expected.unit,
      loadState: "loaded",
      activeState: "activating",
      invocationId: expected.invocationId,
      mainPid: 0,
      controlPid: process.pid,
      cgroupPath,
      jobId: 1,
      timestamps: ["0", "0", "0", "0", "0", "1"],
      executed: false,
    }),
  });
  const base = beginBootService(stateDirectory, expected, paths);
  const consoleLease = openManagedBootConsole({ ttyPath: "/dev/tty1", stateDirectory, base, io });
  let resolveReady: (pid: number) => void = () => {};
  const ready = new Promise<number>((resolve) => {
    resolveReady = resolve;
  });
  const guardian = new BootGuardian({
    console: consoleLease,
    observeEscape: () => () => {},
    gracefulMs: 100,
    hardStopMs: 1000,
    startRenderer() {
      const child = spawn(
        process.execPath,
        [parentFile, descendantFile, path.join(fixture, "owned.txt")],
        {
          detached: true,
          stdio: ["ignore", "ignore", "inherit", "ipc", "pipe"],
          env: { ...process.env, HOME: fixture, XDG_RUNTIME_DIR: fixture },
        },
      );
      running.renderer = child;
      const channel = child.stdio[4];
      if (!channel || !("on" in channel)) throw new Error("Missing descendant evidence pipe");
      running.descendantClosed = new Promise((resolve) => channel.on("close", resolve));
      channel.on("data", (bytes: Buffer) => {
        const evidence: unknown = JSON.parse(bytes.toString("utf8"));
        if (
          typeof evidence !== "object" ||
          evidence === null ||
          !("pid" in evidence) ||
          typeof evidence.pid !== "number" ||
          !Number.isSafeInteger(evidence.pid) ||
          evidence.pid <= 0
        )
          throw new Error("Invalid actual descendant PID");
        resolveReady(evidence.pid);
      });
      return child;
    },
  });
  guardian.start();
  descendantPid = await Promise.race([
    ready,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Descendant fixture timeout")), 3000).unref(),
    ),
  ]);
  assert.ok(running.renderer?.pid);
  process.kill(descendantPid, 0);
  members([process.pid, running.renderer.pid, descendantPid]);
  const result = await guardian.release("stage-complete");
  assert.equal(result.kind, "renderer-exited");
  assert.equal(guardian.phase, "renderer-exited");
  assert.equal(mode, 1, "renderer direct exit does not restore managed console");
  process.kill(descendantPid, 0); // new-session descendant actually survived group TERM
  members([process.pid, descendantPid]);
  assert.equal(
    cleanupBootService({ stateDirectory, expected, paths, consoleIo: io }).kind,
    "pending",
  );
  assert.equal(mode, 1);
  assert.ok(!fs.existsSync(path.join(stateDirectory, "release.json")));
  process.kill(descendantPid, "SIGKILL");
  assert.ok(running.descendantClosed);
  await Promise.race([
    running.descendantClosed,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Descendant FD pipe did not close")), 3000).unref(),
    ),
  ]);
  descendantPid = null;
  members([process.pid]);
  assert.equal(
    cleanupBootService({ stateDirectory, expected, paths, consoleIo: io }).kind,
    "released",
  );
  assert.deepEqual(modes, [1, 0]);
  assert.equal(readBootServiceLease(stateDirectory).phase, "graphics-intent");
  console.log(
    "managed guardian: actual parent exit/new-session descendant with inherited ordinary FD blocks external restore until actual pipe closure PASS (cgroup files and ioctls are fixtures; no DRM/VT)",
  );
} finally {
  if (descendantPid) {
    try {
      process.kill(descendantPid, "SIGKILL");
    } catch {}
  }
  if (
    running.renderer?.pid &&
    running.renderer.exitCode === null &&
    running.renderer.signalCode === null
  ) {
    try {
      process.kill(-running.renderer.pid, "SIGKILL");
    } catch {}
  }
  fs.rmSync(fixture, { recursive: true, force: true });
}
