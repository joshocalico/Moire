import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readProcessEntryPoint } from "./input-fixture-process-identity.mjs";

/** Disabled-by-default, finite diagnostics for a single disposable Screenshot fixture. */
export const INPUT_FIXTURE_DURATION_MS = 90_000;
export const INPUT_FIXTURE_PRODUCTION_LIMIT = 1024;
export const INPUT_FIXTURE_APP_LIMIT = 512;
export const INPUT_FIXTURE_VALUE = "/tmp/c36-trace.png";
export type InputFixtureRole = "compositor" | "app";
export type InputFixtureDevice = {
  path: string;
  rdev: string;
  sysfs: string;
  kind: "keyboard" | "pointer";
};
export type InputFixtureProcess = {
  pid: number;
  uid: number;
  startTicks: string;
  cwd: string;
  entryPoint: string;
};
export type InputFixtureManifest = {
  version: 2;
  runId: string;
  bootId: string;
  armedAtMonoNs: string;
  scenario: "keys" | "pointer";
  compositor: InputFixtureProcess;
  app: InputFixtureProcess;
  appId: "org.moire.Screenshot";
  devices: readonly InputFixtureDevice[];
};
export type InputFixtureFocus = { peerPid: number | null; appId: string | null };
export type InputFixtureModifiers = { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean };
export type InputFixtureErrorCode = "EIO" | "EBADF" | "ENODEV" | "EOF" | "OTHER";
type FixtureObservedDevice = { path: string; rdev: string; fd: number };
export type InputFixtureObservation =
  | {
      layer: "keyboard-read";
      device: FixtureObservedDevice;
      bytes: number;
      pendingBytes: number;
      completeRecords: number;
      trailingBytes: number;
      keyEdges: readonly { code: number; value: number }[];
      syncRecords: number;
      droppedSyncRecords: number;
      otherRecords: number;
    }
  | {
      layer: "keyboard-read-error";
      device: FixtureObservedDevice;
      phase: "read" | "frame" | "dispatch";
      errorCode: InputFixtureErrorCode;
      bytes: number;
      pendingBytes: number;
      unprocessedBytes: number;
    }
  | ({ layer: "keyboard-reopen"; device: FixtureObservedDevice } & (
      | { phase: "attempt" | "success"; errorCode: null }
      | { phase: "failure"; errorCode: InputFixtureErrorCode }
    ))
  | {
      layer: "raw-keyboard" | "raw-pointer";
      device: { path: string; rdev: string; fd: number };
      type: number;
      code: number;
      value: number;
      timeMs: number;
    }
  | {
      layer: "keyboard-filter";
      device: { path: string; rdev: string; fd: number };
      code: number;
      value: number;
      timeMs: number;
      accepted: boolean;
    }
  | {
      layer: "key-route";
      phase: "translated" | "shell" | "alt-tab" | "drag" | "popup" | "client" | "no-focus";
      code: number;
      value: number;
      timeMs: number;
      clientId: number | null;
      surfaceId: number | null;
      modifiers: InputFixtureModifiers;
    }
  | {
      layer: "pointer-route";
      phase: "translated" | "shell" | "ssd" | "grab" | "client" | "no-focus" | "popup";
      event: "motion" | "absolute" | "button" | "axis";
      x: number;
      y: number;
      localX: number | null;
      localY: number | null;
      code: number | null;
      value: number | null;
      timeMs: number;
      clientId: number | null;
      surfaceId: number | null;
    }
  | {
      layer: "client-key";
      type: "down" | "up" | "repeat";
      code: number;
      timeMs: number;
      modifiers: InputFixtureModifiers;
    }
  | {
      layer: "client-pointer";
      type: "move" | "down" | "up" | "wheel";
      x: number;
      y: number;
      timeMs: number;
      button: string | null;
      modifiers: InputFixtureModifiers;
    }
  | {
      layer: "client-focus";
      device: "keyboard" | "pointer";
      type: "enter" | "leave";
      surfaceId: number;
    }
  | { layer: "app-focus"; control: "save-path" | "canvas"; focused: boolean }
  | {
      layer: "app-gesture";
      phase: "down" | "move" | "up" | "commit" | "reject";
      x: number;
      y: number;
      width: number;
      height: number;
      imageWidth: number;
      imageHeight: number;
    };
