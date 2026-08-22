import koffi from "koffi";
import { assertLinux } from "./platform.js";
import {
  readDisplayIdentity,
  type DisplayIdentity,
} from "./display-identity.js";
import {
  closeFd,
  getLibc,
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
const DRM_MODE_PAGE_FLIP_EVENT = 0x01;
const POLLIN = 0x0001;

const DrmPageFlipHandler = koffi.proto(
  "void MoireDrmPageFlipHandler(int fd, unsigned int sequence, unsigned int tv_sec, unsigned int tv_usec, void *user_data)",
);

const DrmEventContext = koffi.struct("drmEventContext_moire", {
  version: "int",
  vblank_handler: "void *",
  page_flip_handler: koffi.pointer(DrmPageFlipHandler),
});

const PollFd = koffi.struct("pollfd_moire", {
  fd: "int",
  events: "int16_t",
  revents: "int16_t",
});

type KmsPageFlipPresenter = {
  callback: ReturnType<typeof koffi.register>;
  context: unknown;
  pollFd: unknown;
  pageFlip: (...args: unknown[]) => unknown;
  handleEvent: (...args: unknown[]) => unknown;
  poll: (...args: unknown[]) => unknown;
  completed: boolean;
  supported: boolean | null;
};

const pageFlipPresenters = new WeakMap<KmsOutput, KmsPageFlipPresenter>();

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
  /** Only the primary output owns DRM mastership and closes the shared fd. */
  ownsFd: boolean;
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
          ownsFd: true,
          cardPath,
          connectorId,
          connectorName: connectorName(
            conn.connector_type,
            conn.connector_type_id,
          ),
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
  } finally {
    drmModeFreeResources(resPtr);
  }
}

/**
 * Re-read the active connector after a DRM change event. This updates mode
 * metadata in place but does not choose a replacement mode; core owns that
 * policy because it also has to reflow the logical desktop.
 */
