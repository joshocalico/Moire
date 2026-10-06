import fs from "node:fs";
import type { SeatDeviceAccess } from "./seat";
import koffi from "koffi";
import { bindNativeFunction } from "./ffi";
import { getLibc, ioctlFd, O_CLOEXEC } from "./libc";
import { assertLinux } from "./platform";

const EVIOCGBIT_KEYS = 0x80604521;
const EVIOCGBIT_TYPES = 0x80084520;
const EVIOCGRAB = 0x40044590;
const EVIOCGKEY = 0x80604518;
const F_GETFD = 1;
const FD_CLOEXEC = 1;

export class KeyboardGrabError extends Error {
  constructor(readonly errno: number) {
    super(`Cannot exclusively acquire keyboard input (errno ${errno})`);
  }
}

export interface KeyboardDeviceIo {
  open(path: string): number;
  identity(fd: number): string;
  close(fd: number): void;
  read(fd: number, buffer: Buffer): number;
  keyBits(fd: number): Buffer;
  eventBits(fd: number): Buffer;
  heldKeyBits(fd: number): Buffer;
  grab(fd: number): void;
}

export function hasKey(bits: Uint8Array, key: number) {
  return ((bits[Math.floor(key / 8)] ?? 0) & (1 << (key % 8))) !== 0;
}

/** A typing keyboard, rather than a pointer/media EV_KEY device. */
export function isTypingKeyboard(bits: Uint8Array) {
  return (
    hasKey(bits, 30) &&
    hasKey(bits, 46) &&
    hasKey(bits, 28) &&
    (hasKey(bits, 29) || hasKey(bits, 97))
  );
}

/** Linux VT keyboard handler matches ordinary keys and braille-dot keys. */
export function hasVtRoutableKeys(bits: Uint8Array) {
  for (let key = 1; key < 0x100; key++) if (hasKey(bits, key)) return true;
  for (let key = 0x1f1; key <= 0x1fa; key++) if (hasKey(bits, key)) return true;
  return false;
}

export function nativeKeyboardDeviceIo(devices?: SeatDeviceAccess): KeyboardDeviceIo {
  assertLinux("evdev keyboard");
  const scalarIoctl = bindNativeFunction<(fd: number, request: number, value: number) => number>(
    getLibc(),
    "int ioctl(int fd, unsigned long request, unsigned long value)",
  );
  const fcntl = bindNativeFunction<(fd: number, command: number) => number>(
    getLibc(),
    "int fcntl(int fd, int command)",
  );
  return {
    open(path) {
      return devices
        ? devices.open(path)
        : fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | O_CLOEXEC);
    },
    identity(fd) {
      const stat = fs.fstatSync(fd, { bigint: true });
      if (!stat.isCharacterDevice()) throw new Error("Keyboard input must be a character device");
      return stat.rdev.toString();
    },
    close(fd) {
      if (devices) devices.close(fd);
      else fs.closeSync(fd);
    },
    read(fd, buffer) {
      return fs.readSync(fd, buffer, 0, buffer.length, null);
    },
    keyBits(fd) {
      const bits = Buffer.alloc(96);
      if (ioctlFd(fd, EVIOCGBIT_KEYS, bits) < 1)
        throw new Error("Cannot inspect keyboard key capabilities");
      return bits;
    },
    eventBits(fd) {
      const bits = Buffer.alloc(8);
      if (ioctlFd(fd, EVIOCGBIT_TYPES, bits) < 1)
        throw new Error("Cannot inspect keyboard event types");
      return bits;
    },
    heldKeyBits(fd) {
      const bits = Buffer.alloc(96);
      if (ioctlFd(fd, EVIOCGKEY, bits) < 0) throw new Error("Cannot inspect held keyboard keys");
      return bits;
    },
    grab(fd) {
      const flags = fcntl(fd, F_GETFD);
      if (flags < 0 || (flags & FD_CLOEXEC) === 0)
        throw new Error("Exclusive keyboard descriptor must be close-on-exec");
      // Linux evdev interprets the scalar argument, not an int pointer.
      if (scalarIoctl(fd, EVIOCGRAB, 1) !== 0) throw new KeyboardGrabError(koffi.errno());
    },
  };
}

/** Acquire before readiness registration/publication. Close releases the kernel grab. */
export function openKeyboardDevice(
  path: string,
  options: { requireEscape?: boolean; exclusive?: boolean },
  io: KeyboardDeviceIo,
  ownedIdentities: ReadonlySet<string> = new Set(),
) {
  const fd = io.open(path);
  try {
    const identity = io.identity(fd);
    if (ownedIdentities.has(identity)) {
      io.close(fd);
      return null;
    }
    let typing = false;
    if (options.exclusive || options.requireEscape) {
      const bits = io.keyBits(fd);
      typing = isTypingKeyboard(bits);
      if (options.exclusive && !hasVtRoutableKeys(bits)) {
        io.close(fd);
        return null;
      }
      if (options.exclusive) {
        const types = io.eventBits(fd);
        if (
          hasKey(types, 2) ||
          hasKey(types, 3) ||
          [0x110, 0x111, 0x112].some((key) => hasKey(bits, key))
        )
          throw new Error(
            "Mixed keyboard/pointer devices are unsupported for exclusive desktop input",
          );
      }
      if (options.requireEscape && !hasKey(bits, 1))
        throw new Error("Input device does not advertise KEY_ESC");
    }
    if (options.exclusive) {
      if (hasVtRoutableKeys(io.heldKeyBits(fd)))
        throw new Error("Release held VT keys before exclusive input acquisition");
      io.grab(fd);
      if (hasVtRoutableKeys(io.heldKeyBits(fd)))
        throw new Error("VT key became held during exclusive input acquisition");
    }
    return { fd, typing, identity };
  } catch (error) {
    io.close(fd);
    throw error;
  }
}
