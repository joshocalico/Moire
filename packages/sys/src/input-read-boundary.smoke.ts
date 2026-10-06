/** Real reader with injected owned IO; no device, epoll or native transport is opened. */
import assert from "node:assert/strict";
import { EvdevKeyboard, type EvdevKeyEvent } from "./evdev";
import type { KeyboardDeviceIo } from "./keyboard-grab";
import {
  createInputFixtureRecorder,
  type InputFixtureManifest,
  type InputFixtureObservation,
  type InputFixtureRecord,
  type InputFixtureTrace,
} from "./input-fixture-trace";

const manifest: InputFixtureManifest = {
  version: 2,
  runId: "11111111-1111-4111-8111-111111111111",
  bootId: "22222222-2222-4222-8222-222222222222",
  armedAtMonoNs: "0",
  scenario: "keys",
  appId: "org.moire.Screenshot",
  compositor: {
    pid: 1,
    uid: 1000,
    startTicks: "1",
    cwd: "/home/moire",
    entryPoint: "/fixture/apps/system/compositor/src/main.ts",
  },
  app: {
    pid: 2,
    uid: 1000,
    startTicks: "2",
    cwd: "/fixture/apps/bundled/screenshot",
    entryPoint: "/fixture/apps/bundled/screenshot/src/main.tsx",
  },
  devices: [
    {
      path: "/dev/input/event3",
      rdev: "3395",
      sysfs: "/sys/devices/fixture/event3",
      kind: "keyboard",
    },
    {
      path: "/dev/input/event1",
      rdev: "3393",
      sysfs: "/sys/devices/fixture/event1",
      kind: "pointer",
    },
  ],
};
type Mode = "off" | "on" | "inactive" | "throw";
type Action = Buffer | Error | "EOF";
type RunResult = {
  records: InputFixtureRecord[];
  delivered: EvdevKeyEvent[];
  calls: string[];
  reads: number;
  failures: number;
  sinkStops: number;
  remaining: number;
  callbacks: number;
};
function event(type: number, code: number, value: number) {
  const buffer = Buffer.alloc(24);
  buffer.writeBigUInt64LE(1n);
  buffer.writeUInt16LE(type, 16);
  buffer.writeUInt16LE(code, 18);
  buffer.writeInt32LE(value, 20);
  return buffer;
}
const ioError = (code: string) =>
  Object.assign(new Error("injected arbitrary message must not enter trace"), { code });
function run(
  mode: Mode,
  actions: Action[],
  options: {
    exclusive?: boolean;
    listenerThrows?: boolean;
    listenerErrorCode?: string;
    reopenFails?: boolean;
    sameFd?: boolean;
    changedIdentity?: boolean;
  } = {},
): RunResult {
  const records: InputFixtureRecord[] = [],
    delivered: EvdevKeyEvent[] = [];
  const calls: string[] = [],
    callbacks = new Map<number, () => void>();
  let opened = 0,
    reads = 0,
    failures = 0,
    sinkStops = 0;
  const io: KeyboardDeviceIo = {
    open() {
      calls.push("open");
      if (opened++ && options.reopenFails) throw ioError("ENODEV");
      return options.sameFd ? 47 : 46 + opened;
    },
    close(fd) {
      calls.push(`close:${fd}`);
    },
    identity(fd) {
      calls.push(`identity:${fd}`);
      return options.changedIdentity && opened > 1 ? "3396" : "3395";
    },
    keyBits() {
      const bits = Buffer.alloc(96);
      for (const code of [1, 28, 29, 30, 46]) bits[Math.floor(code / 8)]! |= 1 << (code % 8);
      return bits;
    },
    eventBits: () => Buffer.alloc(8),
    heldKeyBits: () => Buffer.alloc(96),
    grab(fd) {
      calls.push(`grab:${fd}`);
    },
    read(fd, target) {
      calls.push(`read:${fd}`);
      reads++;
      const next = actions.shift();
      if (!next) throw ioError("EAGAIN");
      if (next instanceof Error) throw next;
      if (next === "EOF") return 0;
      assert(next.length <= target.length);
      next.copy(target);
      return next.length;
    },
  };
  const reader = new EvdevKeyboard(
    {
      add(fd, callback) {
        calls.push(`add:${fd}`);
        callbacks.set(fd, callback);
      },
      remove(fd) {
        calls.push(`remove:${fd}`);
        callbacks.delete(fd);
      },
    },
    io,
  );
  const trace = createInputFixtureRecorder({
    manifest,
    role: "compositor",
    now: () => 1n,
    validate: () => null,
    emit: (record) => records.push(record),
  });
  if (mode === "on") reader.setInputFixtureTrace(trace);
  if (mode === "inactive") reader.setInputFixtureTrace({ ...trace, active: () => false });
  if (mode === "throw") {
    const broken: InputFixtureTrace = {
      ...trace,
      write() {
        throw new Error("broken observer");
      },
      stop() {
        sinkStops++;
      },
    };
    reader.setInputFixtureTrace(broken);
  }
  reader.on("key", (key: EvdevKeyEvent) => {
    delivered.push(key);
    if (options.listenerThrows && delivered.length === 1)
      throw ioError(options.listenerErrorCode ?? "EIO");
  });
  reader.on("exclusiveFailure", () => {
    failures++;
  });
  reader.start(["/dev/input/event3"], { exclusive: options.exclusive });
  let iterations = 0;
  while (actions.length && callbacks.size) {
    assert(iterations++ < 1100);
    callbacks.values().next().value!();
  }
  reader.stop();
  if (mode === "on") trace.stop("closed");
  return {
    records,
    delivered,
    calls,
    reads,
    failures,
    sinkStops,
    remaining: actions.length,
    callbacks: callbacks.size,
  };
}
function observations(records: InputFixtureRecord[]) {
  return records.flatMap((record) => (record.stage === "event" ? [record.event] : []));
}
function ofLayer<L extends InputFixtureObservation["layer"]>(
  records: InputFixtureRecord[],
  layer: L,
) {
  return observations(records).filter(
    (event): event is Extract<InputFixtureObservation, { layer: L }> => event.layer === layer,
  );
}
const modes: Mode[] = ["off", "on", "inactive", "throw"];
let cases = 0;
function invariant(actions: () => Action[], options: Parameters<typeof run>[2] = {}) {
  const baseline = run("off", actions(), options);
  const observed = run("on", actions(), options);
  for (const mode of modes.slice(1)) {
    const current: RunResult = mode === "on" ? observed : run(mode, actions(), options);
    assert.deepEqual(
      current.delivered,
      baseline.delivered,
      `${mode}: exact original key ordering/objects fields`,
    );
    assert.deepEqual(
      current.calls,
      baseline.calls,
      `${mode}: exact original read/close/open/register operations`,
    );
    assert.equal(current.failures, baseline.failures);
    assert.equal(current.remaining, baseline.remaining);
    assert.equal(current.callbacks, 0);
    if (mode === "throw") {
      const wrote = observed.records.some(
        (record) =>
          record.stage === "event" ||
          (record.stage === "end" && record.reason === "unexpected-input"),
      );
      assert.equal(current.sinkStops, wrote ? 1 : 0);
    }
    if (mode === "inactive") assert.equal(observations(current.records).length, 0);
  }
  cases++;
  return observed;
}

