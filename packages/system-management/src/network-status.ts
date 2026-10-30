/** NetworkManager observations; local interface addresses stay a separate fact. */
export type NetworkConnectivity = "unknown" | "none" | "portal" | "limited" | "full";
export type WifiAccessPoint = Readonly<{
  id: string;
  ssid: string;
  strength: number;
  security: "open" | "wpa-psk" | "unsupported";
  connected: boolean;
  /** A saved NetworkManager profile exists for this SSID. */
  saved?: boolean;
  /**
   * Who the saved profiles belong to: `user` when every one names only this user, `system` when
   * any is shared by everyone on this computer. Omitted when not saved, and by older services.
   */
  ownership?: ProfileOwnership;
  /**
   * Forget would remove at least one saved profile. With `ownership: "system"` it removes only
   * this user's own, and the network stays saved for everyone. Older services omit it; then
   * Forget is offered for any saved network.
   */
  canForget?: boolean;
}>;
/**
 * `user`: the profile's `connection.permissions` name only this user, so NetworkManager's
 * `settings.modify.own` covers changing it. `system`: shared by every user (or several), which
 * needs `settings.modify.system`.
 */
export type ProfileOwnership = "user" | "system";
export type NetworkOperation =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "connecting"; ssid: string; cancellable: boolean }>
  | Readonly<{ kind: "cancelling"; ssid: string }>
  | Readonly<{ kind: "error" | "unknown"; message: string }>;
export type CurrentNetworkConnection =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "active"; name: string; transport: "wired" | "wifi" | "other" }>;
/** Mobile broadband radio; airplane mode turns it off with Wi‑Fi and Bluetooth. */
export type WwanRadio = Readonly<{
  enabled: boolean;
  hardwareEnabled: boolean;
  canToggle: boolean;
  /** Mobile broadband modems present. Omitted by older services. */
  modems?: number;
}>;
export type VpnKind = "wireguard" | "openvpn" | "other";
export type VpnState = "disconnected" | "connecting" | "connected" | "disconnecting";
export type VpnConnection = Readonly<{
  /** The NetworkManager profile UUID. */
  id: string;
  name: string;
  kind: VpnKind;
  state: VpnState;
  /** Omitted by older services. */
  ownership?: ProfileOwnership;
  /** Remove is permitted; false for a VPN shared by everyone. Older services omit it. */
  canRemove?: boolean;
}>;
export type NetworkVpn = Readonly<{
  connections: readonly VpnConnection[];
  /** Connect, disconnect, import and remove are permitted. */
  canManage: boolean;
  /** Kinds this computer can import: WireGuard is built in, OpenVPN needs its plugin. */
  importable: readonly Exclude<VpnKind, "other">[];
}>;
/** NetworkManager's per-connection proxy for the primary connection. */
export type NetworkProxy = Readonly<{
  /** The connection profile it belongs to. */
  connection: string;
  method: "none" | "auto";
  /** Empty with `auto` means discover it (WPAD). */
  pacUrl: string;
  canChange: boolean;
  /** Omitted by older services. */
  ownership?: ProfileOwnership;
  /**
   * The profile is shared and can't be changed for everyone, so a change is saved to this
   * user's own copy of it, which then connects in its place ("applies to you only").
   */
  copy?: boolean;
  /**
   * Making that copy needs the Wi‑Fi password: a shared profile's secrets can't be read
   * without `settings.modify.system`, so Settings asks for it.
   */
  needsPassword?: boolean;
}>;
export type DesktopWifi =
  | Readonly<{ kind: "loading" | "unavailable" | "error"; message: string }>
  | Readonly<{
      kind: "ready";
      policy: "readonly" | "interactive";
      enabled: boolean;
      hardwareEnabled: boolean;
      canConnect: boolean;
      canScan: boolean;
      /** WirelessEnabled is writable under interactive policy. */
      canToggle?: boolean;
      connectivity: NetworkConnectivity;
      connection: CurrentNetworkConnection;
      accessPoints: readonly WifiAccessPoint[];
      operation: NetworkOperation;
      /**
       * Managed Wi‑Fi devices. Zero means there is no Wi‑Fi hardware at all, which differs from
       * the radio being off (`enabled`). Omitted by older services.
       */
      adapters?: number;
      /** Omitted by older services. */
      wwan?: WwanRadio;
      /** Omitted when saved profiles can't be read (read-only policy). */
      vpn?: NetworkVpn;
      /** Omitted when there is no primary connection or its profile can't be read. */
      proxy?: NetworkProxy;
    }>;
export const WIFI_UNAVAILABLE: DesktopWifi = Object.freeze({
  kind: "unavailable",
  message: "NetworkManager Wi-Fi backend unavailable",
});

/** WPA personal input supported by this connection flow, shared by UI and service. */
export function isValidWpaPsk(password: string): boolean {
  return /^[\x20-\x7e]{8,63}$/.test(password) || /^[0-9a-fA-F]{64}$/.test(password);
}

