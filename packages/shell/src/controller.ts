import {
  discoverApplications,
  filterApplications,
  ContextActionRegistry,
  FileActivationPortalClient,
  FileActivationService,
  resolveApplicationIcon,
  type DesktopEntry,
  type FileActionContext,
} from "@moire/app-discovery";
import {
  createShellRoot,
  hitRegionContains,
  rasterize,
  renderShell,
  type HitRegion,
  type ShellRoot,
} from "@moire/react-host";
import {
  installUiFonts,
  setUiScaleFactor,
  tickAllMotions,
  ContextMenu,
  ContextMenuTrigger,
  Icon,
  GridItem,
  createSelectionState,
  reduceSelection,
  reconcileSelection,
  keyFromEvdev,
  type ContextMenuAction,
  type IconName,
  type SelectionAction,
  type SelectionState,
  type ScrollMetrics,
} from "@moire/ui";
import { loadSettings } from "@moire/prefs";
import { themePalette } from "@moire/theme";
import { createElement, useEffect, useMemo } from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Panel, panelStatusGeometry } from "./Panel";
import { TaskOverflow, TASK_WINDOWS_SCOPE } from "./TaskOverflow";
import { NotificationsTray } from "./NotificationsTray";
import { networkPresentation, type NetworkPresentation } from "./network-presentation";
import { createVolumeIntent } from "./volume-intent";
import type { QuickSettingsDetailsView } from "./QuickSettingsDetails";
import {
  QuickSettings,
  NotificationBanner,
  scrollQuickControlIntoView,
  type PopupAnchor,
  type DesktopControlActions,
  QUICK_SETTINGS_SCOPE,
  NOTIFICATIONS_SCOPE,
} from "./QuickSettings";
import type {
  DesktopCapabilities,
  DesktopStatusState,
} from "@moire/system-management/desktop-status";
import {
  bluetoothPairingBlocksConnections,
  bluetoothTrustBlocksControls,
  type BluetoothDevice,
  type BluetoothNearbyDevice,
  type BluetoothId,
} from "@moire/system-management/bluetooth-status";
import { isDeepStrictEqual } from "node:util";
import type { WifiAccessPoint } from "@moire/system-management/network-status";
import { Launcher, type LauncherLaunchState } from "./Launcher";
import { TitleBar } from "./TitleBar";
import { Label } from "./widgets";
import {
  DesktopIcons,
  listDesktopEntries,
  loadDesktopLayout,
  saveDesktopLayout,
  desktopDir,
  hitTestDesktopIcon,
  desktopIconPosition,
  DESKTOP_ITEM_W,
  DESKTOP_ITEM_H,
  ICON_SIZE,
  type DesktopLayout,
} from "./DesktopIcons";
import type { SsdAction, SsdWindowInfo, TaskWindowAction, TaskWindowInfo } from "./ssd";
import { Group, Rect, measureText } from "@moire/react-host";

export type ShellSpawn = (opts: { exec: string }) => {
  unref?: () => void;
  once?: {
    (event: "spawn", listener: () => void): unknown;
    (event: "error", listener: (error: Error) => void): unknown;
  };
};

/** Pointer and scroll geometry only; no producer/body/keyboard payloads. */
export type ShellScrollObservation =
  | {
      stage: "hit";
      popup: string | null;
      view: string;
      x: number;
      y: number;
      deltaY: number;
      before: number;
      after: number;
      bounds: { x: number; y: number; width: number; height: number } | null;
      clip: { x: number; y: number; width: number; height: number } | null;
    }
  | {
      stage: "offset";
      popup: string | null;
      view: string;
      offset: number;
      contentHeight: number | null;
      viewportHeight: number | null;
      maxScroll: number | null;
    }
  | {
      stage: "paint";
      popup: string | null;
      view: string;
      revision: number;
      offset: number;
      bodyChecksum: number | null;
      footerChecksum: number | null;
    };

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export type ShellRasterSurface = {
  id: string;
  pixels: Uint8Array;
  width: number;
  height: number;
  stride: number;
  revision: number;
  x: number;
  y: number;
};

export type ShellBridge = {
  setPrimaryOutput(output: { x: number; y: number; width: number; height: number }): void;
  paint(fb: Uint32Array, pitchPx: number, width: number, height: number): void;
  /** Revisioned shell surfaces for retained compositor backends. */
  chromeRaster(width: number, height: number): ShellRasterSurface | null;
  desktopRaster(width: number, height: number): ShellRasterSurface | null;
  /** Clear per-frame SSD hit list before painting windows in stack order. */
  beginSsdFrame(): void;
  /**
   * Paint one SSD titlebar into the framebuffer.
   * Call immediately after the parent buffer, before its above-parent children, so
   * chrome participates in window z-order (not a global overlay on top).
   */
  paintSsdWindow(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    window: SsdWindowInfo,
  ): void;
  ssdRaster(window: SsdWindowInfo): ShellRasterSurface;
  /** Paint a bottom→top batch after beginSsdFrame; multiple batches accumulate hits. */
  paintSsd(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    windows: SsdWindowInfo[],
  ): void;
  /** Hit-test SSD chrome; returns action or null. */
  hitSsd(x: number, y: number): SsdAction | null;
  /** A client regained seat focus, including reactivation of the same client. */
  onClientFocus?(): void;
  onKey(ev: { code: number; value: number }): boolean;
  onPointerButton(ev: {
    timeMs: number;
    button: number;
    value: number;
    x: number;
    y: number;
  }): boolean;
  /** Pointer motion for top shell overlays and panel hover feedback. */
  onPointerMotion?(ev: { x: number; y: number }): boolean;
  /** Pointer motion over compositor-verified, unobscured SSD chrome. */
  onSsdPointerMotion?(ev: { x: number; y: number; inside: boolean }): boolean;
  /** Wheel input for launcher/menu scroll regions. */
  onPointerAxis?(ev: { x: number; y: number; deltaY: number }): boolean;
  setTasks?(tasks: TaskWindowInfo[]): void;
  setDesktopStatus(state: DesktopStatusState): void;
  /**
   * Pointer over empty desktop (no window under cursor).
   * Handles icon select / open. Returns true if consumed.
   */
  onDesktopPointerButton?(ev: {
    timeMs: number;
    button: number;
    value: number;
    x: number;
    y: number;
  }): boolean;
  /** Desktop icon hover tracking when no window under cursor. */
  onDesktopPointerMotion?(ev: { x: number; y: number }): void;
  isLauncherOpen(): boolean;
  /** True when panel/launcher/desktop content changed. */
  needsRepaint(): boolean;
  /** Drop panel/SSD caches after theme or prefs change. */
  invalidateChrome(): void;
  /**
   * Rasterize desktop icons and blend non-transparent pixels onto fb.
   * Call after wallpaper and before windows so icons appear under windows.
   * No-ops when showDesktopIcons is false.
   */
  paintDesktop(fb: Uint32Array, pitchPx: number, width: number, height: number): void;
  /**
   * Parse file:// URIs and place them on the desktop. If (x, y) lands on a
   * folder icon, moves into that folder instead of ~/Desktop's root.
   */
  acceptDesktopDrop(uris: string[], x: number, y: number): boolean;
  /** True if (x,y) is over a desktop drop zone (above the panel). */
  hitDesktop(x: number, y: number): boolean;
  /** Shell-owned drag preview, including desktop icon return animation. */
  paintDragPreview(
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    cursorX: number,
    cursorY: number,
    label: string,
  ): void;
  /** Revisioned drag preview used by retained compositor backends. */
  dragRaster(cursorX: number, cursorY: number, label: string): ShellRasterSurface | null;
  /** Label for an in-progress desktop icon drag, if any. */
  desktopDragLabel?(): string | null;
  /**
   * URI payload + label for the desktop icon currently mid local-reposition
   * drag, if any. The compositor escalates into a real DnD session with
   * this payload when the pointer crosses onto a client surface.
   */
  desktopDragUri?(): { uri: string; label: string } | null;
  /**
   * Called when an escalated (real-DnD) desktop-origin drag ends.
   * `commit=true`: finalize the reposition at (x, y). `commit=false`: the
   * item was handed to a client target — clear local state, keep layout.
   */
  finishDesktopDrag?(commit: boolean, x: number, y: number): void;
  /** Live-highlight a folder icon under (x, y) as a valid drop target. */
  onDesktopDragHover?(x: number, y: number, mimeTypes: string[]): void;
  /** Clear any desktop drop-hover highlight. */
  clearDesktopDragHover?(): void;
  /**
   * Force-clear an in-flight local desktop-icon drag (reposition, not yet
   * escalated to a real DnD session — that case is covered by the
   * compositor's own drag watchdog/Escape handling instead). The icon stays
   * at its last saved position; nothing is committed. Called on Escape.
   */
  cancelDesktopDrag?(x?: number, y?: number): void;
  /**
   * Polled unconditionally by the compositor (regardless of whether a real
   * DnD session is active) so a local desktop-icon drag that never receives
   * its terminating release event doesn't stay stuck forever — this state
   * never touches `this.drag`, so the compositor's own drag watchdog can't
   * see it.
   */
  checkDesktopDragWatchdog?(): void;
};

const KEY_ESC = 1;
const KEY_ENTER = 28;
const KEY_LEFTCTRL = 29;
const KEY_LEFTSHIFT = 42;
const KEY_SPACE = 57;
const KEY_HOME = 102;
const KEY_UP = 103;
const KEY_LEFT = 105;
const KEY_RIGHT = 106;
const KEY_END = 107;
const KEY_DOWN = 108;
const KEY_RIGHTCTRL = 97;
const KEY_RIGHTSHIFT = 54;
const KEY_LEFTMETA = 125;
const KEY_RIGHTMETA = 126;

const US_MAP: Record<number, string> = {
  16: "q",
  17: "w",
  18: "e",
  19: "r",
  20: "t",
  21: "y",
  22: "u",
  23: "i",
  24: "o",
  25: "p",
  30: "a",
  31: "s",
  32: "d",
  33: "f",
  34: "g",
  35: "h",
  36: "j",
  37: "k",
  38: "l",
  44: "z",
  45: "x",
  46: "c",
  47: "v",
  48: "b",
  49: "n",
  50: "m",
  2: "1",
  3: "2",
  4: "3",
  5: "4",
  6: "5",
  7: "6",
  8: "7",
  9: "8",
  10: "9",
  11: "0",
  57: " ",
  12: "-",
  13: "=",
  26: "[",
  27: "]",
  39: ";",
  40: "'",
  41: "`",
  43: "\\",
  51: ",",
  52: ".",
  53: "/",
};

const US_SHIFT_MAP: Record<number, string> = {
  2: "!",
  3: "@",
  4: "#",
  5: "$",
  6: "%",
  7: "^",
  8: "&",
  9: "*",
  10: "(",
  11: ")",
  12: "_",
  13: "+",
  26: "{",
  27: "}",
  39: ":",
  40: '"',
  41: "~",
  43: "|",
  51: "<",
  52: ">",
  53: "?",
};

type ShellAppProps = {
  width: number;
  height: number;
  primaryOutput: { x: number; y: number; width: number; height: number };
  open: boolean;
  query: string;
  selected: number;
  launchState: LauncherLaunchState;
  apps: DesktopEntry[];
  tasks: TaskWindowInfo[];
  clock: string;
  onToggle: () => void;
  onQuery: (q: string) => void;
  onSelect: (i: number) => void;
  onLaunch: (app: DesktopEntry) => void;
  onDismiss: () => void;
  onTaskPress: (task: TaskWindowInfo) => void;
  controlsOpen: boolean;
  notificationsOpen: boolean;
  taskOverflowOpen: boolean;
  overflowAnchor: PopupAnchor | null;
  overflowTasks: readonly TaskWindowInfo[];
  onTaskOverflowToggle(anchor: PopupAnchor, tasks: readonly TaskWindowInfo[]): void;
  onTaskOverflowPress(task: TaskWindowInfo): void;
  controlsView: "main" | QuickSettingsDetailsView;
  notificationView: "active" | "history";
  volumeDraft?: { value: number; caption: string };
  onLogout?: () => void;
  onControlsView(view: "main" | QuickSettingsDetailsView): void;
  onNotificationView(view: "active" | "history"): void;
  onNotificationsToggle(): void;
  onVolumeStart(): void;
  onVolumeChange(value: number): void;
  onVolumeCommit(value: number): void;
  onVolumeCancel(): void;
  wifiSelection?: WifiAccessPoint;
  wifiPassword: string;
  onWifiSelect(ap: WifiAccessPoint): void;
  onWifiPasswordChange(value: string): void;
  onWifiConnect(): void;
  onWifiCancel(): void;
  onWifiRefresh(): void;
  onWifiSelectionCancel(): void;
  onBluetoothChange(device: BluetoothDevice, connected: boolean): void;
  onBluetoothRefresh(): void;
  onBluetoothDiscoveryStart?: (adapterId: BluetoothId) => void;
  onBluetoothDiscoveryStop?: () => void;
  onBluetoothPair?: (device: BluetoothNearbyDevice) => void;
  onBluetoothPairCancel?: () => void;
  onBluetoothPromptResponse?: (promptId: BluetoothId, accepted: boolean) => void;
  onBluetoothInputResponse?: (promptId: BluetoothId, value: string) => void;
  onBluetoothTrustRequest?: (device: BluetoothDevice, trusted: boolean) => void;
  onBluetoothTrustConfirm?: (challengeId: BluetoothId) => void;
  onBluetoothTrustCancel?: (challengeId: BluetoothId) => void;
  onSettings(): void;
  status: DesktopStatusState;
  cachedCapabilities?: DesktopCapabilities;
  cachedNetworkPresentation?: NetworkPresentation;
  controlsBusy: boolean;
  volumeBlocked: boolean;
  controlsError: string;
  controlsScrollY: number;
  onControlsScroll: (value: number, metrics?: ScrollMetrics) => void;
  onControlsToggle: () => void;
  onControlsDismiss: () => void;
  onControlAction: (action: (actions: DesktopControlActions) => Promise<void>) => void;
};

