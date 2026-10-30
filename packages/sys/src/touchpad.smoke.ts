/**
 * The touchpad driver: ioctl encodings, geometry, the protocol B decoder, and the gesture
 * machine (motion, taps, tap-and-drag, scrolling, kinetic coasting, clickpad buttons,
 * disable-while-typing, palms) driven by synthetic streams in the recording format, then the
 * EvdevPointer integration with a fake device. No devices; runs anywhere.
 */
import assert from "node:assert/strict";
import { EvdevPointer, type EvdevPointerAxis, type PointerDeviceIo } from "./evdev-pointer";
import type { PointerDeviceConfigTarget } from "./pointer-config";
import {
  ABS_MT_POSITION_X,
  ABS_MT_POSITION_Y,
  ABS_MT_PRESSURE,
  ABS_MT_SLOT,
  ABS_MT_TOOL_TYPE,
  ABS_MT_TOUCH_MAJOR,
  ABS_MT_TRACKING_ID,
  ABS_X,
  ABS_Y,
  BTN_LEFT,
  BTN_MIDDLE,
  BTN_RIGHT,
  BTN_TOOL_DOUBLETAP,
  BTN_TOOL_FINGER,
  BTN_TOOL_QUADTAP,
  BTN_TOOL_TRIPLETAP,
  BTN_TOUCH,
  EV_ABS,
  EV_KEY,
  EV_SYN,
  INPUT_PROP_BUTTONPAD,
  INPUT_PROP_DIRECT,
  INPUT_PROP_POINTER,
  MT_TOOL_PALM,
  SYN_DROPPED,
  SYN_REPORT,
  eviocgabs,
  eviocgbit,
  eviocgprop,
  touchpadGeometryFrom,
  TouchpadDecoder,
  type AbsInfo,
  type EvdevCapabilities,
  type TouchpadGeometry,
} from "./touchpad-device";
import {
  DWT_TIMEOUT_MS,
  TAP_DRAG_TIMEOUT_MS,
  TAP_TIMEOUT_MS,
  TOUCHPAD_UNITS_PER_MM,
  TouchpadGestures,
  type TouchpadOptions,
  type TouchpadOutput,
} from "./touchpad-gesture";
import {
  formatTouchpadRecording,
  parseTouchpadRecording,
  recordingGeometry,
  replayTouchpadRecording,
  type RecordedEvent,
  type RecordedKey,
  type TouchpadRecording,
} from "./touchpad-recording";

let cases = 0;
function pass(name: string): void {
  cases++;
  console.log(`PASS ${name}`);
}

// ---------------------------------------------------------------------------
// A synthetic pad: 100 × 65 mm at 12 units/mm, five slots, pressure and touch major.
// ---------------------------------------------------------------------------

function bits(size: number, set: readonly number[]): Buffer {
  const out = Buffer.alloc(size);
  for (const bit of set) out[Math.floor(bit / 8)]! |= 1 << (bit % 8);
  return out;
}

type PadSpec = {
  clickpad?: boolean;
  resolution?: number;
  slots?: number;
  direct?: boolean;
  pressure?: boolean;
  major?: boolean;
  tools?: readonly number[];
  buttons?: readonly number[];
};

function padCapabilities(spec: PadSpec = {}): EvdevCapabilities {
  const res = spec.resolution ?? 12;
  const absInfo = new Map<number, AbsInfo>([
    [ABS_X, { minimum: 0, maximum: 100 * res, resolution: res }],
    [ABS_Y, { minimum: 0, maximum: 65 * res, resolution: res }],
    [ABS_MT_SLOT, { minimum: 0, maximum: (spec.slots ?? 5) - 1, resolution: 0 }],
    [ABS_MT_POSITION_X, { minimum: 0, maximum: 100 * res, resolution: res }],
    [ABS_MT_POSITION_Y, { minimum: 0, maximum: 65 * res, resolution: res }],
    [ABS_MT_TRACKING_ID, { minimum: 0, maximum: 65535, resolution: 0 }],
    [ABS_MT_TOOL_TYPE, { minimum: 0, maximum: 2, resolution: 0 }],
  ]);
  if (spec.pressure !== false)
    absInfo.set(ABS_MT_PRESSURE, { minimum: 0, maximum: 255, resolution: 0 });
  if (spec.major !== false)
    absInfo.set(ABS_MT_TOUCH_MAJOR, { minimum: 0, maximum: 1000, resolution: 12 });
  return {
    props: bits(4, [
      INPUT_PROP_POINTER,
      ...(spec.clickpad === false ? [] : [INPUT_PROP_BUTTONPAD]),
      ...(spec.direct ? [INPUT_PROP_DIRECT] : []),
    ]),
    absBits: bits(8, [...absInfo.keys()]),
    keyBits: bits(96, [
      ...(spec.buttons ?? [BTN_LEFT]),
      BTN_TOUCH,
      ...(spec.tools ?? [BTN_TOOL_FINGER, BTN_TOOL_DOUBLETAP, BTN_TOOL_TRIPLETAP, BTN_TOOL_QUADTAP]),
    ]),
    absInfo,
  };
}

function geometryOf(caps: EvdevCapabilities): TouchpadGeometry | null {
  return touchpadGeometryFrom({ ...caps, abs: (code) => caps.absInfo.get(code) ?? null });
}

const TOOLS = [0, BTN_TOOL_FINGER, BTN_TOOL_DOUBLETAP, BTN_TOOL_TRIPLETAP, BTN_TOOL_QUADTAP];