export type HiddenWifiSecurity = "open" | "wpa-psk" | "sae";
export type HiddenWifiRequest = Readonly<{
  ssid: string;
  security: HiddenWifiSecurity;
  password: string;
}>;
/** SSIDs are at most 32 bytes. */
export function ssidByteLength(ssid: string): number {
  return Buffer.byteLength(ssid, "utf8");
}
/** Validate a hidden-network request at each boundary; messages are safe to show. */
export function parseHiddenWifiRequest(value: unknown): HiddenWifiRequest {
  const raw = object(value);
  const ssid = raw.ssid;
  if (typeof ssid !== "string" || !ssid.trim() || ssidByteLength(ssid) > 32 || ssid.includes("\0"))
    throw new Error("Enter a network name of up to 32 bytes");
  const security = raw.security;
  if (security !== "open" && security !== "wpa-psk" && security !== "sae")
    throw new Error("Choose the network's security");
  const password = raw.password;
  if (typeof password !== "string") throw new Error("Invalid network password");
  if (security === "open" && password) throw new Error("An open network has no password");
  if (security === "wpa-psk" && !isValidWpaPsk(password))
    throw new Error("Enter a valid WPA passphrase or hexadecimal key");
  if (security === "sae" && !/^[\x20-\x7e]{8,128}$/.test(password))
    throw new Error("Enter a WPA3 password of 8 to 128 characters");
  return { ssid, security, password };
}
export type ProxyRequest = Readonly<{
  method: "none" | "auto";
  pacUrl: string;
  /** The Wi‑Fi password, only when the proxy says `needsPassword`. */
  password?: string;
}>;
/** A PAC address: http(s) or file, or empty to discover it. */
export function isValidPacUrl(url: string): boolean {
  if (url === "") return true;
  if (url.length > 2048 || /\s/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return ["http:", "https:", "file:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}
export function parseProxyRequest(value: unknown): ProxyRequest {
  const raw = object(value);
  if (raw.method !== "none" && raw.method !== "auto") throw new Error("Invalid proxy method");
  const pacUrl = typeof raw.pacUrl === "string" ? raw.pacUrl.trim() : "";
  if (!isValidPacUrl(pacUrl)) throw new Error("Enter an http, https or file address");
  const password = raw.password === undefined ? "" : raw.password;
  if (typeof password !== "string" || password.length > 128 || password.includes("\0"))
    throw new Error("Invalid network password");
  return {
    method: raw.method,
    pacUrl: raw.method === "auto" ? pacUrl : "",
    ...(password ? { password } : {}),
  };
}
export type VpnImportRequest = Readonly<{
  kind: Exclude<VpnKind, "other">;
  name: string;
  /** The configuration file's text, with referenced files inlined. */
  config: string;
  /** OpenVPN with auth-user-pass; stored with the profile because Moire runs no secret agent. */
  username: string;
  password: string;
}>;
/** Most VPN configurations are a few KiB; certificates inline make OpenVPN's larger. */
export const VPN_CONFIG_LIMIT = 128 * 1024;
export function parseVpnImportRequest(value: unknown): VpnImportRequest {
  const raw = object(value);
  if (raw.kind !== "wireguard" && raw.kind !== "openvpn") throw new Error("Unsupported VPN type");
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  // Names are shown and stored; control characters never are.
  // oxlint-disable-next-line no-control-regex
  if (!name || name.length > 128 || /[\u0000-\u001f\u007f]/.test(name))
    throw new Error("Enter a name for the VPN");
  const config = raw.config;
  if (typeof config !== "string" || !config.trim() || config.length > VPN_CONFIG_LIMIT)
    throw new Error("The VPN configuration is empty or too large");
  if (config.includes("\0")) throw new Error("The VPN configuration isn't a text file");
  const username = typeof raw.username === "string" ? raw.username : "";
  const password = typeof raw.password === "string" ? raw.password : "";
  // Names are shown and stored; control characters never are.
  // oxlint-disable-next-line no-control-regex
  if (username.length > 256 || /[\u0000-\u001f\u007f]/.test(username))
    throw new Error("Invalid VPN user name");
  if (password.length > 256 || password.includes("\0")) throw new Error("Invalid VPN password");
  return { kind: raw.kind, name, config, username, password };
}
/** NetworkManager profile UUIDs identify VPN connections across the boundary. */
export function parseVpnId(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value)
  )
    throw new Error("Invalid VPN identity");
  return value.toLowerCase();
}

export type WifiAdapter = {
  readonly state: DesktopWifi;
  subscribe(listener: () => void): () => void;
  refresh(): Promise<void>;
  scan(): Promise<void>;
  connect(request: Readonly<{ id: string; password: string }>): Promise<void>;
  cancel(): Promise<void>;
  setEnabled?(enabled: boolean): Promise<void>;
  disconnect?(): Promise<void>;
  forget?(id: string): Promise<void>;
  connectHidden?(request: HiddenWifiRequest): Promise<void>;
  /** Write the Wi‑Fi and mobile broadband radio switches; omitted radios are left alone. */
  setRadios?(request: Readonly<{ wifi?: boolean; wwan?: boolean }>): Promise<void>;
  activateVpn?(id: string): Promise<void>;
  deactivateVpn?(id: string): Promise<void>;
  removeVpn?(id: string): Promise<void>;
  importVpn?(request: VpnImportRequest): Promise<void>;
  setProxy?(request: ProxyRequest): Promise<void>;
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
/** A small device count. */
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 64)
    throw new Error("Invalid network device count");
  return value;
}
/** NetworkManager is ready and has Wi‑Fi hardware (or is an older service that doesn't say). */
export function hasWifiAdapter(wifi: DesktopWifi): boolean {
  return wifi.kind === "ready" && wifi.adapters !== 0;
}
function ownership(value: unknown): { ownership?: ProfileOwnership } {
  if (value === undefined) return {};
  if (value !== "user" && value !== "system") throw new Error("Invalid profile ownership");
  return { ownership: value };
}
/** An optional flag that read-only policy can never set. */
function flag<K extends string>(
  raw: Record<string, unknown>,
  key: K,
  policy: unknown,
): { [P in K]?: boolean } {
  if (raw[key] === undefined) return {};
  const on = bool(raw[key]);
  if (policy === "readonly" && on)
    throw new Error("Read-only network policy cannot allow mutations");
  return { [key]: on } as { [P in K]?: boolean };
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
      ...(ap.saved === undefined ? {} : { saved: bool(ap.saved) }),
      ...ownership(ap.ownership),
      ...flag(ap, "canForget", raw.policy),
    };
  });
  const canConnect = bool(raw.canConnect),
    canScan = bool(raw.canScan),
    canToggle = raw.canToggle === undefined ? undefined : bool(raw.canToggle);
  if (raw.policy === "readonly" && (canConnect || canScan || canToggle))
    throw new Error("Read-only network policy cannot allow mutations");
  let wwan: WwanRadio | undefined;
  if (raw.wwan !== undefined) {
    const radio = object(raw.wwan);
    wwan = {
      enabled: bool(radio.enabled),
      hardwareEnabled: bool(radio.hardwareEnabled),
      canToggle: bool(radio.canToggle),
      ...(radio.modems === undefined ? {} : { modems: count(radio.modems) }),
    };
    if (raw.policy === "readonly" && wwan.canToggle)
      throw new Error("Read-only network policy cannot allow mutations");
  }
  let vpn: NetworkVpn | undefined;
  if (raw.vpn !== undefined) {
    const item = object(raw.vpn);
    if (!Array.isArray(item.connections) || item.connections.length > 64)
      throw new Error("Invalid VPN list");
    const ids = new Set<string>();
    const connections = item.connections.map((value): VpnConnection => {
      const connection = object(value),
        id = parseVpnId(connection.id);
      if (ids.has(id)) throw new Error("Duplicate VPN identity");
      ids.add(id);
      const kind = connection.kind,
        state = connection.state;
      if (kind !== "wireguard" && kind !== "openvpn" && kind !== "other")
        throw new Error("Invalid VPN kind");
      if (
        state !== "disconnected" &&
        state !== "connecting" &&
        state !== "connected" &&
        state !== "disconnecting"
      )
        throw new Error("Invalid VPN state");
      return {
        id,
        name: text(connection.name, 256),
        kind,
        state,
        ...ownership(connection.ownership),
        ...flag(connection, "canRemove", raw.policy),
      };
    });
    if (!Array.isArray(item.importable) || item.importable.length > 2)
      throw new Error("Invalid VPN import kinds");
    const importable = [...new Set(item.importable)].map((kind) => {
      if (kind !== "wireguard" && kind !== "openvpn") throw new Error("Invalid VPN import kind");
      return kind;
    });
    vpn = { connections, canManage: bool(item.canManage), importable };
    if (raw.policy === "readonly" && vpn.canManage)
      throw new Error("Read-only network policy cannot allow mutations");
  }
  let proxy: NetworkProxy | undefined;
  if (raw.proxy !== undefined) {
    const item = object(raw.proxy);
    if (item.method !== "none" && item.method !== "auto") throw new Error("Invalid proxy method");
    const pacUrl = text(item.pacUrl, 2048);
    if (!isValidPacUrl(pacUrl)) throw new Error("Invalid proxy address");
    proxy = {
      connection: text(item.connection, 256),
      method: item.method,
      pacUrl,
      canChange: bool(item.canChange),
      ...ownership(item.ownership),
      ...flag(item, "copy", raw.policy),
      ...flag(item, "needsPassword", raw.policy),
    };
    if (raw.policy === "readonly" && proxy.canChange)
      throw new Error("Read-only network policy cannot allow mutations");
  }
  return {
    kind: "ready",
    policy: raw.policy,
    enabled: bool(raw.enabled),
    hardwareEnabled: bool(raw.hardwareEnabled),
    canConnect,
    canScan,
    ...(canToggle === undefined ? {} : { canToggle }),
    connectivity,
    connection: current,
    accessPoints,
    operation: activity,
    ...(raw.adapters === undefined ? {} : { adapters: count(raw.adapters) }),
    ...(wwan ? { wwan } : {}),
    ...(vpn ? { vpn } : {}),
    ...(proxy ? { proxy } : {}),
  };
}
