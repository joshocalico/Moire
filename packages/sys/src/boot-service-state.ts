import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readBootAttemptLedger } from "./boot-attempt-ledger";
import type { BootAttemptLedger } from "./boot-attempt-ledger";

export type BootServiceIdentity = { bootId: string; invocationId: string; unit: string };
export type BootDirectoryIdentity = { dev: string; ino: string };
export type BootConsoleRecord = { ttyPath: string; vt: number; rdev: string; originalMode: 0 };
export type BootSkipReason = "console-requested" | "display-unavailable" | "before-graphics";
export type BootServiceLease = BootServiceIdentity & {
  version: 1;
  cgroupPath: string;
  cgroupIdentity: BootDirectoryIdentity;
} & (
    | { phase: "armed" | "graphics-intent"; console: BootConsoleRecord }
    | { phase: "skipped"; reason: BootSkipReason }
  );
export type BootServiceRelease = BootServiceIdentity & {
  version: 1;
  cgroupPath: string;
  cgroupIdentity: BootDirectoryIdentity;
} & ({ kind: "released"; ttyPath: string; mode: 0 } | { kind: "skipped"; reason: BootSkipReason });
export type BootServicePaths = { cgroupMount: string; procRoot: string; selfPid: number };
export const bootServicePaths: BootServicePaths = {
  cgroupMount: "/sys/fs/cgroup",
  procRoot: "/proc",
  selfPid: process.pid,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Invalid boot service record");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid boot service string");
  return value;
}
export function directoryIdentity(directory: string): BootDirectoryIdentity {
  const stat = fs.lstatSync(directory, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid cgroup directory");
  return { dev: String(stat.dev), ino: String(stat.ino) };
}
export function sameDirectory(a: BootDirectoryIdentity, b: BootDirectoryIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}
export function validateCgroupPath(value: string): string {
  if (
    !value.startsWith("/") ||
    value === "/" ||
    value.length > 2048 ||
    value.includes("\0") ||
    value.includes("\\") ||
    value
      .split("/")
      .slice(1)
      .some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Ambiguous service cgroup path");
  return value;
}
export function cgroupDirectory(cgroupPath: string, paths = bootServicePaths): string {
  validateCgroupPath(cgroupPath);
  const mount = fs.realpathSync(paths.cgroupMount);
  if (
    paths.cgroupMount === bootServicePaths.cgroupMount &&
    Number(fs.statfsSync(mount).type) !== 0x63677270
  )
    throw new Error("Managed boot requires the unified cgroup filesystem");
  const directory = path.join(mount, cgroupPath.slice(1));
  if (fs.realpathSync(directory) !== directory) throw new Error("Cgroup path traverses a symlink");
  return directory;
}
export function currentCgroup(paths = bootServicePaths): string {
  const lines = readBoundedBootFile(
    path.join(paths.procRoot, String(paths.selfPid), "cgroup"),
    4096,
  )
    .trim()
    .split("\n");
  if (lines.length !== 1 || !lines[0]?.startsWith("0::"))
    throw new Error("Unified cgroup membership required");
  const membership = lines[0].slice(3);
  return membership === "/" ? membership : validateCgroupPath(membership);
}
export function currentBootServiceIdentity(
  environment: NodeJS.ProcessEnv = process.env,
  paths = bootServicePaths,
): Omit<BootServiceIdentity, "invocationId"> {
  const bootId = readBoundedBootFile(
    path.join(paths.procRoot, "sys/kernel/random/boot_id"),
    64,
  ).trim();
  const unit = environment.MOIRE_BOOT_UNIT ?? "moire-boot.service";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bootId) ||
    !/^[a-zA-Z0-9_.@-]+\.service$/.test(unit)
  )
    throw new Error("Invalid current boot/service identity");
  return { bootId, unit };
}
export function serviceIdentity(
  environment: NodeJS.ProcessEnv = process.env,
  paths = bootServicePaths,
): BootServiceIdentity {
  const bootId = readBoundedBootFile(
    path.join(paths.procRoot, "sys/kernel/random/boot_id"),
    64,
  ).trim();
  const invocationId = environment.INVOCATION_ID ?? "";
  const unit = environment.MOIRE_BOOT_UNIT ?? "moire-boot.service";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bootId) ||
    !/^[0-9a-f]{32}$/.test(invocationId) ||
    !/^[a-zA-Z0-9_.@-]+\.service$/.test(unit)
  )
    throw new Error(
      "Managed boot requires a current boot, systemd invocation and service identity",
    );
  return { bootId, invocationId, unit };
}
export function sameInvocation(a: BootServiceIdentity, b: BootServiceIdentity): boolean {
  return a.bootId === b.bootId && a.invocationId === b.invocationId && a.unit === b.unit;
}
/** One matching rule for restart admission and historical desktop readiness. */
export function releaseMatchesLease(lease: BootServiceLease, release: BootServiceRelease): boolean {
  if (
    !sameInvocation(lease, release) ||
    lease.cgroupPath !== release.cgroupPath ||
    !sameDirectory(lease.cgroupIdentity, release.cgroupIdentity)
  )
    return false;
  return lease.phase === "graphics-intent"
    ? release.kind === "released" && release.ttyPath === lease.console.ttyPath
    : release.kind === "skipped" &&
        release.reason === (lease.phase === "skipped" ? lease.reason : "before-graphics");
}
function parseBase(value: unknown): BootServiceIdentity & {
  version: 1;
  cgroupPath: string;
  cgroupIdentity: BootDirectoryIdentity;
} {
  const data = record(value);
  const identity = record(data.cgroupIdentity);
  const bootId = text(data.bootId),
    invocationId = text(data.invocationId),
    unit = text(data.unit);
  if (
    data.version !== 1 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(bootId) ||
    !/^[0-9a-f]{32}$/.test(invocationId) ||
    !/^[a-zA-Z0-9_.@-]+\.service$/.test(unit) ||
    !/^\d+$/.test(text(identity.dev)) ||
    !/^\d+$/.test(text(identity.ino))
  )
    throw new Error("Invalid boot service identity");
  const cgroupPath = validateCgroupPath(text(data.cgroupPath));
  if (path.posix.basename(cgroupPath) !== unit)
    throw new Error("Recorded service root does not match unit");
  return {
    version: 1,
    bootId,
    invocationId,
    unit,
    cgroupPath,
    cgroupIdentity: { dev: text(identity.dev), ino: text(identity.ino) },
  };
}
function skipReason(value: unknown): BootSkipReason {
  if (
    value !== "console-requested" &&
    value !== "display-unavailable" &&
    value !== "before-graphics"
  )
    throw new Error("Invalid boot skip reason");
  return value;
}
function consoleRecord(value: unknown): BootConsoleRecord {
  const data = record(value),
    ttyPath = text(data.ttyPath);
  const match = /^\/dev\/tty([1-9][0-9]*)$/.exec(ttyPath);
  if (
    !match ||
    data.vt !== Number(match[1]) ||
    !Number.isSafeInteger(data.vt) ||
    data.originalMode !== 0 ||
    !/^\d+$/.test(text(data.rdev))
  )
    throw new Error("Invalid recorded boot console");
  return { ttyPath, vt: Number(match[1]), rdev: text(data.rdev), originalMode: 0 };
}
export function readBoundedBootFile(file: string, maxBytes: number): string {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = fs.readSync(fd, bytes, length, bytes.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > maxBytes) throw new Error("Boot observation input limit exceeded");
    return bytes.subarray(0, length).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}
