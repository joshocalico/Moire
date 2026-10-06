import assert from "node:assert/strict";
import { createFrameBaseline, type BaselineIdentity } from "./frame-baseline";
import type { UiFrameEvent } from "./platform";

const identity: BaselineIdentity = {
  appId: "org.moire.BaselineFixture",
  clientPid: 123,
  surfaceId: 7,
  renderer: "Fixture renderer (not hardware evidence)",
  transport: "retained-egl-dmabuf",
  capabilities: ["wp_presentation", "zwp_linux_dmabuf_v1"],
};
assert.equal(createFrameBaseline({ enabled: false, identity }), null);
const metrics = createFrameBaseline({ enabled: true, identity, measuredTransfers: ["cpuCopy"] })!;
assert.equal(metrics.snapshot().transfers.textureUpload, null, "unmeasured is not zero");
assert.deepEqual(metrics.snapshot().transfers.cpuCopy, { count: 0, bytes: 0 });
assert.equal(metrics.snapshot().gpuExecutionMs, null);

// Instrument a real padded-plane copy. Import/map refer to 96 bytes, while
// copy/upload transfer only 64 bytes of pixels; adding them is meaningless.
const width = 8,
  height = 2,
  stride = 48;
const plane = new Uint8Array(stride * height).fill(0xee);
for (let row = 0; row < height; row++) plane.fill(row + 1, row * stride, row * stride + width * 4);
metrics.transfer("dmabufImport", plane.byteLength);
metrics.transfer("cpuMap", plane.byteLength);
const tight = new Uint8Array(width * height * 4);
for (let row = 0; row < height; row++)
  tight.set(plane.subarray(row * stride, row * stride + width * 4), row * width * 4);
metrics.transfer("cpuCopy", tight.byteLength);
metrics.transfer("textureUpload", tight.byteLength);
assert.ok(!tight.includes(0xee), "padding was counted/copied as pixels");
assert.deepEqual([...tight], [...new Uint8Array(32).fill(1), ...new Uint8Array(32).fill(2)]);
// A cached import/texture reused on frame two adds no import or upload event.
metrics.transfer("cpuMap", plane.byteLength);
metrics.transfer("cpuCopy", tight.byteLength);
metrics.transfer("gpuReadback", tight.byteLength);
assert.deepEqual(metrics.snapshot().transfers, {
  dmabufImport: { count: 1, bytes: 96 },
  cpuMap: { count: 2, bytes: 192 },
  gpuReadback: { count: 1, bytes: 64 },
  cpuCopy: { count: 2, bytes: 128 },
  textureUpload: { count: 1, bytes: 64 },
});

const submitted = (commitId: number, submittedAtMs: number): UiFrameEvent => ({
  type: "submitted",
  commitId,
  submittedAtMs,
  transport: "dmabuf",
  copyMs: 0,
  damagedPixels: 16,
  totalPixels: 16,
});
const released = (commitId: number, receivedAtMs: number): UiFrameEvent => ({
  type: "buffer-release",
  commitId,
  receivedAtMs,
  transport: "dmabuf",
  latencyMs: 999,
});
// Presentation's timestamp is in a distinct clock epoch. Only its differences
// determine cadence; receipt/hold measurements use submittedAt/receivedAt.
const presentationEpoch = 9_000_000_000_000_000_000n;
const presented = (commitId: number, receivedAtMs: number, timestampNs: bigint): UiFrameEvent => ({
  type: "presented",
  commitId,
  receivedAtMs,
  timestampNs,
  refreshNs: 16_666_667,
  sequence: BigInt(commitId),
  flags: 0,
});
metrics.observeFrame(submitted(1, 100));
metrics.observeFrame({
  type: "compositor-frame",
  commitId: 1,
  timestampMs: 55_000,
  receivedAtMs: 104,
});
assert.equal(metrics.snapshot().trackedHeldCommits, 1, "frame callback released a buffer");
metrics.observeFrame(released(1, 106));
metrics.observeFrame(presented(1, 110, presentationEpoch));
assert.equal(
  metrics.snapshot().bufferHoldMs?.totalMs,
  6,
  "release field/cross-clock value replaced actual hold time",
);
assert.equal(metrics.snapshot().presentationReceiptLatencyMs?.totalMs, 10);
metrics.observeFrame(submitted(2, 114));
metrics.observeFrame({ type: "discarded", commitId: 2, receivedAtMs: 120 });
assert.equal(metrics.snapshot().trackedHeldCommits, 1, "discard feedback released a held buffer");
metrics.observeFrame(released(2, 126));
metrics.observeFrame(submitted(3, 130));
metrics.observeFrame(presented(3, 145, presentationEpoch + 16_666_667n));
metrics.observeFrame(released(3, 150));
metrics.observeFrame(released(3, 151));
assert.deepEqual(metrics.snapshot().frames, {
  submitted: 3,
  compositorCallbacks: 1,
  presented: 2,
  discarded: 1,
  releases: 4,
});
assert.equal(metrics.snapshot().trackedHeldCommits, 0);
assert.equal(metrics.snapshot().unmatchedReleases, 1);
assert.equal(metrics.snapshot().bufferHoldMs?.count, 3);
assert.equal(metrics.snapshot().bufferHoldMs?.totalMs, 38);
assert.equal(metrics.snapshot().presentationCadenceMs?.recentP50Ms, 16.666667);

