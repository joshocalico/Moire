import { SessionBus, type DbusDisposer, type DbusMessage } from "@moire/dbus";
import {
  BATTERY_UNAVAILABLE,
  batterySupported,
  type BatteryAdapter,
  type DesktopBattery,
  type BatteryChargeState,
  type BatteryWarningLevel,
} from "@moire/system-management/battery-status";

const UPOWER = "org.freedesktop.UPower";
const ROOT = "/org/freedesktop/UPower";
const DEVICE = UPOWER + ".Device";
const PROPERTIES = "org.freedesktop.DBus.Properties";
export type UPowerBatteryOptions = {
  connect?: () => Promise<SessionBus>;
  callTimeoutMs?: number;
  pollMs?: number;
};
function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value) && !Buffer.isBuffer(value)
  );
}
function dictionary(value: unknown): Record<string, unknown> {
  if (!record(value) || Object.keys(value).length > 128)
    throw new Error("Invalid battery dictionary");
  return value;
}
function property(raw: Record<string, unknown>, key: string, signature: string): unknown {
  const value = raw[key];
  if (!record(value) || value.signature !== signature || !("value" in value))
    throw new Error("Invalid battery property");
  return value.value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid battery boolean");
  return value;
}
function uint(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff)
    throw new Error("Invalid battery enum");
  return value;
}
function estimate(value: unknown): number | null {
  if (typeof value !== "bigint" || value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Invalid battery time estimate");
  return value === 0n ? null : Number(value);
}
function objectPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !/^\/(?:[A-Za-z0-9_]+(?:\/[A-Za-z0-9_]+)*)?$/.test(value)
  )
    throw new Error("Invalid battery device path");
  return value;
}
const charges: readonly BatteryChargeState[] = [
  "unknown",
  "charging",
  "discharging",
  "empty",
  "fully-charged",
  "pending-charge",
  "pending-discharge",
];
const warnings: readonly BatteryWarningLevel[] = [
  "unknown",
  "none",
  "discharging",
  "low",
  "critical",
  "action",
];