export function refreshKmsOutputModes(out: KmsOutput): KmsOutputRefresh {
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
      out.connectorName !==
        connectorName(conn.connector_type, conn.connector_type_id) ||
      out.physicalWidthMm !== conn.mmWidth ||
      out.physicalHeightMm !== conn.mmHeight;

    out.connectorName = connectorName(
      conn.connector_type,
      conn.connector_type_id,
    );
    out.identity = readDisplayIdentity(out.cardPath, out.connectorName);
    out.physicalWidthMm = conn.mmWidth;
    out.physicalHeightMm = conn.mmHeight;
    out.modes = nextModeData.map(({ raw: _raw, ...mode }) => mode);
    out.modeData = new Map(nextModeData.map((mode) => [mode.id, mode]));

    return {
      connected: true,
      modesChanged: previousDescription !== nextDescription || metadataChanged,
      currentModeAvailable: out.modeData.has(out.currentModeId),
      preferredModeId:
        nextModeData.find((mode) => mode.preferred)?.id ??
        nextModeData[0]?.id ??
        null,
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

    out.connectorId = nextConnectorId;
    out.connectorName = connectorName(
      conn.connector_type,
      conn.connector_type_id,
    );
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

function createFramebuffer(
  out: KmsOutput,
  mode: KmsModeData,
): KmsFramebuffer {
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
        ? (koffi.decode(
            conn.encoders,
            koffi.array("uint32_t", conn.count_encoders),
          ) as number[])
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
            if (
              encoder.possible_crtcs & (1 << index) &&
              !usedCrtcIds.has(candidate)
            ) {
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
      ownsFd: false,
      connectorId,
      connectorName: connectorName(
        conn.connector_type,
        conn.connector_type_id,
      ),
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
  presentKmsFramebuffer(out, out.fbId);
}

function pageFlipPresenter(out: KmsOutput): KmsPageFlipPresenter {
  const cached = pageFlipPresenters.get(out);
  if (cached) return cached;
  const libdrm = loadLibdrm();
  const presenter = {
    callback: null,
    context: null,
    pollFd: koffi.alloc(PollFd, 1),
    pageFlip: libdrm.func(
      "int drmModePageFlip(int fd, uint32_t crtc_id, uint32_t fb_id, uint32_t flags, void *user_data)",
    ),
    handleEvent: libdrm.func(
      "int drmHandleEvent(int fd, void *evctx)",
    ),
    poll: getLibc().func("int poll(void *fds, unsigned long nfds, int timeout)"),
    completed: false,
    supported: null,
  } as unknown as KmsPageFlipPresenter;
  presenter.callback = koffi.register(
    () => {
      presenter.completed = true;
    },
    koffi.pointer(DrmPageFlipHandler),
  );
  presenter.context = koffi.alloc(DrmEventContext, 1);
  koffi.encode(presenter.context, DrmEventContext, {
    version: 2,
    vblank_handler: null,
    page_flip_handler: presenter.callback,
  });
  pageFlipPresenters.set(out, presenter);
  return presenter;
}

function waitForPageFlip(out: KmsOutput, presenter: KmsPageFlipPresenter): void {
  const deadline = Date.now() + 1_000;
  while (!presenter.completed) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(`DRM page flip timed out on ${out.connectorName}`);
    }
    koffi.encode(presenter.pollFd, PollFd, {
      fd: out.fd,
      events: POLLIN,
      revents: 0,
    });
    const ready = Number(presenter.poll(presenter.pollFd, 1, remaining));
    if (ready < 0) {
      throw new Error(`poll for DRM page flip failed on ${out.connectorName}`);
    }
    if (ready === 0) continue;
    const handled = Number(presenter.handleEvent(out.fd, presenter.context));
    if (handled !== 0) {
      throw new Error(
        `drmHandleEvent failed (${handled}) on ${out.connectorName}`,
      );
    }
  }
}

function tryPageFlip(out: KmsOutput, framebufferId: number): boolean {
  const presenter = pageFlipPresenter(out);
  if (presenter.supported === false) return false;
  presenter.completed = false;
  const queued = Number(
    presenter.pageFlip(
      out.fd,
      out.crtcId,
      framebufferId,
      DRM_MODE_PAGE_FLIP_EVENT,
      null,
    ),
  );
  if (queued !== 0) {
    if (presenter.supported !== false) {
      console.warn(
        `[kms] page flips unavailable on ${out.connectorName}; retaining SetCrtc fallback (${queued})`,
      );
    }
    presenter.supported = false;
    return false;
  }
  waitForPageFlip(out, presenter);
  if (presenter.supported == null) {
    console.log(`[kms] page-flip presentation ready on ${out.connectorName}`);
  }
  presenter.supported = true;
  return true;
}

function destroyPageFlipPresenter(out: KmsOutput): void {
  const presenter = pageFlipPresenters.get(out);
  if (!presenter) return;
  pageFlipPresenters.delete(out);
  try {
    koffi.unregister(presenter.callback);
  } catch {
    // best effort
  }
  try {
    koffi.free(presenter.context);
  } catch {
    // best effort
  }
  try {
    koffi.free(presenter.pollFd);
  } catch {
    // best effort
  }
}

/** Present a renderer-owned DRM framebuffer on this output's current mode. */
export function presentKmsFramebuffer(
  out: KmsOutput,
  framebufferId: number,
): void {
  if (framebufferId !== out.fbId && tryPageFlip(out, framebufferId)) return;
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
    throw new Error(
      `drmModeSetCrtc framebuffer ${framebufferId} present failed (${set})`,
    );
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
  destroyPageFlipPresenter(out);
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
  if (out.ownsFd) {
    try {
      drmDropMaster(out.fd);
    } catch {
      // ignore
    }
    closeFd(out.fd);
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
      fillKmsColor(out, { r, g, b });
      frame++;
      await new Promise((r) => setTimeout(r, delay));
    }
  } finally {
    closeKmsOutput(out);
  }
}
