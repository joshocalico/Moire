/**
 * Minimal evdev pointer reader.
 * Parallels Virtual Mouse primarily emits ABS_X/ABS_Y (tablet), not REL_X/REL_Y.
 */
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { assertLinux } from "./platform";
import { getLibc } from "./libc";
import { LinuxReadinessDispatcher } from "./readiness";

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
  value: number;
  timeMs: number;
};

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
};

function listPointerDevices(): string[] {
  const byPath = "/dev/input/by-path";
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
      return out;
    }
  } catch {
    // fall through
  }
  return fs
    .readdirSync("/dev/input")
    .filter((n) => n.startsWith("event"))
    .map((n) => `/dev/input/${n}`);
}

function norm(v: number, max: number): number {
  return Math.min(1, Math.max(0, v / max));
}

export class EvdevPointer extends EventEmitter {
  private devices = new Map<number, DeviceState>();
  private loggedFirstAbs = false;
  private loggedFirstRel = false;

  constructor(private readonly readiness: LinuxReadinessDispatcher) {
    super();
  }

  start(paths?: string[]): void {
    assertLinux("evdev");
    const candidates = paths ?? listPointerDevices();

    for (const p of candidates) {
      try {
        const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        tryGrab(fd, p);
        this.devices.set(fd, {
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
        });
        this.readiness.add(fd, () => this.poll());
        console.log(`[evdev] pointer opened ${p} fd=${fd}`);
      } catch {
        // skip
      }
    }

    if (this.devices.size === 0) {
      console.warn("[evdev] no pointer devices opened — pointer disabled");
      return;
    }
  }

  stop(): void {
    for (const fd of this.devices.keys()) {
      this.readiness.remove(fd);
      try {
        fs.closeSync(fd);
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
        this.emit("absolute", {
          x: norm(ax, dev.absMax),
          y: norm(ay, dev.absMax),
          timeMs: dev.pendingTimeMs,
        } satisfies EvdevPointerAbsolute);
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
    } else if (dev.pendingDx !== 0 || dev.pendingDy !== 0) {
      this.emit("motion", {
        dx: dev.pendingDx,
        dy: dev.pendingDy,
        timeMs: dev.pendingTimeMs,
      } satisfies EvdevPointerMotion);
      if (!this.loggedFirstRel) {
        this.loggedFirstRel = true;
        console.log(`[evdev] relative pointer dx=${dev.pendingDx} dy=${dev.pendingDy}`);
      }
      dev.pendingDx = 0;
      dev.pendingDy = 0;
    }
    if (dev.pendingWheel !== 0) {
      this.emit("axis", {
        value: dev.pendingWheel,
        timeMs: dev.pendingTimeMs,
      } satisfies EvdevPointerAxis);
      dev.pendingWheel = 0;
    }
  }

  private poll(): void {
    // Collected outside the loop — reopening mutates `this.devices`, which
    // we're iterating, so do it after rather than mid-iteration.
    const toReopen: { fd: number; dev: DeviceState }[] = [];
    for (const [fd, dev] of this.devices) {
      try {
        const chunk = Buffer.alloc(INPUT_EVENT_SIZE * 16);
        const n = fs.readSync(fd, chunk, 0, chunk.length, null);
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
              this.emit("button", {
                code,
                value,
                timeMs,
              } satisfies EvdevPointerButton);
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
    this.devices.delete(oldFd);
    this.readiness.remove(oldFd);
    try {
      fs.closeSync(oldFd);
    } catch {
      // already gone
    }
    try {
      const newFd = fs.openSync(dev.path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      tryGrab(newFd, dev.path);
      this.devices.set(newFd, {
        ...dev,
        buf: Buffer.alloc(0),
        pendingDx: 0,
        pendingDy: 0,
        pendingWheel: 0,
      });
      this.readiness.add(newFd, () => this.poll());
      console.log(`[evdev] reopened ${dev.path} as fd=${newFd}`);
    } catch (err) {
      console.warn(`[evdev] failed to reopen ${dev.path}:`, err);
    }
  }
}