/** Read the existing UPower aggregate; no service activation or power mutations. */
export async function createUPowerBatteryAdapter(
  options: UPowerBatteryOptions = {},
): Promise<BatteryAdapter> {
  const timeout = options.callTimeoutMs ?? 2500;
  const pollMs = options.pollMs ?? 0;
  let state: DesktopBattery = {
    kind: "loading",
    supported: false,
    message: "Reading UPower battery status",
  };
  let bus: SessionBus | null = null,
    owner: string | null = null,
    disposed = false,
    epoch = 0;
  let scope = new AbortController(),
    refreshing: Promise<void> | null = null,
    refreshAgain = false;
  let watcher: DbusDisposer | null = null,
    disconnect = () => {};
  let poll: ReturnType<typeof setInterval> | null = null;
  const subscriptions = new Map<string, DbusDisposer>();
  const listeners = new Set<() => void>();
  const publish = (next: DesktopBattery) => {
    if (disposed || JSON.stringify(next) === JSON.stringify(state)) return;
    state = next;
    for (const listener of Array.from(listeners)) listener();
  };
  const current = (expected: string, version: number) => {
    if (disposed || owner !== expected || epoch !== version || scope.signal.aborted)
      throw new Error("UPower identity changed");
  };
  const operationOptions = (deadline: number) => {
    const remaining = Math.ceil(deadline - performance.now());
    if (remaining <= 0) throw new Error("Battery read deadline expired");
    return { signal: scope.signal, timeoutMs: Math.min(timeout, remaining) };
  };
  async function call(
    expected: string,
    version: number,
    p: string,
    iface: string,
    member: string,
    signature: string,
    body: unknown[],
    deadline: number,
  ) {
    current(expected, version);
    if (!bus) throw new Error("Battery bus closed");
    const result = await bus.call(
      { destination: expected, path: p, interface: iface, member, signature, body },
      operationOptions(deadline),
    );
    current(expected, version);
    return result;
  }
  async function props(
    expected: string,
    version: number,
    p: string,
    iface: string,
    deadline: number,
  ) {
    const result = await call(expected, version, p, PROPERTIES, "GetAll", "s", [iface], deadline);
    if (result.signature !== "a{sv}" || result.body?.length !== 1)
      throw new Error("Invalid battery reply");
    return dictionary(result.body[0]);
  }
  async function subscribe(
    expected: string,
    version: number,
    p: string,
    iface: string,
    member: string,
    arg0: string | undefined,
    deadline: number,
  ) {
    const key = `${p}|${iface}|${member}|${arg0 ?? ""}`;
    if (subscriptions.has(key)) return;
    current(expected, version);
    if (!bus) throw new Error("Battery bus closed");
    const stop = await bus.subscribeSignal(
      {
        sender: expected,
        path: p,
        interface: iface,
        member,
        ...(arg0 === undefined ? {} : { arg0 }),
      },
      (message: DbusMessage) => {
        if (owner !== expected || epoch !== version) return;
        if (
          member === "PropertiesChanged" &&
          (message.signature !== "sa{sv}as" || message.body?.[0] !== arg0)
        )
          return;
        if (
          (member === "DeviceAdded" || member === "DeviceRemoved") &&
          (message.signature !== "o" || message.body?.length !== 1)
        )
          return;
        void refresh();
      },
      operationOptions(deadline),
    );
    try {
      current(expected, version);
      subscriptions.set(key, stop);
    } catch (error) {
      await stop();
      throw error;
    }
  }
  async function observe(expected: string, version: number): Promise<DesktopBattery> {
    const deadline = performance.now() + 8000;
    await subscribe(expected, version, ROOT, PROPERTIES, "PropertiesChanged", UPOWER, deadline);
    await subscribe(expected, version, ROOT, UPOWER, "DeviceAdded", undefined, deadline);
    await subscribe(expected, version, ROOT, UPOWER, "DeviceRemoved", undefined, deadline);
    const [display, manager] = await Promise.all([
      call(expected, version, ROOT, UPOWER, "GetDisplayDevice", "", [], deadline),
      props(expected, version, ROOT, UPOWER, deadline),
    ]);
    if (display.signature !== "o" || display.body?.length !== 1)
      throw new Error("Invalid display device reply");
    const p = objectPath(display.body[0]);
    const onBattery = boolean(property(manager, "OnBattery", "b"));
    const deviceKey = `${p}|${PROPERTIES}|PropertiesChanged|${DEVICE}`;
    for (const [key, stop] of subscriptions) {
      if (key.endsWith(`|${PROPERTIES}|PropertiesChanged|${DEVICE}`) && key !== deviceKey) {
        subscriptions.delete(key);
        await stop();
        current(expected, version);
      }
    }
    if (p === "/") return BATTERY_UNAVAILABLE;
    // Subscribe before reading so an update during read schedules a follow-up.
    await subscribe(expected, version, p, PROPERTIES, "PropertiesChanged", DEVICE, deadline);
    const raw = await props(expected, version, p, DEVICE, deadline);
    const type = uint(property(raw, "Type", "u"));
    if (!boolean(property(raw, "IsPresent", "b")) || (type !== 2 && type !== 3))
      return { kind: "unavailable", message: "No aggregate battery or UPS is present" };
    const percentage = property(raw, "Percentage", "d");
    if (
      typeof percentage !== "number" ||
      !Number.isFinite(percentage) ||
      percentage < 0 ||
      percentage > 100
    )
      throw new Error("Invalid battery percentage");
    return {
      kind: "ready",
      source: type === 2 ? "battery" : "ups",
      percentage,
      onBattery,
      chargeState: charges[uint(property(raw, "State", "u"))] ?? "unknown",
      warningLevel: warnings[uint(property(raw, "WarningLevel", "u"))] ?? "unknown",
      timeToEmptySeconds: estimate(property(raw, "TimeToEmpty", "x")),
      timeToFullSeconds: estimate(property(raw, "TimeToFull", "x")),
    };
  }
  async function refresh(): Promise<void> {
    if (disposed || !owner) return;
    if (refreshing) {
      refreshAgain = true;
      return refreshing;
    }
    const expected = owner,
      version = epoch;
    refreshing = (async () => {
      try {
        const next = await observe(expected, version);
        current(expected, version);
        publish(next);
      } catch {
        if (!disposed && owner === expected && epoch === version)
          publish({
            kind: "error",
            supported: batterySupported(state),
            message: "Unable to read UPower battery status",
          });
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
  const adapter: BatteryAdapter = {
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
    async dispose() {
      if (disposed) return;
      disposed = true;
      scope.abort();
      if (poll) clearInterval(poll);
      disconnect();
      listeners.clear();
      await watcher?.().catch(() => {});
      await Promise.allSettled(Array.from(subscriptions.values(), (stop) => stop()));
      subscriptions.clear();
      bus?.close();
      bus = null;
    },
  };
  if (
    !Number.isInteger(timeout) ||
    timeout < 10 ||
    timeout > 5000 ||
    !Number.isInteger(pollMs) ||
    pollMs < 0 ||
    pollMs > 60000
  ) {
    publish({ kind: "error", supported: false, message: "Invalid battery observation timing" });
    return adapter;
  }
  if (!options.connect && process.platform !== "linux") {
    publish(BATTERY_UNAVAILABLE);
    return adapter;
  }
  try {
    bus = await (options.connect
      ? options.connect()
      : SessionBus.connect("unix:path=/run/dbus/system_bus_socket", { timeoutMs: timeout }));
    disconnect = bus.onDisconnect(() => {
      epoch++;
      scope.abort();
      owner = null;
      if (poll) {
        clearInterval(poll);
        poll = null;
      }
      publish({ kind: "unavailable", message: "UPower bus disconnected" });
    });
    watcher = await bus.watchName(
      UPOWER,
      (next) => {
        epoch++;
        scope.abort();
        scope = new AbortController();
        owner = next;
        const old = Array.from(subscriptions.values());
        subscriptions.clear();
        void Promise.allSettled(old.map((stop) => stop()));
        publish(
          next
            ? { kind: "loading", supported: false, message: "Reading UPower battery status" }
            : BATTERY_UNAVAILABLE,
        );
        if (next) void refresh();
      },
      { timeoutMs: timeout },
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
    publish({ kind: "unavailable", message: "UPower system bus unavailable" });
  }
  return adapter;
}