/** Builds a protocol B stream in millimetres, the way a kernel driver would report it. */
class Stream {
  readonly events: RecordedEvent[] = [];
  readonly keys: RecordedKey[] = [];
  t = 1000;
  private active = new Map<number, number>();
  private nextId = 100;
  private tool = 0;
  private slot = -1;
  constructor(
    readonly caps: EvdevCapabilities = padCapabilities(),
    private readonly res = 12,
  ) {}
  private ev(type: number, code: number, value: number): this {
    this.events.push({ timeMs: this.t, type, code, value });
    return this;
  }
  private select(slot: number): void {
    if (this.slot !== slot) this.ev(EV_ABS, ABS_MT_SLOT, slot);
    this.slot = slot;
  }
  down(slot: number, x: number, y: number, extra: { pressure?: number; major?: number } = {}) {
    this.select(slot);
    const id = this.nextId++;
    this.active.set(slot, id);
    this.ev(EV_ABS, ABS_MT_TRACKING_ID, id);
    this.ev(EV_ABS, ABS_MT_POSITION_X, Math.round(x * this.res));
    this.ev(EV_ABS, ABS_MT_POSITION_Y, Math.round(y * this.res));
    this.ev(EV_ABS, ABS_MT_PRESSURE, extra.pressure ?? 40);
    this.ev(EV_ABS, ABS_MT_TOUCH_MAJOR, extra.major ?? 96);
    return this;
  }
  move(slot: number, x: number, y: number) {
    this.select(slot);
    this.ev(EV_ABS, ABS_MT_POSITION_X, Math.round(x * this.res));
    this.ev(EV_ABS, ABS_MT_POSITION_Y, Math.round(y * this.res));
    return this;
  }
  set(slot: number, code: number, value: number) {
    this.select(slot);
    return this.ev(EV_ABS, code, value);
  }
  up(slot: number) {
    this.select(slot);
    this.active.delete(slot);
    return this.ev(EV_ABS, ABS_MT_TRACKING_ID, -1);
  }
  button(code: number, value: number) {
    return this.ev(EV_KEY, code, value);
  }
  /** SYN_REPORT, with BTN_TOUCH and BTN_TOOL_* following the contact count; then advance. */
  sync(advanceMs = 10, fingers = this.active.size) {
    const tool = Math.min(4, fingers);
    if (tool !== this.tool) {
      if (this.tool) this.ev(EV_KEY, TOOLS[this.tool]!, 0);
      if (tool) this.ev(EV_KEY, TOOLS[tool]!, 1);
      if (!this.tool !== !tool) this.ev(EV_KEY, BTN_TOUCH, tool ? 1 : 0);
      this.tool = tool;
    }
    this.ev(EV_SYN, SYN_REPORT, 0);
    this.t += advanceMs;
    return this;
  }
  wait(ms: number) {
    this.t += ms;
    return this;
  }
  key(code: number, value = 1) {
    this.keys.push({ timeMs: this.t, code, value });
    return this;
  }
  /** One finger sliding from (x0,y0) by (dx,dy) over `steps` frames. */
  slide(slot: number, x0: number, y0: number, dx: number, dy: number, steps = 10, frameMs = 10) {
    for (let i = 1; i <= steps; i++)
      this.move(slot, x0 + (dx * i) / steps, y0 + (dy * i) / steps).sync(frameMs);
    return this;
  }
  recording(): TouchpadRecording {
    return { name: "Synthetic clickpad", capabilities: this.caps, events: this.events, keys: this.keys };
  }
  run(options: Partial<TouchpadOptions> = {}): TouchpadOutput[] {
    return replayTouchpadRecording(this.recording(), options);
  }
}

const buttons = (out: readonly TouchpadOutput[]) =>
  out.flatMap((o) => (o.kind === "button" ? [`${name(o.code)}${o.value ? "+" : "-"}@${o.timeMs}`] : []));
const name = (code: number) =>
  code === BTN_LEFT ? "L" : code === BTN_RIGHT ? "R" : code === BTN_MIDDLE ? "M" : String(code);
const motion = (out: readonly TouchpadOutput[]) =>
  out.reduce(
    (sum, o) => (o.kind === "motion" ? { dx: sum.dx + o.dx, dy: sum.dy + o.dy, n: sum.n + 1 } : sum),
    { dx: 0, dy: 0, n: 0 },
  );
const scroll = (out: readonly TouchpadOutput[], source?: string) =>
  out.reduce(
    (sum, o) =>
      o.kind === "scroll" && (!source || o.source === source)
        ? { dx: sum.dx + o.dx, dy: sum.dy + o.dy, n: sum.n + 1 }
        : sum,
    { dx: 0, dy: 0, n: 0 },
  );

