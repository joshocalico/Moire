import assert from "node:assert/strict";
import {
  BLUETOOTH_UNAVAILABLE,
  bluetoothSupported,
  parseBluetoothId,
  parseBluetoothInput,
  parseBluetoothTrust,
  bluetoothTrustBlocksControls,
  parseDesktopBluetooth,
  parseBluetoothPairing,
  BLUETOOTH_PAIRING_DISABLED,
  bluetoothDeviceKind,
  parseBluetoothAlias,
  type DesktopBluetooth,
} from "./bluetooth-status";

const adapterId = parseBluetoothId("adapter:one"),
  deviceId = parseBluetoothId("device:one");
const adapter = { id: adapterId, name: "Private adapter", powered: true };
const device = {
  id: deviceId,
  adapterId,
  name: "Private known device",
  address: "02:00:00:00:00:01",
  paired: true as const,
  trusted: true,
  connected: false,
};
const ready = {
  kind: "ready" as const,
  policy: "readonly" as const,
  adapters: [adapter],
  devices: [device],
};
const state: DesktopBluetooth = { status: ready, operation: { kind: "idle" } };
assert.deepEqual(parseDesktopBluetooth(JSON.parse(JSON.stringify(state))), state);
assert.equal(bluetoothSupported(state), true);
assert.equal(bluetoothSupported(BLUETOOTH_UNAVAILABLE), false);
assert.deepEqual(parseDesktopBluetooth(BLUETOOTH_UNAVAILABLE), BLUETOOTH_UNAVAILABLE);
for (const kind of ["loading", "error"] as const) {
  for (const supported of [true, false]) {
    const item: DesktopBluetooth = {
      status: { kind, supported, message: "Private observation" },
      operation: { kind: "idle" },
    };
    assert.equal(bluetoothSupported(parseDesktopBluetooth(item)), supported);
  }
}
for (const kind of ["pending", "unknown", "error"] as const) {
  const operation =
    kind === "pending"
      ? { kind, id: deviceId, connected: true }
      : { kind, id: deviceId, connected: true, message: "Private operation status" };
  assert.deepEqual(parseDesktopBluetooth({ ...state, operation }).operation, operation);
}
const invalidStatus: unknown[] = [
  null,
  {},
  { kind: "invented" },
  { ...ready, policy: "write" },
  { ...ready, adapters: [] },
  { ...ready, adapters: Array.from({ length: 9 }, (_, i) => ({ ...adapter, id: `adapter:${i}` })) },
  { ...ready, adapters: [adapter, adapter] },
  { ...ready, adapters: [{ ...adapter, powered: "true" }] },
  { ...ready, adapters: [{ ...adapter, name: "a".repeat(257) }] },
  { ...ready, devices: Array.from({ length: 65 }, (_, i) => ({ ...device, id: `device:${i}` })) },
  { ...ready, devices: [device, device] },
  { ...ready, devices: [{ ...device, id: adapterId }] },
  { ...ready, devices: [{ ...device, adapterId: "adapter:missing" }] },
  { ...ready, devices: [{ ...device, paired: false }] },
  { ...ready, devices: [{ ...device, trusted: 1 }] },
  { ...ready, devices: [{ ...device, connected: "true" }] },
  { ...ready, devices: [{ ...device, address: "invalid" }] },
  { ...ready, devices: [{ ...device, name: "a\0b" }] },
  { kind: "error", supported: "true", message: "Private error" },
  { kind: "loading", supported: false, message: "a".repeat(513) },
];
for (const status of invalidStatus)
  assert.throws(() => parseDesktopBluetooth({ ...state, status }), /Bluetooth/);
const invalidOperation: unknown[] = [
  null,
  {},
  { kind: "success" },
  { kind: "pending", id: deviceId, connected: "true" },
  { kind: "unknown", id: deviceId, connected: true, message: "a\0b" },
  { kind: "error", id: "", connected: false, message: "Private error" },
];
for (const operation of invalidOperation)
  assert.throws(() => parseDesktopBluetooth({ ...state, operation }), /Bluetooth/);