export type InputFixtureEndReason =
  | "deadline"
  | "identity"
  | "focus"
  | "unexpected-input"
  | "unexpected-value"
  | "overflow"
  | "io-error"
  | "closed";
export type InputFixtureTrace = {
  /** Scope validation occurs before event fields reach a sink. Returns diagnostic ordinal only. */
  write(event: InputFixtureObservation, sourceSequence?: number | null): number | null;
  /** Does not hash the default or any unrelated value; allows only an ordered fixture subsequence. */
  value(action: "change" | "submit" | "save", value: string): void;
  active(): boolean;
  stop(reason: InputFixtureEndReason): void;
  /** Diagnostics only: never add fields to, clone, or change the forwarded production event. */
  link(event: object, sourceSequence: number | null): void;
  sourceOf(event: object): number | null;
};

type FixtureLayer = InputFixtureObservation["layer"] | "app-value";
export type InputFixtureRecord =
  | {
      stage: "start";
      runId: string;
      bootId: string;
      role: InputFixtureRole;
      pid: number;
      startTicks: string;
      scenario: "keys" | "pointer";
      durationMs: number;
      productionLimit: number;
      appLimit: number;
    }
  | {
      stage: "event";
      sequence: number;
      monoNs: string;
      elapsedMs: number;
      sourceSequence: number | null;
      event: InputFixtureObservation;
    }
  | {
      stage: "value";
      sequence: number;
      monoNs: string;
      elapsedMs: number;
      layer: "app-value";
      action: "change" | "submit" | "save";
      length: number;
      sha256: string;
      expected: boolean;
    }
  | { stage: "overflow"; layer: FixtureLayer; limit: number; monoNs: string }
  | {
      stage: "end";
      reason: InputFixtureEndReason;
      monoNs: string;
      counts: Partial<Record<FixtureLayer, number>>;
      omitted: Partial<Record<FixtureLayer, number>>;
    };

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const decimalPattern = /^(0|[1-9]\d*)$/;
const fixtureKeys = new Set([
  4, 7, 12, 14, 18, 19, 20, 25, 28, 29, 30, 31, 34, 42, 46, 49, 50, 52, 53, 54, 97, 102, 105, 106,
  107, 111,
]);
const appLayers = new Set<FixtureLayer>([
  "client-key",
  "client-pointer",
  "client-focus",
  "app-focus",
  "app-gesture",
  "app-value",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isProcess(value: unknown, suffix: string): value is InputFixtureProcess {
  return (
    isObject(value) &&
    Object.keys(value).length === 5 &&
    typeof value.pid === "number" &&
    Number.isSafeInteger(value.pid) &&
    value.pid > 0 &&
    typeof value.uid === "number" &&
    Number.isSafeInteger(value.uid) &&
    value.uid >= 0 &&
    typeof value.startTicks === "string" &&
    decimalPattern.test(value.startTicks) &&
    typeof value.cwd === "string" &&
    value.cwd.length <= 4096 &&
    !/[\0\r\n]/.test(value.cwd) &&
    path.isAbsolute(value.cwd) &&
    path.normalize(value.cwd) === value.cwd &&
    typeof value.entryPoint === "string" &&
    value.entryPoint.length <= 4096 &&
    !/[\0\r\n]/.test(value.entryPoint) &&
    path.isAbsolute(value.entryPoint) &&
    path.normalize(value.entryPoint) === value.entryPoint &&
    value.entryPoint.endsWith(suffix)
  );
}
function isDevice(value: unknown): value is InputFixtureDevice {
  return (
    isObject(value) &&
    typeof value.path === "string" &&
    /^\/dev\/input\/event\d+$/.test(value.path) &&
    typeof value.rdev === "string" &&
    decimalPattern.test(value.rdev) &&
    typeof value.sysfs === "string" &&
    !value.sysfs.includes("\0") &&
    value.sysfs.startsWith("/sys/devices/") &&
    path.normalize(value.sysfs) === value.sysfs &&
    (value.kind === "keyboard" || value.kind === "pointer")
  );
}
export function parseInputFixtureManifest(value: unknown): InputFixtureManifest {
  if (
    !isObject(value) ||
    value.version !== 2 ||
    typeof value.runId !== "string" ||
    !uuidPattern.test(value.runId) ||
    typeof value.bootId !== "string" ||
    !uuidPattern.test(value.bootId) ||
    typeof value.armedAtMonoNs !== "string" ||
    !decimalPattern.test(value.armedAtMonoNs) ||
    (value.scenario !== "keys" && value.scenario !== "pointer") ||
    value.appId !== "org.moire.Screenshot" ||
    !isProcess(value.compositor, "/apps/system/compositor/src/main.ts") ||
    !isProcess(value.app, "/apps/bundled/screenshot/src/main.tsx") ||
    value.compositor.entryPoint.slice(0, -"/apps/system/compositor/src/main.ts".length) !==
      value.app.entryPoint.slice(0, -"/apps/bundled/screenshot/src/main.tsx".length) ||
    value.compositor.uid !== value.app.uid ||
    value.compositor.pid === value.app.pid ||
    !Array.isArray(value.devices) ||
    value.devices.length < 1 ||
    value.devices.length > 16 ||
    !value.devices.every(isDevice)
  )
    throw new Error("Invalid input fixture manifest");
  const devices = value.devices;
  if (
    new Set(devices.map((device) => device.path)).size !== devices.length ||
    new Set(devices.map((device) => device.rdev)).size !== devices.length ||
    !devices.some((device) => device.kind === "pointer") ||
    (value.scenario === "keys" && !devices.some((device) => device.kind === "keyboard"))
  )
    throw new Error("Invalid input fixture devices");
  return {
    version: 2,
    runId: value.runId,
    bootId: value.bootId,
    armedAtMonoNs: value.armedAtMonoNs,
    scenario: value.scenario,
    compositor: value.compositor,
    app: value.app,
    appId: value.appId,
    devices,
  };
}

function permittedKey(manifest: InputFixtureManifest, code: number, value: number): boolean {
  return manifest.scenario === "keys" && fixtureKeys.has(code) && [0, 1, 2].includes(value);
}
function boundedInteger(value: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= max;
}
function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}
function fixtureKeyboardDevice(
  manifest: InputFixtureManifest,
  device: FixtureObservedDevice,
): boolean {
  // Reopen receipts describe the OLD descriptor. Runtime identity validates the
  // manifest/path/rdev, not liveness of a descriptor which was already closed.
  return (
    exactKeys(device, ["path", "rdev", "fd"]) &&
    boundedInteger(device.fd, Number.MAX_SAFE_INTEGER) &&
    manifest.devices.some(
      (declared) =>
        declared.kind === "keyboard" &&
        declared.path === device.path &&
        declared.rdev === device.rdev,
    )
  );
}
function fixtureErrorCode(code: InputFixtureErrorCode): boolean {
  return ["EIO", "EBADF", "ENODEV", "EOF", "OTHER"].includes(code);
}
function permittedEvent(
  manifest: InputFixtureManifest,
  role: InputFixtureRole,
  event: InputFixtureObservation,
): boolean {
  if (role === "app" ? !appLayers.has(event.layer) : appLayers.has(event.layer)) return false;
  switch (event.layer) {
    case "keyboard-read": {
      if (
        manifest.scenario !== "keys" ||
        !fixtureKeyboardDevice(manifest, event.device) ||
        !exactKeys(event, [
          "layer",
          "device",
          "bytes",
          "pendingBytes",
          "completeRecords",
          "trailingBytes",
          "keyEdges",
          "syncRecords",
          "droppedSyncRecords",
          "otherRecords",
        ]) ||
        !boundedInteger(event.bytes, 192) ||
        !boundedInteger(event.pendingBytes, 23) ||
        !boundedInteger(event.completeRecords, 8) ||
        !boundedInteger(event.trailingBytes, 23) ||
        !boundedInteger(event.syncRecords, 8) ||
        !boundedInteger(event.droppedSyncRecords, 8) ||
        !boundedInteger(event.otherRecords, 8) ||
        !Array.isArray(event.keyEdges) ||
        event.keyEdges.length > 8
      )
        return false;
      if (
        event.bytes + event.pendingBytes !== event.completeRecords * 24 + event.trailingBytes ||
        event.keyEdges.length + event.syncRecords + event.otherRecords !== event.completeRecords ||
        event.droppedSyncRecords > event.syncRecords
      )
        return false;
      // Reject the whole batch before output if ANY key is outside the fixture;
      // MSC/non-key records are only counts, never payload/scancode data.
      return event.keyEdges.every(
        (edge) =>
          exactKeys(edge, ["code", "value"]) && permittedKey(manifest, edge.code, edge.value),
      );
    }
    case "keyboard-read-error": {
      if (
        manifest.scenario !== "keys" ||
        !fixtureKeyboardDevice(manifest, event.device) ||
        !exactKeys(event, [
          "layer",
          "device",
          "phase",
          "errorCode",
          "bytes",
          "pendingBytes",
          "unprocessedBytes",
        ]) ||
        !fixtureErrorCode(event.errorCode) ||
        !boundedInteger(event.bytes, 192) ||
        !boundedInteger(event.pendingBytes, 23) ||
        !boundedInteger(event.unprocessedBytes, 215)
      )
        return false;
      if (event.phase === "read")
        return event.bytes === 0 && event.unprocessedBytes === event.pendingBytes;
      if (event.phase !== "frame" && event.phase !== "dispatch") return false;
      const total = event.bytes + event.pendingBytes;
      const consumedBytes = total - event.unprocessedBytes;
      return (
        event.bytes > 0 &&
        event.unprocessedBytes <= total &&
        consumedBytes % 24 === 0 &&
        (event.phase !== "dispatch" || consumedBytes >= 24)
      );
    }
    case "keyboard-reopen":
      return (
        manifest.scenario === "keys" &&
        fixtureKeyboardDevice(manifest, event.device) &&
        exactKeys(event, ["layer", "device", "phase", "errorCode"]) &&
        (event.phase === "failure"
          ? fixtureErrorCode(event.errorCode)
          : (event.phase === "attempt" || event.phase === "success") && event.errorCode === null)
      );

    case "raw-keyboard":
    case "raw-pointer": {
      const kind = event.layer === "raw-keyboard" ? "keyboard" : "pointer";
      if (
        !Number.isSafeInteger(event.device.fd) ||
        event.device.fd < 0 ||
        !manifest.devices.some(
          (device) =>
            device.path === event.device.path &&
            device.rdev === event.device.rdev &&
            device.kind === kind,
        )
      )
        return false;
      if (event.type === 0) return event.code === 0 || event.code === 3;
      if (kind === "keyboard")
        return event.type === 1 && permittedKey(manifest, event.code, event.value);
      return (
        (event.type === 1 && event.code === 272 && [0, 1].includes(event.value)) ||
        (event.type === 2 && [0, 1, 8, 11].includes(event.code)) ||
        (event.type === 3 && [0, 1].includes(event.code))
      );
    }
    case "keyboard-filter":
      return (
        permittedKey(manifest, event.code, event.value) &&
        manifest.devices.some(
          (device) =>
            device.kind === "keyboard" &&
            device.path === event.device.path &&
            device.rdev === event.device.rdev,
        )
      );
    case "key-route":
      return permittedKey(manifest, event.code, event.value);
    case "client-key":
      return permittedKey(
        manifest,
        event.code,
        event.type === "up" ? 0 : event.type === "repeat" ? 2 : 1,
      );
    case "client-pointer":
      return event.button === null || event.button === "left";
    case "pointer-route":
      return event.code === null || [0, 1, 8, 11, 272].includes(event.code);
    case "client-focus":
    case "app-focus":
    case "app-gesture":
      return true;
  }
}

/** Pure finite recorder. The caller supplies the live scope check before every observation. */
export function createInputFixtureRecorder(options: {
  manifest: InputFixtureManifest;
  role: InputFixtureRole;
  now: () => bigint;
  validate: () => InputFixtureEndReason | null;
  emit: (record: InputFixtureRecord) => void;
}): InputFixtureTrace {
  const { manifest, role, now, validate, emit } = options;
  const counts: Partial<Record<FixtureLayer, number>> = {},
    omitted: Partial<Record<FixtureLayer, number>> = {};
  const saturated = new Set<FixtureLayer>();
  const sources = new WeakMap<object, number>();
  const start = BigInt(manifest.armedAtMonoNs);
  let ended = false,
    sequence = 0,
    appCount = 0;
  const safeEmit = (record: InputFixtureRecord) => {
    try {
      emit(record);
    } catch {
      ended = true;
      if (record.stage !== "end") {
        try {
          emit({
            stage: "end",
            reason: "io-error",
            monoNs: now().toString(),
            counts: { ...counts },
            omitted: { ...omitted },
          });
        } catch {
          /* A failed sink cannot guarantee its final summary. */
        }
      }
    }
  };
  const stop = (reason: InputFixtureEndReason) => {
    if (ended) return;
    ended = true;
    try {
      safeEmit({
        stage: "end",
        reason,
        monoNs: now().toString(),
        counts: { ...counts },
        omitted: { ...omitted },
      });
    } catch {
      /* Diagnostics never interrupt input. */
    }
  };
  const active = () => {
    if (ended) return false;
    try {
      const time = now();
      if (time < start || time - start >= BigInt(INPUT_FIXTURE_DURATION_MS) * 1_000_000n) {
        stop("deadline");
        return false;
      }
      const reason = validate();
      if (reason !== null) {
        stop(reason);
        return false;
      }
      return true;
    } catch {
      stop("identity");
      return false;
    }
  };
  const admit = (layer: FixtureLayer) => {
    counts[layer] = Math.min(Number.MAX_SAFE_INTEGER, (counts[layer] ?? 0) + 1);
    const limit = role === "app" ? INPUT_FIXTURE_APP_LIMIT : INPUT_FIXTURE_PRODUCTION_LIMIT;
    const count = role === "app" ? ++appCount : (counts[layer] ?? 0);
    if (count <= limit) return true;
    omitted[layer] = Math.min(Number.MAX_SAFE_INTEGER, (omitted[layer] ?? 0) + 1);
    if (!saturated.has(layer)) {
      saturated.add(layer);
      safeEmit({ stage: "overflow", layer, limit, monoNs: now().toString() });
    }
    return false;
  };
  if (active())
    safeEmit({
      stage: "start",
      runId: manifest.runId,
      bootId: manifest.bootId,
      role,
      pid: manifest[role === "app" ? "app" : "compositor"].pid,
      startTicks: manifest[role === "app" ? "app" : "compositor"].startTicks,
      scenario: manifest.scenario,
      durationMs: INPUT_FIXTURE_DURATION_MS,
      productionLimit: INPUT_FIXTURE_PRODUCTION_LIMIT,
      appLimit: INPUT_FIXTURE_APP_LIMIT,
    });
  return {
    active,
    stop,
    write(event, sourceSequence = null) {
      if (!active()) return null;
      try {
        if (!permittedEvent(manifest, role, event)) {
          stop("unexpected-input");
          return null;
        }
        if (!admit(event.layer) || ended) return null;
        const time = now(),
          ordinal = ++sequence;
        safeEmit({
          stage: "event",
          sequence: ordinal,
          monoNs: time.toString(),
          elapsedMs: Number(time - start) / 1_000_000,
          sourceSequence,
          event,
        });
        return ended ? null : ordinal;
      } catch {
        stop("io-error");
        return null;
      }
    },
    value(action, value) {
      if (!active()) return;
      try {
        if (role !== "app" || manifest.scenario !== "keys") {
          stop("unexpected-value");
          return;
        }
        let offset = 0;
        for (const character of value) {
          const index = INPUT_FIXTURE_VALUE.indexOf(character, offset);
          if (index < 0) {
            stop("unexpected-value");
            return;
          }
          offset = index + 1;
        }
        if (!admit("app-value") || ended) return;
        const time = now();
        safeEmit({
          stage: "value",
          sequence: ++sequence,
          monoNs: time.toString(),
          elapsedMs: Number(time - start) / 1_000_000,
          layer: "app-value",
          action,
          length: value.length,
          sha256: createHash("sha256").update(value).digest("hex"),
          expected: value === INPUT_FIXTURE_VALUE,
        });
      } catch {
        stop("io-error");
      }
    },
    link(event, sourceSequence) {
      if (!ended && sourceSequence !== null) sources.set(event, sourceSequence);
    },
    sourceOf(event) {
      return ended ? null : (sources.get(event) ?? null);
    },
  };
}

function readMetadata(file: string, limit: number): string {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > limit || buffer.subarray(0, length).includes(0))
      throw new Error("Invalid bounded metadata");
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length));
  } finally {
    fs.closeSync(fd);
  }
}
function processMatches(expected: InputFixtureProcess): boolean {
  const base = `/proc/${expected.pid}`;
  const stat = () => {
    const text = readMetadata(`${base}/stat`, 8192),
      end = text.lastIndexOf(")");
    if (Number(text.slice(0, text.indexOf("(")).trim()) !== expected.pid || end < 0) return false;
    const fields = text
      .slice(end + 1)
      .trim()
      .split(/\s+/);
    return fields[19] === expected.startTicks && !["Z", "X", "x"].includes(fields[0] ?? "");
  };
  const uid = () => {
    const lines = readMetadata(`${base}/status`, 16384)
      .split("\n")
      .filter((line) => line.startsWith("Uid:"));
    return (
      lines.length === 1 &&
      /^Uid:\s+\d+\s+\d+\s+\d+\s+\d+\s*$/.test(lines[0] ?? "") &&
      lines[0]
        ?.slice(4)
        .trim()
        .split(/\s+/)
        .every((value) => Number(value) === expected.uid)
    );
  };
  return (
    fs.realpathSync(expected.cwd) === expected.cwd &&
    fs.realpathSync(expected.entryPoint) === expected.entryPoint &&
    stat() &&
    uid() &&
    fs.readlinkSync(`${base}/cwd`) === expected.cwd &&
    readProcessEntryPoint(expected.pid, expected.cwd) === expected.entryPoint &&
    stat() &&
    uid() &&
    fs.readlinkSync(`${base}/cwd`) === expected.cwd &&
    readProcessEntryPoint(expected.pid, expected.cwd) === expected.entryPoint
  );
}
function deviceMatches(expected: InputFixtureDevice): boolean {
  const stat = fs.lstatSync(expected.path, { bigint: true }),
    dev = stat.rdev;
  const major = ((dev >> 8n) & 0xfffn) | ((dev >> 32n) & 0xfffff000n);
  const minor = (dev & 0xffn) | ((dev >> 12n) & 0xffffff00n);
  return (
    stat.isCharacterDevice() &&
    dev.toString() === expected.rdev &&
    fs.realpathSync(`/sys/dev/char/${major}:${minor}`) === expected.sysfs
  );
}
const idleTrace: InputFixtureTrace = {
  active: () => false,
  write: () => null,
  value: () => {},
  stop: () => {},
  link: () => {},
  sourceOf: () => null,
};
const processTraces = new Map<InputFixtureRole, InputFixtureTrace>();