// ---------------------------------------------------------------------------
// ioctl encodings and geometry
// ---------------------------------------------------------------------------
{
  // <linux/input.h>: EVIOCGPROP(len) _IOC(_IOC_READ, 'E', 0x09, len), EVIOCGABS(abs)
  // _IOR('E', 0x40 + abs, struct input_absinfo), EVIOCGBIT(ev, len) _IOC(_IOC_READ, 'E', 0x20 + ev, len).
  assert.equal(eviocgprop(4), 0x80044509);
  assert.equal(eviocgabs(ABS_MT_POSITION_X), 0x80184575);
  assert.equal(eviocgabs(ABS_X), 0x80184540);
  assert.equal(eviocgbit(EV_ABS, 8), 0x80084523);
  assert.equal(eviocgbit(EV_KEY, 96), 0x80604521, "matches keyboard-grab's EVIOCGBIT_KEYS");
  const pad = geometryOf(padCapabilities())!;
  assert.equal(pad.clickpad, true);
  assert.equal(pad.multitouch, true);
  assert.equal(pad.slots, 5);
  assert.equal(pad.maxFingers, 4);
  assert.equal(pad.x.resolution, 12);
  assert.equal(pad.x.estimated, false);
  assert.ok(pad.pressure && pad.touchMajor);
  const plain = geometryOf(padCapabilities({ clickpad: false, buttons: [BTN_LEFT, BTN_RIGHT] }))!;
  assert.equal(plain.clickpad, false);
  assert.deepEqual(plain.buttons, { left: true, right: true, middle: false });
  assert.equal(geometryOf(padCapabilities({ direct: true })), null, "touch screens are not pads");
  assert.equal(geometryOf(padCapabilities({ tools: [] })), null, "no finger tool: not a pad");
  const unknown = geometryOf(padCapabilities({ resolution: 0 }));
  assert.equal(unknown, null, "zero range with zero resolution is rejected");
  const noRes = padCapabilities();
  for (const code of [ABS_MT_POSITION_X, ABS_MT_POSITION_Y])
    noRes.absInfo.set(code, { minimum: 0, maximum: 3000, resolution: 0 });
  const estimated = geometryOf(noRes)!;
  assert.equal(estimated.x.estimated, true);
  assert.equal(estimated.x.resolution, 30, "assumes a 100 mm wide pad");
  // Single-touch pad: ABS_X/ABS_Y only.
  const single: EvdevCapabilities = {
    props: bits(4, [INPUT_PROP_POINTER]),
    absBits: bits(8, [ABS_X, ABS_Y]),
    keyBits: bits(96, [BTN_LEFT, BTN_TOUCH, BTN_TOOL_FINGER]),
    absInfo: new Map([
      [ABS_X, { minimum: 0, maximum: 1000, resolution: 10 }],
      [ABS_Y, { minimum: 0, maximum: 600, resolution: 10 }],
    ]),
  };
  const st = geometryOf(single)!;
  assert.equal(st.multitouch, false);
  assert.equal(st.slots, 1);
}
pass("ioctl encodings and geometry: clickpads, plain pads, touch screens, missing resolution");

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------
{
  const geometry = geometryOf(padCapabilities())!;
  const decoder = new TouchpadDecoder(geometry);
  const frames: ReturnType<TouchpadDecoder["push"]>[] = [];
  const push = (type: number, code: number, value: number) => {
    const frame = decoder.push(type, code, value, 5);
    if (frame) frames.push(frame);
  };
  push(EV_ABS, ABS_MT_SLOT, 0);
  push(EV_ABS, ABS_MT_TRACKING_ID, 7);
  push(EV_ABS, ABS_MT_POSITION_X, 100);
  push(EV_ABS, ABS_MT_POSITION_Y, 200);
  push(EV_ABS, ABS_MT_SLOT, 1);
  push(EV_ABS, ABS_MT_TRACKING_ID, 8);
  push(EV_ABS, ABS_MT_POSITION_X, 300);
  push(EV_ABS, ABS_MT_POSITION_Y, 400);
  push(EV_ABS, ABS_MT_TOOL_TYPE, MT_TOOL_PALM);
  push(EV_KEY, BTN_TOUCH, 1);
  push(EV_KEY, BTN_TOOL_TRIPLETAP, 1);
  push(EV_SYN, SYN_REPORT, 0);
  assert.equal(frames.length, 1);
  assert.deepEqual(
    frames[0]!.contacts.map((c) => [c.slot, c.id, c.x, c.y, c.palm]),
    [
      [0, 7, 100, 200, false],
      [1, 8, 300, 400, true],
    ],
  );
  assert.equal(frames[0]!.fingers, 3, "BTN_TOOL_TRIPLETAP counts a finger with no slot");
  // Slot 1 lifts; only slot 0's X changes.
  push(EV_ABS, ABS_MT_TRACKING_ID, -1);
  push(EV_ABS, ABS_MT_SLOT, 0);
  push(EV_ABS, ABS_MT_POSITION_X, 110);
  push(EV_KEY, BTN_TOOL_TRIPLETAP, 0);
  push(EV_KEY, BTN_TOOL_FINGER, 1);
  push(EV_SYN, SYN_REPORT, 0);
  assert.deepEqual(
    frames[1]!.contacts.map((c) => [c.id, c.x, c.y]),
    [[7, 110, 200]],
  );
  assert.equal(frames[1]!.fingers, 1);
  // SYN_DROPPED: everything up to the next report is discarded, then all contacts end.
  push(EV_SYN, SYN_DROPPED, 0);
  push(EV_ABS, ABS_MT_POSITION_X, 999);
  push(EV_SYN, SYN_REPORT, 0);
  assert.deepEqual(frames[2]!.contacts, []);
  assert.equal(frames[2]!.fingers, 0);
  // A slot beyond the advertised range is ignored, not grown.
  push(EV_ABS, ABS_MT_SLOT, 40);
  push(EV_ABS, ABS_MT_TRACKING_ID, 9);
  push(EV_SYN, SYN_REPORT, 0);
  assert.deepEqual(frames[3]!.contacts, []);
}
pass("decoder: protocol B slots, palm tool type, extra BTN_TOOL fingers, SYN_DROPPED, bounds");

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------
{
  const slow = new Stream().down(0, 40, 30).sync().slide(0, 40, 30, 10, 0, 50, 20).up(0).sync();
  const out = slow.run({ tap: false });
  const m = motion(out);
  // 10 mm at 0.5 mm/frame and 20 ms/frame: slow, so unaccelerated at speed 0.
  assert.equal(m.dx, 10 * TOUCHPAD_UNITS_PER_MM);
  assert.equal(m.dy, 0);
  // The same physical movement on a pad with double the resolution moves the pointer as far.
  const fine = new Stream(padCapabilities({ resolution: 24 }), 24)
    .down(0, 40, 30)
    .sync()
    .slide(0, 40, 30, 10, 0, 50, 20)
    .up(0)
    .sync();
  assert.equal(motion(fine.run({ tap: false })).dx, m.dx, "resolution-aware");
  // Fast movement accelerates; slower speed setting moves less.
  const fast = new Stream().down(0, 20, 30).sync().slide(0, 20, 30, 40, 0, 10, 10).up(0).sync();
  assert.ok(motion(fast.run({ tap: false })).dx > 40 * TOUCHPAD_UNITS_PER_MM, "accelerated");
  assert.ok(
    motion(slow.run({ tap: false, accelSpeed: -0.5 })).dx < m.dx,
    "a slower speed moves less",
  );
  assert.equal(
    motion(slow.run({ tap: false, accelProfile: "flat", accelSpeed: 0 })).dx,
    m.dx,
    "flat at 0 is 1:1",
  );
  // A finger landing is not a jump: the first frame of a touch never moves the pointer.
  const land = new Stream().down(0, 80, 50).sync().up(0).sync().down(0, 10, 10).sync();
  assert.equal(motion(land.run({ tap: false })).n, 0);
}
pass("motion: mm-normalised, resolution independent, accelerated, no jump on landing");

