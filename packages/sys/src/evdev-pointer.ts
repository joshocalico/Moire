/**
 * Minimal evdev pointer reader.
 * Parallels Virtual Mouse primarily emits ABS_X/ABS_Y (tablet), not REL_X/REL_Y.
 * Touchpads go through Moire's multitouch driver instead (touchpad-device.ts decodes,
 * touchpad-gesture.ts turns frames into motion, taps and scrolling).
 */
import fs from "node:fs";
import type { SeatDeviceAccess } from "./seat";
import { EventEmitter } from "node:events";
import { assertLinux } from "./platform";
import { getLibc } from "./libc";
import { LinuxReadinessDispatcher } from "./readiness";
import type { InputFixtureTrace } from "./input-fixture-trace";
import { isScrollPointerEvent } from "./scroll-trace";
import {
  classifyPointerDevice,
  createPointerAccelerator,
  evdevSupports,
  MiddleButtonEmulator,
  NEUTRAL_POINTER_CONFIG,
  readPointerDeviceInfo,
  swapHandedButton,
  touchpadSupports,
  type ButtonTimers,
  type PointerAccelerator,
  type PointerConfigOption,
  type PointerDeviceConfig,
  type PointerDeviceConfigTarget,
  type PointerDeviceInfo,
} from "./pointer-config";
import { readTouchpadGeometry, TouchpadDecoder, type TouchpadGeometry } from "./touchpad-device";
import { TouchpadGestures, type TouchpadOutput } from "./touchpad-gesture";

const EV_SYN = 0x00;
const EV_KEY = 0x01;
const EV_REL = 0x02;
const EV_ABS = 0x03;
const SYN_REPORT = 0;
const REL_X = 0x00;
const REL_Y = 0x01;
const REL_WHEEL = 0x08;
const ABS_X = 0x00;
const ABS_Y = 0x01;
const BTN_LEFT = 0x110;
const BTN_RIGHT = 0x111;
const BTN_MIDDLE = 0x112;

const INPUT_EVENT_SIZE = 24;
/** Parallels virtual tablet default range. */
const DEFAULT_ABS_MAX = 32767;

// EVIOCGRAB = _IOW('E', 0x90, int)
const EVIOCGRAB = (1 << 30) | (4 << 16) | (0x45 << 8) | 0x90;

function tryGrab(fd: number, path: string): void {
  // Optional exclusive grab — skip if it fails; do not require it for Parallels.
  try {
    const ioctl = getLibc().func("int ioctl(int fd, unsigned long request, void *arg)");
    const rc = ioctl(fd, EVIOCGRAB >>> 0, 1) as number;
    if (rc === 0) console.log(`[evdev] grabbed ${path}`);
  } catch {
    // ok
  }
}

export type EvdevPointerMotion = {
  dx: number;
  dy: number;
  timeMs: number;
};

/** Absolute position in [0, 1] device space (Parallels tablet). */
export type EvdevPointerAbsolute = {
  x: number;
  y: number;
  timeMs: number;
};

export type EvdevPointerButton = {
  code: number;
  value: number;
  timeMs: number;
};

export type EvdevPointerAxis = {
  /** Wheel clicks, REL_WHEEL/REL_HWHEEL sign (up and right positive); touchpads give fractions. */
  value: number;
  timeMs: number;
  /** Omitted for wheels, which are vertical. */
  axis?: "vertical" | "horizontal";
  source?: "wheel" | "finger" | "kinetic";
};

/** Compositor pixels per wheel click, as the Wayland seat sends a click. */
const PX_PER_WHEEL_CLICK = 10;

export type PointerDeviceIo = {
  open(path: string): number;
  read(fd: number, buffer: Buffer): number;
  close(fd: number): void;
  identity(fd: number): string;
  grab(fd: number, path: string): void;
  /** Device kind and capabilities; fixtures without it are treated as a relative mouse. */
  describe?(path: string): PointerDeviceInfo;
  /** Multitouch geometry of an open touchpad (EVIOCGABS/EVIOCGPROP), or null. */
  touchpad?(fd: number): TouchpadGeometry | null;
};

/** Timers and the clock evdev timestamps use (CLOCK_REALTIME), replaceable in smokes. */
export type PointerClock = ButtonTimers & { now(): number };

