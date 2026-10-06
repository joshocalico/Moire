/** Observed Bluetooth state and independently enabled pairing/input/trust capabilities. */
declare const bluetoothIdentity: unique symbol;
export type BluetoothId = string & { readonly [bluetoothIdentity]: true };
export type BluetoothAdapterInfo = Readonly<{ id: BluetoothId; name: string; powered: boolean }>;
export type BluetoothDevice = Readonly<{
  id: BluetoothId;
  adapterId: BluetoothId;
  name: string;
  address: string;
  paired: true;
  trusted: boolean;
  connected: boolean;
}>;
export type BluetoothOperation =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "pending"; id: BluetoothId; connected: boolean }>
  | Readonly<{ kind: "error" | "unknown"; id: BluetoothId; connected: boolean; message: string }>;
export type BluetoothDiscovery =
  | Readonly<{ kind: "unavailable"; message: string }>
  | Readonly<{ kind: "loading" | "error"; supported: boolean; message: string }>
  | Readonly<{
      kind: "ready";
      policy: "readonly" | "interactive";
      adapters: readonly BluetoothAdapterInfo[];
      devices: readonly BluetoothDevice[];
    }>;
export type DesktopBluetooth = Readonly<{
  status: BluetoothDiscovery;
  operation: BluetoothOperation;
  /** Absence means the independently injected pairing capability is disabled. */
  pairing?: BluetoothPairingState;
  /** Absence or disabled means trust writes are unavailable, independent of Connect. */
  trust?: BluetoothTrustState;
}>;
export type BluetoothNearbyDevice = Readonly<{
  id: BluetoothId;
  adapterId: BluetoothId;
  name: string;
  address: string;
  paired: false;
}>;
export type BluetoothPairingAttempt =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "pending"; id: BluetoothId; device: BluetoothNearbyDevice }>
  | Readonly<{
      kind: "complete" | "canceled" | "error" | "unknown";
      id: BluetoothId;
      device: BluetoothNearbyDevice;
      message: string;
    }>;
type BluetoothPromptIdentity = Readonly<{
  id: BluetoothId;
  attemptId: BluetoothId;
  deviceId: BluetoothId;
}>;
export type BluetoothPairingPrompt = BluetoothPromptIdentity &
  (
    | Readonly<{ kind: "confirmation"; code: string }>
    | Readonly<{ kind: "authorization" }>
    | Readonly<{ kind: "display-code"; code: string; entered: number }>
    | Readonly<{ kind: "pin-entry" | "passkey-entry" }>
  );
export type BluetoothPairingState =
  | Readonly<{ kind: "disabled" }>
  | Readonly<{
      kind: "ready";
      adapters: readonly BluetoothAdapterInfo[];
      devices: readonly BluetoothNearbyDevice[];
      lease: Readonly<{ id: BluetoothId; adapterId: BluetoothId; expiresAt: number }> | null;
      discovery: "idle" | "starting" | "scanning" | "stopped" | "error" | "unknown";
      attempt: BluetoothPairingAttempt;
      prompt: BluetoothPairingPrompt | null;
      message: string;
      /** Omitted by older observers; never inferred from pairing capability. */
      inputEnabled?: boolean;
    }>;
export const BLUETOOTH_PAIRING_DISABLED: BluetoothPairingState = Object.freeze({
  kind: "disabled",
});
export function bluetoothPairingBlocksConnections(
  state: BluetoothPairingState | undefined,
): boolean {
  return (
    state?.kind === "ready" &&
    (state.attempt.kind === "pending" ||
      state.attempt.kind === "unknown" ||
      state.discovery === "unknown")
  );
}
export type BluetoothDiscoveryRequest = Readonly<{ caller: string; adapterId: BluetoothId }>;
export type BluetoothLeaseRequest = Readonly<{ caller: string; leaseId: BluetoothId }>;
export type BluetoothPairRequest = BluetoothLeaseRequest & Readonly<{ deviceId: BluetoothId }>;
export type BluetoothCancelRequest = BluetoothLeaseRequest & Readonly<{ attemptId: BluetoothId }>;
export type BluetoothPromptRequest = BluetoothCancelRequest &
  Readonly<{ promptId: BluetoothId; accepted: boolean }>;
export type BluetoothInputRequest = BluetoothCancelRequest &
  Readonly<{ promptId: BluetoothId; value: string }>;
