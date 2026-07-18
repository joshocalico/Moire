import koffi from "koffi";
import { assertLinux } from "./platform.js";
import {
  closeFd,
  MAP_SHARED,
  mmap,
  munmap,
  O_CLOEXEC,
  O_RDWR,
  openPath,
  PROT_READ,
  PROT_WRITE,
} from "./libc.js";

const DRM_MODE_CONNECTED = 1;
const DRM_MODE_TYPE_PREFERRED = 1 << 3;

const DrmModeModeInfo = koffi.struct("drmModeModeInfo_kms", {
  clock: "uint32_t",
  hdisplay: "uint16_t",
  hsync_start: "uint16_t",
  hsync_end: "uint16_t",
  htotal: "uint16_t",
  hskew: "uint16_t",
  vdisplay: "uint16_t",
  vsync_start: "uint16_t",
  vsync_end: "uint16_t",
  vtotal: "uint16_t",
  vscan: "uint16_t",
  vrefresh: "uint32_t",
  flags: "uint32_t",
  type: "uint32_t",
  name: koffi.array("char", 32),
});

const DrmModeConnector = koffi.struct("drmModeConnector_kms", {
  connector_id: "uint32_t",
  encoder_id: "uint32_t",
  connector_type: "uint32_t",
  connector_type_id: "uint32_t",
  connection: "uint32_t",
  mmWidth: "uint32_t",
  mmHeight: "uint32_t",
  subpixel: "uint32_t",
  count_modes: "int",
  modes: "void *",
  count_props: "int",
  props: "void *",
  prop_values: "void *",
  count_encoders: "int",
  encoders: "void *",
});

const DrmModeEncoder = koffi.struct("drmModeEncoder_kms", {
  encoder_id: "uint32_t",
  encoder_type: "uint32_t",
  crtc_id: "uint32_t",
  possible_crtcs: "uint32_t",
  possible_clones: "uint32_t",
});

const DrmModeRes = koffi.struct("drmModeRes_kms", {
  count_fbs: "int",
  fbs: "void *",
  count_crtcs: "int",
  crtcs: "void *",
  count_connectors: "int",
  connectors: "void *",
  count_encoders: "int",
  encoders: "void *",
  min_width: "uint32_t",
  max_width: "uint32_t",
  min_height: "uint32_t",
  max_height: "uint32_t",
});

const DrmModeCreateDumb = koffi.struct("drm_mode_create_dumb", {
  height: "uint32_t",
  width: "uint32_t",
  bpp: "uint32_t",
  flags: "uint32_t",
  handle: "uint32_t",
  pitch: "uint32_t",
  size: "uint64_t",
});

const DrmModeMapDumb = koffi.struct("drm_mode_map_dumb", {
  handle: "uint32_t",
  pad: "uint32_t",
  offset: "uint64_t",
});

const DrmModeDestroyDumb = koffi.struct("drm_mode_destroy_dumb", {
  handle: "uint32_t",
});

// ioctl request codes from drm.h / drm_mode.h (aarch64 / x86_64 Linux)
// DRM_IOCTL_MODE_CREATE_DUMB = 0xC02064B2
const DRM_IOCTL_MODE_CREATE_DUMB = 0xc02064b2;
const DRM_IOCTL_MODE_MAP_DUMB = 0xc01064b3;
const DRM_IOCTL_MODE_DESTROY_DUMB = 0xc00464b4;

function loadLibdrm() {
  for (const name of ["libdrm.so.2", "libdrm.so"]) {
    try {
      return koffi.load(name);
    } catch {
      // continue
    }
  }
  throw new Error("Failed to load libdrm");
}

export type Rgba = { r: number; g: number; b: number; a?: number };

export type KmsMode = {
  /** Stable selector used by Settings and the compositor D-Bus API. */
  id: string;
  width: number;
  height: number;
  refreshMilliHz: number;
  preferred: boolean;
};

type KmsModeData = KmsMode & { raw: Record<string, unknown> };

