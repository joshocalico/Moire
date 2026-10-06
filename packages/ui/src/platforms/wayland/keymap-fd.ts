/** Bounded positional reads of compositor-supplied keymap files; no device I/O. */
import fs from "node:fs";
import type { KeymapFdIo } from "./keymap-types";

const maximumBytes = 1024 * 1024;
export const nodeKeymapFdIo: KeymapFdIo = {
  read(fd, size) {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size < size) throw new Error("Invalid keymap file");
    const buffer = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
      const count = fs.readSync(fd, buffer, offset, size - offset, offset);
      if (!count) throw new Error("Incomplete keymap file");
      offset += count;
    }
    return buffer;
  },
  close(fd) {
    fs.closeSync(fd);
  },
};

/** Takes descriptor ownership immediately, including invalid-size and read failures. */
export function readKeymapFd(io: KeymapFdIo, fd: number, size: number): Buffer {
  let result: Buffer;
  let closeFailed = false;
  try {
    if (
      !Number.isSafeInteger(fd) ||
      fd < 0 ||
      !Number.isSafeInteger(size) ||
      size < 2 ||
      size > maximumBytes
    )
      throw new Error("Invalid keymap descriptor");
    const buffer = io.read(fd, size);
    if (
      buffer.length !== size ||
      buffer[size - 1] !== 0 ||
      buffer.subarray(0, size - 1).includes(0)
    )
      throw new Error("Invalid keymap text");
    new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size - 1));
    result = buffer;
  } catch {
    throw new Error("Keymap unavailable");
  } finally {
    try {
      io.close(fd);
    } catch {
      closeFailed = true;
    }
  }
  if (closeFailed) throw new Error("Keymap descriptor unavailable");
  return result;
}