for (const id of ["", "/org/bluez/hci0", "a\0b", "x".repeat(129), 1])
  assert.throws(() => parseBluetoothId(id), /Bluetooth/);
const candidate = {
  id: device.id,
  adapterId: device.adapterId,
  name: device.name,
  address: device.address,
  paired: false as const,
};
const leaseId = parseBluetoothId("lease:one"),
  attemptId = parseBluetoothId("attempt:one"),
  promptId = parseBluetoothId("prompt:one");
const pairing = {
  kind: "ready" as const,
  adapters: [adapter],
  devices: [candidate],
  lease: { id: leaseId, adapterId, expiresAt: Date.now() + 30000 },
  discovery: "scanning" as const,
  attempt: { kind: "pending" as const, id: attemptId, device: candidate },
  prompt: { kind: "confirmation" as const, id: promptId, attemptId, deviceId, code: "000042" },
  message: "",
};
assert.deepEqual(parseBluetoothPairing(pairing), pairing);
assert.deepEqual(parseBluetoothPairing({ kind: "disabled" }), BLUETOOTH_PAIRING_DISABLED);
assert.deepEqual(parseDesktopBluetooth({ ...state, pairing }).pairing, pairing);
for (const prompt of [
  null,
  { ...pairing.prompt, kind: "authorization" },
  { ...pairing.prompt, kind: "display-code", entered: 3 },
])
  assert.equal(parseBluetoothPairing({ ...pairing, prompt }).kind, "ready");
const invalidPairing: unknown[] = [
  null,
  {},
  { ...pairing, kind: "interactive" },
  { ...pairing, adapters: Array(9).fill(adapter) },
  { ...pairing, devices: Array(65).fill(candidate) },
  { ...pairing, devices: [candidate, candidate] },
  { ...pairing, devices: [{ ...candidate, paired: true }] },
  { ...pairing, devices: [{ ...candidate, adapterId: "missing" }] },
  { ...pairing, lease: null },
  { ...pairing, lease: { ...pairing.lease, expiresAt: NaN } },
  { ...pairing, lease: { ...pairing.lease, expiresAt: -1 } },
  { ...pairing, lease: { ...pairing.lease, adapterId: "missing" } },
  { ...pairing, discovery: "forever" },
  { ...pairing, attempt: { kind: "idle" } },
  { ...pairing, attempt: { ...pairing.attempt, id: leaseId } },
  { ...pairing, prompt: { ...pairing.prompt, id: attemptId } },
  { ...pairing, prompt: { ...pairing.prompt, attemptId: "obsolete" } },
  { ...pairing, prompt: { ...pairing.prompt, deviceId: "obsolete" } },
  { ...pairing, prompt: { ...pairing.prompt, code: "42" } },
  { ...pairing, prompt: { ...pairing.prompt, kind: "display-code", entered: 7 } },
  { ...pairing, prompt: { ...pairing.prompt, kind: "display-code", entered: -1 } },
  { ...pairing, message: "bad\0message" },
];
for (const item of invalidPairing) assert.throws(() => parseBluetoothPairing(item));
for (const kind of ["pin-entry", "passkey-entry"] as const) {
  const prompt = { id: promptId, attemptId, deviceId, kind };
  assert.throws(() => parseBluetoothPairing({ ...pairing, prompt }));
  const parsed = parseBluetoothPairing({ ...pairing, inputEnabled: true, prompt });
  assert(parsed.kind === "ready" && parsed.prompt?.kind === kind);
}
assert.equal(parseBluetoothInput("pin-entry", "synthetic PIN"), "synthetic PIN");
assert.equal(parseBluetoothInput("passkey-entry", "000042"), 42);
assert.equal(parseBluetoothInput("passkey-entry", "0"), 0);
assert.equal(parseBluetoothInput("passkey-entry", "999999"), 999999);
for (const value of ["", "0000000", "-1", "1.5", " 42", "abc", null])
  assert.throws(() => parseBluetoothInput("passkey-entry", value));
