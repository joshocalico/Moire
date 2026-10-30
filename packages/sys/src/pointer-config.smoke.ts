/** Pointer device config in the evdev reader: classification, acceleration, buttons, scroll. */
import assert from "node:assert/strict";
import { EvdevPointer, type PointerDeviceIo } from "./evdev-pointer";
import {
  classifyPointerDevice,
  createPointerAccelerator,
  MiddleButtonEmulator,
  parseSysfsBitmap,
  pointerAccelFactor,
  type ButtonTimers,
  type PointerDeviceConfigTarget,
} from "./pointer-config";

let cases = 0;
function pass(name: string): void {
  cases++;
  console.log(`PASS ${name}`);
}

// sysfs bitmaps: most significant word first.
{
  const bits = parseSysfsBitmap("1 0 8000000000000003");
  assert.equal(bits(0), true);
  assert.equal(bits(1), true);
  assert.equal(bits(2), false);
  assert.equal(bits(63), true);
  assert.equal(bits(64), false);
  assert.equal(bits(128), true);
  assert.equal(bits(500), false);
  const touchpad = classifyPointerDevice("/dev/input/event7", {
    name: "SynPS/2 Synaptics TouchPad\n",
    rel: "0",
    // ABS_X, ABS_Y, ABS_PRESSURE, ABS_MT_SLOT.., ABS_MT_POSITION_X (0x35)
    abs: "660800001000003",
    // BTN_LEFT/RIGHT/MIDDLE (0x110..) and BTN_TOOL_FINGER (0x145) in the third word
    key: "e520 30000 0 0 0 0",
    properties: "5",
  });
  assert.deepEqual(touchpad, {
    path: "/dev/input/event7",
    name: "SynPS/2 Synaptics TouchPad",
    kind: "touchpad",
    relative: false,
  });
  const mouse = classifyPointerDevice("/dev/input/event3", {
    name: "Logitech USB Mouse",
    rel: "1943",
    abs: "0",
    key: "1f0000 0 0 0 0",
    properties: "0",
  });
  assert.equal(mouse.kind, "mouse");
  assert.equal(mouse.relative, true);
  const tablet = classifyPointerDevice("/dev/input/event2", {
    name: "QEMU Virtio Tablet",
    rel: "100",
    abs: "3",
    key: "70000 0 0 0 0",
  });
  assert.equal(tablet.kind, "mouse");
  assert.equal(tablet.relative, false, "wheel-only REL is not relative motion");
  assert.equal(classifyPointerDevice("/fixture/mouse", {}).relative, true, "unknown → mouse");
}
pass("sysfs capabilities classify touchpads, mice and absolute tablets");

{
  assert.equal(pointerAccelFactor("flat", 0, 5), 1);
  assert.equal(pointerAccelFactor("flat", 0.5, 0.1), 1.5);
  assert.equal(pointerAccelFactor("flat", -1, 1), 0.1, "slowest still moves");
  assert.equal(pointerAccelFactor("adaptive", 0, 0.2), 1, "slow motion is 1:1 at speed 0");
  assert.ok(pointerAccelFactor("adaptive", 0, 2) > 1.2, "fast motion accelerates");
  assert.ok(pointerAccelFactor("adaptive", 0, 100) <= 1.5, "gain is capped");
  assert.ok(pointerAccelFactor("adaptive", 1, 0.2) > pointerAccelFactor("adaptive", 0, 0.2));
  assert.ok(pointerAccelFactor("adaptive", -1, 0.2) < 1);
  // Remainders accumulate: ten 1-unit moves at half speed give five units, not zero.
  const slow = createPointerAccelerator("flat", -0.5);
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += slow.filter(1, 0, i * 10).dx;
  assert.equal(sum, 5);
}
pass("flat and adaptive acceleration with sub-unit remainders");