export function createInputFixtureTrace(
  role: "compositor",
  options: { focus: () => InputFixtureFocus },
): InputFixtureTrace;
export function createInputFixtureTrace(role: "app"): InputFixtureTrace;
export function createInputFixtureTrace(
  role: InputFixtureRole,
  options?: { focus: () => InputFixtureFocus },
): InputFixtureTrace {
  const cached = processTraces.get(role);
  if (cached) return cached;
  const file = process.env.MOIRE_INPUT_FIXTURE_TRACE;
  if (!file || process.platform !== "linux") return idleTrace;
  const match = /^\/tmp\/moire-input-fixture-([0-9a-f-]{36})\/manifest\.json$/.exec(file);
  if (!match || !uuidPattern.test(match[1] ?? "")) return idleTrace;
  let recorder: InputFixtureTrace | null = null,
    ended = false,
    fd: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const close = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
    process.removeListener("exit", onExit);
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* Diagnostic cleanup. */
      }
      fd = null;
    }
  };
  const finish = (reason: InputFixtureEndReason) => {
    if (ended) return;
    recorder?.stop(reason);
    ended = true;
    close();
  };
  const onExit = () => finish("closed");
  const ensure = () => {
    if (ended) return false;
    if (recorder !== null) {
      const valid = recorder.active();
      if (!valid) finish("closed");
      return valid;
    }
    try {
      if (!fs.existsSync(file)) return false;
      const directory = path.dirname(file),
        uid = process.getuid?.();
      const dirStat = fs.lstatSync(directory),
        fileStat = fs.lstatSync(file);
      if (
        uid === undefined ||
        !dirStat.isDirectory() ||
        dirStat.uid !== uid ||
        (dirStat.mode & 0o777) !== 0o700 ||
        !fileStat.isFile() ||
        fileStat.uid !== uid ||
        (fileStat.mode & 0o777) !== 0o600
      )
        throw new Error("Invalid fixture ownership");
      const parsed: unknown = JSON.parse(readMetadata(file, 16384));
      const manifest = parseInputFixtureManifest(parsed),
        expected = manifest[role === "app" ? "app" : "compositor"];
      // The preparer publishes by exclusive hard link, then removes its staging link.
      // Wait for that unlink so its ctime change cannot look like later tampering.
      if (fileStat.nlink !== 1) {
        if (process.hrtime.bigint() - BigInt(manifest.armedAtMonoNs) >= 90_000_000_000n)
          throw new Error("Fixture publication did not finish within its deadline");
        return false;
      }
      if (
        manifest.runId !== match[1] ||
        expected.pid !== process.pid ||
        expected.uid !== uid ||
        !processMatches(manifest.compositor) ||
        !processMatches(manifest.app) ||
        manifest.bootId !== readMetadata("/proc/sys/kernel/random/boot_id", 64).trim() ||
        !manifest.devices.every(deviceMatches)
      )
        throw new Error("Invalid fixture identity");
      const validate = (): InputFixtureEndReason | null => {
        try {
          const current = fs.lstatSync(file),
            currentDir = fs.lstatSync(directory);
          if (
            current.ino !== fileStat.ino ||
            current.dev !== fileStat.dev ||
            current.mtimeMs !== fileStat.mtimeMs ||
            current.ctimeMs !== fileStat.ctimeMs ||
            current.size !== fileStat.size ||
            current.mode !== fileStat.mode ||
            current.uid !== uid ||
            current.nlink !== 1 ||
            currentDir.ino !== dirStat.ino ||
            currentDir.dev !== dirStat.dev ||
            currentDir.mode !== dirStat.mode ||
            !processMatches(manifest.compositor) ||
            !processMatches(manifest.app) ||
            !manifest.devices.every(deviceMatches)
          )
            return "identity";
          if (role === "compositor") {
            const focus = options?.focus();
            if (focus?.peerPid !== manifest.app.pid || focus.appId !== manifest.appId)
              return "focus";
          }
          return null;
        } catch {
          return "identity";
        }
      };
      if (validate() !== null) throw new Error("Invalid fixture scope");
      fd = fs.openSync(
        path.join(directory, `${role}.jsonl`),
        fs.constants.O_WRONLY |
          fs.constants.O_CREAT |
          fs.constants.O_EXCL |
          fs.constants.O_NOFOLLOW,
        0o600,
      );
      recorder = createInputFixtureRecorder({
        manifest,
        role,
        now: () => process.hrtime.bigint(),
        validate,
        emit(record) {
          if (fd === null) throw new Error("Closed diagnostic sink");
          const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
          let offset = 0;
          while (offset < bytes.length) {
            const count = fs.writeSync(fd, bytes, offset, bytes.length - offset);
            if (count <= 0) throw new Error("Diagnostic write failed");
            offset += count;
          }
        },
      });
      return recorder.active();
    } catch {
      finish("identity");
      try {
        process.stderr.write("[input-fixture] disabled: fixture scope validation failed\n");
      } catch {
        /* Input must continue. */
      }
      return false;
    }
  };
  const trace: InputFixtureTrace = {
    active: ensure,
    write(event, sourceSequence) {
      if (recorder === null && !ensure()) return null;
      return recorder?.write(event, sourceSequence) ?? null;
    },
    value(action, value) {
      if (recorder !== null || ensure()) recorder?.value(action, value);
    },
    stop: finish,
    link(event, sourceSequence) {
      recorder?.link(event, sourceSequence);
    },
    sourceOf(event) {
      return recorder?.sourceOf(event) ?? null;
    },
  };
  processTraces.set(role, trace);
  process.once("exit", onExit);
  timer = setInterval(ensure, 50);
  timer.unref();
  return trace;
}
