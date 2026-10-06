/**
 * CPU-readable snapshot of a linux-dmabuf wl_buffer.
 * Tries GBM import+map first, then direct mmap of plane 0 (with DMA_BUF sync).
 */
import {
  closeFd,
  type GbmDevice,
  type GbmMappedPixels,
  ioctlUint64,
  MAP_SHARED,
  mmap,
  munmap,
  nativeView,
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
  return (BigInt(plane.modifierHi >>> 0) << 32n) | BigInt(plane.modifierLo >>> 0);
}

function commitReadback(result: GbmMappedPixels, into?: Uint8Array | null): GbmMappedPixels {
  if (!into || into.byteLength !== result.pixels.byteLength || into === result.pixels)
    return result;
  // Commit only after native access and cleanup succeeded. The destination may
  // still be the last-good surface displayed when this new readback fails.
  into.set(result.pixels);
  return { pixels: into, stride: result.stride };
}

/** dma-buf sync — pull GPU contents into the CPU mapping on virgl/PRIME. */
const DMA_BUF_SYNC_READ = 1 << 0;
const DMA_BUF_SYNC_START = 0 << 2;
const DMA_BUF_SYNC_END = 1 << 2;
// _IOW('b', 0, struct dma_buf_sync) on linux — struct is u64 flags.
const DMA_BUF_IOCTL_SYNC = 0x40086200; // IOC_WRITE | (8<<16) | ('b'<<8) | 0

function dmaBufSync(fd: number, flags: number): void {
  try {
    ioctlUint64(fd, DMA_BUF_IOCTL_SYNC >>> 0, BigInt(flags >>> 0));
  } catch {
    // optional — some drivers reject SYNC
  }
}

/** Native mapping boundary, replaceable for CPU-access ordering regression tests. */
export type DmabufReadbackBackend = {
  sync: typeof dmaBufSync;
  mmap: typeof mmap;
  munmap: typeof munmap;
  nativeView: typeof nativeView;
};

const nativeReadback: DmabufReadbackBackend = {
  sync: dmaBufSync,
  mmap,
  munmap,
  nativeView,
};

/** Try mmap(plane0) — works for linear CPU-accessible dmabufs. */
function tryMmapPlane(
  buf: DmabufBuffer,
  backend: DmabufReadbackBackend,
): { pixels: Uint8Array; stride: number } | null {
  const plane = buf.planes[0];
  // An implicit/unknown modifier does not establish a linear CPU layout.
  if (!plane || buf.planes.length !== 1 || modifierOf(plane) !== 0n) return null;
  const stride = plane.stride;
  const byteLen = stride * buf.height;
  if (byteLen <= 0) return null;
  const mapLen = plane.offset + byteLen;
  try {
    const map = backend.mmap(mapLen, PROT_READ, MAP_SHARED, plane.fd, 0);
    try {
      backend.sync(plane.fd, DMA_BUF_SYNC_START | DMA_BUF_SYNC_READ);
      try {
        const view = new Uint8Array(backend.nativeView(map, mapLen));
        const slice = view.subarray(plane.offset, plane.offset + byteLen);
        const pixels = slice.slice();
        return { pixels, stride };
      } finally {
        backend.sync(plane.fd, DMA_BUF_SYNC_END | DMA_BUF_SYNC_READ);
      }
    } finally {
      backend.munmap(map, mapLen);
    }
  } catch {
    return null;
  }
}

export function copyFromDmabuf(
  buf: DmabufBuffer,
  gbm: Pick<GbmDevice, "mapImport"> | null,
  into?: Uint8Array | null,
  backend: DmabufReadbackBackend = nativeReadback,
): { pixels: Uint8Array; stride: number } {
  const plane = buf.planes[0];
  if (!plane) {
    throw new Error("dmabuf has no planes");
  }

  // Prefer GBM — on Parallels/virgl, raw mmap often returns zeros.
  if (gbm) {
    const result = gbm.mapImport({
      fd: plane.fd,
      width: buf.width,
      height: buf.height,
      stride: plane.stride,
      format: buf.format,
      offset: plane.offset,
      modifier: modifierOf(plane),
    });
    if (result) return commitReadback(result, into);
  }

  const mapped = tryMmapPlane(buf, backend);
  if (mapped) return commitReadback(mapped, into);

  throw new Error(
    `dmabuf readback unavailable ${buf.width}x${buf.height} fmt=0x${buf.format.toString(16)} modifier=0x${modifierOf(plane).toString(16)}`,
  );
}

export function closeDmabufPlanes(planes: DmabufPlane[], gbm?: GbmDevice | null): void {
  for (const p of planes) {
    gbm?.releaseImport(p.fd);
    try {
      closeFd(p.fd);
    } catch {
      // ok
    }
  }
}
