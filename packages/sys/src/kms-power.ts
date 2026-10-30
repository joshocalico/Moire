import koffi, { type IKoffiLib } from "koffi";
import { bindNativeFunction, type NativeInteger } from "./ffi";
import type { KmsOutput } from "./kms";

/** DRM_MODE_OBJECT_CONNECTOR from drm_mode.h. */
const DRM_MODE_OBJECT_CONNECTOR = 0xc0c0c0c0;
const DRM_MODE_DPMS_ON = 0;
const DRM_MODE_DPMS_OFF = 3;

const DrmModeObjectProperties = koffi.struct("drmModeObjectProperties_moire", {
  count_props: "uint32_t",
  props: "void *",
  prop_values: "void *",
});
const DrmModePropertyRes = koffi.struct("drmModePropertyRes_moire", {
  prop_id: "uint32_t",
  flags: "uint32_t",
  name: koffi.array("char", 32),
  count_values: "int",
  values: "void *",
  count_enums: "int",
  enums: "void *",
  count_blobs: "int",
  blob_ids: "void *",
});

type DpmsBindings = {
  getObjectProperties: (fd: number, objectId: number, objectType: number) => unknown;
  freeObjectProperties: (properties: unknown) => void;
  getProperty: (fd: number, propertyId: number) => unknown;
  freeProperty: (property: unknown) => void;
  connectorSetProperty: (
    fd: number,
    connectorId: number,
    propertyId: number,
    value: NativeInteger,
  ) => number;
};

let bindings: DpmsBindings | null = null;
function dpmsBindings(): DpmsBindings {
  if (bindings) return bindings;
  let library: IKoffiLib | null = null;
  for (const name of ["libdrm.so.2", "libdrm.so"]) {
    try {
      library = koffi.load(name);
      break;
    } catch {
      // try the next soname
    }
  }
  if (!library) throw new Error("Failed to load libdrm");
  void DrmModeObjectProperties;
  void DrmModePropertyRes;
  bindings = {
    getObjectProperties: bindNativeFunction(
      library,
      "drmModeObjectProperties_moire *drmModeObjectGetProperties(int fd, uint32_t object_id, uint32_t object_type)",
    ),
    freeObjectProperties: bindNativeFunction(
      library,
      "void drmModeFreeObjectProperties(drmModeObjectProperties_moire *ptr)",
    ),
    getProperty: bindNativeFunction(
      library,
      "drmModePropertyRes_moire *drmModeGetProperty(int fd, uint32_t property_id)",
    ),
    freeProperty: bindNativeFunction(
      library,
      "void drmModeFreeProperty(drmModePropertyRes_moire *ptr)",
    ),
    connectorSetProperty: bindNativeFunction(
      library,
      "int drmModeConnectorSetProperty(int fd, uint32_t connector_id, uint32_t property_id, uint64_t value)",
    ),
  };
  return bindings;
}

function propertyName(raw: unknown): string {
  const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayLike<number>);
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString("latin1");
}

/** Connector property ids keyed by output; 0 records that the connector has no DPMS property. */
const dpmsProperties = new WeakMap<KmsOutput, number>();

function dpmsProperty(out: KmsOutput, drm: DpmsBindings): number {
  const cached = dpmsProperties.get(out);
  if (cached !== undefined) return cached;
  let found = 0;
  const properties = drm.getObjectProperties(out.fd, out.connectorId, DRM_MODE_OBJECT_CONNECTOR);
  if (properties) {
    try {
      const decoded = koffi.decode(properties, DrmModeObjectProperties) as {
        count_props: number;
        props: unknown;
      };
      const ids =
        decoded.count_props > 0
          ? (koffi.decode(decoded.props, koffi.array("uint32_t", decoded.count_props)) as number[])
          : [];
      for (const id of ids) {
        const property = drm.getProperty(out.fd, id);
        if (!property) continue;
        try {
          const name = propertyName(
            (koffi.decode(property, DrmModePropertyRes) as { name: unknown }).name,
          );
          if (name === "DPMS") {
            found = id;
            break;
          }
        } finally {
          drm.freeProperty(property);
        }
      }
    } finally {
      drm.freeObjectProperties(properties);
    }
  }
  dpmsProperties.set(out, found);
  return found;
}

/**
 * Turn a connector's display on or off through its legacy DPMS property. The CRTC, mode and
 * framebuffer stay configured, so turning it back on shows the last frame until the next flip.
 * The caller must not queue page flips while the output is off (the CRTC is inactive).
 * Returns false when the connector has no DPMS property or the kernel refuses the change.
 */
export function setKmsOutputPower(out: KmsOutput, on: boolean): boolean {
  const drm = dpmsBindings();
  const property = dpmsProperty(out, drm);
  if (!property) return false;
  return (
    drm.connectorSetProperty(
      out.fd,
      out.connectorId,
      property,
      on ? DRM_MODE_DPMS_ON : DRM_MODE_DPMS_OFF,
    ) === 0
  );
}
