import assert from "node:assert/strict";
import {
  ReadbackScanoutPool,
  ScanoutPresenter,
  packScanoutPixels,
  pageFlipFeedback,
  type PageFlipQueueResult,
} from "./scanout-presentation";

// Actual C13 virtio-gpu payload: zero counters and sampled monotonic times.
const feedback = pageFlipFeedback(0, 115, 223532);
for (const sequences of [
  [0, 0, 0],
  [9, 9, 10],
  [17, 18, 19],
  [0xffffffff, 0, 1],
]) {
  const microseconds = [223532, 260370, 291624];
  for (let index = 0; index < sequences.length; index++) {
    const decoded = pageFlipFeedback(sequences[index]!, 115, microseconds[index]!);
    assert.deepEqual(decoded, {
      sequence: sequences[index],
      seconds: 115,
      nanoseconds: microseconds[index]! * 1_000,
      vsync: false,
      hardwareClock: false,
      hardwareCompletion: false,
    });
  }
}

function fixture() {
  const queues: { framebuffer: number; token: number }[] = [];
  const modesets: number[] = [];
  const timers = new Set<() => void>();
  let queueResult: PageFlipQueueResult = { kind: "queued" };
  let modesetFailure: Error | null = null;
  const presenter = new ScanoutPresenter(
    10,
    {
      queue: (framebuffer, token) => {
        queues.push({ framebuffer, token });
        return queueResult;
      },
      setFramebuffer: (framebuffer) => {
        if (modesetFailure) throw modesetFailure;
        modesets.push(framebuffer);
      },
    },
    {
      schedule: (callback) => {
        timers.add(callback);
        return () => timers.delete(callback);
      },
    },
  );
  return {
    presenter,
    queues,
    modesets,
    timers,
    queueResult: (result: PageFlipQueueResult) => (queueResult = result),
    failModeset: () => (modesetFailure = new Error("modeset rejected")),
    timeout: () => {
      for (const callback of timers) callback();
    },
  };
}

// Actual write oracle: no backing allocation can be touched while active or queued.
const f = fixture();
const pixels = new Map([
  [10, new Uint8Array(32)],
  [20, new Uint8Array(32)],
]);
const write = (framebuffer: number, value: number) => {
  assert.equal(
    f.presenter.canWrite(framebuffer),
    true,
    `write to owned framebuffer ${framebuffer}`,
  );
  pixels.get(framebuffer)?.fill(value);
};
assert.equal(f.presenter.canWrite(10), false);
write(20, 1);
let pending = f.presenter.present(20);
assert.equal(f.presenter.status, "queued");
assert.equal(f.presenter.canWrite(10), false);
assert.equal(f.presenter.canWrite(20), false);
assert.equal(f.presenter.canRetire(10), false);
assert.equal(f.presenter.canRetire(20), false);
assert.equal(f.presenter.canRetire(30), true);
await assert.rejects(f.presenter.present(10), /not idle/);
assert.equal(f.presenter.complete(999, feedback), false);
assert.equal(f.presenter.complete(f.queues[0]!.token, feedback), true);
assert.deepEqual(await pending, feedback);
assert.equal(f.presenter.usesPageFlips, true, "timing flags changed completion transport");
assert.equal(f.presenter.canWrite(10), true);
assert.equal(f.presenter.canWrite(20), false);
assert.equal(f.presenter.canRetire(10), true);
write(10, 2);
pending = f.presenter.present(10);
const timedOut = assert.rejects(pending, /timed out/);
f.timeout();
await timedOut;
assert.equal(f.presenter.status, "quarantined");
assert.equal(f.presenter.canWrite(10), false);
assert.equal(f.presenter.canWrite(20), false);
assert.equal(f.presenter.canRetire(10), false);
assert.equal(f.presenter.canRetire(20), false);
await assert.rejects(f.presenter.present(20), /not idle/);
assert.equal(f.queues.length, 2, "timeout allowed another kernel queue");
let recovered = 0;
f.presenter.setAvailableCallback(() => recovered++);
assert.equal(f.presenter.complete(f.queues[1]!.token, feedback), true);
assert.equal(recovered, 1);
assert.equal(f.presenter.canWrite(20), true);
assert.equal(f.presenter.canWrite(10), false);

// Confirmed modeset retires old ownership; stale events cannot complete the new queue.
pending = f.presenter.present(20);
const cancelled = assert.rejects(pending, /confirmed modeset/);
const staleToken = f.queues[2]!.token;
f.presenter.confirmHandoff(30);
await cancelled;
pending = f.presenter.present(10);
assert.equal(f.presenter.complete(staleToken, feedback), false);
assert.equal(f.presenter.status, "queued");
assert.equal(f.presenter.complete(f.queues[3]!.token, feedback), true);
await pending;
assert.equal(f.timers.size, 0);