const nodeClock: PointerClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function nativePointerDeviceIo(devices?: SeatDeviceAccess): PointerDeviceIo {
  return {
    open: (path) =>
      devices
        ? devices.open(path)
        : fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK),
    read: (fd, buffer) => fs.readSync(fd, buffer, 0, buffer.length, null),
    close: (fd) => (devices ? devices.close(fd) : fs.closeSync(fd)),
    identity: (fd) => {
      const stat = fs.fstatSync(fd, { bigint: true });
      if (!stat.isCharacterDevice()) throw new Error("Pointer input must be a character device");
      return stat.rdev.toString();
    },
    grab: tryGrab,
    describe: readPointerDeviceInfo,
    touchpad: readTouchpadGeometry,
  };
}

type DeviceState = {
  path: string;
  buf: Buffer;
  pendingDx: number;
  pendingDy: number;
  pendingWheel: number;
  pendingAbsX: number | null;
  pendingAbsY: number | null;
  lastAbsX: number | null;
  lastAbsY: number | null;
  absDirty: boolean;
  absMax: number;
  pendingTimeMs: number;
  traceAbsoluteSource: number | null;
  traceRelativeSource: number | null;
  traceWheelSource: number | null;
  info: PointerDeviceInfo;
  config: PointerDeviceConfig;
  accel: PointerAccelerator;
  middle: MiddleButtonEmulator;
  lastButtonSource: number | null;
  touchpad: TouchpadDriver | null;
};

type TouchpadDriver = {
  geometry: TouchpadGeometry;
  decoder: TouchpadDecoder;
  gestures: TouchpadGestures;
  timer: unknown;
};

function listPointerDevices(): string[] {
  const byPath = "/dev/input/by-path";
  const all = () =>
    fs
      .readdirSync("/dev/input")
      .filter((n) => n.startsWith("event"))
      .map((n) => `/dev/input/${n}`);
  try {
    const links = fs.readdirSync(byPath).filter((n) => n.includes("event-mouse"));
    if (links.length > 0) {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const name of links) {
        const full = fs.realpathSync(`${byPath}/${name}`);
        if (seen.has(full)) continue;
        seen.add(full);
        out.push(full);
      }
      // udev links touchpads (ID_INPUT_TOUCHPAD) as neither mouse nor keyboard, and I2C pads
      // often have no by-path link at all, so add them from their sysfs capabilities.
      for (const device of all())
        if (!seen.has(device) && readPointerDeviceInfo(device).kind === "touchpad")
          out.push(device);
      return out;
    }
  } catch {
    // fall through
  }
  return all();
}

function norm(v: number, max: number): number {
  return Math.min(1, Math.max(0, v / max));
}

export class EvdevPointer extends EventEmitter {
  private devices = new Map<number, DeviceState>();
  private loggedFirstAbs = false;
  private loggedFirstRel = false;

  private fixtureTrace: InputFixtureTrace | null = null;
  private readonly io: PointerDeviceIo;
  constructor(
    private readonly readiness: Pick<LinuxReadinessDispatcher, "add" | "remove">,
    private readonly deviceIo?: PointerDeviceIo,
    private readonly clock: PointerClock = nodeClock,
  ) {
    super();
    this.io = deviceIo ?? nativePointerDeviceIo();
  }

  setInputFixtureTrace(trace: InputFixtureTrace): void {
    this.fixtureTrace = trace;
  }

  private observe(callback: (trace: InputFixtureTrace) => void): void {
    const trace = this.fixtureTrace;
    if (!trace) return;
    try {
      if (trace.active()) callback(trace);
    } catch {
      this.fixtureTrace = null;
      try {
        trace.stop("io-error");
      } catch {
        /* Diagnostics cannot interrupt input. */
      }
    }
  }

  private forward(
    name: "absolute" | "motion" | "button" | "axis",
    event: EvdevPointerAbsolute | EvdevPointerMotion | EvdevPointerButton | EvdevPointerAxis,
    source: number | null,
  ): void {
    this.observe((trace) => trace.link(event, source));
    this.emit(name, event);
  }

