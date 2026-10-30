import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { SessionBus, DbusRemoteError, variant, type DbusDisposer } from "@moire/dbus";
import {
  WIFI_UNAVAILABLE,
  isValidWpaPsk,
  parseHiddenWifiRequest,
  parseProxyRequest,
  parseVpnId,
  parseVpnImportRequest,
  type WifiAdapter,
  type DesktopWifi,
  type NetworkOperation,
  type CurrentNetworkConnection,
  type WifiAccessPoint,
  type HiddenWifiRequest,
  type NetworkProxy,
  type NetworkVpn,
  type ProfileOwnership,
  type ProxyRequest,
  type VpnImportRequest,
  type VpnKind,
  type VpnState,
} from "@moire/system-management/network-status";
import {
  installedVpnPlugins,
  removeVpnFiles,
  vpnProfileSettings,
  vpnDataDirectory,
  type VpnPlugin,
} from "./network-vpn";

const NM = "org.freedesktop.NetworkManager",
  ROOT = "/org/freedesktop/NetworkManager";
const PROPERTIES = "org.freedesktop.DBus.Properties",
  DEVICE = NM + ".Device",
  WIRELESS = DEVICE + ".Wireless",
  ACCESS = NM + ".AccessPoint",
  ACTIVE = NM + ".Connection.Active",
  SETTINGS = NM + ".Settings",
  PROFILE = SETTINGS + ".Connection",
  SETTINGS_PATH = ROOT + "/Settings";
const PERMISSION = NM + ".network-control",
  MODIFY = NM + ".settings.modify.own",
  MODIFY_SYSTEM = NM + ".settings.modify.system",
  SCAN = NM + ".wifi.scan",
  TOGGLE = NM + ".enable-disable-wifi",
  TOGGLE_WWAN = NM + ".enable-disable-wwan";
/** NMDeviceType values. */
const WIFI_DEVICE = 2,
  MODEM_DEVICE = 8;
/**
 * `user.data` key marking a user's copy of a shared profile, holding the shared profile's UUID
 * (NetworkManager has kept `user.data` since 1.8).
 */
export const COPY_KEY = "moire.copy-of";
export type NetworkManagerOptions = {
  connect?: () => Promise<SessionBus>;
  policy?: "readonly" | "interactive";
  callTimeoutMs?: number;
  pollMs?: number;
  /** Installed NetworkManager VPN plugins; read from the plugin directories by default. */
  vpnPlugins?: () => readonly VpnPlugin[];
  /** Where imported OpenVPN certificates are kept; `$XDG_DATA_HOME/moire/vpn` by default. */
  vpnDataDir?: string;
  /** The session user profiles are owned by; the process's user by default. */
  user?: string;
};
type AccessPoint = {
  id: string;
  path: string;
  device: string;
  ssid: Buffer;
  name: string;
  security: WifiAccessPoint["security"];
  strength: number;
  connected: boolean;
};
type Attempt = {
  owner: string;
  device: string;
  ap: string;
  ssid: string;
  uuid: string;
  active: string | null;
  connection: string | null;
  cancelling: boolean;
};
type ActiveConnection = {
  path: string;
  connection: string;
  uuid: string;
  specific: string;
  devices: string[];
  state: number;
  name: string;
  transport: "wifi" | "wired" | "other";
};
type SavedProfile = {
  path: string;
  type: string;
  uuid: string;
  id: string;
  /** Wi‑Fi profiles only. */
  ssid: Buffer | null;
  /** VPN and WireGuard profiles only. */
  vpn: VpnKind | null;
  interfaceName: string;
  proxy: { method: "none" | "auto"; pacUrl: string };
  ownership: ProfileOwnership;
  /** The shared profile's UUID when this is the user's copy of it. */
  copyOf: string | null;
  autoconnect: boolean;
  priority: number;
  /**
   * The secrets a copy would need: none, a Wi‑Fi password the user can type again, or ones
   * Moire can't ask for (enterprise sign-in, WEP, mobile broadband and the like).
   */
  secrets: "none" | "psk" | "other";
  /** `802-11-wireless-security.key-mgmt`, for checking a password typed for a copy. */
  keyMgmt: string;
};
type Observation = {
  state: Extract<DesktopWifi, { kind: "ready" }>;
  aps: AccessPoint[];
  /** Null when profiles were not read (read-only policy) or could not be read. */
  profiles: SavedProfile[] | null;
  allowed: Record<string, unknown>;
  devices: string[];
  actives: ActiveConnection[];
  cancelledAbsent: boolean;
  /** The primary connection, for its proxy. */
  primary: ActiveConnection | null;
};
/** A precondition refusal whose message is safe and useful to show as-is. */
class Refused extends Error {}
function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)
  );
}
function dictionary(value: unknown, limit = 128): Record<string, unknown> {
  if (!record(value) || Object.keys(value).length > limit)
    throw new Error("Invalid network dictionary");
  return value;
}
function property(raw: Record<string, unknown>, key: string, signature: string): unknown {
  const v = raw[key];
  if (!record(v) || v.signature !== signature || !("value" in v))
    throw new Error("Invalid network property");
  return v.value;
}
/** A property NetworkManager leaves out when it has its default value. */
function optional(raw: Record<string, unknown>, key: string, signature: string): unknown {
  return key in raw ? property(raw, key, signature) : undefined;
}
function uint(value: unknown, max = 0xffff_ffff): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max)
    throw new Error("Invalid network integer");
  return value;
}
function int(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw new Error("Invalid network integer");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid network boolean");
  return value;
}
function text(value: unknown, limit = 256): string {
  if (typeof value !== "string" || value.length > limit || value.includes("\0"))
    throw new Error("Invalid network text");
  return value;
}
function objectPath(value: unknown): string {
  const p = text(value, 512);
  if (!/^\/(?:[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*)?$/.test(p))
    throw new Error("Invalid network object path");
  return p;
}
function paths(value: unknown, limit: number): string[] {
  if (!Array.isArray(value) || value.length > limit)
    throw new Error("Network object list exceeds bounds");
  const out = value.map(objectPath);
  if (new Set(out).size !== out.length) throw new Error("Duplicate network objects");
  return out.sort();
}
function ssidBytes(value: unknown): Buffer {
  if (!(value instanceof Uint8Array) || value.length > 32) throw new Error("Invalid network SSID");
  return Buffer.from(value);
}
function security(
  flags: number,
  wpa: number,
  rsn: number,
  mode: number,
  ssid: Buffer,
): WifiAccessPoint["security"] {
  if (mode !== 2 || !ssid.length) return "unsupported";
  const combined = wpa | rsn;
  if (flags === 0 && combined === 0) return "open";
  if ((flags & ~1) === 0 && (combined & 256) !== 0 && (combined & ~511) === 0) return "wpa-psk";
  return "unsupported";
}
/**
 * NetworkManager uses `settings.modify.own` only for a profile whose permissions name exactly one
 * user, the caller; anything else (no permissions: every user) needs `settings.modify.system`.
 */
function ownershipOf(permissions: readonly string[], user: string): ProfileOwnership {
  if (permissions.length !== 1) return "system";
  const match = /^user:([^:]+)(?::.*)?$/.exec(permissions[0]!);
  return match?.[1] === user ? "user" : "system";
}
/** What secrets a copy of a profile would have to carry. */
function secretsOf(raw: Record<string, unknown>, type: string): SavedProfile["secrets"] {
  if (raw["802-1x"] !== undefined) return "other";
  if (type === "802-3-ethernet") return "none";
  if (type !== "802-11-wireless") return "other";
  if (raw["802-11-wireless-security"] === undefined) return "none";
  const keyMgmt = text(
    optional(dictionary(raw["802-11-wireless-security"]), "key-mgmt", "s") ?? "",
  );
  if (keyMgmt === "wpa-psk" || keyMgmt === "sae") return "psk";
  return keyMgmt === "owe" ? "none" : "other";
}
function denied(error: unknown): boolean {
  return (
    error instanceof DbusRemoteError &&
    /AccessDenied|NotAuthorized|PermissionDenied/.test(error.errorName)
  );
}
/** This session may change or delete the profile itself. */
function editable(profile: SavedProfile, allowed: Record<string, unknown>): boolean {
  return allowed[profile.ownership === "user" ? MODIFY : MODIFY_SYSTEM] === "yes";
}
/**
 * A shared wired or Wi‑Fi profile this session can't change, but can save its own copy of: the
 * copy needs `settings.modify.own`, activating it `network-control`, and any secrets must be
 * ones the user can type again (shared secrets can't be read without `settings.modify.system`).
 */
function copyable(profile: SavedProfile, allowed: Record<string, unknown>): boolean {
  return (
    profile.ownership === "system" &&
    !editable(profile, allowed) &&
    allowed[MODIFY] === "yes" &&
    allowed[PERMISSION] === "yes" &&
    (profile.type === "802-3-ethernet" || profile.type === "802-11-wireless") &&
    profile.secrets !== "other"
  );
}
/** The user's copy of a shared profile, made by an earlier change. */
function copyFor(profiles: readonly SavedProfile[], original: SavedProfile): SavedProfile | null {
  return (
    profiles.find(
      (p) => p.ownership === "user" && p.copyOf === original.uuid && p.type === original.type,
    ) ?? null
  );
}
/** NetworkManager's range for `connection.autoconnect-priority`. */
const PRIORITY_MAX = 999;
/**
 * The user's own copy of a shared profile's settings: a new identity, permissions naming only
 * the user (so `settings.modify.own` covers it), autoconnect on at a higher priority than the
 * shared profile so it wins the next time the device connects, and the Moire marker. A Wi‑Fi
 * password typed for the copy is stored with it (flags 0): Moire runs no secret agent.
 */
export function userCopy(
  settings: Record<string, unknown>,
  original: Pick<SavedProfile, "uuid" | "id" | "priority">,
  uuid: string,
  user: string,
  password: string,
): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [name, section] of Object.entries(settings)) copy[name] = { ...dictionary(section) };
  const connection = copy.connection as Record<string, unknown>;
  delete connection.timestamp;
  connection.uuid = variant("s", uuid);
  connection.id = variant("s", `${original.id.slice(0, 200) || "Connection"} (${user})`);
  connection.permissions = variant("as", [`user:${user}:`]);
  connection.autoconnect = variant("b", true);
  connection["autoconnect-priority"] = variant("i", Math.min(PRIORITY_MAX, original.priority + 1));
  const userSection = (copy.user ?? {}) as Record<string, unknown>;
  const data =
    userSection.data === undefined ? {} : dictionary(property(userSection, "data", "a{ss}"));
  copy.user = { ...userSection, data: variant("a{ss}", { ...data, [COPY_KEY]: original.uuid }) };
  if (password) {
    const security = copy["802-11-wireless-security"] as Record<string, unknown> | undefined;
    if (!security) throw new Error("This network has no password");
    security.psk = variant("s", password);
    security["psk-flags"] = variant("u", 0);
  }
  return copy;
}
function uncertain(error: unknown, sent: boolean): boolean {
  return (
    sent &&
    !(
      error instanceof DbusRemoteError &&
      !/NoReply|Timeout|Disconnected|NameHasNoOwner|ServiceUnknown/.test(error.errorName)
    )
  );
}
function failure(error: unknown, uncertain: boolean): string {
  if (denied(error)) return "NetworkManager denied this operation";
  return uncertain
    ? "Network operation outcome is unknown; refresh before another attempt"
    : "NetworkManager operation failed";
}

