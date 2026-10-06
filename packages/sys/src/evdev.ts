/**
 * Minimal evdev keyboard reader (no libinput yet).
 */
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { assertLinux } from "./platform";
import { LinuxReadinessDispatcher } from "./readiness";
import type { InputFixtureTrace, InputFixtureObservation } from "./input-fixture-trace";
import { KeyboardEventFilter } from "./keyboard-events";
import { nativeKeyboardDeviceIo, openKeyboardDevice, type KeyboardDeviceIo } from "./keyboard-grab";

const EV_KEY = 0x01;
// aarch64 / x86_64: timeval is 16 bytes, then type/code/value = 8 → 24
const INPUT_EVENT_SIZE = 24;
type ReadErrorCode = Extract<
  InputFixtureObservation,
  { layer: "keyboard-read-error" }
>["errorCode"];
type ReadErrorPhase = Extract<InputFixtureObservation, { layer: "keyboard-read-error" }>["phase"];
type FixtureDevice = Extract<InputFixtureObservation, { layer: "keyboard-read" }>["device"];
function readErrorCode(error: unknown): ReadErrorCode {
  const code = error instanceof Error && "code" in error ? error.code : null;
  return code === "EIO" || code === "EBADF" || code === "ENODEV" ? code : "OTHER";
}

export type EvdevKeyEvent = {
  code: number;
  /** 0 release, 1 press, 2 repeat */
  value: number;
  timeMs: number;
};

function listKeyboardDevices(includeAll = false): string[] {
  const found = new Set<string>();
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
      if (!includeAll) return out;
      for (const path of out) found.add(path);
    }
  } catch {
    // fall through
  }
  for (const name of fs.readdirSync("/dev/input").filter((n) => /^event\d+$/.test(n)))
    found.add(fs.realpathSync(`/dev/input/${name}`));
  return [...found];
}

export class EvdevKeyboard extends EventEmitter {
  private fds: number[] = [];
  private buffers = new Map<number, Buffer>();
  private paths = new Map<number, string>();
  private typingFds = new Set<number>();
  private identities = new Map<number, string>();
  private recent = new KeyboardEventFilter();
  private fixtureTrace: InputFixtureTrace | null = null;

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

  private fixtureDevice(trace: InputFixtureTrace, fd: number): FixtureDevice | null {
    const path = this.paths.get(fd),
      rdev = this.identities.get(fd);
    if (path === undefined || rdev === undefined) {
      trace.stop("identity");
      return null;
    }
    return { path, rdev, fd };
  }

  private observeRead(
    fd: number,
    bytes: number,
    pendingBytes: number,
    buffer: Buffer,
  ): number | null {
    let ordinal: number | null = null;
    this.observe((trace) => {
      const device = this.fixtureDevice(trace, fd);
      if (!device) return;
      const completeRecords = Math.floor(buffer.length / INPUT_EVENT_SIZE);
      const keyEdges: { code: number; value: number }[] = [];
      let syncRecords = 0,
        droppedSyncRecords = 0,
        otherRecords = 0;
      for (
        let offset = 0;
        offset < completeRecords * INPUT_EVENT_SIZE;
        offset += INPUT_EVENT_SIZE
      ) {
        const type = buffer.readUInt16LE(offset + 16);
        if (type === EV_KEY)
          keyEdges.push({
            code: buffer.readUInt16LE(offset + 18),
            value: buffer.readInt32LE(offset + 20),
          });
        else if (type === 0) {
          syncRecords++;
          if (buffer.readUInt16LE(offset + 18) === 3) droppedSyncRecords++;
        } else otherRecords++;
      }
      ordinal = trace.write({
        layer: "keyboard-read",
        device,
        bytes,
        pendingBytes,
        completeRecords,
        trailingBytes: buffer.length % INPUT_EVENT_SIZE,
        keyEdges,
        syncRecords,
        droppedSyncRecords,
        otherRecords,
      });
    });
    return ordinal;
  }

  private observeReadError(
    fd: number,
    phase: ReadErrorPhase,
    errorCode: ReadErrorCode,
    bytes: number,
    pendingBytes: number,
    unprocessedBytes: number,
    batchOrdinal: number | null,
  ): void {
    this.observe((trace) => {
      const device = this.fixtureDevice(trace, fd);
      if (device)
        trace.write(
          {
            layer: "keyboard-read-error",
            device,
            phase,
            errorCode,
            bytes,
            pendingBytes,
            unprocessedBytes,
          },
          batchOrdinal,
        );
    });
  }

  constructor(
    private readonly readiness: Pick<LinuxReadinessDispatcher, "add" | "remove">,
    private readonly deviceIo?: KeyboardDeviceIo,
  ) {
    super();
  }

