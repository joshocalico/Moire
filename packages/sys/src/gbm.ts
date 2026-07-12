/**
 * Minimal libgbm bindings for importing client dmabuf FDs and CPU-mapping them.
 */
import koffi from "koffi";
import { assertLinux } from "./platform.js";
import { closeFd, O_CLOEXEC, O_RDWR, openPath } from "./libc.js";

const GBM_BO_IMPORT_FD = 0x5503;
const GBM_BO_IMPORT_FD_MODIFIER = 0x5508;
const GBM_BO_TRANSFER_READ = 1;
const GBM_BO_USE_SCANOUT = 1 << 0;
const GBM_BO_USE_RENDERING = 1 << 2;
const GBM_BO_USE_LINEAR = 1 << 4;

const GbmImportFdData = koffi.struct("gbm_import_fd_data", {
  fd: "int",
  width: "uint32_t",
  height: "uint32_t",
  stride: "uint32_t",
  format: "uint32_t",
});

const GbmImportFdModifierData = koffi.struct("gbm_import_fd_modifier_data", {
  width: "uint32_t",
  height: "uint32_t",
  format: "uint32_t",
  num_fds: "uint32_t",
  fds: koffi.array("int", 4),
  strides: koffi.array("int", 4),
  offsets: koffi.array("int", 4),
  modifier: "uint64_t",
});

function loadGbm() {
  for (const name of ["libgbm.so.1", "libgbm.so"]) {
    try {
      return koffi.load(name);
    } catch {
      // continue
    }
  }
  throw new Error("Failed to load libgbm");
}

function freePtr(ptr: unknown): void {
  try {
    koffi.free(ptr);
  } catch {
    // ok
  }
}

export type GbmMappedPixels = {
  pixels: Uint8Array;
  stride: number;
};

export class GbmDevice {
  private readonly lib: ReturnType<typeof koffi.load>;
  private readonly device: unknown;
  /** Own the render-node fd if we opened it separately from the KMS card. */
  private readonly ownedFd: number | null;
  private readonly createBoImport: (
    device: unknown,
    type: number,
    buffer: unknown,
    flags: number,
  ) => unknown;
  private readonly boDestroy: (bo: unknown) => void;
  private readonly boMap: (
    bo: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
    flags: number,
    strideOut: unknown,
    mapDataOut: unknown,
  ) => unknown;
  private readonly boUnmap: (bo: unknown, mapData: unknown) => void;
  private readonly deviceDestroy: (device: unknown) => void;
  private mapFailLogged = false;

  constructor(drmFd: number, ownedFd: number | null = null) {
    assertLinux("GBM");
    this.lib = loadGbm();
    this.ownedFd = ownedFd;
    const createDevice = this.lib.func("void *gbm_create_device(int fd)");
    this.device = createDevice(drmFd);
    const addr = BigInt(koffi.address(this.device));
    if (addr === 0n) {
      throw new Error("gbm_create_device failed");
    }
    this.createBoImport = this.lib.func(
      "void *gbm_bo_import(void *gbm, uint32_t type, void *buffer, uint32_t usage)",
    );
    this.boDestroy = this.lib.func("void gbm_bo_destroy(void *bo)");
    this.boMap = this.lib.func(
      "void *gbm_bo_map(void *bo, uint32_t x, uint32_t y, uint32_t width, uint32_t height, uint32_t flags, _Out_ uint32_t *stride, _Out_ void **map_data)",
    );
    this.boUnmap = this.lib.func("void gbm_bo_unmap(void *bo, void *map_data)");
    this.deviceDestroy = this.lib.func("void gbm_device_destroy(void *gbm)");
  }

  /**
   * Prefer a render node for imports (card fd is often DRM master / scanout-only).
   * Falls back to the KMS card fd.
   */
  static openForImport(kmsFd: number): GbmDevice {
    for (const path of ["/dev/dri/renderD128", "/dev/dri/renderD129"]) {
      try {
        const fd = openPath(path, O_RDWR | O_CLOEXEC);
        try {
          const gbm = new GbmDevice(fd, fd);
          console.log(`[gbm] import device on ${path}`);
          return gbm;
        } catch (err) {
          closeFd(fd);
          console.warn(`[gbm] create_device(${path}) failed:`, err);
        }
      } catch {
        // node missing or permission
      }
    }
    console.log("[gbm] import device on KMS card fd");
    return new GbmDevice(kmsFd, null);
  }

