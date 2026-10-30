/**
 * Stand-ins for every service Settings uses, for its smokes and the app gallery: a desktop
 * controls client with Wi‑Fi, Bluetooth, battery, sound and notifications that records the
 * actions it is asked for, the index and drive services, a display controller, the system
 * settings fakes, a fixed computer and an apps catalog.
 */
import {
  createLocalIndexClient,
  type IndexBackend,
  type IndexClient,
  type IndexStatus,
} from "@moire/system-management/index-status";
import {
  parseStorageVolumeId,
  type StorageClient,
  type StorageClientState,
  type StorageVolume,
} from "@moire/system-management/storage-status";
import type {
  DesktopStatusClient,
  DesktopStatusSnapshot,
  DesktopStatusState,
} from "@moire/system-management/desktop-status";
import { BLUETOOTH_UNAVAILABLE, parseBluetoothId } from "@moire/system-management/bluetooth-status";
import { createFakeTimeSettingsClient } from "@moire/system-management/time-settings";
import { createFakeAccountsSettingsClient } from "@moire/system-management/accounts-settings";
import { createFakeLoginSettingsClient } from "@moire/system-management/login-settings";
import { createFakeInputSettings } from "@moire/system-management/input-settings";
import { createFakePowerSettingsClient } from "@moire/system-management/power-settings";
import { createFakeBrightnessClient } from "@moire/system-management/brightness";
import type { DesktopEntry } from "@moire/app-discovery";
import type { MoireSettings } from "@moire/prefs";
import type { SettingsAppProps } from "./app";
import type { AppsBackend } from "./apps-state";
import { parseDeepLink } from "./catalog";
import type { DisplayController, DisplayState } from "./display-service";
import type { DesktopStatusSource, SettingsServices } from "./services";
import type { SystemInfo } from "./system-info";

export function indexStatus(overrides: Partial<IndexStatus> = {}): IndexStatus {
  return {
    state: "ready",
    message: "Up to date",
    revision: 1,
    roots: [],
    files: 18_432,
    folders: 2_210,
    withText: 6_120,
    pendingText: 0,
    crawl: { directories: 0, entries: 0, queued: 0 },
    watching: "recursive",
    lastCrawlAt: Date.now() - 12 * 60_000,
    ...overrides,
  };
}

/** An index whose status the caller sets, recording the rebuilds it is asked for. */
export class FakeIndex implements IndexBackend {
  readonly reindexed: string[] = [];
  private current: IndexStatus;
  private readonly listeners = new Set<() => void>();
  readonly client: IndexClient;

  constructor(status: IndexStatus = indexStatus()) {
    this.current = status;
    this.client = createLocalIndexClient(this);
  }

  set(overrides: Partial<IndexStatus>): void {
    this.current = { ...this.current, ...overrides, revision: this.current.revision + 1 };
    for (const listener of this.listeners) listener();
  }

