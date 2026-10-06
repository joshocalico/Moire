import fs from "node:fs";
import { bindNativeFunction } from "./ffi";
import { getLibc, ioctlFd, O_CLOEXEC } from "./libc";
import { assertLinux } from "./platform";

const KDGETMODE = 0x4b3b;
const KDSETMODE = 0x4b3a;
const VT_GETSTATE = 0x5603;
const KD_TEXT = 0;
const KD_GRAPHICS = 1;

/** Guardian-owned VT lease. Never opens or retains the renderer's DRM device. */
export function openBootConsole({ ttyPath }: { ttyPath: string }): {
  enterGraphics(): void;
  restore(): void;
  close(): void;
} {
  assertLinux("boot console");
  const match = /^\/dev\/tty([1-9][0-9]*)$/.exec(ttyPath);
  if (!match) throw new Error("Boot presentation requires a numbered Linux VT");
  const vt = Number(match[1]);
  const fd = fs.openSync(ttyPath, fs.constants.O_RDWR | O_CLOEXEC);
  // Scalar-argument ioctls must not use the pointer-argument libc wrapper.
  const scalarIoctl = bindNativeFunction<(fd: number, request: number, value: number) => number>(
    getLibc(),
    "int ioctl(int fd, unsigned long request, unsigned long value)",
  );
  let graphics = false;
  let closed = false;
  const setMode = (mode: number) => {
    if (scalarIoctl(fd, KDSETMODE, mode) !== 0)
      throw new Error(`KDSETMODE(${mode}) failed for ${ttyPath}`);
  };
  try {
    const state = Buffer.alloc(6);
    const mode = Buffer.alloc(4);
    if (ioctlFd(fd, VT_GETSTATE, state) !== 0 || ioctlFd(fd, KDGETMODE, mode) !== 0)
      throw new Error(`Cannot inspect boot VT ${ttyPath}`);
    if (state.readUInt16LE(0) !== vt || mode.readInt32LE(0) !== KD_TEXT)
      throw new Error(
        "Boot presentation requires the active text VT; another display owner may exist",
      );
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
  const restore = () => {
    if (closed || !graphics) return;
    // Child must have exited and closed its DRM FDs first. KD_TEXT asks the
    // kernel console driver to unblank/redraw, not a synthetic log screen.
    setMode(KD_TEXT);
    graphics = false;
  };
  return {
    enterGraphics() {
      if (closed) throw new Error("Boot console lease is closed");
      if (graphics) return;
      // Arm a verified independent Escape source before this operation.
      const state = Buffer.alloc(6);
      const mode = Buffer.alloc(4);
      if (
        ioctlFd(fd, VT_GETSTATE, state) !== 0 ||
        ioctlFd(fd, KDGETMODE, mode) !== 0 ||
        state.readUInt16LE(0) !== vt ||
        mode.readInt32LE(0) !== KD_TEXT
      )
        throw new Error("Boot VT changed before graphics acquisition");
      setMode(KD_GRAPHICS);
      graphics = true;
    },
    restore,
    close() {
      if (closed) return;
      try {
        restore();
      } finally {
        fs.closeSync(fd);
        closed = true;
      }
    },
  };
}