  /**
   * Import a single-plane dmabuf and copy pixels out for CPU compositing.
   * Returns null if import or map fails.
   * @param into optional reusable pixel buffer (same byteLength).
   */
  mapImport(
    args: {
      fd: number;
      width: number;
      height: number;
      stride: number;
      format: number;
      offset: number;
      modifier: bigint;
    },
    into?: Uint8Array | null,
  ): GbmMappedPixels | null {
    const usageFlags = [
      GBM_BO_USE_RENDERING | GBM_BO_USE_LINEAR,
      GBM_BO_USE_RENDERING,
      GBM_BO_USE_LINEAR,
      GBM_BO_USE_SCANOUT | GBM_BO_USE_LINEAR,
      0,
    ];

    const mod =
      args.modifier === 0xffffffffffffffffn ? 0n : args.modifier;

    for (const usage of usageFlags) {
      for (const kind of ["FD", "FD_MODIFIER"] as const) {
        const fdBuf = koffi.alloc(GbmImportFdData, 1);
        const modBuf = koffi.alloc(GbmImportFdModifierData, 1);
        const strideOut = koffi.alloc("uint32_t", 1);
        const mapDataOut = koffi.alloc("void *", 1);
        let bo: unknown = null;
        try {
          let importType: number;
          let importBuf: unknown;
          if (kind === "FD") {
            koffi.encode(fdBuf, GbmImportFdData, {
              fd: args.fd,
              width: args.width,
              height: args.height,
              stride: args.stride,
              format: args.format,
            });
            importType = GBM_BO_IMPORT_FD;
            importBuf = fdBuf;
          } else {
            koffi.encode(modBuf, GbmImportFdModifierData, {
              width: args.width,
              height: args.height,
              format: args.format,
              num_fds: 1,
              fds: [args.fd, 0, 0, 0],
              strides: [args.stride | 0, 0, 0, 0],
              offsets: [args.offset | 0, 0, 0, 0],
              modifier: mod,
            });
            importType = GBM_BO_IMPORT_FD_MODIFIER;
            importBuf = modBuf;
          }

          bo = this.createBoImport(this.device, importType, importBuf, usage);
          const boAddr = BigInt(koffi.address(bo));
          if (boAddr === 0n) continue;

          const mapPtr = this.boMap(
            bo,
            0,
            0,
            args.width,
            args.height,
            GBM_BO_TRANSFER_READ,
            strideOut,
            mapDataOut,
          );
          const mapAddr = BigInt(koffi.address(mapPtr));
          if (mapAddr === 0n || mapAddr === 0xffffffffffffffffn) continue;

          const stride =
            (koffi.decode(strideOut, "uint32_t") as number) || args.stride;
          const byteLen = stride * args.height;
          const view = new Uint8Array(
            koffi.view(mapPtr, byteLen) as ArrayBuffer,
          );
          // Reject all-zero maps (Parallels/virgl mmap illusion).
          let nonzero = false;
          for (let i = 0; i < Math.min(byteLen, 4096); i++) {
            if (view[i] !== 0) {
              nonzero = true;
              break;
            }
          }
          if (!nonzero && byteLen > 0) {
            const mapData = koffi.decode(mapDataOut, "void *");
            this.boUnmap(bo, mapData);
            continue;
          }

          const pixels =
            into && into.byteLength === byteLen
              ? into
              : new Uint8Array(byteLen);
          pixels.set(view);
          const mapData = koffi.decode(mapDataOut, "void *");
          this.boUnmap(bo, mapData);
          return { pixels, stride };
        } catch {
          // try next combination
        } finally {
          if (bo) {
            try {
              const boAddr = BigInt(koffi.address(bo));
              if (boAddr !== 0n) this.boDestroy(bo);
            } catch {
              // ok
            }
          }
          freePtr(fdBuf);
          freePtr(modBuf);
          freePtr(strideOut);
          freePtr(mapDataOut);
        }
      }
    }

    if (!this.mapFailLogged) {
      this.mapFailLogged = true;
      console.warn(
        `[gbm] mapImport failed for ${args.width}x${args.height} fmt=0x${args.format.toString(16)} (further failures quiet)`,
      );
    }
    return null;
  }

  destroy(): void {
    try {
      this.deviceDestroy(this.device);
    } catch {
      // ok
    }
    if (this.ownedFd != null) {
      try {
        closeFd(this.ownedFd);
      } catch {
        // ok
      }
    }
  }
}