  get openedDevices(): readonly string[] {
    return [...this.paths.values()];
  }

  private requireEscape = false;
  private exclusive = false;
  private failed = false;
  private io: KeyboardDeviceIo | null = null;

  start(paths?: string[], options: { requireEscape?: boolean; exclusive?: boolean } = {}): void {
    if (!this.deviceIo) assertLinux("evdev");
    if (this.fds.length) throw new Error("Evdev keyboard already started");
    this.io = this.deviceIo ?? nativeKeyboardDeviceIo();
    this.requireEscape = options.requireEscape ?? false;
    this.exclusive = options.exclusive ?? false;
    this.failed = false;
    const candidates = paths ?? listKeyboardDevices(this.exclusive);
    let typingKeyboards = 0;

    for (const p of candidates) {
      try {
        const opened = openKeyboardDevice(p, options, this.io, new Set(this.identities.values()));
        if (opened === null) continue;
        const { fd, typing } = opened;
        try {
          this.readiness.add(fd, () => this.poll());
        } catch (error) {
          this.io.close(fd);
          throw error;
        }
        this.fds.push(fd);
        this.buffers.set(fd, Buffer.alloc(0));
        this.paths.set(fd, p);
        this.identities.set(fd, opened.identity);
        if (typing) {
          typingKeyboards++;
          this.typingFds.add(fd);
        }
        console.log(`[evdev] opened ${p} fd=${fd}`);
      } catch (error) {
        if (this.exclusive) {
          this.failed = true;
          this.stop();
          throw new Error(`Exclusive keyboard startup failed for ${p}`, { cause: error });
        }
        // no permission or not a keyboard — skip
      }
    }

    if (this.exclusive && typingKeyboards === 0) {
      this.failed = true;
      this.stop();
      throw new Error("Exclusive desktop input requires a verified typing keyboard");
    }
    this.emit("devicesChanged", this.openedDevices);
    if (this.fds.length === 0) {
      if (this.exclusive) {
        this.failed = true;
        throw new Error("Exclusive desktop input requires a verified typing keyboard");
      }
      console.warn("[evdev] no input devices opened — keyboard disabled");
      return;
    }
  }

  stop(): void {
    for (const fd of this.fds) {
      this.readiness.remove(fd);
      try {
        this.io?.close(fd);
      } catch {
        // ok
      }
    }
    this.fds = [];
    this.buffers.clear();
    this.paths.clear();
    this.typingFds.clear();
    this.identities.clear();
    this.recent.clear();
    this.emit("devicesChanged", this.openedDevices);
  }

  private emitKey(ev: EvdevKeyEvent, source: number): void {
    const accepted = this.recent.accept(source, ev);
    this.observe((trace) => {
      const path = this.paths.get(source),
        rdev = this.identities.get(source);
      if (path === undefined || rdev === undefined) {
        trace.stop("identity");
        return;
      }
      trace.write(
        { layer: "keyboard-filter", device: { path, rdev, fd: source }, ...ev, accepted },
        trace.sourceOf(ev),
      );
    });
    if (accepted) this.emit("key", ev);
  }

