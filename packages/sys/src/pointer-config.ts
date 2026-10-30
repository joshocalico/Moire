/**
 * Per-device pointer configuration, shaped like libinput's `libinput_device_config_*` API so a
 * libinput backend can implement the same target later. Today the evdev reader honours what a
 * plain evdev mouse can: acceleration, natural scrolling, left-handed buttons and middle-button
 * emulation, all in software. Touchpads with a multitouch driver (touchpad-gesture.ts) honour the
 * touchpad options too; `touchpadSupports` says which, from the pad's geometry.
 */
import fs from "node:fs";
import path from "node:path";
import type { TouchpadGeometry } from "./touchpad-device";

export type PointerDeviceKind = "mouse" | "touchpad";
export type PointerAccelProfile = "adaptive" | "flat";
export type PointerScrollMethod = "two-finger" | "edge" | "none";
/** Clickpads: which button a click is, by bottom-area position or by finger count. */
export type PointerClickMethod = "areas" | "clickfinger";

export type PointerDeviceInfo = {
  path: string;
  name: string;
  kind: PointerDeviceKind;
  /** Reports REL_X/REL_Y; absolute-only devices (VM tablets) have no acceleration. */
  relative: boolean;
  /** Touchpads with a multitouch driver: the whole surface is the button (INPUT_PROP_BUTTONPAD). */
  clickpad?: boolean;
};

export type PointerDeviceConfig = {
  accelSpeed: number;
  accelProfile: PointerAccelProfile;
  naturalScroll: boolean;
  leftHanded: boolean;
  middleEmulation: boolean;
  tap: boolean;
  scrollMethod: PointerScrollMethod;
  disableWhileTyping: boolean;
  /** Two-finger scrolling keeps coasting after the fingers lift. */
  kineticScroll: boolean;
  clickMethod: PointerClickMethod;
};

export type PointerConfigOption = keyof PointerDeviceConfig;

/** One configurable device: libinput's `*_is_available` queries plus setters. */
export type PointerDeviceConfigTarget = {
  readonly info: PointerDeviceInfo;
  supports(option: PointerConfigOption): boolean;
  set<K extends PointerConfigOption>(option: K, value: PointerDeviceConfig[K]): void;
};

/** What a device does before any pref is applied (libinput's defaults for a mouse). */
export const NEUTRAL_POINTER_CONFIG: PointerDeviceConfig = {
  accelSpeed: 0,
  accelProfile: "adaptive",
  naturalScroll: false,
  leftHanded: false,
  middleEmulation: false,
  tap: false,
  scrollMethod: "none",
  disableWhileTyping: false,
  kineticScroll: false,
  clickMethod: "areas",
};

export const BTN_LEFT = 0x110;
export const BTN_RIGHT = 0x111;
export const BTN_MIDDLE = 0x112;

// ---------------------------------------------------------------------------
// Device classification from sysfs capability bitmaps
// ---------------------------------------------------------------------------

const REL_X = 0x00;
const ABS_MT_POSITION_X = 0x35;
const BTN_TOOL_FINGER = 0x145;
const INPUT_PROP_DIRECT = 0x01;

/** sysfs prints capability bitmaps as hex longs, most significant word first. */
export function parseSysfsBitmap(text: string, wordBits = 64): (bit: number) => boolean {
  const words = text.trim().split(/\s+/).filter(Boolean).reverse();
  return (bit) => {
    const word = words[Math.floor(bit / wordBits)];
    if (!word) return false;
    return ((BigInt(`0x${word}`) >> BigInt(bit % wordBits)) & 1n) === 1n;
  };
}

export type PointerCapabilityText = {
  name?: string;
  rel?: string;
  abs?: string;
  key?: string;
  properties?: string;
};

export function classifyPointerDevice(
  devicePath: string,
  caps: PointerCapabilityText,
  wordBits = 64,
): PointerDeviceInfo {
  const rel = parseSysfsBitmap(caps.rel ?? "", wordBits);
  const abs = parseSysfsBitmap(caps.abs ?? "", wordBits);
  const key = parseSysfsBitmap(caps.key ?? "", wordBits);
  const props = parseSysfsBitmap(caps.properties ?? "", wordBits);
  const touchpad = abs(ABS_MT_POSITION_X) && key(BTN_TOOL_FINGER) && !props(INPUT_PROP_DIRECT);
  return {
    path: devicePath,
    name: caps.name?.trim() || path.basename(devicePath),
    kind: touchpad ? "touchpad" : "mouse",
    // Unknown capabilities (no sysfs) are treated as a relative mouse, the common case.
    relative: caps.rel === undefined ? true : rel(REL_X),
  };
}

/** Read /sys/class/input/eventN/device/{name,capabilities/*,properties}. */
export function readPointerDeviceInfo(devicePath: string): PointerDeviceInfo {
  const base = `/sys/class/input/${path.basename(devicePath)}/device`;
  const read = (file: string): string | undefined => {
    try {
      return fs.readFileSync(path.join(base, file), "utf8");
    } catch {
      return undefined;
    }
  };
  return classifyPointerDevice(
    devicePath,
    {
      name: read("name"),
      rel: read("capabilities/rel"),
      abs: read("capabilities/abs"),
      key: read("capabilities/key"),
      properties: read("properties"),
    },
    process.arch === "arm" || process.arch === "ia32" ? 32 : 64,
  );
}

