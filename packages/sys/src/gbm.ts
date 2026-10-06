/**
 * Minimal libgbm bindings for importing client dmabuf FDs and CPU-mapping them.
 */
import koffi from "koffi";
import { assertLinux } from "./platform";
import { closeFd, O_CLOEXEC, O_RDWR, openPath } from "./libc";

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

/** The created resource takes ownership of fd only after construction succeeds. */
export function openOwnedGbmImporter<T>(
  kmsFd: number,
  io: {
    open: typeof openPath;
    close: typeof closeFd;
    create: (ownedFd: number) => T;
  },
): T {
  const failures: unknown[] = [];
  // An ordinary proc-fd open reopens the device, unlike dup/SCM_RIGHTS of its
  // DRM fd. It has fresh DRM file/GEM state and remains subject to access checks.
  // The caller must keep kmsFd alive throughout this synchronous operation.
  for (const path of ["/dev/dri/renderD128", "/dev/dri/renderD129", `/proc/self/fd/${kmsFd}`]) {
    let fd: number;
    try {
      fd = io.open(path, O_RDWR | O_CLOEXEC);
    } catch (error) {
      failures.push(error);
      continue;
    }
    try {
      const importer = io.create(fd);
      console.log(`[gbm] independent import device on ${path}`);
      return importer;
    } catch (error) {
      io.close(fd);
      failures.push(error);
    }
  }
  // Never borrow the EGL/KMS owner's DRM file after reopen failure.
  throw new AggregateError(failures, "No independently opened GBM import device available");
}

export class GbmDevice {
  private destroyed = false;
  private readonly lib: ReturnType<typeof koffi.load>;
  private readonly device: unknown;
  /** Own an independently opened import-device fd, never the caller's KMS fd. */
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
  /** Imported wl_buffer BOs keyed by their compositor-owned dma-buf fd. */
  private readonly importedBos = new Map<number, unknown>();
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

  /** Prefer a render node, then independently reopen the live KMS device. */
  static openForImport(kmsFd: number): GbmDevice {
    return openOwnedGbmImporter(kmsFd, {
      open: openPath,
      close: closeFd,
      create: (fd) => new GbmDevice(fd, fd),
    });
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
    if (this.destroyed) throw new Error("GBM import device is destroyed");
    const cached = this.importedBos.get(args.fd);
    if (cached) {
      const mapped = this.mapImportedBo(cached, args, into);
      if (mapped) return mapped;
      this.importedBos.delete(args.fd);
      try {
        this.boDestroy(cached);
      } catch {
        // Re-import below.
      }
    }

    const usageFlags = [
      GBM_BO_USE_RENDERING | GBM_BO_USE_LINEAR,
      GBM_BO_USE_RENDERING,
      GBM_BO_USE_LINEAR,
      GBM_BO_USE_SCANOUT | GBM_BO_USE_LINEAR,
      0,
    ];

    const importKinds: ("FD_MODIFIER" | "FD")[] = ["FD_MODIFIER"];
    // The legacy FD struct has neither offset nor modifier attributes.
    if (args.offset === 0 && (args.modifier === 0n || args.modifier === 0xffffffffffffffffn)) {
      importKinds.push("FD");
    }

    for (const usage of usageFlags) {
      for (const kind of importKinds) {
        const fdBuf = koffi.alloc(GbmImportFdData, 1);
        const modBuf = koffi.alloc(GbmImportFdModifierData, 1);
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
              modifier: args.modifier,
            });
            importType = GBM_BO_IMPORT_FD_MODIFIER;
            importBuf = modBuf;
          }

          bo = this.createBoImport(this.device, importType, importBuf, usage);
          const boAddr = BigInt(koffi.address(bo));
          if (boAddr === 0n) continue;
          const mapped = this.mapImportedBo(bo, args, into);
          if (!mapped) continue;
          this.importedBos.set(args.fd, bo);
          bo = null;
          return mapped;
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

  private mapImportedBo(
    bo: unknown,
    args: { width: number; height: number; stride: number },
    into?: Uint8Array | null,
  ): GbmMappedPixels | null {
    const strideOut = koffi.alloc("uint32_t", 1);
    const mapDataOut = koffi.alloc("void *", 1);
    let mapData: unknown = null;
    try {
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
      if (mapAddr === 0n || mapAddr === 0xffffffffffffffffn) return null;
      mapData = koffi.decode(mapDataOut, "void *");
      const stride = (koffi.decode(strideOut, "uint32_t") as number) || args.stride;
      const byteLen = stride * args.height;
      const view = new Uint8Array(koffi.view(mapPtr, byteLen) as ArrayBuffer);
      const pixels = into?.byteLength === byteLen ? into : new Uint8Array(byteLen);
      pixels.set(view);
      return { pixels, stride };
    } finally {
      if (mapData) this.boUnmap(bo, mapData);
      freePtr(strideOut);
      freePtr(mapDataOut);
    }
  }

  /** Release a cached import before its compositor-owned dma-buf fd closes. */
  releaseImport(fd: number): void {
    const bo = this.importedBos.get(fd);
    if (!bo) return;
    this.importedBos.delete(fd);
    try {
      this.boDestroy(bo);
    } catch {
      // best effort
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const bo of this.importedBos.values()) {
      try {
        this.boDestroy(bo);
      } catch {
        // best effort
      }
    }
    this.importedBos.clear();
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
