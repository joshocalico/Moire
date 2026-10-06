import fs from "node:fs";
import { bindNativeFunction } from "./ffi";
import { getLibc, ioctlFd, O_CLOEXEC } from "./libc";
import { assertLinux } from "./platform";
import { revalidateBootOwnerProof, type ExitedOwnersProof } from "./boot-service-cleanup";
import {
  writeBootServiceRecord,
  type BootConsoleRecord,
  type BootServiceLease,
} from "./boot-service-state";

const KDGETMODE = 0x4b3b,
  KDSETMODE = 0x4b3a,
  VT_GETSTATE = 0x5603;
export interface ManagedBootConsole {
  enterGraphics(): void;
  /** Closes this process's VT handle. Never restores the display. */
  closeHandle(): void;
}
/** Injectable ioctl boundary only. Production always uses the recorded numbered VT. */
export interface BootConsoleIo {
  open(ttyPath: string): number;
  inspect(fd: number): { activeVt: number; mode: number; rdev: string };
  setMode(fd: number, mode: 0 | 1): void;
  close(fd: number): void;
}
function nativeConsoleIo(): BootConsoleIo {
  assertLinux("managed boot console");
  const scalarIoctl = bindNativeFunction<(fd: number, request: number, value: number) => number>(
    getLibc(),
    "int ioctl(int fd, unsigned long request, unsigned long value)",
  );
  return {
    open(ttyPath) {
      const fd = fs.openSync(ttyPath, fs.constants.O_RDWR | O_CLOEXEC | fs.constants.O_NOFOLLOW);
      if (!fs.fstatSync(fd).isCharacterDevice()) {
        fs.closeSync(fd);
        throw new Error("Boot VT is not a character device");
      }
      return fd;
    },
    inspect(fd) {
      const state = Buffer.alloc(6),
        mode = Buffer.alloc(4);
      if (ioctlFd(fd, VT_GETSTATE, state) !== 0 || ioctlFd(fd, KDGETMODE, mode) !== 0)
        throw new Error("Cannot inspect recorded boot VT");
      return {
        activeVt: state.readUInt16LE(0),
        mode: mode.readInt32LE(0),
        rdev: String(fs.fstatSync(fd, { bigint: true }).rdev),
      };
    },
    setMode(fd, mode) {
      if (scalarIoctl(fd, KDSETMODE, mode) !== 0) throw new Error(`KDSETMODE(${mode}) failed`);
    },
    close(fd) {
      fs.closeSync(fd);
    },
  };
}
export function openManagedBootConsole(options: {
  ttyPath: string;
  stateDirectory: string;
  base: Omit<BootServiceLease, "phase" | "console" | "reason">;
  io?: BootConsoleIo;
}): ManagedBootConsole {
  const match = /^\/dev\/tty([1-9][0-9]*)$/.exec(options.ttyPath);
  if (!match || !Number.isSafeInteger(Number(match[1])))
    throw new Error("Numbered boot VT required");
  const io = options.io ?? nativeConsoleIo(),
    fd = io.open(options.ttyPath);
  let closed = false,
    graphics = false;
  let consoleRecord: BootConsoleRecord;
  try {
    const initial = io.inspect(fd);
    if (initial.activeVt !== Number(match[1]) || initial.mode !== 0)
      throw new Error("Managed boot requires the active text VT");
    consoleRecord = {
      ttyPath: options.ttyPath,
      vt: Number(match[1]),
      rdev: initial.rdev,
      originalMode: 0,
    };
    writeBootServiceRecord(options.stateDirectory, "lease", {
      ...options.base,
      phase: "armed",
      console: consoleRecord,
    });
  } catch (error) {
    io.close(fd);
    throw error;
  }
  return {
    enterGraphics() {
      if (closed) throw new Error("Managed boot console handle is closed");
      if (graphics) return;
      const current = io.inspect(fd);
      if (
        current.activeVt !== consoleRecord.vt ||
        current.mode !== 0 ||
        current.rdev !== consoleRecord.rdev
      )
        throw new Error("Recorded VT changed before graphics acquisition");
      // Durable intent precedes ioctl, including acquisition crash intervals.
      writeBootServiceRecord(options.stateDirectory, "lease", {
        ...options.base,
        phase: "graphics-intent",
        console: consoleRecord,
      });
      io.setMode(fd, 1);
      graphics = true;
    },
    closeHandle() {
      if (!closed) {
        closed = true;
        io.close(fd);
      }
    },
  };
}
/** No acquisition, DRM, input, process signalling or VT switching API. */
export function releaseBootConsole(
  proof: ExitedOwnersProof,
  io: BootConsoleIo | undefined,
  verifyCurrentLease: () => void,
): void {
  if (!proof.excludeSelf)
    throw new Error("Console release requires the inside-service cleanup proof");
  if (proof.lease.phase !== "graphics-intent")
    throw new Error("Graphics intent is required for console release");
  revalidateBootOwnerProof(proof);
  verifyCurrentLease();
  const recorded = proof.lease.console;
  const consoleIo = io ?? nativeConsoleIo();
  const fd = consoleIo.open(recorded.ttyPath);
  try {
    const verifyConsole = () => {
      const current = consoleIo.inspect(fd);
      if (
        current.activeVt !== recorded.vt ||
        current.rdev !== recorded.rdev ||
        (current.mode !== 0 && current.mode !== 1)
      )
        throw new Error("Recorded VT identity, activity or mode changed");
    };
    verifyConsole();
    revalidateBootOwnerProof(proof);
    verifyCurrentLease();
    verifyConsole();
    consoleIo.setMode(fd, 0);
    const restored = consoleIo.inspect(fd);
    if (restored.activeVt !== recorded.vt || restored.rdev !== recorded.rdev || restored.mode !== 0)
      throw new Error("KD_TEXT readback did not confirm the recorded active VT");
  } finally {
    consoleIo.close(fd);
  }
}