// ---------------------------------------------------------------------------
// Tapping
// ---------------------------------------------------------------------------
{
  const tap1 = new Stream().down(0, 50, 30).sync(60).up(0).sync();
  const t1 = tap1.events.at(-1)!.timeMs;
  assert.deepEqual(buttons(tap1.run()), [`L+@${t1}`, `L-@${t1 + TAP_DRAG_TIMEOUT_MS}`]);
  assert.deepEqual(buttons(tap1.run({ tap: false })), [], "tapping off");

  const tap2 = new Stream().down(0, 40, 30).sync(15).down(1, 60, 30).sync(60).up(0).sync(10).up(1).sync();
  const t2 = tap2.events.at(-1)!.timeMs;
  assert.deepEqual(buttons(tap2.run()), [`R+@${t2}`, `R-@${t2}`], "two fingers: right, staggered");

  const tap3 = new Stream()
    .down(0, 30, 30)
    .down(1, 50, 30)
    .down(2, 70, 30)
    .sync(50)
    .up(0)
    .up(1)
    .up(2)
    .sync();
  const t3 = tap3.events.at(-1)!.timeMs;
  assert.deepEqual(buttons(tap3.run()), [`M+@${t3}`, `M-@${t3}`], "three fingers: middle");

  // Three fingers on a two-slot pad: the third is only BTN_TOOL_TRIPLETAP.
  const semi = new Stream(padCapabilities({ slots: 2 }))
    .down(0, 40, 30)
    .down(1, 60, 30)
    .sync(50, 3)
    .up(0)
    .up(1)
    .sync(10, 0);
  assert.deepEqual(buttons(semi.run()).map((b) => b.slice(0, 2)), ["M+", "M-"]);

  const long = new Stream().down(0, 50, 30).sync(TAP_TIMEOUT_MS + 20).up(0).sync();
  assert.deepEqual(buttons(long.run()), [], "held too long");
  const moved = new Stream().down(0, 50, 30).sync().move(0, 53, 30).sync().up(0).sync();
  assert.deepEqual(buttons(moved.run()), [], "moved too far");
  const jitter = new Stream().down(0, 50, 30).sync().move(0, 50.5, 30.3).sync().up(0).sync();
  assert.equal(buttons(jitter.run()).length, 2, "sub-threshold jitter is still a tap");
}
pass("tapping: one, two, three fingers (and more fingers than slots), timeouts and travel");

{
  // Tap, then touch again within the window and move: drag with the left button held.
  const drag = new Stream()
    .down(0, 50, 30)
    .sync(50)
    .up(0)
    .sync(80)
    .down(0, 50, 30)
    .sync()
    .slide(0, 50, 30, 15, 0, 10)
    .up(0)
    .sync();
  const out = drag.run();
  const b = buttons(out);
  assert.equal(b.length, 2, b.join());
  assert.ok(b[0]!.startsWith("L+") && b[1]!.startsWith("L-"));
  const press = out.findIndex((o) => o.kind === "button" && o.value === 1);
  const release = out.findIndex((o) => o.kind === "button" && o.value === 0);
  assert.ok(
    out.slice(press, release).some((o) => o.kind === "motion"),
    "motion happens while the button is held",
  );
  assert.equal(release, out.length - 1, "released when the finger lifts");

  // Tap, tap again quickly without moving: a double click.
  const double = new Stream().down(0, 50, 30).sync(50).up(0).sync(60).down(0, 50, 30).sync(50).up(0).sync();
  assert.deepEqual(buttons(double.run()).map((x) => x.slice(0, 2)), ["L+", "L-", "L+", "L-"]);

  // Touch again after the window: two separate clicks, each released by its timer.
  const two = new Stream()
    .down(0, 50, 30)
    .sync(50)
    .up(0)
    .sync(TAP_DRAG_TIMEOUT_MS + 50)
    .down(0, 50, 30)
    .sync(50)
    .up(0)
    .sync();
  assert.deepEqual(buttons(two.run()).map((x) => x.slice(0, 2)), ["L+", "L-", "L+", "L-"]);

  // Two fingers during the drag window end the held click and start a new tap.
  const switched = new Stream()
    .down(0, 50, 30)
    .sync(50)
    .up(0)
    .sync(50)
    .down(0, 40, 30)
    .down(1, 60, 30)
    .sync(50)
    .up(0)
    .up(1)
    .sync();
  assert.deepEqual(buttons(switched.run()).map((x) => x.slice(0, 2)), ["L+", "L-", "R+", "R-"]);
}
pass("tap-and-drag holds the button through motion; double tap; window expiry; finger change");

