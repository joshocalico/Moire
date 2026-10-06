import assert from "node:assert/strict";
import {
  createScrollTrace,
  isScrollPointerEvent,
  type ScrollTraceEvent,
  type ScrollTraceRecord,
} from "./scroll-trace";

const raw = (type: number, code: number, value = 1): ScrollTraceEvent => ({
  stage: "raw",
  device: "/dev/input/event-test",
  type,
  code,
  value,
  timeMs: 42,
});
for (const code of [0, 1, 8, 11]) assert(isScrollPointerEvent(2, code));
for (const code of [0, 1]) assert(isScrollPointerEvent(3, code));
for (const code of [0, 3]) assert(isScrollPointerEvent(0, code));
for (const code of [30, 108, 272]) assert(!isScrollPointerEvent(1, code));
assert(!isScrollPointerEvent(2, 6));
const silent: object[] = [];
const disabled = createScrollTrace({ enabled: false, emit: (event) => silent.push(event) });
disabled.write(raw(2, 8));
assert.deepEqual(silent, []);
let now = 0;
const records: ScrollTraceRecord[] = [];
const trace = createScrollTrace({
  enabled: true,
  now: () => now,
  emit: (event) => records.push(event),
});
for (let n = 0; n < 30; n++) trace.write(raw(3, 0, n));
trace.write(raw(1, 30));
assert.equal(records.length, 0, "no output or keys before explicit wheel arm");
trace.write(raw(2, 11));
assert.equal(records.length, 2);
const start = records[0]!;
assert.equal(start.stage, "start");
assert(start.stage === "start");
assert.equal(start.context.length, 16);
trace.write({ stage: "axis", value: -1, timeMs: 42, x: 1, y: 2 });
trace.write({ stage: "route", popupBlocksShell: false, consumed: false, x: 1, y: 2 });
const routed = records[3]!;
assert("sequence" in routed);
assert.equal(routed.sequence, 3);
trace.write(raw(1, 272));
assert.equal(records.length, 4, "button and key payloads remain excluded after arm");
now = 120000;
trace.write(raw(2, 8));
const deadline = records.at(-1)!;
assert(deadline.stage === "end");
assert.equal(deadline.reason, "deadline");
const endCount = records.length;
now = 0;
trace.write(raw(2, 8));
assert.equal(records.length, endCount, "trace cannot rearm");
const limited: ScrollTraceRecord[] = [];
const budget = createScrollTrace({
  enabled: true,
  now: () => 0,
  emit: (event) => limited.push(event),
});
budget.write(raw(2, 8));
for (let n = 0; n < 600; n++)
  budget.write({ stage: "route", popupBlocksShell: false, consumed: true, x: 1, y: 2 });
const limit = limited.at(-1)!;
assert(limit.stage === "end");
assert.equal(limit.reason, "record-limit");
assert.equal(limited.filter((event) => "sequence" in event).length, 512);
console.log(
  "[scroll-trace] default off, raw pointer allowlist/no keys, bounded cached context, same-process sequence, deadline and permanent record limit passed",
);

const throwing = createScrollTrace({
  enabled: true,
  emit() {
    throw new Error("fixture sink failure");
  },
});
assert.doesNotThrow(() => throwing.write(raw(2, 8)));
assert.equal(throwing.active(), false, "failed diagnostic sink permanently disables trace");
const wheelBudget: ScrollTraceRecord[] = [];
const wheels = createScrollTrace({ enabled: true, now: () => 0, emit: (r) => wheelBudget.push(r) });
for (let n = 0; n < 150; n++) wheels.write(raw(2, 8));
const wheelEnd = wheelBudget.at(-1)!;
assert(wheelEnd.stage === "end" && wheelEnd.reason === "wheel-limit");
assert.equal(wheelEnd.wheelRecords, 128);
assert.equal(wheelBudget.filter((r) => "sequence" in r).length, 128);
assert.equal(wheels.active(), false);
let activityClock = 0;
const idleDeadline = createScrollTrace({ enabled: true, now: () => activityClock, emit() {} });
idleDeadline.write(raw(2, 8));
activityClock = 120000;
assert.equal(
  idleDeadline.write.active(),
  false,
  "observer stops checksum work at deadline without another wheel",
);
console.log(
  "[scroll-trace] throwing sink never interrupts input; capped wheel records and observer activity passed",
);