/** Options an evdev device can honour in software. */
export function evdevSupports(info: PointerDeviceInfo, option: PointerConfigOption): boolean {
  switch (option) {
    case "accelSpeed":
    case "accelProfile":
      return info.relative;
    case "naturalScroll":
    case "leftHanded":
    case "middleEmulation":
      return true;
    case "tap":
    case "scrollMethod":
    case "disableWhileTyping":
    case "kineticScroll":
    case "clickMethod":
      return false;
  }
}

/** Options a touchpad driven by the multitouch gesture machine honours. */
export function touchpadSupports(geometry: TouchpadGeometry, option: PointerConfigOption): boolean {
  if (option === "clickMethod") return geometry.clickpad;
  // Pads with real buttons pass them straight through; clickpads map clicks themselves.
  if (option === "middleEmulation") return false;
  return true;
}

// ---------------------------------------------------------------------------
// Acceleration
// ---------------------------------------------------------------------------

/** Device units per millisecond above which the adaptive profile starts to accelerate. */
const ADAPTIVE_THRESHOLD = 0.4;
const ADAPTIVE_INCLINE = 1.1;
/** Gaps longer than this start a new gesture rather than a very slow one. */
const MOTION_GAP_MS = 100;

export type PointerAccelerator = {
  filter(dx: number, dy: number, timeMs: number): { dx: number; dy: number };
};

/** Gain for one motion delta; exported for tests. */
export function pointerAccelFactor(
  profile: PointerAccelProfile,
  speed: number,
  unitsPerMs: number,
): number {
  const s = Math.min(1, Math.max(-1, speed));
  if (profile === "flat") return Math.max(0.1, 1 + s);
  const baseline = 2 ** s;
  const maxGain = 1.5 + s;
  const gain = Math.min(
    Math.max(1, maxGain),
    1 + Math.max(0, unitsPerMs - ADAPTIVE_THRESHOLD) * ADAPTIVE_INCLINE,
  );
  return baseline * gain;
}

/** Integer deltas out, with the fractional remainder carried so slow motion is not lost. */
export function createPointerAccelerator(
  profile: PointerAccelProfile,
  speed: number,
): PointerAccelerator {
  let lastTime: number | null = null;
  let remX = 0;
  let remY = 0;
  return {
    filter(dx, dy, timeMs) {
      const dt =
        lastTime === null ? MOTION_GAP_MS : Math.min(MOTION_GAP_MS, Math.max(1, timeMs - lastTime));
      lastTime = timeMs;
      const factor = pointerAccelFactor(profile, speed, Math.hypot(dx, dy) / dt);
      const x = dx * factor + remX;
      const y = dy * factor + remY;
      const outX = Math.trunc(x);
      const outY = Math.trunc(y);
      remX = x - outX;
      remY = y - outY;
      return { dx: outX, dy: outY };
    },
  };
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export function swapHandedButton(code: number, leftHanded: boolean): number {
  if (!leftHanded) return code;
  if (code === BTN_LEFT) return BTN_RIGHT;
  if (code === BTN_RIGHT) return BTN_LEFT;
  return code;
}

export type ButtonTimers = {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

const nodeTimers: ButtonTimers = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** libinput's window for "pressed together". */
export const MIDDLE_EMULATION_WINDOW_MS = 50;

type MiddleState =
  | { kind: "idle" }
  | { kind: "pending"; code: number; timeMs: number; timer: unknown }
  | { kind: "middle"; held: Set<number>; released: boolean };

/**
 * Left and right pressed within the window become one middle click. A lone press is held back
 * for at most the window, and flushed early by any other input so event order is preserved.
 */
export class MiddleButtonEmulator {
  private state: MiddleState = { kind: "idle" };
  constructor(
    private readonly emit: (code: number, value: number, timeMs: number) => void,
    private readonly timers: ButtonTimers = nodeTimers,
    private readonly windowMs = MIDDLE_EMULATION_WINDOW_MS,
  ) {}

  button(code: number, value: number, timeMs: number): void {
    const primary = code === BTN_LEFT || code === BTN_RIGHT;
    const state = this.state;
    if (state.kind === "middle" && primary) {
      if (value === 0) {
        state.held.delete(code);
        if (!state.released) {
          state.released = true;
          this.emit(BTN_MIDDLE, 0, timeMs);
        }
        if (state.held.size === 0) this.state = { kind: "idle" };
      }
      return;
    }
    if (state.kind === "pending") {
      if (primary && value === 1 && code !== state.code) {
        this.timers.clearTimeout(state.timer);
        this.state = { kind: "middle", held: new Set([state.code, code]), released: false };
        this.emit(BTN_MIDDLE, 1, timeMs);
        return;
      }
      this.flush();
    }
    if (this.state.kind === "idle" && primary && value === 1) {
      const timer = this.timers.setTimeout(() => this.flush(), this.windowMs);
      this.state = { kind: "pending", code, timeMs, timer };
      return;
    }
    this.emit(code, value, timeMs);
  }

  /** Release a held-back press now (before motion, scroll, or a timer). */
  flush(): void {
    const state = this.state;
    if (state.kind !== "pending") return;
    this.timers.clearTimeout(state.timer);
    this.state = { kind: "idle" };
    this.emit(state.code, 1, state.timeMs);
  }

  reset(): void {
    if (this.state.kind === "pending") this.timers.clearTimeout(this.state.timer);
    this.state = { kind: "idle" };
  }
}