{
  // Turning tapping off while a tap holds the button releases it.
  const geometry = geometryOf(padCapabilities())!;
  const g = new TouchpadGestures(geometry);
  const frame = (t: number, on: boolean) =>
    g.frame({
      timeMs: t,
      contacts: on ? [{ slot: 0, id: 1, x: 600, y: 300, major: null, pressure: null, palm: false }] : [],
      fingers: on ? 1 : 0,
      buttons: { left: false, right: false, middle: false },
    });
  frame(0, true);
  assert.deepEqual(buttons(frame(50, false)), ["L+@50"]);
  assert.equal(g.tapState, "tapped");
  assert.equal(g.deadline(), 50 + TAP_DRAG_TIMEOUT_MS);
  assert.deepEqual(buttons(g.configure({ tap: false }, 60)), ["L-@60"]);
  assert.equal(g.deadline(), null);
  // reset() releases whatever is held.
  g.configure({ tap: true });
  frame(90, false); // Settles the machine back to idle.
  frame(100, true);
  frame(150, false);
  assert.deepEqual(buttons(g.reset(160)), ["L-@160"]);
  assert.equal(g.tapState, "idle");
}
pass("configure and reset release a held tap button");

// ---------------------------------------------------------------------------
// Scrolling
// ---------------------------------------------------------------------------
function twoFingerSwipe(dy: number, frameMs = 10, steps = 10, liftDelay = 10): Stream {
  const s = new Stream().down(0, 40, 20).down(1, 60, 20).sync();
  for (let i = 1; i <= steps; i++)
    s.move(0, 40, 20 + (dy * i) / steps).move(1, 60, 20 + (dy * i) / steps).sync(frameMs);
  s.wait(liftDelay - 10);
  return s.up(0).up(1).sync();
}
{
  const down = twoFingerSwipe(20, 20, 10, 100);
  const traditional = down.run({ naturalScroll: false, kineticScroll: false });
  const sc = scroll(traditional);
  assert.ok(sc.dy > 0 && sc.dx === 0, `fingers down scroll the view down: ${JSON.stringify(sc)}`);
  assert.ok(Math.abs(sc.dy - 7 * (20 - 1.5)) < 7 * 2.1, "about 7 px per mm after the start");
  assert.equal(motion(traditional).n, 0, "scrolling fingers never move the pointer");
  assert.deepEqual(buttons(traditional), [], "a swipe is not a tap");
  const natural = scroll(down.run({ naturalScroll: true, kineticScroll: false }));
  assert.equal(natural.dy, -sc.dy, "natural scrolling reverses");
  // Horizontal swipe, snapped: no vertical drift from a slightly diagonal swipe.
  const side = new Stream().down(0, 40, 20).down(1, 60, 20).sync();
  for (let i = 1; i <= 10; i++) side.move(0, 40 + 2 * i, 20 + 0.2 * i).move(1, 60 + 2 * i, 20 + 0.2 * i).sync(20);
  const h = scroll(side.up(0).up(1).sync().run({ naturalScroll: false, kineticScroll: false }));
  assert.ok(h.dx > 0 && h.dy === 0, JSON.stringify(h));
  // Scroll method none: two fingers move the pointer instead.
  const none = down.run({ scrollMethod: "none" });
  assert.equal(scroll(none).n, 0);
  assert.ok(motion(none).dy > 0);
}
pass("two-finger scrolling: direction, natural, axis snapping, scroll method none");

{
  const quick = twoFingerSwipe(30, 10, 6, 10);
  const out = quick.run({ naturalScroll: false, kineticScroll: true });
  const coast = out.filter((o) => o.kind === "scroll" && o.source === "kinetic");
  assert.ok(coast.length > 5, `coasts after a flick (${coast.length} frames)`);
  const steps = coast.map((o) => (o.kind === "scroll" ? o.dy : 0));
  assert.ok(steps.every((dy) => dy > 0), "coasts in the swipe's direction");
  assert.ok(steps.every((dy, i) => i === 0 || dy <= steps[i - 1]!), "and slows down");
  assert.equal(scroll(quick.run({ naturalScroll: false, kineticScroll: false }), "kinetic").n, 0);
  // Fingers that stopped before lifting don't coast.
  const stopped = twoFingerSwipe(30, 10, 6, 200);
  assert.equal(scroll(stopped.run({ kineticScroll: true }), "kinetic").n, 0);
  // A finger landing stops coasting.
  const caught = twoFingerSwipe(30, 10, 6, 10).wait(60).down(0, 50, 30).sync(50).up(0).sync();
  const caughtOut = caught.run({ kineticScroll: true });
  const touchAt = caught.events.find((e) => e.type === EV_ABS && e.code === ABS_MT_TRACKING_ID && e.value === 102)!.timeMs;
  assert.ok(
    caughtOut.every((o) => !(o.kind === "scroll" && o.source === "kinetic" && o.timeMs > touchAt)),
    "no coasting after a new touch",
  );
}
pass("kinetic scrolling: coasts and decays after a flick; off, stopped fingers, caught by a touch");

