import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// Node's direct ESM runner requires this extension; no bundler or runtime flags are involved.
// oxlint-disable-next-line no-restricted-imports
import {
  inspectProcess,
  parseProcessStat,
  readBoundedMetadata,
  armInputFixture,
  parseDeclaration,
  linuxDeviceNumbers,
} from "./prepare-input-fixture.mjs";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
/* oxlint-disable no-relative-parent-imports */
// oxlint-disable-next-line no-restricted-imports
import {
  parseNodeScriptCmdline,
  readProcessEntryPoint,
} from "../packages/sys/src/input-fixture-process-identity.mjs";
/* oxlint-enable no-relative-parent-imports */

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "moire-input-preparer-smoke-")));
let cases = 0;
const check = (name, test) => {
  test();
  cases++;
  console.log(`PASS ${name}`);
};
const pid = 123;
const uid = process.getuid();
const cwd = path.join(root, "app");
const processDirectory = path.join(root, String(pid));
const statFile = path.join(processDirectory, "stat");
const statusFile = path.join(processDirectory, "status");
const stat = (start = "999", comm = "Screenshot (fixture) name)", state = "S") =>
  `${pid} (${comm}) ${[state, ...Array(18).fill("0"), start, "0", "0"].join(" ")}\n`;
const status = (uids = [uid, uid, uid, uid]) => `Name:\tfixture\nUid:\t${uids.join("\t")}\n`;
const entryPoint = path.join(cwd, "main.mjs");
const cmdline = (...argv) => Buffer.from(argv.join("\0") + "\0");
const fixtureEntryPoint = (procRoot) => (actorPid, actorCwd) =>
  fs.realpathSync(
    parseNodeScriptCmdline(
      fs.readFileSync(path.join(procRoot, String(actorPid), "cmdline")),
      actorCwd,
    ),
  );
const expected = { pid, uid, startTicks: "999", cwd, entryPoint };
const inspect = (options = {}) =>
  inspectProcess(expected, { procRoot: root, readEntryPoint: fixtureEntryPoint(root), ...options });
const reset = () => {
  fs.writeFileSync(statFile, stat());
  fs.writeFileSync(statusFile, status());
  fs.writeFileSync(path.join(processDirectory, "cmdline"), cmdline("/bin/node", "main.mjs"));
};