  status(): IndexStatus {
    return this.current;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async reindex(root: string): Promise<void> {
    this.reindexed.push(root);
  }
  async search(): Promise<never> {
    throw new Error("Settings never searches");
  }
  async recent(): Promise<never> {
    throw new Error("Settings never lists recent files");
  }
  async kindCounts(): Promise<never> {
    throw new Error("Settings never counts kinds");
  }
}

/** A client for a service that is not running. */
export function absentIndex(): IndexClient {
  const state = { kind: "unavailable", message: "The file index is not running." } as const;
  const refuse = async (): Promise<never> => {
    throw new Error("The file index is not running.");
  };
  return {
    state,
    subscribe(listener) {
      listener(state);
      return () => {};
    },
    search: refuse,
    recent: refuse,
    kindCounts: refuse,
    reindex: refuse,
    dispose: async () => {},
  };
}

export function mountedVolume(label: string, mountPath: string, sizeBytes: number): StorageVolume {
  return {
    id: parseStorageVolumeId(`volume-${label.toLowerCase().replace(/\W+/g, "-")}`),
    label,
    device: `/dev/sd-${label.toLowerCase()}`,
    sizeBytes,
    filesystem: "exfat",
    mount: { kind: "mounted", paths: [mountPath] },
    canEject: true,
  };
}

/** A drive service that reports these volumes and records the actions asked of it. */
export function fakeStorage(
  volumes: readonly StorageVolume[],
  calls: string[] = [],
): StorageClient {
  const state: StorageClientState = {
    kind: "ready",
    owner: ":1.42",
    snapshot: {
      revision: 1,
      status: { kind: "ready", policy: "interactive", volumes },
      operation: { kind: "idle" },
    },
  };
  const record = (action: string) => async (request: { id: string }) => {
    calls.push(`${action}:${request.id}`);
  };
  return {
    state,
    subscribe(listener) {
      listener(state);
      return () => {};
    },
    refresh: async () => {},
    mount: record("mount"),
    unmount: record("unmount"),
    eject: record("eject"),
    dispose: async () => {},
  };
}

const ADAPTER = parseBluetoothId("hci0");

/** A snapshot like the mockups': Halcyon connected, two Bluetooth devices, 78% battery. */
export function desktopSnapshot(
  overrides: Partial<DesktopStatusSnapshot> = {},
): DesktopStatusSnapshot {
  const now = Date.now();
  return {
    revision: 1,
    updating: false,
    audio: { kind: "ready", name: "Built-in Audio Analog Stereo", volume: 0.64, muted: false },
    sound: {
      kind: "ready",
      outputs: [
        { id: "52", name: "Built-in Audio Analog Stereo", isDefault: true },
        { id: "61", name: "WH-1000XM5", isDefault: false },
      ],
      inputs: [
        { id: "53", name: "Built-in Microphone", isDefault: true },
        { id: "62", name: "USB Microphone", isDefault: false },
      ],
      input: { id: "53", volume: 0.8, muted: false },
      streams: [
        { id: "74", app: "Firefox", title: "Lo-fi beats – YouTube", volume: 1, muted: false },
        { id: "80", app: "Videos", title: "", volume: 0.45, muted: true },
      ],
      meter: { kind: "off" },
    },
    network: [
      { name: "wlan0", transport: "wifi", addresses: ["192.168.1.24", "fe80::1c2:3ff:fe44:5566"] },
      { name: "enp0s1", transport: "wired", addresses: ["10.0.2.15"] },
    ],
    wifi: {
      kind: "ready",
      policy: "interactive",
      enabled: true,
      hardwareEnabled: true,
      canConnect: true,
      canScan: true,
      canToggle: true,
      connectivity: "full",
      connection: { kind: "active", name: "Halcyon", transport: "wifi" },
      operation: { kind: "idle" },
      accessPoints: [
        {
          id: "/ap/1",
          ssid: "Halcyon",
          strength: 82,
          security: "wpa-psk",
          connected: true,
          saved: true,
        },
        { id: "/ap/2", ssid: "Halcyon-Guest", strength: 74, security: "wpa-psk", connected: false },
        { id: "/ap/3", ssid: "Bluebird", strength: 51, security: "wpa-psk", connected: false },
        { id: "/ap/4", ssid: "Corner Café", strength: 38, security: "open", connected: false },
        { id: "/ap/5", ssid: "NETGEAR-42", strength: 22, security: "wpa-psk", connected: false },
      ],
      vpn: {
        connections: [
          {
            id: "6f1f8a3c-1111-4c3a-9a00-000000000001",
            name: "Office",
            kind: "wireguard",
            state: "connected",
          },
          {
            id: "6f1f8a3c-1111-4c3a-9a00-000000000002",
            name: "Home",
            kind: "openvpn",
            state: "disconnected",
          },
        ],
        canManage: true,
        importable: ["wireguard", "openvpn"],
      },
      proxy: { connection: "Halcyon", method: "none", pacUrl: "", canChange: true },
    },
    airplane: { active: false, canToggle: true },
    bluetooth: {
      status: {
        kind: "ready",
        policy: "interactive",
        adapters: [{ id: ADAPTER, name: "joshua-vm", powered: true }],
        devices: [
          {
            id: parseBluetoothId("dev_keys"),
            adapterId: ADAPTER,
            name: "MX Keys",
            address: "E4:1A:22:01:02:03",
            paired: true,
            trusted: true,
            connected: true,
            kind: "keyboard",
            battery: 64,
          },
          {
            id: parseBluetoothId("dev_mouse"),
            adapterId: ADAPTER,
            name: "MX Master 3S",
            address: "E4:1A:22:04:05:06",
            paired: true,
            trusted: true,
            connected: true,
            kind: "mouse",
            battery: 12,
          },
          {
            id: parseBluetoothId("dev_phones"),
            adapterId: ADAPTER,
            name: "WH-1000XM5",
            address: "88:C9:E8:07:08:09",
            paired: true,
            trusted: true,
            connected: false,
            kind: "headphones",
          },
        ],
      },
      operation: { kind: "idle" },
      pairing: {
        kind: "ready",
        adapters: [{ id: ADAPTER, name: "joshua-vm", powered: true }],
        devices: [
          {
            id: parseBluetoothId("near_pixel"),
            adapterId: ADAPTER,
            name: "Pixel 8",
            address: "3C:28:6D:10:11:12",
            paired: false,
          },
          {
            id: parseBluetoothId("near_flip"),
            adapterId: ADAPTER,
            name: "JBL Flip 6",
            address: "00:42:79:13:14:15",
            paired: false,
          },
        ],
        lease: { id: parseBluetoothId("lease1"), adapterId: ADAPTER, expiresAt: now + 60_000 },
        discovery: "scanning",
        attempt: { kind: "idle" },
        prompt: null,
        message: "",
        inputEnabled: true,
      },
      trust: { kind: "ready", operation: { kind: "idle" } },
    },
    battery: {
      kind: "ready",
      source: "battery",
      percentage: 78,
      chargeState: "discharging",
      onBattery: true,
      warningLevel: "none",
      timeToEmptySeconds: 3 * 3600 + 12 * 60,
      timeToFullSeconds: null,
    },
    capabilities: {
      audio: true,
      brightness: false,
      battery: true,
      bluetooth: true,
      power: true,
      notifications: true,
    },
    doNotDisturb: false,
    notificationsAvailable: true,
    notices: [
      {
        id: 1,
        revision: 1,
        appName: "Files",
        summary: "Copied 12 files to USB",
        body: "",
        closed: true,
        createdAt: now - 40 * 60_000,
        closedAt: now - 39 * 60_000,
        actions: [],
      },
      {
        id: 2,
        revision: 1,
        appName: "Calendar",
        summary: "Stand-up in 10 minutes",
        body: "",
        closed: true,
        createdAt: now - 3 * 3600_000,
        closedAt: now - 3 * 3600_000 + 5000,
        actions: [],
      },
    ],
    ...overrides,
  };
}

/**
 * A wired-only computer, like the VM: NetworkManager runs with no Wi‑Fi device (its radio switch
 * still reads on), Ethernet is the primary connection, and there is no radio for airplane mode.
 */
export function wiredOnlySnapshot(): DesktopStatusSnapshot {
  const base = desktopSnapshot();
  if (base.wifi.kind !== "ready") throw new Error("Wi-Fi fixture unavailable");
  const { airplane: _airplane, ...rest } = base;
  return {
    ...rest,
    network: [
      {
        name: "enp0s1",
        transport: "wired",
        addresses: ["192.168.64.43", "fe80::5054:ff:fe12:3456"],
      },
    ],
    wifi: {
      ...base.wifi,
      adapters: 0,
      canConnect: false,
      canScan: false,
      connection: { kind: "active", name: "Wired connection 1", transport: "wired" },
      accessPoints: [],
      vpn: { connections: [], canManage: true, importable: ["wireguard"] },
      proxy: { connection: "Wired connection 1", method: "none", pacUrl: "", canChange: true },
    },
    bluetooth: BLUETOOTH_UNAVAILABLE,
    capabilities: { ...base.capabilities, bluetooth: false },
  };
}

/**
 * Desktop controls over a snapshot the smoke can change. Actions are recorded by name and
 * applied to the snapshot the way the service would apply them.
 */
export class FakeDesktop implements DesktopStatusSource {
  readonly calls: string[] = [];
  private snapshot: DesktopStatusSnapshot;
  private readonly listeners = new Set<(state: DesktopStatusState) => void>();
  private readonly levelListeners = new Set<(level: number) => void>();
  readonly client: DesktopStatusClient;

