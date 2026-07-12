import fs from "node:fs";
import koffi from "koffi";
import { assertLinux } from "./platform.js";

export type DrmConnectorInfo = {
  cardPath: string;
  connectorId: number;
  connectorType: string;
  connection: "connected" | "disconnected" | "unknown";
  modes: string[];
};

const DRM_MODE_CONNECTED = 1;
const DRM_MODE_DISCONNECTED = 2;

/** Minimal drmModeModeInfo / connector field layout for probing. */
const DrmModeModeInfo = koffi.struct("drmModeModeInfo", {
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

const DrmModeConnector = koffi.struct("drmModeConnector", {
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

const DrmModeRes = koffi.struct("drmModeRes", {
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

const CONNECTOR_TYPES: Record<number, string> = {
  0: "Unknown",
  1: "VGA",
  2: "DVII",
  3: "DVID",
  4: "DVIA",
  5: "Composite",
  6: "SVIDEO",
  7: "LVDS",
  8: "Component",
  9: "9PinDIN",
  10: "DisplayPort",
  11: "HDMIA",
  12: "HDMIB",
  13: "TV",
  14: "eDP",
  15: "VIRTUAL",
  16: "DSI",
  17: "DPI",
  18: "WRITEBACK",
  19: "SPI",
  20: "USB",
};

function loadLibdrm() {
  const candidates = ["libdrm.so.2", "libdrm.so"];
  let lastErr: unknown;
  for (const name of candidates) {
    try {
      return koffi.load(name);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(`Failed to load libdrm (${String(lastErr)})`);
}

function openFlags() {
  // O_RDWR | O_CLOEXEC
  return 0x2 | 0x80000;
}

/**
 * List connectors on each `/dev/dri/card*` via libdrm (koffi).
 * Phase 0 sanity check — not a full KMS backend yet.
 */
export function listDrmConnectors(): DrmConnectorInfo[] {
  assertLinux("DRM probe");

  const libc = koffi.load("libc.so.6");
  const open = libc.func("int open(const char *pathname, int flags)");
  const close = libc.func("int close(int fd)");

  const libdrm = loadLibdrm();
  const drmModeGetResources = libdrm.func(
    "drmModeRes *drmModeGetResources(int fd)",
  );
  const drmModeFreeResources = libdrm.func(
    "void drmModeFreeResources(drmModeRes *ptr)",
  );
  const drmModeGetConnector = libdrm.func(
    "drmModeConnector *drmModeGetConnector(int fd, uint32_t connectorId)",
  );
  const drmModeFreeConnector = libdrm.func(
    "void drmModeFreeConnector(drmModeConnector *ptr)",
  );

  // Register structs so koffi can decode pointers.
  void DrmModeModeInfo;
  void DrmModeConnector;
  void DrmModeRes;

  const cards = fs
    .readdirSync("/dev/dri")
    .filter((name) => name.startsWith("card"))
    .map((name) => `/dev/dri/${name}`)
    .sort();

  if (cards.length === 0) {
    throw new Error("No /dev/dri/card* devices found (enable virtio-GPU / 3D in the VM)");
  }

  const out: DrmConnectorInfo[] = [];

  for (const cardPath of cards) {
    const fd = open(cardPath, openFlags());
    if (fd < 0) {
      continue;
    }

    try {
      const resPtr = drmModeGetResources(fd);
      if (!resPtr) {
        continue;
      }

      try {
        const res = koffi.decode(resPtr, DrmModeRes) as {
          count_connectors: number;
          connectors: unknown;
        };

        const ids =
          res.count_connectors > 0
            ? (koffi.decode(
                res.connectors,
                koffi.array("uint32_t", res.count_connectors),
              ) as number[])
            : [];

        for (const connectorId of ids) {
          const connPtr = drmModeGetConnector(fd, connectorId);
          if (!connPtr) continue;

          try {
            const conn = koffi.decode(connPtr, DrmModeConnector) as {
              connector_id: number;
              connector_type: number;
              connection: number;
              count_modes: number;
              modes: unknown;
            };

            const modes: string[] = [];
            if (conn.count_modes > 0 && conn.modes) {
              const modeArr = koffi.decode(
                conn.modes,
                koffi.array(DrmModeModeInfo, conn.count_modes),
              ) as Array<{ hdisplay: number; vdisplay: number; vrefresh: number; name: Buffer | string }>;

              for (const mode of modeArr) {
                const name =
                  typeof mode.name === "string"
                    ? mode.name.replace(/\0.*$/, "")
                    : Buffer.from(mode.name as Buffer)
                        .toString("utf8")
                        .replace(/\0.*$/, "");
                modes.push(
                  name || `${mode.hdisplay}x${mode.vdisplay}@${mode.vrefresh}`,
                );
              }
            }

            const connection =
              conn.connection === DRM_MODE_CONNECTED
                ? "connected"
                : conn.connection === DRM_MODE_DISCONNECTED
                  ? "disconnected"
                  : "unknown";

            out.push({
              cardPath,
              connectorId: conn.connector_id,
              connectorType:
                CONNECTOR_TYPES[conn.connector_type] ??
                `type-${conn.connector_type}`,
              connection,
              modes,
            });
          } finally {
            drmModeFreeConnector(connPtr);
          }
        }
      } finally {
        drmModeFreeResources(resPtr);
      }
    } finally {
      close(fd);
    }
  }

  return out;
}
