import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  createInputFixtureRecorder,
  createInputFixtureTrace,
  INPUT_FIXTURE_VALUE,
  parseInputFixtureManifest,
  type InputFixtureManifest,
  type InputFixtureRecord,
  type InputFixtureObservation,
  type InputFixtureEndReason,
} from "./input-fixture-trace";

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
    startTicks: "12345678901234567890",
    cwd: "/home/moire",
    entryPoint: "/nix/store/test/apps/system/compositor/src/main.ts",
  },
  app: {
    pid: 456,
    uid: 1000,
    startTicks: "23456789012345678901",
    cwd: "/nix/store/test/apps/bundled/screenshot",
    entryPoint: "/nix/store/test/apps/bundled/screenshot/src/main.tsx",
  },
  devices: [
    {
      path: "/dev/input/event0",
      rdev: "3328",
      sysfs: "/sys/devices/test/input/input0/event0",
      kind: "keyboard",
    },
    {
      path: "/dev/input/event1",
      rdev: "3329",
      sysfs: "/sys/devices/test/input/input1/event1",
      kind: "pointer",
    },
  ],
};
const raw: InputFixtureObservation = {
  layer: "raw-keyboard",
  device: { path: "/dev/input/event0", rdev: "3328", fd: 7 },
  type: 1,
  code: 20,
  value: 1,
  timeMs: 123,
};
let cases = 0;
function fixture(role: "app" | "compositor" = "compositor", scenario: "keys" | "pointer" = "keys") {
  const records: InputFixtureRecord[] = [];
  let time = 1_000_000n,
    reason: InputFixtureEndReason | null = null;
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
    time: (next: bigint) => {
      time = next;
    },
    reason: (next: InputFixtureEndReason | null) => {
      reason = next;
    },
  };
}

assert.deepEqual(parseInputFixtureManifest(manifest), manifest);
for (const change of [
  { version: 1 },
  { runId: "../../../etc" },
  { armedAtMonoNs: "NaN" },
  { appId: "org.other.App" },
  { devices: [] },
  { app: { ...manifest.app, pid: manifest.compositor.pid } },
  { app: { ...manifest.app, uid: 0 } },
  { app: { ...manifest.app, cwd: "/home/moire/../moire" } },
  { app: { ...manifest.app, entryPoint: "/nix/store/test/apps/bundled/editor/src/main.tsx" } },
  { app: { ...manifest.app, entryPoint: "/nix/store/other/apps/bundled/screenshot/src/main.tsx" } },
  { compositor: { ...manifest.compositor, entryPoint: undefined } },
  {
    compositor: {
      ...manifest.compositor,
      entryPoint: "/nix/store/test/apps/system/../system/compositor/src/main.ts",
    },
  },
  { compositor: { ...manifest.compositor, unrelated: true } },
  { devices: [manifest.devices[0], manifest.devices[0]] },
  { devices: manifest.devices.map((device) => ({ ...device, rdev: "3328" })) },
]) {
  assert.throws(() => parseInputFixtureManifest({ ...manifest, ...change }));
  cases++;
}