  constructor(snapshot = desktopSnapshot()) {
    this.snapshot = snapshot;
    const current = () => this.snapshot;
    const act =
      <A extends unknown[]>(
        name: string,
        apply?: (snapshot: DesktopStatusSnapshot, ...args: A) => Partial<DesktopStatusSnapshot>,
      ) =>
      async (...args: A) => {
        this.calls.push(
          `${name}${args.length ? `:${args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(",")}` : ""}`,
        );
        if (apply) this.set(apply(this.snapshot, ...args));
      };
    const wifi = (snapshot: DesktopStatusSnapshot) => {
      if (snapshot.wifi.kind !== "ready") throw new Error("Wi-Fi unavailable");
      return snapshot.wifi;
    };
    const sound = (snapshot: DesktopStatusSnapshot) => {
      if (snapshot.sound?.kind !== "ready") throw new Error("Sound devices unavailable");
      return snapshot.sound;
    };
    const vpnState = (
      snapshot: DesktopStatusSnapshot,
      id: string,
      state: "connected" | "disconnected",
    ): Partial<DesktopStatusSnapshot> => ({
      wifi: {
        ...wifi(snapshot),
        vpn: {
          ...wifi(snapshot).vpn!,
          connections: wifi(snapshot).vpn!.connections.map((vpn) =>
            vpn.id === id ? { ...vpn, state } : vpn,
          ),
        },
      },
    });
    const bluetooth = (snapshot: DesktopStatusSnapshot) => {
      if (snapshot.bluetooth.status.kind !== "ready") throw new Error("Bluetooth unavailable");
      return snapshot.bluetooth.status;
    };
    this.client = {
      get state() {
        return { kind: "ready", owner: ":1.7", snapshot: current() } as DesktopStatusState;
      },
      setVolume: act("setVolume", (s, value: number) => ({
        audio: { ...(s.audio as Extract<typeof s.audio, { kind: "ready" }>), volume: value },
      })),
      setMute: act("setMute", (s, muted: boolean) => ({
        audio: { ...(s.audio as Extract<typeof s.audio, { kind: "ready" }>), muted },
      })),
      setDoNotDisturb: act("setDoNotDisturb", (_s, on: boolean) => ({ doNotDisturb: on })),
      setDefaultSoundDevice: act("setDefaultSoundDevice", (s, kind: string, id: string) => {
        const ready = sound(s);
        const pick = (devices: typeof ready.outputs) =>
          devices.map((device) => ({ ...device, isDefault: device.id === id }));
        return kind === "output"
          ? {
              sound: { ...ready, outputs: pick(ready.outputs) },
              audio: {
                ...(s.audio as Extract<typeof s.audio, { kind: "ready" }>),
                name: ready.outputs.find((device) => device.id === id)!.name,
              },
            }
          : {
              sound: {
                ...ready,
                inputs: pick(ready.inputs),
                input: { id, volume: 1, muted: false },
              },
            };
      }),
      setInputVolume: act("setInputVolume", (s, volume: number) => ({
        sound: { ...sound(s), input: { ...sound(s).input!, volume } },
      })),
      setInputMute: act("setInputMute", (s, muted: boolean) => ({
        sound: { ...sound(s), input: { ...sound(s).input!, muted } },
      })),
      setStreamVolume: act("setStreamVolume", (s, id: string, volume: number) => ({
        sound: {
          ...sound(s),
          streams: sound(s).streams.map((item) => (item.id === id ? { ...item, volume } : item)),
        },
      })),
      setStreamMute: act("setStreamMute", (s, id: string, muted: boolean) => ({
        sound: {
          ...sound(s),
          streams: sound(s).streams.map((item) => (item.id === id ? { ...item, muted } : item)),
        },
      })),
      startInputMeter: act("startInputMeter", (s) => ({
        sound: { ...sound(s), meter: { kind: "on" } },
      })),
      stopInputMeter: act("stopInputMeter", (s) =>
        s.sound?.kind === "ready" ? { sound: { ...sound(s), meter: { kind: "off" } } } : {},
      ),
      onInputLevel: (listener) => {
        this.levelListeners.add(listener);
        return () => this.levelListeners.delete(listener);
      },
      refreshWifi: act("refreshWifi"),
      connectWifi: act("connectWifi", (s, id: string) => ({
        wifi: {
          ...wifi(s),
          accessPoints: wifi(s).accessPoints.map((ap) => ({ ...ap, connected: ap.id === id })),
        },
      })),
      cancelWifi: act("cancelWifi"),
      setWifiEnabled: act("setWifiEnabled", (s, enabled: boolean) => ({
        wifi: { ...wifi(s), enabled },
      })),
      disconnectWifi: act("disconnectWifi", (s) => ({
        wifi: {
          ...wifi(s),
          accessPoints: wifi(s).accessPoints.map((ap) => ({ ...ap, connected: false })),
        },
      })),
      forgetWifi: act("forgetWifi", (s, id: string) => ({
        wifi: {
          ...wifi(s),
          accessPoints: wifi(s).accessPoints.map((ap) =>
            ap.id === id ? { ...ap, saved: false } : ap,
          ),
        },
      })),
      connectHiddenWifi: act("connectHiddenWifi"),
      setAirplaneMode: act("setAirplaneMode", (s, enabled: boolean) => ({
        airplane: { active: enabled, canToggle: true },
        wifi: { ...wifi(s), enabled: !enabled },
        bluetooth: {
          ...s.bluetooth,
          status: {
            ...bluetooth(s),
            adapters: bluetooth(s).adapters.map((adapter) => ({ ...adapter, powered: !enabled })),
          },
        },
      })),
      activateVpn: act("activateVpn", (s, id: string) => vpnState(s, id, "connected")),
      deactivateVpn: act("deactivateVpn", (s, id: string) => vpnState(s, id, "disconnected")),
      removeVpn: act("removeVpn", (s, id: string) => ({
        wifi: {
          ...wifi(s),
          vpn: {
            ...wifi(s).vpn!,
            connections: wifi(s).vpn!.connections.filter((vpn) => vpn.id !== id),
          },
        },
      })),
      importVpn: act("importVpn", (s, request) => ({
        wifi: {
          ...wifi(s),
          vpn: {
            ...wifi(s).vpn!,
            connections: [
              ...wifi(s).vpn!.connections,
              {
                id: "6f1f8a3c-1111-4c3a-9a00-0000000000aa",
                name: request.name,
                kind: request.kind,
                state: "disconnected",
              },
            ],
          },
        },
      })),
      // Like the service: a change to a shared connection leaves the user on their own copy.
      setProxy: act("setProxy", (s, request) => {
        const { password: _password, ...change } = request;
        const proxy = wifi(s).proxy!;
        return {
          wifi: {
            ...wifi(s),
            proxy: proxy.copy
              ? { connection: proxy.connection, ...change, canChange: true, ownership: "user" }
              : { ...proxy, ...change },
          },
        };
      }),
      refreshBluetooth: act("refreshBluetooth"),
      setBluetoothConnected: act("setBluetoothConnected", (s, request) => ({
        bluetooth: {
          ...s.bluetooth,
          status: {
            ...bluetooth(s),
            devices: bluetooth(s).devices.map((device) =>
              device.id === request.id ? { ...device, connected: request.connected } : device,
            ),
          },
        },
      })),
      setBluetoothPowered: act("setBluetoothPowered", (s, request) => ({
        bluetooth: {
          ...s.bluetooth,
          status: {
            ...bluetooth(s),
            adapters: bluetooth(s).adapters.map((adapter) =>
              adapter.id === request.adapterId ? { ...adapter, powered: request.powered } : adapter,
            ),
          },
        },
      })),
      renameBluetoothDevice: act("renameBluetoothDevice", (s, request) => ({
        bluetooth: {
          ...s.bluetooth,
          status: {
            ...bluetooth(s),
            devices: bluetooth(s).devices.map((device) =>
              device.id === request.id ? { ...device, name: request.name.trim() } : device,
            ),
          },
        },
      })),
      forgetBluetoothDevice: act("forgetBluetoothDevice", (s, request) => ({
        bluetooth: {
          ...s.bluetooth,
          status: {
            ...bluetooth(s),
            devices: bluetooth(s).devices.filter((device) => device.id !== request.id),
          },
        },
      })),
      startBluetoothDiscovery: act("startBluetoothDiscovery"),
      stopBluetoothDiscovery: act("stopBluetoothDiscovery"),
      beginBluetoothPair: act("beginBluetoothPair"),
      cancelBluetoothPair: act("cancelBluetoothPair"),
      respondBluetoothPrompt: act("respondBluetoothPrompt"),
      respondBluetoothInput: act("respondBluetoothInput"),
      requestBluetoothTrust: act("requestBluetoothTrust"),
      confirmBluetoothTrust: act("confirmBluetoothTrust"),
      cancelBluetoothTrust: act("cancelBluetoothTrust"),
      dismiss: act("dismiss"),
      dismissMany: async (pairs) => {
        this.calls.push(`dismissMany:${pairs.length}`);
        this.set({
          notices: this.snapshot.notices.filter(
            (notice) => !pairs.some((pair) => pair.id === notice.id),
          ),
        });
        return { dismissed: pairs.length, skipped: 0 };
      },
      invokeAction: act("invokeAction"),
      dispose: async () => {},
    };
  }