  private poll(): void {
    const toReopen: { fd: number; path: string }[] = [];
    for (const fd of this.fds) {
      let phase: ReadErrorPhase = "read",
        bytes = 0;
      const pendingBytes = this.buffers.get(fd)?.length ?? 0;
      let unprocessedBytes = pendingBytes,
        batchOrdinal: number | null = null,
        eofObserved = false;
      try {
        const chunk = Buffer.alloc(INPUT_EVENT_SIZE * 8);
        const n = this.io?.read(fd, chunk) ?? 0;
        bytes = n;
        if (n <= 0) {
          batchOrdinal = this.observeRead(
            fd,
            n,
            pendingBytes,
            this.buffers.get(fd) ?? Buffer.alloc(0),
          );
          this.observeReadError(fd, "read", "EOF", 0, pendingBytes, pendingBytes, batchOrdinal);
          eofObserved = true;
          if (this.exclusive) throw new Error("Exclusive keyboard stream ended");
          continue;
        }
        phase = "frame";
        unprocessedBytes = pendingBytes + n;
        let buf = Buffer.concat([this.buffers.get(fd)!, chunk.subarray(0, n)]);
        batchOrdinal = this.observeRead(fd, n, pendingBytes, buf);
        while (buf.length >= INPUT_EVENT_SIZE) {
          phase = "frame";
          unprocessedBytes = buf.length;
          const ev = buf.subarray(0, INPUT_EVENT_SIZE);
          buf = buf.subarray(INPUT_EVENT_SIZE);
          const type = ev.readUInt16LE(16);
          const code = ev.readUInt16LE(18);
          const value = ev.readInt32LE(20);
          const sec = Number(ev.readBigUInt64LE(0));
          const usec = Number(ev.readBigUInt64LE(8));
          const timeMs = sec * 1000 + Math.floor(usec / 1000);
          const key = { code, value, timeMs };
          if (type === EV_KEY || (type === 0 && code === 3))
            this.observe((trace) => {
              const path = this.paths.get(fd),
                rdev = this.identities.get(fd);
              if (path === undefined || rdev === undefined) {
                trace.stop("identity");
                return;
              }
              const ordinal = trace.write(
                {
                  layer: "raw-keyboard",
                  device: { path, rdev, fd },
                  type,
                  code,
                  value,
                  timeMs,
                },
                batchOrdinal,
              );
              trace.link(key, ordinal);
            });
          phase = "dispatch";
          unprocessedBytes = buf.length;
          if (type === EV_KEY) this.emitKey(key, fd);
        }
        phase = "frame";
        this.buffers.set(fd, buf);
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (
          !eofObserved &&
          !(phase === "read" && (e.code === "EAGAIN" || e.code === "EWOULDBLOCK"))
        ) {
          this.observe((trace) => {
            const device = this.fixtureDevice(trace, fd);
            if (device)
              trace.write(
                {
                  layer: "keyboard-read-error",
                  device,
                  phase,
                  errorCode: readErrorCode(err),
                  bytes,
                  pendingBytes,
                  unprocessedBytes,
                },
                batchOrdinal,
              );
          });
        }
        if (e.code === "EAGAIN" || e.code === "EWOULDBLOCK") continue;
        // Previously silent — a stale fd (device unplugged/replugged) would
        // just stop being polled forever with no error and no recovery,
        // e.g. Escape-to-cancel silently stops working too. Log and reopen.
        const path = this.paths.get(fd) ?? "(unknown)";
        console.warn(`[evdev] poll error on ${path} (fd=${fd}): ${e.code ?? e.message ?? e}`);
        toReopen.push({ fd, path });
      }
    }
    for (const { fd, path } of toReopen) {
      if (this.failed) break;
      this.reopenDevice(fd, path);
    }
  }

  private reopenDevice(oldFd: number, path: string): void {
    let oldDevice: FixtureDevice | null = null;
    this.observe((trace) => {
      oldDevice = this.fixtureDevice(trace, oldFd);
      if (oldDevice)
        trace.write({
          layer: "keyboard-reopen",
          device: oldDevice,
          phase: "attempt",
          errorCode: null,
        });
    });
    const wasTyping = this.typingFds.delete(oldFd);
    this.fds = this.fds.filter((f) => f !== oldFd);
    this.buffers.delete(oldFd);
    this.paths.delete(oldFd);
    this.identities.delete(oldFd);
    this.readiness.remove(oldFd);
    try {
      this.io?.close(oldFd);
    } catch {
      // already gone
    }
    try {
      if (!this.io) throw new Error("Keyboard device backend unavailable");
      const opened = openKeyboardDevice(
        path,
        { requireEscape: this.requireEscape, exclusive: this.exclusive },
        this.io,
        new Set(this.identities.values()),
      );
      if (opened === null) throw new Error("Reopened input no longer has verified VT keys");
      const newFd = opened.fd;
      if (this.exclusive && wasTyping && !opened.typing) {
        this.io.close(newFd);
        throw new Error("Typing keyboard capabilities changed on reopen");
      }
      try {
        this.readiness.add(newFd, () => this.poll());
      } catch (error) {
        this.io.close(newFd);
        throw error;
      }
      this.fds.push(newFd);
      this.buffers.set(newFd, Buffer.alloc(0));
      this.paths.set(newFd, path);
      this.identities.set(newFd, opened.identity);
      if (opened.typing) this.typingFds.add(newFd);
      console.log(`[evdev] reopened ${path} as fd=${newFd}`);
      this.observe((trace) => {
        if (!oldDevice) return;
        trace.write({
          layer: "keyboard-reopen",
          device: oldDevice,
          phase: "success",
          errorCode: null,
        });
        if (newFd !== oldDevice.fd || opened.identity !== oldDevice.rdev) trace.stop("identity");
      });
    } catch (err) {
      this.observe((trace) => {
        if (oldDevice)
          trace.write({
            layer: "keyboard-reopen",
            device: oldDevice,
            phase: "failure",
            errorCode: readErrorCode(err),
          });
      });
      console.warn(`[evdev] failed to reopen ${path}:`, err);
      if (this.exclusive) {
        this.failed = true;
        this.stop();
        this.emit(
          "exclusiveFailure",
          new Error(`Exclusive keyboard reacquisition failed for ${path}`, { cause: err }),
        );
        return;
      }
    }
    this.emit("devicesChanged", this.openedDevices);
  }
}