function ShellApp(props: ShellAppProps) {
  const filtered = useMemo(
    () => filterApplications(props.apps, props.query),
    [props.apps, props.query],
  );

  useEffect(() => {
    if (props.selected >= filtered.length) {
      props.onSelect(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, props.selected, props.onSelect]);

  const anchors = panelStatusGeometry({
    screenW: props.primaryOutput.width,
    screenH: props.primaryOutput.height,
    clock: props.clock,
    onControlsClick: props.onControlsToggle,
    onNotificationsClick: props.onNotificationsToggle,
    onTaskOverflowClick: props.onTaskOverflowToggle,
    taskCount: props.tasks.length,
    status: props.status,
    cachedCapabilities: props.cachedCapabilities,
    notificationCount:
      props.status.kind === "ready"
        ? props.status.snapshot.notices.filter((item) => !item.closed).length
        : 0,
  });
  return createElement(
    "group",
    { x: 0, y: 0, width: props.width, height: props.height },
    createElement(
      "group",
      {
        x: props.primaryOutput.x,
        y: props.primaryOutput.y,
        width: props.primaryOutput.width,
        height: props.primaryOutput.height,
      },
      createElement(Panel, {
        screenW: props.primaryOutput.width,
        screenH: props.primaryOutput.height,
        clock: props.clock,
        tasks: props.tasks,
        onLauncherClick: props.onToggle,
        onTaskPress: props.onTaskPress,
        onControlsClick: props.onControlsToggle,
        onNotificationsClick: props.onNotificationsToggle,
        onTaskOverflowClick: props.onTaskOverflowToggle,
        status: props.status,
        cachedCapabilities: props.cachedCapabilities,
        cachedNetworkPresentation: props.cachedNetworkPresentation,
        notificationCount:
          props.status.kind === "ready"
            ? props.status.snapshot.notices.filter((item) => !item.closed).length
            : 0,
      }),
      createElement(Launcher, {
        open: props.open,
        screenW: props.primaryOutput.width,
        screenH: props.primaryOutput.height,
        apps: filtered,
        query: props.query,
        selected: props.selected,
        launchState: props.launchState,
        onQueryChange: props.onQuery,
        onLaunch: props.onLaunch,
        onDismiss: props.onDismiss,
        onSelect: props.onSelect,
      }),
      props.controlsOpen || props.notificationsOpen || props.taskOverflowOpen
        ? null
        : createElement(NotificationBanner, {
            screenW: props.primaryOutput.width,
            state: props.status,
            onDismiss: (id: number, revision: number) =>
              props.onControlAction((actions) => actions.dismiss(id, revision)),
          }),
      createElement(QuickSettings, {
        open: props.controlsOpen,
        screenW: props.primaryOutput.width,
        screenH: props.primaryOutput.height,
        state: props.status,
        cachedCapabilities: props.cachedCapabilities,
        cachedNetworkPresentation: props.cachedNetworkPresentation,
        busy: props.controlsBusy,
        error: props.controlsError,
        scrollY: props.controlsScrollY,
        onScroll: props.onControlsScroll,
        anchor: anchors.controls!,
        view: props.controlsView,
        onViewChange: props.onControlsView,
        onLogout: props.onLogout,
        volumeDraft: props.volumeDraft,
        onVolumeStart: props.onVolumeStart,
        onVolumeChange: props.volumeBlocked ? undefined : props.onVolumeChange,
        onVolumeCommit: props.onVolumeCommit,
        onVolumeCancel: props.onVolumeCancel,
        wifiSelection: props.wifiSelection,
        wifiPassword: props.wifiPassword,
        onWifiSelect: props.onWifiSelect,
        onWifiPasswordChange: props.onWifiPasswordChange,
        onWifiConnect: props.onWifiConnect,
        onWifiCancel: props.onWifiCancel,
        onWifiRefresh: props.onWifiRefresh,
        onWifiSelectionCancel: props.onWifiSelectionCancel,
        onBluetoothChange: props.onBluetoothChange,
        onBluetoothRefresh: props.onBluetoothRefresh,
        onBluetoothDiscoveryStart: props.onBluetoothDiscoveryStart,
        onBluetoothDiscoveryStop: props.onBluetoothDiscoveryStop,
        onBluetoothPair: props.onBluetoothPair,
        onBluetoothPairCancel: props.onBluetoothPairCancel,
        onBluetoothPromptResponse: props.onBluetoothPromptResponse,
        onBluetoothInputResponse: props.onBluetoothInputResponse,
        onBluetoothTrustRequest: props.onBluetoothTrustRequest,
        onBluetoothTrustConfirm: props.onBluetoothTrustConfirm,
        onBluetoothTrustCancel: props.onBluetoothTrustCancel,
        onMuteChange: props.volumeBlocked
          ? undefined
          : (value) => props.onControlAction((actions) => actions.setMute(value)),
        onDoNotDisturbChange: (value) =>
          props.onControlAction((actions) => actions.setDoNotDisturb(value)),
        onSettings: props.onSettings,
        onDismiss: props.onControlsDismiss,
      }),
      createElement(TaskOverflow, {
        open: props.taskOverflowOpen,
        screenW: props.primaryOutput.width,
        screenH: props.primaryOutput.height,
        anchor: props.overflowAnchor ?? anchors.controls!,
        tasks: props.overflowTasks,
        onTaskPress: props.onTaskOverflowPress,
        onDismiss: props.onControlsDismiss,
      }),
      createElement(NotificationsTray, {
        open: props.notificationsOpen,
        screenW: props.primaryOutput.width,
        screenH: props.primaryOutput.height,
        anchor: anchors.notifications!,
        state: props.status,
        busy: props.controlsBusy,
        error: props.controlsError,
        now: Date.now(),
        view: props.notificationView,
        onViewChange: props.onNotificationView,
        scrollY: props.controlsScrollY,
        onScroll: props.onControlsScroll,
        onClose: props.onControlsDismiss,
        onClearAll: (pairs) =>
          props.onControlAction(async (actions) => {
            const result = await actions.dismissMany(pairs);
            if (result.skipped)
              throw new Error(
                `${result.dismissed} dismissed; ${result.skipped} changed or closed notices preserved`,
              );
          }),
        onInvokeAction: (id, key, revision) =>
          props.onControlAction((actions) => actions.invokeAction(id, key, revision)),
        onDismiss: (id: number, revision: number) =>
          props.onControlAction((actions) => actions.dismiss(id, revision)),
      }),
    ),
  );
}

/**
 * In-process DE shell: bottom panel + Super-key launcher + SSD titlebars.
 */
export function createShell(
  spawn: ShellSpawn,
  onTaskAction: (action: TaskWindowAction) => void = () => {},
  controls?: DesktopControlActions,
  observeScroll?: ((event: ShellScrollObservation) => void) & { active?: () => boolean },
  onLogout?: () => void,
): ShellBridge {
  const root: ShellRoot = createShellRoot();
  let primaryOutput = { x: 0, y: 0, width: 1, height: 1 };
  const moireRoot =
    process.env.MOIRE_ROOT ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const settingsExec = `pnpm --dir ${shellQuote(moireRoot)} --filter @moire/settings start`;
  const filesExec = `pnpm --dir ${shellQuote(moireRoot)} --filter @moire/files start`;
  const builtinApps: DesktopEntry[] = [
    {
      id: "moire-settings.desktop",
      name: "Settings",
      comment: "Moire system settings",
      exec: settingsExec,
      icon: "preferences-system",
      terminal: false,
      categories: ["Settings", "System"],
    },
    {
      id: "moire-files.desktop",
      name: "Files",
      comment: "Moire file browser",
      exec: filesExec,
      icon: "system-file-manager",
      terminal: false,
      categories: ["FileManager", "System"],
    },
  ];
  const mergeApps = (): DesktopEntry[] => [
    ...builtinApps,
    ...discoverApplications(process.env.XDG_CURRENT_DESKTOP ?? "Moire").filter(
      (app) => app.id !== "moire-settings.desktop" && app.id !== "moire-files.desktop",
    ),
  ];
  let apps = mergeApps();
  const createActivationService = (applications: DesktopEntry[]) =>
    new FileActivationService((activation) => {
      const child = spawn({ exec: activation.command });
      child.unref?.();
      console.log(`[shell] file activation: ${activation.filePath} → ${activation.command}`);
    }, applications);
  let activation = createActivationService(apps);
  const activationPortal = new FileActivationPortalClient();
  let mimeDb = activation.mimeDatabase;
  let open = process.env.MOIRE_SHELL_START_OPEN === "1";
  let popup: "controls" | "notifications" | "windows" | null = null;
  let taskOverflow: { anchor: PopupAnchor; keys: readonly string[] } | null = null;
  const popupOpen = () => popup !== null;
  const popupScope = () => {
    const pairing = status.kind === "ready" ? status.snapshot.bluetooth.pairing : null;
    if (
      popup === "controls" &&
      controlsView === "bluetooth" &&
      pairing?.kind === "ready" &&
      pairing.prompt &&
      bluetoothFlow?.owner === (status.kind === "ready" ? status.owner : null) &&
      bluetoothFlow.leaseId === pairing.lease?.id
    )
      return `quick:bluetooth:prompt:${pairing.prompt.id}`;
    const trust = status.kind === "ready" ? status.snapshot.bluetooth.trust : null;
    if (
      popup === "controls" &&
      controlsView === "bluetooth" &&
      trust?.kind === "ready" &&
      trust.operation.kind === "confirmation"
    )
      return `quick:bluetooth:trust:${trust.operation.challengeId}`;
    return popup === "controls"
      ? QUICK_SETTINGS_SCOPE
      : popup === "windows"
        ? TASK_WINDOWS_SCOPE
        : NOTIFICATIONS_SCOPE;
  };
  let controlsView: "main" | QuickSettingsDetailsView = "main";
  let notificationView: "active" | "history" = "active";
  let bluetoothViewEpoch = 0;
  let controlsBusy = false;
  let controlsError = "";
  let controlsFocusId: string | null = null;
  let controlsFocusedHit: HitRegion | null = null;
  let controlsScrollY = 0;
  let scrollPaintPending = false;
  let scrollViewport: { x: number; y: number; width: number; height: number } | null = null;
  const forwardedModifiers = new Set<number>();
  let status: DesktopStatusState = { kind: "unavailable", message: "Desktop controls unavailable" };
  let bluetoothFlow: { owner: string; leaseId: BluetoothId } | null = null;
  let bluetoothStart: { owner: string; epoch: number; canceled: boolean } | null = null;
  let bluetoothPromptFocus: {
    id: BluetoothId;
    restoreId: string | null;
    restoreScrollY: number;
  } | null = null;
  let bluetoothTrustFlow: { owner: string; challengeId: BluetoothId } | null = null;
  let bluetoothTrustStart: { owner: string; epoch: number; canceled: boolean } | null = null;
  const bluetoothPendingActions = new Set<string>();
  const trustObservation = () => {
    if (status.kind !== "ready") return null;
    const trust = status.snapshot.bluetooth.trust;
    return trust?.kind === "ready" && trust.operation.kind === "confirmation"
      ? { owner: status.owner, revision: status.snapshot.revision, operation: trust.operation }
      : null;
  };
  const cancelTrust = (challengeId: BluetoothId) => {
    const current = trustObservation(),
      flow = bluetoothTrustFlow;
    if (
      !current ||
      !flow ||
      current.owner !== flow.owner ||
      current.operation.challengeId !== challengeId ||
      flow.challengeId !== challengeId ||
      !controls?.cancelBluetoothTrust
    )
      return;
    bluetoothAction(
      `trust-cancel:${challengeId}`,
      () =>
        controls.cancelBluetoothTrust!({
          owner: flow.owner,
          revision: current.revision,
          challengeId,
        }),
      () => popup === "controls" && controlsView === "bluetooth",
    );
  };
  const cleanupBluetoothTrust = () => {
    if (bluetoothTrustStart) bluetoothTrustStart.canceled = true;
    const flow = bluetoothTrustFlow;
    if (flow) cancelTrust(flow.challengeId);
    bluetoothTrustFlow = null;
  };
  const pairingObservation = () => {
    if (status.kind !== "ready") return null;
    const pairing = status.snapshot.bluetooth.pairing;
    return pairing?.kind === "ready"
      ? { owner: status.owner, revision: status.snapshot.revision, pairing }
      : null;
  };
  const cleanupBluetoothFlow = () => {
    cleanupBluetoothTrust();
    if (bluetoothStart) bluetoothStart.canceled = true;
    const flow = bluetoothFlow,
      current = pairingObservation();
    bluetoothFlow = null;
    bluetoothPromptFocus = null;
    if (
      !flow ||
      !current ||
      current.owner !== flow.owner ||
      current.pairing.lease?.id !== flow.leaseId ||
      !controls?.stopBluetoothDiscovery
    )
      return;
    void controls
      .stopBluetoothDiscovery({ ...flow, revision: current.revision })
      .catch((error) => console.warn("[shell] Bluetooth cleanup outcome", error));
  };
  const bluetoothAction = (key: string, action: () => Promise<void>, isCurrent: () => boolean) => {
    if (bluetoothPendingActions.has(key)) return;
    bluetoothPendingActions.add(key);
    controlsError = "";
    dirty = true;
    void action()
      .catch((error) => {
        if (isCurrent()) controlsError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        bluetoothPendingActions.delete(key);
        dirty = true;
      });
  };
  const volumeIntent = createVolumeIntent(status);
  // A password exists only in this popup's transient draft. It is never a preference.
  let wifiDraft: { owner: string; ap: WifiAccessPoint; password: string } | null = null;
  let cachedCapabilities: DesktopCapabilities | undefined;
  let cachedNetworkPresentation: NetworkPresentation | undefined;
  let query = "";
  let selected = 0;
  let launchState: LauncherLaunchState = { kind: "idle" };
  let clock = formatClock();
  let tasks: TaskWindowInfo[] = [];
  let dirty = true;
  const initialSettings = loadSettings();
  let showDesktopIcons = initialSettings.showDesktopIcons;
  setUiScaleFactor(initialSettings.uiScale);
  void installUiFonts().then(() => {
    dirty = true;
    console.log("[shell] TTF fonts ready (@moire/ui)");
  });
  if (open) console.log("[shell] launcher start-open (MOIRE_SHELL_START_OPEN)");
  let hits: HitRegion[] = [];
  let overlay: Uint8Array | null = null;
  let overlayRevision = 0;
  type AlphaRuns = Array<Int32Array | null>;
  let overlayRuns: AlphaRuns | null = null;
  let ow = 0;
  let oh = 0;
  let metaHeld = false;
  let ctrlHeld = false;
  let shiftHeld = false;
  let altHeld = false;
  let overlayGrab: {
    button: number;
    hit: HitRegion | null;
    activation: HitRegion | null;
  } | null = null;
  let shellHover: HitRegion | null = null;

  type SsdHit = HitRegion & { identity: string; stripKey: string };
  type SsdStrip = {
    root: ShellRoot;
    pixels: Uint8Array;
    w: number;
    h: number;
    hits: HitRegion[];
    signature: string;
    dirty: boolean;
    revision: number;
  };
  let ssdHits: SsdHit[] = [];
  let ssdHover: SsdHit | null = null;
  let ssdAnimationActive = false;
  let ssdPending: { current: SsdAction | null } = { current: null };
  /** One persistent React root per window keeps control motion state local. */
  const ssdStripCache = new Map<string, SsdStrip>();
  const ssdSeen = new Set<string>();

  // ── Desktop icons state ────────────────────────────────────────────────────
  const desktopRoot: ShellRoot = createShellRoot();
  let desktopEntries: string[] = listDesktopEntries();
  let desktopLayout: DesktopLayout = loadDesktopLayout();
  let desktopSelection: SelectionState<string> = createSelectionState(desktopEntries);
  let desktopKeyboardActive = false;
  let desktopMenu:
    | { kind: "item"; name: string; x: number; y: number }
    | { kind: "background"; x: number; y: number }
    | null = null;
  /** Folder icon currently hovered by an active external/escalated drag. */
  let desktopDropHoverName: string | null = null;
  /** A compatible drag is over the desktop, regardless of a specific folder hit. */
  let desktopDragActive = false;
  let desktopHits: HitRegion[] = [];
  let desktopOverlay: Uint8Array | null = null;
  let desktopRevision = 0;
  let desktopOverlayRuns: AlphaRuns | null = null;
  let desktopW = 0;
  let desktopH = 0;
  let desktopDirty = true;
  let desktopHover: HitRegion | null = null;
  let desktopDown: { x: number; y: number; hit: HitRegion; name?: string } | null = null;
  let desktopDrag: {
    name: string;
    names: string[];
    label: string;
    origins: DesktopLayout;
    grabX: number;
    grabY: number;
    originX: number;
    originY: number;
    lastX: number;
    lastY: number;
  } | null = null;
  let desktopDragReturn: {
    name: string;
    label: string;
    originX: number;
    originY: number;
    fromX: number;
    fromY: number;
    startedMs: number;
    durationMs: number;
  } | null = null;
  /**
   * When `desktopDrag` started. Purely local (never touches the compositor
   * DnD session), so the compositor's own drag watchdog can't see it — if
   * this gesture's release is ever lost, nothing else clears it. Checked by
   * `checkDesktopDragWatchdog`, polled by the compositor unconditionally.
   */
  let desktopDragStartMs = 0;
  const DESKTOP_DRAG_WATCHDOG_TIMEOUT_MS = 15_000;
  let desktopMotionTick = Date.now();
  const PANEL_BTN_LEFT = 0x110; // BTN_LEFT
  const PANEL_BTN_RIGHT = 0x111; // BTN_RIGHT
  const dragChipRoot: ShellRoot = createShellRoot();
  let dragChipCache: {
    key: string;
    pixels: Uint8Array;
    w: number;
    h: number;
  } | null = null;
  let dragChipRevision = 0;
  const DESKTOP_DRAG_THRESHOLD = 8;

  const updateDesktopSelection = (action: SelectionAction<string>): void => {
    const next = reduceSelection(desktopSelection, desktopEntries, action);
    if (next === desktopSelection) return;
    desktopSelection = next;
    desktopDirty = true;
    dirty = true;
  };

  const selectedDesktopNames = (): string[] =>
    desktopEntries.filter((name) => desktopSelection.selectedKeys.has(name));

  const selectDesktopName = (
    name: string,
    modifiers: { toggle?: boolean; range?: boolean } = {},
  ): void => {
    updateDesktopSelection({ type: "select", key: name, gesture: modifiers });
  };

  const desktopNeighbor = (
    fromName: string,
    direction: "left" | "right" | "up" | "down",
  ): string | null => {
    const fromIndex = desktopEntries.indexOf(fromName);
    if (fromIndex < 0) return desktopEntries[0] ?? null;
    const from = desktopIconPosition(
      fromName,
      fromIndex,
      desktopLayout,
      desktopW || 1,
      desktopH || 1,
      themePalette().panelHeight,
    );
    let best: { name: string; score: number } | null = null;
    for (let index = 0; index < desktopEntries.length; index++) {
      const name = desktopEntries[index]!;
      if (name === fromName) continue;
      const candidate = desktopIconPosition(
        name,
        index,
        desktopLayout,
        desktopW || 1,
        desktopH || 1,
        themePalette().panelHeight,
      );
      const dx = candidate.x - from.x;
      const dy = candidate.y - from.y;
      const primary =
        direction === "left" ? -dx : direction === "right" ? dx : direction === "up" ? -dy : dy;
      if (primary <= 0) continue;
      const cross = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
      const score = primary + cross * 2;
      if (!best || score < best.score) best = { name, score };
    }
    return best?.name ?? fromName;
  };

  const moveDesktopSelection = (direction: "left" | "right" | "up" | "down"): void => {
    const from = desktopSelection.focusKey ?? desktopEntries[0] ?? null;
    if (!from) return;
    const target = desktopNeighbor(from, direction);
    if (!target) return;
    if (ctrlHeld && !shiftHeld) {
      updateDesktopSelection({ type: "focus", key: target, select: false });
    } else {
      selectDesktopName(target, { range: shiftHeld });
    }
  };

  const refreshApps = () => {
    const nextApps = mergeApps();
    const appsChanged =
      nextApps.length !== apps.length ||
      nextApps.some((app, index) => {
        const current = apps[index];
        return (
          !current ||
          app.id !== current.id ||
          app.name !== current.name ||
          app.genericName !== current.genericName ||
          app.exec !== current.exec ||
          app.icon !== current.icon ||
          app.terminal !== current.terminal ||
          app.categories.join("\0") !== current.categories.join("\0") ||
          (app.mimeTypes ?? []).join("\0") !== (current.mimeTypes ?? []).join("\0")
        );
      });
    apps = nextApps;
    activation = createActivationService(apps);
    mimeDb = activation.mimeDatabase;
    if (appsChanged) dirty = true;
  };
  setInterval(refreshApps, 30_000).unref?.();

  const refreshDesktop = () => {
    const nextEntries = listDesktopEntries();
    const nextLayout = loadDesktopLayout();
    const entriesChanged =
      nextEntries.length !== desktopEntries.length ||
      nextEntries.some((entry, index) => entry !== desktopEntries[index]);
    const layoutNames = Object.keys(desktopLayout);
    const nextLayoutNames = Object.keys(nextLayout);
    const layoutChanged =
      nextLayoutNames.length !== layoutNames.length ||
      nextLayoutNames.some((name) => {
        const current = desktopLayout[name];
        const next = nextLayout[name];
        return !current || !next || current.x !== next.x || current.y !== next.y;
      });
    if (!entriesChanged && !layoutChanged) return;
    desktopEntries = nextEntries;
    desktopLayout = nextLayout;
    desktopSelection = reconcileSelection(desktopSelection, desktopEntries);
    desktopDirty = true;
  };
  // Refresh desktop list every 2s to catch external changes
  setInterval(refreshDesktop, 2_000).unref?.();

  const openDesktopEntry = (name: string) => {
    const filePath = path.join(desktopDir(), name);
    try {
      if (!activation.openDefault(filePath)) {
        const exec = `xdg-open ${pathToFileURL(filePath).href}`;
        const child = spawn({ exec });
        child.unref?.();
        console.log(`[shell] desktop open fallback: ${filePath} → ${exec}`);
      }
    } catch (err) {
      console.error(`[shell] desktop open failed:`, err);
    }
  };

  const showDesktopOpenWith = (name: string) => {
    const filePath = path.join(desktopDir(), name);
    desktopMenu = null;
    dirty = true;
    void activationPortal
      .openWith(filePath)
      .then(() => {
        activation.refreshAssociations();
        desktopDirty = true;
      })
      .catch((error) => console.error("[shell] Open With failed", error));
  };

  const desktopActionRegistry = new ContextActionRegistry();
  desktopActionRegistry.register({
    id: "moire.open",
    actions(context) {
      if (context.paths.length === 0) return [];
      const openActions = [
        {
          id: "open",
          label: context.paths.length === 1 ? "Open" : `Open ${context.paths.length} Items`,
          icon: context.directories.every(Boolean) ? "folder" : "file",
          run: () => {
            context.paths.forEach((filePath) => openDesktopEntry(path.basename(filePath)));
          },
        },
      ];
      if (context.paths.length !== 1 || context.directories[0]) {
        return openActions;
      }
      const name = path.basename(context.paths[0]!);
      return [
        ...openActions,
        {
          id: "open-with",
          label: "Open With…",
          description: "Choose a compatible application",
          icon: "app",
          run: () => showDesktopOpenWith(name),
        },
      ];
    },
  });
  desktopActionRegistry.register({
    id: "moire.location",
    actions(context) {
      if (context.paths.length !== 1) return [];
      const filePath = context.paths[0];
      if (!filePath) return [];
      return [
        {
          id: "show-in-files",
          label: "Show in Files",
          icon: "folder",
          separatorBefore: true,
          run: () => {
            const child = spawn({ exec: `xdg-open ${pathToFileURL(path.dirname(filePath)).href}` });
            child.unref?.();
          },
        },
      ];
    },
  });

  const desktopContextActions = (name: string): ContextMenuAction[] => {
    const targetNames = desktopSelection.selectedKeys.has(name) ? selectedDesktopNames() : [name];
    const paths = targetNames.map((target) => path.join(desktopDir(), target));
    const context: FileActionContext = {
      source: "desktop",
      scope: "items",
      currentDirectory: desktopDir(),
      paths,
      mimeTypes: paths.map((filePath) => mimeDb.mimeTypeForPath(filePath)),
      directories: paths.map((filePath) => {
        try {
          return fs.statSync(filePath).isDirectory();
        } catch {
          return false;
        }
      }),
    };
    return desktopActionRegistry.actionsFor(context).map((action) => ({
      id: action.id,
      label: action.label,
      description: action.description,
      icon: (["app", "file", "folder"] as IconName[]).includes(action.icon as IconName)
        ? (action.icon as IconName)
        : undefined,
      danger: action.danger,
      disabled: action.enabled === false,
      separatorBefore: action.separatorBefore,
      onPress: action.run,
    }));
  };

  const createDesktopFolder = (): void => {
    const root = desktopDir();
    for (let index = 1; index < 10_000; index++) {
      const name = index === 1 ? "New Folder" : `New Folder ${index}`;
      try {
        fs.mkdirSync(path.join(root, name), { recursive: false });
        refreshDesktop();
        selectDesktopName(name);
        desktopKeyboardActive = true;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
          console.error("[shell] new desktop folder failed:", error);
          return;
        }
      }
    }
  };

  desktopActionRegistry.register({
    id: "moire.background",
    actions(context) {
      if (context.scope !== "background") return [];
      return [
        {
          id: "new-folder",
          label: "New Folder",
          icon: "folder",
          run: createDesktopFolder,
        },
        {
          id: "select-all",
          label: "Select All",
          icon: "grid",
          enabled: desktopEntries.length > 0,
          run: () => updateDesktopSelection({ type: "all" }),
        },
        {
          id: "open-in-files",
          label: "Open Desktop in Files",
          icon: "folder",
          separatorBefore: true,
          run: () => {
            const child = spawn({
              exec: `${filesExec} ${JSON.stringify(pathToFileURL(desktopDir()).href)}`,
            });
            child.unref?.();
          },
        },
        {
          id: "arrange-icons",
          label: "Arrange Icons",
          icon: "grid",
          run: () => {
            desktopLayout = {};
            saveDesktopLayout(desktopLayout);
            desktopDirty = true;
          },
        },
        {
          id: "refresh",
          label: "Refresh Desktop",
          icon: "desktop",
          run: refreshDesktop,
        },
        {
          id: "change-background",
          label: "Change Background…",
          icon: "app",
          separatorBefore: true,
          run: () => {
            const child = spawn({ exec: settingsExec });
            child.unref?.();
          },
        },
      ];
    },
  });

  const desktopBackgroundActions = (): ContextMenuAction[] =>
    desktopActionRegistry
      .actionsFor({
        source: "desktop",
        scope: "background",
        currentDirectory: desktopDir(),
        paths: [],
        mimeTypes: [],
        directories: [],
      })
      .map((action) => ({
        id: action.id,
        label: action.label,
        description: action.description,
        icon: (["app", "desktop", "folder", "grid"] as IconName[]).includes(action.icon as IconName)
          ? (action.icon as IconName)
          : undefined,
        danger: action.danger,
        disabled: action.enabled === false,
        separatorBefore: action.separatorBefore,
        onPress: action.run,
      }));
  setInterval(() => {
    const next = formatClock();
    if (next !== clock) {
      clock = next;
      dirty = true;
    }
  }, 1000).unref?.();

  const dismissLauncher = () => {
    open = false;
    query = "";
    selected = 0;
    launchState = { kind: "idle" };
    dirty = true;
  };
  const dismissControls = () => {
    cleanupBluetoothFlow();
    bluetoothViewEpoch++;
    (hits.find((hit) => hit.focusId === controlsFocusId) ?? controlsFocusedHit)?.onFocusChange?.(
      false,
    );
    controlsFocusedHit = null;
    controlsFocusId = null;
    popup = null;
    taskOverflow = null;
    volumeIntent.cancel();
    wifiDraft = null;
    dirty = true;
  };
  const toggleControls = () => {
    if (popup === "controls") {
      dismissControls();
      return;
    }
    dismissControls();
    dismissLauncher();
    popup = "controls";
    controlsView = "main";
    controlsError = "";
    controlsFocusId = null;
    controlsScrollY = 0;
    dirty = true;
    ensureOverlayHits();
    hits.find((hit) => hit.focusId === controlsFocusId)?.onFocusChange?.(true);
    dirty = true;
  };
  const resetPopupFocus = () => {
    (hits.find((hit) => hit.focusId === controlsFocusId) ?? controlsFocusedHit)?.onFocusChange?.(
      false,
    );
    controlsFocusedHit = null;
    volumeIntent.cancel();
    controlsFocusId = null;
    controlsScrollY = 0;
    dirty = true;
  };
  const toggleNotifications = () => {
    if (popup === "notifications") {
      dismissControls();
      return;
    }
    dismissControls();
    dismissLauncher();
    popup = "notifications";
    notificationView = "active";
    controlsError = "";
    resetPopupFocus();
    ensureOverlayHits();
  };
  const toggleTaskOverflow = (anchor: PopupAnchor, hiddenTasks: readonly TaskWindowInfo[]) => {
    if (popup === "windows") {
      dismissControls();
      return;
    }
    dismissControls();
    dismissLauncher();
    taskOverflow = {
      anchor: { ...anchor },
      keys: hiddenTasks.map((task) => `${task.clientId}:${task.surfaceId}`),
    };
    popup = "windows";
    resetPopupFocus();
    ensureOverlayHits();
  };
  const activateOverflowTask = (task: TaskWindowInfo) => {
    const current = tasks.find(
      (item) => item.clientId === task.clientId && item.surfaceId === task.surfaceId,
    );
    dismissControls();
    if (current) onTaskAction({ clientId: current.clientId, surfaceId: current.surfaceId });
  };
  const volumeDraft = () => {
    const draft = volumeIntent.state;
    if (draft.kind === "editing")
      return { value: draft.value, caption: `Requested ${Math.round(draft.value * 100)}%` };
    if (draft.kind === "pending" || draft.kind === "unknown")
      return {
        value: draft.intent.value,
        caption:
          draft.kind === "pending"
            ? `Updating to ${Math.round(draft.intent.value * 100)}%…`
            : draft.message,
      };
    return undefined;
  };
  const volumeLocked = () =>
    volumeIntent.state.kind === "pending" || volumeIntent.state.kind === "unknown";
  const commitVolume = (value: number) => {
    volumeIntent.change(value);
    const intent = volumeIntent.commit();
    if (!intent || !controls) return;
    if (
      status.kind !== "ready" ||
      status.owner !== intent.owner ||
      status.snapshot.revision !== intent.revision
    )
      return;
    controlsBusy = true;
    controlsError = "";
    dirty = true;
    void controls
      .setVolume(intent.value)
      .then(
        () => volumeIntent.result(intent, { kind: "succeeded" }),
        (error) => {
          const message = error instanceof Error ? error.message : String(error);
          volumeIntent.result(intent, {
            kind: "unknown",
            message: "Outcome unknown; waiting for actual sound status",
          });
          controlsError = message;
        },
      )
      .finally(() => {
        controlsBusy = false;
        dirty = true;
      });
  };
  const controlAction = (
    action: (actions: DesktopControlActions) => Promise<void>,
    isCurrent: () => boolean = () => true,
  ) => {
    if (controlsBusy || !controls) return;
    controlsBusy = true;
    controlsError = "";
    dirty = true;
    void action(controls)
      .catch((error) => {
        if (isCurrent()) controlsError = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        controlsBusy = false;
        dirty = true;
      });
  };
  const connectWifi = () => {
    const draft = wifiDraft;
    if (
      !draft ||
      !controls ||
      controlsBusy ||
      status.kind !== "ready" ||
      status.owner !== draft.owner ||
      status.snapshot.wifi.kind !== "ready"
    )
      return;
    const wifi = status.snapshot.wifi;
    if (
      !wifi.canConnect ||
      wifi.operation.kind === "connecting" ||
      wifi.operation.kind === "cancelling" ||
      wifi.operation.kind === "unknown"
    )
      return;
    const ap = wifi.accessPoints.find((ap) => ap.id === draft.ap.id);
    if (!ap || ap.ssid !== draft.ap.ssid || ap.security !== draft.ap.security || ap.connected) {
      wifiDraft = null;
      controlsError = "Wi-Fi selection changed; choose the network again";
      dirty = true;
      return;
    }
    wifiDraft = null;
    controlAction(async (actions) => {
      try {
        await actions.connectWifi(ap.id, draft.password);
      } catch {
        // Never display a remote daemon's raw error beside a submitted secret.
        throw new Error("Wi-Fi request failed; check the observed network status");
      }
    });
  };

  const launch = (app: DesktopEntry) => {
    if (launchState.kind === "pending") return;
    const attempt: LauncherLaunchState = { kind: "pending", appName: app.name };
    launchState = attempt;
    dirty = true;
    const exec = app.terminal ? `moire-terminal --command ${shellQuote(app.exec)}` : app.exec;
    const started = () => {
      if (launchState !== attempt) return;
      console.log(`[shell] launch ${app.id} → ${exec}`);
      dismissLauncher();
    };
    const failed = (error: unknown) => {
      console.error(`[shell] launch failed ${app.id}:`, error);
      if (launchState !== attempt) return;
      launchState = { kind: "failed", appName: app.name };
      dirty = true;
    };
    try {
      const child = spawn({ exec });
      if (child.once) {
        child.once("error", failed);
        child.once("spawn", started);
      } else {
        started();
      }
      child.unref?.();
    } catch (error) {
      failed(error);
    }
  };

  const rebuild = (width: number, height: number) => {
    // Bind actions to this observation, never to a later service owner or revision.
    const bluetoothObservation = status;
    const bluetoothEpoch = bluetoothViewEpoch;
    const pairObservation = pairingObservation();
    const ownsBluetoothPairing = !!(
      bluetoothFlow &&
      pairObservation &&
      bluetoothFlow.owner === pairObservation.owner &&
      bluetoothFlow.leaseId === pairObservation.pairing.lease?.id
    );
    const bluetoothCurrent = () =>
      popup === "controls" &&
      controlsView === "bluetooth" &&
      bluetoothEpoch === bluetoothViewEpoch &&
      (bluetoothObservation.kind === "ready"
        ? status.kind === "ready" &&
          status.owner === bluetoothObservation.owner &&
          status.snapshot.revision === bluetoothObservation.snapshot.revision
        : status === bluetoothObservation);
    const changeBluetooth = (device: BluetoothDevice, connected: boolean) => {
      if (
        !bluetoothCurrent() ||
        controlsBusy ||
        bluetoothObservation.kind !== "ready" ||
        status.kind !== "ready" ||
        status.snapshot.updating
      )
        return;
      const observed = bluetoothObservation.snapshot.bluetooth;
      const current = status.snapshot.bluetooth;
      if (
        bluetoothPairingBlocksConnections(current.pairing) ||
        bluetoothTrustBlocksControls(current.trust)
      )
        return;
      if (
        observed.status.kind !== "ready" ||
        current.status.kind !== "ready" ||
        current.status.policy !== "interactive" ||
        current.operation.kind === "pending" ||
        current.operation.kind === "unknown"
      )
        return;
      const original = observed.status.devices.find((item) => item.id === device.id);
      const live = current.status.devices.find((item) => item.id === device.id);
      const adapter = current.status.adapters.find((item) => item.id === device.adapterId);
      const originalAdapter = observed.status.adapters.find((item) => item.id === device.adapterId);
      if (
        !original ||
        !live ||
        !isDeepStrictEqual(original, device) ||
        !isDeepStrictEqual(original, live) ||
        !isDeepStrictEqual(originalAdapter, adapter) ||
        (connected ? !live.trusted : !live.connected) ||
        !adapter?.powered ||
        live.connected === connected
      )
        return;
      const request = {
        owner: bluetoothObservation.owner,
        revision: bluetoothObservation.snapshot.revision,
        id: original.id,
        connected,
      };
      controlAction((actions) => actions.setBluetoothConnected(request), bluetoothCurrent);
    };
    const pal = themePalette();
    const panelTasks = tasks.map((task) => {
      const normalized = task.appId.toLowerCase().replace(/\.desktop$/, "");
      const application = apps.find((app) => {
        const id = app.id.toLowerCase().replace(/\.desktop$/, "");
        return id === normalized || normalized.endsWith(id) || id.endsWith(normalized);
      });
      return {
        ...task,
        iconPath: resolveApplicationIcon(application?.icon),
      };
    });
    renderShell(
      root,
      createElement(
        Group,
        { x: 0, y: 0, width, height },
        createElement(ShellApp, {
          width,
          height,
          primaryOutput,
          open,
          query,
          selected,
          launchState,
          apps,
          clock,
          tasks: panelTasks,
          controlsOpen: popup === "controls",
          notificationsOpen: popup === "notifications",
          taskOverflowOpen: popup === "windows",
          overflowAnchor: taskOverflow?.anchor ?? null,
          overflowTasks: panelTasks.filter((task) =>
            taskOverflow?.keys.includes(`${task.clientId}:${task.surfaceId}`),
          ),
          onTaskOverflowToggle: toggleTaskOverflow,
          onTaskOverflowPress: activateOverflowTask,
          controlsView,
          onLogout,
          notificationView,
          volumeDraft: volumeDraft(),
          onControlsView: (view) => {
            if (controlsView === "bluetooth" && view !== "bluetooth") cleanupBluetoothFlow();
            bluetoothViewEpoch++;
            resetPopupFocus();
            if (view !== "network") wifiDraft = null;
            controlsView = view;
          },
          onNotificationView: (view) => {
            resetPopupFocus();
            notificationView = view;
          },
          onNotificationsToggle: toggleNotifications,
          onVolumeStart: () => {
            if (controls) volumeIntent.begin();
            controlsError = "";
            dirty = true;
          },
          onVolumeChange: (value) => {
            volumeIntent.change(value);
            dirty = true;
          },
          onVolumeCommit: commitVolume,
          onVolumeCancel: () => {
            volumeIntent.cancel();
            dirty = true;
          },
          wifiSelection: wifiDraft?.ap,
          wifiPassword: wifiDraft?.password ?? "",
          onWifiSelect: (ap) => {
            if (
              status.kind !== "ready" ||
              status.snapshot.wifi.kind !== "ready" ||
              !status.snapshot.wifi.canConnect ||
              controlsBusy
            )
              return;
            const current = status.snapshot.wifi.accessPoints.find((item) => item.id === ap.id);
            if (!current || current.security === "unsupported" || current.connected) return;
            wifiDraft = { owner: status.owner, ap: current, password: "" };
            controlsError = "";
            resetPopupFocus();
          },
          onWifiPasswordChange: (value) => {
            if (wifiDraft && value.length <= 256 && !value.includes("\0"))
              wifiDraft = { ...wifiDraft, password: value };
            dirty = true;
          },
          onWifiConnect: connectWifi,
          onWifiSelectionCancel: () => {
            wifiDraft = null;
            resetPopupFocus();
          },
          onWifiRefresh: () => controlAction((actions) => actions.refreshWifi()),
          onBluetoothChange: changeBluetooth,
          onBluetoothRefresh: () => {
            if (
              !bluetoothCurrent() ||
              (status.kind === "ready" &&
                (status.snapshot.updating ||
                  status.snapshot.bluetooth.operation.kind === "pending"))
            )
              return;
            controlAction((actions) => actions.refreshBluetooth(), bluetoothCurrent);
          },
          onBluetoothDiscoveryStart: controls?.startBluetoothDiscovery
            ? (adapterId) => {
                const current = pairingObservation();
                if (
                  !bluetoothCurrent() ||
                  !current ||
                  bluetoothStart ||
                  current.pairing.lease ||
                  (status.kind === "ready" &&
                    bluetoothTrustBlocksControls(status.snapshot.bluetooth.trust)) ||
                  current.pairing.attempt.kind === "unknown" ||
                  controlsBusy ||
                  status.kind !== "ready" ||
                  status.snapshot.updating ||
                  status.snapshot.bluetooth.operation.kind === "pending" ||
                  status.snapshot.bluetooth.operation.kind === "unknown" ||
                  !current.pairing.adapters.some(
                    (adapter) => adapter.id === adapterId && adapter.powered,
                  )
                )
                  return;
                const ticket = { owner: current.owner, epoch: bluetoothViewEpoch, canceled: false };
                bluetoothStart = ticket;
                bluetoothAction(
                  "start",
                  async () => {
                    try {
                      await controls.startBluetoothDiscovery!({
                        owner: current.owner,
                        revision: current.revision,
                        adapterId,
                      });
                      const observed = pairingObservation();
                      if (
                        observed?.owner === ticket.owner &&
                        observed.pairing.lease?.adapterId === adapterId
                      ) {
                        bluetoothFlow = { owner: ticket.owner, leaseId: observed.pairing.lease.id };
                        if (
                          ticket.canceled ||
                          ticket.epoch !== bluetoothViewEpoch ||
                          popup !== "controls" ||
                          controlsView !== "bluetooth"
                        )
                          cleanupBluetoothFlow();
                      }
                    } finally {
                      if (bluetoothStart === ticket) bluetoothStart = null;
                    }
                  },
                  () => !ticket.canceled && ticket.epoch === bluetoothViewEpoch,
                );
              }
            : undefined,
          onBluetoothDiscoveryStop:
            ownsBluetoothPairing && controls?.stopBluetoothDiscovery
              ? () => {
                  if (bluetoothCurrent()) cleanupBluetoothFlow();
                }
              : undefined,
          onBluetoothPair:
            ownsBluetoothPairing && controls?.beginBluetoothPair
              ? (device) => {
                  const current = pairingObservation(),
                    flow = bluetoothFlow;
                  if (
                    !bluetoothCurrent() ||
                    !current ||
                    !flow ||
                    current.owner !== flow.owner ||
                    current.pairing.lease?.id !== flow.leaseId ||
                    (status.kind === "ready" &&
                      bluetoothTrustBlocksControls(status.snapshot.bluetooth.trust)) ||
                    current.pairing.attempt.kind === "pending" ||
                    current.pairing.attempt.kind === "unknown" ||
                    !current.pairing.devices.some((candidate) =>
                      isDeepStrictEqual(candidate, device),
                    )
                  )
                    return;
                  bluetoothAction(
                    "pair",
                    () =>
                      controls.beginBluetoothPair!({
                        ...flow,
                        revision: current.revision,
                        deviceId: device.id,
                      }),
                    bluetoothCurrent,
                  );
                }
              : undefined,
          onBluetoothPairCancel:
            ownsBluetoothPairing && controls?.cancelBluetoothPair
              ? () => {
                  const current = pairingObservation(),
                    flow = bluetoothFlow;
                  if (
                    !bluetoothCurrent() ||
                    !current ||
                    !flow ||
                    current.owner !== flow.owner ||
                    current.pairing.lease?.id !== flow.leaseId ||
                    current.pairing.attempt.kind !== "pending"
                  )
                    return;
                  const attemptId = current.pairing.attempt.id;
                  bluetoothAction(
                    `cancel:${attemptId}`,
                    () =>
                      controls.cancelBluetoothPair!({
                        ...flow,
                        revision: current.revision,
                        attemptId,
                      }),
                    bluetoothCurrent,
                  );
                }
              : undefined,
          onBluetoothPromptResponse:
            ownsBluetoothPairing && controls?.respondBluetoothPrompt
              ? (promptId, accepted) => {
                  const current = pairingObservation(),
                    flow = bluetoothFlow;
                  if (
                    !bluetoothCurrent() ||
                    !current ||
                    !flow ||
                    current.owner !== flow.owner ||
                    current.pairing.lease?.id !== flow.leaseId ||
                    current.pairing.attempt.kind !== "pending" ||
                    current.pairing.prompt?.id !== promptId ||
                    (current.pairing.prompt.kind !== "confirmation" &&
                      current.pairing.prompt.kind !== "authorization")
                  )
                    return;
                  const attemptId = current.pairing.attempt.id;
                  bluetoothAction(
                    `prompt:${promptId}`,
                    () =>
                      controls.respondBluetoothPrompt!({
                        ...flow,
                        revision: current.revision,
                        attemptId,
                        promptId,
                        accepted,
                      }),
                    bluetoothCurrent,
                  );
                }
              : undefined,
          onBluetoothInputResponse:
            ownsBluetoothPairing && controls?.respondBluetoothInput
              ? (promptId, value) => {
                  const current = pairingObservation(),
                    flow = bluetoothFlow;
                  if (
                    !bluetoothCurrent() ||
                    !current ||
                    !flow ||
                    current.owner !== flow.owner ||
                    current.pairing.lease?.id !== flow.leaseId ||
                    current.pairing.attempt.kind !== "pending" ||
                    current.pairing.prompt?.id !== promptId ||
                    (current.pairing.prompt.kind !== "pin-entry" &&
                      current.pairing.prompt.kind !== "passkey-entry")
                  )
                    return;
                  const attemptId = current.pairing.attempt.id;
                  bluetoothAction(
                    `input:${promptId}`,
                    () =>
                      controls.respondBluetoothInput!({
                        ...flow,
                        revision: current.revision,
                        attemptId,
                        promptId,
                        value,
                      }),
                    bluetoothCurrent,
                  );
                }
              : undefined,
          onBluetoothTrustRequest: controls?.requestBluetoothTrust
            ? (device, trusted) => {
                if (
                  !bluetoothCurrent() ||
                  controlsBusy ||
                  bluetoothTrustStart ||
                  status.kind !== "ready" ||
                  status.snapshot.updating
                )
                  return;
                const current = status.snapshot.bluetooth;
                if (
                  current.status.kind !== "ready" ||
                  current.trust?.kind !== "ready" ||
                  bluetoothTrustBlocksControls(current.trust) ||
                  bluetoothPairingBlocksConnections(current.pairing) ||
                  current.operation.kind === "pending" ||
                  current.operation.kind === "unknown" ||
                  !current.status.devices.some((item) => isDeepStrictEqual(item, device)) ||
                  device.trusted === trusted
                )
                  return;
                const ticket = { owner: status.owner, epoch: bluetoothViewEpoch, canceled: false };
                const revision = status.snapshot.revision;
                bluetoothTrustStart = ticket;
                bluetoothAction(
                  "trust-request",
                  async () => {
                    try {
                      await controls.requestBluetoothTrust!({
                        owner: ticket.owner,
                        revision,
                        id: device.id,
                        trusted,
                      });
                      const observed = trustObservation();
                      if (
                        observed?.owner === ticket.owner &&
                        observed.operation.id === device.id &&
                        observed.operation.trusted === trusted
                      ) {
                        bluetoothTrustFlow = {
                          owner: ticket.owner,
                          challengeId: observed.operation.challengeId,
                        };
                        if (
                          ticket.canceled ||
                          ticket.epoch !== bluetoothViewEpoch ||
                          popup !== "controls" ||
                          controlsView !== "bluetooth"
                        )
                          cleanupBluetoothTrust();
                      }
                    } finally {
                      if (bluetoothTrustStart === ticket) bluetoothTrustStart = null;
                    }
                  },
                  () => !ticket.canceled && ticket.epoch === bluetoothViewEpoch,
                );
              }
            : undefined,
          onBluetoothTrustConfirm:
            controls?.confirmBluetoothTrust && bluetoothTrustFlow
              ? (challengeId) => {
                  const current = trustObservation(),
                    flow = bluetoothTrustFlow;
                  if (
                    !bluetoothCurrent() ||
                    !current ||
                    !flow ||
                    current.owner !== flow.owner ||
                    current.operation.challengeId !== challengeId ||
                    flow.challengeId !== challengeId
                  )
                    return;
                  bluetoothAction(
                    `trust-confirm:${challengeId}`,
                    () =>
                      controls.confirmBluetoothTrust!({
                        owner: flow.owner,
                        revision: current.revision,
                        challengeId,
                      }),
                    bluetoothCurrent,
                  );
                }
              : undefined,
          onBluetoothTrustCancel:
            controls?.cancelBluetoothTrust && bluetoothTrustFlow ? cancelTrust : undefined,
          onWifiCancel: () => {
            wifiDraft = null;
            controlAction((actions) => actions.cancelWifi());
          },
          onSettings: () => {
            dismissControls();
            const settings = apps.find(
              (app) => app.id === "moire-settings.desktop" || app.id === "moire-settings",
            );
            if (settings) launch(settings);
            else {
              controlsError = "Settings application unavailable";
              dirty = true;
            }
          },
          status,
          cachedCapabilities,
          cachedNetworkPresentation,
          controlsBusy,
          volumeBlocked: volumeLocked(),
          controlsError,
          controlsScrollY,
          onControlsScroll: (value, metrics) => {
            controlsScrollY = value;
            dirty = true;
            if (observeScroll && (observeScroll.active?.() ?? true)) {
              scrollPaintPending = true;
              observeScroll({
                stage: "offset",
                popup,
                view: popup === "notifications" ? notificationView : controlsView,
                offset: value,
                contentHeight: metrics?.contentHeight ?? null,
                viewportHeight: metrics?.viewportHeight ?? null,
                maxScroll: metrics?.maxScroll ?? null,
              });
            }
          },
          onControlsToggle: toggleControls,
          onControlsDismiss: dismissControls,
          onControlAction: controlAction,
          onToggle: () => {
            dismissControls();
            if (open) dismissLauncher();
            else {
              open = true;
              dirty = true;
            }
          },
          onQuery: (q: string) => {
            query = q;
            selected = 0;
            if (launchState.kind === "failed") launchState = { kind: "idle" };
            dirty = true;
          },
          onSelect: (i: number) => {
            selected = i;
            dirty = true;
          },
          onLaunch: launch,
          onDismiss: dismissLauncher,
          onTaskPress: (task: TaskWindowInfo) => {
            onTaskAction({
              clientId: task.clientId,
              surfaceId: task.surfaceId,
            });
          },
        }),
        desktopMenu
          ? createElement(ContextMenu, {
              viewportWidth: width,
              viewportHeight: height - pal.panelHeight,
              x: desktopMenu.x,
              y: desktopMenu.y,
              title:
                desktopMenu.kind === "item"
                  ? desktopSelection.selectedKeys.has(desktopMenu.name) &&
                    desktopSelection.selectedKeys.size > 1
                    ? `${desktopSelection.selectedKeys.size} Items`
                    : desktopMenu.name
                  : "Desktop",
              actions:
                desktopMenu.kind === "item"
                  ? desktopContextActions(desktopMenu.name)
                  : desktopBackgroundActions(),
              onDismiss: () => {
                desktopMenu = null;
                dirty = true;
              },
            })
          : null,
      ),
    );
    const painted = rasterize(root.container, width, height);
    overlay = painted.pixels;
    overlayRevision++;
    overlayRuns = buildAlphaRuns(overlay, width, height);
    hits = painted.hits;
    if (observeScroll && (observeScroll.active?.() ?? true) && scrollPaintPending) {
      scrollPaintPending = false;
      const body = hits.find((hit) => hit.onWheel && hit.focusScopeId === popupScope());
      scrollViewport = body
        ? { x: body.x, y: body.y, width: body.width, height: body.height }
        : null;
      const checksum = (bounds: { x: number; y: number; width: number; height: number } | null) => {
        if (!bounds) return null;
        const pixels = new Uint32Array(
          painted.pixels.buffer,
          painted.pixels.byteOffset,
          painted.pixels.byteLength / 4,
        );
        let hash = 2166136261;
        for (
          let y = Math.max(0, Math.ceil(bounds.y));
          y < Math.min(height, Math.floor(bounds.y + bounds.height));
          y++
        )
          for (
            let x = Math.max(0, Math.ceil(bounds.x));
            x < Math.min(width, Math.floor(bounds.x + bounds.width));
            x++
          )
            hash = Math.imul(hash ^ pixels[y * width + x]!, 16777619) >>> 0;
        return hash;
      };
      const footer = hits.find((hit) => hit.focusId === "notifications:history");
      observeScroll({
        stage: "paint",
        popup,
        view: popup === "notifications" ? notificationView : controlsView,
        revision: overlayRevision,
        offset: controlsScrollY,
        bodyChecksum: checksum(scrollViewport),
        footerChecksum: checksum(footer ?? null),
      });
    }
    ow = width;
    oh = height;
    dirty = false;
    // Temporary operation readiness must not move keyboard focus. Keep the
    // owned control's identity until it disappears or the user traverses away.
    const currentPopupHit = hits.find(
      (hit) => hit.focusScopeId === popupScope() && hit.focusId === controlsFocusId,
    );
    if (currentPopupHit) controlsFocusedHit = currentPopupHit;
    const temporarilyDisabled =
      controlsBusy || volumeLocked() || (status.kind === "ready" && status.snapshot.updating);
    if (popupOpen() && !(controlsFocusId && temporarilyDisabled) && !currentPopupHit) {
      const first =
        hits.find((hit) => hit.focusable && hit.autoFocus && hit.focusScopeId === popupScope()) ??
        hits.find((hit) => hit.focusable && hit.focusScopeId === popupScope());
      controlsFocusedHit?.onFocusChange?.(false);
      controlsFocusId = first?.focusId ?? null;
      controlsFocusedHit = first ?? null;
      first?.onFocusChange?.(true);
      if (first) dirty = true;
    }
  };

  const ensureOverlayHits = () => {
    if (dirty || !overlay) {
      rebuild(
        ow || primaryOutput.x + primaryOutput.width,
        oh || primaryOutput.y + primaryOutput.height,
      );
    }
  };

  /** Cache non-transparent runs once per raster instead of scanning every
   * transparent screen pixel on every composite. The runs also map directly
   * to retained-scene damage regions for the EGL path. */
  const buildAlphaRuns = (srcBytes: Uint8Array, width: number, height: number): AlphaRuns => {
    const src = new Uint32Array(srcBytes.buffer, srcBytes.byteOffset, srcBytes.byteLength >>> 2);
    const rows: AlphaRuns = new Array(height).fill(null);
    for (let y = 0; y < height; y++) {
      const pairs: number[] = [];
      const row = y * width;
      let x = 0;
      while (x < width) {
        while (x < width && src[row + x]! >>> 24 === 0) x++;
        if (x >= width) break;
        const start = x;
        while (x < width && src[row + x]! >>> 24 !== 0) x++;
        pairs.push(start, x);
      }
      if (pairs.length > 0) rows[y] = Int32Array.from(pairs);
    }
    return rows;
  };

  const blendOverlay = (
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    srcBytes: Uint8Array,
    runs?: AlphaRuns | null,
  ) => {
    const src = new Uint32Array(srcBytes.buffer, srcBytes.byteOffset, srcBytes.byteLength >>> 2);
    for (let y = 0; y < height; y++) {
      const si = y * width;
      const di = y * pitchPx;
      const rowRuns = runs?.[y];
      if (runs && !rowRuns) continue;
      const runCount = rowRuns?.length ?? 2;
      for (let run = 0; run < runCount; run += 2) {
        const start = rowRuns?.[run] ?? 0;
        const end = rowRuns?.[run + 1] ?? width;
        for (let x = start; x < end; x++) {
          const pixel = src[si + x]!;
          const a = (pixel >>> 24) & 0xff;
          if (a === 255) {
            fb[di + x] = pixel;
            continue;
          }
          const dst = fb[di + x]!;
          const inv = 255 - a;
          const r = (((pixel >>> 16) & 0xff) + (((dst >>> 16) & 0xff) * inv) / 255) | 0;
          const g = (((pixel >>> 8) & 0xff) + (((dst >>> 8) & 0xff) * inv) / 255) | 0;
          const b = ((pixel & 0xff) + ((dst & 0xff) * inv) / 255) | 0;
          fb[di + x] = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
        }
      }
    }
  };

  const blitStrip = (
    fb: Uint32Array,
    pitchPx: number,
    fbW: number,
    fbH: number,
    dx: number,
    dy: number,
    srcBytes: Uint8Array,
    srcW: number,
    srcH: number,
  ) => {
    const src = new Uint32Array(srcBytes.buffer, srcBytes.byteOffset, srcBytes.byteLength >>> 2);
    for (let row = 0; row < srcH; row++) {
      const py = dy + row;
      if (py < 0 || py >= fbH) continue;
      const si = row * srcW;
      const di = py * pitchPx;
      for (let col = 0; col < srcW; col++) {
        const px = dx + col;
        if (px < 0 || px >= fbW) continue;
        const pixel = src[si + col]!;
        const a = (pixel >>> 24) & 0xff;
        if (a === 0) continue;
        if (a === 255) {
          fb[di + px] = pixel;
          continue;
        }
        const dst = fb[di + px]!;
        const inv = 255 - a;
        const r = (((pixel >>> 16) & 0xff) + (((dst >>> 16) & 0xff) * inv) / 255) | 0;
        const g = (((pixel >>> 8) & 0xff) + (((dst >>> 8) & 0xff) * inv) / 255) | 0;
        const b = ((pixel & 0xff) + ((dst & 0xff) * inv) / 255) | 0;
        fb[di + px] = (0xff000000 | (r << 16) | (g << 8) | b) >>> 0;
      }
    }
  };

  const rebuildDesktop = (width: number, height: number) => {
    const pal = themePalette();
    renderShell(
      desktopRoot,
      createElement(
        Group,
        { x: 0, y: 0, width, height: height - pal.panelHeight },
        createElement(
          ContextMenuTrigger,
          {
            width,
            height: height - pal.panelHeight,
            onPress: () => {
              updateDesktopSelection({ type: "clear" });
              desktopMenu = null;
              desktopKeyboardActive = true;
              desktopDirty = true;
              dirty = true;
            },
            onContextMenu: (event) => {
              updateDesktopSelection({ type: "clear" });
              desktopMenu = { kind: "background", x: event.x, y: event.y };
              desktopKeyboardActive = true;
              desktopDirty = true;
              dirty = true;
            },
          },
          createElement(DesktopIcons, {
            screenW: width,
            screenH: height,
            panelH: pal.panelHeight,
            entries: showDesktopIcons ? desktopEntries : [],
            layout: desktopLayout,
            selectedNames: desktopSelection.selectedKeys,
            focusedName: desktopSelection.focusKey,
            dropHoverName: desktopDropHoverName,
            dragActive: desktopDragActive,
            onSelect: (name, event) => {
              selectDesktopName(name, {
                toggle: event?.ctrlKey || event?.metaKey,
                range: event?.shiftKey,
              });
              desktopMenu = null;
              desktopKeyboardActive = true;
              desktopDirty = true;
              dirty = true;
            },
            onOpen: openDesktopEntry,
            onContextMenu: (name, event) => {
              if (!desktopSelection.selectedKeys.has(name)) {
                selectDesktopName(name);
              }
              desktopMenu = {
                kind: "item",
                name,
                x: event.x,
                y: event.y,
              };
              desktopKeyboardActive = true;
              desktopDirty = true;
              dirty = true;
            },
          }),
        ),
      ),
    );
    const painted = rasterize(desktopRoot.container, width, height);
    desktopOverlay = painted.pixels;
    desktopRevision++;
    desktopOverlayRuns = buildAlphaRuns(desktopOverlay, width, height);
    desktopHits = painted.hits;
    desktopW = width;
    desktopH = height;
    desktopDirty = false;
  };

  /** Rebuild hit list if we already know the screen size. */
  const ensureDesktopHits = () => {
    if (desktopW > 0 && desktopH > 0 && desktopDirty) {
      rebuildDesktop(desktopW, desktopH);
    }
  };

  const prepareSsdWindow = (window: SsdWindowInfo): ShellRasterSurface => {
    const stripKey = `${window.clientId}:${window.surfaceId}`;
    const signature = `${window.contentW}:${window.title}:${window.appId ?? ""}:${window.focused ? 1 : 0}:${window.maximized ? 1 : 0}`;
    const titlebarH = themePalette().titlebarHeight;
    ssdSeen.add(stripKey);
    let strip = ssdStripCache.get(stripKey);
    if (!strip) {
      strip = {
        root: createShellRoot(),
        pixels: new Uint8Array(0),
        w: 0,
        h: titlebarH,
        hits: [],
        signature: "",
        dirty: true,
        revision: 0,
      };
      ssdStripCache.set(stripKey, strip);
    }
    if (strip.dirty || strip.signature !== signature) {
      ssdPending = { current: null };
      const sid = window.surfaceId;
      const cid = window.clientId;
      renderShell(
        strip.root,
        createElement(TitleBar, {
          x: 0,
          y: 0,
          width: window.contentW,
          title: window.title,
          appId: window.appId,
          focused: window.focused,
          maximized: window.maximized,
          onDrag: () => {
            ssdPending.current = { kind: "drag", surfaceId: sid, clientId: cid };
          },
          onClose: () => {
            ssdPending.current = { kind: "close", surfaceId: sid, clientId: cid };
          },
          onMaximize: () => {
            ssdPending.current = {
              kind: "maximize",
              surfaceId: sid,
              clientId: cid,
            };
          },
          onMinimize: () => {
            ssdPending.current = {
              kind: "minimize",
              surfaceId: sid,
              clientId: cid,
            };
          },
        }),
      );
      const painted = rasterize(strip.root.container, Math.max(1, window.contentW), titlebarH);
      strip.pixels = painted.pixels;
      strip.w = window.contentW;
      strip.h = titlebarH;
      strip.hits = painted.hits;
      strip.signature = signature;
      strip.dirty = false;
      strip.revision++;
    }

    strip.hits.forEach((h, index) => {
      ssdHits.push({
        ...h,
        identity: `${stripKey}:${index}`,
        stripKey,
        x: window.x + h.x,
        y: window.y + h.y,
        pointerClip: h.pointerClip
          ? { ...h.pointerClip, x: window.x + h.pointerClip.x, y: window.y + h.pointerClip.y }
          : undefined,
      });
    });
    return {
      id: `ssd:${stripKey}`,
      pixels: strip.pixels,
      width: strip.w,
      height: strip.h,
      stride: strip.w * 4,
      revision: strip.revision,
      x: window.x,
      y: window.y,
    };
  };

  const paintSsdWindow = (
    fb: Uint32Array,
    pitchPx: number,
    width: number,
    height: number,
    window: SsdWindowInfo,
  ) => {
    const raster = prepareSsdWindow(window);
    blitStrip(
      fb,
      pitchPx,
      width,
      height,
      raster.x,
      raster.y,
      raster.pixels,
      raster.width,
      raster.height,
    );
  };

  const desktopFolderAt = (x: number, y: number, sourceNames: readonly string[]): string | null => {
    const pal = themePalette();
    const targetName = hitTestDesktopIcon(
      x,
      y,
      desktopEntries,
      desktopLayout,
      desktopW || 1,
      desktopH || 1,
      pal.panelHeight,
    );
    if (!targetName || sourceNames.includes(targetName)) return null;
    try {
      return fs.statSync(path.join(desktopDir(), targetName)).isDirectory() ? targetName : null;
    } catch {
      return null;
    }
  };

  const beginDesktopDragReturn = (
    drag: NonNullable<typeof desktopDrag>,
    cursorX = drag.lastX,
    cursorY = drag.lastY,
  ): void => {
    desktopDragReturn = {
      name: drag.name,
      label: drag.label,
      originX: drag.originX,
      originY: drag.originY,
      fromX: cursorX - drag.grabX,
      fromY: cursorY - drag.grabY,
      startedMs: Date.now(),
      durationMs: 220,
    };
    desktopDrag = null;
    desktopDown = null;
    desktopDropHoverName = null;
    desktopDragActive = false;
    desktopDirty = true;
  };

  /** Move a local single/group drag into a folder or persist translated positions. */
  const finalizeDesktopDrop = (x: number, y: number): void => {
    if (!desktopDrag) return;
    const drag = desktopDrag;
    const pal = themePalette();
    const availH = (desktopH || 1) - pal.panelHeight;

    const targetName = desktopFolderAt(x, y, drag.names);
    if (targetName) {
      const moves = drag.names.map((name) => ({
        name,
        src: path.join(desktopDir(), name),
        dest: path.join(desktopDir(), targetName, name),
      }));
      const moved: typeof moves = [];
      try {
        for (const move of moves) {
          if (fs.existsSync(move.dest)) {
            throw new Error(`destination already exists: ${move.dest}`);
          }
        }
        for (const move of moves) {
          fs.renameSync(move.src, move.dest);
          moved.push(move);
        }
        const nextLayout = { ...desktopLayout };
        drag.names.forEach((name) => delete nextLayout[name]);
        saveDesktopLayout(nextLayout);
        desktopLayout = nextLayout;
        updateDesktopSelection({ type: "clear" });
        desktopDrag = null;
        desktopDown = null;
        desktopDropHoverName = null;
        desktopDragActive = false;
        refreshDesktop();
        console.log(`[shell] desktop local drop: ${drag.names.join(", ")} → ${targetName}`);
        return;
      } catch (err) {
        for (const move of moved.reverse()) {
          try {
            fs.renameSync(move.dest, move.src);
          } catch (rollbackError) {
            console.error("[shell] desktop group-drop rollback failed:", rollbackError);
          }
        }
        console.error(
          `[shell] desktop local drop failed for ${drag.label} onto ${targetName}:`,
          err,
        );
        beginDesktopDragReturn(drag, x, y);
        return;
      }
    }

    const origins = drag.names
      .map((name) => drag.origins[name])
      .filter((origin): origin is { x: number; y: number } => !!origin);
    if (origins.length === 0) {
      beginDesktopDragReturn(drag, x, y);
      return;
    }
    const maxX = (desktopW || 1) - DESKTOP_ITEM_W;
    const maxY = availH - DESKTOP_ITEM_H;
    const dx = Math.max(
      Math.max(...origins.map((origin) => -origin.x)),
      Math.min(
        x - drag.grabX - drag.originX,
        Math.min(...origins.map((origin) => maxX - origin.x)),
      ),
    );
    const dy = Math.max(
      Math.max(...origins.map((origin) => -origin.y)),
      Math.min(
        y - drag.grabY - drag.originY,
        Math.min(...origins.map((origin) => maxY - origin.y)),
      ),
    );
    const nextLayout = { ...desktopLayout };
    drag.names.forEach((name) => {
      const origin = drag.origins[name];
      if (!origin) return;
      nextLayout[name] = {
        x: origin.x + dx,
        y: origin.y + dy,
      };
    });
    try {
      saveDesktopLayout(nextLayout);
      desktopLayout = nextLayout;
    } catch (error) {
      console.error("[shell] desktop layout save failed:", error);
      beginDesktopDragReturn(drag, x, y);
      return;
    }
    desktopDrag = null;
    desktopDown = null;
    desktopDropHoverName = null;
    desktopDragActive = false;
    desktopDirty = true;
  };

  const buildDragRaster = (
    cursorX: number,
    cursorY: number,
    label: string,
  ): ShellRasterSurface | null => {
    const text = label.length > 24 ? label.slice(0, 23) + "…" : label;
    const desktopPreview = desktopDrag ?? desktopDragReturn;
    const isDesktopDrag = desktopPreview?.label === label;
    let dirEntry = false;
    if (isDesktopDrag) {
      try {
        dirEntry = fs.statSync(path.join(desktopDir(), desktopPreview.name)).isDirectory();
      } catch {
        // The file may have moved while the return animation is completing.
      }
    }
    const padX = 12;
    const padY = 8;
    const plainW = Math.max(72, Math.round(measureText(text, 13 / 14) + padX * 2 + 28));
    const w = isDesktopDrag ? DESKTOP_ITEM_W : plainW;
    const h = isDesktopDrag ? DESKTOP_ITEM_H : 36;
    const cacheKey = `${text}|${isDesktopDrag}|${dirEntry}`;
    if (!dragChipCache || dragChipCache.key !== cacheKey) {
      const pal = themePalette();
      renderShell(
        dragChipRoot,
        isDesktopDrag
          ? createElement(
              Group,
              { x: 0, y: 0, width: w, height: h },
              createElement(GridItem, {
                width: w,
                height: h,
                label: text,
                iconSize: ICON_SIZE,
                labelScrim: true,
                interactive: false,
                icon: createElement(Icon, {
                  name: dirEntry ? "folder" : "file",
                  size: ICON_SIZE,
                  color: dirEntry ? pal.accent : pal.text,
                }),
              }),
            )
          : createElement(
              Group,
              { x: 0, y: 0, width: w, height: h },
              createElement(Rect, {
                width: w,
                height: h,
                fill: (pal.surface & 0x00ffffff) | 0xf0000000,
              }),
              createElement(Rect, {
                width: w,
                height: 1,
                fill: pal.rimLight,
              }),
              createElement(Rect, {
                width: 3,
                height: h,
                fill: pal.accentLine,
              }),
              createElement(Label, {
                x: padX + 4,
                y: padY,
                text,
                color: pal.text,
                fontSize: 13,
                fontWeight: "medium",
              }),
            ),
      );
      const painted = rasterize(dragChipRoot.container, w, h);
      dragChipCache = { key: cacheKey, pixels: painted.pixels, w, h };
      dragChipRevision++;
    }

    let x = (cursorX | 0) + 14;
    let y = (cursorY | 0) + 12;
    if (desktopDrag) {
      x = (cursorX | 0) - desktopDrag.grabX;
      y = (cursorY | 0) - desktopDrag.grabY;
    } else if (desktopDragReturn) {
      const animation = desktopDragReturn;
      const progress = Math.min(
        1,
        Math.max(0, (Date.now() - animation.startedMs) / animation.durationMs),
      );
      if (progress >= 1) {
        desktopDragReturn = null;
        desktopDirty = true;
        return null;
      }
      const eased = 1 - Math.pow(1 - progress, 3);
      x = Math.round(animation.fromX + (animation.originX - animation.fromX) * eased);
      y = Math.round(animation.fromY + (animation.originY - animation.fromY) * eased);
    }
    return {
      id: "shell:drag-preview",
      pixels: dragChipCache.pixels,
      width: dragChipCache.w,
      height: dragChipCache.h,
      stride: dragChipCache.w * 4,
      revision: dragChipRevision,
      x,
      y,
    };
  };

  return {
    setDesktopStatus(next) {
      let restoreBluetoothFocus = false;
      if (status.kind !== "ready" || next.kind !== "ready" || status.owner !== next.owner) {
        if (bluetoothStart) bluetoothStart.canceled = true;
        bluetoothFlow = null;
        if (bluetoothTrustStart) bluetoothTrustStart.canceled = true;
        bluetoothTrustFlow = null;
        bluetoothPromptFocus = null;
        bluetoothViewEpoch++;
      }
      const nextPairing = next.kind === "ready" ? next.snapshot.bluetooth.pairing : null;
      const pairPrompt = nextPairing?.kind === "ready" ? nextPairing.prompt : null;
      const nextTrust = next.kind === "ready" ? next.snapshot.bluetooth.trust : null;
      const trustPrompt =
        nextTrust?.kind === "ready" && nextTrust.operation.kind === "confirmation"
          ? nextTrust.operation
          : null;
      const prompt = pairPrompt ?? (trustPrompt ? { id: trustPrompt.challengeId } : null);
      if (
        trustPrompt &&
        bluetoothTrustStart &&
        next.kind === "ready" &&
        next.owner === bluetoothTrustStart.owner
      )
        bluetoothTrustFlow = { owner: next.owner, challengeId: trustPrompt.challengeId };
      if (!trustPrompt) bluetoothTrustFlow = null;
      if (
        popup === "controls" &&
        controlsView === "bluetooth" &&
        (bluetoothFlow || bluetoothTrustFlow || bluetoothPromptFocus) &&
        next.kind === "ready"
      ) {
        if (prompt && bluetoothPromptFocus?.id !== prompt.id) {
          const restoreId = bluetoothPromptFocus?.restoreId ?? controlsFocusId;
          const restoreScrollY = bluetoothPromptFocus?.restoreScrollY ?? controlsScrollY;
          resetPopupFocus();
          bluetoothPromptFocus = { id: prompt.id, restoreId, restoreScrollY };
        } else if (!prompt && bluetoothPromptFocus) {
          const { restoreId, restoreScrollY } = bluetoothPromptFocus;
          resetPopupFocus();
          controlsScrollY = restoreScrollY;
          controlsFocusId = restoreId;
          restoreBluetoothFocus = true;
          bluetoothPromptFocus = null;
        }
      }
      volumeIntent.observe(next);
      if (wifiDraft) {
        const wifi = next.kind === "ready" ? next.snapshot.wifi : null;
        const ap =
          wifi?.kind === "ready"
            ? wifi.accessPoints.find((ap) => ap.id === wifiDraft?.ap.id)
            : null;
        if (
          next.kind !== "ready" ||
          next.owner !== wifiDraft.owner ||
          wifi?.kind !== "ready" ||
          !wifi.canConnect ||
          !ap ||
          ap.ssid !== wifiDraft.ap.ssid ||
          ap.security !== wifiDraft.ap.security ||
          ap.connected
        )
          wifiDraft = null;
      }
      if (next.kind === "ready") {
        cachedCapabilities = next.snapshot.capabilities;
        cachedNetworkPresentation = networkPresentation(next.snapshot.network, next.snapshot.wifi);
      }
      status = next;
      dirty = true;
      if (restoreBluetoothFocus) {
        ensureOverlayHits();
        hits
          .find((hit) => hit.focusId === controlsFocusId && hit.focusScopeId === popupScope())
          ?.onFocusChange?.(true);
        dirty = true;
      }
    },
    setPrimaryOutput(next) {
      if (
        primaryOutput.x === next.x &&
        primaryOutput.y === next.y &&
        primaryOutput.width === next.width &&
        primaryOutput.height === next.height
      )
        return;
      primaryOutput = { ...next };
      dirty = true;
    },
    setTasks(nextTasks) {
      const changed =
        nextTasks.length !== tasks.length ||
        nextTasks.some((task, index) => {
          const current = tasks[index];
          return (
            !current ||
            current.clientId !== task.clientId ||
            current.surfaceId !== task.surfaceId ||
            current.title !== task.title ||
            current.appId !== task.appId ||
            current.focused !== task.focused ||
            current.minimized !== task.minimized
          );
        });
      if (!changed) return;
      tasks = nextTasks;
      if (
        popup === "windows" &&
        taskOverflow &&
        !tasks.some((task) => taskOverflow?.keys.includes(`${task.clientId}:${task.surfaceId}`))
      )
        dismissControls();
      dirty = true;
    },
    paint(fb, pitchPx, width, height) {
      if (dirty || !overlay || ow !== width || oh !== height) {
        rebuild(width, height);
      }
      if (!overlay) return;
      blendOverlay(fb, pitchPx, width, height, overlay, overlayRuns);
    },

    chromeRaster(width, height) {
      if (dirty || !overlay || ow !== width || oh !== height) {
        rebuild(width, height);
      }
      if (!overlay) return null;
      return {
        id: "shell:chrome",
        pixels: overlay,
        width,
        height,
        stride: width * 4,
        revision: overlayRevision,
        x: 0,
        y: 0,
      };
    },

    beginSsdFrame() {
      for (const key of ssdStripCache.keys()) {
        if (!ssdSeen.has(key)) {
          const stale = ssdStripCache.get(key);
          if (stale) renderShell(stale.root, null);
          ssdStripCache.delete(key);
        }
      }
      ssdSeen.clear();
      ssdHits = [];
    },

    paintSsdWindow,

    ssdRaster(window) {
      return prepareSsdWindow(window);
    },

    paintSsd(fb, pitchPx, width, height, windows) {
      // beginSsdFrame owns reset; multiple stack-slot calls accumulate hits.
      for (const w of windows) {
        paintSsdWindow(fb, pitchPx, width, height, w);
      }
    },

    hitSsd(x, y) {
      ssdPending.current = null;
      for (let i = ssdHits.length - 1; i >= 0; i--) {
        const h = ssdHits[i]!;
        if (hitRegionContains(h, x, y)) {
          h.onPress?.({
            x,
            y,
            localX: x - h.x,
            localY: y - h.y,
          });
          return ssdPending.current;
        }
      }
      return null;
    },

    onClientFocus() {
      dismissControls();
      desktopKeyboardActive = false;
      if (desktopMenu) {
        desktopMenu = null;
        dirty = true;
      }
    },

    onKey(ev) {
      const clientModifier =
        ev.code === KEY_LEFTCTRL ||
        ev.code === KEY_RIGHTCTRL ||
        ev.code === KEY_LEFTSHIFT ||
        ev.code === KEY_RIGHTSHIFT ||
        ev.code === 56 ||
        ev.code === 100;
      if (ev.code === KEY_LEFTCTRL || ev.code === KEY_RIGHTCTRL) {
        ctrlHeld = ev.value !== 0;
      }
      if (ev.code === KEY_LEFTSHIFT || ev.code === KEY_RIGHTSHIFT) {
        shiftHeld = ev.value !== 0;
      }
      if (ev.code === 56 || ev.code === 100) altHeld = ev.value !== 0;
      // If the client received a modifier-down before a flyout opened, it
      // must also receive the corresponding release while that flyout is open.
      if (clientModifier && ev.value === 0 && forwardedModifiers.delete(ev.code)) return false;
      if (clientModifier && ev.value === 1 && !open && !popupOpen() && !desktopMenu)
        forwardedModifiers.add(ev.code);
      if (desktopMenu) {
        if (ev.value !== 1 && ev.value !== 2) return true;
        if (ev.code === KEY_ESC) {
          desktopMenu = null;
          dirty = true;
        }
        return true;
      }
      if (ev.code === KEY_LEFTMETA || ev.code === KEY_RIGHTMETA) {
        metaHeld = ev.value !== 0;
        if (ev.value === 1) {
          dismissControls();
          if (open) dismissLauncher();
          else {
            open = true;
            dirty = true;
          }
          return true;
        }
        return true;
      }
      if (metaHeld && ev.code === 49 && ev.value === 1) {
        toggleNotifications();
        return true;
      }
      if (metaHeld && ev.code === 16 && ev.value === 1) {
        toggleControls();
        return true;
      }
      if (popupOpen()) {
        if (ev.code === KEY_ESC && ev.value === 1) {
          const trust = trustObservation();
          if (
            popup === "controls" &&
            controlsView === "bluetooth" &&
            trust &&
            bluetoothTrustFlow &&
            trust.owner === bluetoothTrustFlow.owner &&
            trust.operation.challengeId === bluetoothTrustFlow.challengeId &&
            controls?.cancelBluetoothTrust
          ) {
            cancelTrust(trust.operation.challengeId);
            return true;
          }
          const current = pairingObservation(),
            flow = bluetoothFlow;
          if (
            popup === "controls" &&
            controlsView === "bluetooth" &&
            current &&
            flow &&
            current.owner === flow.owner &&
            current.pairing.lease?.id === flow.leaseId &&
            current.pairing.prompt &&
            current.pairing.attempt.kind === "pending" &&
            controls?.cancelBluetoothPair
          ) {
            const attemptId = current.pairing.attempt.id;
            bluetoothAction(
              `cancel:${attemptId}`,
              () =>
                controls.cancelBluetoothPair!({ ...flow, revision: current.revision, attemptId }),
              () => popup === "controls" && controlsView === "bluetooth",
            );
            return true;
          }
          dismissControls();
          return true;
        }
        ensureOverlayHits();
        const focusable = hits.filter((hit) => hit.focusable && hit.focusScopeId === popupScope());
        if (ev.code === 15 && ev.value !== 0) {
          const index = focusable.findIndex((hit) => hit.focusId === controlsFocusId);
          const step = shiftHeld ? -1 : 1;
          const nextIndex =
            index < 0
              ? shiftHeld
                ? focusable.length - 1
                : 0
              : (index + step + focusable.length) % focusable.length;
          const next = focusable[nextIndex];
          if (next) controlsScrollY = scrollQuickControlIntoView(controlsScrollY, next);
          (
            hits.find(
              (hit) => hit.focusScopeId === popupScope() && hit.focusId === controlsFocusId,
            ) ?? controlsFocusedHit
          )?.onFocusChange?.(false);
          controlsFocusId = next?.focusId ?? null;
          controlsFocusedHit = next ?? null;
          next?.onFocusChange?.(true);
        } else {
          const focused = focusable.find((hit) => hit.focusId === controlsFocusId);
          const callback = ev.value === 0 ? focused?.onKeyUp : focused?.onKeyDown;
          callback?.({
            code: ev.code,
            ...keyFromEvdev(ev.code, {
              shift: shiftHeld,
              ctrl: ctrlHeld,
              alt: altHeld,
              meta: metaHeld,
            }),
            repeat: ev.value === 2,
            shiftKey: shiftHeld,
            ctrlKey: ctrlHeld,
            altKey: altHeld,
            metaKey: metaHeld,
          });
        }
        dirty = true;
        return true;
      }

      if (!open && desktopKeyboardActive) {
        const modifier =
          ev.code === KEY_LEFTCTRL ||
          ev.code === KEY_RIGHTCTRL ||
          ev.code === KEY_LEFTSHIFT ||
          ev.code === KEY_RIGHTSHIFT;
        // A client may have received the modifier-down before focus moved to
        // the desktop. Forward both edges so it cannot retain a stuck key.
        if (modifier) return false;
        if (ev.value !== 1 && ev.value !== 2) return true;
        if (ev.code === KEY_ESC) {
          updateDesktopSelection({ type: "clear" });
          return true;
        }
        if (ctrlHeld && ev.code === 30) {
          updateDesktopSelection({ type: "all" });
          return true;
        }
        if (ev.code === KEY_ENTER) {
          selectedDesktopNames().forEach(openDesktopEntry);
          return true;
        }
        if (ev.code === KEY_SPACE) {
          const focused = desktopSelection.focusKey;
          if (focused) {
            selectDesktopName(focused, {
              toggle: ctrlHeld,
              range: shiftHeld,
            });
          }
          return true;
        }
        if (ev.code === KEY_HOME || ev.code === KEY_END) {
          updateDesktopSelection({
            type: ev.code === KEY_HOME ? "first" : "last",
            options: {
              extend: shiftHeld,
              preserveSelection: ctrlHeld && !shiftHeld,
            },
          });
          return true;
        }
        if (ev.code === KEY_LEFT) moveDesktopSelection("left");
        else if (ev.code === KEY_RIGHT) moveDesktopSelection("right");
        else if (ev.code === KEY_UP) moveDesktopSelection("up");
        else if (ev.code === KEY_DOWN) moveDesktopSelection("down");
        return true;
      }

      if (!open) return false;
      if (ev.value !== 1 && ev.value !== 2) return true;

      if (ev.code === KEY_UP || ev.code === KEY_DOWN) {
        const list = filterApplications(apps, query);
        if (list.length === 0) return true;
        if (ev.code === KEY_UP) selected = (selected - 1 + list.length) % list.length;
        else selected = (selected + 1) % list.length;
        dirty = true;
        return true;
      }
      ensureOverlayHits();
      const search = hits.find((hit) => hit.autoFocus && hit.onKeyDown);
      const ch = US_MAP[ev.code];
      const text = shiftHeld ? (US_SHIFT_MAP[ev.code] ?? ch?.toUpperCase()) : ch;
      search?.onKeyDown?.({
        code: ev.code,
        key: text,
        text,
        repeat: ev.value === 2,
        shiftKey: shiftHeld,
        ctrlKey: ctrlHeld,
        altKey: altHeld,
        metaKey: metaHeld,
      });
      dirty = true;
      return true;
    },

    onPointerButton(ev) {
      const left = ev.button === PANEL_BTN_LEFT;
      const right = ev.button === PANEL_BTN_RIGHT;
      if (!left && !right) return open || popupOpen() || desktopMenu != null;
      if (ev.value === 1) desktopKeyboardActive = false;
      if (ev.value === 0 && overlayGrab?.button === ev.button) {
        ensureOverlayHits();
        const activation = overlayGrab.activation;
        const captured = overlayGrab.hit;
        const hit = captured?.focusId
          ? hits.find(
              (candidate) =>
                candidate.focusId === captured.focusId &&
                candidate.focusScopeId === captured.focusScopeId,
            )
          : captured;
        overlayGrab = null;
        if (left && hit) {
          const args = {
            x: ev.x,
            y: ev.y,
            localX: ev.x - hit.x,
            localY: ev.y - hit.y,
            button: "left" as const,
            shiftKey: shiftHeld,
            ctrlKey: ctrlHeld,
            altKey: altHeld,
            metaKey: metaHeld,
          };
          hit.onPointerUp?.(args);
          if (hitRegionContains(hit, ev.x, ev.y)) {
            // Rebind drag geometry, but preserve the semantic action captured
            // on press. A status update must not retarget a notification batch.
            activation?.onPress?.(args);
          }
        }
        dirty = true;
        return true;
      }
      if (ev.value !== 1) return open || popupOpen() || desktopMenu != null || overlayGrab != null;
      // A second button must not replace an in-flight left-button gesture.
      if (overlayGrab) return true;
      ensureOverlayHits();
      for (let i = hits.length - 1; i >= 0; i--) {
        const hit = hits[i]!;
        if (!hit.onPointerDown && !hit.onPress && !hit.onContextMenu && !hit.focusable) continue;
        if (hitRegionContains(hit, ev.x, ev.y)) {
          if (popupOpen() && hit.focusable && hit.focusScopeId === popupScope()) {
            (
              hits.find((item) => item.focusId === controlsFocusId) ?? controlsFocusedHit
            )?.onFocusChange?.(false);
            controlsFocusId = hit.focusId ?? null;
            controlsFocusedHit = hit;
            hit.onFocusChange?.(true);
          }
          const args = {
            x: ev.x,
            y: ev.y,
            localX: ev.x - hit.x,
            localY: ev.y - hit.y,
            button: right ? ("right" as const) : ("left" as const),
            shiftKey: shiftHeld,
            ctrlKey: ctrlHeld,
            altKey: altHeld,
            metaKey: metaHeld,
          };
          overlayGrab = {
            button: ev.button,
            hit: left ? hit : null,
            activation: left ? hit : null,
          };
          if (right) hit.onContextMenu?.(args);
          else hit.onPointerDown?.(args);
          dirty = true;
          return true;
        }
      }
      if (open) {
        dismissLauncher();
        overlayGrab = { button: ev.button, hit: null, activation: null };
        return true;
      }
      return desktopMenu != null;
    },

    onPointerMotion(ev) {
      if (overlayGrab?.hit) {
        ensureOverlayHits();
        // Shell React commits replace HitRegion objects. Rebind the grab by
        // the retained host id so scroll thumbs keep receiving motion even
        // after the thumb itself moves and rerenders.
        const original = overlayGrab.hit;
        const captured = original.focusId
          ? hits.find(
              (hit) =>
                hit.focusId === original.focusId && hit.focusScopeId === original.focusScopeId,
            )
          : original;
        overlayGrab.hit = captured ?? null;
        if (captured)
          captured.onPointerMove?.({
            x: ev.x,
            y: ev.y,
            localX: ev.x - captured.x,
            localY: ev.y - captured.y,
          });
        dirty = true;
        return true;
      }

      let next: HitRegion | null = null;
      for (let i = hits.length - 1; i >= 0; i--) {
        const hit = hits[i]!;
        if (
          hitRegionContains(hit, ev.x, ev.y) &&
          (hit.onPointerEnter || hit.onPointerLeave || hit.onPointerMove)
        ) {
          next = hit;
          break;
        }
      }

      if (next?.focusId !== shellHover?.focusId) {
        shellHover?.onPointerLeave?.({
          x: ev.x,
          y: ev.y,
          localX: ev.x - shellHover.x,
          localY: ev.y - shellHover.y,
        });
        shellHover = next;
        next?.onPointerEnter?.({
          x: ev.x,
          y: ev.y,
          localX: ev.x - next.x,
          localY: ev.y - next.y,
        });
        dirty = true;
      } else if (next?.onPointerMove) {
        // Refresh callbacks/geometry after a retained React commit without
        // manufacturing another leave/enter transition.
        shellHover = next;
        next.onPointerMove({
          x: ev.x,
          y: ev.y,
          localX: ev.x - next.x,
          localY: ev.y - next.y,
        });
        dirty = true;
      }

      return open || popupOpen() || desktopMenu != null || next != null;
    },

    onSsdPointerMotion(ev) {
      let next: SsdHit | null = null;
      if (ev.inside) {
        for (let i = ssdHits.length - 1; i >= 0; i--) {
          const hit = ssdHits[i]!;
          if (
            hitRegionContains(hit, ev.x, ev.y) &&
            (hit.onPointerEnter || hit.onPointerLeave || hit.onPointerMove)
          ) {
            next = hit;
            break;
          }
        }
      }

      if (next?.identity !== ssdHover?.identity) {
        ssdHover?.onPointerLeave?.({
          x: ev.x,
          y: ev.y,
          localX: ev.x - ssdHover.x,
          localY: ev.y - ssdHover.y,
        });
        if (ssdHover) {
          const previous = ssdStripCache.get(ssdHover.stripKey);
          if (previous) previous.dirty = true;
        }
        ssdHover = next;
        next?.onPointerEnter?.({
          x: ev.x,
          y: ev.y,
          localX: ev.x - next.x,
          localY: ev.y - next.y,
        });
        if (next) {
          const current = ssdStripCache.get(next.stripKey);
          if (current) current.dirty = true;
        }
        ssdAnimationActive = true;
      } else if (next) {
        // Rasterization replaces HitRegion objects; retain the current one so
        // future leave events reach the latest persistent React instance.
        ssdHover = next;
        next.onPointerMove?.({
          x: ev.x,
          y: ev.y,
          localX: ev.x - next.x,
          localY: ev.y - next.y,
        });
      }

      return ev.inside;
    },

    onPointerAxis(ev) {
      ensureOverlayHits();
      const before = controlsScrollY;
      for (let i = hits.length - 1; i >= 0; i--) {
        const hit = hits[i]!;
        if (hit.onWheel && hitRegionContains(hit, ev.x, ev.y)) {
          hit.onWheel({
            x: ev.x,
            y: ev.y,
            localX: ev.x - hit.x,
            localY: ev.y - hit.y,
            // evdev REL_WHEEL is a signed notch count, while ScrollArea uses
            // logical pixels. Match Wayland's direction and advance about one
            // launcher row per notch so wheel input is visibly responsive.
            deltaY: -ev.deltaY * 44,
          });
          if (observeScroll && (observeScroll.active?.() ?? true))
            observeScroll({
              stage: "hit",
              popup,
              view: popup === "notifications" ? notificationView : controlsView,
              x: ev.x,
              y: ev.y,
              deltaY: -ev.deltaY * 44,
              before,
              after: controlsScrollY,
              bounds: { x: hit.x, y: hit.y, width: hit.width, height: hit.height },
              clip: hit.pointerClip ?? null,
            });
          dirty = true;
          return true;
        }
      }
      if (observeScroll && (observeScroll.active?.() ?? true))
        observeScroll({
          stage: "hit",
          popup,
          view: popup === "notifications" ? notificationView : controlsView,
          x: ev.x,
          y: ev.y,
          deltaY: -ev.deltaY * 44,
          before,
          after: controlsScrollY,
          bounds: null,
          clip: null,
        });
      return open || popupOpen() || desktopMenu != null;
    },

    onDesktopPointerButton(ev) {
      const left = ev.button === PANEL_BTN_LEFT || ev.button === 272;
      const right = ev.button === PANEL_BTN_RIGHT || ev.button === 273;
      if (!left && !right) return false;
      ensureDesktopHits();
      const pal = themePalette();

      const findHit = (pred: (h: HitRegion) => boolean): HitRegion | null => {
        for (let i = desktopHits.length - 1; i >= 0; i--) {
          const h = desktopHits[i]!;
          if (hitRegionContains(h, ev.x, ev.y) && pred(h)) {
            return h;
          }
        }
        return null;
      };

      const args = (h: HitRegion) => ({
        x: ev.x,
        y: ev.y,
        localX: ev.x - h.x,
        localY: ev.y - h.y,
        button: right ? ("right" as const) : ("left" as const),
        shiftKey: shiftHeld,
        ctrlKey: ctrlHeld,
        metaKey: false,
      });

      if (right) {
        if (ev.value !== 1) return desktopMenu != null;
        desktopKeyboardActive = true;
        const hit = findHit((h) => !!h.onContextMenu);
        if (hit?.onContextMenu) {
          hit.onContextMenu(args(hit));
          desktopDirty = true;
          return true;
        }
        if (desktopMenu) {
          desktopMenu = null;
          desktopDirty = true;
          dirty = true;
          return true;
        }
        return false;
      }

      if (ev.value === 1) {
        desktopKeyboardActive = true;
        desktopDragReturn = null;
        const hit = findHit((h) => !!(h.onPointerDown || h.onPress));
        if (!hit) {
          updateDesktopSelection({ type: "clear" });
          desktopDown = null;
          desktopDrag = null;
          return false;
        }
        const overlayOpen = desktopMenu != null;
        const name = overlayOpen
          ? null
          : hitTestDesktopIcon(
              ev.x,
              ev.y,
              desktopEntries,
              desktopLayout,
              desktopW || 1,
              desktopH || 1,
              pal.panelHeight,
            );
        desktopDown = { x: ev.x, y: ev.y, hit, name: name ?? undefined };
        desktopDrag = null;
        hit.onPointerDown?.(args(hit));
        desktopDirty = true;
        return true;
      }

      if (ev.value === 0) {
        if (desktopDrag) {
          finalizeDesktopDrop(ev.x, ev.y);
          return true;
        }

        const hit = findHit((h) => !!(h.onPointerUp || h.onPress)) ?? desktopDown?.hit ?? null;
        if (hit?.onPointerUp) hit.onPointerUp(args(hit));
        if (desktopDown) {
          const dx = ev.x - desktopDown.x;
          const dy = ev.y - desktopDown.y;
          if (dx * dx + dy * dy < DESKTOP_DRAG_THRESHOLD * DESKTOP_DRAG_THRESHOLD) {
            const pressHit = findHit((h) => !!h.onPress) ?? desktopDown.hit;
            pressHit.onPress?.(args(pressHit));
          }
        }
        desktopDown = null;
        desktopDirty = true;
        return hit != null;
      }

      return false;
    },

    onDesktopPointerMotion(ev) {
      const settings = loadSettings();
      if (!settings.showDesktopIcons) return;
      ensureDesktopHits();

      if (desktopDown?.name && !desktopDrag) {
        const dx = ev.x - desktopDown.x;
        const dy = ev.y - desktopDown.y;
        if (dx * dx + dy * dy >= DESKTOP_DRAG_THRESHOLD * DESKTOP_DRAG_THRESHOLD) {
          const name = desktopDown.name;
          if (!desktopSelection.selectedKeys.has(name)) selectDesktopName(name);
          const names = desktopSelection.selectedKeys.has(name) ? selectedDesktopNames() : [name];
          const origins: DesktopLayout = {};
          names.forEach((selectedName) => {
            const index = desktopEntries.indexOf(selectedName);
            if (index < 0) return;
            origins[selectedName] = desktopIconPosition(
              selectedName,
              index,
              desktopLayout,
              desktopW || 1,
              desktopH || 1,
              themePalette().panelHeight,
            );
          });
          const origin = origins[name] ?? {
            x: desktopDown.hit.x,
            y: desktopDown.hit.y,
          };
          desktopDrag = {
            name,
            names,
            label: names.length > 1 ? `${names.length} items` : name,
            origins,
            grabX: desktopDown.x - origin.x,
            grabY: desktopDown.y - origin.y,
            originX: origin.x,
            originY: origin.y,
            lastX: ev.x,
            lastY: ev.y,
          };
          desktopDragStartMs = Date.now();
          desktopDirty = true;
        }
      }

      if (desktopDrag) {
        desktopDrag.lastX = ev.x;
        desktopDrag.lastY = ev.y;
        // Traditional drag semantics: the icon stays put (desktopLayout is
        // untouched) while a translucent ghost tracks the cursor via
        // paintDragPreview; the real position only commits on drop, in
        // finalizeDesktopDrop. No desktop-layer rebuild needed here.
        const nextDropHover = desktopFolderAt(ev.x, ev.y, desktopDrag.names);
        if (nextDropHover !== desktopDropHoverName || !desktopDragActive) {
          desktopDropHoverName = nextDropHover;
          desktopDragActive = true;
          desktopDirty = true;
        }
        return;
      }

      let next: HitRegion | null = null;
      for (let i = desktopHits.length - 1; i >= 0; i--) {
        const h = desktopHits[i]!;
        if (
          hitRegionContains(h, ev.x, ev.y) &&
          (h.onPointerEnter || h.onPointerLeave || h.onPointerMove)
        ) {
          next = h;
          break;
        }
      }
      if (next !== desktopHover) {
        if (desktopHover?.onPointerLeave) {
          desktopHover.onPointerLeave({
            x: ev.x,
            y: ev.y,
            localX: ev.x - desktopHover.x,
            localY: ev.y - desktopHover.y,
          });
        }
        desktopHover = next;
        if (next?.onPointerEnter) {
          next.onPointerEnter({
            x: ev.x,
            y: ev.y,
            localX: ev.x - next.x,
            localY: ev.y - next.y,
          });
        }
        desktopDirty = true;
      } else if (next?.onPointerMove) {
        next.onPointerMove({
          x: ev.x,
          y: ev.y,
          localX: ev.x - next.x,
          localY: ev.y - next.y,
        });
        desktopDirty = true;
      }
    },

    isLauncherOpen: () => open,
    needsRepaint: () => {
      const now = Date.now();
      const dt = Math.min((now - desktopMotionTick) / 1000, 0.1);
      desktopMotionTick = now;
      const wasSsdAnimating = ssdAnimationActive;
      const motionsMoving = tickAllMotions(dt);
      if (motionsMoving || wasSsdAnimating) {
        dirty = true;
        // Shell UI motion currently belongs to chrome/menus or SSD controls;
        // the desktop icon root has no animated values. Re-rasterizing its
        // full-screen backing store here only steals frame budget from scroll.
        for (const strip of ssdStripCache.values()) strip.dirty = true;
      }
      ssdAnimationActive = motionsMoving;
      return dirty || desktopDirty || desktopDrag != null || desktopDragReturn != null;
    },
    invalidateChrome: () => {
      dirty = true;
      overlay = null;
      overlayRuns = null;
      ow = 0;
      oh = 0;
      for (const strip of ssdStripCache.values()) {
        renderShell(strip.root, null);
      }
      ssdStripCache.clear();
      ssdSeen.clear();
      ssdHover = null;
      ssdAnimationActive = false;
      desktopOverlay = null;
      desktopOverlayRuns = null;
      desktopDirty = true;
      desktopW = 0;
      desktopH = 0;
      dragChipCache = null;
      const settings = loadSettings();
      showDesktopIcons = settings.showDesktopIcons;
      setUiScaleFactor(settings.uiScale);
      console.log("[shell] chrome invalidated (prefs/theme)");
    },

    paintDesktop(fb, pitchPx, width, height) {
      if (desktopDirty || !desktopOverlay || desktopW !== width || desktopH !== height) {
        rebuildDesktop(width, height);
      }
      if (!showDesktopIcons) return;
      if (!desktopOverlay) return;
      blendOverlay(fb, pitchPx, width, height, desktopOverlay, desktopOverlayRuns);
    },

    desktopRaster(width, height) {
      if (desktopDirty || !desktopOverlay || desktopW !== width || desktopH !== height) {
        rebuildDesktop(width, height);
      }
      if (!showDesktopIcons || !desktopOverlay) return null;
      return {
        id: "shell:desktop",
        pixels: desktopOverlay,
        width,
        height,
        stride: width * 4,
        revision: desktopRevision,
        x: 0,
        y: 0,
      };
    },

    acceptDesktopDrop(uris, x, y) {
      const root = desktopDir();
      try {
        fs.mkdirSync(root, { recursive: true });
      } catch {
        // ignore
      }

      // If the drop landed on a folder icon, move into that folder instead
      // of the desktop root.
      const pal = themePalette();
      const hitName = hitTestDesktopIcon(
        x,
        y,
        desktopEntries,
        desktopLayout,
        desktopW || 1,
        desktopH || 1,
        pal.panelHeight,
      );
      let dest = root;
      if (hitName) {
        const hitPath = path.join(root, hitName);
        try {
          if (fs.statSync(hitPath).isDirectory()) dest = hitPath;
        } catch {
          // ignore
        }
      }
      const intoFolder = dest !== root;
      let accepted = false;

      for (const uri of uris) {
        if (!uri.startsWith("file://")) continue;
        const src = decodeURIComponent(uri.slice("file://".length));
        const destPath = path.join(dest, path.basename(src));
        if (src === destPath) continue;
        try {
          if (intoFolder) {
            try {
              fs.renameSync(src, destPath);
            } catch {
              fs.copyFileSync(src, destPath);
            }
          } else {
            fs.copyFileSync(src, destPath);
          }
          accepted = true;
          console.log(`[shell] desktop drop: ${src} → ${destPath}`);
        } catch (err) {
          console.error(`[shell] desktop drop failed for ${src}:`, err);
        }
      }
      refreshDesktop();
      return accepted;
    },

    hitDesktop(_x, y) {
      const pal = themePalette();
      if (desktopH > 0) {
        return y < desktopH - pal.panelHeight;
      }
      return y >= 0;
    },

    paintDragPreview(fb, pitchPx, _width, _height, cursorX, cursorY, label) {
      const text = label.length > 24 ? label.slice(0, 23) + "…" : label;
      // Desktop-origin drags (the only ones without a real Wayland icon
      // surface, so the only ones that ever reach this chip fallback) get a
      // translucent copy of the actual tile (same GridItem, same shape) that
      // tracks the original grab point — a traditional OS-style ghost, not
      // a live-moving icon. Other sources (rare: a real client drag with no
      // icon surface of its own) fall back to a plain text chip.
      const desktopPreview = desktopDrag ?? desktopDragReturn;
      const isDesktopDrag = desktopPreview?.label === label;
      let dirEntry = false;
      if (isDesktopDrag) {
        try {
          dirEntry = fs.statSync(path.join(desktopDir(), desktopPreview.name)).isDirectory();
        } catch {
          // ignore
        }
      }
      const chipW = isDesktopDrag ? DESKTOP_ITEM_W : 0;
      const chipH = isDesktopDrag ? DESKTOP_ITEM_H : 0;
      const padX = 12;
      const padY = 8;
      const tw = measureText(text, 13 / 14);
      const plainW = Math.max(72, Math.round(tw + padX * 2 + 28));
      const plainH = 36;
      const w = isDesktopDrag ? chipW : plainW;
      const h = isDesktopDrag ? chipH : plainH;
      const cacheKey = `${text}|${isDesktopDrag}|${dirEntry}`;
      if (!dragChipCache || dragChipCache.key !== cacheKey) {
        const pal = themePalette();
        renderShell(
          dragChipRoot,
          isDesktopDrag
            ? createElement(
                Group,
                { x: 0, y: 0, width: w, height: h, opacity: 0.6 },
                createElement(GridItem, {
                  width: w,
                  height: h,
                  label: text,
                  iconSize: ICON_SIZE,
                  labelScrim: true,
                  interactive: false,
                  icon: createElement(Icon, {
                    name: dirEntry ? "folder" : "file",
                    size: ICON_SIZE,
                    color: dirEntry ? pal.accent : pal.text,
                  }),
                }),
              )
            : createElement(
                Group,
                { x: 0, y: 0, width: w, height: h },
                createElement(Rect, {
                  x: 0,
                  y: 0,
                  width: w,
                  height: h,
                  fill: (pal.surface & 0x00ffffff) | 0xf0000000,
                }),
                createElement(Rect, {
                  x: 0,
                  y: 0,
                  width: w,
                  height: 1,
                  fill: pal.rimLight,
                }),
                createElement(Rect, {
                  x: 0,
                  y: 0,
                  width: 3,
                  height: h,
                  fill: pal.accentLine,
                }),
                createElement(Label, {
                  x: padX + 4,
                  y: padY,
                  text,
                  color: pal.text,
                  fontSize: 13,
                  fontWeight: "medium",
                }),
              ),
        );
        const painted = rasterize(dragChipRoot.container, w, h);
        dragChipCache = {
          key: cacheKey,
          pixels: painted.pixels,
          w,
          h,
        };
      }
      const chip = dragChipCache;
      // Desktop drags track the original grab point (where the icon would
      // land if dropped now); other chips float near the cursor.
      let dx = (cursorX | 0) + 14;
      let dy = (cursorY | 0) + 12;
      if (desktopDrag) {
        dx = (cursorX | 0) - desktopDrag.grabX;
        dy = (cursorY | 0) - desktopDrag.grabY;
      } else if (desktopDragReturn) {
        const anim = desktopDragReturn;
        const progress = Math.min(1, Math.max(0, (Date.now() - anim.startedMs) / anim.durationMs));
        if (progress >= 1) {
          desktopDragReturn = null;
          desktopDirty = true;
          return;
        }
        const eased = 1 - Math.pow(1 - progress, 3);
        dx = Math.round(anim.fromX + (anim.originX - anim.fromX) * eased);
        dy = Math.round(anim.fromY + (anim.originY - anim.fromY) * eased);
      }
      blitStrip(fb, pitchPx, _width, _height, dx, dy, chip.pixels, chip.w, chip.h);
    },

    dragRaster(cursorX, cursorY, label) {
      return buildDragRaster(cursorX, cursorY, label);
    },

    desktopDragLabel: () => desktopDrag?.label ?? desktopDragReturn?.label ?? null,

    desktopDragUri: () => {
      if (!desktopDrag) return null;
      const uri = desktopDrag.names
        .map((name) => pathToFileURL(path.join(desktopDir(), name)).href)
        .join("\n");
      return { uri: `${uri}\n`, label: desktopDrag.label };
    },

    finishDesktopDrag: (commit, x, y) => {
      if (!desktopDrag) return;
      if (commit) {
        finalizeDesktopDrop(x, y);
      } else {
        desktopDrag = null;
        desktopDown = null;
        desktopDragReturn = null;
        desktopDirty = true;
      }
    },

    onDesktopDragHover: (x, y, mimeTypes) => {
      const active = mimeTypes.includes("text/uri-list");
      let next: string | null = null;
      if (active) {
        const pal = themePalette();
        const hitName = hitTestDesktopIcon(
          x,
          y,
          desktopEntries,
          desktopLayout,
          desktopW || 1,
          desktopH || 1,
          pal.panelHeight,
        );
        if (hitName !== desktopDropHoverName) {
          const bounds = desktopEntries.map((n) => {
            const saved = desktopLayout[n];
            return `${n}@${saved ? `${saved.x},${saved.y}` : "(default)"}`;
          });
          console.log(
            `[shell] desktop-hover hit-test x=${x} y=${y} desktopW=${desktopW} desktopH=${desktopH} panelH=${pal.panelHeight} -> ${hitName ?? "(none)"} | entries: ${bounds.join(" ")}`,
          );
        }
        if (hitName) {
          try {
            if (fs.statSync(path.join(desktopDir(), hitName)).isDirectory()) {
              next = hitName;
            }
          } catch {
            // ignore
          }
        }
      }
      if (next !== desktopDropHoverName || active !== desktopDragActive) {
        desktopDropHoverName = next;
        desktopDragActive = active;
        desktopDirty = true;
      }
    },

    clearDesktopDragHover: () => {
      if (desktopDropHoverName !== null || desktopDragActive) {
        desktopDropHoverName = null;
        desktopDragActive = false;
        desktopDirty = true;
      }
    },

    cancelDesktopDrag: (x, y) => {
      if (!desktopDrag) return;
      console.warn(`[shell] desktop-drag cancelled (was dragging "${desktopDrag.label}")`);
      beginDesktopDragReturn(desktopDrag, x, y);
    },

    checkDesktopDragWatchdog: () => {
      if (!desktopDrag) return;
      const idleMs = Date.now() - desktopDragStartMs;
      if (idleMs > DESKTOP_DRAG_WATCHDOG_TIMEOUT_MS) {
        console.warn(
          `[shell] desktop-drag watchdog: clearing stuck drag "${desktopDrag.label}" idle for ${idleMs}ms`,
        );
        beginDesktopDragReturn(desktopDrag);
      }
    },
  };
}

function formatClock(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}