export type BluetoothPairingAdapter = {
  readonly state: BluetoothPairingState;
  subscribe(listener: () => void): () => void;
  startDiscovery(request: BluetoothDiscoveryRequest): Promise<void>;
  stopDiscovery(request: BluetoothLeaseRequest): Promise<void>;
  beginPair(request: BluetoothPairRequest): Promise<void>;
  cancel(request: BluetoothCancelRequest): Promise<void>;
  respond(request: BluetoothPromptRequest): Promise<void>;
  respondInput?(request: BluetoothInputRequest): Promise<void>;
  callerLost(caller: string): Promise<void>;
  dispose(): Promise<void>;
};
export type BluetoothObservedRequest = Readonly<{ owner: string; revision: number }>;
export type BluetoothDiscoveryAction = BluetoothObservedRequest &
  Readonly<{ adapterId: BluetoothId }>;
export type BluetoothLeaseAction = BluetoothObservedRequest & Readonly<{ leaseId: BluetoothId }>;
export type BluetoothPairAction = BluetoothLeaseAction & Readonly<{ deviceId: BluetoothId }>;
export type BluetoothCancelAction = BluetoothLeaseAction & Readonly<{ attemptId: BluetoothId }>;
export type BluetoothPromptAction = BluetoothCancelAction &
  Readonly<{ promptId: BluetoothId; accepted: boolean }>;
export type BluetoothInputAction = BluetoothCancelAction &
  Readonly<{ promptId: BluetoothId; value: string }>;
export type BluetoothTrustState =
  | Readonly<{ kind: "disabled" }>
  | Readonly<{
      kind: "ready";
      operation:
        | Readonly<{ kind: "idle" }>
        | Readonly<{
            kind: "confirmation";
            challengeId: BluetoothId;
            id: BluetoothId;
            trusted: boolean;
            expiresAt: number;
          }>
        | Readonly<{ kind: "pending"; id: BluetoothId; trusted: boolean }>
        | Readonly<{
            kind: "error" | "unknown";
            id: BluetoothId;
            trusted: boolean;
            message: string;
          }>;
    }>;
export type BluetoothTrustRequest = Readonly<{ caller: string; id: BluetoothId; trusted: boolean }>;
export type BluetoothTrustConsent = Readonly<{ caller: string; challengeId: BluetoothId }>;
export type BluetoothTrustAction = BluetoothObservedRequest &
  Readonly<{ id: BluetoothId; trusted: boolean }>;
export type BluetoothTrustConsentAction = BluetoothObservedRequest &
  Readonly<{ challengeId: BluetoothId }>;
export function bluetoothTrustBlocksControls(state: BluetoothTrustState | undefined): boolean {
  return (
    state?.kind === "ready" &&
    (state.operation.kind === "confirmation" ||
      state.operation.kind === "pending" ||
      state.operation.kind === "unknown")
  );
}
/** Validate only at the external response boundary. The draft never enters observed state. */
export function parseBluetoothInput(
  kind: "pin-entry" | "passkey-entry",
  value: unknown,
): string | number {
  if (typeof value !== "string") throw new Error("Invalid Bluetooth input");
  if (kind === "pin-entry") {
    if (!/^[\x20-\x7e]{1,16}$/.test(value))
      throw new Error("PIN must contain 1 to 16 printable ASCII characters");
    return value;
  }
  if (!/^\d{1,6}$/.test(value)) throw new Error("Passkey must contain 1 to 6 digits");
  return Number(value);
}
export type BluetoothChange = Readonly<{ id: BluetoothId; connected: boolean }>;
export type BluetoothActionRequest = BluetoothChange &
  Readonly<{ owner: string; revision: number }>;
