import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import type { SessionBus, DbusDisposer } from "@moire/dbus";
import {
  createAudioStatusAdapter,
  loadSettings,
  updateSettings,
  type AudioStatusAdapter,
} from "@moire/prefs";
import {
  DESKTOP_STATUS_PATH,
  DESKTOP_STATUS_INTERFACE,
  type DesktopStatusSnapshot,
  type DesktopNotice,
  type DesktopNetwork,
  type DesktopCapabilities,
} from "@moire/system-management/desktop-status";
import { attachNotificationService, type NotificationSnapshot } from "./notifications";
import type { WifiAdapter } from "@moire/system-management/network-status";
import { createNetworkManagerAdapter } from "./network-manager";
import { batterySupported, type BatteryAdapter } from "@moire/system-management/battery-status";
import { createUPowerBatteryAdapter } from "./upower-battery";
import {
  bluetoothSupported,
  bluetoothPairingBlocksConnections,
  bluetoothTrustBlocksControls,
  parseBluetoothId,
  type BluetoothAdapter,
  type BluetoothPairingAdapter,
} from "@moire/system-management/bluetooth-status";
import { createBluezBluetoothAdapter } from "./bluez-bluetooth";

export type DesktopControlOptions = {
  audio?: AudioStatusAdapter;
  wifi?: WifiAdapter;
  battery?: BatteryAdapter;
  bluetooth?: BluetoothAdapter;
  /** Separate injected capability. Omitted in production; Connect policy does not enable pairing. */
  bluetoothPairing?: BluetoothPairingAdapter;
  network?: () => readonly DesktopNetwork[];
  capabilities?: DesktopCapabilities;
  readDoNotDisturb?: () => boolean;
  writeDoNotDisturb?: (value: boolean) => void;
  pollMs?: number;
  /** Enable only with the shell's revision-bound action presentation installed. */
  notificationActions?: boolean;
  onError?: (error: unknown) => void;
};
function localAddresses(): DesktopNetwork[] {
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, entries]) => {
      const addresses = (entries ?? [])
        .filter((entry) => !entry.internal)
        .map((entry) => entry.address.slice(0, 256))
        .slice(0, 64);
      if (!addresses.length) return [];
      let transport: DesktopNetwork["transport"] = "other";
      if (process.platform === "linux") {
        const directory = path.join("/sys/class/net", name);
        if (fs.existsSync(path.join(directory, "wireless"))) transport = "wifi";
        else {
          try {
            if (fs.readFileSync(path.join(directory, "type"), "utf8").trim() === "1")
              transport = "wired";
          } catch {}
        }
      }
      return [{ name: name.slice(0, 128), transport, addresses }];
    })
    .slice(0, 64);
}
function audioBackendInstalled(): boolean {
  return ["wpctl", "pactl"].some((command) =>
    (process.env.PATH ?? "").split(path.delimiter).some((directory) => {
      try {
        fs.accessSync(path.resolve(directory, command), fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    }),
  );
}
function expectedRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffff_ffff)
    throw new Error("Invalid desktop status revision");
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Invalid desktop control value");
  return value;
}