for (const value of ["", "a".repeat(17), "bad\0PIN", "\n", "é", null])
  assert.throws(() => parseBluetoothInput("pin-entry", value));
const consent = {
  kind: "ready" as const,
  operation: {
    kind: "confirmation" as const,
    challengeId: parseBluetoothId("consent:one"),
    id: deviceId,
    trusted: true,
    expiresAt: Date.now() + 30000,
  },
};
assert.deepEqual(parseBluetoothTrust(consent), consent);
assert(bluetoothTrustBlocksControls(consent));
assert(!bluetoothTrustBlocksControls(undefined));
assert(!bluetoothTrustBlocksControls({ kind: "disabled" }));
assert.deepEqual(parseDesktopBluetooth({ ...state, trust: consent }).trust, consent);
for (const value of [
  null,
  {},
  { ...consent, kind: "interactive" },
  { ...consent, operation: { ...consent.operation, trusted: "yes" } },
  { ...consent, operation: { ...consent.operation, challengeId: "" } },
  { ...consent, operation: { ...consent.operation, expiresAt: 0 } },
  { ...consent, operation: { kind: "success" } },
])
  assert.throws(() => parseBluetoothTrust(value));
// Device kind: BlueZ's icon name first, then the Class of Device's major and minor classes.
const kinds: [string | null, number | null, string][] = [
  ["audio-headphones", null, "headphones"],
  ["audio-headset", null, "headset"],
  ["audio-card", null, "speaker"],
  ["input-mouse", null, "mouse"],
  ["input-gaming", null, "gamepad"],
  ["input-tablet", null, "tablet"],
  ["phone", null, "phone"],
  ["computer", null, "computer"],
  ["printer", null, "printer"],
  ["camera-video", null, "camera"],
  [null, null, "other"],
  [null, 0x5a020c, "phone"],
  [null, 0x3c010c, "computer"],
  [null, 0x240404, "headset"],
  [null, 0x240418, "headphones"],
  [null, 0x240414, "speaker"],
  [null, 0x002540, "keyboard"],
  [null, 0x002580, "mouse"],
  [null, 0x0025c0, "keyboard"],
  [null, 0x002508, "gamepad"],
  [null, 0x002514, "tablet"],
  [null, 0x040680, "printer"],
  [null, 0x040620, "camera"],
  [null, 0x000704, "watch"],
  [null, 0x001f00, "other"],
  ["unknown-icon", null, "other"],
];
for (const [icon, deviceClass, expected] of kinds)
  assert.equal(
    bluetoothDeviceKind(icon, deviceClass),
    expected,
    `${icon} ${deviceClass?.toString(16)}`,
  );
// The icon wins over the class when both are present.
assert.equal(bluetoothDeviceKind("input-keyboard", 0x002580), "keyboard");
const described = { ...device, kind: "headphones", battery: 80 };
assert.deepEqual(
  parseDesktopBluetooth({ ...state, status: { ...ready, devices: [described] } }).status,
  { ...ready, devices: [described] },
);
for (const bad of [{ kind: "toaster" }, { battery: 101 }, { battery: -1 }, { battery: 4.5 }])
  assert.throws(() =>
    parseDesktopBluetooth({ ...state, status: { ...ready, devices: [{ ...device, ...bad }] } }),
  );
assert.equal(parseBluetoothAlias("  Desk mouse "), "Desk mouse");
for (const bad of ["", "   ", "x".repeat(65), "tab\there", 7])
  assert.throws(() => parseBluetoothAlias(bad));
console.log(
  JSON.stringify({
    deviceKindCases: kinds.length,
    actualExitCode: 0,
    malformedStatusCases: invalidStatus.length,
    malformedOperationCases: invalidOperation.length,
    invalidIdentityCases: 5,
    malformedPairingCases: invalidPairing.length,
    rejectedInputBoundaryCases: 13,
    malformedTrustCases: 7,
    inputCapabilityKinds: 2,
    scope: "Bluetooth JSON boundary only; no bus or device operations",
  }),
);