export type KmsOutput = {
  fd: number;
  cardPath: string;
  connectorId: number;
  crtcId: number;
  width: number;
  height: number;
  pitch: number;
  handle: number;
  fbId: number;
  size: number;
  map: unknown;
  modePtr: unknown;
  modes: KmsMode[];
  currentModeId: string;
  /** Durable connector id array for presentKms — avoid per-frame koffi.alloc. */
  connectorsPtr: unknown;
  /** Cached drmModeSetCrtc — avoid loadLibdrm/func lookup every present. */
  setCrtc: (
    fd: number,
    crtcId: number,
    bufferId: number,
    x: number,
    y: number,
    connectors: unknown,
    count: number,
    mode: unknown,
  ) => number;
  /** Cached allocation functions used by transactional runtime mode changes. */
  drmIoctl: (fd: number, request: number, arg: unknown) => number;
  addFb: (
    fd: number,
    width: number,
    height: number,
    depth: number,
    bpp: number,
    pitch: number,
    handle: number,
    fbId: unknown,
  ) => number;
  rmFb: (fd: number, fbId: number) => number;
  modeData: Map<string, KmsModeData>;
};

function refreshMilliHz(mode: Record<string, unknown>): number {
  const advertised = Number(mode.vrefresh ?? 0);
  if (advertised > 0) return Math.round(advertised * 1000);
  const clockKhz = Number(mode.clock ?? 0);
  const htotal = Number(mode.htotal ?? 0);
  const vtotal = Number(mode.vtotal ?? 0);
  if (clockKhz > 0 && htotal > 0 && vtotal > 0) {
    return Math.round((clockKhz * 1_000_000) / (htotal * vtotal));
  }
  return 60_000;
}

function describeModes(rawModes: Record<string, unknown>[]): KmsModeData[] {
  const seen = new Set<string>();
  const modes: KmsModeData[] = [];
  for (const raw of rawModes) {
    const width = Number(raw.hdisplay ?? 0);
    const height = Number(raw.vdisplay ?? 0);
    if (width <= 0 || height <= 0) continue;
    const refresh = refreshMilliHz(raw);
    const baseId = `${width}x${height}@${refresh}`;
    if (seen.has(baseId)) continue;
    seen.add(baseId);
    modes.push({
      id: baseId,
      width,
      height,
      refreshMilliHz: refresh,
      preferred: (Number(raw.type ?? 0) & DRM_MODE_TYPE_PREFERRED) !== 0,
      raw,
    });
  }
  return modes;
}

/**
 * Open a DRM card, pick the first connected connector, create a dumb FB, and modeset it.
 */