{
  type Timer = { callback: () => void; cleared: boolean };
  const pending: Timer[] = [];
  const timers: ButtonTimers = {
    setTimeout: (callback) => {
      const timer = { callback, cleared: false };
      pending.push(timer);
      return timer;
    },
    clearTimeout: (handle) => {
      (handle as Timer).cleared = true;
    },
  };
  const fire = () => {
    for (const timer of pending.splice(0)) if (!timer.cleared) timer.callback();
  };
  const out: [number, number][] = [];
  const middle = new MiddleButtonEmulator((code, value) => out.push([code, value]), timers);
  // Left then right inside the window: one middle click.
  middle.button(0x110, 1, 0);
  middle.button(0x111, 1, 10);
  middle.button(0x110, 0, 20);
  middle.button(0x111, 0, 30);
  assert.deepEqual(out, [
    [0x112, 1],
    [0x112, 0],
  ]);
  fire();
  out.length = 0;
  // A lone left click is delivered once the window passes, in order.
  middle.button(0x110, 1, 100);
  assert.deepEqual(out, []);
  fire();
  middle.button(0x110, 0, 200);
  assert.deepEqual(out, [
    [0x110, 1],
    [0x110, 0],
  ]);
  out.length = 0;
  // A quick click inside the window is not lost or reordered.
  middle.button(0x111, 1, 300);
  middle.button(0x111, 0, 310);
  assert.deepEqual(out, [
    [0x111, 1],
    [0x111, 0],
  ]);
  out.length = 0;
  // Flush (motion) releases a held-back press immediately.
  middle.button(0x110, 1, 400);
  middle.flush();
  middle.button(0x111, 1, 410);
  middle.button(0x111, 0, 420);
  middle.button(0x110, 0, 430);
  assert.deepEqual(out, [
    [0x110, 1],
    [0x111, 1],
    [0x111, 0],
    [0x110, 0],
  ]);
  fire();
}
pass("middle-button emulation: chord, lone press, quick click, flush");

// The evdev reader end to end with a fake device.
function record(type: number, code: number, value: number, ms = 0): Buffer {
  const buffer = Buffer.alloc(24);
  buffer.writeBigUInt64LE(BigInt(Math.floor(ms / 1000)), 0);
  buffer.writeBigUInt64LE(BigInt((ms % 1000) * 1000), 8);
  buffer.writeUInt16LE(type, 16);
  buffer.writeUInt16LE(code, 18);
  buffer.writeInt32LE(value, 20);
  return buffer;
}
{
  let queued = Buffer.alloc(0);
  const ready: (() => void)[] = [];
  const io: PointerDeviceIo = {
    open: () => 40,
    read: (_fd, buffer) => {
      if (queued.length === 0) {
        const error = new Error("again") as NodeJS.ErrnoException;
        error.code = "EAGAIN";
        throw error;
      }
      const n = Math.min(buffer.length, queued.length);
      queued.copy(buffer, 0, 0, n);
      queued = queued.subarray(n);
      return n;
    },
    close: () => {},
    identity: () => "fixture",
    grab: () => {},
    describe: (path) => ({ path, name: "Fixture mouse", kind: "mouse", relative: true }),
  };
  const pointer = new EvdevPointer({ add: (_fd, cb) => ready.push(cb), remove: () => {} }, io);
  const devices: PointerDeviceConfigTarget[] = [];
  pointer.on("device", (target: PointerDeviceConfigTarget) => devices.push(target));
  const events: [string, unknown][] = [];
  for (const name of ["motion", "button", "axis"])
    pointer.on(name, (event: { dx?: number; code?: number; value?: number }) =>
      events.push([
        name,
        name === "motion" ? event.dx : name === "button" ? [event.code, event.value] : event.value,
      ]),
    );
  pointer.start(["/dev/input/event9"]);
  assert.equal(devices.length, 1, "device announced on add for config");
  assert.equal(devices[0]!.supports("tap"), false, "evdev has no touchpad driver");
  const feed = (...records: Buffer[]) => {
    queued = Buffer.concat(records);
    for (const callback of ready) callback();
  };
  feed(record(2, 8, 1, 0), record(0, 0, 0, 0), record(1, 0x110, 1, 5), record(1, 0x110, 0, 6));
  assert.deepEqual(events, [
    ["axis", 1],
    ["button", [0x110, 1]],
    ["button", [0x110, 0]],
  ]);
  events.length = 0;
  devices[0]!.set("naturalScroll", true);
  devices[0]!.set("leftHanded", true);
  devices[0]!.set("accelProfile", "flat");
  devices[0]!.set("accelSpeed", 1);
  assert.deepEqual(pointer.configTargets()[0]!.info.name, "Fixture mouse");
  feed(
    record(2, 8, 1, 1000),
    record(0, 0, 0, 1000),
    record(1, 0x110, 1, 1005),
    record(1, 0x110, 0, 1006),
    record(2, 0, 3, 1020),
    record(0, 0, 0, 1020),
  );
  assert.deepEqual(events, [
    ["axis", -1],
    ["button", [0x111, 1]],
    ["button", [0x111, 0]],
    ["motion", 6],
  ]);
  pointer.stop();
}
pass("evdev reader applies natural scroll, left-handed buttons and flat speed per device");

console.log(JSON.stringify({ suite: "pointer device config", cases, deviceAccess: 0 }));
