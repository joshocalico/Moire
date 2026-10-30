/**
 * Touchpad devices for Moire's own evdev reader: geometry from the kernel and the multitouch
 * (protocol B) decoder that turns raw events into one frame per SYN_REPORT.
 *
 * - Geometry comes from EVIOCGPROP (INPUT_PROP_BUTTONPAD and friends), EVIOCGBIT and EVIOCGABS
 *   (ranges and resolution) through the libc ioctl boundary in libc.ts. Nothing else here
 *   touches native code; `touchpadGeometryFrom` is pure so smokes and recordings build the same
 *   geometry from captured values.
 * - The decoder keeps per-slot state (ABS_MT_SLOT, TRACKING_ID, POSITION_X/Y, TOUCH_MAJOR,
 *   PRESSURE, TOOL_TYPE) and the BTN_TOOL_* finger count. Single-touch pads (no MT axes) are
 *   decoded as one slot from ABS_X/ABS_Y and BTN_TOUCH.
 * - SYN_DROPPED discards events up to the next SYN_REPORT and then ends every contact, which
 *   the gesture machine reads as all fingers lifting. A finger still down is picked up again
 *   when it next lifts and touches.
 */
import { ioctlFd } from "./libc";

export const EV_SYN = 0x00;
export const EV_KEY = 0x01;
export const EV_ABS = 0x03;
export const SYN_REPORT = 0;
export const SYN_DROPPED = 3;

export const ABS_X = 0x00;
export const ABS_Y = 0x01;
export const ABS_PRESSURE = 0x18;
export const ABS_MT_SLOT = 0x2f;
export const ABS_MT_TOUCH_MAJOR = 0x30;
export const ABS_MT_POSITION_X = 0x35;
export const ABS_MT_POSITION_Y = 0x36;
export const ABS_MT_TOOL_TYPE = 0x37;
export const ABS_MT_TRACKING_ID = 0x39;
export const ABS_MT_PRESSURE = 0x3a;
export const MT_TOOL_PALM = 2;

export const BTN_LEFT = 0x110;
export const BTN_RIGHT = 0x111;
export const BTN_MIDDLE = 0x112;
export const BTN_TOOL_FINGER = 0x145;
export const BTN_TOOL_QUINTTAP = 0x148;
export const BTN_TOUCH = 0x14a;
export const BTN_TOOL_DOUBLETAP = 0x14d;
export const BTN_TOOL_TRIPLETAP = 0x14e;
export const BTN_TOOL_QUADTAP = 0x14f;

export const INPUT_PROP_POINTER = 0x00;
export const INPUT_PROP_DIRECT = 0x01;
export const INPUT_PROP_BUTTONPAD = 0x02;
export const INPUT_PROP_SEMI_MT = 0x03;
export const INPUT_PROP_TOPBUTTONPAD = 0x04;

const TOOL_FINGERS: ReadonlyMap<number, number> = new Map([
  [BTN_TOOL_FINGER, 1],
  [BTN_TOOL_DOUBLETAP, 2],
  [BTN_TOOL_TRIPLETAP, 3],
  [BTN_TOOL_QUADTAP, 4],
  [BTN_TOOL_QUINTTAP, 5],
]);

// ---------------------------------------------------------------------------
// ioctl request numbers: _IOC(dir, 'E', nr, size) = dir << 30 | size << 16 | 0x45 << 8 | nr
// ---------------------------------------------------------------------------

const IOC_READ = 2;
function ioc(dir: number, nr: number, size: number): number {
  return ((dir << 30) | (size << 16) | (0x45 << 8) | nr) >>> 0;
}
/** EVIOCGPROP(len): the INPUT_PROP_* bitmap. */
export const eviocgprop = (len: number) => ioc(IOC_READ, 0x09, len);
/** EVIOCGBIT(ev, len): the codes an event type supports (ev 0 gives the event types). */
export const eviocgbit = (ev: number, len: number) => ioc(IOC_READ, 0x20 + ev, len);
/** EVIOCGABS(abs): struct input_absinfo { value, minimum, maximum, fuzz, flat, resolution }. */
export const eviocgabs = (abs: number) => ioc(IOC_READ, 0x40 + abs, ABSINFO_SIZE);
const ABSINFO_SIZE = 24;
const KEY_BITS = 96;
const ABS_BITS = 8;
const PROP_BITS = 4;

