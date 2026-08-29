/**
 * Helpers for zwp_linux_dmabuf_feedback_v1 (format table + DRM device id).
 */
import fs from "node:fs";
import { createMemfd, seekFd, writeFd } from "@moire/sys";

const MFD_CLOEXEC = 0x0001;
const DRM_FORMAT_ARGB8888 = 0x34325241;
const DRM_FORMAT_XRGB8888 = 0x34325258;
/** DRM_FORMAT_MOD_LINEAR — explicit linear (Mesa/Xwayland often want this). */
const MOD_LINEAR = 0x0n;
/** DRM_FORMAT_MOD_INVALID — implicit / driver-handled. */
const MOD_INVALID = 0xffffffffffffffffn;

export type DrmFeedbackDevice = {
  path: string;
  /** st_rdev as little-endian bytes (sizeof(dev_t) on Linux = 8). */
  deviceBytes: Buffer;
};

/** Pick a render node when possible; else the KMS card. */
export function resolveDrmFeedbackDevice(cardPath: string): DrmFeedbackDevice {
  const ordered = ["/dev/dri/renderD128", "/dev/dri/renderD129", cardPath];
  for (const path of ordered) {
    try {
      if (!fs.existsSync(path)) continue;
      const st = fs.statSync(path);
      if (!st.isCharacterDevice()) continue;
      const deviceBytes = Buffer.alloc(8);
      deviceBytes.writeBigUInt64LE(BigInt(st.rdev), 0);
      return { path, deviceBytes };
    } catch {
      // continue
    }
  }
  throw new Error("No DRM device for dmabuf feedback");
}

/**
 * Format table: packed entries of
 *   uint32 format, uint32 pad, uint64 modifier
 * (16 bytes each). See linux-dmabuf-unstable-v1.xml.
 */
export function createDmabufFormatTableMemfd(): { fd: number; size: number } {
  const formats = [DRM_FORMAT_ARGB8888, DRM_FORMAT_XRGB8888];
  const mods = [MOD_LINEAR, MOD_INVALID];
  const entries = formats.length * mods.length;
  const size = entries * 16;
  const buf = Buffer.alloc(size);
  let i = 0;
  for (const format of formats) {
    for (const mod of mods) {
      const off = i * 16;
      buf.writeUInt32LE(format, off);
      buf.writeUInt32LE(0, off + 4);
      buf.writeBigUInt64LE(mod, off + 8);
      i++;
    }
  }

  const fd = createMemfd("moire-dmabuf-formats", MFD_CLOEXEC);
  const n = writeFd(fd, buf);
  if (n !== size) throw new Error(`format table write short ${n}/${size}`);
  seekFd(fd, 0, 0); // SEEK_SET
  return { fd, size };
}

export const DMABUF_FEEDBACK_FORMAT_COUNT = 4;