export type BluetoothAdapter = {
  readonly state: DesktopBluetooth;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  setConnected(request: BluetoothChange): Promise<void>;
  requestTrust?(request: BluetoothTrustRequest): Promise<void>;
  confirmTrust?(request: BluetoothTrustConsent): Promise<void>;
  cancelTrust?(request: BluetoothTrustConsent): Promise<void>;
  trustCallerLost?(caller: string): Promise<void>;
  dispose(): Promise<void>;
};
export const BLUETOOTH_UNAVAILABLE: DesktopBluetooth = Object.freeze({
  status: { kind: "unavailable", message: "BlueZ Bluetooth backend unavailable" },
  operation: { kind: "idle" },
});
export function bluetoothSupported(state: DesktopBluetooth): boolean {
  return (
    state.status.kind === "ready" ||
    ((state.status.kind === "loading" || state.status.kind === "error") && state.status.supported)
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid Bluetooth object");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 512): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error("Invalid Bluetooth text");
  return value;
}
export function parseBluetoothId(value: unknown): BluetoothId {
  const id = text(value, 128);
  if (!id || !/^[A-Za-z0-9:_-]+$/.test(id)) throw new Error("Invalid Bluetooth identity");
  return id as BluetoothId;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid Bluetooth boolean");
  return value;
}
function nearby(value: unknown): BluetoothNearbyDevice {
  const raw = record(value),
    address = text(raw.address, 17);
  if (raw.paired !== false || !/^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(address))
    throw new Error("Invalid nearby Bluetooth device");
  return {
    id: parseBluetoothId(raw.id),
    adapterId: parseBluetoothId(raw.adapterId),
    name: text(raw.name, 256),
    address,
    paired: false,
  };
}
/** Pairing is independently enabled; malformed supplied capability data never becomes consent. */
export function parseBluetoothPairing(value: unknown): BluetoothPairingState {
  const raw = record(value);
  if (raw.kind === "disabled") return BLUETOOTH_PAIRING_DISABLED;
  if (
    raw.kind !== "ready" ||
    !Array.isArray(raw.adapters) ||
    raw.adapters.length > 8 ||
    !Array.isArray(raw.devices) ||
    raw.devices.length > 64
  )
    throw new Error("Invalid Bluetooth pairing state");
  const identities = new Set<BluetoothId>();
  const adapters = raw.adapters.map((value) => {
    const adapter = record(value),
      id = parseBluetoothId(adapter.id);
    if (identities.has(id)) throw new Error("Duplicate pairing identity");
    identities.add(id);
    return { id, name: text(adapter.name, 256), powered: bool(adapter.powered) };
  });
  const adapterIds = new Set(adapters.map((adapter) => adapter.id));
  const devices = raw.devices.map((value) => {
    const device = nearby(value);
    if (identities.has(device.id) || !adapterIds.has(device.adapterId))
      throw new Error("Invalid pairing device identity");
    identities.add(device.id);
    return device;
  });
  let lease: Extract<BluetoothPairingState, { kind: "ready" }>["lease"] = null;
  if (raw.lease !== null) {
    const item = record(raw.lease),
      id = parseBluetoothId(item.id),
      adapterId = parseBluetoothId(item.adapterId);
    if (
      !adapterIds.has(adapterId) ||
      identities.has(id) ||
      typeof item.expiresAt !== "number" ||
      !Number.isSafeInteger(item.expiresAt) ||
      item.expiresAt <= 0
    )
      throw new Error("Invalid pairing lease");
    identities.add(id);
    lease = { id, adapterId, expiresAt: item.expiresAt };
  }
  const discovery = raw.discovery;
  if (
    discovery !== "idle" &&
    discovery !== "starting" &&
    discovery !== "scanning" &&
    discovery !== "stopped" &&
    discovery !== "error" &&
    discovery !== "unknown"
  )
    throw new Error("Invalid pairing discovery");
  if ((discovery === "starting" || discovery === "scanning") && !lease)
    throw new Error("Missing discovery lease");
  const item = record(raw.attempt);
  let attempt: BluetoothPairingAttempt;
  if (item.kind === "idle") attempt = { kind: "idle" };
  else if (
    item.kind === "pending" ||
    item.kind === "complete" ||
    item.kind === "canceled" ||
    item.kind === "error" ||
    item.kind === "unknown"
  ) {
    const id = parseBluetoothId(item.id),
      device = nearby(item.device);
    if (
      identities.has(id) ||
      (item.kind === "pending" && (!lease || lease.adapterId !== device.adapterId))
    )
      throw new Error("Invalid pairing attempt");
    identities.add(id);
    attempt =
      item.kind === "pending"
        ? { kind: item.kind, id, device }
        : { kind: item.kind, id, device, message: text(item.message) };
  } else throw new Error("Invalid pairing attempt");
  let prompt: BluetoothPairingPrompt | null = null;
  if (raw.prompt !== null) {
    const item = record(raw.prompt),
      id = parseBluetoothId(item.id),
      attemptId = parseBluetoothId(item.attemptId),
      deviceId = parseBluetoothId(item.deviceId);
    if (
      identities.has(id) ||
      attempt.kind !== "pending" ||
      attempt.id !== attemptId ||
      attempt.device.id !== deviceId ||
      !lease
    )
      throw new Error("Invalid pairing prompt identity");
    const identity = { id, attemptId, deviceId };
    if (item.kind === "authorization") prompt = { ...identity, kind: item.kind };
    else if (item.kind === "pin-entry" || item.kind === "passkey-entry") {
      if (raw.inputEnabled !== true) throw new Error("Bluetooth input capability disabled");
      prompt = { ...identity, kind: item.kind };
    } else if (item.kind === "confirmation" || item.kind === "display-code") {
      const code = text(item.code, 16);
      if (!/^\d{6}$/.test(code)) throw new Error("Invalid pairing code");
      if (item.kind === "confirmation") prompt = { ...identity, kind: item.kind, code };
      else {
        if (
          typeof item.entered !== "number" ||
          !Number.isInteger(item.entered) ||
          item.entered < 0 ||
          item.entered > 6
        )
          throw new Error("Invalid entered pairing digits");
        prompt = { ...identity, kind: item.kind, code, entered: item.entered };
      }
    } else throw new Error("Invalid pairing prompt");
  }
  return {
    kind: "ready",
    adapters,
    devices,
    lease,
    discovery,
    attempt,
    prompt,
    message: text(raw.message),
    ...(raw.inputEnabled === undefined ? {} : { inputEnabled: bool(raw.inputEnabled) }),
  };
}
export function parseBluetoothTrust(value: unknown): BluetoothTrustState {
  const raw = record(value);
  if (raw.kind === "disabled") return { kind: "disabled" };
  if (raw.kind !== "ready") throw new Error("Invalid Bluetooth trust state");
  const operation = record(raw.operation);
  if (operation.kind === "idle") return { kind: "ready", operation: { kind: "idle" } };
  const change = { id: parseBluetoothId(operation.id), trusted: bool(operation.trusted) };
  if (operation.kind === "confirmation") {
    if (
      typeof operation.expiresAt !== "number" ||
      !Number.isSafeInteger(operation.expiresAt) ||
      operation.expiresAt <= 0
    )
      throw new Error("Invalid Bluetooth trust deadline");
    return {
      kind: "ready",
      operation: {
        kind: "confirmation",
        ...change,
        challengeId: parseBluetoothId(operation.challengeId),
        expiresAt: operation.expiresAt,
      },
    };
  }
  if (operation.kind === "pending")
    return { kind: "ready", operation: { kind: "pending", ...change } };
  if (operation.kind === "error" || operation.kind === "unknown")
    return {
      kind: "ready",
      operation: { kind: operation.kind, ...change, message: text(operation.message) },
    };
  throw new Error("Invalid Bluetooth trust operation");
}
/** Validate the existing desktop-service JSON boundary once before presentation. */
export function parseDesktopBluetooth(value: unknown): DesktopBluetooth {
  const raw = record(value),
    status = record(raw.status),
    operation = record(raw.operation);
  let discovery: BluetoothDiscovery;
  if (status.kind === "unavailable")
    discovery = { kind: status.kind, message: text(status.message) };
  else if (status.kind === "loading" || status.kind === "error")
    discovery = {
      kind: status.kind,
      supported: bool(status.supported),
      message: text(status.message),
    };
  else if (status.kind === "ready") {
    if (status.policy !== "readonly" && status.policy !== "interactive")
      throw new Error("Invalid Bluetooth policy");
    if (
      !Array.isArray(status.adapters) ||
      !status.adapters.length ||
      status.adapters.length > 8 ||
      !Array.isArray(status.devices) ||
      status.devices.length > 64
    )
      throw new Error("Invalid Bluetooth list bounds");
    const identities = new Set<BluetoothId>();
    const adapters = status.adapters.map((value) => {
      const adapter = record(value),
        id = parseBluetoothId(adapter.id);
      if (identities.has(id)) throw new Error("Duplicate Bluetooth identity");
      identities.add(id);
      return { id, name: text(adapter.name, 256), powered: bool(adapter.powered) };
    });
    const adapterIds = new Set(adapters.map((adapter) => adapter.id));
    const devices: BluetoothDevice[] = status.devices.map((value) => {
      const device = record(value),
        id = parseBluetoothId(device.id),
        adapterId = parseBluetoothId(device.adapterId);
      if (identities.has(id) || !adapterIds.has(adapterId) || device.paired !== true)
        throw new Error("Invalid known Bluetooth device");
      identities.add(id);
      const address = text(device.address, 17);
      if (!/^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(address))
        throw new Error("Invalid Bluetooth address");
      return {
        id,
        adapterId,
        name: text(device.name, 256),
        address,
        paired: true,
        trusted: bool(device.trusted),
        connected: bool(device.connected),
      };
    });
    discovery = { kind: "ready", policy: status.policy, adapters, devices };
  } else throw new Error("Invalid Bluetooth discovery");
  let parsedOperation: BluetoothOperation;
  if (operation.kind === "idle") parsedOperation = { kind: "idle" };
  else if (
    operation.kind === "pending" ||
    operation.kind === "error" ||
    operation.kind === "unknown"
  ) {
    const change = { id: parseBluetoothId(operation.id), connected: bool(operation.connected) };
    parsedOperation =
      operation.kind === "pending"
        ? { kind: "pending", ...change }
        : { kind: operation.kind, ...change, message: text(operation.message) };
  } else throw new Error("Invalid Bluetooth operation");
  return {
    status: discovery,
    operation: parsedOperation,
    ...(raw.pairing === undefined ? {} : { pairing: parseBluetoothPairing(raw.pairing) }),
    ...(raw.trust === undefined ? {} : { trust: parseBluetoothTrust(raw.trust) }),
  };
}
