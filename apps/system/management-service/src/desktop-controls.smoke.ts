import {
  BLUETOOTH_UNAVAILABLE,
  parseBluetoothId,
  parseDesktopBluetooth,
  type BluetoothAdapter,
  type DesktopBluetooth,
  type BluetoothChange,
  type BluetoothPairingAdapter,
  type BluetoothPairingState,
  type BluetoothDiscoveryRequest,
  type BluetoothLeaseRequest,
  type BluetoothPairRequest,
  type BluetoothCancelRequest,
  type BluetoothPromptRequest,
  type BluetoothTrustRequest,
  type BluetoothTrustConsent,
} from "@moire/system-management/bluetooth-status";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionBus } from "@moire/dbus";
import {
  createAudioStatusAdapter,
  type AudioReady,
  type AudioStatus,
  type AudioStatusAdapter,
} from "@moire/prefs";
import {
  DESKTOP_STATUS_BUS,
  DESKTOP_STATUS_INTERFACE,
  DESKTOP_STATUS_PATH,
  observeDesktopStatus,
  parseDesktopStatus,
  type DesktopStatusState,
  type DesktopStatusClient,
  type DesktopNetwork,
} from "@moire/system-management/desktop-status";
import { attachDesktopControls } from "./desktop-controls";
import { NOTIFICATIONS_BUS, NOTIFICATIONS_INTERFACE, NOTIFICATIONS_PATH } from "./notifications";
import {
  WIFI_UNAVAILABLE,
  parseDesktopWifi,
  type DesktopWifi,
  type WifiAdapter,
} from "@moire/system-management/network-status";
import {
  BATTERY_UNAVAILABLE,
  parseDesktopBattery,
  type DesktopBattery,
  type BatteryAdapter,
} from "@moire/system-management/battery-status";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, label: string) {
  const deadline = performance.now() + 4000;
  while (!check()) {
    if (performance.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await sleep(5);
  }
}
class AudioFixture implements AudioStatusAdapter {
  state: AudioStatus = {
    kind: "ready",
    sink: {
      backend: "wpctl",
      id: "4",
      identity: "fixture:4",
      name: "Fixture",
      description: "Observed fixture output",
    },
    volume: 0.4,
    muted: false,
  };
  listeners = new Set<(state: AudioStatus) => void>();
  writes = 0;
  disposed = false;
  pending: (() => void) | null = null;
  hold = false;
  subscribe(fn: (state: AudioStatus) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  publish(state: AudioStatus) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
  async refresh() {
    return this.state;
  }
  async setVolume(expected: AudioReady, volume: number) {
    assert.equal(expected, this.state, "server uses actual adapter snapshot");
    this.writes++;
    if (this.hold)
      await new Promise<void>((resolve) => {
        this.pending = resolve;
      });
    this.publish({ ...expected, volume });
    return this.state;
  }
  async setMute(expected: AudioReady, muted: boolean) {
    assert.equal(expected, this.state);
    this.writes++;
    this.publish({ ...expected, muted });
    return this.state;
  }
  release() {
    assert(this.pending);
    this.pending();
    this.pending = null;
  }
  dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
}
class BluetoothFixture implements BluetoothAdapter {
  state: DesktopBluetooth = BLUETOOTH_UNAVAILABLE;
  listeners = new Set<() => void>();
  requests: BluetoothChange[] = [];
  disposed = false;
  hold = false;
  release: (() => void) | null = null;
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  publish(state: DesktopBluetooth) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  async refresh() {}
  async setConnected(request: BluetoothChange) {
    if (this.state.status.kind !== "ready" || this.state.status.policy !== "interactive")
      throw new Error("Bluetooth is read-only");
    if (this.state.operation.kind === "pending" || this.state.operation.kind === "unknown")
      throw new Error("Bluetooth outcome pending or unknown");
    const device = this.state.status.devices.find((device) => device.id === request.id);
    if (
      !device ||
      (request.connected ? !device.trusted : !device.connected) ||
      !this.state.status.adapters.some(
        (adapter) => adapter.id === device.adapterId && adapter.powered,
      )
    )
      throw new Error("Bluetooth device ineligible");
    this.requests.push(request);
    this.publish({ ...this.state, operation: { kind: "pending", ...request } });
    if (this.hold)
      await new Promise<void>((resolve) => {
        this.release = resolve;
      });
    if (this.state.status.kind !== "ready") throw new Error("Bluetooth unavailable");
    this.publish({
      ...this.state,
      status: {
        ...this.state.status,
        devices: this.state.status.devices.map((device) =>
          device.id === request.id ? { ...device, connected: request.connected } : device,
        ),
      },
      operation: { kind: "idle" },
    });
  }
  trustCaller = "";
  trustWrites = 0;
  trustLost = 0;
  async requestTrust(request: BluetoothTrustRequest) {
    assert(this.state.trust?.kind === "ready" && this.state.trust.operation.kind === "idle");
    this.trustCaller = request.caller;
    this.publish({
      ...this.state,
      trust: {
        kind: "ready",
        operation: {
          kind: "confirmation",
          id: request.id,
          trusted: request.trusted,
          challengeId: parseBluetoothId("service-consent"),
          expiresAt: Date.now() + 30000,
        },
      },
    });
  }
  trustConsent(request: BluetoothTrustConsent) {
    const trust = this.state.trust;
    if (
      request.caller !== this.trustCaller ||
      trust?.kind !== "ready" ||
      trust.operation.kind !== "confirmation" ||
      trust.operation.challengeId !== request.challengeId
    )
      throw new Error("Bluetooth trust consent changed");
    return trust.operation;
  }
  async confirmTrust(request: BluetoothTrustConsent) {
    const consent = this.trustConsent(request);
    assert(this.state.status.kind === "ready");
    this.trustWrites++;
    this.publish({
      ...this.state,
      status: {
        ...this.state.status,
        devices: this.state.status.devices.map((d) =>
          d.id === consent.id ? { ...d, trusted: consent.trusted } : d,
        ),
      },
      trust: { kind: "ready", operation: { kind: "idle" } },
    });
  }
  async cancelTrust(request: BluetoothTrustConsent) {
    this.trustConsent(request);
    this.publish({ ...this.state, trust: { kind: "ready", operation: { kind: "idle" } } });
  }
  async trustCallerLost(caller: string) {
    if (caller !== this.trustCaller) return;
    this.trustLost++;
    if (this.state.trust?.kind === "ready" && this.state.trust.operation.kind === "confirmation")
      this.publish({ ...this.state, trust: { kind: "ready", operation: { kind: "idle" } } });
  }
  async dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
}
class BatteryFixture implements BatteryAdapter {
  state: DesktopBattery = BATTERY_UNAVAILABLE;
  listeners = new Set<() => void>();
  reads = 0;
  disposed = false;
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  publish(state: DesktopBattery) {
    if (this.disposed || JSON.stringify(this.state) === JSON.stringify(state)) return;
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  async refresh() {
    this.reads++;
  }
  async dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
}
class PairingFixture implements BluetoothPairingAdapter {
  state: BluetoothPairingState = {
    kind: "ready",
    adapters: [
      { id: parseBluetoothId("pair-adapter"), name: "Private pairing adapter", powered: true },
    ],
    devices: [
      {
        id: parseBluetoothId("pair-device"),
        adapterId: parseBluetoothId("pair-adapter"),
        name: "Private nearby device",
        address: "02:00:00:00:00:08",
        paired: false,
      },
    ],
    lease: null,
    discovery: "idle",
    attempt: { kind: "idle" },
    prompt: null,
    message: "",
  };
  listeners = new Set<() => void>();
  caller = "";
  responses: BluetoothPromptRequest[] = [];
  starts = 0;
  lost = 0;
  disposed = false;
  serial = 0;
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
  publish(next: BluetoothPairingState) {
    this.state = next;
    for (const fn of this.listeners) fn();
  }
  ready() {
    assert(this.state.kind === "ready");
    return this.state;
  }
  owns(request: BluetoothLeaseRequest) {
    const state = this.ready();
    if (request.caller !== this.caller || state.lease?.id !== request.leaseId)
      throw new Error("Pairing owner/lease changed");
    return state;
  }
  async startDiscovery(request: BluetoothDiscoveryRequest) {
    const state = this.ready();
    if (
      state.lease ||
      state.attempt.kind === "unknown" ||
      !state.adapters.some((a) => a.id === request.adapterId && a.powered)
    )
      throw new Error("Unavailable pairing adapter");
    this.caller = request.caller;
    this.starts++;
    this.publish({
      ...state,
      discovery: "scanning",
      lease: {
        id: parseBluetoothId(`pair-lease-${++this.serial}`),
        adapterId: request.adapterId,
        expiresAt: Date.now() + 30000,
      },
      attempt: { kind: "idle" },
      prompt: null,
    });
  }
  async stopDiscovery(request: BluetoothLeaseRequest) {
    const state = this.owns(request);
    this.publish({
      ...state,
      lease: null,
      discovery: "stopped",
      prompt: null,
      attempt:
        state.attempt.kind === "pending"
          ? { ...state.attempt, kind: "canceled", message: "Closed" }
          : state.attempt,
    });
  }
  async beginPair(request: BluetoothPairRequest) {
    const state = this.owns(request),
      device = state.devices.find((d) => d.id === request.deviceId);
    if (!device || state.attempt.kind === "pending") throw new Error("Pairing device changed");
    const id = parseBluetoothId(`pair-attempt-${++this.serial}`);
    this.publish({
      ...state,
      attempt: { kind: "pending", id, device },
      prompt: {
        kind: "confirmation",
        id: parseBluetoothId(`pair-prompt-${++this.serial}`),
        attemptId: id,
        deviceId: device.id,
        code: "000042",
      },
    });
  }
  async cancel(request: BluetoothCancelRequest) {
    const state = this.owns(request);
    if (state.attempt.kind !== "pending" || state.attempt.id !== request.attemptId)
      throw new Error("Pairing attempt changed");
    this.publish({
      ...state,
      attempt: { ...state.attempt, kind: "canceled", message: "Canceled" },
      prompt: null,
    });
  }
  async respond(request: BluetoothPromptRequest) {
    const state = this.owns(request);
    if (
      state.attempt.kind !== "pending" ||
      state.attempt.id !== request.attemptId ||
      state.prompt?.id !== request.promptId
    )
      throw new Error("Pairing prompt changed");
    this.responses.push(request);
    this.publish({
      ...state,
      attempt: {
        ...state.attempt,
        kind: request.accepted ? "complete" : "canceled",
        message: request.accepted ? "Observed paired; trust unchanged" : "Rejected",
      },
      prompt: null,
    });
  }
  async callerLost(caller: string) {
    if (caller !== this.caller || !this.ready().lease) return;
    this.lost++;
    await this.stopDiscovery({ caller, leaseId: this.ready().lease!.id });
  }
  async dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
}
class WifiFixture implements WifiAdapter {
  state: DesktopWifi = WIFI_UNAVAILABLE;
  listeners = new Set<() => void>();
  requests: { id: string; password: string }[] = [];
  reads = 0;
  scans = 0;
  cancellations = 0;
  disposed = false;
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  publish(state: DesktopWifi) {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
  async refresh() {
    this.reads++;
  }
  async scan() {
    assert(this.state.kind === "ready" && this.state.canScan);
    this.scans++;
  }
  async connect(request: { id: string; password: string }) {
    assert(this.state.kind === "ready" && this.state.canConnect);
    this.requests.push(request);
    this.publish({
      ...this.state,
      operation: { kind: "connecting", ssid: "Fixture Wi-Fi", cancellable: true },
    });
  }
  async cancel() {
    assert(
      this.state.kind === "ready" &&
        this.state.operation.kind === "connecting" &&
        this.state.operation.cancellable,
    );
    this.cancellations++;
    this.publish({ ...this.state, operation: { kind: "idle" } });
  }
  async dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
}
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "moire-controls-"));
const daemon = spawn(
  "dbus-daemon",
  [
    "--session",
    "--nofork",
    "--nopidfile",
    `--address=unix:path=${path.join(directory, "bus")}`,
    "--print-address=1",
  ],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const exited = once(daemon, "exit");
let address = "",
  daemonError: Error | null = null,
  stderr = "";
daemon.stdout.on("data", (bytes) => {
  address += bytes.toString();
});
daemon.stderr.on("data", (bytes) => {
  stderr += bytes.toString();
});
daemon.on("error", (error) => {
  daemonError = error;
});
const buses: SessionBus[] = [],
  observers: DesktopStatusClient[] = [];
let controls: Awaited<ReturnType<typeof attachDesktopControls>> | null = null;
const errors: unknown[] = [];
try {
  await until(
    () => address.includes("\n") || daemonError !== null || daemon.exitCode !== null,
    "private bus",
  );
  if (daemonError) throw daemonError;
  assert(address.startsWith("unix:"), stderr);
  async function connect() {
    const bus = await SessionBus.connect(address.trim());
    buses.push(bus);
    return bus;
  }
  const server = await connect(),
    client = await connect(),
    producer = await connect(),
    intruder = await connect();
  assert.equal(await server.requestName(DESKTOP_STATUS_BUS, 4), 1);
  const serverName = server.name;
  assert(serverName);
  const audio = new AudioFixture();
  const wifi = new WifiFixture();
  const battery = new BatteryFixture();
  const bluetooth = new BluetoothFixture();
  const pairing = new PairingFixture();
  let dnd = false,
    policyWrites = 0,
    network: readonly DesktopNetwork[] = [
      { name: "eth0", transport: "wired", addresses: ["192.0.2.3"] },
    ];
  controls = await attachDesktopControls(server, {
    audio,
    wifi,
    battery,
    bluetooth,
    bluetoothPairing: pairing,
    pollMs: 0,
    network: () => network,
    readDoNotDisturb: () => dnd,
    writeDoNotDisturb: (value) => {
      dnd = value;
      policyWrites++;
    },
    onError: (error) => errors.push(error),
  });
  const events: DesktopStatusState[] = [];
  const observer = await observeDesktopStatus(client, (state) => events.push(state));
  observers.push(observer);
  await until(() => observer.state.kind === "ready", "actual GetStatus");
  function status() {
    const state = observer.state;
    assert.equal(state.kind, "ready");
    if (state.kind !== "ready") throw new Error("not ready");
    return state.snapshot;
  }
  console.log("[desktop-controls] initial status ready");
  assert.deepEqual(status().network, network);
  assert.equal(status().notificationsAvailable, true);
  assert.deepEqual(
    status().capabilities,
    {
      audio: true,
      brightness: false,
      battery: false,
      bluetooth: false,
      power: false,
      notifications: true,
    },
    "backend support separate from actual output readiness",
  );
  assert.deepEqual(status().audio, {
    kind: "ready",
    volume: 0.4,
    muted: false,
    name: "Observed fixture output",
  });
  assert.deepEqual(status().wifi, WIFI_UNAVAILABLE);
  assert.deepEqual(status().battery, BATTERY_UNAVAILABLE);
  assert.deepEqual(status().bluetooth, { ...BLUETOOTH_UNAVAILABLE, pairing: pairing.state });
  const adapterId = parseBluetoothId("adapter:private"),
    deviceId = parseBluetoothId("device:private");
  const knownBluetooth: DesktopBluetooth = {
    status: {
      kind: "ready",
      policy: "interactive",
      adapters: [{ id: adapterId, name: "Private Bluetooth", powered: true }],
      devices: [
        {
          id: deviceId,
          adapterId,
          name: "Private paired device",
          address: "02:00:00:00:00:01",
          paired: true,
          trusted: true,
          connected: false,
        },
      ],
    },
    operation: { kind: "idle" },
  };
  assert.equal(parseDesktopBluetooth(knownBluetooth).status.kind, "ready");
  for (const malformed of [
    {
      status: { kind: "ready", policy: "interactive", adapters: [], devices: [] },
      operation: { kind: "idle" },
    },
    { ...knownBluetooth, operation: { kind: "pending", id: deviceId, connected: "yes" } },
    {
      status: { kind: "error", supported: "yes", message: "invalid" },
      operation: { kind: "idle" },
    },
  ])
    assert.throws(
      () => parseDesktopStatus(JSON.stringify({ ...status(), bluetooth: malformed })),
      /Bluetooth/,
    );
  bluetooth.publish(knownBluetooth);
  await until(() => status().bluetooth.status.kind === "ready", "known Bluetooth status");
  assert.equal(status().capabilities.bluetooth, true);
  const capturedBluetooth = {
    owner: observer.state.kind === "ready" ? observer.state.owner : "",
    revision: status().revision,
    id: deviceId,
    connected: true,
  };
  bluetooth.publish({
    ...knownBluetooth,
    status: {
      ...knownBluetooth.status,
      kind: "error",
      supported: true,
      message: "Private transient read failure",
    },
  });
  await until(() => status().bluetooth.status.kind === "error", "Bluetooth invalidates old status");
  await assert.rejects(observer.setBluetoothConnected(capturedBluetooth), /changed/);
  assert.equal(bluetooth.requests.length, 0);
  bluetooth.publish(knownBluetooth);
  await until(() => status().bluetooth.status.kind === "ready", "Bluetooth recovered");
  await assert.rejects(
    client.call({
      destination: server.name,
      path: DESKTOP_STATUS_PATH,
      interface: DESKTOP_STATUS_INTERFACE,
      member: "SetBluetoothConnected",
      signature: "usb",
      body: [capturedBluetooth.revision, deviceId, true],
    }),
    /changed/,
  );
  assert.equal(bluetooth.requests.length, 0, "stale wire revision cannot write Bluetooth");
  const fastBluetooth = await observeDesktopStatus(client, () => {}, { actionTimeoutMs: 25 });
  observers.push(fastBluetooth);
  await until(() => fastBluetooth.state.kind === "ready", "Bluetooth timeout observer");
  bluetooth.hold = true;
  const beforeConnect = status().revision;
  const bluetoothResult = fastBluetooth
    .setBluetoothConnected({
      owner: server.name,
      revision: beforeConnect,
      id: deviceId,
      connected: true,
    })
    .then(
      () => false,
      () => true,
    );
  await until(
    () => bluetooth.release !== null && status().updating,
    "Bluetooth held observed operation",
  );
  const duringBluetooth = status().bluetooth;
  assert(duringBluetooth.status.kind === "ready");
  assert.equal(
    duringBluetooth.status.devices[0]?.connected,
    false,
    "request is not an observed connection",
  );
  assert.equal(await bluetoothResult, true, "client deadline cannot undo the service operation");
  await assert.rejects(
    observer.setBluetoothConnected({
      owner: server.name,
      revision: status().revision,
      id: deviceId,
      connected: true,
    }),
    /unavailable|updating/,
  );
  assert.equal(bluetooth.requests.length, 1, "deadline does not allow duplicate operation");
  assert(bluetooth.release);
  bluetooth.release();
  bluetooth.release = null;
  bluetooth.hold = false;
  await until(() => {
    const current = status();
    return (
      !current.updating &&
      current.bluetooth.status.kind === "ready" &&
      current.bluetooth.status.devices[0]?.connected === true
    );
  }, "Bluetooth late observed outcome");
  await observer.setBluetoothConnected({
    owner: server.name,
    revision: status().revision,
    id: deviceId,
    connected: false,
  });
  await until(() => {
    const current = status();
    return (
      !current.updating &&
      current.bluetooth.status.kind === "ready" &&
      current.bluetooth.status.devices[0]?.connected === false
    );
  }, "Bluetooth disconnect observed");
  const disconnected = bluetooth.state;
  assert(disconnected.status.kind === "ready");
  bluetooth.publish({ ...disconnected, status: { ...disconnected.status, policy: "readonly" } });
  await until(() => {
    const current = status().bluetooth.status;
    return current.kind === "ready" && current.policy === "readonly";
  }, "Bluetooth read-only policy");
  const requestsBeforeReadonly = bluetooth.requests.length;
  await assert.rejects(
    observer.setBluetoothConnected({
      owner: server.name,
      revision: status().revision,
      id: deviceId,
      connected: true,
    }),
    /unavailable/,
  );
  await assert.rejects(
    client.call({
      destination: server.name,
      path: DESKTOP_STATUS_PATH,
      interface: DESKTOP_STATUS_INTERFACE,
      member: "SetBluetoothConnected",
      signature: "usb",
      body: [status().revision, deviceId, true],
    }),
    /read-only/,
  );
  assert.equal(bluetooth.requests.length, requestsBeforeReadonly);
  await observer.refreshBluetooth();
  bluetooth.publish(BLUETOOTH_UNAVAILABLE);
  await until(
    () => status().bluetooth.status.kind === "unavailable" && !status().capabilities.bluetooth,
    "Bluetooth missing backend truthful",
  );
  console.log(
    "[desktop-controls] Bluetooth private adapter/service/client: parser, observation, stale revision, read-only, pending timeout and late readback passed",
  );
  const pairState = () => {
    const current = status().bluetooth.pairing;
    assert(current?.kind === "ready");
    return current;
  };
  const observedIntent = () => ({ owner: serverName, revision: status().revision });
  const pairAdapter = pairState().adapters[0]!.id;
  await observer.startBluetoothDiscovery({ ...observedIntent(), adapterId: pairAdapter });
  assert.equal(pairing.caller, client.name, "session caller identity reaches owned backend");
  const firstLease = pairState().lease!.id;
  await assert.rejects(
    observer.startBluetoothDiscovery({ ...observedIntent(), adapterId: pairAdapter }),
    /unavailable/,
  );
  await observer.beginBluetoothPair({
    ...observedIntent(),
    leaseId: firstLease,
    deviceId: pairState().devices[0]!.id,
  });
  assert.equal(
    pairState().attempt.kind,
    "pending",
    "BeginPair returns with pending state instead of holding service busy",
  );
  bluetooth.publish(knownBluetooth);
  await until(
    () => status().bluetooth.status.kind === "ready",
    "known device while separate pairing pending",
  );
  const knownWrites = bluetooth.requests.length;
  await assert.rejects(
    observer.setBluetoothConnected({ ...observedIntent(), id: deviceId, connected: true }),
    /pairing outcome/,
  );
  await assert.rejects(
    client.call({
      destination: serverName,
      path: DESKTOP_STATUS_PATH,
      interface: DESKTOP_STATUS_INTERFACE,
      member: "SetBluetoothConnected",
      signature: "usb",
      body: [status().revision, deviceId, true],
    }),
    /pairing outcome/,
  );
  assert.equal(
    bluetooth.requests.length,
    knownWrites,
    "pending pairing blocks client and direct wire Connect",
  );
  const firstPrompt = pairState().prompt!;
  await assert.rejects(
    intruder.call({
      destination: serverName,
      path: DESKTOP_STATUS_PATH,
      interface: DESKTOP_STATUS_INTERFACE,
      member: "RespondBluetoothPrompt",
      signature: "usssb",
      body: [status().revision, firstLease, firstPrompt.attemptId, firstPrompt.id, true],
    }),
    /owner/,
  );
  assert.equal(
    pairing.responses.length,
    0,
    "another session caller cannot approve a visible prompt",
  );
  await observer.respondBluetoothPrompt({
    ...observedIntent(),
    leaseId: firstLease,
    attemptId: firstPrompt.attemptId,
    promptId: firstPrompt.id,
    accepted: false,
  });
  assert.equal(pairState().attempt.kind, "canceled");
  await assert.rejects(
    observer.respondBluetoothPrompt({
      ...observedIntent(),
      leaseId: firstLease,
      attemptId: firstPrompt.attemptId,
      promptId: firstPrompt.id,
      accepted: true,
    }),
    /changed/,
  );
  await observer.beginBluetoothPair({
    ...observedIntent(),
    leaseId: firstLease,
    deviceId: pairState().devices[0]!.id,
  });
  const nextPrompt = pairState().prompt!;
  await assert.rejects(
    client.call({
      destination: serverName,
      path: DESKTOP_STATUS_PATH,
      interface: DESKTOP_STATUS_INTERFACE,
      member: "RespondBluetoothPrompt",
      signature: "usssb",
      body: [status().revision, firstLease, firstPrompt.attemptId, firstPrompt.id, true],
    }),
    /changed/,
  );
  audio.hold = true;
  const promptRevision = status().revision;
  const heldAudio = observer.setVolume(0.45);
  await until(() => status().updating, "audio deliberately holds existing global lock");
  await client.call({
    destination: serverName,
    path: DESKTOP_STATUS_PATH,
    interface: DESKTOP_STATUS_INTERFACE,
    member: "RespondBluetoothPrompt",
    signature: "usssb",
    body: [promptRevision, firstLease, nextPrompt.attemptId, nextPrompt.id, true],
  });
  await until(
    () => pairState().attempt.kind === "complete",
    "same live consent remains dispatchable across unrelated status revisions",
  );
  assert.equal(
    pairState().attempt.kind,
    "complete",
    "consent dispatchable while unrelated control is pending",
  );
  audio.release();
  audio.hold = false;
  await heldAudio;
  await observer.setVolume(0.4);
  await observer.beginBluetoothPair({
    ...observedIntent(),
    leaseId: firstLease,
    deviceId: pairState().devices[0]!.id,
  });
  const pending = pairState().attempt;
  assert(pending.kind === "pending");
  await observer.cancelBluetoothPair({
    ...observedIntent(),
    leaseId: firstLease,
    attemptId: pending.id,
  });
  assert.equal(pairState().attempt.kind, "canceled");
  await observer.stopBluetoothDiscovery({ ...observedIntent(), leaseId: firstLease });
  assert.equal(pairState().lease, null);
  const callerBus = await connect();
  const callerObserver = await observeDesktopStatus(callerBus, () => {});
  observers.push(callerObserver);
  await until(() => callerObserver.state.kind === "ready", "temporary pairing client");
  await callerObserver.startBluetoothDiscovery({ ...observedIntent(), adapterId: pairAdapter });
  callerBus.close();
  await until(
    () => pairing.lost === 1 && pairState().lease === null,
    "initiating session caller loss cleans discovery",
  );
  await assert.rejects(
    observer.stopBluetoothDiscovery({ ...observedIntent(), leaseId: firstLease }),
    /changed/,
  );
  assert(knownBluetooth.status.kind === "ready");
  bluetooth.publish({
    ...knownBluetooth,
    status: {
      ...knownBluetooth.status,
      devices: knownBluetooth.status.devices.map((d) => ({
        ...d,
        trusted: false,
        connected: true,
      })),
    },
    trust: { kind: "ready", operation: { kind: "idle" } },
  });
  await until(() => status().bluetooth.trust?.kind === "ready", "trust capability observation");
  const trustState = () => {
    const t = status().bluetooth.trust;
    assert(t?.kind === "ready");
    return t;
  };
  await observer.requestBluetoothTrust({ ...observedIntent(), id: deviceId, trusted: true });
  assert.equal(bluetooth.trustWrites, 0, "request only presents consent");
  const challenge = trustState().operation;
  assert(challenge.kind === "confirmation");
  await assert.rejects(
    intruder.call({
      destination: server.name,
      path: DESKTOP_STATUS_PATH,
      interface: DESKTOP_STATUS_INTERFACE,
      member: "ConfirmBluetoothTrust",
      signature: "us",
      body: [status().revision, challenge.challengeId],
    }),
    /consent changed/,
  );
  await assert.rejects(
    observer.setBluetoothConnected({ ...observedIntent(), id: deviceId, connected: false }),
    /pending|unavailable/,
  );
  await assert.rejects(
    observer.startBluetoothDiscovery({ ...observedIntent(), adapterId: pairAdapter }),
    /trust outcome/,
  );
  await observer.setVolume(0.41);
  await observer.confirmBluetoothTrust({ ...observedIntent(), challengeId: challenge.challengeId });
  assert.equal(bluetooth.trustWrites, 1);
  await assert.rejects(
    observer.confirmBluetoothTrust({ ...observedIntent(), challengeId: challenge.challengeId }),
    /consent changed/,
  );
  await observer.requestBluetoothTrust({ ...observedIntent(), id: deviceId, trusted: false });
  const revoke = trustState().operation;
  assert(revoke.kind === "confirmation");
  await observer.confirmBluetoothTrust({ ...observedIntent(), challengeId: revoke.challengeId });
  const revoked = status().bluetooth.status;
  assert(revoked.kind === "ready");
  assert.equal(revoked.devices[0]!.connected, true, "removing trust alone never disconnects");
  assert.equal(revoked.devices[0]!.trusted, false);
  await observer.setBluetoothConnected({ ...observedIntent(), id: deviceId, connected: false });
  await assert.rejects(
    observer.setBluetoothConnected({ ...observedIntent(), id: deviceId, connected: true }),
    /eligible/,
  );
  await observer.requestBluetoothTrust({ ...observedIntent(), id: deviceId, trusted: true });
  const canceledTrust = trustState().operation;
  assert(canceledTrust.kind === "confirmation");
  await observer.cancelBluetoothTrust({
    ...observedIntent(),
    challengeId: canceledTrust.challengeId,
  });
  assert.equal(bluetooth.trustWrites, 2, "Cancel never mutates trust");
  const trustBus = await connect();
  const trustObserver = await observeDesktopStatus(trustBus, () => {});
  observers.push(trustObserver);
  await until(() => trustObserver.state.kind === "ready", "temporary trust client");
  await trustObserver.requestBluetoothTrust({ ...observedIntent(), id: deviceId, trusted: true });
  trustBus.close();
  await until(
    () => bluetooth.trustLost === 1 && trustState().operation.kind === "idle",
    "session caller loss retires trust consent",
  );
  assert.equal(bluetooth.trustWrites, 2);
  console.log(
    "[desktop-controls] explicit trust: session caller, foreign/reused consent, revision drift, cancel/caller loss, independent control block and post-revoke Disconnect passed",
  );
  bluetooth.publish(BLUETOOTH_UNAVAILABLE);
  await until(
    () => status().bluetooth.status.kind === "unavailable",
    "restore unavailable known status after pairing fixture",
  );
  console.log(
    "[desktop-controls] pairing source private-bus: independent capability, session caller, pending dispatch, explicit rejection/acceptance, reused/stale prompts, cancel/stop and caller loss passed",
  );
  const observedBattery: Extract<DesktopBattery, { kind: "ready" }> = {
    kind: "ready",
    source: "battery",
    percentage: 64.5,
    chargeState: "charging",
    onBattery: false,
    warningLevel: "none",
    timeToEmptySeconds: null,
    timeToFullSeconds: 2400,
  };
  for (const malformed of [
    null,
    { ...observedBattery, percentage: -1 },
    { ...observedBattery, percentage: 101 },
    { ...observedBattery, percentage: NaN },
    { ...observedBattery, chargeState: "powered" },
    { ...observedBattery, source: "mouse" },
    { ...observedBattery, warningLevel: "panic" },
    { ...observedBattery, onBattery: 1 },
    { ...observedBattery, timeToFullSeconds: 0 },
    { ...observedBattery, timeToEmptySeconds: -1 },
    { ...observedBattery, timeToEmptySeconds: Number.MAX_SAFE_INTEGER + 1 },
    { kind: "error", message: "fixture", supported: "yes" },
  ]) {
    assert.throws(() => parseDesktopBattery(malformed), /battery/);
    assert.throws(
      () => parseDesktopStatus(JSON.stringify({ ...status(), battery: malformed })),
      /battery/,
    );
  }
  const capturedBatteryRevision = status().revision;
  battery.publish(observedBattery);
  await until(() => status().battery.kind === "ready", "observed battery reaches client");
  assert.deepEqual(status().battery, observedBattery);
  assert.equal(status().capabilities.battery, true);
  assert.equal(status().revision, capturedBatteryRevision + 1);
  await assert.rejects(
    client.call({
      destination: serverName,
      path: DESKTOP_STATUS_PATH,
      interface: DESKTOP_STATUS_INTERFACE,
      member: "SetDoNotDisturb",
      signature: "ub",
      body: [capturedBatteryRevision, true],
    }),
    /changed/,
  );
  assert.equal(policyWrites, 0, "stale action cannot ignore a battery revision change");
  const stableBatteryRevision = status().revision;
  battery.publish({ ...observedBattery });
  await controls.refresh();
  assert.equal(status().revision, stableBatteryRevision, "unchanged battery poll preserves intent");
  for (const kind of ["loading", "error"] as const) {
    battery.publish({ kind, supported: true, message: "Reading fixture battery" });
    await until(() => status().battery.kind === kind, "battery transient publication");
    assert.equal(status().capabilities.battery, true);
    assert.equal("percentage" in status().battery, false, "no stale numeric battery observation");
  }
  battery.publish({
    ...observedBattery,
    source: "ups",
    chargeState: "discharging",
    onBattery: true,
    warningLevel: "low",
    timeToEmptySeconds: 540,
    timeToFullSeconds: null,
  });
  await until(() => {
    const actual = status().battery;
    return actual.kind === "ready" && actual.source === "ups";
  }, "UPS readback reaches client");
  battery.publish(BATTERY_UNAVAILABLE);
  await until(() => status().battery.kind === "unavailable", "battery withdrawal");
  assert.equal(status().capabilities.battery, false);
  console.log(
    "[desktop-controls] battery wire/client, strict boundary, observed capability, stable poll, transient data removal and UPS withdrawal passed; no power action",
  );
  const readyWifi: Extract<DesktopWifi, { kind: "ready" }> = {
    kind: "ready",
    policy: "interactive",
    enabled: true,
    hardwareEnabled: true,
    canConnect: true,
    canScan: true,
    connectivity: "limited",
    connection: { kind: "none" },
    accessPoints: [
      {
        id: "fixture-ap",
        ssid: "Fixture Wi-Fi",
        strength: 70,
        security: "wpa-psk",
        connected: false,
      },
    ],
    operation: { kind: "idle" },
  };
  for (const malformed of [
    null,
    { ...readyWifi, connectivity: "online" },
    { ...readyWifi, policy: "readonly" },
    { ...readyWifi, accessPoints: [readyWifi.accessPoints[0], readyWifi.accessPoints[0]] },
    { ...readyWifi, operation: { kind: "connecting", ssid: "Fixture", cancellable: "yes" } },
    { ...readyWifi, connection: { kind: "active", name: "Fixture", transport: "Internet" } },
  ])
    assert.throws(() => parseDesktopWifi(malformed));
  const capturedNetworkRevision = status().revision;
  wifi.publish(readyWifi);
  await until(() => status().wifi.kind === "ready", "network adapter reaches desktop client");
  await assert.rejects(
    client.call({
      destination: serverName,
      path: DESKTOP_STATUS_PATH,
      interface: DESKTOP_STATUS_INTERFACE,
      member: "ConnectWifi",
      signature: "uss",
      body: [capturedNetworkRevision, "fixture-ap", "fixture-only-password"],
    }),
    /changed/,
  );
  assert.equal(
    wifi.requests.length,
    0,
    "stale desktop intent cannot transmit a password to adapter",
  );
  await observer.refreshWifi();
  await until(() => !status().updating, "scan request settled");
  assert.equal(wifi.scans, 1);
  await observer.connectWifi("fixture-ap", "fixture-only-password");
  await until(() => !status().updating, "activation request acknowledged");
  assert.deepEqual(wifi.requests, [{ id: "fixture-ap", password: "fixture-only-password" }]);
  const pendingWifi = status().wifi;
  assert(pendingWifi.kind === "ready" && pendingWifi.operation.kind === "connecting");
  assert.equal(
    pendingWifi.connection.kind,
    "none",
    "method reply is not a connection-success claim",
  );
  assert(
    !JSON.stringify(status()).includes("fixture-only-password"),
    "secret never enters status JSON",
  );
  await observer.cancelWifi();
  await until(() => !status().updating, "owned cancellation settled");
  assert.equal(wifi.cancellations, 1);
  wifi.publish({ ...readyWifi, policy: "readonly", canConnect: false, canScan: false });
  await until(() => {
    const observed = status().wifi;
    return observed.kind === "ready" && observed.policy === "readonly";
  }, "read-only policy publication");
  const reads = wifi.reads;
  await observer.refreshWifi();
  await until(() => !status().updating, "read-only status refresh settled");
  assert.equal(wifi.scans, 1, "read-only refresh never calls radio scan");
  assert.equal(wifi.reads, reads + 1);
  wifi.publish(WIFI_UNAVAILABLE);
  await until(() => status().wifi.kind === "unavailable", "network unsupported again");
  console.log(
    "[desktop-controls] Wi-Fi wire/client, stale request, transient activation, cancellation, read-only refresh and secret exclusion passed",
  );
  const initialAudio = audio.state;
  const transientAudio: AudioStatus[] = [
    { kind: "loading" },
    { kind: "unavailable", message: "No running audio server" },
    { kind: "error", reason: "command", message: "Audio backend read failed" },
  ];
  for (const actual of transientAudio) {
    audio.publish(actual);
    await until(() => status().audio.kind === actual.kind, "published actual audio transient");
    assert.equal(
      status().capabilities.audio,
      true,
      "declared backend support survives actual server/output failure",
    );
    const beforeWrites = audio.writes;
    await assert.rejects(observer.setVolume(0.6));
    assert.equal(
      audio.writes,
      beforeWrites,
      "unsupported current output never receives write despite declared capability",
    );
  }
  audio.publish(initialAudio);
  await until(() => status().audio.kind === "ready", "actual output recovered");
  console.log("[desktop-controls] set volume");
  await observer.setVolume(0.7);
  await until(
    () =>
      (() => {
        const current = status();
        return current.audio.kind === "ready" && current.audio.volume === 0.7 && !current.updating;
      })(),
    "volume round trip",
  );
  console.log("[desktop-controls] set mute");
  await observer.setMute(true);
  await until(
    () =>
      (() => {
        const current = status();
        return current.audio.kind === "ready" && current.audio.muted && !current.updating;
      })(),
    "mute round trip",
  );
  console.log("[desktop-controls] external and stale");
  const stale = status().revision;
  network = [{ name: "eth1", transport: "wifi", addresses: ["2001:db8::3"] }];
  await controls.refresh();
  await until(() => status().revision > stale, "external network observation");
  const writes = audio.writes;
  await assert.rejects(
    client.call({
      destination: serverName,
      path: DESKTOP_STATUS_PATH,
      interface: DESKTOP_STATUS_INTERFACE,
      member: "SetVolume",
      signature: "ud",
      body: [stale, 0.2],
    }),
    /changed/,
  );
  assert.equal(audio.writes, writes, "stale wire action never reaches adapter");
  const beforeSpoof = status().revision;
  intruder.emitSignal({
    path: DESKTOP_STATUS_PATH,
    interface: DESKTOP_STATUS_INTERFACE,
    member: "Changed",
    signature: "s",
    body: [
      JSON.stringify({
        ...status(),
        revision: beforeSpoof + 100,
        network: [{ name: "spoof", transport: "other", addresses: [] }],
      }),
    ],
  });
  await sleep(30);
  assert.equal(status().revision, beforeSpoof, "unauthenticated owner cannot publish status");
  const notify = async (
    replaces = 0,
    summary = "Document saved",
    sender = producer,
    actions: readonly string[] = ["default", "Open"],
  ) => {
    const reply = await sender.call({
      destination: NOTIFICATIONS_BUS,
      path: NOTIFICATIONS_PATH,
      interface: NOTIFICATIONS_INTERFACE,
      member: "Notify",
      signature: "susssasa{sv}i",
      body: ["Editor", replaces, "", summary, "<b>Actual</b> document", actions, {}, 0],
    });
    const id = reply.body?.[0];
    assert.equal(typeof id, "number");
    if (typeof id !== "number") throw new Error("missing ID");
    return id;
  };
  assert.deepEqual(
    (
      await producer.call({
        destination: NOTIFICATIONS_BUS,
        path: NOTIFICATIONS_PATH,
        interface: NOTIFICATIONS_INTERFACE,
        member: "GetCapabilities",
      })
    ).body,
    [["body"]],
    "passive UI never promises actions",
  );
  console.log("[desktop-controls] notify");
  const notificationStarted = Date.now();
  const id = await notify();
  const notificationReturned = Date.now();
  await until(
    () => status().notices.some((item) => item.id === id),
    "Notify reaches desktop observer",
  );
  const notice = status().notices.find((item) => item.id === id)!;
  assert.equal(notice.body, "Actual document");
  assert.deepEqual(notice.actions, [], "default passive presenter exposes no action controls");
  assert.equal(notice.closedAt, null);
  assert.ok(
    notice.createdAt >= notificationStarted && notice.createdAt <= notificationReturned,
    "creation timestamp comes from actual Notify lifecycle",
  );
  await assert.rejects(observer.invokeAction(id, "default", notice.revision), /changed|closed/);
  await until(() => !status().updating, "passive action rejection settles");
  assert.ok(
    status().notices.some(
      (item) => item.id === id && !item.closed && item.revision === notice.revision,
    ),
    "passive action rejection preserves active notice",
  );
  await notify(id, "Replacement");
  await until(
    () => status().notices.some((item) => item.id === id && item.revision !== notice.revision),
    "replacement publication",
  );
  await assert.rejects(observer.dismiss(id, notice.revision), /changed|closed/);
  await until(() => !status().updating, "rejected dismiss completes");
  const replacement = status().notices.find((item) => item.id === id && !item.closed)!;
  await observer.dismiss(id, replacement.revision);
  await until(
    () => status().notices.some((item) => item.id === id && item.closed) && !status().updating,
    "dismissal history",
  );
  const historic = status().notices.find((item) => item.id === id && item.closed);
  assert.ok(historic && historic.closedAt !== null && historic.closedAt >= historic.createdAt);
  assert.deepEqual(historic.actions, [], "history cannot revive closed actions");
  await observer.setDoNotDisturb(true);
  await until(() => status().doNotDisturb && !status().updating, "DND persisted/readback");
  assert.equal(dnd, true);
  assert.equal(policyWrites, 1);
  const invalid = JSON.parse(JSON.stringify(status()));
  invalid.audio.volume = -1;
  assert.throws(() => parseDesktopStatus(JSON.stringify(invalid)), /volume/);
  for (const malformed of [
    { capabilities: { ...status().capabilities, audio: "true" } },
    { capabilities: { audio: true } },
    { network: [{ name: "eth0", transport: "connected", addresses: ["192.0.2.1"] }] },
    { network: [{ name: "eth0", transport: "wired", addresses: [false] }] },
    { network: [{ name: "x".repeat(129), transport: "wired", addresses: [] }] },
    {
      network: [
        {
          name: "eth0",
          transport: "wired",
          addresses: Array.from({ length: 65 }, () => "192.0.2.1"),
        },
      ],
    },
    {
      network: Array.from({ length: 65 }, () => ({
        name: "eth0",
        transport: "wired",
        addresses: [],
      })),
    },
  ])
    assert.throws(
      () => parseDesktopStatus(JSON.stringify({ ...status(), ...malformed })),
      /status|network/i,
    );
  const maximum = {
    ...status(),
    notices: Array.from({ length: 192 }, (_, index) => ({
      id: index + 1,
      revision: 1,
      appName: "\\".repeat(128),
      summary: "\\".repeat(512),
      body: "\\".repeat(4096),
      closed: index >= 128,
      createdAt: notice.createdAt,
      closedAt: index >= 128 ? notice.createdAt + 1 : null,
      actions:
        index >= 128
          ? []
          : Array.from({ length: 16 }, (_, action) => ({
              key: `action${action}${"\\".repeat(118)}`,
              label: "\\".repeat(256),
            })),
    })),
  };
  assert(JSON.stringify(maximum).length > 1024 * 1024);
  assert.equal(
    parseDesktopStatus(JSON.stringify(maximum)).notices.length,
    192,
    "full escaped legitimate history fits boundary",
  );
  // Synthetic parser-allowed escaped text exercises the new bound. The producer
  // parser strips these controls; this is not a claim that real notices contain them.
  const parserMaximum = {
    ...maximum,
    notices: maximum.notices.map((item) => ({
      ...item,
      appName: "\u0001".repeat(4096),
      summary: "\u0001".repeat(4096),
      body: "\u0001".repeat(4096),
    })),
  };
  const parserMaximumJson = JSON.stringify(parserMaximum);
  assert.ok(
    parserMaximumJson.length > 8 * 1024 * 1024 && parserMaximumJson.length < 16 * 1024 * 1024,
  );
  assert.equal(
    parseDesktopStatus(parserMaximumJson).notices.length,
    192,
    "parser-supported escaped payload between old and new bounds survives",
  );
  assert.throws(() => parseDesktopStatus(" ".repeat(16 * 1024 * 1024 + 1)), /text/);
  for (const patch of [
    { createdAt: -1 },
    { createdAt: NaN },
    { closedAt: Date.now() },
    { actions: [{ key: "x".repeat(129), label: "Open" }] },
    { actions: [{ key: "default", label: "x".repeat(257) }] },
    {
      actions: [
        { key: "duplicate", label: "First" },
        { key: "duplicate", label: "Second" },
      ],
    },
    {
      actions: Array.from({ length: 17 }, (_, index) => ({
        key: `action${index}`,
        label: "Action",
      })),
    },
  ]) {
    const malformed = { ...maximum, notices: [{ ...maximum.notices[0], ...patch }] };
    assert.throws(
      () => parseDesktopStatus(JSON.stringify(malformed)),
      /timestamp|actions|identity|text/,
    );
  }
  assert.throws(
    () =>
      parseDesktopStatus(
        JSON.stringify({
          ...maximum,
          notices: [{ ...maximum.notices[128], actions: [{ key: "default", label: "Open" }] }],
        }),
      ),
    /actions/,
  );
  assert.throws(
    () =>
      parseDesktopStatus(
        JSON.stringify({ ...maximum, notices: [{ ...maximum.notices[128], closedAt: null }] }),
      ),
    /timestamp/,
  );

  // A deadline is not backend cancellation: actual pending state blocks retries.
  console.log("[desktop-controls] late and replacement");
  const timed = await observeDesktopStatus(intruder, () => {}, { actionTimeoutMs: 30 });
  observers.push(timed);
  await until(() => timed.state.kind === "ready", "short-deadline observer");
  audio.hold = true;
  await assert.rejects(timed.setVolume(0.9), /timed out|timeout/i);
  await until(
    () => timed.state.kind === "ready" && timed.state.snapshot.updating,
    "late operation remains visibly pending",
  );
  const heldWrites = audio.writes;
  await assert.rejects(timed.setMute(false), /updating/);
  assert.equal(audio.writes, heldWrites);
  audio.release();
  audio.hold = false;
  await until(
    () =>
      timed.state.kind === "ready" &&
      !timed.state.snapshot.updating &&
      timed.state.snapshot.audio.kind === "ready" &&
      timed.state.snapshot.audio.volume === 0.9,
    "late completion observed truthfully",
  );

  // In-flight old-owner completion cannot overwrite a replacement owner.
  const ending = await timed.setMute(false);
  void ending;
  await until(
    () => !status().updating && status().revision === controls?.snapshot().revision,
    "pre-replacement observer caught up",
  );
  audio.hold = true;
  const oldAction = observer.setVolume(0.2).catch((error) => error);
  await until(() => audio.pending !== null, "old owner write started");
  await controls.dispose();
  assert.equal(battery.disposed, true, "desktop service disposes its battery observer");
  controls = null;
  server.close();
  await until(() => observer.state.kind === "unavailable", "owner loss revokes readiness");
  const newServer = await connect(),
    nextAudio = new AudioFixture();
  nextAudio.state = { kind: "unavailable", message: "No actual audio server" };
  assert.equal(await newServer.requestName(DESKTOP_STATUS_BUS, 4), 1);
  controls = await attachDesktopControls(newServer, {
    notificationActions: true,
    audio: nextAudio,
    wifi: new WifiFixture(),
    battery: new BatteryFixture(),
    bluetooth: new BluetoothFixture(),
    pollMs: 0,
    network: () => [],
    readDoNotDisturb: () => false,
    writeDoNotDisturb: () => {},
    onError: (error) => errors.push(error),
  });
  await until(
    () => observer.state.kind === "ready" && observer.state.owner === newServer.name,
    "replacement service",
  );
  audio.release();
  await oldAction;
  assert.equal(observer.state.kind === "ready" && observer.state.owner, newServer.name);
  assert.deepEqual(status().audio, { kind: "unavailable", message: "No actual audio server" });
  await assert.rejects(observer.setVolume(0.4), /unavailable/);
  await until(() => !status().updating, "unavailable action clears pending");
  console.log("[desktop-controls] actual action signals and batch dismissal");
  const actionProducer = await connect();
  const actionSignals: unknown[][] = [];
  assert.ok(newServer.name);
  const stopActions = await actionProducer.subscribeSignal(
    {
      sender: newServer.name,
      path: NOTIFICATIONS_PATH,
      interface: NOTIFICATIONS_INTERFACE,
      member: "ActionInvoked",
    },
    (message) => {
      actionSignals.push(message.body ?? []);
    },
  );
  assert.deepEqual(
    (
      await actionProducer.call({
        destination: NOTIFICATIONS_BUS,
        path: NOTIFICATIONS_PATH,
        interface: NOTIFICATIONS_INTERFACE,
        member: "GetCapabilities",
      })
    ).body,
    [["body", "actions"]],
  );
  const actionCreatedAt = Date.now();
  const actionId = await notify(0, "Open actual document", actionProducer);
  await until(
    () => status().notices.some((item) => item.id === actionId && !item.closed),
    "action notification observed",
  );
  const actionable = status().notices.find((item) => item.id === actionId && !item.closed);
  assert.ok(actionable);
  assert.deepEqual(actionable.actions, [{ key: "default", label: "Open" }]);
  assert.ok(actionable.createdAt >= actionCreatedAt && actionable.createdAt <= Date.now());
  assert.equal(actionable.closedAt, null);
  await observer.invokeAction(actionId, "default", actionable.revision);
  await until(
    () =>
      actionSignals.length === 1 &&
      !status().updating &&
      status().notices.some((item) => item.id === actionId && item.closed),
    "authenticated producer receives exact action signal and closed history",
  );
  assert.deepEqual(actionSignals, [[actionId, "default"]]);
  const actionHistory = status().notices.find((item) => item.id === actionId && item.closed);
  assert.ok(
    actionHistory &&
      actionHistory.closedAt !== null &&
      actionHistory.closedAt >= actionHistory.createdAt,
  );
  assert.deepEqual(actionHistory.actions, []);
  await assert.rejects(
    observer.invokeAction(actionId, "default", actionable.revision),
    /changed|closed/,
  );
  await until(() => !status().updating, "history action rejection settles");
  assert.equal(actionSignals.length, 1);

  const emptyLabelId = await notify(0, "Producer with an empty action label", actionProducer, [
    "open",
    "",
  ]);
  await until(
    () => status().notices.some((item) => item.id === emptyLabelId && !item.closed),
    "empty label producer roundtrip",
  );
  const emptyLabelNotice = status().notices.find(
    (item) => item.id === emptyLabelId && !item.closed,
  );
  assert.ok(emptyLabelNotice);
  assert.deepEqual(
    emptyLabelNotice.actions,
    [{ key: "open", label: "" }],
    "wire accepts actual producer's legitimate empty label",
  );
  await observer.dismiss(emptyLabelId, emptyLabelNotice.revision);
  await until(
    () =>
      !status().updating &&
      status().notices.some((item) => item.id === emptyLabelId && item.closed),
    "empty-label notice dismissal",
  );

  const replacedId = await notify(0, "First actionable version", actionProducer);
  await until(
    () => status().notices.some((item) => item.id === replacedId && !item.closed),
    "first version",
  );
  const oldVersion = status().notices.find((item) => item.id === replacedId && !item.closed);
  assert.ok(oldVersion);
  await notify(replacedId, "New actionable version", actionProducer);
  await until(
    () =>
      status().notices.some(
        (item) => item.id === replacedId && item.revision !== oldVersion.revision && !item.closed,
      ),
    "new version",
  );
  await assert.rejects(
    observer.invokeAction(replacedId, "default", oldVersion.revision),
    /changed|closed/,
  );
  await until(() => !status().updating, "stale action settles");
  const currentVersion = status().notices.find((item) => item.id === replacedId && !item.closed);
  assert.ok(currentVersion);
  await assert.rejects(
    observer.invokeAction(replacedId, "not-offered", currentVersion.revision),
    /changed|closed/,
  );
  await until(() => !status().updating, "unknown action settles");
  assert.equal(actionSignals.length, 1, "stale/rejected actions emit no producer signal");

  const stableId = await notify(0, "Unchanged captured notice", actionProducer);
  await until(
    () => status().notices.some((item) => item.id === stableId && !item.closed),
    "stable batch notice",
  );
  const stable = status().notices.find((item) => item.id === stableId && !item.closed);
  assert.ok(stable);
  const batch = await observer.dismissMany([
    { id: replacedId, revision: oldVersion.revision },
    { id: stableId, revision: stable.revision },
  ]);
  assert.deepEqual(batch, { dismissed: 1, skipped: 1 });
  await until(() => !status().updating, "mixed batch final status");
  assert.ok(
    status().notices.some(
      (item) => item.id === replacedId && item.revision === currentVersion.revision && !item.closed,
    ),
  );
  assert.ok(status().notices.some((item) => item.id === stableId && item.closed));
  const exactBeforeInvalidBatch = JSON.stringify(status());
  const batchRevision = status().revision;
  const rawBatch = (revision: number, pairs: number[][]) =>
    client.call({
      destination: newServer.name ?? "",
      path: DESKTOP_STATUS_PATH,
      interface: DESKTOP_STATUS_INTERFACE,
      member: "DismissMany",
      signature: "ua(uu)",
      body: [revision, pairs],
    });
  await assert.rejects(
    rawBatch(batchRevision, [
      [replacedId, currentVersion.revision],
      [replacedId, currentVersion.revision],
    ]),
    /Duplicate/,
  );
  await assert.rejects(
    rawBatch(
      batchRevision,
      Array.from({ length: 129 }, (_, index) => [1000 + index, 1]),
    ),
    /batch/,
  );
  assert.equal(
    JSON.stringify(status()),
    exactBeforeInvalidBatch,
    "invalid batches never begin mutation",
  );
  const freshId = await notify(0, "Changes global batch revision", actionProducer);
  await until(
    () => status().notices.some((item) => item.id === freshId && !item.closed),
    "fresh global revision",
  );
  const exactBeforeStaleBatch = JSON.stringify(status());
  await assert.rejects(rawBatch(batchRevision, [[replacedId, currentVersion.revision]]), /changed/);
  assert.equal(
    JSON.stringify(status()),
    exactBeforeStaleBatch,
    "stale global revision never dismisses matching pair",
  );

  actionProducer.close();
  await until(
    () =>
      status().notices.every(
        (item) => item.closed || (item.id !== replacedId && item.id !== freshId),
      ),
    "producer disconnect closes its active notices",
  );
  await assert.rejects(
    observer.invokeAction(replacedId, "default", currentVersion.revision),
    /changed|closed/,
  );
  await until(() => !status().updating, "disconnected producer action settles");
  assert.equal(actionSignals.length, 1, "producer loss cannot dispatch another action");
  await stopActions();
  await controls.dispose();
  controls = null;
  assert.equal(nextAudio.disposed, true);
  // A new service gets a new bus owner. Do not make this independent polling
  // regression wait for a reset revision to catch up with an old incarnation.
  newServer.close();
  await until(() => observer.state.kind === "unavailable", "action service retirement");
  const pollServer = await connect();
  assert.equal(await pollServer.requestName(DESKTOP_STATUS_BUS, 4), 1);
  // The production adapter cancels an earlier refresh when started again.
  // Its six-command fallback read must complete even when slower than polling.
  let cancelledReads = 0,
    completedReads = 0,
    unreadyReads = 0,
    pollVolume = 50,
    pollDnd = false,
    pollPolicyWrites = 0;
  let pollOutcome: "ready" | "unavailable" | "error" = "ready";
  const slowAudio = createAudioStatusAdapter({
    execute: async (command, args, signal) => {
      if (command === "wpctl") return { kind: "missing" };
      await sleep(12);
      if (signal.aborted) {
        cancelledReads++;
        return { kind: "cancelled" };
      }
      if (pollOutcome !== "ready") {
        unreadyReads++;
        return pollOutcome === "unavailable"
          ? { kind: "missing" }
          : { kind: "failed", exitCode: 1, message: "Observed audio server failure" };
      }
      switch (args[0]) {
        case "get-default-sink":
          return { kind: "ok", stdout: "slow-output\n" };
        case "--format=json":
          return {
            kind: "ok",
            stdout: JSON.stringify([
              { index: 7, name: "slow-output", description: "Slow observed output" },
            ]),
          };
        case "get-sink-volume":
          return { kind: "ok", stdout: `Volume: front-left: 32768 / ${pollVolume}% / -6.00 dB\n` };
        case "get-sink-mute":
          completedReads++;
          return { kind: "ok", stdout: "Mute: no\n" };
        default:
          throw new Error(`Unexpected delayed backend command ${args[0]}`);
      }
    },
  });
  controls = await attachDesktopControls(pollServer, {
    audio: slowAudio,
    wifi: new WifiFixture(),
    bluetooth: new BluetoothFixture(),
    battery: new BatteryFixture(),
    capabilities: {
      audio: true,
      brightness: false,
      battery: false,
      bluetooth: false,
      power: false,
      notifications: false,
    },
    pollMs: 5,
    network: () => [],
    readDoNotDisturb: () => pollDnd,
    writeDoNotDisturb: (value) => {
      pollDnd = value;
      pollPolicyWrites++;
    },
    onError: (error) => errors.push(error),
  });
  await until(
    () =>
      observer.state.kind === "ready" &&
      observer.state.owner === pollServer.name &&
      observer.state.snapshot.audio.kind === "ready" &&
      completedReads >= 1,
    "slower-than-poll actual adapter reaches readiness",
  );
  console.log("[desktop-controls] unchanged actual adapter polling preserves captured intent");
  const pollTarget = {
    destination: pollServer.name ?? "",
    path: DESKTOP_STATUS_PATH,
    interface: DESKTOP_STATUS_INTERFACE,
  };
  const pollStatus = async () =>
    parseDesktopStatus((await client.call({ ...pollTarget, member: "GetStatus" })).body?.[0]);
  const capturedDnd = await pollStatus(),
    capturedAudio = slowAudio.state;
  const capturedEvents = events.length,
    firstReads = completedReads;
  await until(() => completedReads >= firstReads + 5, "five repeated unchanged slow polling reads");
  assert.equal(controls.snapshot().revision, capturedDnd.revision);
  assert.equal(slowAudio.state, capturedAudio);
  assert.equal(events.length, capturedEvents, "unchanged polls produce no Changed events");
  await client.call({
    ...pollTarget,
    member: "SetDoNotDisturb",
    signature: "ub",
    body: [capturedDnd.revision, true],
  });
  await until(
    () => status().doNotDisturb && !status().updating,
    "captured DND survives unrelated polling",
  );
  assert.equal(pollPolicyWrites, 1);

  const idleNoticeId = await notify(0, "Notice captured before unchanged audio polls");
  const capturedBatch = await pollStatus();
  const idleNotice = capturedBatch.notices.find(
    (notice) => notice.id === idleNoticeId && !notice.closed,
  );
  assert.ok(idleNotice);
  const batchReads = completedReads;
  await until(() => completedReads >= batchReads + 2, "unchanged polls after notice capture");
  assert.equal(controls.snapshot().revision, capturedBatch.revision);
  const idleBatch = await client.call({
    ...pollTarget,
    member: "DismissMany",
    signature: "ua(uu)",
    body: [capturedBatch.revision, [[idleNoticeId, idleNotice.revision]]],
  });
  assert.deepEqual(idleBatch.body?.slice(1), [1, 0]);
  await until(
    () =>
      !status().updating &&
      status().notices.some((notice) => notice.id === idleNoticeId && notice.closed),
    "captured notice batch survives unchanged polling",
  );

  const beforeActualChange = await pollStatus();
  pollVolume = 75;
  await until(() => {
    const audio = status().audio;
    return audio.kind === "ready" && audio.volume === 0.75;
  }, "actual external volume change publishes");
  assert(controls.snapshot().revision > beforeActualChange.revision);
  assert.notEqual(slowAudio.state, capturedAudio);
  await assert.rejects(
    client.call({
      ...pollTarget,
      member: "SetDoNotDisturb",
      signature: "ub",
      body: [beforeActualChange.revision, false],
    }),
    /changed/,
  );
  assert.equal(
    pollPolicyWrites,
    1,
    "genuine state change still rejects stale intent before mutation",
  );
  assert.equal(pollDnd, true);

  for (const outcome of ["unavailable", "error"] as const) {
    pollOutcome = outcome;
    await until(() => status().audio.kind === outcome, `actual ${outcome} publication`);
    const captured = await pollStatus(),
      audioObservation = slowAudio.state;
    const reads = unreadyReads;
    await until(() => unreadyReads >= reads + 5, `five identical ${outcome} reads`);
    assert.equal(controls.snapshot().revision, captured.revision);
    assert.equal(slowAudio.state, audioObservation);
    assert.equal(
      captured.capabilities.audio,
      true,
      "backend support remains distinct from server health",
    );
    const requested = !pollDnd;
    await client.call({
      ...pollTarget,
      member: "SetDoNotDisturb",
      signature: "ub",
      body: [captured.revision, requested],
    });
    await until(
      () => status().doNotDisturb === requested && !status().updating,
      `${outcome} audio does not invalidate notification policy`,
    );
  }
  assert.equal(pollPolicyWrites, 3);
  assert.equal(cancelledReads, 0, "coalescing prevents slow reads starving themselves");
  await controls.dispose();
  controls = null;

  for (const observer of observers) await observer.dispose();
  assert.equal(errors.length, 0, "healthy production service has no swallowed errors");
  console.log(
    "[desktop-controls] actual private D-Bus service/client: readback, stale/spoof rejection, notifications/history/DND/timestamps, actual action signals/stale producer rejection, captured batch dismissal/bounds, timeout pending/late completion, owner replacement and disposal passed; live audio server not claimed",
  );
} catch (error) {
  console.error("[desktop-controls] actual failure", error);
  throw error;
} finally {
  await controls?.dispose().catch((error) => console.error("cleanup", error));
  for (const observer of observers)
    await observer.dispose().catch((error) => console.error("cleanup", error));
  for (const bus of buses) bus.close();
  if (daemon.exitCode === null && daemon.signalCode === null) daemon.kill("SIGTERM");
  await exited;
  await fs.rm(directory, { recursive: true, force: true });
}