export function openKmsOutput(
  cardPath = "/dev/dri/card1",
  requestedModeId = process.env.MOIRE_MODE,
): KmsOutput {
  assertLinux("KMS");

  const libdrm = loadLibdrm();
  const drmIoctl = libdrm.func("int drmIoctl(int fd, unsigned long request, void *arg)");
  const drmModeGetResources = libdrm.func("void *drmModeGetResources(int fd)");
  const drmModeFreeResources = libdrm.func("void drmModeFreeResources(void *ptr)");
  const drmModeGetConnector = libdrm.func(
    "void *drmModeGetConnector(int fd, uint32_t connectorId)",
  );
  const drmModeFreeConnector = libdrm.func("void drmModeFreeConnector(void *ptr)");
  const drmModeGetEncoder = libdrm.func(
    "void *drmModeGetEncoder(int fd, uint32_t encoder_id)",
  );
  const drmModeFreeEncoder = libdrm.func("void drmModeFreeEncoder(void *ptr)");
  const drmModeAddFB = libdrm.func(
    "int drmModeAddFB(int fd, uint32_t width, uint32_t height, uint8_t depth, uint8_t bpp, uint32_t pitch, uint32_t bo_handle, _Out_ uint32_t *buf_id)",
  );
  const drmModeRmFB = libdrm.func("int drmModeRmFB(int fd, uint32_t bufferId)");
  const drmModeSetCrtc = libdrm.func(
    "int drmModeSetCrtc(int fd, uint32_t crtcId, uint32_t bufferId, uint32_t x, uint32_t y, uint32_t *connectors, int count, void *mode)",
  );
  const drmSetMaster = libdrm.func("int drmSetMaster(int fd)");
  void DrmModeModeInfo;
  void DrmModeConnector;
  void DrmModeEncoder;
  void DrmModeRes;

  const fd = openPath(cardPath, O_RDWR | O_CLOEXEC);
  const master = drmSetMaster(fd) as number;
  if (master !== 0) {
    // May still work if we already are master via logind; continue and fail on modeset if needed.
    console.warn("drmSetMaster returned", master, "(continuing)");
  }

  const resPtr = drmModeGetResources(fd);
  if (!resPtr) {
    closeFd(fd);
    throw new Error("drmModeGetResources failed");
  }

  try {
    const res = koffi.decode(resPtr, DrmModeRes) as {
      count_connectors: number;
      connectors: unknown;
      count_crtcs: number;
      crtcs: unknown;
    };

    const connectorIds = koffi.decode(
      res.connectors,
      koffi.array("uint32_t", res.count_connectors),
    ) as number[];
    const crtcIds = koffi.decode(
      res.crtcs,
      koffi.array("uint32_t", res.count_crtcs),
    ) as number[];

    for (const connectorId of connectorIds) {
      const connPtr = drmModeGetConnector(fd, connectorId);
      if (!connPtr) continue;

      try {
        const conn = koffi.decode(connPtr, DrmModeConnector) as {
          connector_id: number;
          encoder_id: number;
          connection: number;
          count_modes: number;
          modes: unknown;
          count_encoders: number;
          encoders: unknown;
        };

        if (conn.connection !== DRM_MODE_CONNECTED || conn.count_modes < 1) {
          continue;
        }

        const rawModes = koffi.decode(
          conn.modes,
          koffi.array(DrmModeModeInfo, conn.count_modes),
        ) as Record<string, unknown>[];
        const modes = describeModes(rawModes);
        const selected =
          modes.find((candidate) => candidate.id === requestedModeId) ??
          modes.find((candidate) => candidate.preferred) ??
          modes[0];
        if (!selected) continue;
        const mode = selected.raw;
        const width = selected.width;
        const height = selected.height;

        // Prefer current encoder; else first possible
        let crtcId = 0;
        let encoderId = conn.encoder_id;
        if (!encoderId && conn.count_encoders > 0) {
          const encIds = koffi.decode(
            conn.encoders,
            koffi.array("uint32_t", conn.count_encoders),
          ) as number[];
          encoderId = encIds[0] ?? 0;
        }

        if (encoderId) {
          const encPtr = drmModeGetEncoder(fd, encoderId);
          if (encPtr) {
            try {
              const enc = koffi.decode(encPtr, DrmModeEncoder) as {
                crtc_id: number;
                possible_crtcs: number;
              };
              crtcId = enc.crtc_id;
              if (!crtcId) {
                for (let i = 0; i < crtcIds.length; i++) {
                  if (enc.possible_crtcs & (1 << i)) {
                    crtcId = crtcIds[i]!;
                    break;
                  }
                }
              }
            } finally {
              drmModeFreeEncoder(encPtr);
            }
          }
        }

        if (!crtcId && crtcIds.length > 0) {
          crtcId = crtcIds[0]!;
        }
        if (!crtcId) {
          throw new Error("No CRTC available");
        }

        // Create dumb buffer
        const create = {
          height,
          width,
          bpp: 32,
          flags: 0,
          handle: 0,
          pitch: 0,
          size: 0n,
        };
        const createBuf = koffi.alloc(DrmModeCreateDumb, 1);
        koffi.encode(createBuf, DrmModeCreateDumb, create);
        if ((drmIoctl(fd, DRM_IOCTL_MODE_CREATE_DUMB, createBuf) as number) !== 0) {
          throw new Error("DRM_IOCTL_MODE_CREATE_DUMB failed");
        }
        const created = koffi.decode(createBuf, DrmModeCreateDumb) as {
          handle: number;
          pitch: number;
          size: bigint | number;
        };

        const mapReq = { handle: created.handle, pad: 0, offset: 0n };
        const mapBuf = koffi.alloc(DrmModeMapDumb, 1);
        koffi.encode(mapBuf, DrmModeMapDumb, mapReq);
        if ((drmIoctl(fd, DRM_IOCTL_MODE_MAP_DUMB, mapBuf) as number) !== 0) {
          throw new Error("DRM_IOCTL_MODE_MAP_DUMB failed");
        }
        const mapped = koffi.decode(mapBuf, DrmModeMapDumb) as {
          offset: bigint | number;
        };
        const size = Number(created.size);
        const map = mmap(
          size,
          PROT_READ | PROT_WRITE,
          MAP_SHARED,
          fd,
          Number(mapped.offset),
        );

        const fbIdOut = koffi.alloc("uint32_t", 1);
        const add = drmModeAddFB(
          fd,
          width,
          height,
          24,
          32,
          created.pitch,
          created.handle,
          fbIdOut,
        ) as number;
        if (add !== 0) {
          throw new Error(`drmModeAddFB failed: ${add}`);
        }
        const fbId = (koffi.decode(fbIdOut, "uint32_t") as number);

        // Copy first mode into a durable allocation for SetCrtc
        const modePtr = koffi.alloc(DrmModeModeInfo, 1);
        koffi.encode(modePtr, DrmModeModeInfo, mode);

        const connectors = koffi.alloc("uint32_t", 1);
        koffi.encode(connectors, "uint32_t", connectorId);

        const set = drmModeSetCrtc(
          fd,
          crtcId,
          fbId,
          0,
          0,
          connectors,
          1,
          modePtr,
        ) as number;
        if (set !== 0) {
          throw new Error(
            `drmModeSetCrtc failed (${set}). Run on a free VT / as DRM master (see docs/dev-vm.md).`,
          );
        }

        return {
          fd,
          cardPath,
          connectorId,
          crtcId,
          width,
          height,
          pitch: created.pitch,
          handle: created.handle,
          fbId,
          size,
          map,
          modePtr,
          modes: modes.map(({ raw: _raw, ...publicMode }) => publicMode),
          currentModeId: selected.id,
          connectorsPtr: connectors,
          setCrtc: drmModeSetCrtc as KmsOutput["setCrtc"],
          drmIoctl: drmIoctl as KmsOutput["drmIoctl"],
          addFb: drmModeAddFB as KmsOutput["addFb"],
          rmFb: drmModeRmFB as KmsOutput["rmFb"],
          modeData: new Map(modes.map((candidate) => [candidate.id, candidate])),
        };
      } finally {
        drmModeFreeConnector(connPtr);
      }
    }

    throw new Error("No connected DRM connector with modes found");
  } finally {
    drmModeFreeResources(resPtr);
  }
}

