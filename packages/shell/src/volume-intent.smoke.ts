import { BLUETOOTH_UNAVAILABLE } from "@moire/system-management/bluetooth-status";
import { BATTERY_UNAVAILABLE } from "@moire/system-management/battery-status";
import { WIFI_UNAVAILABLE } from "@moire/system-management/network-status";
import assert from "node:assert/strict";
import type { DesktopAudio, DesktopStatusState } from "@moire/system-management/desktop-status";
import { createVolumeIntent, type VolumeDispatchIntent } from "./volume-intent";

const ready = (
  revision = 1,
  volume = 0.4,
  owner = ":1.10",
  updating = false,
  audio: DesktopAudio = { kind: "ready", volume, muted: false, name: "Speakers" },
): DesktopStatusState => ({
  kind: "ready",
  owner,
  snapshot: {
    revision,
    audio,
    updating,
    network: [],
    wifi: WIFI_UNAVAILABLE,
    bluetooth: BLUETOOTH_UNAVAILABLE,
    battery: BATTERY_UNAVAILABLE,
    capabilities: {
      audio: true,
      brightness: false,
      battery: false,
      bluetooth: false,
      power: false,
      notifications: true,
    },
    doNotDisturb: false,
    notificationsAvailable: true,
    notices: [],
  },
});
function committed(model: ReturnType<typeof createVolumeIntent>, value = 0.67) {
  assert.equal(model.begin(), true);
  assert.equal(model.change(value), true);
  const intent = model.commit();
  assert.ok(intent);
  return intent;
}
let cases = 0;
function test(name: string, run: () => void) {
  run();
  cases++;
  process.stdout.write(`[volume-intent] ${name}\n`);
}

test("many drag samples coalesce to one exact frozen dispatch", () => {
  const model = createVolumeIntent(ready());
  assert.equal(model.change(0.8), false);
  assert.equal(model.commit(), null);
  assert.equal(model.begin(), true);
  for (let index = 0; index <= 100; index++) assert.equal(model.change(index / 100), true);
  const intent = model.commit();
  assert.deepEqual(intent, { owner: ":1.10", revision: 1, value: 1 });
  assert.equal(Object.isFrozen(intent), true);
  for (let index = 0; index < 100; index++) {
    assert.equal(model.change(0.2), false);
    assert.equal(model.commit(), null);
    assert.equal(model.begin(), false);
  }
});

test("own loading and intermediate readback never rewind or settle before result", () => {
  const model = createVolumeIntent(ready());
  const intent = committed(model);
  model.observe(ready(2, 0.4, ":1.10", true, { kind: "loading", message: "Reading sound" }));
  assert.deepEqual(model.state, { kind: "pending", intent });
  model.observe(ready(3, 0.52, ":1.10", true));
  assert.deepEqual(model.state, { kind: "pending", intent });
  model.observe(ready(4, 0.64));
  assert.deepEqual(model.state, { kind: "pending", intent });
  assert.equal(model.begin(), false);
  model.result(intent, { kind: "succeeded" });
  assert.equal(model.state.kind, "idle");
  assert.deepEqual(model.observed, ready(4, 0.64));
});

test("success waits for actual idle final signal and does not claim requested value", () => {
  const model = createVolumeIntent(ready());
  const intent = committed(model);
  model.result(intent, { kind: "succeeded" });
  assert.equal(model.state.kind, "pending");
  model.observe(ready(2, 0.63, ":1.10", true));
  assert.equal(model.state.kind, "pending");
  model.observe(ready(3, 0.63));
  assert.equal(model.state.kind, "idle");
  assert.deepEqual(model.observed, ready(3, 0.63));
});

test("timeout stays unknown until later authoritative completion", () => {
  const model = createVolumeIntent(ready());
  const intent = committed(model);
  model.observe(ready(2, 0.4, ":1.10", true));
  model.result(intent, { kind: "unknown", message: "Deadline exceeded" });
  assert.deepEqual(model.state, { kind: "unknown", intent, message: "Deadline exceeded" });
  assert.equal(model.begin(), false);
  model.cancel();
  assert.equal(model.state.kind, "unknown");
  model.observe(ready(3, 0.5, ":1.10", true));
  assert.equal(model.state.kind, "unknown");
  model.observe(ready(4, 0.5));
  assert.equal(model.state.kind, "idle");
});

test("unknown cannot settle from a cached observation or the unchanged base revision", () => {
  const model = createVolumeIntent(ready());
  const intent = committed(model);
  model.observe(ready(2, 0.4));
  model.result(intent, { kind: "unknown", message: "Lost reply" });
  assert.equal(model.state.kind, "unknown");
  model.observe(ready());
  assert.equal(model.state.kind, "unknown");
  model.observe(ready(3, 0.4));
  assert.equal(model.state.kind, "idle");
});