  set(patch: Partial<DesktopStatusSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch, revision: this.snapshot.revision + 1 };
    for (const listener of this.listeners) listener(this.client.state);
  }

  /** Send an input peak to whoever follows the level, as the service's signal would. */
  inputLevel(peak: number): void {
    for (const listener of this.levelListeners) listener(peak);
  }

  /** How many follow the input level now. */
  get levelFollowers(): number {
    return this.levelListeners.size;
  }

  subscribe(listener: (state: DesktopStatusState) => void): () => void {
    this.listeners.add(listener);
    listener(this.client.state);
    return () => this.listeners.delete(listener);
  }
}

/** One 1920×1200 display, as a VM shows it. */
export function fakeDisplay(): DisplayController {
  const state: DisplayState = {
    current: "1920x1200@60000",
    preferred: "1920x1200@60000",
    name: "Virtual-1",
    widthMm: 520,
    heightMm: 320,
    modes: ["1920x1200@60000", "1680x1050@60000", "1280x800@60000"],
    outputs: [
      {
        id: "virtual-1",
        name: "Virtual-1",
        make: "",
        model: "Built-in screen",
        serial: "",
        mode: "1920x1200@60000",
        x: 0,
        y: 0,
        width: 1920,
        height: 1200,
        scale120: 120,
        primary: true,
      },
    ],
  };
  return {
    ...state,
    getState: async () => state,
    setMode: async () => true,
    confirmMode: async () => true,
    revertMode: async () => true,
    setLayout: async () => true,
    confirmLayout: async () => true,
    revertLayout: async () => true,
  };
}

