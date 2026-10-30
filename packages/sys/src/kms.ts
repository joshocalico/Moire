import koffi from "koffi";
import type { SeatDeviceAccess } from "./seat";
import { assertLinux } from "./platform";
import { readDisplayIdentity, type DisplayIdentity } from "./display-identity";
import {
  closeFd,
  flushMmap,
  MAP_SHARED,
  mmap,
  munmap,
  O_CLOEXEC,
  O_RDWR,
  openPath,
  PROT_READ,
  PROT_WRITE,
} from "./libc";
import { LinuxReadinessDispatcher } from "./readiness";
import { DrmPageFlipHandler2, PageFlipEvents } from "./page-flip-events";
import {
  ReadbackScanoutPool,
  ScanoutPresenter,
  packScanoutPixels,
  pageFlipFeedback,
  type KmsPresentationFeedback,
  type PageFlipQueueResult,
} from "./scanout-presentation";
export type { KmsPresentationFeedback } from "./scanout-presentation";

const DRM_MODE_CONNECTED = 1;
const DRM_MODE_TYPE_PREFERRED = 1 << 3;
const DRM_MODE_PAGE_FLIP_EVENT = 0x01;

const DrmEventContext = koffi.struct("drmEventContext_moire", {
  version: "int",
  vblank_handler: "void *",
  page_flip_handler: "void *",
  page_flip_handler2: koffi.pointer(DrmPageFlipHandler2),
});

type KmsPageFlipDevicePresenter = {
  fd: number;
  readiness: LinuxReadinessDispatcher;
  ownsReadiness: boolean;
  callback: ReturnType<typeof koffi.register>;
  context: unknown;
  pageFlip: (...args: unknown[]) => unknown;
  handleEvent: (...args: unknown[]) => unknown;
  outputs: Set<KmsOutput>;
  events: PageFlipEvents<KmsOutput>;
};

const pageFlipPresenters = new WeakMap<KmsOutput, KmsPageFlipDevicePresenter>();
const pageFlipDevices = new Map<number, KmsPageFlipDevicePresenter>();
const outputScanouts = new WeakMap<KmsOutput, KmsScanout>();
const trackedOutputs = new Set<KmsOutput>();
const pageFlipReady = new WeakSet<KmsOutput>();

type KmsScanout = {
  ownership: ScanoutPresenter;
  readback: ReadbackScanoutPool<KmsFramebuffer>;
  readiness: LinuxReadinessDispatcher | undefined;
};

const CURSOR_BUFFER_SIZE = 64;

export type KmsCursorImage = {
  pixels: Uint8Array;
  width: number;
  height: number;
  stride: number;
  hotspotX: number;
  hotspotY: number;
};

type KmsCursorBuffer = {
  handle: number;
  pitch: number;
  size: number;
  map: unknown;
};

type KmsCursorState = {
  supported: boolean;
  visible: boolean;
  buffer: KmsCursorBuffer | null;
  setCursor2: (...args: unknown[]) => unknown;
  moveCursor: (...args: unknown[]) => unknown;
};

const kmsCursorStates = new WeakMap<KmsOutput, KmsCursorState>();

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
  /** The on-screen framebuffer was handed to the next stage (see retainKmsScanout). */
  retainedScanout?: boolean;
  /** Connector/mode observation, independent of queued/active framebuffer ownership. */
  availability: "available" | "unavailable" | "unknown";
  fd: number;
  /** Only the primary output owns DRM mastership and closes the shared fd. */
  ownsFd: boolean;
  releaseFd?: () => void;
  cardPath: string;
  connectorId: number;
  connectorName: string;
  identity: DisplayIdentity;
  physicalWidthMm: number;
  physicalHeightMm: number;
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
  getConnector: (fd: number, connectorId: number) => unknown;
  freeConnector: (ptr: unknown) => void;
  getEncoder: (fd: number, encoderId: number) => unknown;
  freeEncoder: (ptr: unknown) => void;
  getResources: (fd: number) => unknown;
  freeResources: (ptr: unknown) => void;
  modeData: Map<string, KmsModeData>;
};

export type KmsOutputRefresh = {
  connected: boolean;
  modesChanged: boolean;
  currentModeAvailable: boolean;
  preferredModeId: string | null;
};

const CONNECTOR_NAMES: Record<number, string> = {
  0: "Unknown",
  1: "VGA",
  2: "DVI-I",
  3: "DVI-D",
  4: "DVI-A",
  5: "Composite",
  6: "SVIDEO",
  7: "LVDS",
  8: "Component",
  9: "DIN",
  10: "DP",
  11: "HDMI-A",
  12: "HDMI-B",
  13: "TV",
  14: "eDP",
  15: "Virtual",
  16: "DSI",
  17: "DPI",
  18: "Writeback",
  19: "SPI",
  20: "USB",
};