/** Extends the session service without changing system-bus policy or device permissions. */
export async function attachDesktopControls(bus: SessionBus, options: DesktopControlOptions = {}) {
  const audio = options.audio ?? createAudioStatusAdapter();
  const pairing = options.bluetoothPairing;
  const [wifi, battery, bluetooth] = await Promise.all([
    options.wifi ?? createNetworkManagerAdapter(),
    options.battery ?? createUPowerBatteryAdapter(),
    options.bluetooth ?? createBluezBluetoothAdapter(),
  ]);
  const readPolicy = options.readDoNotDisturb ?? (() => !loadSettings().notifications);
  const writePolicy =
    options.writeDoNotDisturb ??
    ((value) => {
      updateSettings({ notifications: !value });
    });
  const readNetwork = options.network ?? localAddresses;
  const report = options.onError ?? ((error: unknown) => console.warn("[desktop-controls]", error));
  let revision = 1,
    disposed = false,
    busy = false,
    refreshing = false;
  let network = readNetwork(),
    doNotDisturb = readPolicy();
  let notifications: Awaited<ReturnType<typeof attachNotificationService>> | null = null;
  let notificationState: NotificationSnapshot = { active: [], history: [], doNotDisturb };
  const capabilities = options.capabilities ?? {
    audio: audio.state.kind === "ready" || audioBackendInstalled(),
    brightness: false,
    battery: false,
    bluetooth: false,
    power: false,
    notifications: false,
  };
  const snapshot = (): DesktopStatusSnapshot => {
    const actual = audio.state;
    const notices: DesktopNotice[] = [
      ...[...notificationState.active].reverse().map((item) => ({
        id: item.id,
        revision: item.revision,
        appName: item.appName,
        summary: item.summary,
        body: item.body,
        closed: false,
        createdAt: item.createdAt,
        closedAt: null,
        actions: item.actions,
      })),
      ...notificationState.history.map(({ notification: item, closedAt }) => ({
        id: item.id,
        revision: item.revision,
        appName: item.appName,
        summary: item.summary,
        body: item.body,
        closed: true,
        createdAt: item.createdAt,
        closedAt,
        actions: [],
      })),
    ];
    return {
      revision,
      updating: busy,
      audio:
        actual.kind === "ready"
          ? {
              kind: "ready",
              volume: actual.volume,
              muted: actual.muted,
              name: (actual.sink.description ?? actual.sink.name).slice(0, 4096),
            }
          : {
              kind: actual.kind,
              message: actual.kind === "loading" ? "Reading sound devices" : actual.message,
            },
      network: [...network],
      wifi: wifi.state,
      battery: battery.state,
      bluetooth: pairing ? { ...bluetooth.state, pairing: pairing.state } : bluetooth.state,
      capabilities: {
        ...capabilities,
        battery: batterySupported(battery.state),
        bluetooth: bluetoothSupported(bluetooth.state),
        notifications: notifications != null,
      },
      doNotDisturb,
      notificationsAvailable: notifications != null,
      notices,
    };
  };
  const publish = () => {
    if (disposed) return;
    revision = revision >= 0xffff_fffe ? 1 : revision + 1;
    bus.emitSignal({
      path: DESKTOP_STATUS_PATH,
      interface: DESKTOP_STATUS_INTERFACE,
      member: "Changed",
      signature: "s",
      body: [JSON.stringify(snapshot())],
    });
  };
  try {
    notifications = await attachNotificationService(bus, {
      onChange: (next) => {
        notificationState = next;
        publish();
      },
      onError: report,
      // Changed carries the actionable presentation to the existing session shell.
      present: options.notificationActions ? () => publish() : undefined,
    });
    notifications.setDoNotDisturb(doNotDisturb);
    notificationState = notifications.snapshot();
  } catch (error) {
    report(error);
  }
  const removeAudio = audio.subscribe(publish);
  const removeWifi = wifi.subscribe(publish);
  const removeBattery = battery.subscribe(publish);
  const removeBluetooth = bluetooth.subscribe(publish);
  let completedPair = "";
  const removePairing = pairing?.subscribe(() => {
    publish();
    const current = pairing.state;
    if (
      current.kind === "ready" &&
      current.attempt.kind === "complete" &&
      current.attempt.id !== completedPair
    ) {
      completedPair = current.attempt.id;
      void bluetooth.refresh().catch(report);
    }
  });
  let pairingStarting = false;
  let pairingCaller: { caller: string; alive: boolean; remove: DbusDisposer | null } | null = null;
  const pairingScope = new AbortController();
  let trustCaller: { caller: string; alive: boolean; remove: DbusDisposer | null } | null = null;
  let trustStarting = false;
  const releaseTrustCaller = async () => {
    const current = trustCaller;
    trustCaller = null;
    await current?.remove?.();
  };
  const trustCall = async (
    body: unknown[],
    sender: unknown,
    work: (caller: string) => Promise<void>,
    consent = false,
  ) => {
    if (disposed || bluetooth.state.trust?.kind !== "ready")
      throw new Error("Bluetooth trust capability disabled");
    if (typeof sender !== "string" || !/^:[0-9]+\.[0-9]+$/.test(sender))
      throw new Error("Invalid Bluetooth trust caller");
    const expected = expectedRevision(body[0]);
    if ((!consent && expected !== revision) || expected > revision)
      throw new Error("Bluetooth trust selection changed");
    if (!consent && (busy || pairingStarting || bluetoothPairingBlocksConnections(pairing?.state)))
      throw new Error("Bluetooth control pending or unknown");
    await work(sender);
    return { body: [JSON.stringify(snapshot())] };
  };
  const releaseCaller = async () => {
    const current = pairingCaller;
    pairingCaller = null;
    await current?.remove?.();
  };
  const pairingCall = async (
    body: unknown[],
    caller: unknown,
    work: (caller: string, adapter: BluetoothPairingAdapter) => Promise<void>,
    allowBusy = false,
  ) => {
    if (disposed || !pairing || pairing.state.kind !== "ready")
      throw new Error("Bluetooth pairing capability disabled");
    if (typeof caller !== "string" || !/^:[0-9]+\.[0-9]+$/.test(caller))
      throw new Error("Invalid pairing caller");
    const expected = expectedRevision(body[0]);
    // Cleanup and prompt replies use exact lease/attempt/prompt ownership instead
    // of an unrelated status revision that can advance while Pair is waiting.
    if ((!allowBusy && expected !== revision) || expected > revision)
      throw new Error("Bluetooth pairing state changed");
    if (busy && !allowBusy) throw new Error("Another desktop control is updating");
    await work(caller, pairing);
    return { body: [JSON.stringify(snapshot())] };
  };
  const operate = async (
    body: unknown[],
    work: () => Promise<void> | void,
    result?: () => unknown[],
  ) => {
    if (disposed) throw new Error("Desktop controls stopped");
    if (expectedRevision(body[0]) !== revision)
      throw new Error("Desktop status changed; retry using the current state");
    if (busy) throw new Error("Another desktop control is updating");
    busy = true;
    publish();
    try {
      await work();
      return { body: [JSON.stringify(snapshot()), ...(result?.() ?? [])] };
    } finally {
      busy = false;
      publish();
    }
  };
  const unexport = bus.exportObject(DESKTOP_STATUS_PATH, {
    name: DESKTOP_STATUS_INTERFACE,
    methods: {
      GetStatus: {
        inSignature: "",
        outSignature: "s",
        handler: () => ({ body: [JSON.stringify(snapshot())] }),
      },
      SetVolume: {
        inSignature: "ud",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, async () => {
            if (
              typeof body[1] !== "number" ||
              !Number.isFinite(body[1]) ||
              body[1] < 0 ||
              body[1] > 1
            )
              throw new Error("Volume must be between 0 and 1");
            const current = audio.state;
            if (current.kind !== "ready") throw new Error("Sound unavailable");
            const result = await audio.setVolume(current, body[1]);
            if (result.kind !== "ready")
              throw new Error(
                result.kind === "loading" ? "Sound is still loading" : result.message,
              );
          }),
      },
      SetMute: {
        inSignature: "ub",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, async () => {
            const current = audio.state;
            if (current.kind !== "ready") throw new Error("Sound unavailable");
            const result = await audio.setMute(current, boolean(body[1]));
            if (result.kind !== "ready")
              throw new Error(
                result.kind === "loading" ? "Sound is still loading" : result.message,
              );
          }),
      },
      SetDoNotDisturb: {
        inSignature: "ub",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            if (!notifications) throw new Error("Notification service unavailable");
            const value = boolean(body[1]);
            writePolicy(value);
            doNotDisturb = value;
            notifications.setDoNotDisturb(value);
            publish();
          }),
      },
      RefreshWifi: {
        inSignature: "u",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () =>
            wifi.state.kind === "ready" && wifi.state.canScan ? wifi.scan() : wifi.refresh(),
          ),
      },
      ConnectWifi: {
        inSignature: "uss",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            const id = body[1],
              password = body[2];
            if (
              typeof id !== "string" ||
              !id ||
              id.length > 2048 ||
              id.includes("\0") ||
              typeof password !== "string" ||
              password.length > 256 ||
              password.includes("\0")
            )
              throw new Error("Invalid Wi-Fi connection request");
            return wifi.connect({ id, password });
          }),
      },
      CancelWifi: {
        inSignature: "u",
        outSignature: "s",
        handler: ({ body }) => operate(body, () => wifi.cancel()),
      },
      RefreshBluetooth: {
        inSignature: "u",
        outSignature: "s",
        handler: ({ body }) => operate(body, () => bluetooth.refresh()),
      },
      SetBluetoothConnected: {
        inSignature: "usb",
        outSignature: "s",
        handler: ({ body }) => {
          if (
            trustStarting ||
            bluetoothPairingBlocksConnections(pairing?.state) ||
            bluetoothTrustBlocksControls(bluetooth.state.trust)
          )
            throw new Error("Bluetooth pairing outcome pending or unknown");
          return operate(body, () =>
            bluetooth.setConnected({
              id: parseBluetoothId(body[1]),
              connected: boolean(body[2]),
            }),
          );
        },
      },
      RequestBluetoothTrust: {
        inSignature: "usb",
        outSignature: "s",
        handler: ({ body, message }) =>
          trustCall(body, message.sender, async (caller) => {
            if (
              !bluetooth.requestTrust ||
              trustStarting ||
              bluetoothTrustBlocksControls(bluetooth.state.trust)
            )
              throw new Error("Bluetooth trust controls unavailable");
            trustStarting = true;
            try {
              await releaseTrustCaller();
              const observation = { caller, alive: true, remove: null as DbusDisposer | null };
              trustCaller = observation;
              observation.remove = await bus.watchName(
                caller,
                (owner) => {
                  if (owner !== caller) {
                    observation.alive = false;
                    void bluetooth.trustCallerLost?.(caller).catch(report);
                  }
                },
                { signal: pairingScope.signal, timeoutMs: 3000 },
              );
              if (!observation.alive || disposed)
                throw new Error("Bluetooth trust caller disappeared");
              if (bluetoothPairingBlocksConnections(pairing?.state))
                throw new Error("Bluetooth pairing outcome pending or unknown");
              await bluetooth.requestTrust({
                caller,
                id: parseBluetoothId(body[1]),
                trusted: boolean(body[2]),
              });
              if (!observation.alive || disposed) await bluetooth.trustCallerLost?.(caller);
            } finally {
              trustStarting = false;
            }
          }),
      },
      ConfirmBluetoothTrust: {
        inSignature: "us",
        outSignature: "s",
        handler: ({ body, message }) =>
          trustCall(
            body,
            message.sender,
            async (caller) => {
              if (!bluetooth.confirmTrust || bluetoothPairingBlocksConnections(pairing?.state))
                throw new Error("Bluetooth trust controls unavailable");
              await bluetooth.confirmTrust({ caller, challengeId: parseBluetoothId(body[1]) });
            },
            true,
          ),
      },
      CancelBluetoothTrust: {
        inSignature: "us",
        outSignature: "s",
        handler: ({ body, message }) =>
          trustCall(
            body,
            message.sender,
            async (caller) => {
              if (!bluetooth.cancelTrust) throw new Error("Bluetooth trust controls unavailable");
              await bluetooth.cancelTrust({ caller, challengeId: parseBluetoothId(body[1]) });
              if (trustCaller?.caller === caller) await releaseTrustCaller();
            },
            true,
          ),
      },
      StartBluetoothDiscovery: {
        inSignature: "us",
        outSignature: "s",
        handler: ({ body, message }) =>
          pairingCall(body, message.sender, async (caller, adapter) => {
            if (trustStarting || bluetoothTrustBlocksControls(bluetooth.state.trust))
              throw new Error("Bluetooth trust outcome pending or unknown");
            if (pairingStarting || (adapter.state.kind === "ready" && adapter.state.lease))
              throw new Error("A Bluetooth discovery owner is active");
            if (
              bluetooth.state.operation.kind === "pending" ||
              bluetooth.state.operation.kind === "unknown"
            )
              throw new Error("Bluetooth connection outcome pending or unknown");
            pairingStarting = true;
            try {
              await releaseCaller();
              const observation = { caller, alive: true, remove: null as DbusDisposer | null };
              pairingCaller = observation;
              observation.remove = await bus.watchName(
                caller,
                (owner) => {
                  if (owner !== caller) {
                    observation.alive = false;
                    void adapter.callerLost(caller).catch(report);
                  }
                },
                { signal: pairingScope.signal, timeoutMs: 3000 },
              );
              if (!observation.alive || disposed) throw new Error("Bluetooth caller disappeared");
              await adapter.startDiscovery({ caller, adapterId: parseBluetoothId(body[1]) });
              if (!observation.alive || disposed) await adapter.callerLost(caller);
            } finally {
              pairingStarting = false;
            }
          }),
      },
      StopBluetoothDiscovery: {
        inSignature: "us",
        outSignature: "s",
        handler: ({ body, message }) =>
          pairingCall(
            body,
            message.sender,
            async (caller, adapter) => {
              await adapter.stopDiscovery({ caller, leaseId: parseBluetoothId(body[1]) });
              if (pairingCaller?.caller === caller) await releaseCaller();
            },
            true,
          ),
      },
      BeginBluetoothPair: {
        inSignature: "uss",
        outSignature: "s",
        handler: ({ body, message }) =>
          pairingCall(body, message.sender, (caller, adapter) => {
            if (trustStarting || bluetoothTrustBlocksControls(bluetooth.state.trust))
              throw new Error("Bluetooth trust outcome pending or unknown");
            return adapter.beginPair({
              caller,
              leaseId: parseBluetoothId(body[1]),
              deviceId: parseBluetoothId(body[2]),
            });
          }),
      },
      CancelBluetoothPair: {
        inSignature: "uss",
        outSignature: "s",
        handler: ({ body, message }) =>
          pairingCall(
            body,
            message.sender,
            (caller, adapter) =>
              adapter.cancel({
                caller,
                leaseId: parseBluetoothId(body[1]),
                attemptId: parseBluetoothId(body[2]),
              }),
            true,
          ),
      },
      RespondBluetoothPrompt: {
        inSignature: "usssb",
        outSignature: "s",
        handler: ({ body, message }) =>
          pairingCall(
            body,
            message.sender,
            (caller, adapter) =>
              adapter.respond({
                caller,
                leaseId: parseBluetoothId(body[1]),
                attemptId: parseBluetoothId(body[2]),
                promptId: parseBluetoothId(body[3]),
                accepted: boolean(body[4]),
              }),
            true,
          ),
      },
      RespondBluetoothInput: {
        inSignature: "ussss",
        outSignature: "s",
        handler: ({ body, message }) =>
          pairingCall(
            body,
            message.sender,
            (caller, adapter) => {
              if (!adapter.respondInput || typeof body[4] !== "string")
                throw new Error("Bluetooth input unavailable");
              return adapter.respondInput({
                caller,
                leaseId: parseBluetoothId(body[1]),
                attemptId: parseBluetoothId(body[2]),
                promptId: parseBluetoothId(body[3]),
                value: body[4],
              });
            },
            true,
          ),
      },
      Dismiss: {
        inSignature: "uuu",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            if (!notifications?.dismiss(expectedRevision(body[1]), expectedRevision(body[2])))
              throw new Error("Notification changed or already closed");
          }),
      },
      InvokeAction: {
        inSignature: "uusu",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            if (
              typeof body[2] !== "string" ||
              !notifications?.invokeAction(
                expectedRevision(body[1]),
                body[2],
                expectedRevision(body[3]),
              )
            )
              throw new Error("Notification action changed or already closed");
          }),
      },
      DismissMany: {
        inSignature: "ua(uu)",
        outSignature: "suu",
        handler: ({ body }) => {
          const raw = body[1];
          if (!Array.isArray(raw) || raw.length > 128)
            throw new Error("Invalid notification batch");
          const ids = new Set<number>();
          const pairs = raw.map((pair) => {
            if (!Array.isArray(pair) || pair.length !== 2)
              throw new Error("Invalid notification pair");
            const id = expectedRevision(pair[0]),
              revision = expectedRevision(pair[1]);
            if (ids.has(id)) throw new Error("Duplicate notification identity");
            ids.add(id);
            return { id, revision };
          });
          let dismissed = 0;
          return operate(
            body,
            () => {
              if (!notifications) throw new Error("Notification service unavailable");
              for (const pair of pairs)
                if (notifications.dismiss(pair.id, pair.revision)) dismissed++;
            },
            () => [dismissed, pairs.length - dismissed],
          );
        },
      },
    },
  });
  const refresh = async () => {
    if (disposed || busy || refreshing) return;
    refreshing = true;
    try {
      const nextNetwork = readNetwork(),
        nextPolicy = readPolicy();
      if (JSON.stringify(nextNetwork) !== JSON.stringify(network) || nextPolicy !== doNotDisturb) {
        network = nextNetwork;
        doNotDisturb = nextPolicy;
        notifications?.setDoNotDisturb(nextPolicy);
        publish();
      }
      await audio.refresh();
      await wifi.refresh();
      await battery.refresh();
      await bluetooth.refresh();
    } catch (error) {
      report(error);
    } finally {
      refreshing = false;
    }
  };
  const pollMs = options.pollMs ?? 5000;
  const timer = pollMs > 0 ? setInterval(() => void refresh(), pollMs).unref() : null;
  let removeDisconnect = () => {};
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    pairingScope.abort();
    await releaseCaller();
    await releaseTrustCaller();
    if (timer) clearInterval(timer);
    removeDisconnect();
    removeAudio();
    removeWifi();
    removeBattery();
    removeBluetooth();
    removePairing?.();
    unexport();
    audio.dispose();
    try {
      await wifi.dispose();
    } finally {
      try {
        await battery.dispose();
      } finally {
        try {
          await bluetooth.dispose();
        } finally {
          try {
            await pairing?.dispose();
          } finally {
            await notifications?.dispose();
          }
        }
      }
    }
  };
  removeDisconnect = bus.onDisconnect(() => {
    void dispose().catch(report);
  });
  void refresh();
  return { snapshot, refresh, dispose };
}
