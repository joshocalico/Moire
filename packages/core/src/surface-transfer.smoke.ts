import assert from "node:assert/strict";
import { SurfaceTransferCollector, type SurfaceTransferCommit } from "./surface-transfer";

const initial: SurfaceTransferCommit = {
  clientId: 1,
  surfaceId: 9,
  renderer: "EGL / fixture GPU",
  bufferKind: "dmabuf",
  storage: "gpu",
  width: 3,
  height: 2,
  stride: 16,
  updated: true,
  updatedAreaPixels: 6,
};

const disabled = new SurfaceTransferCollector();
disabled.commit(initial);
disabled.record({ clientId: 1, surfaceId: 9, operation: "copy", bytes: 32, cpuMs: 1 });
assert.deepEqual(disabled.snapshot(), [], "disabled metrics retain no surface or work");

const collector = new SurfaceTransferCollector(true);
collector.commit(initial);
collector.record({ clientId: 1, surfaceId: 9, operation: "import", bytes: 32, cpuMs: 0.125 });
collector.record({ clientId: 1, surfaceId: 9, operation: "copy", bytes: 32, cpuMs: 0.25 });
collector.commit({ ...initial, updated: false, updatedAreaPixels: 6 });
collector.record({ clientId: 1, surfaceId: 9, operation: "readback", bytes: 32, cpuMs: 0.5 });
collector.record({ clientId: 1, surfaceId: 9, operation: "readback", bytes: 32, cpuMs: 0.75 });
const first = collector.snapshot()[0];
assert.ok(first);
assert.equal(first.snapshotBytes, 32, "snapshot allocation includes returned stride padding");
assert.equal(first.bufferAreaPixels, 6);
assert.equal(first.commits, 2);
assert.equal(first.updatedCommits, 1);
assert.equal(first.idleCommits, 1);
assert.equal(first.updatedAreaPixels, 6, "idle commits do not accumulate damage or transfer work");
assert.equal(first.operations.map, null, "native GBM map is unmeasured until instrumented");
assert.equal(first.operations.upload, null, "no guessed GPU upload count");
collector.idleCommit(1, 9);
assert.equal(collector.snapshot()[0]?.idleCommits, 2);
assert.deepEqual(first.operations.copy, { count: 1, bytes: 32, cpuMs: 0.25, gpuMs: null });
assert.deepEqual(first.operations.readback, { count: 2, bytes: 64, cpuMs: 1.25, gpuMs: null });

// Reports are independent values and cannot corrupt future observations.
assert.ok(first.operations.copy);
first.operations.copy.bytes = 999;
first.storage = "cpu";
assert.equal(collector.snapshot()[0]?.operations.copy?.bytes, 32);
assert.equal(collector.snapshot()[0]?.storage, "gpu");

collector.commit({
  ...initial,
  clientId: 2,
  renderer: "Software",
  bufferKind: "shm",
  storage: "cpu",
});
collector.record({ clientId: 2, surfaceId: 9, operation: "map", bytes: 0, cpuMs: 0 });
assert.equal(
  collector.snapshot().length,
  2,
  "equal surface IDs in different clients stay separate",
);
assert.deepEqual(collector.snapshot()[1]?.operations.map, {
  count: 1,
  bytes: 0,
  cpuMs: 0,
  gpuMs: null,
});
assert.equal(collector.snapshot()[0]?.operations.map, null);

collector.commit({ ...initial, width: 10, stride: 64, updatedAreaPixels: 5 });
const resized = collector.snapshot()[0];
assert.equal(resized?.snapshotBytes, 128);
assert.equal(resized?.bufferAreaPixels, 20);
assert.equal(resized?.updatedAreaPixels, 11);
assert.equal(resized?.operations.copy?.count, 1, "commits do not fabricate transfer events");
collector.commit({ ...initial, storage: "cpu" });
assert.equal(
  collector.snapshot()[0]?.operations.copy,
  null,
  "fallback starts a separate path record",
);
collector.record({ clientId: 1, surfaceId: 9, operation: "copy", bytes: 32, cpuMs: null });
assert.equal(
  collector.snapshot()[0]?.operations.copy?.cpuMs,
  null,
  "unknown CPU time stays unknown",
);

collector.removeSurface(1, 9);
collector.commit(initial);
assert.equal(
  collector.snapshot()[1]?.commits,
  1,
  "destroyed and reused object IDs begin new metrics",
);
assert.equal(collector.snapshot()[1]?.operations.copy, null);
collector.removeClient(2);
assert.equal(collector.snapshot().length, 1);
collector.clear();
assert.deepEqual(collector.snapshot(), []);
assert.throws(
  () => collector.record({ clientId: 1, surfaceId: 9, operation: "copy", bytes: 0, cpuMs: 0 }),
  /committed surface/,
);

console.log(
  "Surface transfer opt-in, per-client identity, actual stride, idle work, unknown timing, and lifecycle passed",
);
