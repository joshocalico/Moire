import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  SessionBus,
  DbusRemoteError,
  type DbusDisposer,
  type DbusMethodContext,
  type DbusInterface,
} from "@moire/dbus";
import {
  BLUETOOTH_PAIRING_DISABLED,
  parseBluetoothId,
  parseBluetoothInput,
  type BluetoothAdapterInfo,
  type BluetoothId,
  type BluetoothNearbyDevice,
  type BluetoothPairingAdapter,
  type BluetoothPairingState,
  type BluetoothPairingPrompt,
  type BluetoothLeaseRequest,
  type BluetoothCancelRequest,
} from "@moire/system-management/bluetooth-status";

const BLUEZ = "org.bluez";
const MANAGER = "org.freedesktop.DBus.ObjectManager";
const ADAPTER = BLUEZ + ".Adapter1";
const DEVICE = BLUEZ + ".Device1";
const AGENT = BLUEZ + ".Agent1";
const AGENT_MANAGER = BLUEZ + ".AgentManager1";
const PROPERTIES = "org.freedesktop.DBus.Properties";
const AGENT_PATH = "/org/moire/PairingAgent";
function rejected(message = "Pairing request rejected"): DbusRemoteError {
  return new DbusRemoteError("org.bluez.Error.Rejected", message);
}
function record(value: unknown, max = 256): Record<string, unknown> {
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
  const entry = record(raw[key], 2);
  if (entry.signature !== signature || !("value" in entry))
    throw new Error("Invalid BlueZ property");
  return entry.value;
}
function text(value: unknown, max = 256): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw new Error("Invalid BlueZ text");
  return value;
}
function objectPath(value: unknown): string {
  const p = text(value, 512);
  if (!/^\/org\/bluez(?:\/[A-Za-z0-9_]+)*$/.test(p)) throw new Error("Invalid BlueZ path");
  return p;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid BlueZ boolean");
  return value;
}
function address(value: unknown): string {
  const a = text(value, 17);
  if (!/^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/.test(a)) throw new Error("Invalid BlueZ address");
  return a.toUpperCase();
}
export type BluezPairingOptions = {
  enabled?: boolean;
  /** Independently enabled typed input; does not grant trust or production configuration. */
  inputEnabled?: boolean;
  connect?: () => Promise<SessionBus>;
  callTimeoutMs?: number;
  discoveryMs?: number;
  pairTimeoutMs?: number;
  promptTimeoutMs?: number;
  pollMs?: number;
};
type Ready = Extract<BluetoothPairingState, { kind: "ready" }>;
type Candidate = {
  device: BluetoothNearbyDevice;
  path: string;
  fingerprint: string;
  paired: boolean;
};
type Lease = {
  id: BluetoothId;
  caller: string;
  adapterId: BluetoothId;
  path: string;
  owner: string;
  generation: number;
  expiresAt: number;
  acquired: boolean;
};
type Attempt = {
  id: BluetoothId;
  lease: Lease;
  candidate: Candidate;
  sent: boolean;
  accepted: boolean;
  canceling: boolean;
  cancellation: Promise<void> | null;
  retired: boolean;
};
type WaitingPrompt = {
  id: BluetoothId;
  attempt: Attempt;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
} & (
  | { kind: "consent"; resolve: () => void }
  | { kind: "pin-entry" | "passkey-entry"; resolve: (value: string | number) => void }
);
function id(): BluetoothId {
  return parseBluetoothId("pair_" + randomUUID());
}
function deadline(value: number | undefined, defaultValue: number, max: number): number {
  if (value === undefined) return defaultValue;
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error("Invalid pairing deadline");
  return value;
}
/** Independently injected, default-off, application-owned pairing. Never registers a default agent or writes Trusted. */
export async function createBluezPairingAdapter(
  options: BluezPairingOptions = {},
): Promise<BluetoothPairingAdapter> {
  const enabled = options.enabled ?? false;
  const inputEnabled = options.inputEnabled ?? false;
  const callMs = deadline(options.callTimeoutMs, 2500, 10000);
  const discoveryMs = deadline(options.discoveryMs, 30000, 30000);
  const pairMs = deadline(options.pairTimeoutMs, 30000, 30000);
  const promptMs = deadline(options.promptTimeoutMs, 10000, 30000);
  const pollMs = deadline(options.pollMs, 250, 5000);
  let state: BluetoothPairingState = enabled
    ? {
        kind: "ready",
        adapters: [],
        devices: [],
        lease: null,
        discovery: "idle",
        attempt: { kind: "idle" },
        prompt: null,
        message: "Reading Bluetooth adapters",
        inputEnabled,
      }
    : BLUETOOTH_PAIRING_DISABLED;
  let bus: SessionBus | null = null,
    owner: string | null = null,
    generation = 0,
    topology = 0,
    disposed = false,
    starting = false;
  let abort = new AbortController();
  let lease: Lease | null = null,
    attempt: Attempt | null = null,
    waiting: WaitingPrompt | null = null;
  let registered = false,
    unexport: (() => void) | null = null;
  let leaseTimer: ReturnType<typeof setTimeout> | null = null,
    pairTimer: ReturnType<typeof setTimeout> | null = null,
    poll: ReturnType<typeof setInterval> | null = null;
  let reading: Promise<void> | null = null,
    opening: Promise<void> | null = null,
    closing: Promise<void> | null = null;
  const disposers: DbusDisposer[] = [],
    listeners = new Set<() => void>();
  const propertyWatches = new Map<string, Promise<DbusDisposer>>(),
    lostCallers = new Set<string>();
  const identities = new Map<string, { id: BluetoothId; fingerprint: string }>();
  const adapters = new Map<
    BluetoothId,
    { info: BluetoothAdapterInfo; path: string; fingerprint: string }
  >();
  const candidates = new Map<BluetoothId, Candidate>();
  function publish(patch: Partial<Omit<Ready, "kind">>) {
    if (disposed || state.kind !== "ready") return;
    const next = { ...state, ...patch };
    if (isDeepStrictEqual(state, next)) return;
    state = next;
    for (const listener of Array.from(listeners)) listener();
  }
  function identify(p: string, fingerprint: string): BluetoothId {
    const existing = identities.get(p);
    if (existing?.fingerprint === fingerprint) return existing.id;
    const next = id();
    identities.set(p, { id: next, fingerprint });
    return next;
  }
  function ownsConnection(l: Lease): boolean {
    return (
      !disposed &&
      lease === l &&
      bus !== null &&
      owner === l.owner &&
      generation === l.generation &&
      !abort.signal.aborted
    );
  }
  function live(l: Lease): boolean {
    return ownsConnection(l) && Date.now() < l.expiresAt;
  }
  function checkLease(request: BluetoothLeaseRequest): Lease {
    if (!lease || request.caller !== lease.caller || request.leaseId !== lease.id || !live(lease))
      throw rejected("Discovery ownership changed");
    return lease;
  }
  function checkAttempt(request: BluetoothCancelRequest): Attempt {
    const l = checkLease(request);
    if (!attempt || attempt.retired || attempt.lease !== l || request.attemptId !== attempt.id)
      throw rejected("Pairing attempt changed");
    return attempt;
  }
  async function call(
    p: string,
    iface: string,
    member: string,
    signature = "",
    body: unknown[] = [],
    timeoutMs = callMs,
  ) {
    if (!bus || !owner || disposed) throw new Error("Bluetooth connection unavailable");
    const expected = owner,
      version = generation,
      connection = bus;
    const reply = await connection.call(
      { destination: expected, path: p, interface: iface, member, signature, body },
      { signal: abort.signal, timeoutMs },
    );
    if (bus !== connection || owner !== expected || generation !== version)
      throw new Error("Bluetooth owner changed");
    return reply;
  }
  function retirePrompt() {
    const current = waiting;
    waiting = null;
    if (current) {
      clearTimeout(current.timer);
      current.reject(rejected("Pairing prompt retired"));
    }
    publish({ prompt: null });
  }
  function finish(
    a: Attempt,
    kind: "complete" | "canceled" | "error" | "unknown",
    message: string,
  ) {
    if (attempt !== a || a.retired) return;
    if (
      state.kind === "ready" &&
      state.attempt.kind === "unknown" &&
      state.attempt.id === a.id &&
      kind !== "complete" &&
      kind !== "unknown"
    )
      return;
    if (pairTimer) clearTimeout(pairTimer);
    pairTimer = null;
    retirePrompt();
    if (kind !== "unknown") a.retired = true;
    publish({ attempt: { kind, id: a.id, device: a.candidate.device, message }, message });
  }
  function agentAttempt(
    context: DbusMethodContext,
    devicePath?: unknown,
    allowCancel = false,
  ): Attempt {
    const a = attempt;
    if (
      !a ||
      a.retired ||
      (a.canceling && !allowCancel) ||
      state.kind !== "ready" ||
      (state.attempt.kind !== "pending" &&
        !(allowCancel && a.canceling && state.attempt.kind === "unknown")) ||
      !(allowCancel && a.canceling ? ownsConnection(a.lease) : live(a.lease)) ||
      context.message.sender !== a.lease.owner ||
      (devicePath !== undefined && devicePath !== a.candidate.path)
    )
      throw rejected("No matching local pairing attempt");
    if (allowCancel && a.canceling) return a;
    const current = candidates.get(a.candidate.device.id);
    if (
      !current ||
      current.path !== a.candidate.path ||
      current.fingerprint !== a.candidate.fingerprint ||
      current.paired
    )
      throw rejected("Pairing device changed");
    return a;
  }
  async function prompt(
    context: DbusMethodContext,
    value:
      | Omit<
          Extract<BluetoothPairingPrompt, { kind: "confirmation" }>,
          "id" | "attemptId" | "deviceId"
        >
      | { kind: "authorization" },
  ) {
    const a = agentAttempt(context, context.body[0]);
    if (waiting || (state.kind === "ready" && state.prompt))
      throw rejected("Another pairing prompt is active");
    const promptId = id();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          if (waiting?.id === promptId) {
            void cancelAttempt(a, "Pairing confirmation timed out");
          }
        },
        Math.min(promptMs, Math.max(1, a.lease.expiresAt - Date.now())),
      );
      waiting = { kind: "consent", id: promptId, attempt: a, resolve, reject, timer };
      publish({
        prompt: { ...value, id: promptId, attemptId: a.id, deviceId: a.candidate.device.id },
      });
    });
    if (attempt !== a || a.retired || a.canceling || !live(a.lease))
      throw rejected("Pairing attempt retired");
    return { body: [] };
  }
  async function inputPrompt(context: DbusMethodContext, kind: "pin-entry" | "passkey-entry") {
    const a = agentAttempt(context, context.body[0]);
    if (!inputEnabled) throw rejected("Bluetooth code entry is disabled");
    if (waiting || (state.kind === "ready" && state.prompt))
      throw rejected("Another pairing prompt is active");
    const promptId = id();
    const value = await new Promise<string | number>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          if (waiting?.id === promptId) void cancelAttempt(a, "Pairing code entry timed out");
        },
        Math.min(promptMs, Math.max(1, a.lease.expiresAt - Date.now())),
      );
      waiting = { kind, id: promptId, attempt: a, resolve, reject, timer };
      publish({ prompt: { kind, id: promptId, attemptId: a.id, deviceId: a.candidate.device.id } });
    });
    if (attempt !== a || a.retired || a.canceling || !live(a.lease))
      throw rejected("Pairing attempt retired");
    // The code exists only in this deferred reply, never in observable backend state.
    return { body: [value] };
  }
  function display(context: DbusMethodContext, code: string, entered: number) {
    const a = agentAttempt(context, context.body[0]);
    if (waiting) throw rejected("Another pairing prompt is active");
    publish({
      prompt: {
        kind: "display-code",
        id: id(),
        attemptId: a.id,
        deviceId: a.candidate.device.id,
        code,
        entered,
      },
    });
    return { body: [] };
  }
  function exportAgent(connection: SessionBus) {
    const descriptor: DbusInterface = {
      name: AGENT,
      methods: {
        RequestConfirmation: {
          inSignature: "ou",
          outSignature: "",
          handler: async (context) => {
            const passkey = context.body[1];
            if (
              !Number.isInteger(passkey) ||
              typeof passkey !== "number" ||
              passkey < 0 ||
              passkey > 999999
            )
              throw rejected("Invalid confirmation code");
            return prompt(context, {
              kind: "confirmation",
              code: String(passkey).padStart(6, "0"),
            });
          },
        },
        RequestAuthorization: {
          inSignature: "o",
          outSignature: "",
          handler: (context) => prompt(context, { kind: "authorization" }),
        },
        DisplayPinCode: {
          inSignature: "os",
          outSignature: "",
          handler: (context) => {
            const code = text(context.body[1], 16);
            if (!code || !/^[\x20-\x7e]+$/.test(code)) throw rejected("Invalid display code");
            return display(context, code, 0);
          },
        },
        DisplayPasskey: {
          inSignature: "ouq",
          outSignature: "",
          handler: (context) => {
            const passkey = context.body[1],
              entered = context.body[2];
            if (
              typeof passkey !== "number" ||
              !Number.isInteger(passkey) ||
              passkey < 0 ||
              passkey > 999999 ||
              typeof entered !== "number" ||
              !Number.isInteger(entered) ||
              entered < 0 ||
              entered > 6
            )
              throw rejected("Invalid display passkey");
            return display(context, String(passkey).padStart(6, "0"), entered);
          },
        },
        RequestPinCode: {
          inSignature: "o",
          outSignature: "s",
          handler: (context) => inputPrompt(context, "pin-entry"),
        },
        RequestPasskey: {
          inSignature: "o",
          outSignature: "u",
          handler: (context) => inputPrompt(context, "passkey-entry"),
        },
        AuthorizeService: {
          inSignature: "os",
          outSignature: "",
          handler: (context) => {
            agentAttempt(context, context.body[0]);
            throw rejected("Service authorization is unsupported");
          },
        },
        Cancel: {
          inSignature: "",
          outSignature: "",
          handler: (context) => {
            const a = agentAttempt(context, undefined, true);
            if (!a.canceling) finish(a, "canceled", "BlueZ canceled pairing");
            else retirePrompt();
            return { body: [] };
          },
        },
        Release: {
          inSignature: "",
          outSignature: "",
          handler: (context) => {
            if (context.message.sender !== owner || !registered)
              throw rejected("Agent owner changed");
            registered = false;
            retirePrompt();
            void endLease("Pairing agent released");
            return { body: [] };
          },
        },
      },
    };
    unexport = connection.exportObject(AGENT_PATH, {
      ...descriptor,
      methods: Object.fromEntries(
        Object.entries(descriptor.methods).map(([name, method]) => [
          name,
          {
            ...method,
            handler: (context) => {
              if ((context.message.signature ?? "") !== method.inSignature)
                throw rejected("Invalid Agent1 callback signature");
              return method.handler(context);
            },
          },
        ]),
      ),
    });
  }
  async function read(): Promise<void> {
    if (reading) return reading;
    if (!bus || !owner || disposed) return;
    const connection = bus,
      expected = owner,
      version = generation,
      revision = topology;
    reading = (async () => {
      const reply = await call("/", MANAGER, "GetManagedObjects");
      if (
        reply.signature !== "a{oa{sa{sv}}}" ||
        reply.body?.length !== 1 ||
        !Array.isArray(reply.body[0]) ||
        reply.body[0].length > 256
      )
        throw new Error("Invalid managed Bluetooth objects");
      if (
        bus !== connection ||
        owner !== expected ||
        generation !== version ||
        topology !== revision
      )
        return;
      const raw = new Map<string, Record<string, unknown>>();
      for (const entry of reply.body[0]) {
        if (!Array.isArray(entry) || entry.length !== 2)
          throw new Error("Invalid managed Bluetooth entry");
        const p = objectPath(entry[0]);
        if (raw.has(p)) throw new Error("Duplicate managed Bluetooth entry");
        raw.set(p, record(entry[1], 32));
      }
      const nextAdapters = new Map<
        BluetoothId,
        { info: BluetoothAdapterInfo; path: string; fingerprint: string }
      >();
      const adapterPaths = new Map<string, BluetoothAdapterInfo>(),
        seen = new Set<string>();
      for (const [p, interfaces] of raw) {
        if (!(ADAPTER in interfaces)) continue;
        const props = record(interfaces[ADAPTER], 64),
          fingerprint = "adapter:" + address(property(props, "Address", "s"));
        const info = {
          id: identify(p, fingerprint),
          name: text(property(props, "Alias", "s")),
          powered: boolean(property(props, "Powered", "b")),
        };
        nextAdapters.set(info.id, { info, path: p, fingerprint });
        adapterPaths.set(p, info);
        seen.add(p);
      }
      if (nextAdapters.size > 8) throw new Error("Too many Bluetooth adapters");
      const nextCandidates = new Map<BluetoothId, Candidate>();
      for (const [p, interfaces] of raw) {
        if (!(DEVICE in interfaces)) continue;
        const props = record(interfaces[DEVICE], 64),
          adapter = adapterPaths.get(objectPath(property(props, "Adapter", "o")));
        if (!adapter) throw new Error("Bluetooth device has no adapter");
        const mac = address(property(props, "Address", "s")),
          fingerprint = "device:" + adapter.id + ":" + mac;
        const device: BluetoothNearbyDevice = {
          id: identify(p, fingerprint),
          adapterId: adapter.id,
          name: text(property(props, "Alias", "s")),
          address: mac,
          paired: false,
        };
        nextCandidates.set(device.id, {
          device,
          path: p,
          fingerprint,
          paired: boolean(property(props, "Paired", "b")),
        });
        seen.add(p);
      }
      if (nextCandidates.size > 128) throw new Error("Too many Bluetooth devices");
      for (const p of identities.keys()) if (!seen.has(p)) identities.delete(p);
      for (const p of seen)
        if (!propertyWatches.has(p)) {
          const watch = connection.subscribeSignal(
            { sender: expected, path: p, interface: PROPERTIES, member: "PropertiesChanged" },
            (message) => {
              if (bus !== connection || generation !== version || message.signature !== "sa{sv}as")
                return;
              topology++;
              let changed: Record<string, unknown>;
              try {
                changed = record(message.body?.[1]);
              } catch {
                return;
              }
              const invalidated = message.body?.[2];
              const identityChanged = ["Address", "Adapter"].some(
                (key) =>
                  key in changed || (Array.isArray(invalidated) && invalidated.includes(key)),
              );
              if (identityChanged) {
                identities.delete(p);
                for (const [key, candidate] of candidates)
                  if (candidate.path === p) candidates.delete(key);
                if (
                  attempt &&
                  !attempt.retired &&
                  (p === attempt.candidate.path || p === attempt.lease.path)
                ) {
                  finish(
                    attempt,
                    attempt.sent ? "unknown" : "error",
                    "Bluetooth device identity changed; pairing outcome is unknown",
                  );
                  void endLease("Bluetooth identity changed", true);
                  return;
                }
              }
              void read().catch(observationFailed);
            },
            { timeoutMs: callMs, signal: abort.signal },
          );
          propertyWatches.set(p, watch);
          await watch;
        }
      if (bus !== connection || generation !== version || topology !== revision) return;
      adapters.clear();
      for (const [key, value] of nextAdapters) adapters.set(key, value);
      candidates.clear();
      for (const [key, value] of nextCandidates) candidates.set(key, value);
      publish({
        adapters: Array.from(adapters.values(), (a) => a.info),
        devices: lease
          ? Array.from(candidates.values())
              .filter((c) => !c.paired && c.device.adapterId === lease?.adapterId)
              .map((c) => c.device)
              .slice(0, 64)
          : [],
        message: lease
          ? "Choose a nearby device. Discovery lasts up to 30 seconds."
          : "Discovery and pairing are available",
      });
      if (
        lease &&
        (!adapters.get(lease.adapterId)?.info.powered ||
          adapters.get(lease.adapterId)?.path !== lease.path)
      ) {
        void endLease("Bluetooth adapter changed");
        return;
      }
      const a = attempt;
      if (a && !a.retired && live(a.lease)) {
        const observed = candidates.get(a.candidate.device.id);
        if (
          !observed ||
          observed.fingerprint !== a.candidate.fingerprint ||
          observed.path !== a.candidate.path
        ) {
          finish(
            a,
            a.sent ? "unknown" : "error",
            "Bluetooth device changed; pairing outcome is unknown",
          );
          void endLease("Bluetooth device changed", true);
          return;
        }
        if (a.sent && a.accepted && !a.canceling && observed.paired)
          finish(
            a,
            "complete",
            "Paired. Moire did not enable trust. An untrusted device cannot use Connect controls.",
          );
      }
    })().finally(() => {
      reading = null;
    });
    return reading;
  }
  function observationFailed() {
    if (!lease) return;
    if (attempt && !attempt.retired)
      finish(
        attempt,
        attempt.sent ? "unknown" : "error",
        "Bluetooth observation failed; pairing outcome is unknown",
      );
    void endLease("Bluetooth observation failed; discovery has stopped", true);
  }
  function disconnectConnection() {
    generation++;
    for (const pending of propertyWatches.values())
      void pending.then((dispose) => dispose()).catch(() => {});
    propertyWatches.clear();
    abort.abort();
    abort = new AbortController();
    const connection = bus;
    bus = null;
    if (poll) clearInterval(poll);
    poll = null;
    unexport?.();
    unexport = null;
    registered = false;
    for (const dispose of disposers.splice(0)) void dispose().catch(() => {});
    connection?.close();
  }
  async function open(): Promise<void> {
    if (bus) return;
    if (opening) return opening;
    opening = (async () => {
      const connection = await (
        options.connect ?? (() => SessionBus.connect("unix:path=/run/dbus/system_bus_socket"))
      )();
      if (disposed) {
        connection.close();
        return;
      }
      bus = connection;
      generation++;
      const version = generation;
      let initialized = false;
      disposers.push(
        await connection.watchName(
          BLUEZ,
          (next) => {
            if (generation !== version || bus !== connection) return;
            if (!initialized) {
              initialized = true;
              if (owner && owner !== next) identities.clear();
              owner = next;
              return;
            }
            if (owner === next) return;
            if (attempt && !attempt.retired)
              finish(
                attempt,
                attempt.sent ? "unknown" : "error",
                "BlueZ owner changed; old pairing outcome is unknown",
              );
            owner = null;
            if (leaseTimer) clearTimeout(leaseTimer);
            leaseTimer = null;
            lease = null;
            identities.clear();
            adapters.clear();
            candidates.clear();
            publish({
              lease: null,
              adapters: [],
              devices: [],
              prompt: null,
              discovery: "unknown",
              message:
                "BlueZ changed. Pairing has stopped; reopen the controls to observe the new backend.",
            });
            disconnectConnection();
          },
          { timeoutMs: callMs, signal: abort.signal },
        ),
      );
      if (!owner || !bus) throw new Error("BlueZ has no existing owner");
      connection.onDisconnect(() => {
        if (bus !== connection || disposed) return;
        if (attempt && !attempt.retired)
          finish(
            attempt,
            attempt.sent ? "unknown" : "error",
            "Bluetooth connection lost; pairing outcome is unknown",
          );
        lease = null;
        if (leaseTimer) clearTimeout(leaseTimer);
        leaseTimer = null;
        publish({
          lease: null,
          prompt: null,
          devices: [],
          discovery: "unknown",
          message: "Bluetooth connection lost",
        });
        disconnectConnection();
      });
      const expected = owner;
      disposers.push(
        await connection.subscribeSignal(
          { sender: expected, path: "/", interface: MANAGER, member: "InterfacesRemoved" },
          (message) => {
            if (
              bus !== connection ||
              generation !== version ||
              message.signature !== "oas" ||
              message.body?.length !== 2
            )
              return;
            const p = message.body[0];
            if (typeof p !== "string") return;
            topology++;
            identities.delete(p);
            for (const [key, candidate] of candidates)
              if (candidate.path === p) candidates.delete(key);
            if (
              attempt &&
              !attempt.retired &&
              (p === attempt.candidate.path || p === attempt.lease.path)
            ) {
              finish(
                attempt,
                attempt.sent ? "unknown" : "error",
                "Bluetooth device was removed; pairing outcome is unknown",
              );
              void endLease("Bluetooth device was removed", true);
            } else void read().catch(observationFailed);
          },
          { timeoutMs: callMs, signal: abort.signal },
        ),
      );
      disposers.push(
        await connection.subscribeSignal(
          { sender: expected, path: "/", interface: MANAGER, member: "InterfacesAdded" },
          () => {
            topology++;
            void read().catch(observationFailed);
          },
          { timeoutMs: callMs, signal: abort.signal },
        ),
      );
      await read();
      poll = setInterval(() => {
        void read().catch(observationFailed);
      }, pollMs);
    })()
      .catch((error) => {
        disconnectConnection();
        throw error;
      })
      .finally(() => {
        opening = null;
      });
    return opening;
  }
  async function cancelAttempt(a: Attempt, message: string): Promise<void> {
    if (attempt !== a || a.retired) return;
    if (a.cancellation) return a.cancellation;
    const valid = ownsConnection(a.lease);
    const wasUnknown = state.kind === "ready" && state.attempt.kind === "unknown";
    a.canceling = true;
    if (pairTimer) clearTimeout(pairTimer);
    pairTimer = null;
    retirePrompt();
    publish({
      message: wasUnknown
        ? "Pairing outcome remains unknown; canceling the owned request"
        : "Canceling pairing; waiting for BlueZ acknowledgement",
    });
    a.cancellation = (async () => {
      if (!a.sent) {
        finish(a, "canceled", message);
        return;
      }
      if (!valid) {
        finish(a, "unknown", "Pairing cancellation could not be verified; outcome is unknown");
        return;
      }
      try {
        await call(a.candidate.path, DEVICE, "CancelPairing");
        finish(
          a,
          wasUnknown ? "unknown" : "canceled",
          wasUnknown ? "Pairing outcome remains unknown; another request is blocked" : message,
        );
      } catch {
        finish(a, "unknown", "Pairing cancellation was not confirmed; outcome is unknown");
        // Cleanup may join this promise, but cancellation never waits on cleanup itself.
        void endLease("Pairing cancellation outcome is unknown", true);
      }
    })();
    return a.cancellation;
  }
  async function endLease(message: string, skipCancel = false): Promise<void> {
    if (closing) return closing;
    closing = (async () => {
      const l = lease;
      if (!l) return;
      if (leaseTimer) clearTimeout(leaseTimer);
      leaseTimer = null;
      if (attempt?.cancellation && !attempt.retired) await attempt.cancellation;
      else if (
        !skipCancel &&
        attempt &&
        !attempt.retired &&
        !(state.kind === "ready" && state.attempt.kind === "unknown")
      )
        await cancelAttempt(attempt, message);
      retirePrompt();
      let uncertain = false;
      if (bus && owner === l.owner && generation === l.generation) {
        if (l.acquired) {
          try {
            await call(l.path, ADAPTER, "StopDiscovery");
          } catch {
            uncertain = true;
          }
        }
        if (registered) {
          try {
            await call("/org/bluez", AGENT_MANAGER, "UnregisterAgent", "o", [AGENT_PATH]);
          } catch {
            uncertain = true;
          }
        }
      }
      lease = null;
      publish({
        lease: null,
        devices: [],
        prompt: null,
        discovery: uncertain ? "unknown" : "stopped",
        message: uncertain
          ? "Discovery cleanup was uncertain; the owned connection was closed"
          : message,
      });
      disconnectConnection();
    })().finally(() => {
      closing = null;
    });
    return closing;
  }
  const adapter: BluetoothPairingAdapter = {
    get state() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async startDiscovery(request) {
      if (!enabled || disposed || state.kind !== "ready")
        throw rejected("Pairing capability is disabled");
      if (!/^:[0-9]+\.[0-9]+$/.test(request.caller)) throw rejected("Invalid initiating caller");
      if (
        lease ||
        starting ||
        closing ||
        state.attempt.kind === "unknown" ||
        lostCallers.has(request.caller)
      )
        throw rejected("Discovery or an uncertain pairing operation already exists");
      starting = true;
      try {
        await open();
        await read();
        if (lostCallers.has(request.caller)) throw rejected("Initiating caller closed");
        const selected = adapters.get(request.adapterId);
        if (!selected?.info.powered || !owner || !bus) throw rejected("Powered adapter changed");
        const l: Lease = {
          id: id(),
          caller: request.caller,
          adapterId: request.adapterId,
          path: selected.path,
          owner,
          generation,
          expiresAt: Date.now() + discoveryMs,
          acquired: false,
        };
        lease = l;
        publish({
          lease: { id: l.id, adapterId: l.adapterId, expiresAt: l.expiresAt },
          discovery: "starting",
          devices: [],
          prompt: null,
          message: "Starting owned discovery",
        });
        leaseTimer = setTimeout(() => {
          void endLease("Discovery time limit reached");
        }, discoveryMs);
        try {
          exportAgent(bus);
          await call("/org/bluez", AGENT_MANAGER, "RegisterAgent", "os", [
            AGENT_PATH,
            inputEnabled ? "KeyboardDisplay" : "DisplayYesNo",
          ]);
          if (!live(l)) throw rejected("Discovery ended while registering agent");
          registered = true;
          await call(l.path, ADAPTER, "StartDiscovery");
          if (!live(l)) throw rejected("Discovery ended before its acquisition was confirmed");
          l.acquired = true;
          publish({ discovery: "scanning" });
          await read();
        } catch (cause) {
          if (lease === l) {
            const uncertain = !(cause instanceof DbusRemoteError);
            publish({
              discovery: uncertain ? "unknown" : "error",
              message: uncertain
                ? "Discovery start outcome is unknown; closing the owned connection"
                : "Bluetooth discovery could not start",
            });
            await endLease("Discovery could not start", true);
            publish({ discovery: uncertain ? "unknown" : "error" });
          }
        }
      } finally {
        starting = false;
      }
    },
    async stopDiscovery(request) {
      checkLease(request);
      await endLease("Discovery stopped");
    },
    async beginPair(request) {
      checkLease(request);
      await read();
      const l = checkLease(request),
        candidate = candidates.get(request.deviceId);
      if (!candidate || candidate.paired || candidate.device.adapterId !== l.adapterId)
        throw rejected("Nearby device changed");
      if (
        (attempt && !attempt.retired) ||
        (state.kind === "ready" && state.attempt.kind === "unknown")
      )
        throw rejected("A pairing attempt is already pending or uncertain");
      const a: Attempt = {
        id: id(),
        lease: l,
        candidate,
        sent: false,
        accepted: false,
        canceling: false,
        cancellation: null,
        retired: false,
      };
      attempt = a;
      publish({
        attempt: { kind: "pending", id: a.id, device: candidate.device },
        prompt: null,
        message: "Pairing started. Confirm only a code you can verify on the device.",
      });
      pairTimer = setTimeout(
        () => {
          void cancelAttempt(a, "Pairing timed out");
        },
        Math.min(pairMs, Math.max(1, l.expiresAt - Date.now())),
      );
      // Do not await Pair: Agent1 consent/cancellation must remain dispatchable.
      void (async () => {
        try {
          if (!live(l)) throw rejected("Discovery ownership changed");
          a.sent = true;
          await call(
            candidate.path,
            DEVICE,
            "Pair",
            "",
            [],
            Math.min(pairMs, Math.max(1, l.expiresAt - Date.now())),
          );
          if (a.retired || a.canceling || attempt !== a || !live(l)) return;
          a.accepted = true;
          await read();
          if (!a.retired && !a.canceling)
            finish(
              a,
              "unknown",
              "BlueZ returned without same-attempt Paired evidence; another pairing request is blocked",
            );
        } catch (cause) {
          if (a.retired || a.canceling || attempt !== a) return;
          const definitive =
            cause instanceof DbusRemoteError &&
            !/NoReply|Timeout|Disconnected|NameHasNoOwner|ServiceUnknown/.test(cause.errorName);
          finish(
            a,
            definitive ? "error" : "unknown",
            definitive
              ? "Bluetooth pairing was rejected or could not complete"
              : "Pairing outcome is unknown; another request is blocked until verified same-attempt evidence",
          );
        }
      })();
    },
    async cancel(request) {
      const a = checkAttempt(request);
      await cancelAttempt(a, "Pairing canceled");
    },
    async respond(request) {
      const a = checkAttempt(request),
        current = waiting;
      if (
        !current ||
        current.kind !== "consent" ||
        current.attempt !== a ||
        current.id !== request.promptId
      )
        throw rejected("Pairing prompt changed");
      waiting = null;
      clearTimeout(current.timer);
      publish({ prompt: null });
      if (request.accepted) current.resolve();
      else {
        current.reject(rejected("Pairing confirmation declined"));
        await cancelAttempt(a, "Pairing confirmation declined");
      }
    },
    async respondInput(request) {
      const a = checkAttempt(request),
        current = waiting;
      if (
        !inputEnabled ||
        !current ||
        current.kind === "consent" ||
        current.attempt !== a ||
        current.id !== request.promptId
      )
        throw rejected("Pairing code prompt changed");
      const value = parseBluetoothInput(current.kind, request.value);
      waiting = null;
      clearTimeout(current.timer);
      publish({ prompt: null });
      current.resolve(value);
    },
    async callerLost(caller) {
      lostCallers.add(caller);
      if (lease?.caller === caller) await endLease("Pairing window or caller closed");
    },
    async dispose() {
      if (disposed) return;
      await endLease("Pairing backend closed");
      retirePrompt();
      if (pairTimer) clearTimeout(pairTimer);
      pairTimer = null;
      disconnectConnection();
      disposed = true;
      listeners.clear();
    },
  };
  if (enabled) {
    try {
      await open();
    } catch {
      publish({ discovery: "error", message: "Existing BlueZ backend is unavailable" });
    }
  }
  return adapter;
}
