/** Fixture policy regression; no process/device/Wayland transport is activated. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { keyFromEvdev } from "#ui/platform";
import {
  INPUT_FIXTURE_VALUE,
  createInputFixtureRecorder,
  parseInputFixtureManifest,
  type InputFixtureManifest,
  type InputFixtureObservation,
  type InputFixtureRecord,
} from "@moire/sys/input-fixture";

const expected = "/tmp/c36-trace.png";
const codes = [53, 20, 50, 25, 53, 46, 4, 7, 12, 20, 19, 30, 46, 18, 52, 25, 49, 34];
const modifiers = { ctrl: false, shift: false, alt: false, meta: false };
assert.equal(expected.length, 18);
assert.equal(INPUT_FIXTURE_VALUE, expected, "literal fixture contract remains explicit");
assert.equal(codes.length, 18);
const decoded = codes.map((code) => keyFromEvdev(code, modifiers));
assert.equal(decoded.map((event) => event.text).join(""), expected);
assert.equal(decoded.at(-1)?.text, "g");

// These coherent v2 identities validate the schema, not real /proc or device identity.
const manifest: InputFixtureManifest = {
  version: 2,
  runId: "abd9e746-d366-42f0-a3c1-a8a7adf8bef5",
  bootId: "00000000-0000-0000-0000-000000000002",
  armedAtMonoNs: "0",
  scenario: "keys",
  compositor: {
    pid: 101,
    uid: 1000,
    startTicks: "1001",
    cwd: "/fixture/apps/system/compositor",
    entryPoint: "/fixture/apps/system/compositor/src/main.ts",
  },
  app: {
    pid: 102,
    uid: 1000,
    startTicks: "1002",
    cwd: "/fixture/apps/bundled/screenshot",
    entryPoint: "/fixture/apps/bundled/screenshot/src/main.tsx",
  },
  appId: "org.moire.Screenshot",
  devices: [
    {
      path: "/dev/input/event1",
      rdev: "3393",
      sysfs: "/sys/devices/virtual/input/input1/event1",
      kind: "keyboard",
    },
    {
      path: "/dev/input/event2",
      rdev: "3394",
      sysfs: "/sys/devices/virtual/input/input2/event2",
      kind: "pointer",
    },
  ],
};
assert.deepEqual(parseInputFixtureManifest(manifest), manifest);
let mono = 1n;
const rawRecords: InputFixtureRecord[] = [];
const raw = createInputFixtureRecorder({
  manifest,
  role: "compositor",
  now: () => mono++,
  validate: () => null,
  emit: (record) => rawRecords.push(record),
});
let count = 0;
for (const code of codes)
  for (const value of [1, 0]) {
    const event: InputFixtureObservation = {
      layer: "raw-keyboard",
      device: Object.freeze({ path: "/dev/input/event1", rdev: "3393", fd: 10 }),
      type: 1,
      code,
      value,
      timeMs: count,
    };
    Object.freeze(event);
    const before = JSON.stringify(event);
    const ordinal = raw.write(event);
    assert.notEqual(
      ordinal,
      null,
      `raw code${code} value${value} (${keyFromEvdev(code, modifiers).text}) must be admitted`,
    );
    const receipt = rawRecords.at(-1);
    assert.ok(receipt && receipt.stage === "event");
    assert.equal(receipt.event, event, "recorder preserves the original down/up object");
    assert.equal(JSON.stringify(event), before);
    count++;
  }
assert.equal(count, 36);
assert.equal(rawRecords.filter((record) => record.stage === "event").length, 36);
assert.equal(rawRecords.filter((record) => record.stage === "end").length, 0);
assert.equal(raw.active(), true);

const appRecords: InputFixtureRecord[] = [];
const app = createInputFixtureRecorder({
  manifest,
  role: "app",
  now: () => mono++,
  validate: () => null,
  emit: (record) => appRecords.push(record),
});
app.value("change", "");
let prefix = "";
for (const [index, code] of codes.entries()) {
  const logical = keyFromEvdev(code, modifiers);
  assert.ok(logical.text);
  for (const type of ["down", "up"] as const) {
    const event: InputFixtureObservation = {
      layer: "client-key",
      type,
      code,
      timeMs: index,
      modifiers,
    };
    assert.notEqual(app.write(event), null, `decoded client code${code}/${type} must be admitted`);
  }
  prefix += logical.text;
  app.value("change", prefix);
}
app.value("submit", prefix);
app.value("save", prefix);
app.value("change", "6rn"); // Ordered dropped-input subsequence, not arbitrary text.
const values = appRecords.filter((record) => record.stage === "value");
assert.equal(values.length, 22);
const prefixes = values.filter((record) => record.action === "change").slice(0, 19);
assert.deepEqual(
  prefixes.map((record) => record.length),
  Array.from({ length: 19 }, (_, i) => i),
);
assert.deepEqual(
  prefixes.map((record) => record.expected),
  Array.from({ length: 19 }, (_, i) => i === 18),
);
assert.deepEqual(
  values.filter((record) => record.expected).map((record) => record.action),
  ["change", "submit", "save"],
);
const expectedHash = createHash("sha256").update(expected).digest("hex");
assert.ok(
  values.filter((record) => record.expected).every((record) => record.sha256 === expectedHash),
);
assert.equal(values.at(-1)?.expected, false);
assert.equal(values.at(-1)?.length, 3);
assert.equal(appRecords.filter((record) => record.stage === "end").length, 0);
assert.ok(
  !JSON.stringify(appRecords).includes(expected),
  "synthetic text is represented only by length/hash",
);
console.log(
  "input-fixture-path: actual evdev decoder18 chars, original raw down/up36 + client down/up36 accepted, schema-v2 identities, prefix/full/subsequence value22 flags; no unexpected-input stop (device-free policy scope)",
);