  start(paths?: string[]): void {
    if (!this.deviceIo) assertLinux("evdev");
    const candidates = paths ?? listPointerDevices();

    for (const p of candidates) {
      try {
        const fd = this.io.open(p);
        this.io.grab(fd, p);
        let info = this.io.describe?.(p) ?? classifyPointerDevice(p, {});
        const geometry = info.kind === "touchpad" ? (this.io.touchpad?.(fd) ?? null) : null;
        if (geometry) info = { ...info, clickpad: geometry.clickpad };
        const config = { ...NEUTRAL_POINTER_CONFIG };
        const dev: DeviceState = {
          path: p,
          buf: Buffer.alloc(0),
          pendingDx: 0,
          pendingDy: 0,
          pendingWheel: 0,
          pendingAbsX: null,
          pendingAbsY: null,
          lastAbsX: null,
          lastAbsY: null,
          absDirty: false,
          absMax: DEFAULT_ABS_MAX,
          pendingTimeMs: 0,
          traceAbsoluteSource: null,
          traceRelativeSource: null,
          traceWheelSource: null,
          info,
          config,
          accel: createPointerAccelerator(config.accelProfile, config.accelSpeed),
          middle: new MiddleButtonEmulator(() => {}),
          lastButtonSource: null,
          touchpad: geometry
            ? {
                geometry,
                decoder: new TouchpadDecoder(geometry),
                // Neutral until prefs are applied, like a mouse: no tapping or scrolling yet.
                gestures: new TouchpadGestures(geometry, {
                  tap: false,
                  scrollMethod: "none",
                  naturalScroll: false,
                  kineticScroll: false,
                  disableWhileTyping: false,
                  clickMethod: "areas",
                }),
                timer: null,
              }
            : null,
        };
        dev.middle = this.middleEmulator(dev);
        this.devices.set(fd, dev);
        this.readiness.add(fd, () => this.poll());
        console.log(
          `[evdev] pointer opened ${p} fd=${fd} kind=${info.kind} relative=${info.relative}${geometry ? ` multitouch slots=${geometry.slots} clickpad=${geometry.clickpad}` : ""}`,
        );
        this.emit("device", this.configTarget(dev));
      } catch {
        // skip
      }
    }

    if (this.devices.size === 0) {
      console.warn("[evdev] no pointer devices opened — pointer disabled");
      return;
    }
  }

  /** Every open device, for re-applying prefs when they change. */
  configTargets(): PointerDeviceConfigTarget[] {
    return [...this.devices.values()].map((dev) => this.configTarget(dev));
  }

  private configTarget(dev: DeviceState): PointerDeviceConfigTarget {
    const supports = (option: PointerConfigOption) =>
      dev.touchpad ? touchpadSupports(dev.touchpad.geometry, option) : evdevSupports(dev.info, option);
    return {
      info: dev.info,
      supports,
      set: (option, value) => {
        if (!supports(option)) return;
        dev.config = { ...dev.config, [option]: value };
        if (dev.touchpad) {
          const { config } = dev;
          this.touchpadOutputs(
            dev,
            dev.touchpad.gestures.configure(
              {
                tap: config.tap,
                scrollMethod: config.scrollMethod,
                naturalScroll: config.naturalScroll,
                kineticScroll: config.kineticScroll,
                clickMethod: config.clickMethod,
                disableWhileTyping: config.disableWhileTyping,
                leftHanded: config.leftHanded,
                accelSpeed: config.accelSpeed,
                accelProfile: config.accelProfile,
              },
              this.clock.now(),
            ),
          );
          return;
        }
        if (option === "accelSpeed" || option === "accelProfile")
          dev.accel = createPointerAccelerator(dev.config.accelProfile, dev.config.accelSpeed);
        if (option === "middleEmulation" && !value) dev.middle.flush();
      },
    };
  }

  private middleEmulator(dev: DeviceState): MiddleButtonEmulator {
    return new MiddleButtonEmulator((code, value, timeMs) =>
      this.forward(
        "button",
        { code, value, timeMs } satisfies EvdevPointerButton,
        dev.lastButtonSource,
      ),
    );
  }

  /**
   * A keyboard key, for disable-while-typing on touchpads. Called by the seat with the same
   * evdev timestamps the pads use.
   */
  noteKeyboard(ev: { code: number; value: number; timeMs: number }): void {
    for (const dev of this.devices.values()) dev.touchpad?.gestures.key(ev.code, ev.value, ev.timeMs);
  }

  private touchpadOutputs(dev: DeviceState, outputs: readonly TouchpadOutput[]): void {
    for (const output of outputs) {
      if (output.kind === "motion")
        this.forward("motion", { dx: output.dx, dy: output.dy, timeMs: output.timeMs }, null);
      else if (output.kind === "button")
        this.forward("button", { code: output.code, value: output.value, timeMs: output.timeMs }, dev.lastButtonSource);
      else {
        const source = output.source === "kinetic" ? "kinetic" : "finger";
        // Wheel convention: positive is up, so a view moving down (+dy) is a negative value.
        if (output.dy)
          this.forward(
            "axis",
            { value: -output.dy / PX_PER_WHEEL_CLICK, timeMs: output.timeMs, axis: "vertical", source },
            null,
          );
        if (output.dx)
          this.forward(
            "axis",
            { value: output.dx / PX_PER_WHEEL_CLICK, timeMs: output.timeMs, axis: "horizontal", source },
            null,
          );
      }
    }
    this.scheduleTouchpad(dev);
  }