export function validateBootStateDirectory(stateDirectory: string): void {
  if (!path.isAbsolute(stateDirectory)) throw new Error("Absolute boot state directory required");
  const stat = fs.lstatSync(stateDirectory);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o022) !== 0
  )
    throw new Error(
      "Boot state directory must be owned by this service user and not writable by other users",
    );
}
export function readBootStateRecord(
  stateDirectory: string,
  name: "lease" | "release" | "attempt",
): unknown {
  validateBootStateDirectory(stateDirectory);
  const file = path.join(stateDirectory, `${name}.json`);
  const stat = fs.lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size > 8192 ||
    stat.uid !== process.getuid?.() ||
    (stat.mode & 0o022) !== 0
  )
    throw new Error("Invalid boot state file");
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (
      !opened.isFile() ||
      opened.ino !== stat.ino ||
      opened.dev !== stat.dev ||
      opened.size > 8192 ||
      opened.uid !== stat.uid ||
      (opened.mode & 0o022) !== 0
    )
      throw new Error("Boot state changed during read");
    const bytes = Buffer.alloc(8193);
    const length = fs.readSync(fd, bytes, 0, bytes.length, null);
    if (length > 8192) throw new Error("Boot state input limit exceeded");
    return JSON.parse(bytes.subarray(0, length).toString("utf8"));
  } finally {
    fs.closeSync(fd);
  }
}
export function readBootServiceLease(stateDirectory: string): BootServiceLease {
  validateBootStateDirectory(stateDirectory);
  const data = record(readBootStateRecord(stateDirectory, "lease")),
    base = parseBase(data);
  if (data.phase === "skipped")
    return { ...base, phase: "skipped", reason: skipReason(data.reason) };
  if (data.phase !== "armed" && data.phase !== "graphics-intent")
    throw new Error("Invalid boot lease phase");
  return { ...base, phase: data.phase, console: consoleRecord(data.console) };
}
export function readBootServiceRelease(stateDirectory: string): BootServiceRelease {
  validateBootStateDirectory(stateDirectory);
  const data = record(readBootStateRecord(stateDirectory, "release")),
    base = parseBase(data);
  if (data.kind === "skipped") return { ...base, kind: "skipped", reason: skipReason(data.reason) };
  if (
    data.kind !== "released" ||
    data.mode !== 0 ||
    !/^\/dev\/tty[1-9][0-9]*$/.test(text(data.ttyPath))
  )
    throw new Error("Invalid boot release record");
  return { ...base, kind: "released", mode: 0, ttyPath: text(data.ttyPath) };
}
export function writeBootServiceRecord(
  stateDirectory: string,
  name: "lease",
  value: BootServiceLease,
): void;
export function writeBootServiceRecord(
  stateDirectory: string,
  name: "release",
  value: BootServiceRelease,
): void;
export function writeBootServiceRecord(
  stateDirectory: string,
  name: "attempt",
  value: BootAttemptLedger,
): void;
export function writeBootServiceRecord(
  stateDirectory: string,
  name: "lease" | "release" | "attempt",
  value: BootServiceLease | BootServiceRelease | BootAttemptLedger,
): void {
  if (!path.isAbsolute(stateDirectory)) throw new Error("Absolute boot state directory required");
  fs.mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  validateBootStateDirectory(stateDirectory);
  const temporary = path.join(stateDirectory, `.${name}-${randomUUID()}`);
  const fd = fs.openSync(
    temporary,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
    0o600,
  );
  try {
    try {
      fs.writeFileSync(fd, JSON.stringify(value) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, path.join(stateDirectory, `${name}.json`));
    const directory = fs.openSync(stateDirectory, fs.constants.O_RDONLY);
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}
/** Must precede even an explicit no-graphics skip for every invocation. */
export function beginBootService(
  stateDirectory: string,
  identity: BootServiceIdentity,
  paths = bootServicePaths,
) {
  const cgroupPath = currentCgroup(paths);
  if (path.posix.basename(cgroupPath) !== identity.unit)
    throw new Error("Guardian must be in its exact systemd service root");
  const cgroupIdentity = directoryIdentity(cgroupDirectory(cgroupPath, paths));
  if (!path.isAbsolute(stateDirectory)) throw new Error("Absolute boot state directory required");
  validateBootStateDirectory(stateDirectory);
  let previous: BootServiceLease | null = null;
  try {
    previous = readBootServiceLease(stateDirectory);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  if (previous?.bootId === identity.bootId && previous.phase === "graphics-intent") {
    let acknowledged = false;
    try {
      acknowledged = releaseMatchesLease(previous, readBootServiceRelease(stateDirectory));
    } catch {} // Missing/malformed acknowledgement never permits intent replacement.
    if (!acknowledged)
      throw new Error(
        "Prior boot graphics lease has no successful cleanup; refusing to replace its recovery evidence",
      );
  }
  const attempt = readBootAttemptLedger(stateDirectory, identity);
  if (attempt.state !== "attempted" || attempt.invocationId !== identity.invocationId)
    throw new Error("Guardian requires the matching recorded boot attempt");
  try {
    fs.unlinkSync(path.join(stateDirectory, "release.json"));
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }
  const base = { ...identity, version: 1 as const, cgroupPath, cgroupIdentity };
  writeBootServiceRecord(stateDirectory, "lease", {
    ...base,
    phase: "skipped",
    reason: "before-graphics",
  });
  return base;
}