/** Own system-bus connection; never starts NetworkManager or requests authentication. */
export async function createNetworkManagerAdapter(
  options: NetworkManagerOptions = {},
): Promise<WifiAdapter> {
  const policy = options.policy ?? process.env.MOIRE_NETWORK_CONTROL ?? "readonly";
  const callTimeout = options.callTimeoutMs ?? 2500,
    pollMs = options.pollMs ?? 5000;
  const vpnPlugins = options.vpnPlugins ?? installedVpnPlugins;
  const vpnDir = options.vpnDataDir ?? vpnDataDirectory();
  const user = options.user ?? os.userInfo().username;
  let state: DesktopWifi = { kind: "loading", message: "Reading NetworkManager Wi-Fi devices" };
  const listeners = new Set<() => void>();
  let bus: SessionBus | null = null,
    owner: string | null = null,
    disposed = false,
    epoch = 0;
  let scope = new AbortController(),
    operation: NetworkOperation = { kind: "idle" },
    attempt: Attempt | null = null,
    aps: AccessPoint[] = [];
  let refreshing: Promise<void> | null = null,
    refreshAgain = false,
    mutating = false;
  let mutationDeadline = Infinity;
  let poll: ReturnType<typeof setInterval> | null = null,
    unwatch: DbusDisposer | null = null,
    disconnect = () => {};
  const subscriptions = new Map<string, DbusDisposer>();
  const publish = (next: DesktopWifi) => {
    if (disposed || JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    for (const listener of Array.from(listeners)) listener();
  };
  const publishOperation = () => {
    if (state.kind === "ready") publish({ ...state, operation });
  };
  const current = (expected: string, expectedEpoch: number) => {
    if (disposed || owner !== expected || epoch !== expectedEpoch || scope.signal.aborted)
      throw new Error("NetworkManager identity changed");
  };
  async function call(
    expected: string,
    expectedEpoch: number,
    path: string,
    iface: string,
    member: string,
    signature = "",
    body: unknown[] = [],
    deadline = performance.now() + 8000,
  ) {
    current(expected, expectedEpoch);
    const remaining = Math.ceil(Math.min(deadline, mutationDeadline) - performance.now());
    if (remaining < 1 || !bus) throw new Error("Network read deadline expired");
    const result = await bus.call(
      { destination: expected, path, interface: iface, member, signature, body },
      { signal: scope.signal, timeoutMs: Math.min(callTimeout, remaining) },
    );
    current(expected, expectedEpoch);
    return result;
  }
  async function props(
    expected: string,
    version: number,
    path: string,
    iface: string,
    deadline: number,
  ) {
    const reply = await call(expected, version, path, PROPERTIES, "GetAll", "s", [iface], deadline);
    if (reply.signature !== "a{sv}" || reply.body?.length !== 1)
      throw new Error("Invalid network property reply");
    return dictionary(reply.body[0]);
  }
  async function permissions(expected: string, version: number, deadline: number) {
    const reply = await call(expected, version, ROOT, NM, "GetPermissions", "", [], deadline);
    if (reply.signature !== "a{ss}" || reply.body?.length !== 1)
      throw new Error("Invalid network permission reply");
    const result = dictionary(reply.body[0]);
    for (const [key, value] of Object.entries(result)) {
      text(key, 256);
      if (value !== "yes" && value !== "no" && value !== "auth")
        throw new Error("Invalid network permission");
    }
    return result;
  }
  async function active(
    expected: string,
    version: number,
    p: string,
    deadline: number,
  ): Promise<ActiveConnection> {
    const v = await props(expected, version, p, ACTIVE, deadline);
    const kind = text(property(v, "Type", "s"));
    return {
      path: p,
      connection: objectPath(property(v, "Connection", "o")),
      uuid: text(property(v, "Uuid", "s")),
      specific: objectPath(property(v, "SpecificObject", "o")),
      devices: paths(property(v, "Devices", "ao"), 8),
      state: uint(property(v, "State", "u"), 4),
      name: text(property(v, "Id", "s")),
      transport:
        kind === "802-11-wireless" ? "wifi" : kind === "802-3-ethernet" ? "wired" : "other",
    };
  }
  async function readAp(
    expected: string,
    version: number,
    device: string,
    p: string,
    connectedPath: string,
    deadline: number,
    deviceIdentity: string,
  ): Promise<AccessPoint> {
    const v = await props(expected, version, p, ACCESS, deadline),
      bytes = ssidBytes(property(v, "Ssid", "ay"));
    const flags = uint(property(v, "Flags", "u")),
      wpa = uint(property(v, "WpaFlags", "u")),
      rsn = uint(property(v, "RsnFlags", "u")),
      mode = uint(property(v, "Mode", "u"));
    const bssid = text(property(v, "HwAddress", "s"), 64);
    const identity = createHash("sha256")
      .update(bytes)
      .update(`|${deviceIdentity}|${bssid}|${flags}|${wpa}|${rsn}|${mode}`)
      .digest("hex");
    return {
      id: `${expected}|${device}|${p}|${identity}`,
      path: p,
      device,
      ssid: bytes,
      name: bytes.length
        ? // Arbitrary SSID bytes retain their identity; controls are replaced only in display text.
          // oxlint-disable-next-line no-control-regex
          bytes.toString("utf8").replace(/[\u0000-\u001f\u007f]/g, "\ufffd")
        : "Hidden network",
      security: security(flags, wpa, rsn, mode, bytes),
      strength: uint(property(v, "Strength", "y"), 100),
      connected: p === connectedPath,
    };
  }
  async function savedProfiles(
    expected: string,
    version: number,
    deadline: number,
  ): Promise<SavedProfile[] | null> {
    // Only interactive policy offers Forget, so read-only never enumerates profiles.
    if (policy !== "interactive") return null;
    try {
      const reply = await call(
        expected,
        version,
        SETTINGS_PATH,
        SETTINGS,
        "ListConnections",
        "",
        [],
        deadline,
      );
      if (reply.signature !== "ao" || reply.body?.length !== 1)
        throw new Error("Invalid network profile list");
      const profiles = await Promise.all(
        paths(reply.body[0], 64).map(async (p) => {
          let settings;
          try {
            settings = await call(expected, version, p, PROFILE, "GetSettings", "", [], deadline);
          } catch (error) {
            // Another user's own profile (such as their copy of a shared one) isn't visible to
            // this user; it isn't ours to list, and it mustn't hide the rest.
            if (denied(error)) return null;
            throw error;
          }
          if (settings.signature !== "a{sa{sv}}" || settings.body?.length !== 1)
            throw new Error("Invalid network profile settings");
          const raw = dictionary(settings.body[0], 64);
          const connection = dictionary(raw.connection);
          const type = text(property(connection, "type", "s"));
          const service =
            type === "vpn" ? text(optional(dictionary(raw.vpn), "service-type", "s") ?? "") : "";
          const proxy = raw.proxy === undefined ? {} : dictionary(raw.proxy);
          const method = optional(proxy, "method", "i") ?? 0;
          const permissions = optional(connection, "permissions", "as") ?? [];
          if (!Array.isArray(permissions) || permissions.length > 64)
            throw new Error("Invalid network profile permissions");
          const data =
            raw.user === undefined
              ? {}
              : dictionary(optional(dictionary(raw.user), "data", "a{ss}") ?? {});
          const copyOf = data[COPY_KEY];
          return {
            path: p,
            type,
            uuid: text(property(connection, "uuid", "s")),
            id: text(optional(connection, "id", "s") ?? ""),
            interfaceName: text(optional(connection, "interface-name", "s") ?? "", 64),
            ssid:
              type === "802-11-wireless"
                ? ssidBytes(property(dictionary(raw["802-11-wireless"]), "ssid", "ay"))
                : null,
            vpn:
              type === "wireguard"
                ? "wireguard"
                : type === "vpn"
                  ? service.endsWith(".openvpn")
                    ? "openvpn"
                    : "other"
                  : null,
            proxy: {
              method: method === 1 ? "auto" : "none",
              pacUrl: text(optional(proxy, "pac-url", "s") ?? "", 2048),
            },
            ownership: ownershipOf(
              permissions.map((entry) => text(entry, 512)),
              user,
            ),
            copyOf: copyOf === undefined ? null : text(copyOf, 64),
            autoconnect: boolean(optional(connection, "autoconnect", "b") ?? true),
            priority: int(optional(connection, "autoconnect-priority", "i") ?? 0, -999, 999),
            secrets: secretsOf(raw, type),
            keyMgmt:
              raw["802-11-wireless-security"] === undefined
                ? ""
                : text(
                    optional(dictionary(raw["802-11-wireless-security"]), "key-mgmt", "s") ?? "",
                  ),
          } satisfies SavedProfile;
        }),
      );
      return profiles.filter((profile) => profile !== null);
    } catch {
      // An unreadable profile list leaves `saved` unknown rather than failing Wi-Fi status.
      current(expected, version);
      return null;
    }
  }
  async function observe(expected: string, version: number): Promise<Observation> {
    const deadline = performance.now() + 8000;
    const [manager, allowed, profiles] = await Promise.all([
      props(expected, version, ROOT, NM, deadline),
      permissions(expected, version, deadline),
      savedProfiles(expected, version, deadline),
    ]);
    const enabled = boolean(property(manager, "WirelessEnabled", "b")),
      hardwareEnabled = boolean(property(manager, "WirelessHardwareEnabled", "b")),
      networking = boolean(property(manager, "NetworkingEnabled", "b"));
    const wwanEnabled = optional(manager, "WwanEnabled", "b"),
      wwanHardware = optional(manager, "WwanHardwareEnabled", "b");
    const devices = paths(property(manager, "Devices", "ao"), 8),
      activePaths = paths(property(manager, "ActiveConnections", "ao"), 8),
      primary = objectPath(property(manager, "PrimaryConnection", "o")),
      connectivity = uint(property(manager, "Connectivity", "u"), 4);
    let modems = 0;
    const radios = (
      await Promise.all(
        devices.map(async (device) => {
          const v = await props(expected, version, device, DEVICE, deadline);
          const type = uint(property(v, "DeviceType", "u"));
          if (type === MODEM_DEVICE) modems++;
          if (type !== WIFI_DEVICE || !boolean(property(v, "Managed", "b"))) return null;
          const deviceIdentity =
            text(property(v, "Interface", "s"), 128) +
            "|" +
            text(property(v, "HwAddress", "s"), 64);
          const radio = await props(expected, version, device, WIRELESS, deadline);
          return {
            device,
            deviceIdentity,
            accessPaths: paths(property(radio, "AccessPoints", "ao"), 64),
            connected: objectPath(property(radio, "ActiveAccessPoint", "o")),
          };
        }),
      )
    ).filter((radio) => radio !== null);
    // Bound the combined set before scheduling any AP property requests.
    if (radios.reduce((total, radio) => total + radio.accessPaths.length, 0) > 64)
      throw new Error("Network access points exceed bounds");
    const wireless = radios.map((radio) => radio.device);
    const found = await Promise.all(
      radios.flatMap((radio) =>
        radio.accessPaths.map((p) =>
          readAp(
            expected,
            version,
            radio.device,
            p,
            radio.connected,
            deadline,
            radio.deviceIdentity,
          ),
        ),
      ),
    );
    const owned = attempt?.owner === expected ? attempt.active : null;
    const allPaths = [
      ...new Set([
        ...activePaths,
        ...(primary !== "/" ? [primary] : []),
        ...(owned ? [owned] : []),
      ]),
    ];
    if (allPaths.length > 10) throw new Error("Active connection bounds exceeded");
    let cancelledAbsent = false;
    const reads = await Promise.all(
      allPaths.map(async (p) => {
        try {
          return await active(expected, version, p, deadline);
        } catch (error) {
          if (
            p === owned &&
            attempt?.cancelling &&
            !activePaths.includes(p) &&
            primary !== p &&
            error instanceof DbusRemoteError &&
            error.errorName === "org.freedesktop.DBus.Error.UnknownObject"
          ) {
            cancelledAbsent = true;
            return null;
          }
          throw error;
        }
      }),
    );
    const actives = reads.filter((a) => a !== null);
    const selected =
      actives.find((a) => a.path === primary && a.state === 2) ??
      actives.find((a) => a.state === 2);
    const connection: CurrentNetworkConnection = selected
      ? { kind: "active", name: selected.name, transport: selected.transport }
      : { kind: "none" };
    const available = enabled && hardwareEnabled && networking && wireless.length > 0;
    found.sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id));
    wireless.sort();
    const interactive = policy === "interactive";
    const manage = interactive && allowed[PERMISSION] === "yes" && allowed[MODIFY] === "yes";
    const primaryActive =
      actives.find((a) => a.path === primary && a.state === 2) ??
      actives.find((a) => a.state === 2 && a.transport !== "other") ??
      null;
    const vpnStates: Record<number, VpnState> = {
      1: "connecting",
      2: "connected",
      3: "disconnecting",
    };
    const vpn: NetworkVpn | undefined = profiles
      ? {
          connections: profiles
            .filter((profile) => profile.vpn)
            .map((profile) => {
              const live = actives.find(
                (a) => a.connection === profile.path || a.uuid === profile.uuid,
              );
              return {
                id: parseVpnId(profile.uuid),
                name: profile.id || "VPN",
                kind: profile.vpn ?? "other",
                state: (live && vpnStates[live.state]) || "disconnected",
                ownership: profile.ownership,
                canRemove: manage && networking && editable(profile, allowed),
              };
            })
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
          canManage: manage && networking,
          importable: ["wireguard", ...vpnPlugins().filter((plugin) => plugin === "openvpn")],
        }
      : undefined;
    const primaryProfile =
      primaryActive && profiles?.find((profile) => profile.path === primaryActive.connection);
    let proxy: NetworkProxy | undefined;
    if (primaryProfile) {
      const inPlace = manage && editable(primaryProfile, allowed);
      const copy = interactive && copyable(primaryProfile, allowed);
      proxy = {
        connection: primaryProfile.id || primaryActive.name,
        ...primaryProfile.proxy,
        canChange: inPlace || copy,
        ownership: primaryProfile.ownership,
        ...(copy ? { copy: true, needsPassword: primaryProfile.secrets === "psk" } : {}),
      };
    }
    /** Saved state for an access point: who owns its profiles and whether Forget removes any. */
    const saved = (ssid: Buffer) => {
      if (!profiles) return {};
      const matching = ssid.length ? profiles.filter((p) => p.ssid?.equals(ssid)) : [];
      if (!matching.length) return { saved: false };
      return {
        saved: true,
        ownership: matching.every((p) => p.ownership === "user")
          ? ("user" as const)
          : ("system" as const),
        canForget: interactive && matching.some((p) => editable(p, allowed)),
      };
    };
    return {
      aps: found,
      profiles,
      allowed,
      devices: wireless,
      actives,
      cancelledAbsent,
      primary: primaryActive,
      state: {
        kind: "ready",
        policy: policy === "interactive" ? "interactive" : "readonly",
        enabled,
        hardwareEnabled,
        canConnect:
          policy === "interactive" &&
          available &&
          allowed[PERMISSION] === "yes" &&
          allowed[MODIFY] === "yes",
        canScan: policy === "interactive" && available && allowed[SCAN] === "yes",
        canToggle:
          policy === "interactive" && hardwareEnabled && networking && allowed[TOGGLE] === "yes",
        connectivity:
          connectivity === 0
            ? "unknown"
            : connectivity === 1
              ? "none"
              : connectivity === 2
                ? "portal"
                : connectivity === 3
                  ? "limited"
                  : "full",
        connection,
        accessPoints: found.map((a) => ({
          id: a.id,
          ssid: a.name,
          strength: a.strength,
          security: a.security,
          connected: a.connected,
          ...saved(a.ssid),
        })),
        operation,
        adapters: wireless.length,
        ...(typeof wwanEnabled === "boolean"
          ? {
              wwan: {
                enabled: wwanEnabled,
                hardwareEnabled: wwanHardware === true,
                modems,
                canToggle:
                  interactive &&
                  wwanHardware === true &&
                  networking &&
                  allowed[TOGGLE_WWAN] === "yes",
              },
            }
          : {}),
        ...(vpn ? { vpn } : {}),
        ...(proxy ? { proxy } : {}),
      },
    };
  }
  function reconcile(observed: Observation, expected: string) {
    if (!attempt || attempt.owner !== expected) return;
    if (observed.cancelledAbsent && attempt.cancelling && attempt.active) {
      attempt = null;
      operation = { kind: "idle" };
      observed.state = { ...observed.state, operation };
      return;
    }
    const owned = observed.actives.find(
      (a) =>
        a.uuid === attempt?.uuid &&
        (attempt.ap === "/" || a.specific === attempt.ap) &&
        a.devices.includes(attempt.device) &&
        (!attempt.active || a.path === attempt.active) &&
        (!attempt.connection || a.connection === attempt.connection),
    );
    if (!owned) {
      if (attempt.active) {
        operation = {
          kind: "unknown",
          message: "Owned network activation disappeared; its outcome is unknown",
        };
      }
      observed.state = { ...observed.state, operation };
      return;
    }
    attempt.active = owned.path;
    attempt.connection = owned.connection;
    if (owned.state === 2 && !attempt.cancelling) operation = { kind: "idle" };
    else if (owned.state === 4) {
      operation = attempt.cancelling
        ? { kind: "idle" }
        : { kind: "error", message: "Network connection failed" };
      attempt = null;
    } else
      operation = attempt.cancelling
        ? { kind: "cancelling", ssid: attempt.ssid }
        : { kind: "connecting", ssid: attempt.ssid, cancellable: true };
    observed.state = { ...observed.state, operation };
  }
  async function syncSubscriptions(expected: string, version: number, observation: Observation) {
    const wanted = new Map<string, { path: string; interface: string; member: string }>();
    for (const [p, iface, member] of [
      [ROOT, PROPERTIES, "PropertiesChanged"],
      [ROOT, NM, "DeviceAdded"],
      [ROOT, NM, "DeviceRemoved"],
      [ROOT, NM, "CheckPermissions"],
      ...(policy === "interactive"
        ? [
            [SETTINGS_PATH, SETTINGS, "NewConnection"],
            [SETTINGS_PATH, SETTINGS, "ConnectionRemoved"],
          ]
        : []),
      ...observation.devices.map((p) => [p, PROPERTIES, "PropertiesChanged"]),
      ...observation.aps.map((a) => [a.path, PROPERTIES, "PropertiesChanged"]),
      ...observation.actives.map((a) => [a.path, ACTIVE, "StateChanged"]),
    ]) {
      if (p && iface && member)
        wanted.set(`${p}|${iface}|${member}`, { path: p, interface: iface, member });
    }
    for (const [key, dispose] of subscriptions)
      if (!wanted.has(key)) {
        subscriptions.delete(key);
        await dispose();
      }
    if (!bus) return;
    const deadline = Math.min(performance.now() + 8000, mutationDeadline);
    for (const [key, match] of wanted)
      if (!subscriptions.has(key)) {
        if (performance.now() >= deadline)
          throw new Error("Network subscription deadline exceeded");
        const dispose = await bus.subscribeSignal(
          { sender: expected, ...match },
          () => {
            if (owner === expected && epoch === version) {
              void refresh();
            }
          },
          {
            signal: scope.signal,
            timeoutMs: Math.max(1, Math.min(callTimeout, Math.ceil(deadline - performance.now()))),
          },
        );
        if (performance.now() >= deadline) {
          await dispose();
          throw new Error("Network subscription deadline exceeded");
        }
        try {
          current(expected, version);
          subscriptions.set(key, dispose);
        } catch (error) {
          await dispose();
          throw error;
        }
      }
  }
  async function refresh(): Promise<void> {
    if (disposed) return;
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    const expected = owner,
      version = epoch;
    if (!expected) return;
    refreshing = (async () => {
      try {
        const observed = await observe(expected, version);
        await syncSubscriptions(expected, version, observed);
        current(expected, version);
        reconcile(observed, expected);
        aps = observed.aps;
        publish(observed.state);
        if (preferredEpoch !== version)
          void preferCopies(expected, version, observed).catch(() => {});
      } catch {
        if (!disposed && owner === expected && epoch === version)
          publish({
            kind: "error",
            message: attempt
              ? "Unable to read NetworkManager state; owned activation outcome is unknown"
              : "Unable to read NetworkManager state",
          });
      }
    })();
    try {
      await refreshing;
    } finally {
      refreshing = null;
      if (refreshAgain) {
        refreshAgain = false;
        if (owner) void refresh();
      }
    }
  }
  async function assertOwner(expected: string, version: number) {
    current(expected, version);
    if (!bus) throw new Error("NetworkManager unavailable");
    const reply = await bus.call(
      {
        destination: "org.freedesktop.DBus",
        path: "/org/freedesktop/DBus",
        interface: "org.freedesktop.DBus",
        member: "GetNameOwner",
        signature: "s",
        body: [NM],
      },
      { signal: scope.signal, timeoutMs: callTimeout },
    );
    current(expected, version);
    if (reply.body?.[0] !== expected) throw new Error("NetworkManager changed");
  }
  function startMutation(): { expected: string; version: number } {
    if (disposed || !owner || state.kind !== "ready" || policy !== "interactive")
      throw new Error("Network controls unavailable or read-only");
    if (
      mutating ||
      operation.kind === "connecting" ||
      operation.kind === "cancelling" ||
      operation.kind === "unknown"
    )
      throw new Error("A network operation is already pending");
    mutating = true;
    mutationDeadline = performance.now() + 12000;
    return { expected: owner, version: epoch };
  }
  async function scan() {
    const { expected, version } = startMutation();
    let sent = false;
    try {
      await assertOwner(expected, version);
      const observed = await observe(expected, version);
      if (!observed.state.canScan || !observed.devices[0])
        throw new Error("Network scan is not permitted");
      current(expected, version);
      sent = true;
      await call(expected, version, observed.devices[0], WIRELESS, "RequestScan", "a{sv}", [{}]);
      await refresh();
    } catch (error) {
      if (!disposed && owner === expected && epoch === version) {
        operation = {
          kind: uncertain(error, sent) ? "unknown" : "error",
          message: failure(error, uncertain(error, sent)),
        };
        publishOperation();
      }
      throw new Error(failure(error, uncertain(error, sent)));
    } finally {
      mutating = false;
      mutationDeadline = Infinity;
    }
  }
  async function connect(request: Readonly<{ id: string; password: string }>) {
    if (
      typeof request.id !== "string" ||
      request.id.length > 2048 ||
      typeof request.password !== "string" ||
      request.password.length > 64
    )
      throw new Error("Invalid network connection request");
    const selected = aps.find((a) => a.id === request.id);
    if (!selected) throw new Error("Network access point changed");
    if (selected.security === "unsupported") throw new Error("Network security is unsupported");
    if (selected.security === "wpa-psk" && !isValidWpaPsk(request.password))
      throw new Error("Enter a valid WPA passphrase or hexadecimal key");
    await activateWifi(request.password, (observed) => {
      const fresh = observed.aps.find((a) => a.id === selected.id);
      if (!observed.state.canConnect || !fresh || fresh.connected)
        throw new Error("Network access point or permissions changed");
      return {
        device: fresh.device,
        ap: fresh.path,
        ssid: fresh.ssid,
        name: fresh.name,
        security: fresh.security === "wpa-psk" ? "wpa-psk" : "open",
        hidden: false,
      };
    });
  }
  /** Join a network that doesn't broadcast its name, on the first Wi‑Fi device. */
  async function connectHidden(value: HiddenWifiRequest) {
    const request = parseHiddenWifiRequest(value);
    await activateWifi(request.password, (observed) => {
      const device = observed.devices[0];
      if (!observed.state.canConnect || !device)
        throw new Refused("Joining networks is not permitted");
      return {
        device,
        ap: "/",
        ssid: Buffer.from(request.ssid, "utf8"),
        name: request.ssid,
        security: request.security,
        hidden: true,
      };
    });
  }
  /**
   * Add a temporary profile and activate it, owned by this adapter until it connects, fails or
   * is cancelled. `target` re-resolves what to join from a fresh observation.
   */
  async function activateWifi(
    password: string,
    target: (observed: Observation) => {
      device: string;
      ap: string;
      ssid: Buffer;
      name: string;
      security: "open" | "wpa-psk" | "sae";
      hidden: boolean;
    },
  ) {
    const { expected, version } = startMutation();
    let sent = false;
    try {
      await assertOwner(expected, version);
      const fresh = target(await observe(expected, version));
      current(expected, version);
      const uuid = randomUUID();
      attempt = {
        owner: expected,
        device: fresh.device,
        ap: fresh.ap,
        ssid: fresh.name,
        uuid,
        active: null,
        connection: null,
        cancelling: false,
      };
      operation = { kind: "connecting", ssid: fresh.name, cancellable: false };
      publishOperation();
      const settings: Record<string, unknown> = {
        connection: {
          id: variant("s", "Moire temporary Wi-Fi"),
          uuid: variant("s", uuid),
          type: variant("s", "802-11-wireless"),
          autoconnect: variant("b", false),
          permissions: variant("as", [`user:${user}:`]),
        },
        "802-11-wireless": {
          ssid: variant("ay", fresh.ssid),
          mode: variant("s", "infrastructure"),
          ...(fresh.hidden ? { hidden: variant("b", true) } : {}),
        },
        ipv4: { method: variant("s", "auto") },
        ipv6: { method: variant("s", "auto") },
      };
      if (fresh.security !== "open")
        settings["802-11-wireless-security"] = {
          "key-mgmt": variant("s", fresh.security),
          psk: variant("s", password),
          "psk-flags": variant("u", 2),
        };
      sent = true;
      const reply = await call(
        expected,
        version,
        ROOT,
        NM,
        "AddAndActivateConnection2",
        "a{sa{sv}}ooa{sv}",
        [
          settings,
          fresh.device,
          fresh.ap,
          { persist: variant("s", "volatile"), "bind-activation": variant("s", "dbus-client") },
        ],
      );
      if (reply.signature !== "ooa{sv}" || reply.body?.length !== 3)
        throw new Error("Invalid network activation reply");
      const connection = objectPath(reply.body[0]),
        activePath = objectPath(reply.body[1]);
      dictionary(reply.body[2]);
      if (connection === "/" || activePath === "/" || !attempt || attempt.uuid !== uuid)
        throw new Error("Invalid network activation identity");
      attempt.active = activePath;
      attempt.connection = connection;
      await refresh();
    } catch (error) {
      const message =
        error instanceof Refused ? error.message : failure(error, uncertain(error, sent));
      if (!disposed && owner === expected && epoch === version) {
        operation = { kind: uncertain(error, sent) ? "unknown" : "error", message };
        if (!uncertain(error, sent)) attempt = null;
        publishOperation();
      }
      throw new Error(message);
    } finally {
      mutating = false;
      mutationDeadline = Infinity;
    }
  }
  async function cancel() {
    if (
      disposed ||
      mutating ||
      policy !== "interactive" ||
      !attempt?.active ||
      !attempt.connection ||
      attempt.owner !== owner
    )
      throw new Error("No owned network activation can be cancelled");
    const saved = attempt,
      expected = saved.owner,
      version = epoch;
    mutating = true;
    mutationDeadline = performance.now() + 12000;
    let sent = false;
    try {
      await assertOwner(expected, version);
      const deadline = performance.now() + 8000;
      const [now, allowed] = await Promise.all([
        active(expected, version, saved.active ?? "/", deadline),
        permissions(expected, version, deadline),
      ]);
      if (
        allowed[PERMISSION] !== "yes" ||
        now.uuid !== saved.uuid ||
        now.connection !== saved.connection ||
        (saved.ap !== "/" && now.specific !== saved.ap) ||
        !now.devices.includes(saved.device) ||
        now.state === 4
      )
        throw new Error("Owned network activation changed or cancellation denied");
      current(expected, version);
      saved.cancelling = true;
      operation = { kind: "cancelling", ssid: saved.ssid };
      publishOperation();
      sent = true;
      await call(expected, version, ROOT, NM, "DeactivateConnection", "o", [now.path]);
      await refresh();
    } catch (error) {
      if (!disposed && owner === expected && epoch === version) {
        operation = {
          kind: uncertain(error, sent) ? "unknown" : "error",
          message: failure(error, uncertain(error, sent)),
        };
        publishOperation();
      }
      throw new Error(failure(error, uncertain(error, sent)));
    } finally {
      mutating = false;
      mutationDeadline = Infinity;
    }
  }
  /** Shared lifecycle for the radio, disconnect and forget mutations. */
  async function mutate(
    work: (expected: string, version: number, send: () => void) => Promise<void>,
  ) {
    const { expected, version } = startMutation();
    let sent = false;
    try {
      await assertOwner(expected, version);
      await work(expected, version, () => {
        current(expected, version);
        sent = true;
      });
      // startMutation admits only idle or a previous error, which this success supersedes.
      operation = { kind: "idle" };
      await refresh();
    } catch (error) {
      const message =
        error instanceof Refused ? error.message : failure(error, uncertain(error, sent));
      if (!disposed && owner === expected && epoch === version) {
        operation = { kind: uncertain(error, sent) ? "unknown" : "error", message };
        publishOperation();
      }
      throw new Error(message);
    } finally {
      mutating = false;
      mutationDeadline = Infinity;
    }
  }
  /**
   * Ending our own temporary activation through another path is an intended
   * deactivation, so reconcile reads its disappearance as idle, not unknown.
   */
  async function releasingOwned(owned: boolean, send: () => Promise<unknown>) {
    const saved = owned ? attempt : null;
    if (saved) saved.cancelling = true;
    try {
      await send();
    } catch (error) {
      if (saved && !uncertain(error, true)) saved.cancelling = false;
      throw error;
    }
  }
  async function setEnabled(enabled: boolean) {
    if (typeof enabled !== "boolean") throw new Error("Invalid Wi-Fi radio request");
    await mutate(async (expected, version, send) => {
      const observed = await observe(expected, version);
      if (!observed.state.canToggle) throw new Refused("Wi-Fi radio control is not permitted");
      if (observed.state.enabled === enabled) return;
      send();
      await releasingOwned(!enabled && attempt?.owner === expected && !!attempt.active, () =>
        call(expected, version, ROOT, PROPERTIES, "Set", "ssv", [
          NM,
          "WirelessEnabled",
          variant("b", enabled),
        ]),
      );
    });
  }
  async function disconnectWifi() {
    await mutate(async (expected, version, send) => {
      const observed = await observe(expected, version);
      if (observed.allowed[PERMISSION] !== "yes")
        throw new Refused("Wi-Fi disconnect is not permitted");
      const target = observed.actives.find(
        (a) =>
          a.transport === "wifi" &&
          (a.state === 1 || a.state === 2) &&
          a.devices.some((device) => observed.devices.includes(device)),
      );
      if (!target) throw new Refused("No Wi-Fi connection is active");
      send();
      await releasingOwned(attempt?.owner === expected && attempt.active === target.path, () =>
        call(expected, version, ROOT, NM, "DeactivateConnection", "o", [target.path]),
      );
    });
  }
  async function forget(id: string) {
    if (typeof id !== "string" || !id || id.length > 2048 || id.includes("\0"))
      throw new Error("Invalid network forget request");
    if (!aps.some((a) => a.id === id)) throw new Error("Network access point changed");
    await mutate(async (expected, version, send) => {
      const observed = await observe(expected, version);
      const fresh = observed.aps.find((a) => a.id === id);
      if (!fresh) throw new Refused("Network access point changed");
      if (!observed.profiles) throw new Refused("Saved Wi-Fi networks are unavailable");
      const matching = observed.profiles.filter(
        (p) => fresh.ssid.length > 0 && p.ssid?.equals(fresh.ssid),
      );
      if (!matching.length) throw new Refused("No saved profile exists for this network");
      // A profile shared by everyone can't be removed by one user, and NetworkManager has no
      // per-user way to stop a shared profile connecting, so only the user's own are deleted.
      const removable = matching.filter((p) => editable(p, observed.allowed));
      if (!removable.length)
        throw new Refused(
          "This network is saved for everyone on this computer; ask an administrator to remove it",
        );
      send();
      await releasingOwned(
        attempt?.owner === expected && removable.some((p) => p.path === attempt?.connection),
        async () => {
          for (const profile of removable)
            await call(expected, version, profile.path, PROFILE, "Delete");
        },
      );
    });
  }
  async function setRadios(request: Readonly<{ wifi?: boolean; wwan?: boolean }>) {
    if (
      (request.wifi !== undefined && typeof request.wifi !== "boolean") ||
      (request.wwan !== undefined && typeof request.wwan !== "boolean")
    )
      throw new Error("Invalid radio request");
    await mutate(async (expected, version, send) => {
      const observed = await observe(expected, version);
      const writes: [string, boolean][] = [];
      if (request.wifi !== undefined && observed.state.enabled !== request.wifi) {
        if (!observed.state.canToggle) throw new Refused("Wi-Fi radio control is not permitted");
        writes.push(["WirelessEnabled", request.wifi]);
      }
      const wwan = observed.state.wwan;
      // A modem that is absent or switched off in hardware has nothing to switch.
      if (request.wwan !== undefined && wwan?.hardwareEnabled && wwan.enabled !== request.wwan) {
        if (!wwan.canToggle) throw new Refused("Mobile broadband control is not permitted");
        writes.push(["WwanEnabled", request.wwan]);
      }
      if (!writes.length) return;
      send();
      await releasingOwned(
        request.wifi === false && attempt?.owner === expected && !!attempt.active,
        async () => {
          for (const [name, value] of writes)
            await call(expected, version, ROOT, PROPERTIES, "Set", "ssv", [
              NM,
              name,
              variant("b", value),
            ]);
        },
      );
    });
  }
  /** The saved VPN profile for `id`, from a fresh observation, when VPNs may be managed. */
  function vpnProfile(observed: Observation, id: string): SavedProfile {
    if (!observed.state.vpn?.canManage) throw new Refused("VPN changes are not permitted");
    const profile = observed.profiles?.find((p) => p.vpn && p.uuid.toLowerCase() === id);
    if (!profile) throw new Refused("This VPN no longer exists");
    return profile;
  }
  async function activateVpn(value: string) {
    const id = parseVpnId(value);
    await mutate(async (expected, version, send) => {
      const observed = await observe(expected, version);
      const profile = vpnProfile(observed, id);
      const live = observed.actives.find((a) => a.connection === profile.path);
      if (live && (live.state === 1 || live.state === 2)) return;
      send();
      const reply = await call(expected, version, ROOT, NM, "ActivateConnection", "ooo", [
        profile.path,
        "/",
        "/",
      ]);
      if (reply.signature !== "o" || reply.body?.length !== 1)
        throw new Error("Invalid VPN activation reply");
      objectPath(reply.body[0]);
    });
  }
  async function deactivateVpn(value: string) {
    const id = parseVpnId(value);
    await mutate(async (expected, version, send) => {
      const observed = await observe(expected, version);
      const profile = vpnProfile(observed, id);
      const live = observed.actives.find(
        (a) => a.connection === profile.path && (a.state === 1 || a.state === 2),
      );
      if (!live) return;
      send();
      await call(expected, version, ROOT, NM, "DeactivateConnection", "o", [live.path]);
    });
  }
  async function removeVpn(value: string) {
    const id = parseVpnId(value);
    await mutate(async (expected, version, send) => {
      const observed = await observe(expected, version);
      const profile = vpnProfile(observed, id);
      if (!editable(profile, observed.allowed))
        throw new Refused("This VPN is shared by everyone on this computer");
      send();
      await call(expected, version, profile.path, PROFILE, "Delete");
      removeVpnFiles(vpnDir, id);
    });
  }
  async function importVpn(value: VpnImportRequest) {
    const request = parseVpnImportRequest(value);
    await mutate(async (expected, version, send) => {
      const observed = await observe(expected, version);
      const vpn = observed.state.vpn;
      if (!vpn?.canManage) throw new Refused("VPN changes are not permitted");
      if (!vpn.importable.includes(request.kind))
        throw new Refused(
          request.kind === "openvpn"
            ? "OpenVPN isn't installed on this computer"
            : "This VPN type can't be imported",
        );
      const uuid = randomUUID();
      let settings: Record<string, unknown>;
      try {
        settings = vpnProfileSettings(request, {
          uuid,
          user,
          dataDir: vpnDir,
          interfaces: new Set(
            (observed.profiles ?? []).map((p) => p.interfaceName).filter(Boolean),
          ),
        });
      } catch (error) {
        throw new Refused(error instanceof Error ? error.message : String(error));
      }
      send();
      try {
        const reply = await call(
          expected,
          version,
          SETTINGS_PATH,
          SETTINGS,
          "AddConnection",
          "a{sa{sv}}",
          [settings],
        );
        if (reply.signature !== "o" || reply.body?.length !== 1)
          throw new Error("Invalid VPN import reply");
        objectPath(reply.body[0]);
      } catch (error) {
        // Certificates written for a profile NetworkManager refused are of no use.
        if (!uncertain(error, true)) removeVpnFiles(vpnDir, uuid);
        throw error;
      }
    });
  }
  async function profileSettings(expected: string, version: number, path: string) {
    const reply = await call(expected, version, path, PROFILE, "GetSettings");
    if (reply.signature !== "a{sa{sv}}" || reply.body?.length !== 1)
      throw new Error("Invalid network profile settings");
    return dictionary(reply.body[0], 64);
  }
  /**
   * Change the primary connection's proxy. A profile the user may change is updated and
   * reapplied so it takes effect now. A shared one the user may not change is left alone: the
   * change goes to the user's own copy of it (made now, or kept from an earlier change), which
   * then connects on the same device in its place.
   */
  async function setProxy(value: ProxyRequest) {
    const request = parseProxyRequest(value);
    await mutate(async (expected, version, send) => {
      const observed = await observe(expected, version);
      const proxy = observed.state.proxy,
        live = observed.primary;
      const profile = live && observed.profiles?.find((p) => p.path === live.connection);
      if (!proxy?.canChange || !live || !profile)
        throw new Refused("Proxy changes are not permitted");
      const settings = await profileSettings(expected, version, live.connection);
      if (text(property(dictionary(settings.connection), "uuid", "s")) !== live.uuid)
        throw new Refused("The connection changed; try again");
      settings.proxy = {
        ...(settings.proxy === undefined ? {} : dictionary(settings.proxy)),
        method: variant("i", request.method === "auto" ? 1 : 0),
        "pac-url": variant("s", request.pacUrl),
      };
      if (!proxy.copy) {
        send();
        await call(expected, version, live.connection, PROFILE, "Update", "a{sa{sv}}", [settings]);
        // The saved profile changed; the live connection picks it up when reapplied. A device
        // that can't reapply keeps the old proxy until it reconnects, which isn't a failure.
        const device = live.devices[0];
        if (device)
          await call(expected, version, device, DEVICE, "Reapply", "a{sa{sv}}tu", [
            {},
            0n,
            0,
          ]).catch(() => {});
        return;
      }
      const password = request.password ?? "";
      if (proxy.needsPassword) {
        const valid =
          profile.keyMgmt === "sae"
            ? /^[\x20-\x7e]{8,128}$/.test(password)
            : isValidWpaPsk(password);
        if (!valid)
          throw new Refused(
            `Enter the Wi‑Fi password for ${proxy.connection} to save your own copy of it`,
          );
      }
      const device = live.devices[0];
      if (!device) throw new Refused("The connection changed; try again");
      const existing = copyFor(observed.profiles ?? [], profile);
      const copy = userCopy(settings, profile, existing?.uuid ?? randomUUID(), user, password);
      send();
      let target: string;
      if (existing) {
        await call(expected, version, existing.path, PROFILE, "Update", "a{sa{sv}}", [copy]);
        target = existing.path;
      } else {
        const reply = await call(
          expected,
          version,
          SETTINGS_PATH,
          SETTINGS,
          "AddConnection",
          "a{sa{sv}}",
          [copy],
        );
        if (reply.signature !== "o" || reply.body?.length !== 1)
          throw new Error("Invalid network profile reply");
        target = objectPath(reply.body[0]);
      }
      // Activating the copy on the device replaces the shared profile's connection there.
      const activated = await call(expected, version, ROOT, NM, "ActivateConnection", "ooo", [
        target,
        device,
        live.transport === "wifi" ? live.specific : "/",
      ]);
      if (activated.signature !== "o" || activated.body?.length !== 1)
        throw new Error("Invalid network activation reply");
      objectPath(activated.body[0]);
    });
  }
  /** Owner epochs whose shared connections have been offered to the user's copies. */
  let preferredEpoch = -1;
  /**
   * NetworkManager connects the user's own profiles only while they're logged in, so at login
   * the shared profile is usually already up. Once per NetworkManager owner, switch each device
   * running a shared profile the user has a Moire copy of (autoconnect on) over to the copy,
   * so the user's change applies again. Failures leave the shared connection as it is.
   */
  async function preferCopies(expected: string, version: number, observed: Observation) {
    if (preferredEpoch === version || policy !== "interactive") return;
    // A user's action in flight goes first; the next refresh tries again.
    if (mutating || attempt) return;
    preferredEpoch = version;
    if (observed.allowed[PERMISSION] !== "yes" || !observed.profiles) return;
    const profiles = observed.profiles;
    const switches = observed.actives.flatMap((live) => {
      if (live.state !== 2 || !live.devices[0]) return [];
      const shared = profiles.find((p) => p.path === live.connection && p.ownership === "system");
      const copy = shared && copyFor(profiles, shared);
      return copy?.autoconnect ? [{ live, copy }] : [];
    });
    if (!switches.length) return;
    mutating = true;
    mutationDeadline = performance.now() + 12000;
    try {
      for (const { live, copy } of switches)
        await call(expected, version, ROOT, NM, "ActivateConnection", "ooo", [
          copy.path,
          live.devices[0]!,
          live.transport === "wifi" ? live.specific : "/",
        ]).catch(() => {});
    } finally {
      mutating = false;
      mutationDeadline = Infinity;
    }
    await refresh();
  }
  const adapter: WifiAdapter = {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    scan,
    connect,
    cancel,
    setEnabled,
    disconnect: disconnectWifi,
    forget,
    connectHidden,
    setRadios,
    activateVpn,
    deactivateVpn,
    removeVpn,
    importVpn,
    setProxy,
    async dispose() {
      if (disposed) return;
      disposed = true;
      scope.abort();
      if (poll) clearInterval(poll);
      disconnect();
      listeners.clear();
      await unwatch?.().catch(() => {});
      await Promise.allSettled([...subscriptions.values()].map((stop) => stop()));
      subscriptions.clear();
      bus?.close();
      bus = null;
    },
  };
  if (
    (policy !== "readonly" && policy !== "interactive") ||
    !Number.isInteger(callTimeout) ||
    callTimeout < 10 ||
    callTimeout > 5000 ||
    !Number.isInteger(pollMs) ||
    pollMs < 0 ||
    pollMs > 60000
  ) {
    publish({ kind: "error", message: "Invalid network control policy or timing" });
    return adapter;
  }
  if (!options.connect && process.platform !== "linux") {
    publish(WIFI_UNAVAILABLE);
    return adapter;
  }
  try {
    bus = await (options.connect
      ? options.connect()
      : SessionBus.connect("unix:path=/run/dbus/system_bus_socket", { timeoutMs: callTimeout }));
    disconnect = bus.onDisconnect(() => {
      epoch++;
      scope.abort();
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
      owner = null;
      aps = [];
      if (attempt)
        operation = { kind: "unknown", message: "NetworkManager disconnected during activation" };
      publish({ kind: "unavailable", message: "NetworkManager bus disconnected" });
    });
    unwatch = await bus.watchName(
      NM,
      (next) => {
        epoch++;
        scope.abort();
        scope = new AbortController();
        owner = next;
        aps = [];
        const previous = attempt;
        if (previous) {
          operation = {
            kind: "unknown",
            message: "NetworkManager owner changed during an owned activation",
          };
          attempt = null;
        }
        const old = [...subscriptions.values()];
        subscriptions.clear();
        void Promise.allSettled(old.map((stop) => stop()));
        publish(
          next
            ? { kind: "loading", message: "Reading NetworkManager Wi-Fi devices" }
            : {
                kind: "unavailable",
                message:
                  operation.kind === "unknown"
                    ? operation.message
                    : "NetworkManager Wi-Fi backend unavailable",
              },
        );
        if (next) void refresh();
      },
      { timeoutMs: callTimeout },
    );
    if (pollMs) {
      poll = setInterval(() => {
        void refresh();
      }, pollMs);
      poll.unref();
    }
    await refresh();
  } catch {
    bus?.close();
    publish({ kind: "unavailable", message: "NetworkManager system bus unavailable" });
  }
  return adapter;
}
