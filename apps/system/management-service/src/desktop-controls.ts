import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import type { SessionBus, DbusDisposer } from "@moire/dbus";
import {
  AudioControl,
  createAlertPlayer,
  createAudioDevicesAdapter,
  createAudioStatusAdapter,
  createInputMeter,
  pipewireSocketPath,
  type AudioDevicesAdapter,
  type AudioDevicesStatus,
  type AudioStatusAdapter,
  type InputMeter,
  type InputMeterState,
} from "@moire/audio";
import {
  dndScheduleActive,
  dndScheduleEnd,
  loadSettings,
  notificationRuleFor,
  updateSettings,
  type DoNotDisturbSchedule,
  type NotificationRules,
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
import {
  parseHiddenWifiRequest,
  parseProxyRequest,
  parseVpnId,
  parseVpnImportRequest,
  type WifiAdapter,
} from "@moire/system-management/network-status";
import { createNetworkManagerAdapter } from "./network-manager";
import { airplaneState, setAirplaneMode, type AirplaneMemory } from "./airplane-mode";
import { batterySupported, type BatteryAdapter } from "@moire/system-management/battery-status";
import { createUPowerBatteryAdapter } from "./upower-battery";
import {
  bluetoothSupported,
  bluetoothPairingBlocksConnections,
  bluetoothTrustBlocksControls,
  parseBluetoothAlias,
  parseBluetoothId,
  type BluetoothAdapter,
  type BluetoothPairingAdapter,
} from "@moire/system-management/bluetooth-status";
import { createBluezBluetoothAdapter } from "./bluez-bluetooth";

export type DesktopControlOptions = {
  audio?: AudioStatusAdapter;
  /** Every output and input, the default input's level, and apps playing. */
  audioDevices?: AudioDevicesAdapter;
  /** The input level meter, given where its peaks and state changes go. */
  inputMeter?: (callbacks: {
    onLevel: (level: number) => void;
    onState: (state: InputMeterState) => void;
  }) => InputMeter;
  /** Plays the notification alert; PipeWire's alert player when omitted. */
  alertSound?: () => void;
  wifi?: WifiAdapter;
  battery?: BatteryAdapter;
  bluetooth?: BluetoothAdapter;
  /** Separate injected capability. Omitted in production; Connect policy does not enable pairing. */
  bluetoothPairing?: BluetoothPairingAdapter;
  network?: () => readonly DesktopNetwork[];
  capabilities?: DesktopCapabilities;
  /** The manual Do not disturb switch. */
  readDoNotDisturb?: () => boolean;
  /** Per-app rules and the Do not disturb hours; read from prefs when omitted. */
  readNotificationPolicy?: () => {
    rules: NotificationRules;
    schedule: DoNotDisturbSchedule;
  };
  /** Wall clock for the schedule; injectable for smokes. */
  now?: () => Date;
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
/** PipeWire's socket is there: Sound can be offered before the first read completes. */
function pipewireRunning(): boolean {
  const socket = pipewireSocketPath();
  return !!socket && fs.existsSync(socket);
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
function soundId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 512 || /[\s\0-\x1f]/.test(value))
    throw new Error("Invalid sound device identity");
  return value;
}
function unitVolume(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
    throw new Error("Volume must be between 0 and 1");
  return value;
}
/** The devices adapter's state as the status snapshot carries it. */
function soundSnapshot(
  state: AudioDevicesStatus,
  meter: InputMeterState,
): DesktopStatusSnapshot["sound"] {
  if (state.kind === "loading") return { kind: "loading", message: "Reading sound devices" };
  if (state.kind !== "ready") return { kind: state.kind, message: state.message.slice(0, 1024) };
  return {
    kind: "ready",
    outputs: state.outputs,
    inputs: state.inputs,
    input: state.input
      ? { id: state.input.id, volume: state.input.volume, muted: state.input.muted }
      : null,
    streams: state.streams,
    meter,
  };
}
function wifiId(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 2048 || value.includes("\0"))
    throw new Error("Invalid Wi-Fi network identity");
  return value;
}