test("external edit-time changes revoke until a new explicit gesture", () => {
  const transitions: DesktopStatusState[] = [
    ready(2),
    ready(1, 0.4, ":1.11"),
    ready(1, 0.4, ":1.10", true),
    ready(1, 0.4, ":1.10", false, { kind: "loading", message: "Loading" }),
    ready(1, 0.4, ":1.10", false, { kind: "unavailable", message: "No output" }),
    ready(2, 0.4, ":1.10", false, { kind: "ready", volume: 0.4, muted: false, name: "New output" }),
    { kind: "loading", message: "New service" },
    { kind: "unavailable", message: "Disconnected" },
  ];
  for (const next of transitions) {
    const model = createVolumeIntent(ready());
    assert.equal(model.begin(), true);
    model.change(0.8);
    model.observe(next);
    assert.equal(model.state.kind, "revoked");
    model.observe(ready(3));
    assert.equal(model.change(0.9), false);
    assert.equal(model.commit(), null);
    assert.equal(model.begin(), true);
    assert.equal(model.change(0.5), true);
    assert.deepEqual(model.commit(), { owner: ":1.10", revision: 3, value: 0.5 });
  }
});

test("owner loss revokes even a late successful callback with the same values", () => {
  const model = createVolumeIntent(ready());
  const first = committed(model);
  model.observe({ kind: "unavailable", message: "Disconnected" });
  model.result(first, { kind: "succeeded" });
  assert.equal(model.state.kind, "revoked");
  model.observe(ready());
  const second = committed(model);
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  model.result(first, { kind: "unknown", message: "Old timeout" });
  assert.deepEqual(model.state, { kind: "pending", intent: second });
  const forged: VolumeDispatchIntent = { ...second };
  model.result(forged, { kind: "succeeded" });
  assert.deepEqual(model.state, { kind: "pending", intent: second });
});

test("replacement service cannot inherit pending/unknown authority", () => {
  for (const kind of ["pending", "unknown"]) {
    const model = createVolumeIntent(ready());
    const intent = committed(model);
    if (kind === "unknown") model.result(intent, { kind: "unknown", message: "Timeout" });
    model.observe(ready(5, 0.9, ":1.11"));
    assert.equal(model.state.kind, "revoked");
    model.result(intent, { kind: "succeeded" });
    assert.equal(model.state.kind, "revoked");
  }
});

test("blocked initial states and invalid draft numbers never dispatch", () => {
  for (const observed of [
    { kind: "loading", message: "Loading" } satisfies DesktopStatusState,
    { kind: "error", message: "Failure" } satisfies DesktopStatusState,
    ready(2, 0.4, ":1.10", true),
    ready(2, 0.4, ":1.10", false, { kind: "error", message: "Read failure" }),
  ])
    assert.equal(createVolumeIntent(observed).begin(), false);
  const model = createVolumeIntent(ready());
  model.begin();
  for (const invalid of [NaN, Infinity, -Infinity, -0.01, 1.01])
    assert.equal(model.change(invalid), false);
  assert.deepEqual(model.commit(), { owner: ":1.10", revision: 1, value: 0.4 });
});

test("amplified observed value and mute remain truthful, only draft clamps", () => {
  const actual = ready(1, 1.4, ":1.10", false, {
    kind: "ready",
    volume: 1.4,
    muted: true,
    name: "Speakers",
  });
  const model = createVolumeIntent(actual);
  model.begin();
  assert.deepEqual(model.state, { kind: "editing", owner: ":1.10", revision: 1, value: 1 });
  assert.equal(model.observed, actual);
  assert.deepEqual(model.observed, actual);
  model.cancel();
  assert.equal(model.state.kind, "idle");
  assert.equal(model.commit(), null);
});

test("disposal makes all old callbacks and future gestures inert", () => {
  const model = createVolumeIntent(ready());
  const intent = committed(model);
  model.dispose();
  model.dispose();
  model.observe(ready(3, 0.8));
  model.result(intent, { kind: "succeeded" });
  model.result(intent, { kind: "unknown", message: "Late" });
  model.cancel();
  assert.equal(model.begin(), false);
  assert.equal(model.change(0.8), false);
  assert.equal(model.commit(), null);
  assert.deepEqual(model.state, { kind: "disposed" });
  assert.deepEqual(model.observed, ready());
});

test("stale status and duplicate result cannot restore an older operation", () => {
  const model = createVolumeIntent(ready(10));
  const intent = committed(model);
  model.observe(ready(11, 0.4, ":1.10", true));
  model.observe(ready(9, 0.8));
  assert.deepEqual(model.observed, ready(11, 0.4, ":1.10", true));
  model.result(intent, { kind: "succeeded" });
  model.result(intent, { kind: "unknown", message: "Duplicate callback" });
  const pending = model.state;
  assert.deepEqual(pending, { kind: "pending", intent });
  model.observe(ready(12, 0.66));
  assert.equal(model.state.kind, "idle");
  model.result(intent, { kind: "unknown", message: "Late callback" });
  assert.equal(model.state.kind, "idle");
});

test("external mute/output change during edit requires a fresh gesture", () => {
  const model = createVolumeIntent(ready());
  model.begin();
  model.change(0.8);
  model.observe(
    ready(2, 0.4, ":1.10", false, {
      kind: "ready",
      volume: 0.4,
      muted: true,
      name: "Headphones",
    }),
  );
  assert.equal(model.state.kind, "revoked");
  assert.equal(model.change(0.9), false);
  assert.equal(model.commit(), null);
  assert.equal(model.begin(), true);
  assert.deepEqual(model.commit(), { owner: ":1.10", revision: 2, value: 0.4 });
});

process.stdout.write(`[volume-intent] ${cases} gesture/readback lifecycle cases passed\n`);
