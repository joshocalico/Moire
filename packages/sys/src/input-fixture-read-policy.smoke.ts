import assert from "node:assert/strict";
import {
  createInputFixtureRecorder,
  type InputFixtureEndReason,
  type InputFixtureManifest,
  type InputFixtureObservation,
  type InputFixtureRecord,
} from "./input-fixture-trace";

// Device-free policy tests. These identities are fixture declarations, not
// assertions about an opened native descriptor or kernel input delivery.
const manifest: InputFixtureManifest = {
  version: 2,
  runId: "11111111-1111-4111-8111-111111111111",
  bootId: "22222222-2222-4222-8222-222222222222",
  armedAtMonoNs: "1000000",
  scenario: "keys",
  appId: "org.moire.Screenshot",
  compositor: {
    pid: 123,
    uid: 1000,
    startTicks: "12345",
    cwd: "/home/moire",
    entryPoint: "/nix/store/test/apps/system/compositor/src/main.ts",
  },
  app: {
    pid: 456,
    uid: 1000,
    startTicks: "23456",
    cwd: "/nix/store/test/apps/bundled/screenshot",
    entryPoint: "/nix/store/test/apps/bundled/screenshot/src/main.tsx",
  },
  devices: [
    {
      path: "/dev/input/event0",
      rdev: "3328",
      sysfs: "/sys/devices/test/event0",
      kind: "keyboard",
    },
    { path: "/dev/input/event1", rdev: "3329", sysfs: "/sys/devices/test/event1", kind: "pointer" },
  ],
};
const device = { path: "/dev/input/event0", rdev: "3328", fd: 7 };
type Read = Extract<InputFixtureObservation, { layer: "keyboard-read" }>;
type ReadError = Extract<InputFixtureObservation, { layer: "keyboard-read-error" }>;
const read: Read = {
  layer: "keyboard-read",
  device,
  bytes: 120,
  pendingBytes: 3,
  completeRecords: 5,
  trailingBytes: 3,
  keyEdges: [
    { code: 34, value: 1 },
    { code: 34, value: 0 },
  ],
  syncRecords: 2,
  droppedSyncRecords: 1,
  otherRecords: 1,
};
const readError: ReadError = {
  layer: "keyboard-read-error",
  device,
  phase: "read",
  errorCode: "EIO",
  bytes: 0,
  pendingBytes: 23,
  unprocessedBytes: 23,
};
const reopen = {
  layer: "keyboard-reopen",
  device,
  phase: "attempt",
  errorCode: null,
} satisfies InputFixtureObservation;
let cases = 0;
function fixture(role: "app" | "compositor" = "compositor", scenario: "keys" | "pointer" = "keys") {
  const records: InputFixtureRecord[] = [];
  let time = 1_000_000n;
  let reason: InputFixtureEndReason | null = null;
  const trace = createInputFixtureRecorder({
    manifest: { ...manifest, scenario },
    role,
    now: () => time,
    validate: () => reason,
    emit: (record) => records.push(record),
  });
  return {
    trace,
    records,
    time: (value: bigint) => {
      time = value;
    },
    reason: (value: InputFixtureEndReason) => {
      reason = value;
    },
  };
}
function accepted(event: InputFixtureObservation) {
  const state = fixture();
  const original = JSON.stringify(event);
  assert.notEqual(state.trace.write(event), null);
  const record = state.records.find((record) => record.stage === "event");
  assert.ok(record?.stage === "event");
  assert.equal(record.event, event, "observer retains the original input observation");
  assert.equal(JSON.stringify(event), original);
  assert.equal(state.trace.active(), true);
  state.trace.stop("closed");
  cases++;
}
function rejected(
  event: unknown,
  role: "app" | "compositor" = "compositor",
  scenario: "keys" | "pointer" = "keys",
) {
  const state = fixture(role, scenario);
  // Exercise malformed boundary input without claiming it is a typed event.
  assert.equal(Reflect.apply(state.trace.write, state.trace, [event]), null);
  assert.equal(state.records.filter((record) => record.stage === "event").length, 0);
  const last = state.records.at(-1);
  assert.ok(last?.stage === "end" && last.reason === "unexpected-input");
  assert.equal(state.trace.active(), false);
  assert.equal(state.trace.write(read), null, "a rejected batch cannot resume diagnostics");
  assert.equal(state.records.filter((record) => record.stage === "end").length, 1);
  cases++;
}