export function fakeSystem(): SystemInfo {
  return {
    hostname: "joshua-vm",
    system: "NixOS 25.05 (Warbler)",
    systemShort: "NixOS 25.05",
    build: "C63",
    generation: 42,
    kernel: "6.12.8",
    memoryBytes: 8 * 1024 ** 3,
    processor: "Apple M2 (Virtualized)",
    cores: 4,
    user: { login: "joshua", name: "Joshua Steele", administrator: true, picture: null },
  };
}

const entry = (id: string, name: string, comment: string): DesktopEntry => ({
  id,
  name,
  comment,
  exec: `moire-${id.replace(/\.desktop$/, "")}`,
  terminal: false,
  categories: [],
});

/** A few installed apps, each default the app the kind's first candidate. */
export function fakeApps(defaults: Record<string, string> = {}): AppsBackend {
  const apps = [
    entry("files.desktop", "Files", "Browse your files"),
    entry("editor.desktop", "Text Editor", "Edit text files"),
    entry("image-viewer.desktop", "Image Viewer", "Look at pictures"),
    entry("music.desktop", "Music", "Play music"),
    entry("video-player.desktop", "Video Player", "Watch videos"),
    entry("document-viewer.desktop", "Document Viewer", "Read PDFs"),
    entry("archive-manager.desktop", "Archive Manager", "Open zip and tar files"),
    entry("firefox.desktop", "Firefox", "Browse the web"),
  ];
  const byMime: Record<string, string[]> = {
    "x-scheme-handler/http": ["firefox.desktop"],
    "text/plain": ["editor.desktop"],
    "image/png": ["image-viewer.desktop"],
    "audio/mpeg": ["music.desktop"],
    "video/mp4": ["video-player.desktop"],
    "application/pdf": ["document-viewer.desktop", "firefox.desktop"],
    "application/zip": ["archive-manager.desktop"],
  };
  return {
    applications: () => apps,
    candidates: (mime) => {
      const ids = byMime[mime] ?? [];
      const first = defaults[mime];
      const ordered = first ? [first, ...ids.filter((id) => id !== first)] : ids;
      return ordered.map((id) => apps.find((app) => app.id === id)!).filter(Boolean);
    },
    setDefault(mimes, id) {
      for (const mime of mimes) defaults[mime] = id;
    },
  };
}