{
  const edge = new Stream(padCapabilities({ clickpad: false }))
    .down(0, 97, 10)
    .sync()
    .slide(0, 97, 10, 0, 20, 10, 20)
    .up(0)
    .sync();
  const out = edge.run({ scrollMethod: "edge", naturalScroll: false });
  const sc = scroll(out, "edge");
  assert.ok(sc.dy > 0 && sc.dx === 0, JSON.stringify(sc));
  assert.equal(motion(out).n, 0, "edge scrolling never moves the pointer");
  const bottom = new Stream(padCapabilities({ clickpad: false }))
    .down(0, 30, 62)
    .sync()
    .slide(0, 30, 62, 20, 0, 10, 20)
    .up(0)
    .sync();
  assert.ok(scroll(bottom.run({ scrollMethod: "edge", naturalScroll: false }), "edge").dx > 0);
  // Edge scrolling off: the same touch is ordinary motion... except the right band is a
  // possible palm on a 100 mm pad, so it only moves once it comes inward.
  const plain = edge.run({ scrollMethod: "two-finger" });
  assert.equal(scroll(plain).n, 0);
  assert.equal(motion(plain).n, 0, "a touch in the side band that stays there is a palm");
  // Two fingers with edge scrolling: no scroll, the pointer moves.
  const two = twoFingerSwipe(20, 20, 10, 100).run({ scrollMethod: "edge" });
  assert.equal(scroll(two).n, 0);
}
pass("edge scrolling: right edge vertical, bottom edge horizontal, no motion");

// ---------------------------------------------------------------------------
// Clickpad buttons
// ---------------------------------------------------------------------------
{
  const click = (fingers: [number, number][], options: Partial<TouchpadOptions>) => {
    const s = new Stream();
    fingers.forEach(([x, y], slot) => s.down(slot, x, y));
    s.sync(200).button(BTN_LEFT, 1).sync(50).button(BTN_LEFT, 0).sync();
    fingers.forEach((_, slot) => s.up(slot));
    return buttons(s.sync().run({ tap: false, ...options })).map((b) => b.slice(0, 2));
  };
  const cf = { clickMethod: "clickfinger" } as const;
  assert.deepEqual(click([[50, 30]], cf), ["L+", "L-"]);
  assert.deepEqual(click([[40, 30], [60, 30]], cf), ["R+", "R-"]);
  assert.deepEqual(click([[30, 30], [50, 30], [70, 30]], cf), ["M+", "M-"]);
  assert.deepEqual(click([[50, 30], [20, 60]], cf), ["L+", "L-"], "a resting thumb is not a finger");
  const areas = { clickMethod: "areas" } as const;
  assert.deepEqual(click([[80, 60]], areas), ["R+", "R-"], "bottom right");
  assert.deepEqual(click([[20, 60]], areas), ["L+", "L-"], "bottom left");
  assert.deepEqual(click([[50, 30]], areas), ["L+", "L-"], "above the button area");
  assert.deepEqual(click([[20, 60], [80, 60]], areas), ["M+", "M-"], "both halves");
  assert.deepEqual(click([[80, 60]], { ...areas, leftHanded: true }), ["L+", "L-"], "left-handed");
  // A real right button on a pad with buttons passes straight through.
  const plain = new Stream(padCapabilities({ clickpad: false, buttons: [BTN_LEFT, BTN_RIGHT] }))
    .down(0, 50, 30)
    .sync()
    .button(BTN_RIGHT, 1)
    .sync()
    .button(BTN_RIGHT, 0)
    .sync()
    .up(0)
    .sync();
  assert.deepEqual(buttons(plain.run({ tap: false })).map((b) => b.slice(0, 2)), ["R+", "R-"]);
  // Clicking while a tap holds the button: the tap releases first, and no extra tap follows.
  const held = new Stream()
    .down(0, 50, 30)
    .sync(50)
    .up(0)
    .sync(50)
    .down(0, 50, 30)
    .button(BTN_LEFT, 1)
    .sync(50)
    .button(BTN_LEFT, 0)
    .up(0)
    .sync();
  assert.deepEqual(buttons(held.run()).map((b) => b.slice(0, 2)), ["L+", "L-", "L+", "L-"]);
  // Thumb on the button area clicking while a finger drags: the finger moves the pointer.
  const thumbDrag = new Stream()
    .down(0, 30, 60)
    .sync()
    .button(BTN_LEFT, 1)
    .down(1, 50, 30)
    .sync()
    .slide(1, 50, 30, 10, 0, 10, 20)
    .button(BTN_LEFT, 0)
    .up(0)
    .up(1)
    .sync();
  const td = thumbDrag.run({ tap: false, clickMethod: "clickfinger" });
  assert.deepEqual(buttons(td).map((b) => b.slice(0, 2)), ["L+", "L-"]);
  assert.ok(motion(td).dx > 0, "the finger drags while the thumb holds the click");
  assert.equal(scroll(td).n, 0, "a resting thumb doesn't make it a two-finger scroll");
}
pass("clickpads: clickfinger, button areas, left-handed, real buttons, tap interplay, thumbs");

