import type { SessionBus } from "@moire/dbus";
import { parseDesktopWifi, type DesktopWifi } from "./network-status";
import { parseDesktopBattery, type DesktopBattery } from "./battery-status";
import {
  parseDesktopBluetooth,
  type DesktopBluetooth,
  type BluetoothActionRequest,
  parseBluetoothId,
  bluetoothPairingBlocksConnections,
  bluetoothTrustBlocksControls,
  parseBluetoothInput,
  type BluetoothDiscoveryAction,
  type BluetoothLeaseAction,
  type BluetoothPairAction,
  type BluetoothCancelAction,
  type BluetoothPromptAction,
  type BluetoothObservedRequest,
  type BluetoothInputAction,
  type BluetoothTrustAction,
  type BluetoothTrustConsentAction,
} from "./bluetooth-status";

export const DESKTOP_STATUS_PATH = "/org/moire/DesktopStatus1";
export const DESKTOP_STATUS_INTERFACE = "org.moire.DesktopStatus1";
export const DESKTOP_STATUS_BUS = "org.moire.SystemManagement1";

export type DesktopAudio =
  | { kind: "ready"; volume: number; muted: boolean; name: string }
  | { kind: "loading" | "unavailable" | "error"; message: string };
export type DesktopNotice = {
  id: number;
  revision: number;
  appName: string;
  summary: string;
  body: string;
  closed: boolean;
  createdAt: number;
  closedAt: number | null;
  actions: ReadonlyArray<{ key: string; label: string }>;
};
export type NoticeIdentity = Readonly<{ id: number; revision: number }>;
export type DismissManyResult = Readonly<{ dismissed: number; skipped: number }>;
export type DesktopCapabilities = Readonly<{
  audio: boolean;
  brightness: boolean;
  battery: boolean;
  bluetooth: boolean;
  power: boolean;
  notifications: boolean;
}>;
export type DesktopNetwork = Readonly<{
  name: string;
  transport: "wired" | "wifi" | "other";
  addresses: readonly string[];
}>;
export type DesktopStatusSnapshot = {
  revision: number;
  audio: DesktopAudio;
  network: readonly DesktopNetwork[];
  wifi: DesktopWifi;
  battery: DesktopBattery;
  bluetooth: DesktopBluetooth;
  capabilities: DesktopCapabilities;
  doNotDisturb: boolean;
  notificationsAvailable: boolean;
  updating: boolean;
  notices: DesktopNotice[];
};
export type DesktopStatusState =
  | { kind: "loading" | "unavailable" | "error"; message: string }
  | { kind: "ready"; owner: string; snapshot: DesktopStatusSnapshot };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid status object");
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 4096): string {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid status text");
  return value;
}
function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff)
    throw new Error("Invalid status identity");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid status boolean");
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > 8.64e15)
    throw new Error("Invalid notification timestamp");
  return value;
}
/** Parse the service boundary before any untrusted content reaches the shell. */
export function parseDesktopStatus(value: unknown): DesktopStatusSnapshot {
  // 192 entries × three bounded strings, including JSON escape expansion.
  const raw = record(JSON.parse(text(value, 16 * 1024 * 1024)));
  const audio = record(raw.audio);
  let parsedAudio: DesktopAudio;
  if (audio.kind === "ready") {
    if (
      typeof audio.volume !== "number" ||
      !Number.isFinite(audio.volume) ||
      audio.volume < 0 ||
      audio.volume > 100
    )
      throw new Error("Invalid audio volume");
    parsedAudio = {
      kind: "ready",
      volume: audio.volume,
      muted: boolean(audio.muted),
      name: text(audio.name),
    };
  } else if (audio.kind === "loading" || audio.kind === "unavailable" || audio.kind === "error") {
    parsedAudio = { kind: audio.kind, message: text(audio.message) };
  } else throw new Error("Invalid audio state");
  if (!Array.isArray(raw.network) || raw.network.length > 64)
    throw new Error("Invalid network status");
  if (!Array.isArray(raw.notices) || raw.notices.length > 192)
    throw new Error("Invalid notification status");
  const capabilities = record(raw.capabilities);
  return {
    revision: integer(raw.revision),
    audio: parsedAudio,
    network: raw.network.map((value) => {
      const item = record(value);
      const transport = item.transport;
      if (transport !== "wired" && transport !== "wifi" && transport !== "other")
        throw new Error("Invalid network transport");
      if (!Array.isArray(item.addresses) || item.addresses.length > 64)
        throw new Error("Invalid network addresses");
      return {
        name: text(item.name, 128),
        transport,
        addresses: item.addresses.map((value) => text(value, 256)),
      };
    }),
    wifi: parseDesktopWifi(raw.wifi),
    battery: parseDesktopBattery(raw.battery),
    bluetooth: parseDesktopBluetooth(raw.bluetooth),
    capabilities: {
      audio: boolean(capabilities.audio),
      brightness: boolean(capabilities.brightness),
      battery: boolean(capabilities.battery),
      bluetooth: boolean(capabilities.bluetooth),
      power: boolean(capabilities.power),
      notifications: boolean(capabilities.notifications),
    },
    doNotDisturb: boolean(raw.doNotDisturb),
    notificationsAvailable: boolean(raw.notificationsAvailable),
    updating: boolean(raw.updating),
    notices: raw.notices.map((value) => {
      const item = record(value);
      const closed = boolean(item.closed);
      if (
        !Array.isArray(item.actions) ||
        item.actions.length > 16 ||
        (closed && item.actions.length)
      )
        throw new Error("Invalid notification actions");
      const keys = new Set<string>();
      const actions = item.actions.map((value) => {
        const action = record(value),
          key = text(action.key, 128),
          label = text(action.label, 256);
        if (!key || keys.has(key)) throw new Error("Invalid notification action identity");
        keys.add(key);
        return { key, label };
      });
      if (!closed && item.closedAt !== null)
        throw new Error("Invalid active notification timestamp");
      return {
        id: integer(item.id),
        revision: integer(item.revision),
        appName: text(item.appName),
        summary: text(item.summary),
        body: text(item.body),
        closed,
        createdAt: timestamp(item.createdAt),
        closedAt: closed ? timestamp(item.closedAt) : null,
        actions,
      };
    }),
  };
}