{
  const { trace, records, time } = fixture();
  const ordinal = trace.write(raw),
    original = { type: "down", code: 20 };
  trace.link(original, ordinal);
  assert.equal(trace.sourceOf(original), ordinal);
  assert.deepEqual(original, { type: "down", code: 20 });
  assert.equal(trace.sourceOf({ ...original }), null);
  time(90_001_000_000n);
  assert.equal(trace.active(), false);
  assert.equal(trace.write(raw), null);
  assert.equal(trace.sourceOf(original), null);
  assert.equal(records.filter((record) => record.stage === "end").length, 1);
  assert.equal(records.at(-1)?.stage, "end");
  cases++;
}
for (const reason of ["identity", "focus"] satisfies InputFixtureEndReason[]) {
  const state = fixture();
  state.reason(reason);
  assert.equal(state.trace.write(raw), null);
  assert.equal(state.records.filter((record) => record.stage === "event").length, 0);
  const last = state.records.at(-1);
  assert.ok(last?.stage === "end" && last.reason === reason);
  cases++;
}
{
  const state = fixture();
  for (let i = 0; i < 1100; i++) state.trace.write(raw);
  state.trace.stop("closed");
  assert.equal(state.records.filter((record) => record.stage === "event").length, 1024);
  assert.equal(state.records.filter((record) => record.stage === "overflow").length, 1);
  const last = state.records.at(-1);
  assert.ok(last?.stage === "end");
  assert.equal(last.counts["raw-keyboard"], 1100);
  assert.equal(last.omitted["raw-keyboard"], 76);
  cases++;
}
{
  const state = fixture("app");
  const key: InputFixtureObservation = {
    layer: "client-key",
    type: "down",
    code: 20,
    timeMs: 123,
    modifiers: { ctrl: false, alt: false, shift: false, meta: false },
  };
  for (let i = 0; i < 512; i++) state.trace.write(key);
  state.trace.value("change", "6rn");
  state.trace.stop("closed");
  assert.equal(
    state.records.filter((record) => record.stage === "event" || record.stage === "value").length,
    512,
  );
  assert.equal(state.records.filter((record) => record.stage === "overflow").length, 1);
  const last = state.records.at(-1);
  assert.ok(last?.stage === "end");
  assert.equal(last.omitted["app-value"], 1);
  cases++;
}
{
  const state = fixture("app");
  for (let length = 0; length <= INPUT_FIXTURE_VALUE.length; length++)
    state.trace.value("change", INPUT_FIXTURE_VALUE.slice(0, length));
  state.trace.value("submit", "6rn");
  const last = state.records.at(-1);
  assert.ok(last?.stage === "value");
  assert.equal(last.sha256, createHash("sha256").update("6rn").digest("hex"));
  assert.equal(last.length, 3);
  assert.equal(last.expected, false);
  assert.equal(JSON.stringify(state.records).includes("6rn"), false);
  cases++;
}
for (const value of ["/home/moire/Screenshot-2026.png", "private notes", "ppp", "\u0000"]) {
  const state = fixture("app");
  state.trace.value("change", value);
  assert.equal(state.records.filter((record) => record.stage === "value").length, 0);
  const last = state.records.at(-1);
  assert.ok(last?.stage === "end" && last.reason === "unexpected-value");
  assert.equal(JSON.stringify(state.records).includes(value), false);
  cases++;
}
for (const event of [
  { ...raw, code: 48 },
  { ...raw, device: { ...raw.device, rdev: "9999" } },
  { ...raw, device: { ...raw.device, path: "/dev/input/event5" } },
  { ...raw, device: { ...raw.device, fd: -1 } },
] satisfies InputFixtureObservation[]) {
  const state = fixture();
  state.trace.write(event);
  assert.equal(state.records.filter((record) => record.stage === "event").length, 0);
  const last = state.records.at(-1);
  assert.ok(last?.stage === "end" && last.reason === "unexpected-input");
  cases++;
}
{
  const state = fixture("compositor", "pointer");
  state.trace.write(raw);
  assert.equal(state.trace.active(), false);
  cases++;
}
{
  let calls = 0;
  const trace = createInputFixtureRecorder({
    manifest,
    role: "compositor",
    now: () => 1_000_000n,
    validate: () => null,
    emit() {
      calls++;
      throw new Error("sink failed");
    },
  });
  assert.doesNotThrow(() => trace.write(raw));
  assert.equal(trace.active(), false);
  assert.equal(calls, 2);
  cases++;
}
{
  const records: InputFixtureRecord[] = [];
  const trace = createInputFixtureRecorder({
    manifest,
    role: "compositor",
    now: () => 1_000_000n,
    validate() {
      throw new Error("identity failed");
    },
    emit: (record) => records.push(record),
  });
  assert.equal(trace.active(), false);
  assert.equal(records.length, 1);
  assert.equal(records[0]?.stage, "end");
  cases++;
}
{
  const previous = process.env.MOIRE_INPUT_FIXTURE_TRACE;
  delete process.env.MOIRE_INPUT_FIXTURE_TRACE;
  const trace = createInputFixtureTrace("app");
  assert.equal(trace.active(), false);
  assert.equal(trace.write(raw), null);
  if (previous !== undefined) process.env.MOIRE_INPUT_FIXTURE_TRACE = previous;
  cases++;
}
console.log(
  JSON.stringify({
    status: "pass",
    cases,
    checks:
      "scope, finite caps/deadline, value rejection before hash, unchanged object identity, throwing observer, default off",
  }),
);