type KmsFramebuffer = {
  width: number;
  height: number;
  pitch: number;
  handle: number;
  fbId: number;
  size: number;
  map: unknown;
  modePtr: unknown;
};

function destroyFramebuffer(out: KmsOutput, fb: KmsFramebuffer): void {
  try {
    munmap(fb.map, fb.size);
  } catch {
    // best effort while replacing or closing an output
  }
  try {
    out.rmFb(out.fd, fb.fbId);
  } catch {
    // best effort
  }
  try {
    const destroy = koffi.alloc(DrmModeDestroyDumb, 1);
    koffi.encode(destroy, DrmModeDestroyDumb, { handle: fb.handle });
    out.drmIoctl(out.fd, DRM_IOCTL_MODE_DESTROY_DUMB, destroy);
    koffi.free(destroy);
  } catch {
    // best effort
  }
  try {
    koffi.free(fb.modePtr);
  } catch {
    // best effort
  }
}

/**
 * Switch an already-open connector to another advertised mode. The new dumb
 * framebuffer is fully allocated and accepted by KMS before the old one is
 * released, so a failed request leaves the current display intact.
 */
export function setKmsMode(out: KmsOutput, modeId: string): boolean {
  if (modeId === out.currentModeId) return false;
  const mode = out.modeData.get(modeId);
  if (!mode) throw new Error(`Unknown KMS mode ${modeId}`);

  let next: KmsFramebuffer | null = null;
  try {
    const createBuf = koffi.alloc(DrmModeCreateDumb, 1);
    koffi.encode(createBuf, DrmModeCreateDumb, {
      height: mode.height,
      width: mode.width,
      bpp: 32,
      flags: 0,
      handle: 0,
      pitch: 0,
      size: 0n,
    });
    if (out.drmIoctl(out.fd, DRM_IOCTL_MODE_CREATE_DUMB, createBuf) !== 0) {
      koffi.free(createBuf);
      throw new Error("DRM_IOCTL_MODE_CREATE_DUMB failed during mode switch");
    }
    const created = koffi.decode(createBuf, DrmModeCreateDumb) as {
      handle: number;
      pitch: number;
      size: bigint | number;
    };
    koffi.free(createBuf);

    const mapBuf = koffi.alloc(DrmModeMapDumb, 1);
    koffi.encode(mapBuf, DrmModeMapDumb, {
      handle: created.handle,
      pad: 0,
      offset: 0n,
    });
    if (out.drmIoctl(out.fd, DRM_IOCTL_MODE_MAP_DUMB, mapBuf) !== 0) {
      koffi.free(mapBuf);
      const destroy = koffi.alloc(DrmModeDestroyDumb, 1);
      koffi.encode(destroy, DrmModeDestroyDumb, { handle: created.handle });
      out.drmIoctl(out.fd, DRM_IOCTL_MODE_DESTROY_DUMB, destroy);
      koffi.free(destroy);
      throw new Error("DRM_IOCTL_MODE_MAP_DUMB failed during mode switch");
    }
    const mapped = koffi.decode(mapBuf, DrmModeMapDumb) as {
      offset: bigint | number;
    };
    koffi.free(mapBuf);

    const size = Number(created.size);
    const map = mmap(
      size,
      PROT_READ | PROT_WRITE,
      MAP_SHARED,
      out.fd,
      Number(mapped.offset),
    );
    const fbIdOut = koffi.alloc("uint32_t", 1);
    const add = out.addFb(
      out.fd,
      mode.width,
      mode.height,
      24,
      32,
      created.pitch,
      created.handle,
      fbIdOut,
    );
    if (add !== 0) {
      koffi.free(fbIdOut);
      munmap(map, size);
      const destroy = koffi.alloc(DrmModeDestroyDumb, 1);
      koffi.encode(destroy, DrmModeDestroyDumb, { handle: created.handle });
      out.drmIoctl(out.fd, DRM_IOCTL_MODE_DESTROY_DUMB, destroy);
      koffi.free(destroy);
      throw new Error(`drmModeAddFB failed during mode switch (${add})`);
    }
    const fbId = koffi.decode(fbIdOut, "uint32_t") as number;
    koffi.free(fbIdOut);
    const modePtr = koffi.alloc(DrmModeModeInfo, 1);
    koffi.encode(modePtr, DrmModeModeInfo, mode.raw);
    next = {
      width: mode.width,
      height: mode.height,
      pitch: created.pitch,
      handle: created.handle,
      fbId,
      size,
      map,
      modePtr,
    };

    const set = out.setCrtc(
      out.fd,
      out.crtcId,
      next.fbId,
      0,
      0,
      out.connectorsPtr,
      1,
      next.modePtr,
    );
    if (set !== 0) {
      throw new Error(`drmModeSetCrtc mode switch failed (${set})`);
    }

    const previous: KmsFramebuffer = {
      width: out.width,
      height: out.height,
      pitch: out.pitch,
      handle: out.handle,
      fbId: out.fbId,
      size: out.size,
      map: out.map,
      modePtr: out.modePtr,
    };
    out.width = next.width;
    out.height = next.height;
    out.pitch = next.pitch;
    out.handle = next.handle;
    out.fbId = next.fbId;
    out.size = next.size;
    out.map = next.map;
    out.modePtr = next.modePtr;
    out.currentModeId = mode.id;
    next = null;
    destroyFramebuffer(out, previous);
    return true;
  } catch (error) {
    if (next) destroyFramebuffer(out, next);
    throw error;
  }
}

