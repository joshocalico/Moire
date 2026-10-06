/** NetworkManager observations; local interface addresses stay a separate fact. */
export type NetworkConnectivity = "unknown" | "none" | "portal" | "limited" | "full";
export type WifiAccessPoint = Readonly<{
  id: string;
  ssid: string;
  strength: number;
  security: "open" | "wpa-psk" | "unsupported";
  connected: boolean;
}>;
export type NetworkOperation =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "connecting"; ssid: string; cancellable: boolean }>
  | Readonly<{ kind: "cancelling"; ssid: string }>
  | Readonly<{ kind: "error" | "unknown"; message: string }>;
export type CurrentNetworkConnection =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "active"; name: string; transport: "wired" | "wifi" | "other" }>;
export type DesktopWifi =
  | Readonly<{ kind: "loading" | "unavailable" | "error"; message: string }>
  | Readonly<{
      kind: "ready";
      policy: "readonly" | "interactive";
      enabled: boolean;
      hardwareEnabled: boolean;
      canConnect: boolean;
      canScan: boolean;
      connectivity: NetworkConnectivity;
      connection: CurrentNetworkConnection;
      accessPoints: readonly WifiAccessPoint[];
      operation: NetworkOperation;
    }>;
export const WIFI_UNAVAILABLE: DesktopWifi = Object.freeze({
  kind: "unavailable",
  message: "NetworkManager Wi-Fi backend unavailable",
});

/** WPA personal input supported by this connection flow, shared by UI and service. */
export function isValidWpaPsk(password: string): boolean {
  return /^[\x20-\x7e]{8,63}$/.test(password) || /^[0-9a-fA-F]{64}$/.test(password);
}

export type WifiAdapter = {
  readonly state: DesktopWifi;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  scan(): Promise<void>;
  connect(request: Readonly<{ id: string; password: string }>): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid network status object");
  return value as Record<string, unknown>;
}
function text(value: unknown, limit: number): string {
  if (typeof value !== "string" || value.length > limit || value.includes("\0"))
    throw new Error("Invalid network status text");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid network status boolean");
  return value;
}

/** Parse once where the existing desktop service's JSON crosses into the shell. */
export function parseDesktopWifi(value: unknown): DesktopWifi {
  const raw = object(value);
  if (raw.kind === "loading" || raw.kind === "unavailable" || raw.kind === "error")
    return { kind: raw.kind, message: text(raw.message, 512) };
  if (raw.kind !== "ready") throw new Error("Invalid network status kind");
  if (raw.policy !== "readonly" && raw.policy !== "interactive")
    throw new Error("Invalid network control policy");
  const connectivity = raw.connectivity;
  if (
    connectivity !== "unknown" &&
    connectivity !== "none" &&
    connectivity !== "portal" &&
    connectivity !== "limited" &&
    connectivity !== "full"
  )
    throw new Error("Invalid network connectivity");
  const connection = object(raw.connection);
  let current: CurrentNetworkConnection;
  if (connection.kind === "none") current = { kind: "none" };
  else if (
    connection.kind === "active" &&
    (connection.transport === "wired" ||
      connection.transport === "wifi" ||
      connection.transport === "other")
  )
    current = { kind: "active", name: text(connection.name, 256), transport: connection.transport };
  else throw new Error("Invalid current network connection");
  const operation = object(raw.operation);
  let activity: NetworkOperation;
  switch (operation.kind) {
    case "idle":
      activity = { kind: "idle" };
      break;
    case "connecting":
      activity = {
        kind: "connecting",
        ssid: text(operation.ssid, 256),
        cancellable: bool(operation.cancellable),
      };
      break;
    case "cancelling":
      activity = { kind: "cancelling", ssid: text(operation.ssid, 256) };
      break;
    case "error":
    case "unknown":
      activity = { kind: operation.kind, message: text(operation.message, 512) };
      break;
    default:
      throw new Error("Invalid network operation");
  }
  if (!Array.isArray(raw.accessPoints) || raw.accessPoints.length > 64)
    throw new Error("Invalid access point list");
  const identities = new Set<string>();
  const accessPoints = raw.accessPoints.map((value): WifiAccessPoint => {
    const ap = object(value),
      id = text(ap.id, 2048);
    if (!id || identities.has(id)) throw new Error("Invalid access point identity");
    identities.add(id);
    if (
      typeof ap.strength !== "number" ||
      !Number.isInteger(ap.strength) ||
      ap.strength < 0 ||
      ap.strength > 100
    )
      throw new Error("Invalid access point strength");
    if (ap.security !== "open" && ap.security !== "wpa-psk" && ap.security !== "unsupported")
      throw new Error("Invalid access point security");
    return {
      id,
      ssid: text(ap.ssid, 256),
      strength: ap.strength,
      security: ap.security,
      connected: bool(ap.connected),
    };
  });
  const canConnect = bool(raw.canConnect),
    canScan = bool(raw.canScan);
  if (raw.policy === "readonly" && (canConnect || canScan))
    throw new Error("Read-only network policy cannot allow mutations");
  return {
    kind: "ready",
    policy: raw.policy,
    enabled: bool(raw.enabled),
    hardwareEnabled: bool(raw.hardwareEnabled),
    canConnect,
    canScan,
    connectivity,
    connection: current,
    accessPoints,
    operation: activity,
  };
}