function connectorName(type: number, typeId: number): string {
  return `${CONNECTOR_NAMES[type] ?? `Connector-${type}`}-${typeId}`;
}

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
  bounds?: { maxWidth: number; maxHeight: number },
  devices?: SeatDeviceAccess,
  /**
   * Tight BGRA shown by the initial modeset instead of black: the boot stage's final frame,
   * so taking over the display is invisible. Ignored unless its size matches the mode.
   */
  initialFrame?: { pixels: Uint8Array; width: number; height: number } | { fill: number },
): KmsOutput {
  assertLinux("KMS");
  if (
    bounds &&
    (!Number.isSafeInteger(bounds.maxWidth) ||
      bounds.maxWidth < 1 ||
      !Number.isSafeInteger(bounds.maxHeight) ||
      bounds.maxHeight < 1)
  )
    throw new Error("KMS allocation bounds must be positive integer dimensions");

  const libdrm = loadLibdrm();
  const drmIoctl = libdrm.func("int drmIoctl(int fd, unsigned long request, void *arg)");
  const drmModeGetResources = libdrm.func("void *drmModeGetResources(int fd)");
  const drmModeFreeResources = libdrm.func("void drmModeFreeResources(void *ptr)");
  const drmModeGetConnector = libdrm.func(
    "void *drmModeGetConnector(int fd, uint32_t connectorId)",
  );
  const drmModeFreeConnector = libdrm.func("void drmModeFreeConnector(void *ptr)");
  const drmModeGetEncoder = libdrm.func("void *drmModeGetEncoder(int fd, uint32_t encoder_id)");
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

  const fd = devices ? devices.open(cardPath) : openPath(cardPath, O_RDWR | O_CLOEXEC);
  const releaseFd = () => (devices ? devices.close(fd) : closeFd(fd));
  const master = devices ? 0 : (drmSetMaster(fd) as number);
  if (master !== 0) {
    // May still work if we already are master via logind; continue and fail on modeset if needed.
    console.warn("drmSetMaster returned", master, "(continuing)");
  }

  const resPtr = drmModeGetResources(fd);
  if (!resPtr) {
    releaseFd();
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
    const crtcIds = koffi.decode(res.crtcs, koffi.array("uint32_t", res.count_crtcs)) as number[];

    for (const connectorId of connectorIds) {
      const connPtr = drmModeGetConnector(fd, connectorId);
      if (!connPtr) continue;

      try {
        const conn = koffi.decode(connPtr, DrmModeConnector) as {
          connector_id: number;
          encoder_id: number;
          connector_type: number;
          connector_type_id: number;
          connection: number;
          mmWidth: number;
          mmHeight: number;
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
        const modes = describeModes(rawModes).filter(
          (mode) => !bounds || (mode.width <= bounds.maxWidth && mode.height <= bounds.maxHeight),
        );
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
        const map = mmap(size, PROT_READ | PROT_WRITE, MAP_SHARED, fd, Number(mapped.offset));
        if (initialFrame && "fill" in initialFrame) {
          const row = new Uint32Array(created.pitch / 4).fill(initialFrame.fill >>> 0);
          const filled = new Uint8Array(created.pitch * height);
          for (let y = 0; y < height; y++)
            filled.set(new Uint8Array(row.buffer), y * created.pitch);
          flushMmap(map, filled, Math.min(size, filled.byteLength));
        } else if (
          initialFrame &&
          initialFrame.width === width &&
          initialFrame.height === height &&
          initialFrame.pixels.byteLength === width * height * 4
        ) {
          const rowBytes = width * 4;
          let packed = initialFrame.pixels;
          if (created.pitch !== rowBytes) {
            packed = new Uint8Array(created.pitch * height);
            for (let row = 0; row < height; row++)
              packed.set(
                initialFrame.pixels.subarray(row * rowBytes, (row + 1) * rowBytes),
                row * created.pitch,
              );
          }
          flushMmap(map, packed, Math.min(size, packed.byteLength));
        }

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
        const fbId = koffi.decode(fbIdOut, "uint32_t") as number;

        // Copy first mode into a durable allocation for SetCrtc
        const modePtr = koffi.alloc(DrmModeModeInfo, 1);
        koffi.encode(modePtr, DrmModeModeInfo, mode);

        const connectors = koffi.alloc("uint32_t", 1);
        koffi.encode(connectors, "uint32_t", connectorId);

        const set = drmModeSetCrtc(fd, crtcId, fbId, 0, 0, connectors, 1, modePtr) as number;
        if (set !== 0) {
          throw new Error(
            `drmModeSetCrtc failed (${set}). Run on a free VT / as DRM master (see docs/dev-vm.md).`,
          );
        }

        return {
          availability: "available",
          fd,
          ownsFd: true,
          releaseFd,
          cardPath,
          connectorId,
          connectorName: connectorName(conn.connector_type, conn.connector_type_id),
          identity: readDisplayIdentity(
            cardPath,
            connectorName(conn.connector_type, conn.connector_type_id),
          ),
          physicalWidthMm: conn.mmWidth,
          physicalHeightMm: conn.mmHeight,
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
          getConnector: drmModeGetConnector as KmsOutput["getConnector"],
          freeConnector: drmModeFreeConnector as KmsOutput["freeConnector"],
          getEncoder: drmModeGetEncoder as KmsOutput["getEncoder"],
          freeEncoder: drmModeFreeEncoder as KmsOutput["freeEncoder"],
          getResources: drmModeGetResources as KmsOutput["getResources"],
          freeResources: drmModeFreeResources as KmsOutput["freeResources"],
          modeData: new Map(modes.map((candidate) => [candidate.id, candidate])),
        };
      } finally {
        drmModeFreeConnector(connPtr);
      }
    }

    throw new Error("No connected DRM connector with modes found");
  } catch (error) {
    releaseFd();
    throw error;
  } finally {
    drmModeFreeResources(resPtr);
  }
}

/**
 * Re-read the active connector after a DRM change event. This updates mode
 * metadata in place but does not choose a replacement mode; core owns that
 * policy because it also has to reflow the logical desktop.
 */
export function refreshKmsOutputModes(
  out: Pick<
    KmsOutput,
    | "availability"
    | "fd"
    | "connectorId"
    | "getConnector"
    | "freeConnector"
    | "cardPath"
    | "connectorName"
    | "identity"
    | "physicalWidthMm"
    | "physicalHeightMm"
    | "modes"
    | "modeData"
    | "currentModeId"
  >,
): KmsOutputRefresh {
  // A failed query cannot preserve an earlier connected witness.
  out.availability = "unknown";
  const connPtr = out.getConnector(out.fd, out.connectorId);
  if (!connPtr) {
    return {
      connected: false,
      modesChanged: false,
      currentModeAvailable: false,
      preferredModeId: null,
    };
  }

  try {
    const conn = koffi.decode(connPtr, DrmModeConnector) as {
      connector_type: number;
      connector_type_id: number;
      connection: number;
      mmWidth: number;
      mmHeight: number;
      count_modes: number;
      modes: unknown;
    };
    if (conn.connection !== DRM_MODE_CONNECTED || conn.count_modes < 1) {
      out.availability = "unavailable";
      return {
        connected: false,
        modesChanged: false,
        currentModeAvailable: false,
        preferredModeId: null,
      };
    }

    const rawModes = koffi.decode(
      conn.modes,
      koffi.array(DrmModeModeInfo, conn.count_modes),
    ) as Record<string, unknown>[];
    const nextModeData = describeModes(rawModes);
    const previousDescription = out.modes
      .map((mode) => `${mode.id}:${mode.preferred ? 1 : 0}`)
      .join(",");
    const nextDescription = nextModeData
      .map((mode) => `${mode.id}:${mode.preferred ? 1 : 0}`)
      .join(",");
    const metadataChanged =
      out.connectorName !== connectorName(conn.connector_type, conn.connector_type_id) ||
      out.physicalWidthMm !== conn.mmWidth ||
      out.physicalHeightMm !== conn.mmHeight;

    out.connectorName = connectorName(conn.connector_type, conn.connector_type_id);
    out.identity = readDisplayIdentity(out.cardPath, out.connectorName);
    out.physicalWidthMm = conn.mmWidth;
    out.physicalHeightMm = conn.mmHeight;
    out.modes = nextModeData.map(({ raw: _raw, ...mode }) => mode);
    out.modeData = new Map(nextModeData.map((mode) => [mode.id, mode]));
    out.availability = "available";

    return {
      connected: true,
      modesChanged: previousDescription !== nextDescription || metadataChanged,
      currentModeAvailable: out.modeData.has(out.currentModeId),
      preferredModeId:
        nextModeData.find((mode) => mode.preferred)?.id ?? nextModeData[0]?.id ?? null,
    };
  } finally {
    out.freeConnector(connPtr);
  }
}

/**
 * Move the single logical output to another connected connector on the same
 * DRM card. KMS acceptance happens before any old framebuffer/connector state
 * is released, so a failed handoff restores the original output object.
 */
export function switchKmsConnector(
  out: KmsOutput,
  nextConnectorId: number,
  requestedModeId?: string,
): boolean {
  if (nextConnectorId === out.connectorId) return false;
  const scanout = kmsScanout(out);
  const connPtr = out.getConnector(out.fd, nextConnectorId);
  if (!connPtr) throw new Error(`DRM connector ${nextConnectorId} not found`);

  try {
    const conn = koffi.decode(connPtr, DrmModeConnector) as {
      encoder_id: number;
      connector_type: number;
      connector_type_id: number;
      connection: number;
      mmWidth: number;
      mmHeight: number;
      count_modes: number;
      modes: unknown;
      count_encoders: number;
      encoders: unknown;
    };
    if (conn.connection !== DRM_MODE_CONNECTED || conn.count_modes < 1) {
      throw new Error(`DRM connector ${nextConnectorId} is not connected`);
    }
    const rawModes = koffi.decode(
      conn.modes,
      koffi.array(DrmModeModeInfo, conn.count_modes),
    ) as Record<string, unknown>[];
    const modes = describeModes(rawModes);
    const selected =
      modes.find((mode) => mode.id === requestedModeId) ??
      modes.find((mode) => mode.preferred) ??
      modes[0];
    if (!selected) throw new Error(`DRM connector ${nextConnectorId} has no modes`);

    let encoderId = conn.encoder_id;
    if (!encoderId && conn.count_encoders > 0) {
      const encoderIds = koffi.decode(
        conn.encoders,
        koffi.array("uint32_t", conn.count_encoders),
      ) as number[];
      encoderId = encoderIds[0] ?? 0;
    }
    let crtcId = out.crtcId;
    if (encoderId) {
      const encoderPtr = out.getEncoder(out.fd, encoderId);
      if (encoderPtr) {
        try {
          const encoder = koffi.decode(encoderPtr, DrmModeEncoder) as {
            crtc_id: number;
            possible_crtcs: number;
          };
          if (encoder.crtc_id) {
            crtcId = encoder.crtc_id;
          } else {
            const resourcesPtr = out.getResources(out.fd);
            if (resourcesPtr) {
              try {
                const resources = koffi.decode(resourcesPtr, DrmModeRes) as {
                  count_crtcs: number;
                  crtcs: unknown;
                };
                const crtcIds = koffi.decode(
                  resources.crtcs,
                  koffi.array("uint32_t", resources.count_crtcs),
                ) as number[];
                for (let index = 0; index < crtcIds.length; index++) {
                  if (encoder.possible_crtcs & (1 << index)) {
                    crtcId = crtcIds[index]!;
                    break;
                  }
                }
              } finally {
                out.freeResources(resourcesPtr);
              }
            }
          }
        } finally {
          out.freeEncoder(encoderPtr);
        }
      }
    }

    const nextConnectorsPtr = koffi.alloc("uint32_t", 1);
    koffi.encode(nextConnectorsPtr, "uint32_t", nextConnectorId);
    const previous = {
      connectorId: out.connectorId,
      connectorName: out.connectorName,
      identity: out.identity,
      physicalWidthMm: out.physicalWidthMm,
      physicalHeightMm: out.physicalHeightMm,
      crtcId: out.crtcId,
      connectorsPtr: out.connectorsPtr,
      modes: out.modes,
      modeData: out.modeData,
      currentModeId: out.currentModeId,
    };
    const previousFramebuffer = scanout.ownership.activeFramebuffer ?? out.fbId;

    if (crtcId !== previous.crtcId) {
      const disabled = out.setCrtc(out.fd, previous.crtcId, 0, 0, 0, null, 0, null);
      if (disabled !== 0) {
        const failure = new Error(`Cannot retire old CRTC ${previous.crtcId} (${disabled})`);
        scanout.ownership.quarantine(failure);
        koffi.free(nextConnectorsPtr);
        throw failure;
      }
      scanout.ownership.confirmHandoff(0);
    }

    out.connectorId = nextConnectorId;
    out.connectorName = connectorName(conn.connector_type, conn.connector_type_id);
    out.identity = readDisplayIdentity(out.cardPath, out.connectorName);
    out.physicalWidthMm = conn.mmWidth;
    out.physicalHeightMm = conn.mmHeight;
    out.crtcId = crtcId;
    out.connectorsPtr = nextConnectorsPtr;
    out.modes = modes.map(({ raw: _raw, ...mode }) => mode);
    out.modeData = new Map(modes.map((mode) => [mode.id, mode]));
    // Ensure setKmsMode performs a real modeset even when both connectors use
    // the same nominal mode id.
    out.currentModeId = "__connector_handoff__";

    try {
      setKmsMode(out, selected.id);
      out.availability = "available";
      koffi.free(previous.connectorsPtr);
      return true;
    } catch (error) {
      out.connectorId = previous.connectorId;
      out.connectorName = previous.connectorName;
      out.identity = previous.identity;
      out.physicalWidthMm = previous.physicalWidthMm;
      out.physicalHeightMm = previous.physicalHeightMm;
      out.crtcId = previous.crtcId;
      out.connectorsPtr = previous.connectorsPtr;
      out.modes = previous.modes;
      out.modeData = previous.modeData;
      out.currentModeId = previous.currentModeId;
      koffi.free(nextConnectorsPtr);
      if (crtcId !== previous.crtcId) {
        try {
          setKmsFramebuffer(out, previousFramebuffer);
          scanout.ownership.confirmHandoff(previousFramebuffer);
        } catch (restoreError) {
          scanout.ownership.quarantine(
            restoreError instanceof Error ? restoreError : new Error(String(restoreError)),
          );
        }
      }
      throw error;
    }
  } finally {
    out.freeConnector(connPtr);
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

function createFramebuffer(out: KmsOutput, mode: KmsModeData): KmsFramebuffer {
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
    throw new Error("DRM_IOCTL_MODE_CREATE_DUMB failed");
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
    throw new Error("DRM_IOCTL_MODE_MAP_DUMB failed");
  }
  const mapped = koffi.decode(mapBuf, DrmModeMapDumb) as {
    offset: bigint | number;
  };
  koffi.free(mapBuf);

  const size = Number(created.size);
  const map = mmap(size, PROT_READ | PROT_WRITE, MAP_SHARED, out.fd, Number(mapped.offset));
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
    throw new Error(`drmModeAddFB failed (${add})`);
  }
  const fbId = koffi.decode(fbIdOut, "uint32_t") as number;
  koffi.free(fbIdOut);
  const modePtr = koffi.alloc(DrmModeModeInfo, 1);
  koffi.encode(modePtr, DrmModeModeInfo, mode.raw);
  return {
    width: mode.width,
    height: mode.height,
    pitch: created.pitch,
    handle: created.handle,
    fbId,
    size,
    map,
    modePtr,
  };
}

/**
 * Activate another connector on the primary output's already-master DRM fd.
 * Callers close additional outputs before the owning primary output.
 */
export function openAdditionalKmsOutput(
  primary: KmsOutput,
  connectorId: number,
  requestedModeId?: string,
  usedCrtcIds: ReadonlySet<number> = new Set([primary.crtcId]),
): KmsOutput {
  const connPtr = primary.getConnector(primary.fd, connectorId);
  if (!connPtr) throw new Error(`DRM connector ${connectorId} not found`);
  try {
    const conn = koffi.decode(connPtr, DrmModeConnector) as {
      encoder_id: number;
      connector_type: number;
      connector_type_id: number;
      connection: number;
      mmWidth: number;
      mmHeight: number;
      count_modes: number;
      modes: unknown;
      count_encoders: number;
      encoders: unknown;
    };
    if (conn.connection !== DRM_MODE_CONNECTED || conn.count_modes < 1) {
      throw new Error(`DRM connector ${connectorId} is not connected`);
    }
    const rawModes = koffi.decode(
      conn.modes,
      koffi.array(DrmModeModeInfo, conn.count_modes),
    ) as Record<string, unknown>[];
    const modes = describeModes(rawModes);
    const selected =
      modes.find((mode) => mode.id === requestedModeId) ??
      modes.find((mode) => mode.preferred) ??
      modes[0];
    if (!selected) throw new Error(`DRM connector ${connectorId} has no modes`);

    const encoderIds = conn.encoder_id
      ? [conn.encoder_id]
      : conn.count_encoders > 0
        ? (koffi.decode(conn.encoders, koffi.array("uint32_t", conn.count_encoders)) as number[])
        : [];
    const resourcesPtr = primary.getResources(primary.fd);
    if (!resourcesPtr) throw new Error("drmModeGetResources failed");
    let crtcId = 0;
    try {
      const resources = koffi.decode(resourcesPtr, DrmModeRes) as {
        count_crtcs: number;
        crtcs: unknown;
      };
      const crtcIds = koffi.decode(
        resources.crtcs,
        koffi.array("uint32_t", resources.count_crtcs),
      ) as number[];
      for (const encoderId of encoderIds) {
        const encoderPtr = primary.getEncoder(primary.fd, encoderId);
        if (!encoderPtr) continue;
        try {
          const encoder = koffi.decode(encoderPtr, DrmModeEncoder) as {
            crtc_id: number;
            possible_crtcs: number;
          };
          if (encoder.crtc_id && !usedCrtcIds.has(encoder.crtc_id)) {
            crtcId = encoder.crtc_id;
            break;
          }
          for (let index = 0; index < crtcIds.length; index++) {
            const candidate = crtcIds[index]!;
            if (encoder.possible_crtcs & (1 << index) && !usedCrtcIds.has(candidate)) {
              crtcId = candidate;
              break;
            }
          }
        } finally {
          primary.freeEncoder(encoderPtr);
        }
        if (crtcId) break;
      }
    } finally {
      primary.freeResources(resourcesPtr);
    }
    if (!crtcId) throw new Error(`No unused CRTC for ${connectorId}`);

    const connectorsPtr = koffi.alloc("uint32_t", 1);
    koffi.encode(connectorsPtr, "uint32_t", connectorId);
    const frame = createFramebuffer(primary, selected);
    const set = primary.setCrtc(
      primary.fd,
      crtcId,
      frame.fbId,
      0,
      0,
      connectorsPtr,
      1,
      frame.modePtr,
    );
    if (set !== 0) {
      destroyFramebuffer(primary, frame);
      koffi.free(connectorsPtr);
      throw new Error(`drmModeSetCrtc additional output failed (${set})`);
    }

    return {
      ...primary,
      availability: "available",
      ownsFd: false,
      connectorId,
      connectorName: connectorName(conn.connector_type, conn.connector_type_id),
      identity: readDisplayIdentity(
        primary.cardPath,
        connectorName(conn.connector_type, conn.connector_type_id),
      ),
      physicalWidthMm: conn.mmWidth,
      physicalHeightMm: conn.mmHeight,
      crtcId,
      ...frame,
      modes: modes.map(({ raw: _raw, ...mode }) => mode),
      currentModeId: selected.id,
      connectorsPtr,
      modeData: new Map(modes.map((mode) => [mode.id, mode])),
    };
  } finally {
    primary.freeConnector(connPtr);
  }
}

/**
 * Switch an already-open connector to another advertised mode. The new dumb
 * framebuffer is fully allocated and accepted by KMS before the old one is
 * released, so a failed request leaves the current display intact.
 */
export function setKmsMode(out: KmsOutput, modeId: string): boolean {
  const scanout = kmsScanout(out);
  if (modeId === out.currentModeId && scanout.ownership.status !== "quarantined") return false;
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
    const map = mmap(size, PROT_READ | PROT_WRITE, MAP_SHARED, out.fd, Number(mapped.offset));
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

    scanout.ownership.confirmHandoff(next.fbId);
    scanout.readback.reset(next);
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

/** Re-apply the durable output framebuffer for a confirmed shutdown/mode handoff. */
export function presentKms(out: KmsOutput): void {
  const scanout = kmsScanout(out);
  try {
    setKmsFramebuffer(out, out.fbId);
    scanout.ownership.confirmHandoff(out.fbId);
  } catch (error) {
    scanout.ownership.quarantine(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

function kmsScanout(out: KmsOutput): KmsScanout {
  const cached = outputScanouts.get(out);
  if (cached) return cached;
  const ownership = new ScanoutPresenter(out.fbId, {
    queue: (framebuffer, token) => queuePageFlip(out, framebuffer, token),
    setFramebuffer: (framebuffer) => setKmsFramebuffer(out, framebuffer),
  });
  const scanout: KmsScanout = {
    ownership,
    readiness: undefined,
    readback: new ReadbackScanoutPool(out, ownership, {
      allocate: () => {
        const mode = out.modeData.get(out.currentModeId);
        if (!mode) throw new Error(`Missing active mode ${out.currentModeId}`);
        return createFramebuffer(out, mode);
      },
      copy: (frame, pixels) => {
        const packed = packScanoutPixels(
          pixels,
          out.width,
          out.height,
          out.pitch,
          frame.pitch,
          frame.size,
        );
        flushMmap(frame.map, packed, frame.size);
      },
      destroy: (frame) => destroyFramebuffer(out, frame),
    }),
  };
  outputScanouts.set(out, scanout);
  trackedOutputs.add(out);
  return scanout;
}

/** A quarantined output must not render again until a matching event or confirmed modeset. */
export function isKmsPresentationReady(out: KmsOutput): boolean {
  return out.availability === "available" && kmsScanout(out).ownership.status === "ready";
}

/** Used by the direct renderer before writing a target, including after failed renders. */
export function isKmsFramebufferWritable(
  fd: number,
  framebuffer: number,
  outputId: string,
): boolean {
  for (const out of trackedOutputs) {
    if (out.fd !== fd) continue;
    const ownership = kmsScanout(out).ownership;
    if (out.connectorName === outputId && !ownership.canWrite(framebuffer)) return false;
    if (ownership.ownsFramebuffer(framebuffer) && !ownership.canRetire(framebuffer)) return false;
  }
  return true;
}

/** Resources still owned by scanout stay allocated if shutdown/mode handoff failed. */
export function canRetireKmsFramebuffer(fd: number, framebuffer: number): boolean {
  for (const out of trackedOutputs) {
    const ownership = kmsScanout(out).ownership;
    if (
      out.fd === fd &&
      ownership.ownsFramebuffer(framebuffer) &&
      !ownership.canRetire(framebuffer)
    )
      return false;
  }
  return true;
}

function handlePageFlipEvents(presenter: KmsPageFlipDevicePresenter): void {
  try {
    const handled = Number(presenter.handleEvent(presenter.fd, presenter.context));
    if (handled !== 0) throw new Error(`drmHandleEvent failed (${handled}) on fd=${presenter.fd}`);
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    for (const out of presenter.outputs) kmsScanout(out).ownership.quarantine(failure);
  }
}

function pageFlipPresenter(out: KmsOutput): KmsPageFlipDevicePresenter {
  const cached = pageFlipPresenters.get(out);
  if (cached) return cached;
  const shared = pageFlipDevices.get(out.fd);
  if (shared) {
    shared.outputs.add(out);
    pageFlipPresenters.set(out, shared);
    return shared;
  }
  const libdrm = loadLibdrm();
  const callback = koffi.register(
    (
      _fd: number,
      sequence: number,
      seconds: number,
      microseconds: number,
      _crtcId: number,
      userData: unknown,
    ) => {
      const event = presenter.events.consume(userData);
      if (!event) return;
      // The event token is specific to this output and flip, including across mode changes.
      kmsScanout(event.output).ownership.complete(
        event.token,
        pageFlipFeedback(sequence, seconds, microseconds),
      );
    },
    koffi.pointer(DrmPageFlipHandler2),
  );
  const presenter: KmsPageFlipDevicePresenter = {
    fd: out.fd,
    readiness: kmsScanout(out).readiness ?? new LinuxReadinessDispatcher("kms"),
    ownsReadiness: kmsScanout(out).readiness == null,
    callback,
    context: koffi.alloc(DrmEventContext, 1),
    pageFlip: libdrm.func(
      "int drmModePageFlip(int fd, uint32_t crtc_id, uint32_t fb_id, uint32_t flags, void *user_data)",
    ),
    handleEvent: libdrm.func("int drmHandleEvent(int fd, void *evctx)"),
    outputs: new Set([out]),
    events: new PageFlipEvents<KmsOutput>(),
  };
  koffi.encode(presenter.context, DrmEventContext, {
    version: 3,
    vblank_handler: null,
    page_flip_handler: null,
    page_flip_handler2: presenter.callback,
  });
  presenter.readiness.add(out.fd, () => handlePageFlipEvents(presenter));
  pageFlipPresenters.set(out, presenter);
  pageFlipDevices.set(out.fd, presenter);
  return presenter;
}

function queuePageFlip(out: KmsOutput, framebuffer: number, token: number): PageFlipQueueResult {
  const presenter = pageFlipPresenter(out);
  const allocation = presenter.events.allocate(out, token);
  let queued: number;
  let errno: number;
  try {
    queued = Number(
      presenter.pageFlip(out.fd, out.crtcId, framebuffer, DRM_MODE_PAGE_FLIP_EVENT, allocation),
    );
    errno = koffi.errno();
  } catch (error) {
    presenter.events.cancel(allocation);
    throw error;
  }
  if (queued === 0) return { kind: "queued" };
  presenter.events.cancel(allocation);
  // EINVAL / ENOTTY / ENOSYS / EOPNOTSUPP mean unsupported legacy page flips.
  // EBUSY and other errors do not establish buffer ownership and must quarantine.
  if ([22, 25, 38, 95].includes(errno)) {
    console.warn(
      `[kms] page flips unavailable on ${out.connectorName}; using non-vsync SetCrtc fallback (${queued}, errno=${errno})`,
    );
    return { kind: "unsupported" };
  }
  return {
    kind: "failed",
    error: new Error(`DRM page flip rejected on ${out.connectorName} (${queued}, errno=${errno})`),
  };
}

function destroyPageFlipPresenter(out: KmsOutput): void {
  const presenter = pageFlipPresenters.get(out) ?? pageFlipDevices.get(out.fd);
  if (!presenter) return;
  pageFlipPresenters.delete(out);
  presenter.outputs.delete(out);
  // Keep retired output tokens until their kernel events arrive. Freeing and
  // reusing an address early could make an old event match another output's flip.
  if (!out.ownsFd) return;
  for (const other of presenter.outputs) pageFlipPresenters.delete(other);
  presenter.events.destroy();
  pageFlipDevices.delete(presenter.fd);
  presenter.readiness.remove(presenter.fd);
  if (presenter.ownsReadiness) presenter.readiness.stop();
  koffi.unregister(presenter.callback);
  koffi.free(presenter.context);
}

/** Present an idle renderer-owned framebuffer; ownership survives rejected/timed-out flips. */
export async function presentKmsFramebuffer(
  out: KmsOutput,
  framebufferId: number,
  readiness?: LinuxReadinessDispatcher,
  onAvailable?: () => void,
): Promise<KmsPresentationFeedback> {
  const scanout = kmsScanout(out);
  scanout.readiness = readiness;
  scanout.ownership.setAvailableCallback(onAvailable);
  const feedback = await scanout.ownership.present(framebufferId);
  if (scanout.ownership.usesPageFlips && !pageFlipReady.has(out)) {
    console.log(
      `[kms] page-flip presentation ready on ${out.connectorName}; hardware timing unverified`,
    );
    pageFlipReady.add(out);
  }
  return feedback;
}

/** CPU/readback presents copy only into an idle allocation, then use the same flip protocol. */
export async function presentKmsPixels(
  out: KmsOutput,
  pixels: Uint8Array,
  readiness?: LinuxReadinessDispatcher,
  onAvailable?: () => void,
): Promise<KmsPresentationFeedback> {
  const scanout = kmsScanout(out);
  const framebuffer = scanout.readback.write(pixels);
  return presentKmsFramebuffer(out, framebuffer, readiness, onAvailable);
}

function setKmsFramebuffer(out: KmsOutput, framebufferId: number): void {
  const set = out.setCrtc(
    out.fd,
    out.crtcId,
    framebufferId,
    0,
    0,
    out.connectorsPtr,
    1,
    out.modePtr,
  );
  if (set !== 0) {
    throw new Error(`drmModeSetCrtc framebuffer ${framebufferId} present failed (${set})`);
  }
}

function createKmsCursorBuffer(out: KmsOutput): KmsCursorBuffer {
  const create = koffi.alloc(DrmModeCreateDumb, 1);
  koffi.encode(create, DrmModeCreateDumb, {
    height: CURSOR_BUFFER_SIZE,
    width: CURSOR_BUFFER_SIZE,
    bpp: 32,
    flags: 0,
    handle: 0,
    pitch: 0,
    size: 0n,
  });
  if (out.drmIoctl(out.fd, DRM_IOCTL_MODE_CREATE_DUMB, create) !== 0) {
    koffi.free(create);
    throw new Error("DRM_IOCTL_MODE_CREATE_DUMB failed for cursor");
  }
  const created = koffi.decode(create, DrmModeCreateDumb) as {
    handle: number;
    pitch: number;
    size: bigint | number;
  };
  koffi.free(create);

  const mapRequest = koffi.alloc(DrmModeMapDumb, 1);
  koffi.encode(mapRequest, DrmModeMapDumb, {
    handle: created.handle,
    pad: 0,
    offset: 0n,
  });
  if (out.drmIoctl(out.fd, DRM_IOCTL_MODE_MAP_DUMB, mapRequest) !== 0) {
    koffi.free(mapRequest);
    const destroy = koffi.alloc(DrmModeDestroyDumb, 1);
    koffi.encode(destroy, DrmModeDestroyDumb, { handle: created.handle });
    out.drmIoctl(out.fd, DRM_IOCTL_MODE_DESTROY_DUMB, destroy);
    koffi.free(destroy);
    throw new Error("DRM_IOCTL_MODE_MAP_DUMB failed for cursor");
  }
  const mapped = koffi.decode(mapRequest, DrmModeMapDumb) as {
    offset: bigint | number;
  };
  koffi.free(mapRequest);
  const size = Number(created.size);
  return {
    handle: created.handle,
    pitch: created.pitch,
    size,
    map: mmap(size, PROT_READ | PROT_WRITE, MAP_SHARED, out.fd, Number(mapped.offset)),
  };
}

function destroyKmsCursorBuffer(out: KmsOutput, buffer: KmsCursorBuffer): void {
  try {
    munmap(buffer.map, buffer.size);
  } catch {
    // best effort
  }
  try {
    const destroy = koffi.alloc(DrmModeDestroyDumb, 1);
    koffi.encode(destroy, DrmModeDestroyDumb, { handle: buffer.handle });
    out.drmIoctl(out.fd, DRM_IOCTL_MODE_DESTROY_DUMB, destroy);
    koffi.free(destroy);
  } catch {
    // best effort
  }
}

function kmsCursorState(out: KmsOutput): KmsCursorState {
  const cached = kmsCursorStates.get(out);
  if (cached) return cached;
  const libdrm = loadLibdrm();
  const state: KmsCursorState = {
    supported: true,
    visible: false,
    buffer: null,
    setCursor2: libdrm.func(
      "int drmModeSetCursor2(int fd, uint32_t crtc_id, uint32_t bo_handle, uint32_t width, uint32_t height, int32_t hot_x, int32_t hot_y)",
    ),
    moveCursor: libdrm.func("int drmModeMoveCursor(int fd, uint32_t crtc_id, int x, int y)"),
  };
  kmsCursorStates.set(out, state);
  return state;
}

function rejectKmsCursor(out: KmsOutput, state: KmsCursorState, result: number): false {
  try {
    state.setCursor2(out.fd, out.crtcId, 0, 0, 0, 0, 0);
  } catch {
    // best effort
  }
  state.supported = false;
  state.visible = false;
  if (state.buffer) {
    destroyKmsCursorBuffer(out, state.buffer);
    state.buffer = null;
  }
  console.warn(
    `[kms] hardware cursor unavailable on ${out.connectorName}; using composited cursor (${result}, errno=${koffi.errno()})`,
  );
  return false;
}

/** Upload and position an ARGB8888 cursor using the output's legacy cursor plane. */
export function setKmsCursor(out: KmsOutput, image: KmsCursorImage, x: number, y: number): boolean {
  if (
    image.width < 1 ||
    image.height < 1 ||
    image.width > CURSOR_BUFFER_SIZE ||
    image.height > CURSOR_BUFFER_SIZE ||
    image.stride < image.width * 4
  ) {
    return false;
  }
  let state: KmsCursorState;
  try {
    state = kmsCursorState(out);
    if (!state.supported) return false;
    state.buffer ??= createKmsCursorBuffer(out);
  } catch (error) {
    console.warn(`[kms] hardware cursor setup failed on ${out.connectorName}:`, error);
    return false;
  }
  const buffer = state.buffer;
  if (!buffer) return false;
  const staging = Buffer.alloc(buffer.size);
  for (let row = 0; row < image.height; row++) {
    staging.set(
      image.pixels.subarray(row * image.stride, row * image.stride + image.width * 4),
      row * buffer.pitch,
    );
  }
  flushMmap(buffer.map, staging, buffer.size);
  const set = Number(
    state.setCursor2(
      out.fd,
      out.crtcId,
      buffer.handle,
      CURSOR_BUFFER_SIZE,
      CURSOR_BUFFER_SIZE,
      image.hotspotX,
      image.hotspotY,
    ),
  );
  if (set !== 0) return rejectKmsCursor(out, state, set);
  const moved = Number(state.moveCursor(out.fd, out.crtcId, x, y));
  if (moved !== 0) return rejectKmsCursor(out, state, moved);
  if (!state.visible) {
    console.log(`[kms] hardware cursor active on ${out.connectorName}`);
  }
  state.visible = true;
  return true;
}

/** Move an already-uploaded hardware cursor without compositing a new frame. */
export function moveKmsCursor(out: KmsOutput, x: number, y: number): boolean {
  const state = kmsCursorStates.get(out);
  if (!state?.supported || !state.visible) return false;
  const moved = Number(state.moveCursor(out.fd, out.crtcId, x, y));
  if (moved !== 0) return rejectKmsCursor(out, state, moved);
  return true;
}

/** Hide the cursor plane for an inactive output or software fallback. */
export function disableKmsCursor(out: KmsOutput): void {
  const state = kmsCursorStates.get(out);
  if (!state?.supported || !state.visible) return;
  try {
    state.setCursor2(out.fd, out.crtcId, 0, 0, 0, 0, 0);
  } catch {
    // best effort
  }
  state.visible = false;
}

function destroyKmsCursor(out: KmsOutput): void {
  const state = kmsCursorStates.get(out);
  if (!state) return;
  disableKmsCursor(out);
  kmsCursorStates.delete(out);
  if (state.buffer) destroyKmsCursorBuffer(out, state.buffer);
}

/** Fill an idle dumb framebuffer and present it without modifying live scanout. */
export async function fillKmsColor(
  out: KmsOutput,
  color: Rgba,
  readiness?: LinuxReadinessDispatcher,
): Promise<void> {
  const stage = new Uint8Array(out.size);
  const pixels = new Uint32Array(stage.buffer);
  const pixel =
    (0xff000000 | ((color.r & 0xff) << 16) | ((color.g & 0xff) << 8) | (color.b & 0xff)) >>> 0;
  for (let y = 0; y < out.height; y++) {
    pixels.fill(pixel, (y * out.pitch) / 4, (y * out.pitch) / 4 + out.width);
  }
  await presentKmsPixels(out, stage, readiness);
}

function releaseKmsOutputResources(out: KmsOutput): void {
  const scanout = kmsScanout(out);
  scanout.ownership.close();
  scanout.readback.destroy();
  trackedOutputs.delete(out);
  destroyFramebuffer(out, out);
  koffi.free(out.connectorsPtr);
}

/**
 * Give up DRM master but keep the fd (and so the framebuffer on screen) open, letting the next
 * stage become master and replace the frame with its own modeset.
 */
export function dropKmsMaster(out: KmsOutput): boolean {
  const drmDropMaster = loadLibdrm().func("int drmDropMaster(int fd)");
  return (drmDropMaster(out.fd) as number) === 0;
}

/** struct drm_mode_closefb { u32 fb_id; u32 pad; } — DRM_IOWR(0xD0), Linux ≥ 6.8. */
const DRM_IOCTL_MODE_CLOSEFB = 0xc00864d0;

/**
 * Leave the current frame on screen after this process closes its DRM fd: CLOSEFB drops the
 * handle without disabling the plane, so the next stage's modeset replaces it seamlessly.
 * False when nothing is on screen or the kernel predates CLOSEFB (the screen then blanks).
 */
export function retainKmsScanout(out: KmsOutput): { retained: boolean; reason?: string } {
  const framebuffer = kmsScanout(out).ownership.activeFramebuffer;
  if (!framebuffer) return { retained: false, reason: "a flip is still pending" };
  const request = new Uint32Array([framebuffer, 0]);
  if (out.drmIoctl(out.fd, DRM_IOCTL_MODE_CLOSEFB, request) !== 0)
    return { retained: false, reason: `CLOSEFB failed (errno ${koffi.errno()})` };
  out.retainedScanout = true;
  return { retained: true };
}

/** No page flip in flight: the on-screen framebuffer is settled. */
export function isKmsScanoutSettled(out: KmsOutput): boolean {
  return kmsScanout(out).ownership.activeFramebuffer !== null;
}

export function closeKmsOutput(out: KmsOutput): void {
  out.availability = "unavailable";
  const scanout = kmsScanout(out);
  if (scanout.ownership.status === "closed") return;
  destroyKmsCursor(out);
  // Disable scanout before retiring storage, unless the frame was handed to the next stage.
  // If this fails on a shared fd, keep all resources until the owning output closes that fd.
  const disabled = out.retainedScanout
    ? 0
    : out.setCrtc(out.fd, out.crtcId, 0, 0, 0, null, 0, null);
  if (disabled !== 0 && !out.ownsFd) {
    scanout.ownership.quarantine(new Error(`DRM CRTC disable failed (${disabled})`));
    console.error(
      `[kms] retaining ${out.connectorName} buffers after failed CRTC disable (${disabled})`,
    );
    return;
  }
  destroyPageFlipPresenter(out);
  if (out.ownsFd) {
    if (out.releaseFd) out.releaseFd();
    else closeFd(out.fd);
    // Closing the owning fd also retires any shared-output resources whose
    // earlier disable failed. No late event can reach a reused event token.
    for (const other of trackedOutputs) {
      if (other.fd === out.fd) releaseKmsOutputResources(other);
    }
  } else {
    releaseKmsOutputResources(out);
  }
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
      await fillKmsColor(out, { r, g, b });
      frame++;
      await new Promise((r) => setTimeout(r, delay));
    }
  } finally {
    closeKmsOutput(out);
  }
}