/** Extends the session service without changing system-bus policy or device permissions. */
export async function attachDesktopControls(bus: SessionBus, options: DesktopControlOptions = {}) {
  // One PipeWire connection serves both adapters.
  const control = options.audio && options.audioDevices ? null : new AudioControl();
  const audio = options.audio ?? createAudioStatusAdapter({ control: control! });
  const audioDevices = options.audioDevices ?? createAudioDevicesAdapter({ control: control! });
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
  const readNotificationPolicy =
    options.readNotificationPolicy ??
    (() => {
      const settings = loadSettings();
      return { rules: settings.notificationRules, schedule: settings.doNotDisturbSchedule };
    });
  const now = options.now ?? (() => new Date());
  const readNetwork = options.network ?? localAddresses;
  const report = options.onError ?? ((error: unknown) => console.warn("[desktop-controls]", error));
  const alertSound =
    options.alertSound ??
    (() => {
      const player = createAlertPlayer({
        onError: (message) => report(new Error(`Notification sound: ${message}`)),
      });
      return () => void player.play();
    })();
  let revision = 1,
    disposed = false,
    busy = false,
    refreshing = false;
  /**
   * Turning Do not disturb off while the schedule holds it on snoozes the schedule until its
   * window ends; held in memory, so a restart inside the window turns it back on.
   */
  let scheduleSnoozedUntil = 0;
  /** Do not disturb as it applies now: the switch, or the schedule unless snoozed. */
  const effectivePolicy = () => {
    const manual = readPolicy();
    let scheduled = false;
    try {
      const at = now();
      scheduled =
        dndScheduleActive(readNotificationPolicy().schedule, at) &&
        at.getTime() >= scheduleSnoozedUntil;
    } catch (error) {
      report(error);
    }
    return { on: manual || scheduled, scheduled: !manual && scheduled };
  };
  let network = readNetwork(),
    policy = effectivePolicy(),
    doNotDisturb = policy.on;
  let notifications: Awaited<ReturnType<typeof attachNotificationService>> | null = null;
  let notificationState: NotificationSnapshot = { active: [], history: [], doNotDisturb };
  const capabilities = options.capabilities ?? {
    audio: audio.state.kind === "ready" || pipewireRunning(),
    brightness: false,
    battery: false,
    bluetooth: false,
    power: false,
    notifications: false,
  };
  const airplaneMemory: AirplaneMemory = { restore: null };
  const airplaneSnapshot = () => {
    const airplane = airplaneState(wifi.state, bluetooth.state, !!bluetooth.setPowered);
    return airplane ? { airplane } : {};
  };
  /** Bluetooth writes wait while a pairing or trust outcome is pending or unknown. */
  const bluetoothSettled = () => {
    if (
      trustStarting ||
      bluetoothPairingBlocksConnections(pairing?.state) ||
      bluetoothTrustBlocksControls(bluetooth.state.trust)
    )
      throw new Error("Bluetooth pairing outcome pending or unknown");
  };
  const snapshot = (): DesktopStatusSnapshot => {
    const actual = audio.state;
    const notices: DesktopNotice[] = [
      ...[...notificationState.active].reverse().map((item) => ({
        id: item.id,
        revision: item.revision,
        appName: item.appName,
        appId: item.appId,
        banner: item.banner,
        sound: item.sound,
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
        appId: item.appId,
        banner: item.banner,
        sound: item.sound,
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
      sound: soundSnapshot(audioDevices.state, meter.state),
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
      doNotDisturbScheduled: policy.scheduled,
      notificationsAvailable: notifications != null,
      notices,
      ...airplaneSnapshot(),
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
  const meter = (options.inputMeter ?? createInputMeter)({
    onLevel: (level) => {
      if (disposed) return;
      bus.emitSignal({
        path: DESKTOP_STATUS_PATH,
        interface: DESKTOP_STATUS_INTERFACE,
        member: "InputLevel",
        signature: "d",
        body: [Math.min(1, Math.max(0, level))],
      });
    },
    onState: () => publish(),
  });
  let meterCaller: { caller: string; remove: DbusDisposer | null } | null = null;
  const meterScope = new AbortController();
  const releaseMeterCaller = async () => {
    const current = meterCaller;
    meterCaller = null;
    await current?.remove?.();
  };
  /** Sound changes: re-read the default output too, which Quick Settings and the slider follow. */
  const soundChange = async (work: () => Promise<AudioDevicesStatus>) => {
    const before = audioDevices.state;
    if (before.kind !== "ready")
      throw new Error(before.kind === "loading" ? "Sound is still loading" : before.message);
    const result = await work();
    await audio.refresh();
    if (result.kind !== "ready")
      throw new Error(result.kind === "loading" ? "Sound is still loading" : result.message);
  };
  const meterCall = (body: unknown[], sender: unknown) => {
    if (disposed) throw new Error("Desktop controls stopped");
    if (typeof sender !== "string" || !/^:[0-9]+\.[0-9]+$/.test(sender))
      throw new Error("Invalid input meter caller");
    if (expectedRevision(body[0]) > revision) throw new Error("Desktop status changed");
    return sender;
  };
  try {
    notifications = await attachNotificationService(bus, {
      onChange: (next) => {
        notificationState = next;
        publish();
      },
      onError: report,
      rule: (appId) => notificationRuleFor(readNotificationPolicy().rules, appId),
      sound: () => alertSound(),
      // Changed carries the actionable presentation to the existing session shell.
      present: options.notificationActions ? () => publish() : undefined,
    });
    notifications.setDoNotDisturb(doNotDisturb);
    notificationState = notifications.snapshot();
  } catch (error) {
    report(error);
  }
  const removeAudio = audio.subscribe(publish);
  const removeAudioDevices = audioDevices.subscribe(publish);
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
      SetDefaultSoundDevice: {
        inSignature: "uss",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            const kind = body[1];
            if (kind !== "output" && kind !== "input") throw new Error("Invalid sound device kind");
            return soundChange(() => audioDevices.setDefault(kind, soundId(body[2])));
          }),
      },
      SetInputVolume: {
        inSignature: "ud",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => soundChange(() => audioDevices.setInputVolume(unitVolume(body[1])))),
      },
      SetInputMute: {
        inSignature: "ub",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => soundChange(() => audioDevices.setInputMute(boolean(body[1])))),
      },
      SetStreamVolume: {
        inSignature: "usd",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () =>
            soundChange(() => audioDevices.setStreamVolume(soundId(body[1]), unitVolume(body[2]))),
          ),
      },
      SetStreamMute: {
        inSignature: "usb",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () =>
            soundChange(() => audioDevices.setStreamMute(soundId(body[1]), boolean(body[2]))),
          ),
      },
      StartInputMeter: {
        inSignature: "u",
        outSignature: "s",
        handler: async ({ body, message }) => {
          const caller = meterCall(body, message.sender);
          if (meterCaller?.caller !== caller) {
            meter.stop();
            await releaseMeterCaller();
            const observation = { caller, remove: null as DbusDisposer | null };
            meterCaller = observation;
            observation.remove = await bus.watchName(
              caller,
              (owner) => {
                if (owner === caller || meterCaller !== observation) return;
                meter.stop();
                void releaseMeterCaller().catch(report);
              },
              { signal: meterScope.signal, timeoutMs: 3000 },
            );
            if (meterCaller !== observation || disposed)
              throw new Error("Input meter caller disappeared");
          }
          meter.start();
          return { body: [JSON.stringify(snapshot())] };
        },
      },
      StopInputMeter: {
        inSignature: "u",
        outSignature: "s",
        handler: async ({ body, message }) => {
          const caller = meterCall(body, message.sender);
          if (meterCaller?.caller === caller) {
            meter.stop();
            await releaseMeterCaller();
          }
          return { body: [JSON.stringify(snapshot())] };
        },
      },
      SetDoNotDisturb: {
        inSignature: "ub",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            if (!notifications) throw new Error("Notification service unavailable");
            const value = boolean(body[1]);
            writePolicy(value);
            if (!value) {
              const at = now();
              scheduleSnoozedUntil =
                dndScheduleEnd(readNotificationPolicy().schedule, at) ?? scheduleSnoozedUntil;
            } else scheduleSnoozedUntil = 0;
            policy = effectivePolicy();
            doNotDisturb = policy.on;
            notifications.setDoNotDisturb(doNotDisturb);
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
      SetWifiEnabled: {
        inSignature: "ub",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            if (!wifi.setEnabled) throw new Error("Wi-Fi radio control unavailable");
            return wifi.setEnabled(boolean(body[1]));
          }),
      },
      DisconnectWifi: {
        inSignature: "u",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            if (!wifi.disconnect) throw new Error("Wi-Fi disconnect unavailable");
            return wifi.disconnect();
          }),
      },
      ForgetWifi: {
        inSignature: "us",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            if (!wifi.forget) throw new Error("Forgetting Wi-Fi networks unavailable");
            return wifi.forget(wifiId(body[1]));
          }),
      },
      ConnectHiddenWifi: {
        inSignature: "usss",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            if (!wifi.connectHidden) throw new Error("Joining hidden networks unavailable");
            return wifi.connectHidden(
              parseHiddenWifiRequest({ ssid: body[1], security: body[2], password: body[3] }),
            );
          }),
      },
      SetAirplaneMode: {
        inSignature: "ub",
        outSignature: "s",
        handler: ({ body }) => {
          bluetoothSettled();
          return operate(body, () =>
            setAirplaneMode(boolean(body[1]), wifi, bluetooth, airplaneMemory),
          );
        },
      },
      ActivateVpn: {
        inSignature: "us",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            if (!wifi.activateVpn) throw new Error("VPN controls unavailable");
            return wifi.activateVpn(parseVpnId(body[1]));
          }),
      },
      DeactivateVpn: {
        inSignature: "us",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            if (!wifi.deactivateVpn) throw new Error("VPN controls unavailable");
            return wifi.deactivateVpn(parseVpnId(body[1]));
          }),
      },
      RemoveVpn: {
        inSignature: "us",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            if (!wifi.removeVpn) throw new Error("VPN controls unavailable");
            return wifi.removeVpn(parseVpnId(body[1]));
          }),
      },
      ImportVpn: {
        inSignature: "usssss",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            if (!wifi.importVpn) throw new Error("VPN import unavailable");
            return wifi.importVpn(
              parseVpnImportRequest({
                kind: body[1],
                name: body[2],
                config: body[3],
                username: body[4],
                password: body[5],
              }),
            );
          }),
      },
      SetProxy: {
        inSignature: "usss",
        outSignature: "s",
        handler: ({ body }) =>
          operate(body, () => {
            if (!wifi.setProxy) throw new Error("Proxy controls unavailable");
            return wifi.setProxy(
              parseProxyRequest({ method: body[1], pacUrl: body[2], password: body[3] }),
            );
          }),
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
      SetBluetoothPowered: {
        inSignature: "usb",
        outSignature: "s",
        handler: ({ body }) => {
          if (
            trustStarting ||
            bluetoothPairingBlocksConnections(pairing?.state) ||
            bluetoothTrustBlocksControls(bluetooth.state.trust)
          )
            throw new Error("Bluetooth pairing outcome pending or unknown");
          return operate(body, () => {
            if (!bluetooth.setPowered) throw new Error("Bluetooth power control unavailable");
            return bluetooth.setPowered({
              adapterId: parseBluetoothId(body[1]),
              powered: boolean(body[2]),
            });
          });
        },
      },
      ForgetBluetoothDevice: {
        inSignature: "us",
        outSignature: "s",
        handler: ({ body }) => {
          if (
            trustStarting ||
            bluetoothPairingBlocksConnections(pairing?.state) ||
            bluetoothTrustBlocksControls(bluetooth.state.trust)
          )
            throw new Error("Bluetooth pairing outcome pending or unknown");
          return operate(body, () => {
            if (!bluetooth.forgetDevice)
              throw new Error("Forgetting Bluetooth devices unavailable");
            return bluetooth.forgetDevice({ id: parseBluetoothId(body[1]) });
          });
        },
      },
      RenameBluetoothDevice: {
        inSignature: "uss",
        outSignature: "s",
        handler: ({ body }) => {
          bluetoothSettled();
          return operate(body, () => {
            if (!bluetooth.renameDevice) throw new Error("Renaming Bluetooth devices unavailable");
            return bluetooth.renameDevice({
              id: parseBluetoothId(body[1]),
              name: parseBluetoothAlias(body[2]),
            });
          });
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
        nextPolicy = effectivePolicy();
      if (
        JSON.stringify(nextNetwork) !== JSON.stringify(network) ||
        nextPolicy.on !== policy.on ||
        nextPolicy.scheduled !== policy.scheduled
      ) {
        network = nextNetwork;
        policy = nextPolicy;
        doNotDisturb = nextPolicy.on;
        notifications?.setDoNotDisturb(nextPolicy.on);
        publish();
      }
      await audio.refresh();
      await audioDevices.refresh();
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
    meterScope.abort();
    await releaseCaller();
    await releaseTrustCaller();
    if (timer) clearInterval(timer);
    removeDisconnect();
    removeAudio();
    removeAudioDevices();
    meter.stop();
    await releaseMeterCaller();
    removeWifi();
    removeBattery();
    removeBluetooth();
    removePairing?.();
    unexport();
    audio.dispose();
    audioDevices.dispose();
    control?.close();
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