export type SettingsFixture = {
  props: Omit<SettingsAppProps, "width" | "height">;
  desktop: FakeDesktop;
  index: FakeIndex;
  launched: string[];
  copied: string[];
  storageCalls: string[];
};

/** Every service present and full, as on a laptop with all backends running. */
export function settingsFixture(
  initial: MoireSettings,
  options: {
    page?: string;
    services?: Partial<SettingsServices>;
    /** The desktop status to start from; the full laptop by default. */
    desktop?: DesktopStatusSnapshot;
  } = {},
): SettingsFixture {
  const desktop = new FakeDesktop(options.desktop);
  const index = new FakeIndex(indexStatus({ lastCrawlAt: Date.now() - 3 * 60_000 }));
  const launched: string[] = [];
  const copied: string[] = [];
  const storageCalls: string[] = [];
  const accounts = createFakeAccountsSettingsClient();
  return {
    desktop,
    index,
    launched,
    copied,
    storageCalls,
    props: {
      initial,
      route: parseDeepLink(options.page),
      services: {
        display: fakeDisplay(),
        index: index.client,
        storage: fakeStorage(
          [mountedVolume("USB", "/run/media/joshua/USB", 32 * 1024 ** 3)],
          storageCalls,
        ),
        desktop,
        time: createFakeTimeSettingsClient(),
        accounts,
        login: createFakeLoginSettingsClient(),
        input: createFakeInputSettings({
          keyboard: {
            layouts: [
              { layout: "us", variant: "" },
              { layout: "de", variant: "nodeadkeys" },
            ],
          },
          pointerDevices: [
            { name: "Virtual tablet", kind: "mouse", clickpad: false },
            { name: "SYNA2393 Touchpad", kind: "touchpad", clickpad: true },
          ],
        }),
        power: createFakePowerSettingsClient(),
        brightness: createFakeBrightnessClient(),
        ...options.services,
      },
      system: fakeSystem(),
      apps: fakeApps(),
      // Evening in London, so schedules read the same on every run.
      daylight: () => ({
        timeZone: "Europe/London",
        location: { latitude: 51.5083, longitude: -0.1253 },
      }),
      clock: () => new Date("2026-06-21T21:30:00Z"),
      launch: async (command, args = []) => {
        launched.push([command, ...args].join(" "));
      },
      copyText: async (text) => {
        copied.push(text);
      },
    },
  };
}

/** No services at all: what Settings shows on a machine where none are running. */
export const NO_SERVICES: SettingsServices = {
  display: null,
  index: null,
  storage: null,
  desktop: null,
  time: null,
  accounts: null,
  login: null,
  input: null,
  power: null,
  brightness: null,
};
