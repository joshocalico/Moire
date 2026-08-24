/**
 * CPU-readable snapshot of a linux-dmabuf wl_buffer.
 * Tries GBM import+map first, then direct mmap of plane 0 (with DMA_BUF sync).
 */
import koffi from "koffi";
import {
  closeFd,
  GbmDevice,
  getLibc,
  MAP_SHARED,
  mmap,
  munmap,
  PROT_READ,
} from "@moire/sys";

export type DmabufPlane = {
  fd: number;
  offset: number;
  stride: number;
  modifierHi: number;
  modifierLo: number;
};

export type DmabufBuffer = {
  kind: "dmabuf";
  width: number;
  height: number;
  format: number;
  flags: number;
  planes: DmabufPlane[];
};

function modifierOf(plane: DmabufPlane): bigint {
  return (
    (BigInt(plane.modifierHi >>> 0) << 32n) |
    BigInt(plane.modifierLo >>> 0)
  );
}

function reuseOrAlloc(into: Uint8Array | null | undefined, byteLen: number): Uint8Array {
  if (into && into.byteLength === byteLen) return into;
  return new Uint8Array(byteLen);
}

/** dma-buf sync — pull GPU contents into the CPU mapping on virgl/PRIME. */
const DMA_BUF_SYNC_READ = 1 << 0;
const DMA_BUF_SYNC_START = 0 << 2;
const DMA_BUF_SYNC_END = 1 << 2;
// _IOW('b', 0, struct dma_buf_sync) on linux — struct is u64 flags.
const DMA_BUF_IOCTL_SYNC = 0x40086200; // IOC_WRITE | (8<<16) | ('b'<<8) | 0

function dmaBufSync(fd: number, flags: number): void {
  try {
    const ioctl = getLibc().func(
      "int ioctl(int fd, unsigned long request, void *arg)",
    );
    const buf = koffi.alloc("uint64_t", 1);
    try {
      koffi.encode(buf, "uint64_t", BigInt(flags >>> 0));
      ioctl(fd, DMA_BUF_IOCTL_SYNC >>> 0, buf);
    } finally {
      koffi.free(buf);
    }
  } catch {
    // optional — some drivers reject SYNC
  }
}

function hasNonzero(pixels: Uint8Array, limit = 4096): boolean {
  const n = Math.min(pixels.byteLength, limit);
  for (let i = 0; i < n; i++) {
    if (pixels[i] !== 0) return true;
  }
  return n === 0;
}

/** Try mmap(plane0) — works for linear CPU-accessible dmabufs. */
function tryMmapPlane(
  buf: DmabufBuffer,
  into?: Uint8Array | null,
): { pixels: Uint8Array; stride: number } | null {
  const plane = buf.planes[0];
  if (!plane) return null;
  const stride = plane.stride;
  const byteLen = stride * buf.height;
  if (byteLen <= 0) return null;
  const mapLen = plane.offset + byteLen;
  try {
    dmaBufSync(plane.fd, DMA_BUF_SYNC_START | DMA_BUF_SYNC_READ);
    const map = mmap(mapLen, PROT_READ, MAP_SHARED, plane.fd, 0);
    try {
      dmaBufSync(plane.fd, DMA_BUF_SYNC_END | DMA_BUF_SYNC_READ);
      const view = new Uint8Array(koffi.view(map, mapLen) as ArrayBuffer);
      const slice = view.subarray(plane.offset, plane.offset + byteLen);
      if (!hasNonzero(slice)) return null;
      const pixels = reuseOrAlloc(into, byteLen);
      pixels.set(slice);
      return { pixels, stride };
    } finally {
      munmap(map, mapLen);
    }
  } catch {
    return null;
  }
}

export function copyFromDmabuf(
  buf: DmabufBuffer,
  gbm: GbmDevice | null,
  into?: Uint8Array | null,
): { pixels: Uint8Array; stride: number } {
  const plane = buf.planes[0];
  if (!plane) {
    throw new Error("dmabuf has no planes");
  }

  // Prefer GBM — on Parallels/virgl, raw mmap often returns zeros.
  if (gbm) {
    const result = gbm.mapImport(
      {
        fd: plane.fd,
        width: buf.width,
        height: buf.height,
        stride: plane.stride,
        format: buf.format,
        offset: plane.offset,
        modifier: modifierOf(plane),
      },
      into,
    );
    if (result && hasNonzero(result.pixels)) return result;
  }

  const mapped = tryMmapPlane(buf, into);
  if (mapped) return mapped;

  // Last resort: keep a black buffer so the window still maps (SSD visible).
  // Prefer this over throwing — throwing skips buffer release and stalls clients.
  const byteLen = plane.stride * buf.height;
  const pixels = reuseOrAlloc(into, byteLen);
  pixels.fill(0);
  console.warn(
    `[dmabuf] readback empty ${buf.width}x${buf.height} fmt=0x${buf.format.toString(16)} — black frame`,
  );
  return { pixels, stride: plane.stride };
}

export function closeDmabufPlanes(
  planes: DmabufPlane[],
  gbm?: GbmDevice | null,
): void {
  for (const p of planes) {
    gbm?.releaseImport(p.fd);
    try {
      closeFd(p.fd);
    } catch {
      // ok
    }
  }
}