try {
  fs.mkdirSync(processDirectory);
  fs.mkdirSync(cwd);
  fs.writeFileSync(entryPoint, "// inert process metadata fixture\n");
  fs.symlinkSync(cwd, path.join(processDirectory, "cwd"));
  reset();
  check("actual ordinary proc fixture with parentheses/spaces", () =>
    assert.deepEqual(inspect(), expected),
  );
  check("exact kernel field 22", () =>
    assert.equal(
      parseProcessStat(stat("123456789012345678"), pid).startTicks,
      "123456789012345678",
    ),
  );
  check("wrong PID rejected", () => assert.throws(() => parseProcessStat(stat(), pid + 1), /PID/));
  for (const state of ["Z", "X", "x"])
    check(`nonlive state ${state} rejected`, () =>
      assert.throws(() => parseProcessStat(stat("999", "app", state), pid), /live/),
    );
  check("truncated stat rejected", () =>
    assert.throws(() => parseProcessStat(`${pid} (app) S 1`, pid), /start ticks/),
  );
  check("wrong declared start rejected", () => {
    fs.writeFileSync(statFile, stat("1000"));
    assert.throws(inspect, /start ticks/);
    reset();
  });
  check("PID reuse during stat boundary rejected", () => {
    let reads = 0;
    assert.throws(
      () =>
        inspect({
          readText(file, limit) {
            const text = readBoundedMetadata(file, limit);
            if (file === statFile && ++reads === 1) fs.writeFileSync(statFile, stat("1001"));
            return text;
          },
        }),
      /start ticks/,
    );
    reset();
  });
  check("exit while metadata read rejected", () => {
    assert.throws(
      () =>
        inspect({
          readText(file, limit) {
            const text = readBoundedMetadata(file, limit);
            if (file === statusFile) fs.unlinkSync(statFile);
            return text;
          },
        }),
      /ENOENT/,
    );
    reset();
  });
  check("effective UID mismatch rejected", () => {
    fs.writeFileSync(statusFile, status([uid, uid + 1, uid, uid]));
    assert.throws(inspect, /UID does not match/);
    reset();
  });
  check("UID change during inspection rejected", () => {
    let reads = 0;
    assert.throws(
      () =>
        inspect({
          readText(file, limit) {
            const text = readBoundedMetadata(file, limit);
            if (file === statusFile && ++reads === 1)
              fs.writeFileSync(statusFile, status([uid + 1, uid + 1, uid + 1, uid + 1]));
            return text;
          },
        }),
      /UID does not match/,
    );
    reset();
  });
  check("duplicate UID record rejected", () => {
    fs.writeFileSync(statusFile, status() + status());
    assert.throws(inspect, /UID metadata/);
    reset();
  });
  check("malformed UID record rejected", () => {
    fs.writeFileSync(statusFile, "Uid: 0 0 0 nope\n");
    assert.throws(inspect, /UID metadata/);
    reset();
  });
  check("wrong cwd rejected", () =>
    assert.throws(
      () =>
        inspectProcess(
          { ...expected, cwd: root },
          { procRoot: root, readEntryPoint: fixtureEntryPoint(root) },
        ),
      /cwd/,
    ),
  );
  check("cwd change during inspection rejected", () => {
    let reads = 0;
    assert.throws(
      () =>
        inspect({
          readLink(file) {
            return ++reads === 1 ? fs.readlinkSync(file) : root;
          },
        }),
      /cwd/,
    );
  });
  check("ambiguous declared cwd rejected", () =>
    assert.throws(
      () => inspectProcess({ ...expected, cwd: `${root}/../app` }, { procRoot: root }),
      /declared/,
    ),
  );
  check("oversized stat bounded", () => {
    fs.writeFileSync(statFile, "x".repeat(8193));
    assert.throws(inspect, /exceeds/);
    reset();
  });
  check("NUL metadata rejected", () => {
    fs.writeFileSync(statusFile, status() + "\0");
    assert.throws(inspect, /NUL/);
    reset();
  });
  check("invalid UTF8 rejected", () => {
    fs.writeFileSync(statusFile, Buffer.from([0xff]));
    assert.throws(inspect);
    reset();
  });
  const parse = (...argv) => parseNodeScriptCmdline(cmdline(...argv), cwd);
  check("absolute Node script with native Home cwd", () =>
    assert.equal(
      parse("/nix/store/node/bin/node", "--import", "/loader.mjs", entryPoint),
      entryPoint,
    ),
  );
  check("relative script resolves from exact cwd", () =>
    assert.equal(parse("node", "main.mjs"), entryPoint),
  );
  for (const option of ["--import", "--loader", "--experimental-loader"])
    check(`${option} separate and equals values are not scripts`, () => {
      assert.equal(
        parse("node", option, "/malicious/apps/system/compositor/src/main.ts", "main.mjs"),
        entryPoint,
      );
      assert.equal(
        parse("node", `${option}=/malicious/apps/system/compositor/src/main.ts`, "main.mjs"),
        entryPoint,
      );
    });
  check("separator selects real script and ignores document args", () => {
    assert.equal(
      parse("node", "--", "main.mjs", "/apps/system/compositor/src/main.ts"),
      entryPoint,
    );
    assert.equal(
      parse("node", "main.mjs", "--eval", "/apps/system/compositor/src/main.ts"),
      entryPoint,
    );
  });
  for (const argv of [
    ["node", "--eval", "main.mjs"],
    ["node", "-e", "main.mjs"],
    ["node", "--print", "main.mjs"],
    ["node", "-p", "main.mjs"],
    ["node", "--require", "main.mjs"],
    ["node", "--unknown", "main.mjs"],
    ["node", "--import"],
    ["node", "--loader="],
    ["node", "--import", "--", "main.mjs"],
    ["node", "--"],
    ["node", "--", "-"],
    ["node", ""],
    ["node"],
    ["tsx", "main.mjs"],
  ])
    check(`ambiguous Node invocation rejected ${argv.join(" ")}`, () =>
      assert.throws(() => parse(...argv)),
    );
  check("incomplete NUL framing rejected", () =>
    assert.throws(() => parseNodeScriptCmdline(Buffer.from("node\0main.mjs"), cwd)),
  );
  check("invalid cmdline UTF8 rejected", () =>
    assert.throws(() => parseNodeScriptCmdline(Buffer.from([0xff, 0]), cwd)),
  );
  check("cmdline byte and argument bounds enforced", () => {
    assert.throws(() => parse("node", "x".repeat(16384)));
    assert.throws(() => parse("node", "main.mjs", ...Array(63).fill("document")));
    assert.equal(parse("node", "main.mjs", ...Array(62).fill("document")), entryPoint);
  });
  check("cmdline changes during process snapshot rejected", () => {
    const other = path.join(cwd, "other.mjs");
    fs.writeFileSync(other, "// different script\n");
    let reads = 0;
    assert.throws(
      () =>
        inspect({
          readEntryPoint(actorPid, actorCwd) {
            const actual = fixtureEntryPoint(root)(actorPid, actorCwd);
            if (++reads === 1)
              fs.writeFileSync(path.join(processDirectory, "cmdline"), cmdline("node", other));
            return actual;
          },
        }),
      /entry point/,
    );
    reset();
  });
  check("bounded proc reader validates PID before metadata access", () => {
    assert.throws(() => readProcessEntryPoint(0, cwd), /PID/);
    assert.throws(() => readProcessEntryPoint(1.5, cwd), /PID/);
  });
  check("proc reader canonicalizes actual script and closes on every outcome", () => {
    const file = path.join(processDirectory, "cmdline");
    const originalOpen = fs.openSync,
      originalClose = fs.closeSync;
    const owned = new Set();
    let opens = 0,
      closes = 0;
    fs.openSync = (requested, flags) => {
      if (requested !== `/proc/${pid}/cmdline`) return originalOpen(requested, flags);
      assert.equal(requested, `/proc/${pid}/cmdline`);
      assert.equal(flags, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      opens++;
      const fd = originalOpen(file, flags);
      owned.add(fd);
      return fd;
    };
    fs.closeSync = (fd) => {
      if (owned.delete(fd)) closes++;
      return originalClose(fd);
    };
    try {
      assert.equal(readProcessEntryPoint(pid, cwd), entryPoint);
      fs.writeFileSync(file, cmdline("node", "--eval", "main.mjs"));
      assert.throws(() => readProcessEntryPoint(pid, cwd), /Unsupported/);
      fs.writeFileSync(file, Buffer.alloc(16385, 0));
      assert.throws(() => readProcessEntryPoint(pid, cwd), /bounded/);
      fs.writeFileSync(file, cmdline("node", "missing.mjs"));
      assert.throws(() => readProcessEntryPoint(pid, cwd), /ENOENT/);
      assert.equal(opens, 4);
      assert.equal(closes, opens);
    } finally {
      fs.openSync = originalOpen;
      fs.closeSync = originalClose;
      reset();
    }
  });
  const proc = path.join(root, "proc");
  const sys = path.join(root, "sys");
  const parent = path.join(root, "outputs");
  const bootId = "12345678-1234-1234-1234-123456789abc";
  const bootFile = path.join(proc, "sys/kernel/random/boot_id");
  fs.mkdirSync(path.dirname(bootFile), { recursive: true });
  fs.writeFileSync(bootFile, bootId + "\n");
  fs.mkdirSync(parent);
  const actors = {};
  for (const [role, actorPid, suffix] of [
    ["compositor", 223, "apps/system/compositor"],
    ["app", 224, "apps/bundled/screenshot"],
  ]) {
    const actorCwd =
      role === "compositor" ? path.join(root, "home") : path.join(root, "install", suffix);
    const actorEntry = path.join(
      root,
      "install",
      suffix,
      "src",
      role === "compositor" ? "main.ts" : "main.tsx",
    );
    const base = path.join(proc, String(actorPid));
    fs.mkdirSync(actorCwd, { recursive: true });
    fs.mkdirSync(path.dirname(actorEntry), { recursive: true });
    fs.writeFileSync(actorEntry, "// inert metadata actor\n");
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(path.join(base, "stat"), stat().replace(/^123 /, `${actorPid} `));
    fs.writeFileSync(path.join(base, "status"), status());
    fs.symlinkSync(actorCwd, path.join(base, "cwd"));
    fs.writeFileSync(
      path.join(base, "cmdline"),
      cmdline(
        "node",
        "--import",
        "/loader.mjs",
        role === "compositor" ? actorEntry : "src/main.tsx",
      ),
    );
    actors[role] = { pid: actorPid, uid, startTicks: "999", cwd: actorCwd, entryPoint: actorEntry };
  }
  const sysfs = path.join(sys, "devices/input/event0");
  fs.mkdirSync(sysfs, { recursive: true });
  fs.mkdirSync(path.join(sys, "dev/char"), { recursive: true });
  fs.symlinkSync(sysfs, path.join(sys, "dev/char/13:64"));
  const device = { path: "/dev/input/event0", rdev: "3392", sysfs, kind: "keyboard" };
  const pointerSysfs = path.join(sys, "devices/input/event1");
  fs.mkdirSync(pointerSysfs, { recursive: true });
  fs.symlinkSync(pointerSysfs, path.join(sys, "dev/char/13:65"));
  const pointer = { path: "/dev/input/event1", rdev: "3393", sysfs: pointerSysfs, kind: "pointer" };
  const declaration = () => ({
    version: 2,
    runId: randomUUID(),
    bootId,
    scenario: "keys",
    ...structuredClone(actors),
    appId: "org.moire.Screenshot",
    devices: [{ ...device }, { ...pointer }],
  });
  const output = (spec) => path.join(parent, `moire-input-fixture-${spec.runId}`, "manifest.json");
  const options = {
    platform: "linux",
    uid,
    fixtureParent: parent,
    procRoot: proc,
    readEntryPoint: fixtureEntryPoint(proc),
    sysRoot: sys,
    now: () => 123000000000n,
    deviceStat: (file) => ({
      isCharacterDevice: () => true,
      isSymbolicLink: () => false,
      rdev: file === device.path ? 3392n : 3393n,
    }),
    deviceRealpath: (file) => file,
  };
  const arm = (spec = declaration(), extra = {}) =>
    armInputFixture(output(spec), spec, { ...options, ...extra });
  const unchanged = () => assert.equal(fs.readFileSync(bootFile, "utf8"), bootId + "\n");
  check("exact manifest schema/private atomic publication", () => {
    const spec = declaration();
    const opened = [];
    const originalOpen = fs.openSync;
    fs.openSync = (...args) => {
      opened.push(args[0]);
      assert.ok(!String(args[0]).startsWith("/dev/"));
      return originalOpen(...args);
    };
    let result;
    try {
      result = arm(spec);
    } finally {
      fs.openSync = originalOpen;
    }
    assert.equal(result.manifest.armedAtMonoNs, "123000000000");
    assert.equal(result.deadlineMonoNs, "213000000000");
    assert.deepEqual(JSON.parse(fs.readFileSync(output(spec), "utf8")), {
      ...spec,
      armedAtMonoNs: "123000000000",
    });
    assert.equal(fs.statSync(output(spec)).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(output(spec))).mode & 0o777, 0o700);
    assert.equal(fs.statSync(output(spec)).uid, uid);
    assert.deepEqual(fs.readdirSync(path.dirname(output(spec))), ["manifest.json"]);
    assert.ok(opened.length > 0);
  });
  check("nonLinux cannot arm", () =>
    assert.throws(() => arm(undefined, { platform: "darwin" }), /Linux/),
  );
  check("wrong preparer UID cannot arm", () =>
    assert.throws(() => arm(undefined, { uid: uid + 1 }), /Preparer UID/),
  );
  check("wrong boot cannot arm", () => {
    const spec = declaration();
    spec.bootId = randomUUID();
    assert.throws(() => arm(spec), /Boot ID/);
  });
  check("unknown manifest field rejected", () =>
    assert.throws(() => parseDeclaration({ ...declaration(), armedAtMonoNs: "0" }), /fields/),
  );
  check("old actor schema cannot arm", () => {
    const spec = declaration();
    spec.version = 1;
    assert.throws(() => arm(spec), /declaration/);
  });
  check("unexpected app rejected", () =>
    assert.throws(
      () => parseDeclaration({ ...declaration(), appId: "org.moire.Editor" }),
      /declaration/,
    ),
  );
  check("unexpected actor exact cwd rejected", () => {
    const spec = declaration();
    spec.app.cwd = cwd;
    assert.throws(() => arm(spec), /cwd/);
  });
  check("different source-tree entry points rejected", () => {
    const spec = declaration();
    spec.app.entryPoint = path.join(root, "foreign/apps/bundled/screenshot/src/main.tsx");
    assert.throws(() => arm(spec), /source-tree/);
  });
  check("document argv cannot impersonate role script", () => {
    const spec = declaration();
    const file = path.join(proc, String(spec.app.pid), "cmdline");
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, cmdline("node", entryPoint, spec.app.entryPoint));
    assert.throws(() => arm(spec), /entry point/);
    fs.writeFileSync(file, original);
  });
  check("wrong role entry point rejected", () => {
    const spec = declaration();
    spec.app.entryPoint = spec.compositor.entryPoint;
    assert.throws(() => arm(spec), /identity/);
  });
  check("loader argv cannot impersonate role script", () => {
    const spec = declaration();
    const file = path.join(proc, String(spec.app.pid), "cmdline");
    const original = fs.readFileSync(file);
    fs.writeFileSync(file, cmdline("node", "--loader", spec.app.entryPoint, entryPoint));
    assert.throws(() => arm(spec), /entry point/);
    fs.writeFileSync(file, original);
  });
  check("symlink actor cwd declaration rejected", () => {
    const spec = declaration();
    const alias = path.join(root, "alias/apps/bundled/screenshot");
    fs.mkdirSync(path.dirname(alias), { recursive: true });
    fs.symlinkSync(spec.app.cwd, alias);
    spec.app.cwd = alias;
    assert.throws(() => arm(spec), /canonical/);
  });
  check("symlink role entry point declaration rejected", () => {
    const spec = declaration();
    const original = spec.app.entryPoint + ".original";
    fs.renameSync(spec.app.entryPoint, original);
    fs.symlinkSync(original, spec.app.entryPoint);
    try {
      assert.throws(() => arm(spec), /entry point must be canonical/);
    } finally {
      fs.unlinkSync(spec.app.entryPoint);
      fs.renameSync(original, spec.app.entryPoint);
    }
  });
  check("manifest path must match UUID", () => {
    const spec = declaration();
    assert.throws(() => armInputFixture(output(declaration()), spec, options), /UUID/);
  });
  check("duplicate device identity rejected", () => {
    const spec = declaration();
    spec.devices.push({ ...device, path: "/dev/input/event1" });
    assert.throws(() => arm(spec), /Duplicate/);
  });
  check("scenario needs actual declared device kind", () => {
    const spec = declaration();
    spec.scenario = "pointer";
    spec.devices = [{ ...device }];
    assert.throws(() => arm(spec), /pointer/);
  });
  check("keys-only declaration contradicts runtime and is rejected", () => {
    const spec = declaration();
    spec.devices = [{ ...device }];
    assert.throws(() => arm(spec), /pointer/);
  });
  check("keys requires keyboard as well as pointer", () => {
    const spec = declaration();
    spec.devices = [{ ...pointer }];
    assert.throws(() => arm(spec), /keyboard/);
  });
  check("sysfs outside canonical sys devices subtree rejected", () => {
    const spec = declaration();
    spec.devices[0].sysfs = path.join(sys, "elsewhere");
    assert.throws(() => arm(spec), /declared input device/);
  });
  check("regular-file device substitute rejected", () =>
    assert.throws(
      () => arm(undefined, { deviceStat: () => ({ isCharacterDevice: () => false }) }),
      /type\/path\/rdev/,
    ),
  );
  check("device symlink rejected", () =>
    assert.throws(
      () =>
        arm(undefined, {
          deviceStat: () => ({ isCharacterDevice: () => true, isSymbolicLink: () => true }),
        }),
      /type\/path\/rdev/,
    ),
  );
  check("device rdev mismatch rejected", () =>
    assert.throws(
      () =>
        arm(undefined, {
          deviceStat: () => ({
            isCharacterDevice: () => true,
            isSymbolicLink: () => false,
            rdev: 3393n,
          }),
        }),
      /rdev/,
    ),
  );
  check("sysfs mismatch rejected", () =>
    assert.throws(() => arm(undefined, { sysfsRealpath: () => root }), /sysfs/),
  );
  check("full Linux dev_t major/minor retained", () => {
    const major = 0x12345n,
      minor = 0x234567n;
    const encoded =
      (minor & 0xffn) |
      ((major & 0xfffn) << 8n) |
      ((minor & ~0xffn) << 12n) |
      ((major & ~0xfffn) << 32n);
    assert.deepEqual(linuxDeviceNumbers(encoded), { major, minor });
    assert.deepEqual(linuxDeviceNumbers(3392n), { major: 13n, minor: 64n });
  });
  check("existing directory untouched", () => {
    const spec = declaration();
    fs.mkdirSync(path.dirname(output(spec)));
    const sentinel = path.join(path.dirname(output(spec)), "sentinel");
    fs.writeFileSync(sentinel, "ORIGINAL");
    assert.throws(() => arm(spec), /EEXIST/);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "ORIGINAL");
  });
  check("existing directory symlink untouched", () => {
    const spec = declaration();
    fs.symlinkSync(cwd, path.dirname(output(spec)));
    assert.throws(() => arm(spec), /EEXIST/);
    assert.equal(fs.readlinkSync(path.dirname(output(spec))), cwd);
  });
  check("failed staging write cleans only own unpublished directory", () => {
    const spec = declaration();
    assert.throws(
      () =>
        arm(spec, {
          write() {
            throw new Error("fixture EIO");
          },
        }),
      /EIO/,
    );
    assert.equal(fs.existsSync(path.dirname(output(spec))), false);
    unchanged();
  });
  check("boot change before publication blocked", () => {
    const spec = declaration();
    assert.throws(
      () =>
        arm(spec, {
          write(fd, bytes) {
            fs.writeFileSync(fd, bytes);
            fs.writeFileSync(bootFile, randomUUID());
          },
        }),
      /Boot ID/,
    );
    assert.equal(fs.existsSync(output(spec)), false);
    fs.writeFileSync(bootFile, bootId + "\n");
  });
  check("actor restart before publication blocked", () => {
    const spec = declaration();
    const appStat = path.join(proc, String(spec.app.pid), "stat");
    const original = fs.readFileSync(appStat);
    assert.throws(
      () =>
        arm(spec, {
          write(fd, bytes) {
            fs.writeFileSync(fd, bytes);
            fs.writeFileSync(appStat, stat("1001").replace(/^123 /, `${spec.app.pid} `));
          },
        }),
      /start ticks/,
    );
    assert.equal(fs.existsSync(output(spec)), false);
    fs.writeFileSync(appStat, original);
  });
  check("actor script change before publication blocked", () => {
    const spec = declaration();
    const file = path.join(proc, String(spec.app.pid), "cmdline");
    const original = fs.readFileSync(file);
    try {
      assert.throws(
        () =>
          arm(spec, {
            write(fd, bytes) {
              fs.writeFileSync(fd, bytes);
              fs.writeFileSync(file, cmdline("node", entryPoint, spec.app.entryPoint));
            },
          }),
        /entry point/,
      );
      assert.equal(fs.existsSync(output(spec)), false);
    } finally {
      fs.writeFileSync(file, original);
    }
  });
  check("device replacement before publication blocked", () => {
    const spec = declaration();
    let calls = 0;
    assert.throws(
      () =>
        arm(spec, {
          deviceStat(file) {
            return {
              isCharacterDevice: () => true,
              isSymbolicLink: () => false,
              rdev:
                BigInt(file === device.path ? device.rdev : pointer.rdev) + (++calls > 4 ? 1n : 0n),
            };
          },
        }),
      /rdev/,
    );
    assert.equal(fs.existsSync(output(spec)), false);
  });
  check("negative monotonic timestamp blocked", () => {
    const spec = declaration();
    assert.throws(() => arm(spec, { now: () => -1n }), /timestamp/);
    assert.equal(fs.existsSync(path.dirname(output(spec))), false);
  });
  check("backwards clock blocked before publication", () => {
    const spec = declaration();
    let calls = 0;
    assert.throws(() => arm(spec, { now: () => (++calls === 1 ? 10n : 9n) }), /clock changed/);
    assert.equal(fs.existsSync(path.dirname(output(spec))), false);
  });
  check("90s deadline inclusive rejects unpublished fixture", () => {
    const spec = declaration();
    let calls = 0;
    assert.throws(
      () => arm(spec, { now: () => (++calls === 1 ? 0n : 90_000_000_000n) }),
      /deadline/,
    );
    assert.equal(fs.existsSync(path.dirname(output(spec))), false);
  });
  check("concurrent target insertion never overwritten", () => {
    const spec = declaration();
    assert.throws(
      () =>
        arm(spec, {
          publish(staged, target) {
            fs.writeFileSync(target, "FOREIGN", { flag: "wx" });
            fs.linkSync(staged, target);
          },
        }),
      /EEXIST/,
    );
    assert.equal(fs.readFileSync(output(spec), "utf8"), "FOREIGN");
  });
  check("concurrent manifest symlink never followed", () => {
    const spec = declaration();
    const original = path.join(root, "original-target");
    fs.writeFileSync(original, "PRESERVED");
    assert.throws(
      () =>
        arm(spec, {
          publish(staged, target) {
            fs.symlinkSync(original, target);
            fs.linkSync(staged, target);
          },
        }),
      /EEXIST/,
    );
    assert.equal(fs.readFileSync(original, "utf8"), "PRESERVED");
    assert.equal(fs.readlinkSync(output(spec)), original);
  });
  check("replaced directory is preserved", () => {
    const spec = declaration();
    const directory = path.dirname(output(spec));
    assert.throws(
      () =>
        arm(spec, {
          write(fd, bytes) {
            fs.writeFileSync(fd, bytes);
            fs.renameSync(directory, directory + ".old");
            fs.mkdirSync(directory);
            fs.writeFileSync(path.join(directory, "foreign"), "UNCHANGED");
          },
        }),
      /replaced/,
    );
    assert.equal(fs.readFileSync(path.join(directory, "foreign"), "utf8"), "UNCHANGED");
  });
  check("replaced staging file is preserved", () => {
    const spec = declaration();
    let staged;
    assert.throws(
      () =>
        arm(spec, {
          write(fd, bytes) {
            fs.writeFileSync(fd, bytes);
            const directory = path.dirname(output(spec));
            staged = path.join(directory, fs.readdirSync(directory)[0]);
            fs.renameSync(staged, staged + ".original");
            fs.writeFileSync(staged, "FOREIGN", { flag: "wx" });
          },
        }),
      /staging.*replaced/,
    );
    assert.equal(fs.readFileSync(staged, "utf8"), "FOREIGN");
    assert.equal(fs.existsSync(output(spec)), false);
  });
  check("direct CLI malformed args exits without side effects", () => {
    const child = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("./prepare-input-fixture.mjs", import.meta.url))],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 1);
    assert.match(child.stderr, /Usage/);
  });
  console.log(
    JSON.stringify({
      scope: "ordinary temporary proc fixtures only; no native operations",
      cases,
      result: 0,
    }),
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