  /** Arm the gesture machine's next deadline (tap release, kinetic frame). */
  private scheduleTouchpad(dev: DeviceState): void {
    const driver = dev.touchpad;
    if (!driver) return;
    if (driver.timer !== null) this.clock.clearTimeout(driver.timer);
    driver.timer = null;
    const deadline = driver.gestures.deadline();
    if (deadline === null) return;
    driver.timer = this.clock.setTimeout(
      () => {
        driver.timer = null;
        this.touchpadOutputs(dev, driver.gestures.tick(Math.max(deadline, this.clock.now())));
      },
      Math.max(0, deadline - this.clock.now()),
    );
  }

  private releaseTouchpad(dev: DeviceState): void {
    const driver = dev.touchpad;
    if (!driver) return;
    if (driver.timer !== null) this.clock.clearTimeout(driver.timer);
    driver.timer = null;
    for (const output of driver.gestures.reset(this.clock.now()))
      if (output.kind === "button")
        this.forward("button", { code: output.code, value: output.value, timeMs: output.timeMs }, null);
    driver.decoder = new TouchpadDecoder(driver.geometry);
  }

  stop(): void {
    for (const dev of this.devices.values()) {
      dev.middle.reset();
      this.releaseTouchpad(dev);
    }
    for (const fd of this.devices.keys()) {
      this.readiness.remove(fd);
      try {
        this.io.close(fd);
      } catch {
        // ok
      }
    }
    this.devices.clear();
  }

  private flush(dev: DeviceState): void {
    if (dev.absDirty) {
      const ax = dev.pendingAbsX ?? dev.lastAbsX;
      const ay = dev.pendingAbsY ?? dev.lastAbsY;
      if (ax != null && ay != null) {
        if (dev.pendingAbsX != null) dev.lastAbsX = dev.pendingAbsX;
        if (dev.pendingAbsY != null) dev.lastAbsY = dev.pendingAbsY;
        this.forward(
          "absolute",
          {
            x: norm(ax, dev.absMax),
            y: norm(ay, dev.absMax),
            timeMs: dev.pendingTimeMs,
          } satisfies EvdevPointerAbsolute,
          dev.traceAbsoluteSource,
        );
        if (!this.loggedFirstAbs) {
          this.loggedFirstAbs = true;
          console.log(
            `[evdev] absolute pointer ${ax},${ay} → ${(norm(ax, dev.absMax) * 100) | 0}%,${(norm(ay, dev.absMax) * 100) | 0}%`,
          );
        }
      }
      dev.pendingAbsX = null;
      dev.pendingAbsY = null;
      dev.absDirty = false;
      dev.traceAbsoluteSource = null;
    } else if (dev.pendingDx !== 0 || dev.pendingDy !== 0) {
      dev.middle.flush();
      const motion = dev.accel.filter(dev.pendingDx, dev.pendingDy, dev.pendingTimeMs);
      if (motion.dx !== 0 || motion.dy !== 0)
        this.forward(
          "motion",
          {
            dx: motion.dx,
            dy: motion.dy,
            timeMs: dev.pendingTimeMs,
          } satisfies EvdevPointerMotion,
          dev.traceRelativeSource,
        );
      if (!this.loggedFirstRel) {
        this.loggedFirstRel = true;
        console.log(`[evdev] relative pointer dx=${dev.pendingDx} dy=${dev.pendingDy}`);
      }
      dev.pendingDx = 0;
      dev.pendingDy = 0;
      dev.traceRelativeSource = null;
    }
    if (dev.pendingWheel !== 0) {
      dev.middle.flush();
      this.forward(
        "axis",
        {
          value: dev.config.naturalScroll ? -dev.pendingWheel : dev.pendingWheel,
          timeMs: dev.pendingTimeMs,
        } satisfies EvdevPointerAxis,
        dev.traceWheelSource,
      );
      dev.pendingWheel = 0;
      dev.traceWheelSource = null;
    }
  }