// ---------------------------------------------------------------------------
// Disable while typing and palms
// ---------------------------------------------------------------------------
{
  const typed = (gap: number, code = 30) =>
    new Stream().key(code).key(code, 0).wait(gap).down(0, 50, 30).sync(50).slide(0, 50, 30, 10, 0, 5).up(0).sync();
  const during = typed(100).run();
  assert.equal(motion(during).n, 0, "a touch landing while typing is ignored");
  assert.deepEqual(buttons(during), [], "and can't tap");
  assert.ok(motion(typed(DWT_TIMEOUT_MS + 10).run()).n > 0, "after the timeout it moves");
  assert.ok(motion(typed(100).run({ disableWhileTyping: false })).n > 0, "off: it moves");
  assert.ok(motion(typed(100, 29).run()).n > 0, "modifiers (Ctrl) don't count as typing");
  // A palm brushing the pad just before a key press doesn't become a tap.
  const brush = new Stream().down(0, 50, 30).sync(40).key(30).up(0).sync();
  assert.deepEqual(buttons(brush.run()), []);
}
pass("disable-while-typing: ignores touches landing while typing, modifiers excepted");

{
  const palmBy = (extra: { pressure?: number; major?: number }) =>
    new Stream().down(0, 50, 30, extra).sync().slide(0, 50, 30, 10, 0, 5).up(0).sync().run();
  assert.equal(motion(palmBy({ pressure: 250 })).n, 0, "high pressure");
  assert.equal(motion(palmBy({ major: 400 })).n, 0, "25 mm contact (12 units/mm)");
  assert.ok(motion(palmBy({ pressure: 60, major: 120 })).n > 0, "an ordinary finger");
  const tool = new Stream()
    .down(0, 50, 30)
    .set(0, ABS_MT_TOOL_TYPE, MT_TOOL_PALM)
    .sync()
    .slide(0, 50, 30, 10, 0, 5)
    .up(0)
    .sync()
    .run();
  assert.equal(motion(tool).n, 0, "firmware palm");
  assert.deepEqual(buttons(tool), []);
  // A finger that becomes a palm mid-touch stops moving the pointer from then on.
  const late = new Stream().down(0, 50, 30).sync().slide(0, 50, 30, 5, 0, 5);
  const before = motion(late.run({ tap: false })).dx;
  late.set(0, ABS_MT_PRESSURE, 250).sync().slide(0, 55, 30, 10, 0, 5).up(0).sync();
  assert.equal(motion(late.run({ tap: false })).dx, before);
  // Side bands: a resting edge touch is a palm until it moves inward, and never taps.
  const edge = new Stream().down(0, 2, 30).sync(60).up(0).sync();
  assert.deepEqual(buttons(edge.run()), [], "edge touch doesn't tap");
  const inward = new Stream().down(0, 2, 30).sync().slide(0, 2, 30, 20, 0, 10).up(0).sync();
  assert.ok(motion(inward.run()).n > 0, "an edge touch moving inward becomes a finger");
}
pass("palms: pressure, touch major, firmware tool type, mid-touch, side bands");

// ---------------------------------------------------------------------------
// Recordings
// ---------------------------------------------------------------------------
{
  const s = twoFingerSwipe(25, 10, 8, 10).key(30).wait(600).down(0, 50, 30).sync(50).up(0).sync();
  const text = formatTouchpadRecording(s.recording());
  const parsed = parseTouchpadRecording(text);
  assert.deepEqual(replayTouchpadRecording(parsed), s.run(), "format → parse replays identically");
  assert.equal(recordingGeometry(parsed).clickpad, true);
  assert.equal(parsed.keys.length, 1);
  // A hand-written evemu capture (one-finger tap on a non-clickpad).
  const evemu = `# EVEMU 1.3
N: SynPS/2 Synaptics TouchPad
I: 0011 0002 0007 01b1
P: 01 00 00 00 00 00 00 00
B: 01 00 00 00 00 00 00 00 00
B: 01 00 00 00 00 00 00 00 00
B: 01 00 00 00 00 00 00 00 00
B: 01 00 00 00 00 00 00 00 00
B: 01 00 00 01 00 00 00 00 00
B: 01 20 64 00 00 00 00 00 00
B: 03 03 00 00 01 00 80 60 06
A: 00 1266 5676 0 0 42
A: 01 1094 4762 0 0 63
A: 18 0 255 0 0 0
A: 2f 0 1 0 0 0
A: 35 1266 5676 0 0 42
A: 36 1094 4762 0 0 63
A: 39 0 65535 0 0 0
A: 3a 0 255 0 0 0
E: 0.000001 0003 0039 0042
E: 0.000001 0003 0035 3000
E: 0.000001 0003 0036 3000
E: 0.000001 0003 003a 0040
E: 0.000001 0001 014a 0001
E: 0.000001 0001 0145 0001
E: 0.000001 0000 0000 0000
E: 0.080000 0003 0039 -001
E: 0.080000 0001 014a 0000
E: 0.080000 0001 0145 0000
E: 0.080000 0000 0000 0000
`;
  const captured = parseTouchpadRecording(evemu);
  const geometry = recordingGeometry(captured);
  assert.equal(geometry.clickpad, false);
  assert.equal(geometry.slots, 2);
  assert.equal(geometry.x.resolution, 42);
  assert.deepEqual(buttons(replayTouchpadRecording(captured)), ["L+@80", `L-@${80 + TAP_DRAG_TIMEOUT_MS}`]);
  assert.throws(() => parseTouchpadRecording("Q: nonsense"), /unknown line/);
}
pass("recordings: evemu format round trip, a hand-written capture, keys, bad input");