export type AbsInfo = { minimum: number; maximum: number; resolution: number };

/** One axis in device units; `resolution` is units per millimetre (estimated when 0). */
export type TouchpadAxis = AbsInfo & { estimated: boolean };

export type TouchpadGeometry = {
  x: TouchpadAxis;
  y: TouchpadAxis;
  /** Protocol B slots; 1 for single-touch pads. */
  slots: number;
  multitouch: boolean;
  /** ABS_MT_PRESSURE (or ABS_PRESSURE on single-touch pads), when the pad reports it. */
  pressure: AbsInfo | null;
  /** ABS_MT_TOUCH_MAJOR, when the pad reports contact size. */
  touchMajor: AbsInfo | null;
  /** INPUT_PROP_BUTTONPAD: the whole surface clicks and reports only BTN_LEFT. */
  clickpad: boolean;
  /** INPUT_PROP_SEMI_MT: two slots give a bounding box, not two real contacts. */
  semiMt: boolean;
  /** The most fingers BTN_TOOL_* can count. */
  maxFingers: number;
  buttons: { left: boolean; right: boolean; middle: boolean };
};

export function hasBit(bits: Uint8Array, bit: number): boolean {
  return ((bits[Math.floor(bit / 8)] ?? 0) & (1 << (bit % 8))) !== 0;
}

/** Pads without a resolution: assume a 100 × 65 mm surface, a typical laptop pad. */
const ASSUMED_WIDTH_MM = 100;
const ASSUMED_HEIGHT_MM = 65;

function axis(info: AbsInfo, assumedMm: number): TouchpadAxis {
  if (info.resolution > 0) return { ...info, estimated: false };
  const span = Math.max(1, info.maximum - info.minimum);
  return { ...info, resolution: span / assumedMm, estimated: true };
}

export type TouchpadCapabilities = {
  props: Uint8Array;
  absBits: Uint8Array;
  keyBits: Uint8Array;
  abs(code: number): AbsInfo | null;
};

/**
 * Geometry from capability bitmaps and absinfo, or null when the device is not a touchpad:
 * it needs finger tools and X/Y, and must not be a touch screen (INPUT_PROP_DIRECT).
 */
export function touchpadGeometryFrom(caps: TouchpadCapabilities): TouchpadGeometry | null {
  const mt = hasBit(caps.absBits, ABS_MT_POSITION_X) && hasBit(caps.absBits, ABS_MT_POSITION_Y);
  const xCode = mt ? ABS_MT_POSITION_X : ABS_X;
  const yCode = mt ? ABS_MT_POSITION_Y : ABS_Y;
  if (!hasBit(caps.absBits, xCode) || !hasBit(caps.absBits, yCode)) return null;
  if (!hasBit(caps.keyBits, BTN_TOOL_FINGER) || hasBit(caps.props, INPUT_PROP_DIRECT)) return null;
  const x = caps.abs(xCode);
  const y = caps.abs(yCode);
  if (!x || !y || x.maximum <= x.minimum || y.maximum <= y.minimum) return null;
  const slot = mt && hasBit(caps.absBits, ABS_MT_SLOT) ? caps.abs(ABS_MT_SLOT) : null;
  let maxFingers = 1;
  for (const [code, count] of TOOL_FINGERS)
    if (hasBit(caps.keyBits, code)) maxFingers = Math.max(maxFingers, count);
  const pressureCode = mt ? ABS_MT_PRESSURE : ABS_PRESSURE;
  const pressure = hasBit(caps.absBits, pressureCode) ? caps.abs(pressureCode) : null;
  const major =
    mt && hasBit(caps.absBits, ABS_MT_TOUCH_MAJOR) ? caps.abs(ABS_MT_TOUCH_MAJOR) : null;
  return {
    x: axis(x, ASSUMED_WIDTH_MM),
    // A pad with only an X resolution most likely has square units.
    y: axis(y.resolution > 0 || x.resolution <= 0 ? y : { ...y, resolution: x.resolution }, ASSUMED_HEIGHT_MM),
    slots: slot ? Math.max(1, Math.min(16, slot.maximum + 1)) : 1,
    multitouch: mt,
    pressure: pressure && pressure.maximum > pressure.minimum ? pressure : null,
    touchMajor: major && major.maximum > major.minimum ? major : null,
    clickpad: hasBit(caps.props, INPUT_PROP_BUTTONPAD),
    semiMt: hasBit(caps.props, INPUT_PROP_SEMI_MT),
    maxFingers,
    buttons: {
      left: hasBit(caps.keyBits, BTN_LEFT),
      right: hasBit(caps.keyBits, BTN_RIGHT),
      middle: hasBit(caps.keyBits, BTN_MIDDLE),
    },
  };
}