export type DesktopStatusClient = {
  readonly state: DesktopStatusState;
  setVolume(value: number): Promise<void>;
  setMute(value: boolean): Promise<void>;
  setDoNotDisturb(value: boolean): Promise<void>;
  refreshWifi(): Promise<void>;
  connectWifi(id: string, password: string): Promise<void>;
  cancelWifi(): Promise<void>;
  refreshBluetooth(): Promise<void>;
  setBluetoothConnected(request: BluetoothActionRequest): Promise<void>;
  startBluetoothDiscovery(request: BluetoothDiscoveryAction): Promise<void>;
  stopBluetoothDiscovery(request: BluetoothLeaseAction): Promise<void>;
  beginBluetoothPair(request: BluetoothPairAction): Promise<void>;
  cancelBluetoothPair(request: BluetoothCancelAction): Promise<void>;
  respondBluetoothPrompt(request: BluetoothPromptAction): Promise<void>;
  respondBluetoothInput(request: BluetoothInputAction): Promise<void>;
  requestBluetoothTrust(request: BluetoothTrustAction): Promise<void>;
  confirmBluetoothTrust(request: BluetoothTrustConsentAction): Promise<void>;
  cancelBluetoothTrust(request: BluetoothTrustConsentAction): Promise<void>;
  dismiss(id: number, revision: number): Promise<void>;
  dismissMany(pairs: readonly NoticeIdentity[]): Promise<DismissManyResult>;
  invokeAction(id: number, key: string, revision: number): Promise<void>;
  dispose(): Promise<void>;
};