// Unsupported flips still switch between idle allocations, with honest timing flags.
const fallback = fixture();
fallback.queueResult({ kind: "unsupported" });
const fallbackFeedback = await fallback.presenter.present(20);
assert.equal(fallbackFeedback.vsync, false);
assert.equal(fallbackFeedback.hardwareCompletion, false);
assert.equal(fallbackFeedback.hardwareClock, false);
assert.equal(fallback.presenter.usesPageFlips, false);
assert.equal(fallback.presenter.canWrite(20), false);
assert.equal(fallback.presenter.canWrite(10), true);
await fallback.presenter.present(10);
assert.deepEqual(fallback.modesets, [20, 10]);
assert.equal(fallback.queues.length, 1, "unsupported driver is repeatedly probed");
fallback.failModeset();
await assert.rejects(fallback.presenter.present(20), /modeset rejected/);
assert.equal(fallback.presenter.status, "quarantined");
assert.equal(fallback.presenter.canWrite(10), false);
assert.equal(fallback.presenter.canWrite(20), false);

const failed = fixture();
failed.queueResult({ kind: "failed", error: new Error("kernel busy") });
await assert.rejects(failed.presenter.present(20), /kernel busy/);
assert.equal(failed.presenter.status, "quarantined");
assert.deepEqual(failed.modesets, [], "ambiguous queue failure used modeset fallback");
failed.presenter.confirmHandoff(30);
assert.equal(failed.presenter.canWrite(10), true);

const closing = fixture();
pending = closing.presenter.present(20);
const closed = assert.rejects(pending, /closed/);
closing.presenter.close();
closing.presenter.close();
await closed;
assert.equal(closing.timers.size, 0);
assert.equal(closing.presenter.canWrite(20), false);
assert.equal(closing.presenter.canRetire(10), true);
assert.equal(closing.presenter.canRetire(20), true);
assert.equal(closing.presenter.complete(closing.queues[0]!.token, feedback), false);

const cpu = fixture();
const storage = new Map([[10, new Uint8Array([0, 0, 0, 0])]]);
const copies: number[] = [];
const destroyed: number[] = [];
const pool = new ReadbackScanoutPool({ fbId: 10 }, cpu.presenter, {
  allocate: () => {
    storage.set(20, new Uint8Array(4));
    return { fbId: 20 };
  },
  copy: (frame, data) => {
    assert.equal(cpu.presenter.canWrite(frame.fbId), true);
    storage.get(frame.fbId)?.set(data);
    copies.push(frame.fbId);
  },
  destroy: (frame) => destroyed.push(frame.fbId),
});
let target = pool.write(new Uint8Array([1, 2, 3, 4]));
assert.equal(target, 20);
assert.deepEqual(storage.get(10), new Uint8Array(4), "readback touched active dumb buffer");
pending = cpu.presenter.present(target);
assert.throws(() => pool.write(new Uint8Array(4)), /queued/);
assert.throws(() => pool.destroy(), /Cannot retire/);
cpu.presenter.complete(cpu.queues[0]!.token, feedback);
await pending;
target = pool.write(new Uint8Array([5, 6, 7, 8]));
assert.equal(target, 10);
assert.deepEqual(storage.get(20), new Uint8Array([1, 2, 3, 4]));
pending = cpu.presenter.present(target);
const cpuTimeout = assert.rejects(pending, /timed out/);
cpu.timeout();
await cpuTimeout;
assert.throws(() => pool.write(new Uint8Array(4)), /quarantined/);
assert.throws(() => pool.reset({ fbId: 30 }), /Cannot retire/);
assert.deepEqual(copies, [20, 10]);
let repaintLatest = false;
cpu.presenter.setAvailableCallback(() => (repaintLatest = true));
cpu.presenter.complete(cpu.queues[1]!.token, feedback);
assert.equal(repaintLatest, true, "late completion did not request latest scene repaint");
const latest = new Uint8Array([9, 10, 11, 12]);
target = pool.write(latest);
assert.equal(target, 20);
assert.deepEqual(
  storage.get(10),
  new Uint8Array([5, 6, 7, 8]),
  "recovery overwrote active scanout",
);
assert.deepEqual(storage.get(20), latest, "recovery lost scene updated during quarantine");
cpu.presenter.confirmHandoff(30);
pool.reset({ fbId: 30 });
pool.destroy();
pool.destroy();
assert.deepEqual(destroyed, [20]);

const padded = packScanoutPixels(new Uint8Array([1, 2, 3, 4, 99, 99, 5, 6, 7, 8]), 1, 2, 6, 8, 16);
assert.deepEqual(padded, new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0, 5, 6, 7, 8, 0, 0, 0, 0]));
assert.throws(() => packScanoutPixels(new Uint8Array(4), 1, 2, 4, 4, 8), /Invalid/);
console.log(
  "scanout ownership: active/queued/retired, timeout recovery, fallback, modeset and cleanup passed",
);