/** Width and height in millimetres. */
export function touchpadSizeMm(geometry: TouchpadGeometry): { width: number; height: number } {
  return {
    width: (geometry.x.maximum - geometry.x.minimum) / geometry.x.resolution,
    height: (geometry.y.maximum - geometry.y.minimum) / geometry.y.resolution,
  };
}

/** Capability bitmaps and absinfo of an open evdev descriptor, as a recording stores them. */
export type EvdevCapabilities = {
  props: Buffer;
  absBits: Buffer;
  keyBits: Buffer;
  absInfo: Map<number, AbsInfo>;
};

/** Query an open evdev descriptor; null when the ioctls fail (not an evdev node). */
export function readEvdevCapabilities(fd: number): EvdevCapabilities | null {
  const props = Buffer.alloc(PROP_BITS);
  const absBits = Buffer.alloc(ABS_BITS);
  const keyBits = Buffer.alloc(KEY_BITS);
  // EVIOCGPROP and EVIOCGBIT return the bytes copied; old kernels reject EVIOCGPROP (no props).
  if (ioctlFd(fd, eviocgprop(PROP_BITS), props) < 0) props.fill(0);
  if (ioctlFd(fd, eviocgbit(EV_ABS, ABS_BITS), absBits) < 1) return null;
  if (ioctlFd(fd, eviocgbit(EV_KEY, KEY_BITS), keyBits) < 1) return null;
  const absInfo = new Map<number, AbsInfo>();
  for (let code = 0; code < ABS_BITS * 8; code++) {
    if (!hasBit(absBits, code)) continue;
    const info = Buffer.alloc(ABSINFO_SIZE);
    if (ioctlFd(fd, eviocgabs(code), info) !== 0) continue;
    absInfo.set(code, {
      minimum: info.readInt32LE(4),
      maximum: info.readInt32LE(8),
      resolution: info.readInt32LE(20),
    });
  }
  return { props, absBits, keyBits, absInfo };
}