/** Re-apply the CRTC → FB mapping (forces some virtual GPUs to refresh). */
export function presentKms(out: KmsOutput): void {
  const set = out.setCrtc(
    out.fd,
    out.crtcId,
    out.fbId,
    0,
    0,
    out.connectorsPtr,
    1,
    out.modePtr,
  );
  if (set !== 0) {
    throw new Error(`drmModeSetCrtc present failed (${set})`);
  }
}

/** Fill the dumb buffer with a solid color (XRGB8888). */
export function fillKmsColor(out: KmsOutput, color: Rgba): void {
  const ab = koffi.view(out.map, out.size) as ArrayBuffer;
  const pixels = new Uint32Array(ab);
  const r = color.r & 0xff;
  const g = color.g & 0xff;
  const b = color.b & 0xff;
  // XRGB8888 little-endian word: 0xXXRRGGBB
  const pixel = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
  // pitch may include padding — fill row by row when needed
  if (out.pitch === out.width * 4 && ab.byteLength >= out.width * out.height * 4) {
    pixels.fill(pixel, 0, out.width * out.height);
    return;
  }
  const bytes = new Uint8Array(ab);
  for (let y = 0; y < out.height; y++) {
    let off = y * out.pitch;
    for (let x = 0; x < out.width; x++) {
      bytes[off] = b;
      bytes[off + 1] = g;
      bytes[off + 2] = r;
      bytes[off + 3] = 0xff;
      off += 4;
    }
  }
}

