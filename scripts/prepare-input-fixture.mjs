import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
// Direct Node ESM execution requires the explicit extension.
// oxlint-disable-next-line no-restricted-imports, no-relative-parent-imports
import { readProcessEntryPoint } from "../packages/sys/src/input-fixture-process-identity.mjs";

/** Only proc metadata files are opened. Device validation must use stat/readlink. */
export function readBoundedMetadata(file, limit) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > limit) throw new Error(`Metadata exceeds ${limit} bytes: ${file}`);
    const bytes = buffer.subarray(0, length);
    if (bytes.includes(0)) throw new Error(`NUL in metadata: ${file}`);
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } finally {
    fs.closeSync(fd);
  }
}

export function parseProcessStat(text, expectedPid) {
  const close = text.lastIndexOf(")");
  const prefix = text.slice(0, text.indexOf("("));
  if (close < 0 || !/^\d+ $/.test(prefix) || Number(prefix.trim()) !== expectedPid)
    throw new Error("Invalid process stat PID/comm");
  const fields = text
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  // fields[0] is kernel field 3 (state); starttime is kernel field 22.
  const startTicks = fields[19];
  if (!/^[RSDZTWXxKPI]$/.test(fields[0] ?? "") || !/^(0|[1-9]\d*)$/.test(startTicks ?? ""))
    throw new Error("Invalid process stat state/start ticks");
  if (fields[0] === "Z" || fields[0] === "X" || fields[0] === "x")
    throw new Error("Process is no longer live");
  return { pid: expectedPid, startTicks };
}

export function parseProcessUids(text) {
  const lines = text.split("\n").filter((line) => line.startsWith("Uid:"));
  if (lines.length !== 1 || !/^Uid:\s+\d+\s+\d+\s+\d+\s+\d+\s*$/.test(lines[0]))
    throw new Error("Invalid process UID metadata");
  const uids = lines[0].slice(4).trim().split(/\s+/).map(Number);
  if (uids.some((uid) => !Number.isSafeInteger(uid))) throw new Error("Invalid process UID");
  return uids;
}