/** Touchpad geometry of an open descriptor; null when it is not a touchpad. */
export function readTouchpadGeometry(fd: number): TouchpadGeometry | null {
  const caps = readEvdevCapabilities(fd);
  return caps ? touchpadGeometryFrom({ ...caps, abs: (code) => caps.absInfo.get(code) ?? null }) : null;
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

/** One finger on the pad, in device units. */
export type TouchpadContact = {
  slot: number;
  /** Kernel tracking id; a new id in the same slot is a new touch. */
  id: number;
  x: number;
  y: number;
  /** Raw ABS_MT_TOUCH_MAJOR, or null when not reported. */
  major: number | null;
  /** Raw pressure, or null when not reported. */
  pressure: number | null;
  /** The firmware already says this is a palm (MT_TOOL_PALM). */
  palm: boolean;
};

export type TouchpadFrame = {
  timeMs: number;
  contacts: TouchpadContact[];
  /** BTN_TOOL_* count; may exceed `contacts` on pads with fewer slots than fingers. */
  fingers: number;
  /** Physical button state after this frame. */
  buttons: { left: boolean; right: boolean; middle: boolean };
};

type Slot = {
  id: number;
  x: number;
  y: number;
  major: number | null;
  pressure: number | null;
  palm: boolean;
};

const emptySlot = (): Slot => ({
  id: -1,
  x: 0,
  y: 0,
  major: null,
  pressure: null,
  palm: false,
});

/** Accumulates raw events and yields a frame on every SYN_REPORT. */
export class TouchpadDecoder {
  private slots: Slot[];
  private slot = 0;
  private tool = 0;
  private touching = false;
  private dropping = false;
  private nextSingleId = 1;
  private buttons = { left: false, right: false, middle: false };

  constructor(private readonly geometry: TouchpadGeometry) {
    this.slots = Array.from({ length: geometry.slots }, emptySlot);
  }

  push(type: number, code: number, value: number, timeMs: number): TouchpadFrame | null {
    if (type === EV_SYN) {
      if (code === SYN_DROPPED) {
        this.dropping = true;
        return null;
      }
      if (code !== SYN_REPORT) return null;
      if (this.dropping) {
        this.dropping = false;
        this.slots = this.slots.map(emptySlot);
        this.tool = 0;
        this.touching = false;
        this.buttons = { left: false, right: false, middle: false };
      }
      return this.frame(timeMs);
    }
    if (this.dropping) return null;
    if (type === EV_KEY) this.key(code, value);
    else if (type === EV_ABS) this.abs(code, value);
    return null;
  }

  private key(code: number, value: number): void {
    const fingers = TOOL_FINGERS.get(code);
    if (fingers !== undefined) {
      if (value) this.tool = fingers;
      else if (this.tool === fingers) this.tool = 0;
      return;
    }
    if (code === BTN_TOUCH) {
      this.touching = value !== 0;
      if (!this.geometry.multitouch) {
        const single = this.slots[0]!;
        if (value && single.id < 0) single.id = this.nextSingleId++;
        if (!value) single.id = -1;
      }
      return;
    }
    if (code === BTN_LEFT) this.buttons = { ...this.buttons, left: value !== 0 };
    else if (code === BTN_RIGHT) this.buttons = { ...this.buttons, right: value !== 0 };
    else if (code === BTN_MIDDLE) this.buttons = { ...this.buttons, middle: value !== 0 };
  }

  private abs(code: number, value: number): void {
    if (!this.geometry.multitouch) {
      const single = this.slots[0]!;
      if (code === ABS_X) single.x = value;
      else if (code === ABS_Y) single.y = value;
      else if (code === ABS_PRESSURE) single.pressure = value;
      return;
    }
    if (code === ABS_MT_SLOT) {
      this.slot = value;
      return;
    }
    const slot = this.slots[this.slot];
    if (!slot) return; // A slot beyond EVIOCGABS's range: ignore rather than grow unbounded.
    switch (code) {
      case ABS_MT_TRACKING_ID:
        if (value < 0) slot.id = -1;
        else Object.assign(slot, { ...emptySlot(), x: slot.x, y: slot.y, id: value });
        break;
      case ABS_MT_POSITION_X:
        slot.x = value;
        break;
      case ABS_MT_POSITION_Y:
        slot.y = value;
        break;
      case ABS_MT_TOUCH_MAJOR:
        slot.major = value;
        break;
      case ABS_MT_PRESSURE:
        slot.pressure = value;
        break;
      case ABS_MT_TOOL_TYPE:
        slot.palm = value === MT_TOOL_PALM;
        break;
    }
  }

  private frame(timeMs: number): TouchpadFrame {
    const contacts: TouchpadContact[] = [];
    this.slots.forEach((slot, index) => {
      if (slot.id < 0) return;
      contacts.push({
        slot: index,
        id: slot.id,
        x: slot.x,
        y: slot.y,
        major: slot.major,
        pressure: slot.pressure,
        palm: slot.palm,
      });
    });
    const fingers = this.touching || this.tool > 0 ? Math.max(this.tool, contacts.length) : 0;
    return {
      timeMs,
      contacts: fingers === 0 && !this.geometry.multitouch ? [] : contacts,
      fingers: Math.max(fingers, contacts.length),
      buttons: { ...this.buttons },
    };
  }
}