accepted(read);
accepted({
  ...read,
  bytes: 0,
  pendingBytes: 23,
  completeRecords: 0,
  trailingBytes: 23,
  keyEdges: [],
  syncRecords: 0,
  droppedSyncRecords: 0,
  otherRecords: 0,
});
accepted({
  ...read,
  bytes: 1,
  pendingBytes: 23,
  completeRecords: 1,
  trailingBytes: 0,
  keyEdges: [{ code: 34, value: 2 }],
  syncRecords: 0,
  droppedSyncRecords: 0,
  otherRecords: 0,
});
accepted({
  ...read,
  bytes: 192,
  pendingBytes: 23,
  completeRecords: 8,
  trailingBytes: 23,
  keyEdges: Array.from({ length: 8 }, (_, i) => ({ code: 34, value: i % 3 })),
  syncRecords: 0,
  droppedSyncRecords: 0,
  otherRecords: 0,
});
accepted({
  ...read,
  bytes: 192,
  pendingBytes: 0,
  completeRecords: 8,
  trailingBytes: 0,
  keyEdges: [],
  syncRecords: 8,
  droppedSyncRecords: 8,
  otherRecords: 0,
});
accepted({
  ...read,
  bytes: 192,
  pendingBytes: 0,
  completeRecords: 8,
  trailingBytes: 0,
  keyEdges: [],
  syncRecords: 0,
  droppedSyncRecords: 0,
  otherRecords: 8,
});
for (const change of [
  { bytes: 193 },
  { bytes: -1 },
  { bytes: 0.5 },
  { bytes: Number.NaN },
  { pendingBytes: 24 },
  { completeRecords: 9 },
  { trailingBytes: 24 },
  { bytes: 119 },
  { otherRecords: 2 },
  { droppedSyncRecords: 3 },
  { syncRecords: -1 },
  { otherRecords: 0.5 },
  { keyEdges: Array.from({ length: 9 }, () => ({ code: 34, value: 1 })) },
  {
    keyEdges: [
      { code: 34, value: 1 },
      { code: 48, value: 0 },
    ],
  },
  {
    keyEdges: [
      { code: 34, value: 1 },
      { code: 34, value: 3 },
    ],
  },
  {
    keyEdges: [
      { code: 34, value: 1, scancode: 23 },
      { code: 34, value: 0 },
    ],
  },
  { keyEdges: [] },
  { mscPayload: [23] },
  { message: "unrelated private text" },
  { device: { ...device, fd: -1 } },
  { device: { ...device, fd: 1.5 } },
  { device: { ...device, path: "/dev/input/event9" } },
  { device: { ...device, rdev: "9999" } },
  { device: { path: "/dev/input/event1", rdev: "3329", fd: 7 } },
  { device: { ...device, newFd: 8 } },
])
  rejected({ ...read, ...change });

for (const errorCode of [
  "EIO",
  "EBADF",
  "ENODEV",
  "EOF",
  "OTHER",
] satisfies ReadError["errorCode"][]) {
  accepted({ ...readError, errorCode });
  accepted({ ...readError, phase: "frame", errorCode, bytes: 192, unprocessedBytes: 215 });
  accepted({ ...readError, phase: "frame", errorCode, bytes: 192, unprocessedBytes: 47 });
  accepted({ ...readError, phase: "dispatch", errorCode, bytes: 192, unprocessedBytes: 191 });
  accepted({ ...readError, phase: "dispatch", errorCode, bytes: 192, unprocessedBytes: 23 });
}
accepted({ ...readError, pendingBytes: 0, unprocessedBytes: 0, errorCode: "EOF" });
// Framing also includes concatenation/storage failures before a full record.
accepted({ ...readError, phase: "frame", bytes: 1, pendingBytes: 0, unprocessedBytes: 1 });
accepted({ ...readError, phase: "frame", bytes: 192, unprocessedBytes: 23 });
for (const change of [
  { bytes: 1 },
  { unprocessedBytes: 22 },
  { pendingBytes: 24 },
  { errorCode: "EAGAIN" },
  { errorCode: "private exception message" },
  { phase: "decode" },
  { message: "unrelated private text" },
  { phase: "frame", bytes: 192, unprocessedBytes: 214 },
  { phase: "dispatch", bytes: 192, unprocessedBytes: 215 },
  { phase: "dispatch", bytes: 192, unprocessedBytes: 192 },
  { phase: "dispatch", bytes: 192, unprocessedBytes: 216 },
  { phase: "dispatch", bytes: 0 },
])
  rejected({ ...readError, ...change });

accepted(reopen);
accepted({ ...reopen, phase: "success" });
for (const errorCode of [
  "EIO",
  "EBADF",
  "ENODEV",
  "EOF",
  "OTHER",
] satisfies ReadError["errorCode"][])
  accepted({ ...reopen, phase: "failure", errorCode });
for (const change of [
  { phase: "success", errorCode: "EIO" },
  { phase: "failure", errorCode: null },
  { phase: "failure", errorCode: "EACCES" },
  { phase: "opening" },
  { newFd: 8 },
  { message: "unrelated error" },
  { device: { ...device, path: "/dev/input/event9" } },
])
  rejected({ ...reopen, ...change });

for (const event of [read, readError, reopen]) {
  rejected(event, "app");
  rejected(event, "compositor", "pointer");
  for (const reason of ["identity", "focus"] satisfies InputFixtureEndReason[]) {
    const state = fixture();
    state.reason(reason);
    assert.equal(state.trace.write(event), null);
    assert.equal(state.records.filter((record) => record.stage === "event").length, 0);
    const last = state.records.at(-1);
    assert.ok(last?.stage === "end" && last.reason === reason);
    cases++;
  }
  const expired = fixture();
  expired.time(90_001_000_000n);
  assert.equal(expired.trace.write(event), null);
  const last = expired.records.at(-1);
  assert.ok(last?.stage === "end" && last.reason === "deadline");
  cases++;
}

{
  const state = fixture();
  for (const event of [read, readError, reopen]) {
    for (let i = 0; i < 1030; i++) state.trace.write(event);
    assert.equal(
      state.records.filter(
        (record) => record.stage === "event" && record.event.layer === event.layer,
      ).length,
      1024,
    );
    assert.equal(
      state.records.filter((record) => record.stage === "overflow" && record.layer === event.layer)
        .length,
      1,
    );
  }
  state.trace.stop("closed");
  const last = state.records.at(-1);
  assert.ok(last?.stage === "end");
  for (const event of [read, readError, reopen]) {
    assert.equal(last.counts[event.layer], 1030);
    assert.equal(last.omitted[event.layer], 6);
  }
  cases++;
}
{
  let reads = 0;
  const state = fixture();
  state.reason("identity");
  const guarded = {
    get layer() {
      reads++;
      return "keyboard-read";
    },
  };
  assert.equal(Reflect.apply(state.trace.write, state.trace, [guarded]), null);
  assert.equal(reads, 0, "scope rejection precedes observer payload access");
  cases++;
}
console.log(
  JSON.stringify({
    scope: "pure read-boundary policy; no devices or native input",
    cases,
    passed: true,
  }),
);