const codes = [53, 20, 50, 25, 53, 46, 4, 7, 12, 20, 19, 30, 46, 18, 52, 25, 49, 34];
const source = Buffer.concat([
  ...codes.flatMap((code) => [
    event(4, 4, 0x12345678),
    event(1, code, 1),
    event(1, code, 0),
    event(0, 0, 0),
  ]),
  event(0, 3, 0),
]);
const chunks = () => {
  const result: Buffer[] = [];
  let offset = 0,
    index = 0;
  const sizes = [1, 23, 37, 191, 5, 192, 88];
  while (offset < source.length) {
    const size = sizes[index++ % sizes.length]!;
    result.push(source.subarray(offset, offset + size));
    offset += size;
  }
  return result;
};
const full = invariant(chunks);
assert.deepEqual(
  full.delivered.map((key) => [key.code, key.value]),
  codes.flatMap((code) => [
    [code, 1],
    [code, 0],
  ]),
);
const batches = ofLayer(full.records, "keyboard-read");
assert.equal(
  batches.reduce((sum, batch) => sum + batch.bytes, 0),
  source.length,
);
assert.equal(
  batches.reduce((sum, batch) => sum + batch.keyEdges.length, 0),
  36,
);
assert.equal(
  batches.reduce((sum, batch) => sum + batch.syncRecords, 0),
  19,
);
assert.equal(
  batches.reduce((sum, batch) => sum + batch.droppedSyncRecords, 0),
  1,
);
assert.equal(
  batches.reduce((sum, batch) => sum + batch.otherRecords, 0),
  18,
);
assert(batches.some((batch) => batch.pendingBytes > 0 && batch.trailingBytes > 0));
assert(
  batches.every(
    (batch) =>
      batch.bytes + batch.pendingBytes === batch.completeRecords * 24 + batch.trailingBytes,
  ),
);
assert(!JSON.stringify(full.records).includes("305419896"), "MSC payload never observed");
const rawRows = full.records.filter(
  (record) => record.stage === "event" && record.event.layer === "raw-keyboard",
);
for (const record of rawRows) {
  assert(record.stage === "event");
  const parent = full.records.find(
    (item) => item.stage === "event" && item.sequence === record.sourceSequence,
  );
  assert(
    parent?.stage === "event" && parent.event.layer === "keyboard-read",
    "raw source links its preflighted batch",
  );
}

