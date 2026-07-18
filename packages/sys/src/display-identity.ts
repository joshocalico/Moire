import fs from "node:fs";
import path from "node:path";

export type DisplayIdentity = {
  id: string;
  make: string;
  model: string;
  serial: string;
};

/** Read the connector EDID from sysfs and derive a stable preference key. */
export function readDisplayIdentity(
  cardPath: string,
  connectorName: string,
): DisplayIdentity {
  const fallback = {
    id: `connector:${path.basename(cardPath)}:${connectorName}`,
    make: "Linux DRM",
    model: connectorName,
    serial: "",
  };
  try {
    const edid = fs.readFileSync(
      `/sys/class/drm/${path.basename(cardPath)}-${connectorName}/edid`,
    );
    if (
      edid.length < 128 ||
      !edid
        .subarray(0, 8)
        .equals(Buffer.from([0, 255, 255, 255, 255, 255, 255, 0]))
    ) {
      return fallback;
    }
    const manufacturerCode = edid.readUInt16BE(8);
    const make =
      [10, 5, 0]
        .map((shift) =>
          String.fromCharCode(64 + ((manufacturerCode >> shift) & 31)),
        )
        .join("")
        .replace(/[^A-Z]/g, "") || fallback.make;
    const product = edid.readUInt16LE(10).toString(16).padStart(4, "0");
    const numericSerial = edid.readUInt32LE(12);
    let model = "";
    let serial = numericSerial ? String(numericSerial) : "";
    for (
      let offset = 54;
      offset + 18 <= Math.min(edid.length, 126);
      offset += 18
    ) {
      if (
        edid[offset] !== 0 ||
        edid[offset + 1] !== 0 ||
        edid[offset + 2] !== 0
      ) {
        continue;
      }
      const tag = edid[offset + 3];
      const text = edid
        .subarray(offset + 5, offset + 18)
        .toString("ascii")
        .replace(/[\0\n\r]/g, "")
        .trim();
      if (tag === 0xfc && text) model = text;
      if (tag === 0xff && text) serial = text;
    }
    model ||= connectorName;
    return {
      id: `edid:${make}:${product}:${serial || model}`,
      make,
      model,
      serial,
    };
  } catch {
    return fallback;
  }
}