export function closeKmsOutput(out: KmsOutput): void {
  const libdrm = loadLibdrm();
  const drmIoctl = libdrm.func("int drmIoctl(int fd, unsigned long request, void *arg)");
  const drmModeRmFB = libdrm.func("int drmModeRmFB(int fd, uint32_t bufferId)");
  const drmDropMaster = libdrm.func("int drmDropMaster(int fd)");

  try {
    munmap(out.map, out.size);
  } catch {
    // ignore
  }
  try {
    drmModeRmFB(out.fd, out.fbId);
  } catch {
    // ignore
  }
  try {
    const destroy = koffi.alloc(DrmModeDestroyDumb, 1);
    koffi.encode(destroy, DrmModeDestroyDumb, { handle: out.handle });
    drmIoctl(out.fd, DRM_IOCTL_MODE_DESTROY_DUMB, destroy);
    koffi.free(destroy);
  } catch {
    // ignore
  }
  try {
    if (out.connectorsPtr) koffi.free(out.connectorsPtr);
  } catch {
    // ignore
  }
  try {
    if (out.modePtr) koffi.free(out.modePtr);
  } catch {
    // ignore
  }
  try {
    drmDropMaster(out.fd);
  } catch {
    // ignore
  }
  closeFd(out.fd);
}

/**
 * Run a clear-color present loop (cycles hue) until aborted or `frames` elapse.
 */
export async function runClearColorLoop(opts?: {
  cardPath?: string;
  frames?: number;
  fps?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const out = openKmsOutput(opts?.cardPath);
  const fps = opts?.fps ?? 30;
  const delay = Math.floor(1000 / fps);
  const maxFrames = opts?.frames ?? Infinity;

  console.log(
    `KMS present: ${out.cardPath} ${out.width}x${out.height} connector=${out.connectorId} crtc=${out.crtcId}`,
  );

  let frame = 0;
  try {
    while (frame < maxFrames) {
      if (opts?.signal?.aborted) break;
      const t = frame / fps;
      const r = Math.floor((Math.sin(t) * 0.5 + 0.5) * 255);
      const g = Math.floor((Math.sin(t + 2.0) * 0.5 + 0.5) * 255);
      const b = Math.floor((Math.sin(t + 4.0) * 0.5 + 0.5) * 255);
      fillKmsColor(out, { r, g, b });
      frame++;
      await new Promise((r) => setTimeout(r, delay));
    }
  } finally {
    closeKmsOutput(out);
  }
}
