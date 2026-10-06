import assert from "node:assert/strict";
import { SeatDeviceLeases } from "./seat";

const calls: string[] = [];
let next = 10;
const seat = new SeatDeviceLeases({
  open(path) {
    calls.push(`open:${path}`);
    return { id: next, fd: next++ };
  },
  close(id) {
    calls.push(`close:${id}`);
  },
  closeSeat() {
    calls.push("seat-close");
  },
});
assert.throws(() => seat.open("/dev/dri/card0"), /not active/);
seat.enable();
const drm = seat.open("/dev/dri/card0");
const input = seat.open("/dev/input/event0");
seat.disable();
assert.throws(() => seat.open("/dev/input/event1"), /not active/);
seat.close(input);
assert.throws(() => seat.close(input), /not owned/);
seat.shutdown();
seat.shutdown();
assert.deepEqual(calls, [
  "open:/dev/dri/card0",
  "open:/dev/input/event0",
  "close:11",
  "close:10",
  "seat-close",
]);
assert.throws(() => seat.enable(), /closed/);
assert.throws(() => seat.close(drm), /not owned/);
const failing = new SeatDeviceLeases({
  open() {
    return { id: 1, fd: 1 };
  },
  close() {
    throw new Error("device release failed");
  },
  closeSeat() {
    calls.push("failed-seat-close");
  },
});
failing.enable();
failing.open("/dev/dri/card0");
assert.throws(() => failing.shutdown(), AggregateError);
assert.equal(calls.at(-1), "failed-seat-close");
console.log(
  "ok seat admission, revocation, exact descriptor ownership, idempotent shutdown and failed-release propagation",
);