// ---------------------------------------------------------------------------
// EvdevPointer integration
// ---------------------------------------------------------------------------
{
  const caps = padCapabilities();
  const geometry = geometryOf(caps)!;
  const queue: Buffer[] = [];
  const io: PointerDeviceIo = {
    open: () => 7,
    read: (_fd, buffer) => {
      const next = queue.shift();
      if (!next) throw Object.assign(new Error("again"), { code: "EAGAIN" });
      next.copy(buffer);
      return next.length;
    },
    close: () => {},
    identity: () => "13:71",
    grab: () => {},
    describe: (path) => ({ path, name: "Fixture touchpad", kind: "touchpad", relative: false }),
    touchpad: () => geometry,
  };
  const timers: { at: number; run: () => void; live: boolean }[] = [];
  let now = 0;
  const clock = {
    now: () => now,
    setTimeout: (run: () => void, ms: number) => {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (handle: unknown) => {
      (handle as { live: boolean }).live = false;
    },
  };
  const ready: (() => void)[] = [];
  const pointer = new EvdevPointer({ add: (_fd, cb) => ready.push(cb), remove: () => {} }, io, clock);
  const devices: PointerDeviceConfigTarget[] = [];
  const events: string[] = [];
  pointer.on("device", (target: PointerDeviceConfigTarget) => devices.push(target));
  pointer.on("button", (ev: { code: number; value: number }) => events.push(`${name(ev.code)}${ev.value ? "+" : "-"}`));
  pointer.on("motion", () => events.push("motion"));
  pointer.on("axis", (ev: EvdevPointerAxis) => events.push(`axis:${ev.axis}:${ev.source}:${Math.sign(ev.value)}`));
  pointer.on("absolute", () => events.push("absolute"));
  pointer.start(["/dev/input/event9"]);
  const [target] = devices;
  assert.ok(target);
  assert.equal(target.info.clickpad, true);
  for (const option of ["tap", "scrollMethod", "disableWhileTyping", "kineticScroll", "clickMethod", "accelSpeed", "naturalScroll", "leftHanded"] as const)
    assert.equal(target.supports(option), true, option);
  assert.equal(target.supports("middleEmulation"), false);
  const feed = (stream: Stream) => {
    const buffer = Buffer.alloc(stream.events.length * 24);
    stream.events.forEach((e, i) => {
      buffer.writeBigUInt64LE(BigInt(Math.floor(e.timeMs / 1000)), i * 24);
      buffer.writeBigUInt64LE(BigInt(Math.round((e.timeMs % 1000) * 1000)), i * 24 + 8);
      buffer.writeUInt16LE(e.type, i * 24 + 16);
      buffer.writeUInt16LE(e.code, i * 24 + 18);
      buffer.writeInt32LE(e.value, i * 24 + 20);
    });
    // Split into reads that cut records in half, as a real read can.
    for (let offset = 0; offset < buffer.length; offset += 100) queue.push(buffer.subarray(offset, offset + 100));
    while (queue.length) for (const cb of ready) cb();
  };
  const runTimers = (until: number) => {
    for (;;) {
      const due = timers.filter((t) => t.live && t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      due.live = false;
      now = due.at;
      due.run();
    }
    now = until;
  };
  // Neutral until configured: a tap does nothing, motion still moves.
  feed(new Stream().down(0, 50, 30).sync(50).up(0).sync());
  assert.deepEqual(events, [], "no tapping before prefs apply");
  target.set("tap", true);
  target.set("scrollMethod", "two-finger");
  target.set("disableWhileTyping", true);
  const tap = new Stream();
  tap.t = 5000;
  feed(tap.down(0, 50, 30).sync(50).up(0).sync());
  now = 5060;
  assert.deepEqual(events, ["L+"]);
  runTimers(6000);
  assert.deepEqual(events, ["L+", "L-"], "the drag window timer releases the tap");
  events.length = 0;
  const swipe = twoFingerSwipe(20, 20, 10, 100);
  swipe.events.forEach((e) => (e.timeMs += 6000));
  feed(swipe);
  assert.ok(events.length > 0 && events.every((e) => e === "axis:vertical:finger:-1"), events.join());
  events.length = 0;
  // Disable while typing through noteKeyboard.
  pointer.noteKeyboard({ code: 30, value: 1, timeMs: 9000 });
  const typing = new Stream();
  typing.t = 9100;
  feed(typing.down(0, 50, 30).sync().slide(0, 50, 30, 10, 0, 5).up(0).sync());
  assert.deepEqual(events, []);
  // A tap held at stop is released.
  const pending = new Stream();
  pending.t = 12000;
  feed(pending.down(0, 50, 30).sync(50).up(0).sync());
  assert.deepEqual(events, ["L+"]);
  pointer.stop();
  assert.deepEqual(events, ["L+", "L-"], "stop releases the held tap button");
}
pass("EvdevPointer: touchpad devices use the driver, neutral until configured, timers, DWT, stop");

console.log(`touchpad smoke: ${cases} cases passed`);
