import assert from "node:assert/strict";
import { EvdevKeyboard, type EvdevKeyEvent } from "./evdev";
import { EvdevPointer, type PointerDeviceIo } from "./evdev-pointer";
import type { KeyboardDeviceIo } from "./keyboard-grab";
import type { InputFixtureTrace, InputFixtureObservation } from "./input-fixture-trace";

function record(type: number, code: number, value: number) {
  const buffer = Buffer.alloc(24);
  buffer.writeBigUInt64LE(1n, 0);
  buffer.writeUInt16LE(type, 16);
  buffer.writeUInt16LE(code, 18);
  buffer.writeInt32LE(value, 20);
  return buffer;
}
function observer(mode: "on" | "inactive" | "throw") {
  const records: { event: InputFixtureObservation; source: number | null }[] = [];
  const links = new WeakMap<object, number>();
  let stops = 0;
  const trace: InputFixtureTrace = {
    active() {
      return mode !== "inactive";
    },
    write(event, source = null) {
      if (mode === "throw") throw new Error("diagnostic sink failure");
      records.push({ event, source });
      return records.length;
    },
    value() {},
    stop() {
      stops++;
    },
    link(event, source) {
      if (source !== null) {
        assert(Number.isInteger(source));
        links.set(event, source);
      }
    },
    sourceOf(event) {
      return links.get(event) ?? null;
    },
  };
  return { trace, records, links, stops: () => stops };
}
function stream() {
  let next = 10;
  const queues = new Map<number, Buffer[]>();
  const callbacks = new Map<number, () => void>();
  const closed: number[] = [];
  const io = {
    open() {
      const fd = next++;
      queues.set(fd, []);
      return fd;
    },
    close(fd: number) {
      closed.push(fd);
      queues.delete(fd);
    },
    identity(fd: number) {
      return String(fd);
    },
    read(fd: number, target: Buffer) {
      const queue = queues.get(fd);
      assert(queue);
      const data = queue.shift();
      if (!data) throw Object.assign(new Error("empty"), { code: "EAGAIN" });
      assert(data.length <= target.length);
      target.set(data);
      return data.length;
    },
    grab() {},
  };
  const readiness = {
    add(fd: number, callback: () => void) {
      callbacks.set(fd, callback);
    },
    remove(fd: number) {
      callbacks.delete(fd);
    },
  };
  const enqueue = (fd: number, bytes: Buffer) => {
    const queue = queues.get(fd);
    assert(queue);
    // Split within input_event and across later records. Poll must retain tails.
    for (let offset = 0; offset < bytes.length; offset += 37)
      queue.push(bytes.subarray(offset, offset + 37));
  };
  const drain = () => {
    for (let pass = 0; pass < 100 && [...queues.values()].some((q) => q.length); pass++)
      for (const callback of callbacks.values()) callback();
    assert([...queues.values()].every((q) => q.length === 0));
  };
  return { io, readiness, enqueue, drain, closed, callbacks };
}
const modes = ["off", "on", "inactive", "throw"] as const;
let keyboardBaseline: EvdevKeyEvent[] | undefined;
let pointerBaseline: { name: string; event: object }[] | undefined;
for (const mode of modes) {
  const f = stream(),
    o = observer(mode === "off" ? "inactive" : mode);
  const keyboardIo: KeyboardDeviceIo = {
    ...f.io,
    keyBits() {
      return Buffer.alloc(96);
    },
    eventBits() {
      return Buffer.alloc(8);
    },
    heldKeyBits() {
      return Buffer.alloc(96);
    },
  };
  const keyboard = new EvdevKeyboard(f.readiness, keyboardIo);
  if (mode !== "off") keyboard.setInputFixtureTrace(o.trace);
  const delivered: EvdevKeyEvent[] = [];
  keyboard.on("key", (event: EvdevKeyEvent) => delivered.push(event));
  keyboard.start(["/fixture/a", "/fixture/b"]);
  const keys = Buffer.concat([
    record(1, 20, 1),
    record(1, 20, 0),
    record(1, 20, 1),
    record(1, 20, 0),
    record(0, 3, 0),
  ]);
  f.enqueue(10, keys);
  f.drain();
  f.enqueue(11, keys);
  f.drain();
  if (!keyboardBaseline) keyboardBaseline = delivered;
  assert.deepEqual(delivered, keyboardBaseline, `${mode}: identical keyboard forwarding`);
  assert.equal(delivered.length, 4, "same-FD rapid edges survive; mirror rejected");
  if (mode === "on") {
    const filters = o.records.filter((r) => r.event.layer === "keyboard-filter");
    assert.equal(filters.length, 8);
    assert.deepEqual(
      filters.map((r) => r.event.layer === "keyboard-filter" && r.event.accepted),
      [true, true, true, true, false, false, false, false],
    );
    assert(
      filters.every(
        (r) => r.source !== null && o.records[(r.source ?? 0) - 1]?.event.layer === "raw-keyboard",
      ),
    );
    assert(
      o.records.some(
        (r) => r.event.layer === "raw-keyboard" && r.event.type === 0 && r.event.code === 3,
      ),
      "overflow marker observed before filtering",
    );
    assert(
      delivered.every((event) => o.links.has(event)),
      "same forwarded objects retain raw ordinal through WeakMap only",
    );
  } else assert.equal(o.records.length, 0);
  assert.equal(o.stops(), mode === "throw" ? 1 : 0);
  keyboard.stop();
  assert.equal(f.closed.length, 2);
  assert.equal(f.callbacks.size, 0);

  const p = stream(),
    po = observer(mode === "off" ? "inactive" : mode);
  const pointerIo: PointerDeviceIo = p.io;
  const pointer = new EvdevPointer(p.readiness, pointerIo);
  if (mode !== "off") pointer.setInputFixtureTrace(po.trace);
  const events: { name: string; event: object }[] = [];
  for (const name of ["absolute", "button", "motion", "axis"])
    pointer.on(name, (event: object) => events.push({ name, event }));
  pointer.start(["/fixture/tablet"]);
  const bytes = Buffer.concat([
    record(3, 0, 1000),
    record(3, 1, 2000),
    record(1, 0x110, 1),
    record(0, 0, 0),
    record(3, 0, 3000),
    record(3, 1, 4000),
    record(1, 0x110, 0),
    record(0, 0, 0),
    record(2, 0, 7),
    record(2, 1, -3),
    record(2, 8, 1),
    record(0, 0, 0),
    record(0, 3, 0),
  ]);
  p.enqueue(10, bytes);
  p.drain();
  if (!pointerBaseline) pointerBaseline = events;
  assert.deepEqual(events, pointerBaseline, `${mode}: identical pointer forwarding`);
  assert.deepEqual(
    events.map((e) => e.name),
    ["absolute", "button", "absolute", "button", "motion", "axis"],
    "position flush precedes both button edges",
  );
  if (mode === "on") {
    assert.equal(po.records.length, 13);
    assert.equal(
      po.records.filter((r) => r.event.layer === "raw-pointer" && r.event.type === 1).length,
      2,
    );
    for (const { name, event } of events) {
      const ordinal = po.links.get(event);
      assert(ordinal);
      const raw = po.records[ordinal - 1]?.event;
      assert(raw && raw.layer === "raw-pointer");
      if (name === "absolute") assert.equal(raw.type, 3);
      if (name === "button") assert.equal(raw.type, 1);
      if (name === "motion") assert(raw.type === 2 && (raw.code === 0 || raw.code === 1));
      if (name === "axis") assert(raw.type === 2 && raw.code === 8);
    }
    assert(
      events.every(({ event }) => po.links.has(event)),
      "all forwarded pointer objects link to observed raw ordinal",
    );
    assert(
      events.every(({ event }) => !Object.hasOwn(event, "sourceSequence")),
      "no production DTO mutation",
    );
  } else assert.equal(po.records.length, 0);
  assert.equal(po.stops(), mode === "throw" ? 1 : 0);
  pointer.stop();
  assert.equal(p.closed.length, 1);
  assert.equal(p.callbacks.size, 0);
}
console.log(
  "[input-fixture/hooks] actual reader partial tails, rapid/mirrored filter, ABS/button order and forwarding off/on/inactive/throw passed",
);
