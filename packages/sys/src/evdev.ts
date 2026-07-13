/**
 * Minimal evdev keyboard reader (no libinput yet).
 */
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { assertLinux } from "./platform.js";

const EV_KEY = 0x01;
// aarch64 / x86_64: timeval is 16 bytes, then type/code/value = 8 → 24
const INPUT_EVENT_SIZE = 24;

export type EvdevKeyEvent = {
  code: number;
  /** 0 release, 1 press, 2 repeat */
  value: number;
  timeMs: number;
};

function listKeyboardDevices(): string[] {
  const byPath = "/dev/input/by-path";
  try {
    const links = fs.readdirSync(byPath).filter((n) => n.includes("event-kbd"));
    if (links.length > 0) {
      // Prefer a single physical keyboard — first unique target
      const seen = new Set<string>();
      const out: string[] = [];
      for (const name of links) {
        const full = fs.realpathSync(`${byPath}/${name}`);
        if (seen.has(full)) continue;
        seen.add(full);
        out.push(full);
      }
      // Prefer keyboards only; dedupe duplicate usb/usbv3 nodes by realpath.
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

export class EvdevKeyboard extends EventEmitter {
  private fds: number[] = [];
  private buffers = new Map<number, Buffer>();
  private paths = new Map<number, string>();
  private timer: NodeJS.Timeout | null = null;
  private recent = new Map<string, number>();

  start(paths?: string[]): void {
    assertLinux("evdev");
    const candidates = paths ?? listKeyboardDevices();

    for (const p of candidates) {
      try {
        const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        this.fds.push(fd);
        this.buffers.set(fd, Buffer.alloc(0));
        this.paths.set(fd, p);
        console.log(`[evdev] opened ${p} fd=${fd}`);
      } catch {
        // no permission or not a keyboard — skip
      }
    }

    if (this.fds.length === 0) {
      console.warn("[evdev] no input devices opened — keyboard disabled");
      return;
    }

    this.timer = setInterval(() => this.poll(), 8);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const fd of this.fds) {
      try {
        fs.closeSync(fd);
      } catch {
        // ok
      }
    }
    this.fds = [];
    this.buffers.clear();
    this.paths.clear();
    this.recent.clear();
  }

  private emitKey(ev: EvdevKeyEvent): void {
    // Drop duplicates from mirrored keyboard nodes within 30ms
    const key = `${ev.code}:${ev.value}`;
    const prev = this.recent.get(key);
    if (prev != null && Math.abs(ev.timeMs - prev) < 30) return;
    this.recent.set(key, ev.timeMs);
    this.emit("key", ev);
  }

  private poll(): void {
    const toReopen: { fd: number; path: string }[] = [];
    for (const fd of this.fds) {
      try {
        const chunk = Buffer.alloc(INPUT_EVENT_SIZE * 8);
        const n = fs.readSync(fd, chunk, 0, chunk.length, null);
        if (n <= 0) continue;
        let buf = Buffer.concat([this.buffers.get(fd)!, chunk.subarray(0, n)]);
        while (buf.length >= INPUT_EVENT_SIZE) {
          const ev = buf.subarray(0, INPUT_EVENT_SIZE);
          buf = buf.subarray(INPUT_EVENT_SIZE);
          const type = ev.readUInt16LE(16);
          const code = ev.readUInt16LE(18);
          const value = ev.readInt32LE(20);
          const sec = Number(ev.readBigUInt64LE(0));
          const usec = Number(ev.readBigUInt64LE(8));
          if (type === EV_KEY) {
            const timeMs = sec * 1000 + Math.floor(usec / 1000);
            this.emitKey({ code, value, timeMs });
          }
        }
        this.buffers.set(fd, buf);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "EAGAIN" || e.code === "EWOULDBLOCK") continue;
        // Previously silent — a stale fd (device unplugged/replugged) would
        // just stop being polled forever with no error and no recovery,
        // e.g. Escape-to-cancel silently stops working too. Log and reopen.
        const path = this.paths.get(fd) ?? "(unknown)";
        console.warn(`[evdev] poll error on ${path} (fd=${fd}): ${e.code ?? e.message ?? e}`);
        toReopen.push({ fd, path });
      }
    }
    for (const { fd, path } of toReopen) this.reopenDevice(fd, path);
  }

  private reopenDevice(oldFd: number, path: string): void {
    this.fds = this.fds.filter((f) => f !== oldFd);
    this.buffers.delete(oldFd);
    this.paths.delete(oldFd);
    try {
      fs.closeSync(oldFd);
    } catch {
      // already gone
    }
    try {
      const newFd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      this.fds.push(newFd);
      this.buffers.set(newFd, Buffer.alloc(0));
      this.paths.set(newFd, path);
      console.log(`[evdev] reopened ${path} as fd=${newFd}`);
    } catch (err) {
      console.warn(`[evdev] failed to reopen ${path}:`, err);
    }
  }
}