  private poll(): void {
    // Collected outside the loop — reopening mutates `this.devices`, which
    // we're iterating, so do it after rather than mid-iteration.
    const toReopen: { fd: number; dev: DeviceState }[] = [];
    for (const [fd, dev] of this.devices) {
      try {
        const chunk = Buffer.alloc(INPUT_EVENT_SIZE * 16);
        const n = this.io.read(fd, chunk);
        if (n <= 0) continue;
        let buf = Buffer.concat([dev.buf, chunk.subarray(0, n)]);
        while (buf.length >= INPUT_EVENT_SIZE) {
          const raw = buf.subarray(0, INPUT_EVENT_SIZE);
          buf = buf.subarray(INPUT_EVENT_SIZE);
          const type = raw.readUInt16LE(16);
          const code = raw.readUInt16LE(18);
          const value = raw.readInt32LE(20);
          const sec = Number(raw.readBigUInt64LE(0));
          const usec = Number(raw.readBigUInt64LE(8));
          const timeMs = sec * 1000 + Math.floor(usec / 1000);
          if (this.listenerCount("rawPointer") > 0 && isScrollPointerEvent(type, code)) {
            this.emit("rawPointer", { stage: "raw", device: dev.path, type, code, value, timeMs });
          }
          let source: number | null = null;
          if (type === EV_KEY || isScrollPointerEvent(type, code))
            this.observe((trace) => {
              const rdev = this.io.identity(fd);
              source = trace.write({
                layer: "raw-pointer",
                device: { path: dev.path, rdev, fd },
                type,
                code,
                value,
                timeMs,
              });
            });
          if (dev.touchpad) {
            if (type === EV_KEY) dev.lastButtonSource = source;
            const frame = dev.touchpad.decoder.push(type, code, value, timeMs);
            if (frame) this.touchpadOutputs(dev, dev.touchpad.gestures.frame(frame));
            continue;
          }
          if (type === EV_ABS && (code === ABS_X || code === ABS_Y))
            dev.traceAbsoluteSource = source;
          if (type === EV_REL && (code === REL_X || code === REL_Y))
            dev.traceRelativeSource = source;
          if (type === EV_REL && code === REL_WHEEL) dev.traceWheelSource = source;
          dev.pendingTimeMs = timeMs;

          if (type === EV_ABS) {
            if (code === ABS_X) {
              dev.pendingAbsX = value;
              dev.absDirty = true;
            } else if (code === ABS_Y) {
              dev.pendingAbsY = value;
              dev.absDirty = true;
            }
          } else if (type === EV_REL) {
            if (code === REL_X) dev.pendingDx += value;
            else if (code === REL_Y) dev.pendingDy += value;
            else if (code === REL_WHEEL) dev.pendingWheel += value;
          } else if (type === EV_KEY) {
            if (code === BTN_LEFT || code === BTN_RIGHT || code === BTN_MIDDLE) {
              this.flush(dev);
              const mapped = swapHandedButton(code, dev.config.leftHanded);
              dev.lastButtonSource = source;
              if (dev.config.middleEmulation) dev.middle.button(mapped, value, timeMs);
              else
                this.forward(
                  "button",
                  {
                    code: mapped,
                    value,
                    timeMs,
                  } satisfies EvdevPointerButton,
                  source,
                );
            }
          } else if (type === EV_SYN && code === SYN_REPORT) {
            this.flush(dev);
          }
        }
        dev.buf = buf;
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "EAGAIN" || e.code === "EWOULDBLOCK") continue;
        // Anything else (e.g. EBADF from a stale fd after a device replug)
        // previously went completely silent here — the device would just
        // stop being polled forever, with no error, no recovery, and
        // whatever gesture was in flight (e.g. a drag) would never see its
        // terminating event. Log it and try to reopen the device path.
        console.warn(`[evdev] poll error on ${dev.path} (fd=${fd}): ${e.code ?? e.message ?? e}`);
        toReopen.push({ fd, dev });
      }
    }
    for (const { fd, dev } of toReopen) this.reopenDevice(fd, dev);
  }

  private reopenDevice(oldFd: number, dev: DeviceState): void {
    this.releaseTouchpad(dev);
    this.devices.delete(oldFd);
    this.readiness.remove(oldFd);
    try {
      this.io.close(oldFd);
    } catch {
      // already gone
    }
    try {
      const newFd = this.io.open(dev.path);
      this.io.grab(newFd, dev.path);
      dev.middle.reset();
      // Same state object: config targets handed out earlier keep applying to this device.
      Object.assign(dev, {
        buf: Buffer.alloc(0),
        pendingDx: 0,
        pendingDy: 0,
        pendingWheel: 0,
        traceAbsoluteSource: null,
        traceRelativeSource: null,
        traceWheelSource: null,
        lastButtonSource: null,
      });
      this.devices.set(newFd, dev);
      this.readiness.add(newFd, () => this.poll());
      console.log(`[evdev] reopened ${dev.path} as fd=${newFd}`);
    } catch (err) {
      console.warn(`[evdev] failed to reopen ${dev.path}:`, err);
      this.emit("deviceRemoved", dev.info);
    }
  }
}