metrics.cpuElapsed("submit", 12);
metrics.cpuElapsed("completionWait", 9);
assert.equal(
  metrics.snapshot().gpuExecutionMs,
  null,
  "glFinish/CPU elapsed was reported as GPU execution",
);
metrics.gpuTimerQuery({ source: "gl-timer-query", nanoseconds: 8_000_000, disjoint: true });
assert.equal(metrics.snapshot().gpuExecutionMs, null, "disjoint query contaminated GPU timing");
metrics.gpuTimerQuery({ source: "gl-timer-query", nanoseconds: 2_000_000, disjoint: false });
assert.equal(metrics.snapshot().gpuExecutionMs?.totalMs, 2);
assert.equal(metrics.snapshot().cpuElapsedMs.completionWait?.totalMs, 9);
assert.equal(metrics.snapshot().rejectedGpuQueries, 1);

// The diagnostic cannot retain an unbounded history if feedback is absent.
const bounded = createFrameBaseline({ enabled: true, identity, maxTrackedCommits: 2 })!;
bounded.observeFrame(submitted(1, 10));
assert.throws(() => bounded.observeFrame(submitted(1, 11)), /Duplicate/);
bounded.observeFrame(submitted(2, 20));
bounded.observeFrame(submitted(3, 30));
bounded.observeFrame(released(1, 40));
assert.equal(bounded.snapshot().droppedCommitRecords, 1);
assert.equal(bounded.snapshot().unmatchedReleases, 1);
assert.equal(bounded.snapshot().trackedHeldCommits, 2);
for (let sample = 1; sample <= 300; sample++) bounded.cpuElapsed("submit", sample);
assert.equal(bounded.snapshot().cpuElapsedMs.submit?.count, 300);
assert.equal(bounded.snapshot().cpuElapsedMs.submit?.totalMs, 45_150);
assert.equal(bounded.snapshot().cpuElapsedMs.submit?.recentSampleCount, 256);
assert.equal(bounded.snapshot().cpuElapsedMs.submit?.recentP95Ms, 288);
const untouched = createFrameBaseline({ enabled: true, identity })!;
assert.equal(untouched.snapshot().frames.submitted, 0, "clients shared accumulator state");
const detached = metrics.snapshot();
detached.identity.capabilities.push("fake");
detached.transfers.cpuCopy!.bytes = 0;
assert.ok(!metrics.snapshot().identity.capabilities.includes("fake"));
assert.equal(metrics.snapshot().transfers.cpuCopy?.bytes, 128);
assert.throws(() => metrics.transfer("cpuCopy", -1), RangeError);
assert.throws(() => metrics.cpuElapsed("submit", Number.NaN), RangeError);
assert.throws(
  () => metrics.gpuTimerQuery({ source: "gl-timer-query", nanoseconds: -1, disjoint: false }),
  RangeError,
);
assert.doesNotThrow(
  () => JSON.stringify(metrics.snapshot()),
  "baseline record is not JSON serializable",
);
console.log(
  "[ui/frame-baseline] opt-in isolation, padded transfer bytes/cache reuse, timing clocks, held/released buffers and bounded summaries passed",
);
