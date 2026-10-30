import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { SessionBus, DbusRemoteError, variant, type DbusDisposer } from "@moire/dbus";
import {
  BLUETOOTH_UNAVAILABLE,
  bluetoothDeviceKind,
  bluetoothSupported,
  parseBluetoothAlias,
  bluetoothTrustBlocksControls,
  parseBluetoothId,
  type BluetoothAdapter,
  type BluetoothChange,
  type BluetoothId,
  type BluetoothDevice,
  type DesktopBluetooth,
  type BluetoothOperation,
  type BluetoothTrustState,
  type BluetoothTrustRequest,
  type BluetoothTrustConsent,
  type BluetoothPowerChange,
  type BluetoothForgetRequest,
  type BluetoothRenameRequest,
} from "@moire/system-management/bluetooth-status";
const BLUEZ = "org.bluez",
  MANAGER = "org.freedesktop.DBus.ObjectManager";
const PROPERTIES = "org.freedesktop.DBus.Properties",
  ADAPTER = BLUEZ + ".Adapter1",
  DEVICE = BLUEZ + ".Device1",
  BATTERY = BLUEZ + ".Battery1";
export type BluezBluetoothOptions = {
  connect?: () => Promise<SessionBus>;
  policy?: "readonly" | "interactive";
  /** Independent of connection and pairing policy; no implicit trust writes. */
  trustPolicy?: "readonly" | "interactive";
  consentTimeoutMs?: number;
  callTimeoutMs?: number;
  operationTimeoutMs?: number;
  pollMs?: number;
};
type Candidate = { device: BluetoothDevice; path: string; adapter: string; powered: boolean };
type Radio = { path: string; powered: boolean };
type DbusCall = {
  path: string;
  interface: string;
  member: string;
  signature: string;
  body: unknown[];
};
type Identity = { id: BluetoothId; fingerprint: string };
type Attempt = BluetoothChange & { owner: string; epoch: number; path: string; sent: boolean };
type TrustConsent = BluetoothTrustRequest & {
  challengeId: BluetoothId;
  owner: string;
  epoch: number;
  path: string;
  previousTrusted: boolean;
  deadline: number;
  expiresAt: number;
};
type TrustAttempt = TrustConsent & { sent: boolean; retired: boolean };
class Changed extends Error {}
class Rejected extends Error {}
function dictionary(value: unknown, max = 256): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Buffer.isBuffer(value) ||
    Object.keys(value).length > max
  )
    throw new Error("Invalid BlueZ dictionary");
  return Object.fromEntries(Object.entries(value));
}
function property(raw: Record<string, unknown>, key: string, signature: string): unknown {
  const value = dictionary(raw[key], 2);
  if (value.signature !== signature || !("value" in value))
    throw new Error("Invalid BlueZ property");
  return value.value;
}
function text(value: unknown, max = 256): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error("Invalid BlueZ text");
  return value;
}
function address(value: unknown): string {
  const result = text(value, 17);
  if (!/^(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(result))
    throw new Error("Invalid BlueZ address");
  return result.toUpperCase();
}
function objectPath(value: unknown): string {
  const result = text(value, 512);
  if (!/^\/org\/bluez(?:\/[A-Za-z0-9_]+)*$/.test(result))
    throw new Error("Invalid BlueZ object path");
  return result;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid BlueZ boolean");
  return value;
}
function failed(cause: unknown, sent: boolean): { kind: "error" | "unknown"; message: string } {
  if (cause instanceof Rejected) return { kind: "error", message: cause.message };
  if (
    cause instanceof DbusRemoteError &&
    /NotAuthorized|AccessDenied|AuthenticationRejected/.test(cause.errorName)
  )
    return { kind: "error", message: "Bluetooth connection request denied" };
  if (
    cause instanceof DbusRemoteError &&
    !/NoReply|Timeout|Disconnected|NameHasNoOwner|ServiceUnknown/.test(cause.errorName)
  )
    return { kind: "error", message: "BlueZ could not complete the connection request" };
  return sent
    ? {
        kind: "unknown",
        message: "Bluetooth outcome is unknown; another request is blocked until verified readback",
      }
    : { kind: "error", message: "Bluetooth device or backend changed before the request" };
}
/** Observe an existing owner; independently gate connection and trust. Never pair or scan; radio power, removal and renaming only on request. */
export async function createBluezBluetoothAdapter(
  options: BluezBluetoothOptions = {},
): Promise<BluetoothAdapter> {
  const trustPolicy = options.trustPolicy ?? "readonly";
  const consentTimeout = options.consentTimeoutMs ?? 30000;
  let trust: BluetoothTrustState =
    trustPolicy === "interactive"
      ? { kind: "ready", operation: { kind: "idle" } }
      : { kind: "disabled" };
  let consent: TrustConsent | null = null;
  let consentTimer: ReturnType<typeof setTimeout> | null = null;
  let trustAttempt: TrustAttempt | null = null;
  let trustRequest: { caller: string; retired: boolean } | null = null;
  const policy = options.policy ?? "readonly",
    timeout = options.callTimeoutMs ?? 2500;
  const operationTimeout = options.operationTimeoutMs ?? 10000,
    pollMs = options.pollMs ?? 0;
  let state: DesktopBluetooth = {
    status: { kind: "loading", supported: false, message: "Reading known Bluetooth devices" },
    operation: { kind: "idle" },
    trust,
  };
  let bus: SessionBus | null = null,
    owner: string | null = null,
    epoch = 0,
    topology = 0,
    disposed = false;
  let scope = new AbortController(),
    watcher: DbusDisposer | null = null,
    disconnect = () => {};
  let poll: ReturnType<typeof setInterval> | null = null,
    refreshing: Promise<void> | null = null;
  let refreshAgain = false,
    dispatching = false,
    attempt: Attempt | null = null;
  let disposal: Promise<void> | null = null;
  const subscriptions: DbusDisposer[] = [],
    identities = new Map<string, Identity>(),
    candidates = new Map<BluetoothId, Candidate>(),
    radios = new Map<BluetoothId, Radio>();
  const propertySubscriptions = new Map<string, Promise<DbusDisposer>>();
  const stopProperties = async () => {
    const pending = Array.from(propertySubscriptions.values());
    propertySubscriptions.clear();
    await Promise.allSettled(pending.map(async (promise) => (await promise)()));
  };
  const listeners = new Set<() => void>();
  const publish = (next: DesktopBluetooth) => {
    const observed = { ...next, trust };
    if (disposed || isDeepStrictEqual(state, observed)) return;
    state = observed;
    for (const listener of Array.from(listeners)) listener();
  };
  function publishTrust(next: BluetoothTrustState) {
    trust = next;
    publish(state);
  }
  function clearConsent() {
    consent = null;
    if (consentTimer) clearTimeout(consentTimer);
    consentTimer = null;
  }
  function retireConsent() {
    if (!consent) return;
    clearConsent();
    publishTrust({ kind: "ready", operation: { kind: "idle" } });
  }
  function caller(value: string) {
    if (!/^:[0-9]+\.[0-9]+$/.test(value) || value.length > 255)
      throw new Error("Invalid Bluetooth caller");
  }
  function blocked() {
    return (
      dispatching ||
      state.operation.kind === "pending" ||
      state.operation.kind === "unknown" ||
      bluetoothTrustBlocksControls(trust)
    );
  }
  const current = (expected: string, version: number) => {
    if (disposed || owner !== expected || epoch !== version || scope.signal.aborted)
      throw new Changed();
  };
  const call = async (
    expected: string,
    version: number,
    path: string,
    iface: string,
    member: string,
    deadline: number,
  ) => {
    current(expected, version);
    if (!bus) throw new Changed();
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining < 1) throw new Error("Bluetooth deadline expired");
    const reply = await bus.call(
      { destination: expected, path, interface: iface, member, signature: "", body: [] },
      { signal: scope.signal, timeoutMs: Math.min(timeout, remaining) },
    );
    current(expected, version);
    return reply;
  };
  const identify = (
    nextIdentities: Map<string, Identity>,
    path: string,
    fingerprint: string,
  ): BluetoothId => {
    const existing = nextIdentities.get(path);
    if (existing?.fingerprint === fingerprint) return existing.id;
    const id = parseBluetoothId("bluez_" + randomUUID());
    nextIdentities.set(path, { id, fingerprint });
    return id;
  };
  async function read(expected: string, version: number, deadline: number): Promise<void> {
    const revision = topology;
    const reply = await call(expected, version, "/", MANAGER, "GetManagedObjects", deadline);
    if (reply.signature !== "a{oa{sa{sv}}}" || reply.body?.length !== 1)
      throw new Error("Invalid BlueZ object reply");
    if (revision !== topology) throw new Changed();
    const rawObjects = reply.body[0];
    if (!Array.isArray(rawObjects) || rawObjects.length > 256)
      throw new Error("Invalid managed BlueZ objects");
    const objects = new Map<string, unknown>();
    for (const pair of rawObjects) {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error("Invalid managed BlueZ entry");
      const p = objectPath(pair[0]);
      if (objects.has(p)) throw new Error("Duplicate managed BlueZ object");
      objects.set(p, pair[1]);
    }
    const nextIdentities = new Map(identities);
    const adapters: { id: BluetoothId; name: string; powered: boolean }[] = [];
    const adapterPaths = new Map<string, { id: BluetoothId; powered: boolean }>();
    const seen = new Set<string>();
    for (const [p, raw] of Array.from(objects).sort()) {
      objectPath(p);
      const interfaces = dictionary(raw, 32);
      if (!(ADAPTER in interfaces)) continue;
      const props = dictionary(interfaces[ADAPTER], 64);
      const id = identify(nextIdentities, p, "adapter:" + address(property(props, "Address", "s")));
      const powered = bool(property(props, "Powered", "b"));
      adapters.push({ id, name: text(property(props, "Alias", "s")), powered });
      adapterPaths.set(p, { id, powered });
      seen.add(p);
    }
    if (adapters.length > 8) throw new Error("Too many Bluetooth adapters");
    const next = new Map<BluetoothId, Candidate>();
    for (const [p, raw] of Array.from(objects).sort()) {
      const interfaces = dictionary(raw, 32);
      if (!(DEVICE in interfaces)) continue;
      const props = dictionary(interfaces[DEVICE], 64);
      if (!bool(property(props, "Paired", "b"))) continue;
      const adapterPath = objectPath(property(props, "Adapter", "o"));
      const adapter = adapterPaths.get(adapterPath);
      if (!adapter) throw new Error("Known Bluetooth device has no adapter");
      const deviceAddress = address(property(props, "Address", "s"));
      const id = identify(nextIdentities, p, "device:" + adapter.id + ":" + deviceAddress);
      // Icon, Class and Battery1 appear only when the device reports them.
      const icon = "Icon" in props ? text(property(props, "Icon", "s"), 64) : null;
      const deviceClass = "Class" in props ? property(props, "Class", "u") : null;
      const battery =
        BATTERY in interfaces
          ? property(dictionary(interfaces[BATTERY], 16), "Percentage", "y")
          : undefined;
      if (
        (deviceClass !== null &&
          (typeof deviceClass !== "number" || !Number.isInteger(deviceClass))) ||
        (battery !== undefined &&
          (typeof battery !== "number" || !Number.isInteger(battery) || battery > 100))
      )
        throw new Error("Invalid BlueZ device class or battery");
      const device: BluetoothDevice = {
        id,
        adapterId: adapter.id,
        address: deviceAddress,
        name: text(property(props, "Alias", "s")),
        paired: true,
        trusted: bool(property(props, "Trusted", "b")),
        connected: bool(property(props, "Connected", "b")),
        kind: bluetoothDeviceKind(icon, deviceClass as number | null),
        ...(battery !== undefined ? { battery: battery as number } : {}),
      };
      next.set(id, { device, path: p, adapter: adapterPath, powered: adapter.powered });
      seen.add(p);
    }
    if (next.size > 64) throw new Error("Too many known Bluetooth devices");
    const watchedPaths = new Set(
      Array.from(objects)
        .filter(([, raw]) => {
          const interfaces = dictionary(raw, 32);
          return ADAPTER in interfaces || DEVICE in interfaces;
        })
        .map(([p]) => p),
    );
    for (const [p, pending] of propertySubscriptions)
      if (!watchedPaths.has(p)) {
        propertySubscriptions.delete(p);
        void pending.then((stop) => stop()).catch(() => {});
      }
    for (const p of watchedPaths) {
      current(expected, version);
      if (!bus) throw new Changed();
      let pending = propertySubscriptions.get(p);
      if (!pending) {
        pending = bus.subscribeSignal(
          { sender: expected, path: p, interface: PROPERTIES, member: "PropertiesChanged" },
          (message) => {
            if (
              disposed ||
              owner !== expected ||
              epoch !== version ||
              message.signature !== "sa{sv}as" ||
              message.body?.length !== 3 ||
              (message.body[0] !== ADAPTER &&
                message.body[0] !== DEVICE &&
                message.body[0] !== BATTERY)
            )
              return;
            // A changed/invalidation event retires consent even if subsequent reads coalesce
            // a Trusted false→true transition back to its original value.
            if (consent?.path === p && message.body[0] === DEVICE) {
              try {
                const changed = dictionary(message.body[1], 64);
                const invalidated = message.body[2];
                if (
                  "Trusted" in changed ||
                  (Array.isArray(invalidated) && invalidated.includes("Trusted"))
                )
                  retireConsent();
              } catch {
                retireConsent();
              }
            }
            topology++;
            void refresh();
          },
          {
            signal: scope.signal,
            timeoutMs: Math.max(1, Math.min(timeout, Math.ceil(deadline - performance.now()))),
          },
        );
        propertySubscriptions.set(p, pending);
      }
      await pending;
      current(expected, version);
    }
    if (revision !== topology) throw new Changed();
    identities.clear();
    for (const [p, identity] of nextIdentities) if (seen.has(p)) identities.set(p, identity);
    candidates.clear();
    for (const [id, value] of next) candidates.set(id, value);
    radios.clear();
    for (const [p, radio] of adapterPaths)
      radios.set(radio.id, { path: p, powered: radio.powered });
    if (consent) {
      const selected = candidates.get(consent.id);
      if (
        consent.owner !== expected ||
        consent.epoch !== version ||
        performance.now() >= consent.deadline ||
        !selected ||
        selected.path !== consent.path ||
        selected.device.trusted !== consent.previousTrusted
      )
        retireConsent();
    }
    if (
      trust.kind === "ready" &&
      trust.operation.kind === "unknown" &&
      trustAttempt &&
      trustAttempt.sent &&
      trustAttempt.owner === expected &&
      trustAttempt.epoch === version &&
      candidates.get(trustAttempt.id)?.path === trustAttempt.path &&
      candidates.get(trustAttempt.id)?.device.trusted === trustAttempt.trusted
    )
      trust = { kind: "ready", operation: { kind: "idle" } };
    let operation = state.operation;
    if (
      state.operation.kind === "unknown" &&
      attempt &&
      attempt.sent &&
      attempt.owner === expected &&
      attempt.epoch === version &&
      candidates.get(attempt.id)?.path === attempt.path &&
      candidates.get(attempt.id)?.device.connected === attempt.connected
    )
      operation = { kind: "idle" };
    publish({
      status: adapters.length
        ? {
            kind: "ready",
            policy,
            adapters,
            devices: Array.from(next.values(), (value) => value.device),
          }
        : { kind: "unavailable", message: "No Bluetooth adapter is present" },
      operation,
    });
  }
  async function refresh(): Promise<void> {
    if (!owner || disposed) return;
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    const expected = owner,
      version = epoch;
    refreshing = (async () => {
      try {
        await read(expected, version, performance.now() + timeout);
      } catch (cause) {
        if (owner !== expected || epoch !== version || disposed) return;
        if (cause instanceof Changed) refreshAgain = true;
        else {
          candidates.clear();
          radios.clear();
          retireConsent();
          publish({
            status: {
              kind: "error",
              supported: bluetoothSupported(state),
              message: "Unable to read known Bluetooth devices",
            },
            operation: state.operation,
          });
        }
      }
    })();
    try {
      await refreshing;
    } finally {
      refreshing = null;
      if (refreshAgain) {
        refreshAgain = false;
        if (owner && !disposed) void refresh();
      }
    }
  }
  async function setConnected(change: BluetoothChange): Promise<void> {
    parseBluetoothId(change.id);
    if (typeof change.connected !== "boolean")
      throw new Error("Invalid Bluetooth connection request");
    if (disposed || !owner) throw new Error("Bluetooth backend unavailable");
    if (policy !== "interactive") throw new Error("Bluetooth controls are read-only");
    if (blocked()) throw new Error("Bluetooth operation is pending or unknown");
    const expected = owner,
      version = epoch,
      deadline = performance.now() + operationTimeout;
    dispatching = true;
    const selected = candidates.get(change.id);
    const operation: Attempt = {
      ...change,
      owner: expected,
      epoch: version,
      path: selected?.path ?? "",
      sent: false,
    };
    attempt = operation;
    publish({ ...state, operation: { kind: "pending", ...change } });
    try {
      await read(expected, version, deadline);
      const target = candidates.get(change.id);
      if (!target || target.path !== operation.path) throw new Changed();
      if ((change.connected && !target.device.trusted) || !target.powered)
        throw new Rejected("Known device must be trusted and its adapter powered");
      if (target.device.connected === change.connected) {
        publish({ ...state, operation: { kind: "idle" } });
        return;
      }
      operation.sent = true;
      const reply = await call(
        expected,
        version,
        target.path,
        DEVICE,
        change.connected ? "Connect" : "Disconnect",
        deadline,
      );
      if (reply.signature !== "" || (reply.body?.length ?? 0) !== 0)
        throw new Error("Invalid BlueZ action reply");
      while (performance.now() < deadline) {
        try {
          await read(expected, version, deadline);
        } catch (cause) {
          current(expected, version);
          if (!(cause instanceof Changed)) throw cause;
          continue;
        }
        const actual = candidates.get(change.id);
        if (!actual || actual.path !== operation.path) throw new Changed();
        if (actual.device.connected === change.connected) {
          publish({ ...state, operation: { kind: "idle" } });
          return;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(50, Math.max(1, deadline - performance.now()))),
        );
        current(expected, version);
      }
      throw new Error("Bluetooth observation deadline expired");
    } catch (cause) {
      const result = failed(cause, operation.sent);
      if (!disposed && attempt === operation)
        publish({ ...state, operation: { kind: result.kind, ...change, message: result.message } });
      throw new Error(result.message);
    } finally {
      dispatching = false;
    }
  }
  /**
   * Shared shape for power and removal writes: re-resolve the target from fresh
   * readback, send once, then wait for BlueZ to report the requested outcome.
   */
  async function verifiedWrite<T extends { path: string }>(
    action: string,
    resolve: () => T | undefined,
    send: (target: T) => DbusCall,
    done: (target: T) => boolean,
  ): Promise<void> {
    if (disposed || !owner) throw new Error("Bluetooth backend unavailable");
    if (policy !== "interactive") throw new Error("Bluetooth controls are read-only");
    if (blocked()) throw new Error("Bluetooth operation is pending or unknown");
    const selected = resolve();
    if (!selected) throw new Error("Bluetooth " + action + " target is no longer available");
    const expected = owner,
      version = epoch,
      deadline = performance.now() + operationTimeout;
    dispatching = true;
    let sent = false;
    try {
      await read(expected, version, deadline);
      const target = resolve();
      if (!target || target.path !== selected.path) throw new Changed();
      if (done(target)) return;
      current(expected, version);
      if (!bus) throw new Changed();
      sent = true;
      const reply = await bus.call(
        { destination: expected, ...send(target) },
        {
          signal: scope.signal,
          timeoutMs: Math.min(timeout, Math.max(1, Math.ceil(deadline - performance.now()))),
        },
      );
      current(expected, version);
      if (reply.signature !== "" || (reply.body?.length ?? 0) !== 0)
        throw new Error("Invalid BlueZ action reply");
      while (performance.now() < deadline) {
        try {
          await read(expected, version, deadline);
        } catch (cause) {
          current(expected, version);
          if (!(cause instanceof Changed)) throw cause;
          continue;
        }
        if (done(target)) return;
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(50, Math.max(1, deadline - performance.now()))),
        );
        current(expected, version);
      }
      throw new Error("Bluetooth observation deadline expired");
    } catch (cause) {
      throw new Error(failed(cause, sent).message.replace("connection", action));
    } finally {
      dispatching = false;
    }
  }
  async function setPowered(change: BluetoothPowerChange): Promise<void> {
    parseBluetoothId(change.adapterId);
    if (typeof change.powered !== "boolean") throw new Error("Invalid Bluetooth power request");
    await verifiedWrite(
      "power",
      () => radios.get(change.adapterId),
      (radio) => ({
        path: radio.path,
        interface: PROPERTIES,
        member: "Set",
        signature: "ssv",
        body: [ADAPTER, "Powered", variant("b", change.powered)],
      }),
      (radio) => {
        const actual = radios.get(change.adapterId);
        if (actual?.path !== radio.path) throw new Changed();
        return actual.powered === change.powered;
      },
    );
  }
  async function forgetDevice(request: BluetoothForgetRequest): Promise<void> {
    parseBluetoothId(request.id);
    await verifiedWrite(
      "removal",
      () => candidates.get(request.id),
      (device) => ({
        path: device.adapter,
        interface: ADAPTER,
        member: "RemoveDevice",
        signature: "o",
        body: [device.path],
      }),
      // Identities are bound to the object path, so the device is gone once its id is.
      (device) => candidates.get(request.id)?.path !== device.path,
    );
  }
  /** Set the name Moire and BlueZ show for a paired device (its Alias). */
  async function renameDevice(request: BluetoothRenameRequest): Promise<void> {
    parseBluetoothId(request.id);
    const name = parseBluetoothAlias(request.name);
    await verifiedWrite(
      "rename",
      () => candidates.get(request.id),
      (device) => ({
        path: device.path,
        interface: PROPERTIES,
        member: "Set",
        signature: "ssv",
        body: [DEVICE, "Alias", variant("s", name)],
      }),
      (device) => {
        const actual = candidates.get(request.id);
        if (actual?.path !== device.path) throw new Changed();
        return actual.device.name === name;
      },
    );
  }
  async function requestTrust(request: BluetoothTrustRequest): Promise<void> {
    caller(request.caller);
    parseBluetoothId(request.id);
    if (typeof request.trusted !== "boolean") throw new Error("Invalid Bluetooth trust request");
    if (disposed || !owner) throw new Error("Bluetooth backend unavailable");
    if (trustPolicy !== "interactive") throw new Error("Bluetooth trust controls are read-only");
    if (blocked()) throw new Error("Bluetooth operation is pending or unknown");
    const expected = owner,
      version = epoch;
    const selected = candidates.get(request.id);
    if (!selected) throw new Error("Bluetooth device is no longer available");
    const issuance = { caller: request.caller, retired: false };
    trustRequest = issuance;
    dispatching = true;
    try {
      await read(expected, version, performance.now() + timeout);
      if (issuance.retired) throw new Changed();
      const target = candidates.get(request.id);
      if (
        !target ||
        target.path !== selected.path ||
        target.device.trusted !== selected.device.trusted
      )
        throw new Changed();
      if (target.device.trusted === request.trusted)
        throw new Rejected("Bluetooth trust is already observed");
      const issued: TrustConsent = {
        ...request,
        challengeId: parseBluetoothId("trust_" + randomUUID()),
        owner: expected,
        epoch: version,
        path: target.path,
        previousTrusted: target.device.trusted,
        deadline: performance.now() + consentTimeout,
        expiresAt: Date.now() + consentTimeout,
      };
      consent = issued;
      trustAttempt = null;
      consentTimer = setTimeout(() => {
        if (consent === issued) retireConsent();
      }, consentTimeout);
      consentTimer.unref();
      publishTrust({
        kind: "ready",
        operation: {
          kind: "confirmation",
          challengeId: issued.challengeId,
          id: issued.id,
          trusted: issued.trusted,
          expiresAt: issued.expiresAt,
        },
      });
    } finally {
      if (trustRequest === issuance) trustRequest = null;
      dispatching = false;
    }
  }
  function matchingConsent(request: BluetoothTrustConsent): TrustConsent {
    caller(request.caller);
    parseBluetoothId(request.challengeId);
    if (consent && performance.now() >= consent.deadline) retireConsent();
    if (
      disposed ||
      !consent ||
      consent.caller !== request.caller ||
      consent.challengeId !== request.challengeId
    )
      throw new Error("Bluetooth trust confirmation is no longer available for this caller");
    return consent;
  }
  async function cancelTrust(request: BluetoothTrustConsent): Promise<void> {
    matchingConsent(request);
    retireConsent();
  }
  async function trustCallerLost(lost: string): Promise<void> {
    caller(lost);
    if (trustRequest?.caller === lost) trustRequest.retired = true;
    if (consent?.caller === lost) retireConsent();
    if (
      trustAttempt?.caller === lost &&
      trust.kind === "ready" &&
      trust.operation.kind === "pending"
    ) {
      trustAttempt.retired = true;
      publishTrust({
        kind: "ready",
        operation: {
          kind: trustAttempt.sent ? "unknown" : "error",
          id: trustAttempt.id,
          trusted: trustAttempt.trusted,
          message: "Bluetooth trust caller disappeared",
        },
      });
    }
  }
  async function confirmTrust(request: BluetoothTrustConsent): Promise<void> {
    const selected = matchingConsent(request);
    clearConsent(); // Consume before any await; the challenge can never be replayed.
    const operation: TrustAttempt = { ...selected, sent: false, retired: false };
    trustAttempt = operation;
    dispatching = true;
    publishTrust({
      kind: "ready",
      operation: { kind: "pending", id: operation.id, trusted: operation.trusted },
    });
    const deadline = performance.now() + operationTimeout;
    try {
      await read(operation.owner, operation.epoch, deadline);
      const target = candidates.get(operation.id);
      if (
        operation.retired ||
        performance.now() >= operation.deadline ||
        !target ||
        target.path !== operation.path ||
        target.device.trusted !== operation.previousTrusted
      )
        throw new Changed();
      current(operation.owner, operation.epoch);
      if (!bus) throw new Changed();
      operation.sent = true;
      const reply = await bus.call(
        {
          destination: operation.owner,
          path: operation.path,
          interface: PROPERTIES,
          member: "Set",
          signature: "ssv",
          body: [DEVICE, "Trusted", variant("b", operation.trusted)],
        },
        {
          signal: scope.signal,
          timeoutMs: Math.min(timeout, Math.max(1, Math.ceil(deadline - performance.now()))),
        },
      );
      current(operation.owner, operation.epoch);
      if (reply.signature !== "" || (reply.body?.length ?? 0) !== 0)
        throw new Error("Invalid Bluetooth trust reply");
      while (performance.now() < deadline) {
        if (operation.retired) throw new Changed();
        try {
          await read(operation.owner, operation.epoch, deadline);
        } catch (cause) {
          current(operation.owner, operation.epoch);
          if (!(cause instanceof Changed)) throw cause;
          continue;
        }
        const actual = candidates.get(operation.id);
        if (!actual || actual.path !== operation.path) throw new Changed();
        if (actual.device.trusted === operation.trusted) {
          publishTrust({ kind: "ready", operation: { kind: "idle" } });
          return;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(50, Math.max(1, deadline - performance.now()))),
        );
        current(operation.owner, operation.epoch);
      }
      throw new Error("Bluetooth trust observation deadline expired");
    } catch (cause) {
      const result = failed(cause, operation.sent);
      if (!disposed && trustAttempt === operation)
        publishTrust({
          kind: "ready",
          operation: {
            kind: result.kind,
            id: operation.id,
            trusted: operation.trusted,
            message: result.message.replace("connection", "trust"),
          },
        });
      throw new Error(result.message.replace("connection", "trust"));
    } finally {
      dispatching = false;
    }
  }
  const adapter: BluetoothAdapter = {
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
    setConnected,
    setPowered,
    forgetDevice,
    renameDevice,
    requestTrust,
    confirmTrust,
    cancelTrust,
    trustCallerLost,
    dispose() {
      if (disposal) return disposal;
      clearConsent();
      disposed = true;
      epoch++;
      scope.abort();
      if (poll) clearInterval(poll);
      disconnect();
      listeners.clear();
      candidates.clear();
      radios.clear();
      identities.clear();
      disposal = (async () => {
        await watcher?.().catch(() => {});
        await Promise.allSettled(subscriptions.splice(0).map((stop) => stop()));
        await stopProperties();
        bus?.close();
        bus = null;
      })();
      return disposal;
    },
  };
  if (
    (policy !== "readonly" && policy !== "interactive") ||
    (trustPolicy !== "readonly" && trustPolicy !== "interactive") ||
    !Number.isInteger(consentTimeout) ||
    consentTimeout < 1000 ||
    consentTimeout > 60000 ||
    !Number.isInteger(timeout) ||
    timeout < 10 ||
    timeout > 5000 ||
    !Number.isInteger(operationTimeout) ||
    operationTimeout < 10 ||
    operationTimeout > 60000 ||
    !Number.isInteger(pollMs) ||
    pollMs < 0 ||
    pollMs > 60000
  ) {
    trust = { kind: "disabled" };
    publish({
      status: { kind: "error", supported: false, message: "Invalid Bluetooth policy or timing" },
      operation: { kind: "idle" },
    });
    return adapter;
  }
  if (!options.connect && process.platform !== "linux") {
    publish(BLUETOOTH_UNAVAILABLE);
    return adapter;
  }
  const retire = (next: string | null, message: string) => {
    retireConsent();
    if (trustAttempt && trust.kind === "ready" && trust.operation.kind !== "idle") {
      trust = {
        kind: "ready",
        operation: {
          kind: trustAttempt.sent ? "unknown" : "error",
          id: trustAttempt.id,
          trusted: trustAttempt.trusted,
          message: trustAttempt.sent
            ? "Bluetooth owner changed; trust outcome is unknown"
            : "Bluetooth backend changed before the trust request",
        },
      };
    }
    epoch++;
    topology++;
    scope.abort();
    scope = new AbortController();
    owner = next;
    identities.clear();
    candidates.clear();
    radios.clear();
    void Promise.allSettled(subscriptions.splice(0).map((stop) => stop()));
    void stopProperties();
    let operation: BluetoothOperation = state.operation;
    if (state.operation.kind !== "idle" && attempt) {
      operation = {
        kind: attempt.sent ? "unknown" : "error",
        id: attempt.id,
        connected: attempt.connected,
        message: attempt.sent
          ? "Bluetooth owner changed; operation outcome is unknown"
          : "Bluetooth backend changed before the request",
      };
    }
    publish({
      status: next
        ? { kind: "loading", supported: false, message: "Reading known Bluetooth devices" }
        : { kind: "unavailable", message },
      operation,
    });
  };
  async function observeOwner(expected: string, version: number) {
    if (!bus) return;
    try {
      for (const member of ["InterfacesAdded", "InterfacesRemoved"]) {
        const stop = await bus.subscribeSignal(
          { sender: expected, path: "/", interface: MANAGER, member },
          (message) => {
            if (disposed || owner !== expected || epoch !== version) return;
            if (
              message.signature !== (member === "InterfacesAdded" ? "oa{sa{sv}}" : "oas") ||
              message.body?.length !== 2
            )
              return;
            try {
              const p = objectPath(message.body[0]);
              const raw = message.body[1];
              const affected =
                member === "InterfacesAdded" ? Object.keys(dictionary(raw, 32)) : raw;
              if (!Array.isArray(affected) || !affected.every((value) => typeof value === "string"))
                return;
              if (
                !affected.includes(ADAPTER) &&
                !affected.includes(DEVICE) &&
                !affected.includes(BATTERY)
              )
                return;
              // A battery appearing or going doesn't make the device a different one.
              if (affected.includes(ADAPTER) || affected.includes(DEVICE)) {
                identities.delete(p);
                if (consent?.path === p) retireConsent();
              }
            } catch {
              return;
            }
            topology++;
            void refresh();
          },
          { signal: scope.signal, timeoutMs: timeout },
        );
        try {
          current(expected, version);
          subscriptions.push(stop);
        } catch (cause) {
          await stop().catch(() => {});
          throw cause;
        }
      }
      await refresh();
    } catch {
      if (!disposed && owner === expected && epoch === version)
        publish({
          status: { kind: "error", supported: false, message: "Unable to observe BlueZ" },
          operation: state.operation,
        });
    }
  }
  try {
    bus = await (options.connect
      ? options.connect()
      : SessionBus.connect("unix:path=/run/dbus/system_bus_socket", { timeoutMs: timeout }));
    disconnect = bus.onDisconnect(() => {
      retire(null, "Bluetooth bus disconnected");
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
    });
    watcher = await bus.watchName(
      BLUEZ,
      (next) => {
        retire(next, "BlueZ Bluetooth backend unavailable");
        if (next) void observeOwner(next, epoch);
      },
      { timeoutMs: timeout },
    );
    if (pollMs) {
      poll = setInterval(() => {
        void refresh();
      }, pollMs);
      poll.unref();
    }
    // watchName installs observation asynchronously; no activation or waiting for an absent owner.
  } catch {
    bus?.close();
    publish(BLUETOOTH_UNAVAILABLE);
  }
  return adapter;
}