/** Unique-owner calls and generation checks prevent a replacement service receiving stale actions. */
export async function observeDesktopStatus(
  bus: SessionBus,
  changed: (state: DesktopStatusState) => void,
  options: { actionTimeoutMs?: number } = {},
): Promise<DesktopStatusClient> {
  const actionTimeoutMs = options.actionTimeoutMs ?? 20000;
  if (!Number.isInteger(actionTimeoutMs) || actionTimeoutMs < 1 || actionTimeoutMs > 120000)
    throw new Error("Invalid desktop action timeout");
  let state: DesktopStatusState = { kind: "loading", message: "Connecting to desktop controls" };
  let generation = 0,
    disposed = false;
  const pendingActions = new Set<AbortController>();
  const revokeActions = () => {
    for (const pending of pendingActions) pending.abort();
    pendingActions.clear();
  };
  let removeSignals: (() => Promise<void>) | null = null;
  const publish = (next: DesktopStatusState) => {
    if (!disposed) {
      state = next;
      changed(next);
    }
  };
  const load = async (owner: string, ticket: number) => {
    try {
      const reply = await bus.call(
        {
          destination: owner,
          path: DESKTOP_STATUS_PATH,
          interface: DESKTOP_STATUS_INTERFACE,
          member: "GetStatus",
        },
        { timeoutMs: 3000 },
      );
      const snapshot = parseDesktopStatus(reply.body?.[0]);
      if (ticket !== generation || disposed) return;
      if (
        state.kind === "ready" &&
        state.owner === owner &&
        state.snapshot.revision > snapshot.revision
      )
        return;
      publish({ kind: "ready", owner, snapshot });
    } catch (error) {
      if (state.kind === "ready" && state.owner === owner) return;
      if (ticket === generation)
        publish({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };
  const removeOwner = await bus.watchName(
    DESKTOP_STATUS_BUS,
    (owner) => {
      revokeActions();
      const ticket = ++generation;
      void removeSignals?.().catch(() => {});
      removeSignals = null;
      publish({
        kind: owner ? "loading" : "unavailable",
        message: owner ? "Reading desktop controls" : "Desktop controls unavailable",
      });
      if (!owner) return;
      void (async () => {
        const remove = await bus.subscribeSignal(
          {
            sender: owner,
            path: DESKTOP_STATUS_PATH,
            interface: DESKTOP_STATUS_INTERFACE,
            member: "Changed",
          },
          (message) => {
            if (ticket !== generation || disposed) return;
            try {
              const snapshot = parseDesktopStatus(message.body?.[0]);
              if (state.kind === "ready" && snapshot.revision < state.snapshot.revision) return;
              publish({ kind: "ready", owner, snapshot });
            } catch (error) {
              publish({ kind: "error", message: String(error) });
            }
          },
          { timeoutMs: 3000 },
        );
        if (ticket !== generation || disposed) {
          await remove();
          return;
        }
        removeSignals = remove;
        await load(owner, ticket);
      })().catch((error) => {
        if (ticket === generation) publish({ kind: "error", message: String(error) });
      });
    },
    { timeoutMs: 3000 },
  );
  const removeDisconnect = bus.onDisconnect(() => {
    revokeActions();
    ++generation;
    publish({ kind: "unavailable", message: "Desktop controls disconnected" });
  });
  const action = async (member: string, signature: string, body: unknown[], allowBusy = false) => {
    if (disposed || state.kind !== "ready") throw new Error("Desktop controls unavailable");
    if (state.snapshot.updating && !allowBusy)
      throw new Error("A desktop control is still updating");
    const expected = state,
      ticket = generation;
    const cancellation = new AbortController();
    pendingActions.add(cancellation);
    // The audio backend may perform several bounded read/verify/write commands.
    let reply;
    try {
      reply = await bus.call(
        {
          destination: expected.owner,
          path: DESKTOP_STATUS_PATH,
          interface: DESKTOP_STATUS_INTERFACE,
          member,
          signature: `u${signature}`,
          body: [expected.snapshot.revision, ...body],
        },
        { timeoutMs: actionTimeoutMs, signal: cancellation.signal },
      );
    } catch (error) {
      if (ticket === generation && !disposed) {
        // A transport deadline cannot cancel a backend write. Read the actual
        // operation state, and keep retries disabled while it remains pending.
        if (state.kind !== "ready" || state.snapshot.revision <= expected.snapshot.revision)
          publish({ kind: "error", message: "Control outcome unknown; reading actual status" });
        void load(expected.owner, ticket);
      }
      throw error;
    } finally {
      pendingActions.delete(cancellation);
    }
    if (ticket !== generation || disposed) throw new Error("Desktop service changed during action");
    const snapshot = parseDesktopStatus(reply.body?.[0]);
    if (state.kind !== "ready" || snapshot.revision >= state.snapshot.revision)
      publish({ kind: "ready", owner: expected.owner, snapshot });
    return reply;
  };
  const pairingState = (request: BluetoothObservedRequest, strict = true) => {
    integer(request.revision);
    if (
      state.kind !== "ready" ||
      state.owner !== request.owner ||
      (strict && state.snapshot.revision !== request.revision)
    )
      throw new Error("Bluetooth pairing selection changed");
    const pairing = state.snapshot.bluetooth.pairing;
    if (pairing?.kind !== "ready") throw new Error("Bluetooth pairing capability disabled");
    return pairing;
  };
  const pairingLease = (request: BluetoothLeaseAction, strict = false) => {
    const pairing = pairingState(request, strict);
    parseBluetoothId(request.leaseId);
    if (pairing.lease?.id !== request.leaseId) throw new Error("Bluetooth discovery lease changed");
    return pairing;
  };
  const trustConsent = (request: BluetoothTrustConsentAction) => {
    integer(request.revision);
    parseBluetoothId(request.challengeId);
    if (
      state.kind !== "ready" ||
      state.owner !== request.owner ||
      request.revision > state.snapshot.revision
    )
      throw new Error("Bluetooth trust consent changed");
    const trust = state.snapshot.bluetooth.trust;
    if (
      trust?.kind !== "ready" ||
      trust.operation.kind !== "confirmation" ||
      trust.operation.challengeId !== request.challengeId
    )
      throw new Error("Bluetooth trust consent changed");
  };
  return {
    get state() {
      return state;
    },
    setVolume: async (value) => {
      await action("SetVolume", "d", [value]);
    },
    setMute: async (value) => {
      await action("SetMute", "b", [value]);
    },
    setDoNotDisturb: async (value) => {
      await action("SetDoNotDisturb", "b", [value]);
    },
    refreshWifi: async () => {
      await action("RefreshWifi", "", []);
    },
    connectWifi: async (id, password) => {
      await action("ConnectWifi", "ss", [id, password]);
    },
    cancelWifi: async () => {
      await action("CancelWifi", "", []);
    },
    refreshBluetooth: async () => {
      await action("RefreshBluetooth", "", []);
    },
    setBluetoothConnected: async (request) => {
      parseBluetoothId(request.id);
      integer(request.revision);
      boolean(request.connected);
      if (
        state.kind !== "ready" ||
        state.owner !== request.owner ||
        state.snapshot.revision !== request.revision
      )
        throw new Error("Bluetooth selection changed; refresh before trying again");
      const bluetooth = state.snapshot.bluetooth;
      if (
        bluetoothPairingBlocksConnections(bluetooth.pairing) ||
        bluetoothTrustBlocksControls(bluetooth.trust)
      )
        throw new Error("Bluetooth pairing outcome pending or unknown");
      if (
        bluetooth.status.kind !== "ready" ||
        bluetooth.status.policy !== "interactive" ||
        bluetooth.operation.kind === "pending" ||
        bluetooth.operation.kind === "unknown"
      )
        throw new Error("Bluetooth device controls unavailable");
      const device = bluetooth.status.devices.find((device) => device.id === request.id);
      if (
        !device ||
        (request.connected ? !device.trusted : !device.connected) ||
        !bluetooth.status.adapters.some(
          (adapter) => adapter.id === device.adapterId && adapter.powered,
        )
      )
        throw new Error("Bluetooth device is no longer eligible");
      await action("SetBluetoothConnected", "sb", [request.id, request.connected]);
    },
    startBluetoothDiscovery: async (request) => {
      const pairing = pairingState(request);
      if (state.kind !== "ready" || bluetoothTrustBlocksControls(state.snapshot.bluetooth.trust))
        throw new Error("Bluetooth trust outcome pending or unknown");
      parseBluetoothId(request.adapterId);
      if (
        pairing.lease ||
        pairing.attempt.kind === "unknown" ||
        !pairing.adapters.some((adapter) => adapter.id === request.adapterId && adapter.powered)
      )
        throw new Error("Bluetooth discovery unavailable");
      await action("StartBluetoothDiscovery", "s", [request.adapterId]);
    },
    stopBluetoothDiscovery: async (request) => {
      pairingLease(request);
      await action("StopBluetoothDiscovery", "s", [request.leaseId], true);
    },
    beginBluetoothPair: async (request) => {
      const pairing = pairingLease(request, true);
      if (state.kind !== "ready" || bluetoothTrustBlocksControls(state.snapshot.bluetooth.trust))
        throw new Error("Bluetooth trust outcome pending or unknown");
      parseBluetoothId(request.deviceId);
      if (
        pairing.attempt.kind === "pending" ||
        pairing.attempt.kind === "unknown" ||
        !pairing.devices.some(
          (device) =>
            device.id === request.deviceId && device.adapterId === pairing.lease?.adapterId,
        )
      )
        throw new Error("Bluetooth pairing device unavailable");
      await action("BeginBluetoothPair", "ss", [request.leaseId, request.deviceId]);
    },
    cancelBluetoothPair: async (request) => {
      const pairing = pairingLease(request);
      parseBluetoothId(request.attemptId);
      if (pairing.attempt.kind !== "pending" || pairing.attempt.id !== request.attemptId)
        throw new Error("Bluetooth pairing attempt changed");
      await action("CancelBluetoothPair", "ss", [request.leaseId, request.attemptId], true);
    },
    respondBluetoothPrompt: async (request) => {
      const pairing = pairingLease(request);
      parseBluetoothId(request.attemptId);
      parseBluetoothId(request.promptId);
      boolean(request.accepted);
      if (
        pairing.attempt.kind !== "pending" ||
        pairing.attempt.id !== request.attemptId ||
        pairing.prompt?.id !== request.promptId ||
        pairing.prompt.attemptId !== request.attemptId ||
        (pairing.prompt.kind !== "confirmation" && pairing.prompt.kind !== "authorization")
      )
        throw new Error("Bluetooth pairing prompt changed");
      await action(
        "RespondBluetoothPrompt",
        "sssb",
        [request.leaseId, request.attemptId, request.promptId, request.accepted],
        true,
      );
    },
    respondBluetoothInput: async (request) => {
      const pairing = pairingLease(request);
      parseBluetoothId(request.attemptId);
      parseBluetoothId(request.promptId);
      const prompt = pairing.prompt;
      if (
        !pairing.inputEnabled ||
        pairing.attempt.kind !== "pending" ||
        pairing.attempt.id !== request.attemptId ||
        prompt?.id !== request.promptId ||
        (prompt.kind !== "pin-entry" && prompt.kind !== "passkey-entry")
      )
        throw new Error("Bluetooth input prompt changed");
      parseBluetoothInput(prompt.kind, request.value);
      await action(
        "RespondBluetoothInput",
        "ssss",
        [request.leaseId, request.attemptId, request.promptId, request.value],
        true,
      );
    },
    requestBluetoothTrust: async (request) => {
      parseBluetoothId(request.id);
      boolean(request.trusted);
      if (
        state.kind !== "ready" ||
        state.owner !== request.owner ||
        state.snapshot.revision !== request.revision
      )
        throw new Error("Bluetooth trust selection changed");
      const bluetooth = state.snapshot.bluetooth;
      if (
        bluetooth.trust?.kind !== "ready" ||
        bluetoothTrustBlocksControls(bluetooth.trust) ||
        bluetoothPairingBlocksConnections(bluetooth.pairing) ||
        bluetooth.operation.kind === "pending" ||
        bluetooth.operation.kind === "unknown" ||
        bluetooth.status.kind !== "ready"
      )
        throw new Error("Bluetooth trust controls unavailable");
      const device = bluetooth.status.devices.find((item) => item.id === request.id);
      if (!device || device.trusted === request.trusted)
        throw new Error("Bluetooth trust selection changed");
      await action("RequestBluetoothTrust", "sb", [request.id, request.trusted]);
    },
    confirmBluetoothTrust: async (request) => {
      trustConsent(request);
      await action("ConfirmBluetoothTrust", "s", [request.challengeId], true);
    },
    cancelBluetoothTrust: async (request) => {
      trustConsent(request);
      await action("CancelBluetoothTrust", "s", [request.challengeId], true);
    },
    dismiss: async (id, revision) => {
      await action("Dismiss", "uu", [id, revision]);
    },
    invokeAction: async (id, key, revision) => {
      await action("InvokeAction", "usu", [id, key, revision]);
    },
    dismissMany: async (pairs) => {
      if (pairs.length > 128) throw new Error("Too many notification identities");
      const reply = await action("DismissMany", "a(uu)", [
        pairs.map((pair) => [integer(pair.id), integer(pair.revision)]),
      ]);
      const dismissed = integer(reply.body?.[1]),
        skipped = integer(reply.body?.[2]);
      if (dismissed + skipped !== pairs.length)
        throw new Error("Invalid notification dismissal result");
      return { dismissed, skipped };
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      ++generation;
      revokeActions();
      removeDisconnect();
      await Promise.all([removeOwner(), removeSignals?.()]);
    },
  };
}