/** Expected PID/start ticks/cwd are declared assertions, never inferred authority. */
export function inspectProcess(expected, options = {}) {
  const procRoot = options.procRoot ?? "/proc";
  const readText = options.readText ?? readBoundedMetadata;
  const readLink = options.readLink ?? fs.readlinkSync;
  const readEntryPoint = options.readEntryPoint ?? readProcessEntryPoint;
  if (
    !Number.isSafeInteger(expected.pid) ||
    expected.pid < 1 ||
    !Number.isSafeInteger(expected.uid) ||
    expected.uid < 0 ||
    !/^(0|[1-9]\d*)$/.test(expected.startTicks) ||
    typeof expected.cwd !== "string" ||
    !path.isAbsolute(expected.cwd) ||
    path.normalize(expected.cwd) !== expected.cwd ||
    expected.cwd.includes("\0") ||
    typeof expected.entryPoint !== "string" ||
    !path.isAbsolute(expected.entryPoint) ||
    path.normalize(expected.entryPoint) !== expected.entryPoint ||
    /[\0\r\n]/.test(expected.entryPoint)
  )
    throw new Error("Invalid declared process identity");
  const base = path.join(procRoot, String(expected.pid));
  const before = parseProcessStat(readText(path.join(base, "stat"), 8192), expected.pid);
  const uids = parseProcessUids(readText(path.join(base, "status"), 16384));
  const cwd = readLink(path.join(base, "cwd"));
  if (cwd !== expected.cwd) throw new Error("Process cwd does not match");
  const entryPoint = readEntryPoint(expected.pid, cwd);
  const after = parseProcessStat(readText(path.join(base, "stat"), 8192), expected.pid);
  const finalUids = parseProcessUids(readText(path.join(base, "status"), 16384));
  const finalCwd = readLink(path.join(base, "cwd"));
  if (finalCwd !== expected.cwd) throw new Error("Process cwd does not match");
  const finalEntryPoint = readEntryPoint(expected.pid, finalCwd);
  if (before.startTicks !== expected.startTicks || after.startTicks !== expected.startTicks)
    throw new Error("Process start ticks changed or do not match");
  if ([...uids, ...finalUids].some((uid) => uid !== expected.uid))
    throw new Error("Process UID does not match");
  if (cwd !== expected.cwd || finalCwd !== expected.cwd)
    throw new Error("Process cwd does not match");
  if (entryPoint !== expected.entryPoint || finalEntryPoint !== expected.entryPoint)
    throw new Error("Process entry point does not match");
  return { pid: expected.pid, uid: expected.uid, startTicks: expected.startTicks, cwd, entryPoint };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const unsigned = (value) =>
  typeof value === "string" && value.length <= 20 && /^(0|[1-9]\d*)$/.test(value);
const record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function exactFields(value, fields) {
  if (
    !record(value) ||
    Object.keys(value).length !== fields.length ||
    fields.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error("Unexpected declaration fields");
}

export function parseDeclaration(value, options = {}) {
  exactFields(value, [
    "version",
    "runId",
    "bootId",
    "scenario",
    "compositor",
    "app",
    "appId",
    "devices",
  ]);
  if (
    value.version !== 2 ||
    !UUID.test(value.runId) ||
    !UUID.test(value.bootId) ||
    !["keys", "pointer"].includes(value.scenario) ||
    value.appId !== "org.moire.Screenshot"
  )
    throw new Error("Invalid fixture declaration");
  for (const [role, suffix] of [
    ["compositor", "/apps/system/compositor/src/main.ts"],
    ["app", "/apps/bundled/screenshot/src/main.tsx"],
  ]) {
    const actor = value[role];
    exactFields(actor, ["pid", "uid", "startTicks", "cwd", "entryPoint"]);
    if (
      !Number.isSafeInteger(actor.pid) ||
      actor.pid < 1 ||
      !Number.isSafeInteger(actor.uid) ||
      actor.uid < 0 ||
      !unsigned(actor.startTicks) ||
      typeof actor.cwd !== "string" ||
      actor.cwd.length > 4096 ||
      !path.isAbsolute(actor.cwd) ||
      path.normalize(actor.cwd) !== actor.cwd ||
      /[\0\r\n]/.test(actor.cwd) ||
      typeof actor.entryPoint !== "string" ||
      actor.entryPoint.length > 4096 ||
      !path.isAbsolute(actor.entryPoint) ||
      path.normalize(actor.entryPoint) !== actor.entryPoint ||
      /[\0\r\n]/.test(actor.entryPoint) ||
      !actor.entryPoint.endsWith(suffix)
    )
      throw new Error(`Invalid ${role} identity/cwd`);
  }
  if (
    value.compositor.entryPoint.slice(0, -"/apps/system/compositor/src/main.ts".length) !==
    value.app.entryPoint.slice(0, -"/apps/bundled/screenshot/src/main.tsx".length)
  )
    throw new Error("Fixture entry points must share one source-tree root");
  if (value.compositor.pid === value.app.pid || value.compositor.uid !== value.app.uid)
    throw new Error("Fixture processes must be distinct and share one UID");
  if (!Array.isArray(value.devices) || value.devices.length < 1 || value.devices.length > 16)
    throw new Error("Declare between 1 and 16 exact input devices");
  const paths = new Set(),
    identities = new Set();
  for (const device of value.devices) {
    exactFields(device, ["path", "rdev", "sysfs", "kind"]);
    if (
      typeof device.path !== "string" ||
      !/^\/dev\/input\/event(?:0|[1-9]\d*)$/.test(device.path) ||
      !unsigned(device.rdev) ||
      BigInt(device.rdev) > 0xffffffffffffffffn ||
      typeof device.sysfs !== "string" ||
      !device.sysfs.startsWith(`${options.sysRoot ?? "/sys"}/devices/`) ||
      !path.isAbsolute(device.sysfs) ||
      path.normalize(device.sysfs) !== device.sysfs ||
      /[\0\r\n]/.test(device.sysfs) ||
      device.sysfs.length > 4096 ||
      !["keyboard", "pointer"].includes(device.kind)
    )
      throw new Error("Invalid declared input device");
    if (paths.has(device.path) || identities.has(device.rdev))
      throw new Error("Duplicate input device path/rdev");
    paths.add(device.path);
    identities.add(device.rdev);
  }
  if (!value.devices.some((device) => device.kind === "pointer"))
    throw new Error("Scenario requires a pointer device");
  if (value.scenario === "keys" && !value.devices.some((device) => device.kind === "keyboard"))
    throw new Error("Keys scenario requires a keyboard device");
  return {
    ...value,
    compositor: { ...value.compositor },
    app: { ...value.app },
    devices: value.devices.map((device) => ({ ...device })),
  };
}

/** Linux dev_t encoding from sys/sysmacros.h, preserving the full bigint identity. */
export function linuxDeviceNumbers(rdev) {
  const device = BigInt(rdev);
  return {
    major: ((device >> 8n) & 0xfffn) | ((device >> 32n) & 0xfffff000n),
    minor: (device & 0xffn) | ((device >> 12n) & 0xffffff00n),
  };
}

export function inspectDevice(expected, options = {}) {
  const lstat = options.deviceStat ?? ((file) => fs.lstatSync(file, { bigint: true }));
  const realpath = options.deviceRealpath ?? fs.realpathSync;
  const sysfsRealpath = options.sysfsRealpath ?? fs.realpathSync;
  const sysRoot = options.sysRoot ?? "/sys";
  const stat = lstat(expected.path);
  if (
    !stat.isCharacterDevice() ||
    stat.isSymbolicLink() ||
    realpath(expected.path) !== expected.path ||
    String(stat.rdev) !== expected.rdev
  )
    throw new Error("Input device type/path/rdev does not match");
  const { major, minor } = linuxDeviceNumbers(stat.rdev);
  const actual = sysfsRealpath(path.join(sysRoot, "dev/char", `${major}:${minor}`));
  if (
    actual !== expected.sysfs ||
    !actual.startsWith(`${sysRoot}/devices/`) ||
    !fs.statSync(actual).isDirectory()
  )
    throw new Error("Input device sysfs identity does not match");
  return { ...expected };
}

/** Arm only after actual actors exist; no process launches, chown, or device opens. */
export function armInputFixture(manifestPath, input, options = {}) {
  const platform = options.platform ?? process.platform;
  const uid = options.uid ?? process.getuid?.();
  if (platform !== "linux") throw new Error("Input fixture preparation requires Linux");
  const declaration = parseDeclaration(input, options);
  if (uid !== declaration.app.uid)
    throw new Error("Preparer UID must match the existing fixture actors");
  const parent = options.fixtureParent ?? "/tmp";
  const directory = path.join(parent, `moire-input-fixture-${declaration.runId}`);
  if (manifestPath !== path.join(directory, "manifest.json"))
    throw new Error("Manifest must match new UUID fixture path");
  const readText = options.readText ?? readBoundedMetadata;
  const procRoot = options.procRoot ?? "/proc";
  const now = options.now ?? (() => process.hrtime.bigint());
  const bootPath = path.join(procRoot, "sys/kernel/random/boot_id");
  const validate = () => {
    if (readText(bootPath, 64).trim() !== declaration.bootId)
      throw new Error("Boot ID does not match");
    for (const actor of [declaration.compositor, declaration.app]) {
      if (fs.realpathSync(actor.cwd) !== actor.cwd) throw new Error("Actor cwd must be canonical");
      if (fs.realpathSync(actor.entryPoint) !== actor.entryPoint)
        throw new Error("Actor entry point must be canonical");
      inspectProcess(actor, { ...options, procRoot, readText });
    }
    for (const device of declaration.devices) inspectDevice(device, options);
    if (readText(bootPath, 64).trim() !== declaration.bootId)
      throw new Error("Boot changed during preparation");
  };
  validate();
  validate();
  let owned = null,
    staging = null,
    stagingIdentity = null,
    published = false;
  const unlinkOwnedStaging = () => {
    if (staging === null || stagingIdentity === null) return;
    const current = fs.lstatSync(staging, { bigint: true });
    if (
      !current.isFile() ||
      current.dev !== stagingIdentity.dev ||
      current.ino !== stagingIdentity.ino
    )
      throw new Error("Manifest staging file was replaced");
    fs.unlinkSync(staging);
    staging = null;
  };
  const write = options.write ?? ((fd, bytes) => fs.writeFileSync(fd, bytes));
  const publish = options.publish ?? fs.linkSync;
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
    owned = fs.lstatSync(directory, { bigint: true });
    if (
      !owned.isDirectory() ||
      owned.isSymbolicLink() ||
      Number(owned.uid) !== uid ||
      Number(owned.mode & 0o777n) !== 0o700
    )
      throw new Error("Fixture directory is not private and owned");
    const armedAtMonoNs = now();
    if (typeof armedAtMonoNs !== "bigint" || armedAtMonoNs < 0n)
      throw new Error("Invalid monotonic timestamp");
    const manifest = { ...declaration, armedAtMonoNs: String(armedAtMonoNs) };
    staging = path.join(directory, `.manifest-${randomUUID()}.tmp`);
    const fd = fs.openSync(
      staging,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      0o600,
    );
    try {
      const stat = fs.fstatSync(fd, { bigint: true });
      stagingIdentity = stat;
      if (!stat.isFile() || Number(stat.uid) !== uid || Number(stat.mode & 0o777n) !== 0o600)
        throw new Error("Manifest file is not private and owned");
      write(fd, JSON.stringify(manifest) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    validate();
    const elapsed = now() - armedAtMonoNs;
    if (elapsed < 0n || elapsed >= 90_000_000_000n)
      throw new Error("Fixture deadline expired or clock changed before publication");
    const current = fs.lstatSync(directory, { bigint: true });
    if (current.dev !== owned.dev || current.ino !== owned.ino)
      throw new Error("Fixture directory was replaced");
    const staged = fs.lstatSync(staging, { bigint: true });
    if (
      !staged.isFile() ||
      staged.dev !== stagingIdentity.dev ||
      staged.ino !== stagingIdentity.ino
    )
      throw new Error("Manifest staging file was replaced");
    publish(staging, manifestPath);
    published = true;
    unlinkOwnedStaging();
    return { manifestPath, manifest, deadlineMonoNs: String(armedAtMonoNs + 90_000_000_000n) };
  } catch (error) {
    if (owned !== null) {
      try {
        const current = fs.lstatSync(directory, { bigint: true });
        if (current.dev === owned.dev && current.ino === owned.ino) {
          unlinkOwnedStaging();
          if (!published) fs.rmdirSync(directory);
        }
      } catch {
        /* Preserve unknown/replaced/nonempty directories and the original failure. */
      }
    }
    throw error;
  }
}

export function main(args = process.argv.slice(2)) {
  if (args.length !== 4 || args[0] !== "--manifest" || args[2] !== "--spec")
    throw new Error(
      "Usage: prepare-input-fixture.mjs --manifest /tmp/moire-input-fixture-<UUID>/manifest.json --spec <declaration.json>",
    );
  const spec = JSON.parse(readBoundedMetadata(args[3], 16 * 1024));
  const result = armInputFixture(args[1], spec);
  console.log(JSON.stringify(result));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
