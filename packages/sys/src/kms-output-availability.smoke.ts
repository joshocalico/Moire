import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import koffi from "koffi";
import { refreshKmsOutputModes } from "./kms";

// Resolve the actual production FFI schemas, rather than copying DRM layouts into a test.
const connectorType = koffi.resolve("drmModeConnector_kms");
const modeType = koffi.resolve("drmModeModeInfo_kms");
const connector: unknown = koffi.alloc(connectorType, 1);
const mode: unknown = koffi.alloc(modeType, 1);
let connection = 1;
let countModes = 1;
let query: "ok" | "missing" | "throw" = "ok";
let freed = 0;
const output: Parameters<typeof refreshKmsOutputModes>[0] = {
  availability: "unknown",
  fd: fs.openSync(fileURLToPath(import.meta.url), "r"), // An ordinary owned fd, never a DRM device.
  connectorId: 1,
  getConnector() {
    if (query === "throw") throw new Error("Connector query failed");
    if (query === "missing") return null;
    koffi.encode(connector, connectorType, {
      connector_id: 1,
      encoder_id: 0,
      connector_type: 15,
      connector_type_id: 1,
      connection,
      mmWidth: 10,
      mmHeight: 10,
      subpixel: 0,
      count_modes: countModes,
      modes: mode,
      count_props: 0,
      props: null,
      prop_values: null,
      count_encoders: 0,
      encoders: null,
    });
    return connector;
  },
  freeConnector(pointer) {
    assert.equal(pointer, connector);
    freed++;
  },
  cardPath: "/nonexistent/moire-private-output-test",
  connectorName: "Virtual-1",
  identity: { id: "fixture", make: "fixture", model: "fixture", serial: "" },
  physicalWidthMm: 10,
  physicalHeightMm: 10,
  modes: [],
  modeData: new Map(),
  currentModeId: "8x8@60",
};
try {
  koffi.encode(mode, modeType, {
    clock: 1,
    hdisplay: 8,
    hsync_start: 8,
    hsync_end: 8,
    htotal: 8,
    hskew: 0,
    vdisplay: 8,
    vsync_start: 8,
    vsync_end: 8,
    vtotal: 8,
    vscan: 0,
    vrefresh: 60,
    flags: 0,
    type: 8,
    name: "8x8",
  });
  assert.equal(refreshKmsOutputModes(output).connected, true);
  assert.equal(output.availability, "available");
  countModes = 0;
  assert.equal(refreshKmsOutputModes(output).connected, false);
  assert.equal(
    output.availability,
    "unavailable",
    "connected without a usable mode is not available",
  );
  countModes = 1;
  refreshKmsOutputModes(output);
  const savedModes = output.modes;
  connection = 2;
  assert.equal(refreshKmsOutputModes(output).connected, false);
  assert.equal(output.availability, "unavailable");
  assert.equal(output.modes, savedModes, "metadata does not itself establish availability");
  connection = 1;
  assert.equal(refreshKmsOutputModes(output).connected, true);
  assert.equal(output.availability, "available");
  query = "missing";
  assert.equal(refreshKmsOutputModes(output).connected, false);
  assert.equal(output.availability, "unknown");
  query = "ok";
  refreshKmsOutputModes(output);
  query = "throw";
  assert.throws(() => refreshKmsOutputModes(output), /query failed/);
  assert.equal(output.availability, "unknown");
  assert.equal(freed, 6);
  console.log(
    "KMS availability: actual production FFI decode, loss/reconnect/missing/error/metadata independence PASS (owned memory; no DRM fd/device)",
  );
} finally {
  koffi.free(mode);
  koffi.free(connector);
  fs.closeSync(output.fd);
}