const throwBatch = Buffer.concat([
  event(1, 20, 1),
  event(1, 20, 0),
  event(1, 34, 1),
  event(1, 34, 0),
]);
const thrown = invariant(() => [throwBatch], { listenerThrows: true });
assert.equal(
  thrown.delivered.length,
  1,
  "existing listener error discards remainder; behavior intentionally unchanged",
);
assert.equal(ofLayer(thrown.records, "keyboard-read")[0]?.keyEdges.length, 4);
assert.equal(ofLayer(thrown.records, "raw-keyboard").length, 1);
assert.deepEqual(
  ofLayer(thrown.records, "keyboard-read-error").map(
    ({ phase, errorCode, bytes, pendingBytes, unprocessedBytes }) => ({
      phase,
      errorCode,
      bytes,
      pendingBytes,
      unprocessedBytes,
    }),
  ),
  [{ phase: "dispatch", errorCode: "EIO", bytes: 96, pendingBytes: 0, unprocessedBytes: 72 }],
);
assert.deepEqual(
  ofLayer(thrown.records, "keyboard-reopen").map((item) => [
    item.phase,
    item.device.fd,
    item.errorCode,
  ]),
  [
    ["attempt", 47, null],
    ["success", 47, null],
  ],
);
assert(thrown.records.some((record) => record.stage === "end" && record.reason === "identity"));
assert(!JSON.stringify(thrown.records).includes("injected arbitrary message"));
const dispatchAgain = invariant(() => [throwBatch], {
  listenerThrows: true,
  listenerErrorCode: "EAGAIN",
});
assert.equal(dispatchAgain.delivered.length, 1);
assert.equal(ofLayer(dispatchAgain.records, "keyboard-read-error")[0]?.phase, "dispatch");
assert.equal(ofLayer(dispatchAgain.records, "keyboard-read-error")[0]?.errorCode, "OTHER");
assert.equal(ofLayer(dispatchAgain.records, "keyboard-reopen").length, 0);

for (const code of ["EIO", "EBADF", "ENODEV", "EPERM"]) {
  const outcome = invariant(() => [event(1, 20, 1).subarray(0, 10), ioError(code)]);
  const error = ofLayer(outcome.records, "keyboard-read-error")[0];
  assert.deepEqual(
    error && [
      error.phase,
      error.errorCode,
      error.bytes,
      error.pendingBytes,
      error.unprocessedBytes,
    ],
    ["read", code === "EPERM" ? "OTHER" : code, 0, 10, 10],
  );
  assert.equal(ofLayer(outcome.records, "raw-keyboard").length, 0);
}
const eof = invariant(() => ["EOF"], { exclusive: true });
assert.deepEqual(
  ofLayer(eof.records, "keyboard-read").map((item) => [
    item.bytes,
    item.completeRecords,
    item.trailingBytes,
  ]),
  [[0, 0, 0]],
);
assert.deepEqual(
  ofLayer(eof.records, "keyboard-read-error").map((item) => [
    item.errorCode,
    item.unprocessedBytes,
  ]),
  [["EOF", 0]],
);
const eofIdle = invariant(() => [event(1, 20, 1).subarray(0, 10), "EOF"]);
assert.deepEqual(
  ofLayer(eofIdle.records, "keyboard-read").map((item) => [
    item.bytes,
    item.pendingBytes,
    item.trailingBytes,
  ]),
  [
    [10, 0, 10],
    [0, 10, 10],
  ],
);
assert.equal(ofLayer(eofIdle.records, "keyboard-reopen").length, 0);
const failed = invariant(() => [ioError("EIO")], { exclusive: true, reopenFails: true });
assert.equal(failed.failures, 1);
assert.deepEqual(
  ofLayer(failed.records, "keyboard-reopen").map((item) => [item.phase, item.errorCode]),
  [
    ["attempt", null],
    ["failure", "ENODEV"],
  ],
);
const unchanged = invariant(() => [ioError("EIO")], { sameFd: true });
assert(!unchanged.records.some((record) => record.stage === "end" && record.reason === "identity"));
const changed = invariant(() => [ioError("EIO")], { sameFd: true, changedIdentity: true });
assert(changed.records.some((record) => record.stage === "end" && record.reason === "identity"));
const empty = invariant(() => [ioError("EAGAIN"), ioError("EWOULDBLOCK")]);
assert.equal(observations(empty.records).length, 0);

const rejected = invariant(() => [Buffer.concat([event(1, 20, 1), event(1, 48, 1)])]);
assert.equal(rejected.delivered.length, 2);
assert.equal(
  observations(rejected.records).length,
  0,
  "entire batch rejected before any key payload",
);
assert(
  rejected.records.some((record) => record.stage === "end" && record.reason === "unexpected-input"),
);
const capped = invariant(() => Array.from({ length: 1050 }, () => event(4, 4, 0x12345678)));
assert.equal(ofLayer(capped.records, "keyboard-read").length, 1024);
assert.equal(capped.reads, 1050);
assert.equal(capped.records.filter((record) => record.stage === "overflow").length, 1);
assert.equal(capped.delivered.length, 0);
console.log(
  JSON.stringify({
    status: "pass",
    cases,
    fullPathKeyEdges: 36,
    listenerThrowReadEdges: 4,
    listenerThrowRawEdges: 1,
    retiredRemainderBytes: 72,
    readCap: 1024,
    scope: "actual EvdevKeyboard injected IO/readiness + real policy; no devices/native transport",
  }),
);
