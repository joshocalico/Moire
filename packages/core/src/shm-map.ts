import fs from "node:fs";
import { mmap, munmap, nativeView, MAP_SHARED, PROT_READ, PROT_WRITE } from "@moire/sys";

export function mmapShm(fd: number, size: number): unknown {
  return mmap(size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
}

export function munmapShm(addr: unknown, size: number): void {
  munmap(addr, size);
}

export function koffiView(map: unknown, size: number): ArrayBuffer {
  return nativeView(map, size);
}

/**
 * Copy buffer pixels out of a wl_shm pool via the existing mmap.
 * Only views up to offset+length (not the full 512MiB foot pools).
 * Reuses `into` when byteLength matches to avoid per-commit heap growth.
 */
export function copyFromPool(
  pool: { fd: number; size: number; map: unknown },
  offset: number,
  length: number,
  into?: Uint8Array | null,
): Uint8Array {
  if (offset < 0 || length <= 0 || offset + length > pool.size) {
    throw new Error(`invalid pool copy offset=${offset} length=${length} pool=${pool.size}`);
  }
  const end = offset + length;
  const out = into && into.byteLength === length ? into : new Uint8Array(length);
  if (end > 32 * 1024 * 1024) {
    const n = fs.readSync(pool.fd, out, 0, length, offset);
    if (n !== length) throw new Error(`pool pread short read ${n}/${length}`);
    return out;
  }
  const view = new Uint8Array(nativeView(pool.map, end));
  out.set(view.subarray(offset, end));
  return out;
}
