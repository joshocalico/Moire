import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { SessionBus, DbusRemoteError, variant, type DbusDisposer } from "@moire/dbus";
import {
  WIFI_UNAVAILABLE,
  isValidWpaPsk,
  type WifiAdapter,
  type DesktopWifi,
  type NetworkOperation,
  type CurrentNetworkConnection,
  type WifiAccessPoint,
} from "@moire/system-management/network-status";

const NM = "org.freedesktop.NetworkManager",
  ROOT = "/org/freedesktop/NetworkManager";
const PROPERTIES = "org.freedesktop.DBus.Properties",
  DEVICE = NM + ".Device",
  WIRELESS = DEVICE + ".Wireless",
  ACCESS = NM + ".AccessPoint",
  ACTIVE = NM + ".Connection.Active";
const PERMISSION = NM + ".network-control",
  MODIFY = NM + ".settings.modify.own",
  SCAN = NM + ".wifi.scan";
export type NetworkManagerOptions = {
  connect?: () => Promise<SessionBus>;
  policy?: "readonly" | "interactive";
  callTimeoutMs?: number;
  pollMs?: number;
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
type Observation = {
  state: Extract<DesktopWifi, { kind: "ready" }>;
  aps: AccessPoint[];
  devices: string[];
  actives: ActiveConnection[];
  cancelledAbsent: boolean;
};
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
function uint(value: unknown, max = 0xffff_ffff): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max)
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
  if (
    error instanceof DbusRemoteError &&
    /AccessDenied|NotAuthorized|PermissionDenied/.test(error.errorName)
  )
    return "NetworkManager denied this operation";
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
  async function observe(expected: string, version: number): Promise<Observation> {
    const deadline = performance.now() + 8000;
    const [manager, allowed] = await Promise.all([
      props(expected, version, ROOT, NM, deadline),
      permissions(expected, version, deadline),
    ]);
    const enabled = boolean(property(manager, "WirelessEnabled", "b")),
      hardwareEnabled = boolean(property(manager, "WirelessHardwareEnabled", "b")),
      networking = boolean(property(manager, "NetworkingEnabled", "b"));
    const devices = paths(property(manager, "Devices", "ao"), 8),
      activePaths = paths(property(manager, "ActiveConnections", "ao"), 8),
      primary = objectPath(property(manager, "PrimaryConnection", "o")),
      connectivity = uint(property(manager, "Connectivity", "u"), 4);
    const radios = (
      await Promise.all(
        devices.map(async (device) => {
          const v = await props(expected, version, device, DEVICE, deadline);
          if (uint(property(v, "DeviceType", "u")) !== 2 || !boolean(property(v, "Managed", "b")))
            return null;
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
    return {
      aps: found,
      devices: wireless,
      actives,
      cancelledAbsent,
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
        })),
        operation,
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
        a.specific === attempt.ap &&
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
    const { expected, version } = startMutation();
    let sent = false;
    try {
      await assertOwner(expected, version);
      const observed = await observe(expected, version);
      const fresh = observed.aps.find((a) => a.id === selected.id);
      if (!observed.state.canConnect || !fresh || fresh.connected)
        throw new Error("Network access point or permissions changed");
      current(expected, version);
      const uuid = randomUUID();
      attempt = {
        owner: expected,
        device: fresh.device,
        ap: fresh.path,
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
          permissions: variant("as", [`user:${os.userInfo().username}:`]),
        },
        "802-11-wireless": {
          ssid: variant("ay", fresh.ssid),
          mode: variant("s", "infrastructure"),
        },
        ipv4: { method: variant("s", "auto") },
        ipv6: { method: variant("s", "auto") },
      };
      if (fresh.security === "wpa-psk")
        settings["802-11-wireless-security"] = {
          "key-mgmt": variant("s", "wpa-psk"),
          psk: variant("s", request.password),
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
          fresh.path,
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
      if (!disposed && owner === expected && epoch === version) {
        operation = {
          kind: uncertain(error, sent) ? "unknown" : "error",
          message: failure(error, uncertain(error, sent)),
        };
        if (!uncertain(error, sent)) attempt = null;
        publishOperation();
      }
      throw new Error(failure(error, uncertain(error, sent)));
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
        now.specific !== saved.ap ||
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
