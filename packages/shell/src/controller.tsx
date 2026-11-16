import {
  discoverApplications,
  filterApplications,
  FileActivationPortalClient,
  FileActivationService,
  applicationOwnsWindow,
  resolveApplicationIcon,
  type DesktopEntry,
} from "@moire/app-discovery";
import {
  RetainedSceneRenderer,
  RetainedSoftwareRenderer,
  collectHits,
  createShellRoot,
  hitRegionContains,
  rasterize,
  renderShell,
  type HitRegion,
  type RetainedClip,
  type RetainedSceneFrame,
  type ShellRoot,
} from "@moire/react-host";
import {
  installUiFonts,
  setUiScaleFactor,
  tickAllMotions,
  keyFromEvdev,
  type ScrollMetrics,
} from "@moire/ui";
import {
  createLiveClock,
  formatCalendarDate,
  loadSettings,
  orderLauncherApps,
  systemTimeZone,
  toggleLauncherPin,
  updateLauncherPins,
} from "@moire/prefs";
import { themePalette } from "@moire/theme";
import React, { useEffect, useMemo } from "react";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Panel,
  groupTasks,
  panelStatusGeometry,
  panelTaskRects,
  type PanelMaterial,
} from "./Panel";
import { TaskOverflow, TASK_WINDOWS_SCOPE } from "./TaskOverflow";
import { NotificationsTray } from "./NotificationsTray";
import { networkPresentation, type NetworkPresentation } from "./network-presentation";
import { createVolumeIntent } from "./volume-intent";
import type {
  QuickSettingsDetailsView,
  QuickSettingsPower,
  QuickSettingsPowerAction,
  QuickSettingsPowerConfirm,
} from "./QuickSettingsDetails";
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
import type { SsdAction, SsdWindowInfo, TaskWindowAction, TaskWindowInfo } from "./ssd";
import { Group } from "@moire/react-host";
import { createDesktop } from "./desktop/controller";
import { settingsCommand } from "./settings-link";
import { createLockSurface } from "./lock/lock-surface";
import type { LockScreenAction, LockScreenView } from "./lock/types";
import { createSecurePromptSurface } from "./secure-prompt/secure-prompt-surface";
import type { SecurePromptAction, SecurePromptView } from "./secure-prompt/types";

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
  /** What changed since the previous read; omitted when the whole surface may have. */
  damage?: readonly RetainedClip[];
};

/** The compositor's active keyboard layout (core's ActiveKeyboardLayout). */
export type ShellKeyboardLayout = {
  index: number;
  id: string;
  layout: string;
  variant: string;
  name: string;
  count: number;
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
  /** Active keyboard layout pushed by the compositor, for a future panel indicator. */
  setKeyboardLayout(layout: ShellKeyboardLayout): void;
  keyboardLayout(): ShellKeyboardLayout | null;
  /** The layout switch shortcut fired; the held Super was a chord, not a launcher press. */
  onLayoutShortcut(): void;
  /** The compositor used the held Super for its own chord (Super+L locks). */
  onSuperChord?(): void;
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
  /** The panel's glass shapes in output coordinates, blurred by the compositor. */
  panelMaterial?(): readonly PanelMaterial[];
  /** A window's taskbar button in output coordinates, where it minimizes to. */
  taskAnchor?(
    clientId: number,
    surfaceId: number,
  ): { x: number; y: number; width: number; height: number } | null;
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
  /** Resolves once every queued desktop file operation has finished (for tests and shutdown). */
  whenDesktopIdle?(): Promise<void>;
  /** The compositor locked or unlocked the session: menus close and drafts are dropped. */
  setLocked(locked: boolean): void;
  /** The lock screen for one output (the compositor draws it over its obscured wallpaper). */
  lockRaster(view: LockScreenView, width: number, height: number): ShellRasterSurface | null;
  /** Pointer input on the lock screen, output-local; a power action to run, if any. */
  onLockPointer(ev: {
    x: number;
    y: number;
    button?: number;
    value?: number;
  }): LockScreenAction | null;
  /**
   * A secure prompt took or released the seat: the shell is not drawn meanwhile, and held
   * modifiers and pointer grabs are dropped (their releases go to the prompt, not here).
   */
  setSecurePromptOpen(open: boolean): void;
  /** The secure prompt for one output (the compositor draws it over its obscured wallpaper). */
  securePromptRaster(
    view: SecurePromptView,
    width: number,
    height: number,
  ): ShellRasterSurface | null;
  /** Pointer input on the secure prompt, output-local; the choice made, if any. */
  onSecurePromptPointer(ev: {
    x: number;
    y: number;
    button?: number;
    value?: number;
  }): SecurePromptAction | null;
  /** "No system password request is open", for the verification key. */
  secureNoticeRaster(width: number, height: number): ShellRasterSurface | null;
};

/**
 * The session's power actions, from the compositor's power session: the same capability source
 * the lock screen's power menu reads. Suspend goes through the session's suspend path, which
 * locks first when "lock on suspend" is on.
 */
export type ShellPowerControls = {
  /** What logind allows this session without asking (CanSuspend / CanReboot / CanPowerOff). */
  capabilities(): QuickSettingsPower;
  run(action: QuickSettingsPowerAction): void;
  /** Restart and shut down wait this long for a cancel (default 10). */
  confirmSeconds?: number;
};

const POWER_CONFIRM_SECONDS = 10;

const KEY_ESC = 1;
const KEY_LEFTCTRL = 29;
const KEY_LEFTSHIFT = 42;
const KEY_UP = 103;
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
  /** Filled with each task's taskbar button (output coordinates) as the panel lays out. */
  taskAnchors?: Map<string, PopupAnchor>;
  /** Filled with the panel's glass shapes (output coordinates) for the compositor's blur. */
  panelGlass?: PanelMaterial[];
  panelFullWidth: boolean;
  panelIconsOnly: boolean;
  open: boolean;
  query: string;
  selected: number;
  launchState: LauncherLaunchState;
  apps: DesktopEntry[];
  /** Pinned desktop entry ids, listed first. */
  launcherPins: readonly string[];
  launcherNotice?: string;
  onPin: (app: DesktopEntry) => void;
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
  /** The window list's heading (an application's name when listing its windows). */
  overflowTitle?: string;
  onTaskOverflowToggle(anchor: PopupAnchor, tasks: readonly TaskWindowInfo[], title?: string): void;
  onTaskOverflowPress(task: TaskWindowInfo): void;
  onTaskClose(task: TaskWindowInfo): void;
  controlsView: "main" | QuickSettingsDetailsView;
  notificationView: "active" | "history";
  volumeDraft?: { value: number; caption: string };
  onLogout?: () => void;
  onLock?: () => void;
  sessionPower?: QuickSettingsPower;
  onPowerAction?: (action: QuickSettingsPowerAction) => void;
  powerConfirm?: QuickSettingsPowerConfirm;
  onPowerConfirm?: () => void;
  onPowerCancel?: () => void;
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
  onSettings(link?: string): void;
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
    () => filterApplications(orderLauncherApps(props.apps, props.launcherPins), props.query),
    [props.apps, props.launcherPins, props.query],
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
    tasks: props.tasks,
    status: props.status,
    cachedCapabilities: props.cachedCapabilities,
    fullWidth: props.panelFullWidth,
    iconsOnly: props.panelIconsOnly,
    notificationCount:
      props.status.kind === "ready"
        ? props.status.snapshot.notices.filter((item) => !item.closed).length
        : 0,
  });
  if (props.taskAnchors) {
    // Where the compositor minimizes each window to, and restores it from.
    const groups = groupTasks(props.tasks);
    const rects = panelTaskRects(anchors, groups.length);
    const origin = {
      x: props.primaryOutput.x + anchors.panel.x,
      y: props.primaryOutput.y + anchors.panel.y,
    };
    props.taskAnchors.clear();
    groups.forEach((group, index) => {
      const rect = rects[index];
      // Every window of an application minimizes into its group's chip.
      const anchor = rect
        ? { ...rect, x: origin.x + rect.x, y: origin.y + rect.y }
        : anchors.overflow && {
            ...anchors.overflow,
            x: props.primaryOutput.x + anchors.overflow.x,
            y: props.primaryOutput.y + anchors.overflow.y,
          };
      if (!anchor) return;
      for (const task of group.tasks)
        props.taskAnchors!.set(`${task.clientId}:${task.surfaceId}`, anchor);
    });
  }
  return (
    <Group x={0} y={0} width={props.width} height={props.height}>
      <Group
        x={props.primaryOutput.x}
        y={props.primaryOutput.y}
        width={props.primaryOutput.width}
        height={props.primaryOutput.height}
      >
        <Panel
          screenW={props.primaryOutput.width}
          screenH={props.primaryOutput.height}
          clock={props.clock}
          tasks={props.tasks}
          onLauncherClick={props.onToggle}
          onTaskPress={props.onTaskPress}
          onControlsClick={props.onControlsToggle}
          onNotificationsClick={props.onNotificationsToggle}
          onTaskOverflowClick={props.onTaskOverflowToggle}
          onTaskGroupPress={(anchor, group) =>
            props.onTaskOverflowToggle(anchor, group.tasks, group.label)
          }
          onTaskMenu={(anchor, group) =>
            props.onTaskOverflowToggle(anchor, group.tasks, group.label)
          }
          onTaskClose={props.onTaskClose}
          status={props.status}
          cachedCapabilities={props.cachedCapabilities}
          cachedNetworkPresentation={props.cachedNetworkPresentation}
          fullWidth={props.panelFullWidth}
          iconsOnly={props.panelIconsOnly}
          onGlass={(shapes) => {
            // The compositor blurs behind these, following the panel as it changes style.
            const glass = props.panelGlass;
            if (!glass) return;
            glass.length = 0;
            for (const shape of shapes)
              glass.push({
                ...shape,
                x: props.primaryOutput.x + shape.x,
                y: props.primaryOutput.y + shape.y,
              });
          }}
          notificationCount={
            props.status.kind === "ready"
              ? props.status.snapshot.notices.filter((item) => !item.closed).length
              : 0
          }
        />
        <Launcher
          open={props.open}
          screenW={props.primaryOutput.width}
          screenH={props.primaryOutput.height}
          apps={filtered}
          query={props.query}
          selected={props.selected}
          launchState={props.launchState}
          pins={props.launcherPins}
          notice={props.launcherNotice}
          onPin={props.onPin}
          onQueryChange={props.onQuery}
          onLaunch={props.onLaunch}
          onDismiss={props.onDismiss}
          onSelect={props.onSelect}
        />
        {props.controlsOpen || props.notificationsOpen || props.taskOverflowOpen ? null : (
          <NotificationBanner
            screenW={props.primaryOutput.width}
            state={props.status}
            onDismiss={(id: number, revision: number) =>
              props.onControlAction((actions) => actions.dismiss(id, revision))
            }
          />
        )}
        <QuickSettings
          open={props.controlsOpen}
          screenW={props.primaryOutput.width}
          screenH={props.primaryOutput.height}
          state={props.status}
          cachedCapabilities={props.cachedCapabilities}
          cachedNetworkPresentation={props.cachedNetworkPresentation}
          busy={props.controlsBusy}
          error={props.controlsError}
          scrollY={props.controlsScrollY}
          onScroll={props.onControlsScroll}
          anchor={anchors.controls!}
          view={props.controlsView}
          onViewChange={props.onControlsView}
          onLogout={props.onLogout}
          onLock={props.onLock}
          sessionPower={props.sessionPower}
          onPowerAction={props.onPowerAction}
          powerConfirm={props.powerConfirm}
          onPowerConfirm={props.onPowerConfirm}
          onPowerCancel={props.onPowerCancel}
          volumeDraft={props.volumeDraft}
          onVolumeStart={props.onVolumeStart}
          onVolumeChange={props.volumeBlocked ? undefined : props.onVolumeChange}
          onVolumeCommit={props.onVolumeCommit}
          onVolumeCancel={props.onVolumeCancel}
          wifiSelection={props.wifiSelection}
          wifiPassword={props.wifiPassword}
          onWifiSelect={props.onWifiSelect}
          onWifiPasswordChange={props.onWifiPasswordChange}
          onWifiConnect={props.onWifiConnect}
          onWifiCancel={props.onWifiCancel}
          onWifiRefresh={props.onWifiRefresh}
          onWifiSelectionCancel={props.onWifiSelectionCancel}
          onBluetoothChange={props.onBluetoothChange}
          onBluetoothRefresh={props.onBluetoothRefresh}
          onBluetoothDiscoveryStart={props.onBluetoothDiscoveryStart}
          onBluetoothDiscoveryStop={props.onBluetoothDiscoveryStop}
          onBluetoothPair={props.onBluetoothPair}
          onBluetoothPairCancel={props.onBluetoothPairCancel}
          onBluetoothPromptResponse={props.onBluetoothPromptResponse}
          onBluetoothInputResponse={props.onBluetoothInputResponse}
          onBluetoothTrustRequest={props.onBluetoothTrustRequest}
          onBluetoothTrustConfirm={props.onBluetoothTrustConfirm}
          onBluetoothTrustCancel={props.onBluetoothTrustCancel}
          onMuteChange={
            props.volumeBlocked
              ? undefined
              : (value) => props.onControlAction((actions) => actions.setMute(value))
          }
          onDoNotDisturbChange={(value) =>
            props.onControlAction((actions) => actions.setDoNotDisturb(value))
          }
          onSettings={props.onSettings}
          onDismiss={props.onControlsDismiss}
        />
        <TaskOverflow
          open={props.taskOverflowOpen}
          screenW={props.primaryOutput.width}
          screenH={props.primaryOutput.height}
          anchor={props.overflowAnchor ?? anchors.controls!}
          tasks={props.overflowTasks}
          title={props.overflowTitle}
          onTaskPress={props.onTaskOverflowPress}
          onTaskClose={props.onTaskClose}
          // Only one application's windows can be closed together; never a mixed overflow.
          onCloseAll={
            props.overflowTitle
              ? () => {
                  for (const task of props.overflowTasks) props.onTaskClose(task);
                }
              : undefined
          }
          onDismiss={props.onControlsDismiss}
        />
        <NotificationsTray
          open={props.notificationsOpen}
          screenW={props.primaryOutput.width}
          screenH={props.primaryOutput.height}
          anchor={anchors.notifications!}
          state={props.status}
          busy={props.controlsBusy}
          error={props.controlsError}
          now={Date.now()}
          view={props.notificationView}
          onViewChange={props.onNotificationView}
          scrollY={props.controlsScrollY}
          onScroll={props.onControlsScroll}
          onClose={props.onControlsDismiss}
          onClearAll={(pairs) =>
            props.onControlAction(async (actions) => {
              const result = await actions.dismissMany(pairs);
              if (result.skipped)
                throw new Error(
                  `${result.dismissed} dismissed; ${result.skipped} changed or closed notices preserved`,
                );
            })
          }
          onInvokeAction={(id, key, revision) =>
            props.onControlAction((actions) => actions.invokeAction(id, key, revision))
          }
          onDismiss={(id: number, revision: number) =>
            props.onControlAction((actions) => actions.dismiss(id, revision))
          }
        />
      </Group>
    </Group>
  );
}

/**
 * In-process DE shell: bottom panel + Super-key launcher + SSD titlebars.
 */
/** One wheel notch scrolls about a launcher row. */
const WHEEL_NOTCH_PX = 44;
/** Notches closer together than this are a trackpad burst and scroll in finer steps. */
const WHEEL_BURST_MS = 40;
const WHEEL_BURST_PX = 14;

export function createShell(
  spawn: ShellSpawn,
  onTaskAction: (action: TaskWindowAction) => void = () => {},
  controls?: DesktopControlActions,
  observeScroll?: ((event: ShellScrollObservation) => void) & { active?: () => boolean },
  onLogout?: () => void,
  /** Lock the session (the compositor owns the lock); absent: the Lock row is unavailable. */
  onLock?: () => void,
  /** Suspend, restart and shut down; absent: those rows are unavailable. */
  power?: ShellPowerControls,
): ShellBridge {
  // React commits made by the chrome itself (tweened layout) need a full retained render.
  let chromeCommitted = true;
  const root: ShellRoot = createShellRoot({
    onCommit: () => {
      chromeCommitted = true;
    },
  });
  // The chrome is drawn as cached retained layers: a glide or fade only recomposites what moved
  // instead of re-rendering React and re-rasterizing the whole output every frame.
  const chromeScene = new RetainedSceneRenderer({ precise: true });
  const chromeSoftware = new RetainedSoftwareRenderer();
  /** Damage since the compositor last read the chrome; null when it must take everything. */
  let chromeDamage: RetainedClip[] | null = null;
  const presentChrome = (scene: RetainedSceneFrame, full: boolean) => {
    const frame = chromeSoftware.render(scene);
    const changed = full || !scene.damage || scene.damage.length > 0;
    if (!changed && overlay === frame.pixels) return;
    overlay = frame.pixels;
    overlayRevision++;
    overlayRuns = null;
    // Damage accumulates until the compositor reads it; too many pieces become one full upload.
    if (full || !scene.damage) chromeDamage = null;
    else if (chromeDamage) {
      chromeDamage.push(...scene.damage);
      if (chromeDamage.length > 32) chromeDamage = null;
    }
  };
  /** Bring the chrome's pixels up to date with motion and commits, without re-rendering React. */
  const refreshChrome = (width: number, height: number) => {
    const viewport = { width, height };
    const scene = chromeCommitted
      ? chromeScene.render(root.container, viewport)
      : (chromeScene.renderPresentation(root.container, viewport) ??
        chromeScene.render(root.container, viewport));
    chromeCommitted = false;
    presentChrome(scene, false);
    // Live transforms move hit targets even when layout is unchanged.
    hits = collectHits(root.container);
  };
  let primaryOutput = { x: 0, y: 0, width: 1, height: 1 };
  const moireRoot =
    process.env.MOIRE_ROOT ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  // Each app's own launcher runs it with the bundled tsx; installed images ship no pnpm.
  const ownedExec = (launcher: string, filter: string) => {
    const script = path.join(moireRoot, launcher);
    return fs.existsSync(script)
      ? shellQuote(script)
      : `pnpm --dir ${shellQuote(moireRoot)} --filter ${filter} start`;
  };
  const settingsExec = ownedExec("apps/core/settings/moire-settings", "@moire/settings");
  const filesExec = ownedExec("apps/bundled/files/moire-files", "@moire/files");
  const builtinApps: DesktopEntry[] = [
    {
      id: "moire-settings.desktop",
      name: "Settings",
      comment: "Moire system settings",
      exec: settingsExec,
      icon: "preferences-system",
      terminal: false,
      categories: ["Settings", "System"],
      startupWMClass: "org.moire.Settings",
      singleMainWindow: true,
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
  let open = process.env.MOIRE_SHELL_START_OPEN === "1";
  let popup: "controls" | "notifications" | "windows" | null = null;
  let taskOverflow: { anchor: PopupAnchor; keys: readonly string[]; title?: string } | null = null;
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
  /** A restart or shut down counting down in the power view; anything else cancels it. */
  let powerPending: {
    action: "reboot" | "power-off";
    deadline: number;
    shown: number;
    timer: ReturnType<typeof setInterval>;
  } | null = null;
  const sessionPower = (): QuickSettingsPower | undefined => {
    if (!power) return undefined;
    try {
      return power.capabilities();
    } catch (error) {
      console.warn("[shell] power capabilities unavailable:", error);
      return { suspend: false, reboot: false, powerOff: false };
    }
  };
  const cancelPowerAction = () => {
    if (!powerPending) return;
    clearInterval(powerPending.timer);
    powerPending = null;
    dirty = true;
  };
  const runPowerAction = (action: QuickSettingsPowerAction) => {
    cancelPowerAction();
    const allowed = sessionPower();
    if (
      !power ||
      !allowed ||
      !(action === "suspend"
        ? allowed.suspend
        : action === "reboot"
          ? allowed.reboot
          : allowed.powerOff)
    )
      return;
    // The popup closes first: nothing of it should be on screen when the session locks or ends.
    dismissControls();
    try {
      power.run(action);
    } catch (error) {
      console.warn(`[shell] ${action} failed:`, error);
    }
  };
  const requestPowerAction = (action: QuickSettingsPowerAction) => {
    if (action === "suspend") {
      runPowerAction(action);
      return;
    }
    cancelPowerAction();
    const seconds = power?.confirmSeconds ?? POWER_CONFIRM_SECONDS;
    const timer = setInterval(() => {
      if (!powerPending) return;
      const left = powerPending.deadline - Date.now();
      if (left <= 0) {
        runPowerAction(powerPending.action);
        return;
      }
      // Redraw only when the shown whole second changes.
      const shown = Math.ceil(left / 1000);
      if (shown !== powerPending.shown) {
        powerPending.shown = shown;
        dirty = true;
      }
    }, 100);
    timer.unref?.();
    powerPending = { action, deadline: Date.now() + seconds * 1000, shown: seconds, timer };
    resetPopupFocus();
  };
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
  // Follows the 24-hour pref and timedated zone changes without restarting the shell.
  const liveClock = createLiveClock();
  let clock = liveClock.format();
  let tasks: TaskWindowInfo[] = [];
  let lastWheelMs = 0;
  let chromeMoving = false;
  const taskAnchors = new Map<string, PopupAnchor>();
  const panelGlass: PanelMaterial[] = [];
  let dirty = true;
  const initialSettings = loadSettings();
  let showDesktopIcons = initialSettings.showDesktopIcons;
  let panelFullWidth = initialSettings.panelFullWidth;
  let panelIconsOnly = initialSettings.panelIconsOnly;
  let launcherPins: readonly string[] = initialSettings.launcherPins;
  let launcherNotice: string | undefined;
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
  // Super alone toggles the launcher on release; any chord made while it is held cancels that.
  let superChord = false;
  let keyboardLayout: ShellKeyboardLayout | null = null;
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

  let motionTick = Date.now();
  const PANEL_BTN_LEFT = 0x110; // BTN_LEFT
  const PANEL_BTN_RIGHT = 0x111; // BTN_RIGHT
  const PANEL_BTN_MIDDLE = 0x112; // BTN_MIDDLE
  const desktop = createDesktop({
    spawn,
    filesExec,
    settingsExec,
    openSettings: (link) => openSettings(link),
    activation: () => activation,
    activationPortal,
    modifiers: () => ({ ctrl: ctrlHeld, shift: shiftHeld, alt: altHeld, meta: metaHeld }),
    invalidateChrome: () => {
      dirty = true;
    },
    chromeHits: () => {
      ensureOverlayHits();
      return hits;
    },
    showIcons: () => showDesktopIcons,
  });
  /** Alpha runs of the latest desktop raster, for the software paint path. */
  let desktopRuns: { revision: number; runs: AlphaRuns } | null = null;

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
    if (appsChanged) dirty = true;
  };
  setInterval(refreshApps, 30_000).unref?.();

  setInterval(() => {
    const next = liveClock.format();
    if (next !== clock) {
      clock = next;
      dirty = true;
    }
  }, 1000).unref?.();

  // The lock screen: its own root, drawn by the compositor only while the session is locked.
  let lockDate = { clock: "", text: "" };
  let lockThemeEpoch = 0;
  const lockSurface = createLockSurface({
    clock: () => clock,
    date: () => {
      if (lockDate.clock !== clock)
        lockDate = {
          clock,
          text: formatCalendarDate(new Date(), loadSettings().region, {
            style: "long",
            timeZone: systemTimeZone() ?? undefined,
          }),
        };
      return lockDate.text;
    },
    battery: () => {
      const battery = status.kind === "ready" ? status.snapshot.battery : null;
      return battery?.kind === "ready" && battery.source !== "ups"
        ? {
            percentage: Math.round(battery.percentage),
            charging: battery.chargeState === "charging",
          }
        : null;
    },
    themeEpoch: () => lockThemeEpoch,
  });
  // The secure prompt: likewise its own root, drawn by the compositor only while one is up.
  const securePromptSurface = createSecurePromptSurface({ themeEpoch: () => lockThemeEpoch });

  /** Pins are re-read on every open, so a change in Settings shows the next time. */
  const openLauncher = () => {
    try {
      launcherPins = loadSettings().launcherPins;
    } catch (error) {
      console.warn("[shell] launcher pins unreadable:", error);
    }
    open = true;
    dirty = true;
  };
  const launcherApps = () => orderLauncherApps(apps, launcherPins);
  const togglePin = (app: DesktopEntry) => {
    const pinned = launcherPins.includes(app.id);
    try {
      launcherPins = updateLauncherPins((pins) => toggleLauncherPin(pins, app.id));
      launcherNotice = launcherPins.includes(app.id)
        ? `Pinned ${app.name}`
        : pinned
          ? `Unpinned ${app.name}`
          : "The launcher is full; unpin an app first.";
    } catch (error) {
      console.warn("[shell] launcher pin failed:", error);
      launcherNotice = `Could not ${pinned ? "unpin" : "pin"} ${app.name}.`;
    }
    dirty = true;
  };
  const dismissLauncher = () => {
    launcherNotice = undefined;
    open = false;
    query = "";
    selected = 0;
    launchState = { kind: "idle" };
    dirty = true;
  };
  const dismissControls = () => {
    cancelPowerAction();
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
  const toggleTaskOverflow = (
    anchor: PopupAnchor,
    hiddenTasks: readonly TaskWindowInfo[],
    title?: string,
  ) => {
    if (popup === "windows") {
      dismissControls();
      return;
    }
    dismissControls();
    dismissLauncher();
    taskOverflow = {
      anchor: { ...anchor },
      keys: hiddenTasks.map((task) => `${task.clientId}:${task.surfaceId}`),
      title,
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

  /**
   * Start `app`, or open it at a deep link with `linkExec` (its Exec carrying the link).
   * A `SingleMainWindow` app that already has a window is activated instead (restored, raised
   * and focused); a deep link is still run, and the app's own single-instance lock hands it to
   * the open window and exits. Other apps open a new window every time.
   */
  /** Open Settings, at `link` (`page#setting`) when given; false when Settings is not installed. */
  const openSettings = (link?: string): boolean => {
    const settings = apps.find(
      (app) => app.id === "moire-settings.desktop" || app.id === "moire-settings",
    );
    if (!settings) return false;
    launch(settings, link ? settingsCommand(settings.exec, link) : undefined);
    return true;
  };
  const launch = (app: DesktopEntry, linkExec?: string) => {
    const running = app.singleMainWindow
      ? tasks.find((task) => applicationOwnsWindow(app, task.appId))
      : undefined;
    if (running) {
      console.log(`[shell] activate ${app.id} (${running.clientId}:${running.surfaceId})`);
      if (open) dismissLauncher();
      onTaskAction({ clientId: running.clientId, surfaceId: running.surfaceId, kind: "activate" });
      if (linkExec) {
        try {
          const child = spawn({ exec: linkExec });
          child.once?.("error", (error) =>
            console.error(`[shell] deep link failed ${app.id}:`, error),
          );
          child.unref?.();
        } catch (error) {
          console.error(`[shell] deep link failed ${app.id}:`, error);
        }
      }
      dirty = true;
      return;
    }
    if (launchState.kind === "pending") return;
    const attempt: LauncherLaunchState = { kind: "pending", appName: app.name };
    launchState = attempt;
    dirty = true;
    const command = linkExec ?? app.exec;
    const exec = app.terminal ? `moire-terminal --command ${shellQuote(command)}` : command;
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
      <Group x={0} y={0} width={width} height={height}>
        <ShellApp
          width={width}
          height={height}
          primaryOutput={primaryOutput}
          taskAnchors={taskAnchors}
          panelGlass={panelGlass}
          panelFullWidth={panelFullWidth}
          panelIconsOnly={panelIconsOnly}
          open={open}
          query={query}
          selected={selected}
          launchState={launchState}
          apps={apps}
          launcherPins={launcherPins}
          launcherNotice={launcherNotice}
          onPin={togglePin}
          clock={clock}
          tasks={panelTasks}
          controlsOpen={popup === "controls"}
          notificationsOpen={popup === "notifications"}
          taskOverflowOpen={popup === "windows"}
          overflowAnchor={taskOverflow?.anchor ?? null}
          overflowTasks={panelTasks.filter((task) =>
            taskOverflow?.keys.includes(`${task.clientId}:${task.surfaceId}`),
          )}
          onTaskOverflowToggle={toggleTaskOverflow}
          onTaskOverflowPress={activateOverflowTask}
          overflowTitle={taskOverflow?.title}
          onTaskClose={(task) =>
            onTaskAction({ clientId: task.clientId, surfaceId: task.surfaceId, kind: "close" })
          }
          controlsView={controlsView}
          onLogout={onLogout}
          onLock={
            onLock
              ? () => {
                  popup = null;
                  dirty = true;
                  onLock();
                }
              : undefined
          }
          notificationView={notificationView}
          volumeDraft={volumeDraft()}
          sessionPower={sessionPower()}
          onPowerAction={power ? requestPowerAction : undefined}
          powerConfirm={
            powerPending
              ? {
                  action: powerPending.action,
                  secondsLeft: Math.max(0, (powerPending.deadline - Date.now()) / 1000),
                }
              : undefined
          }
          onPowerConfirm={() => {
            if (powerPending) runPowerAction(powerPending.action);
          }}
          onPowerCancel={() => {
            cancelPowerAction();
            resetPopupFocus();
          }}
          onControlsView={(view) => {
            cancelPowerAction();
            if (controlsView === "bluetooth" && view !== "bluetooth") cleanupBluetoothFlow();
            bluetoothViewEpoch++;
            resetPopupFocus();
            if (view !== "network") wifiDraft = null;
            controlsView = view;
          }}
          onNotificationView={(view) => {
            resetPopupFocus();
            notificationView = view;
          }}
          onNotificationsToggle={toggleNotifications}
          onVolumeStart={() => {
            if (controls) volumeIntent.begin();
            controlsError = "";
            dirty = true;
          }}
          onVolumeChange={(value) => {
            volumeIntent.change(value);
            dirty = true;
          }}
          onVolumeCommit={commitVolume}
          onVolumeCancel={() => {
            volumeIntent.cancel();
            dirty = true;
          }}
          wifiSelection={wifiDraft?.ap}
          wifiPassword={wifiDraft?.password ?? ""}
          onWifiSelect={(ap) => {
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
          }}
          onWifiPasswordChange={(value) => {
            if (wifiDraft && value.length <= 256 && !value.includes("\0"))
              wifiDraft = { ...wifiDraft, password: value };
            dirty = true;
          }}
          onWifiConnect={connectWifi}
          onWifiSelectionCancel={() => {
            wifiDraft = null;
            resetPopupFocus();
          }}
          onWifiRefresh={() => controlAction((actions) => actions.refreshWifi())}
          onBluetoothChange={changeBluetooth}
          onBluetoothRefresh={() => {
            if (
              !bluetoothCurrent() ||
              (status.kind === "ready" &&
                (status.snapshot.updating ||
                  status.snapshot.bluetooth.operation.kind === "pending"))
            )
              return;
            controlAction((actions) => actions.refreshBluetooth(), bluetoothCurrent);
          }}
          onBluetoothDiscoveryStart={
            controls?.startBluetoothDiscovery
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
                  const ticket = {
                    owner: current.owner,
                    epoch: bluetoothViewEpoch,
                    canceled: false,
                  };
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
                          bluetoothFlow = {
                            owner: ticket.owner,
                            leaseId: observed.pairing.lease.id,
                          };
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
              : undefined
          }
          onBluetoothDiscoveryStop={
            ownsBluetoothPairing && controls?.stopBluetoothDiscovery
              ? () => {
                  if (bluetoothCurrent()) cleanupBluetoothFlow();
                }
              : undefined
          }
          onBluetoothPair={
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
              : undefined
          }
          onBluetoothPairCancel={
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
              : undefined
          }
          onBluetoothPromptResponse={
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
              : undefined
          }
          onBluetoothInputResponse={
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
              : undefined
          }
          onBluetoothTrustRequest={
            controls?.requestBluetoothTrust
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
                  const ticket = {
                    owner: status.owner,
                    epoch: bluetoothViewEpoch,
                    canceled: false,
                  };
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
              : undefined
          }
          onBluetoothTrustConfirm={
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
              : undefined
          }
          onBluetoothTrustCancel={
            controls?.cancelBluetoothTrust && bluetoothTrustFlow ? cancelTrust : undefined
          }
          onWifiCancel={() => {
            wifiDraft = null;
            controlAction((actions) => actions.cancelWifi());
          }}
          onSettings={(link) => {
            dismissControls();
            if (!openSettings(link)) {
              controlsError = "Settings application unavailable";
              dirty = true;
            }
          }}
          status={status}
          cachedCapabilities={cachedCapabilities}
          cachedNetworkPresentation={cachedNetworkPresentation}
          controlsBusy={controlsBusy}
          volumeBlocked={volumeLocked()}
          controlsError={controlsError}
          controlsScrollY={controlsScrollY}
          onControlsScroll={(value, metrics) => {
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
          }}
          onControlsToggle={toggleControls}
          onControlsDismiss={dismissControls}
          onControlAction={controlAction}
          onToggle={() => {
            dismissControls();
            if (open) dismissLauncher();
            else openLauncher();
          }}
          onQuery={(q: string) => {
            query = q;
            selected = 0;
            if (launchState.kind === "failed") launchState = { kind: "idle" };
            dirty = true;
          }}
          onSelect={(i: number) => {
            selected = i;
            dirty = true;
          }}
          onLaunch={launch}
          onDismiss={dismissLauncher}
          onTaskPress={(task: TaskWindowInfo) => {
            onTaskAction({
              clientId: task.clientId,
              surfaceId: task.surfaceId,
            });
          }}
        />
        {desktop.overlay(width, height)}
      </Group>,
    );
    const sizeChanged = ow !== width || oh !== height;
    presentChrome(chromeScene.render(root.container, { width, height }), sizeChanged);
    chromeCommitted = false;
    const painted = { pixels: overlay!, hits: collectHits(root.container) };
    // Only the software paint path reads alpha runs; build them there on demand.
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
        <TitleBar
          x={0}
          y={0}
          width={window.contentW}
          title={window.title}
          appId={window.appId}
          focused={window.focused}
          maximized={window.maximized}
          onDrag={() => {
            ssdPending.current = { kind: "drag", surfaceId: sid, clientId: cid };
          }}
          onClose={() => {
            ssdPending.current = { kind: "close", surfaceId: sid, clientId: cid };
          }}
          onMaximize={() => {
            ssdPending.current = {
              kind: "maximize",
              surfaceId: sid,
              clientId: cid,
            };
          }}
          onMinimize={() => {
            ssdPending.current = {
              kind: "minimize",
              surfaceId: sid,
              clientId: cid,
            };
          }}
        />,
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
    panelMaterial() {
      return panelGlass;
    },

    taskAnchor(clientId, surfaceId) {
      return taskAnchors.get(`${clientId}:${surfaceId}`) ?? null;
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
      } else refreshChrome(width, height);
      if (!overlay) return;
      overlayRuns ??= buildAlphaRuns(overlay, width, height);
      blendOverlay(fb, pitchPx, width, height, overlay, overlayRuns);
    },

    chromeRaster(width, height) {
      if (dirty || !overlay || ow !== width || oh !== height) {
        rebuild(width, height);
      } else refreshChrome(width, height);
      if (!overlay) return null;
      const damage = chromeDamage ?? undefined;
      chromeDamage = [];
      return {
        id: "shell:chrome",
        pixels: overlay,
        width,
        height,
        stride: width * 4,
        revision: overlayRevision,
        x: 0,
        y: 0,
        damage,
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

    setKeyboardLayout(layout) {
      keyboardLayout = layout;
      dirty = true;
    },

    keyboardLayout: () => keyboardLayout,

    onLayoutShortcut() {
      superChord = true;
    },

    onSuperChord() {
      superChord = true;
    },

    onClientFocus() {
      dismissControls();
      desktop.release();
      dirty = true;
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
      if (clientModifier && ev.value === 1 && !open && !popupOpen() && !desktop.capturesInput())
        forwardedModifiers.add(ev.code);
      if (desktop.capturesInput()) {
        if (clientModifier) return true;
        const consumed = desktop.onModalKey(ev.code, ev.value);
        dirty = true;
        return consumed;
      }
      if (ev.code === KEY_LEFTMETA || ev.code === KEY_RIGHTMETA) {
        if (ev.value === 1) {
          metaHeld = true;
          superChord = false;
        } else if (ev.value === 0) {
          metaHeld = false;
          if (!superChord) {
            dismissControls();
            if (open) dismissLauncher();
            else openLauncher();
          }
        }
        return true;
      }
      if (metaHeld && ev.value === 1) superChord = true;
      if (metaHeld && ev.code === 49 && ev.value === 1) {
        toggleNotifications();
        return true;
      }
      if (metaHeld && ev.code === 16 && ev.value === 1) {
        toggleControls();
        return true;
      }
      if (popupOpen()) {
        if (ev.code === KEY_ESC && ev.value === 1 && powerPending) {
          cancelPowerAction();
          resetPopupFocus();
          return true;
        }
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

      if (!open && desktop.keyboardActive) {
        const modifier =
          ev.code === KEY_LEFTCTRL ||
          ev.code === KEY_RIGHTCTRL ||
          ev.code === KEY_LEFTSHIFT ||
          ev.code === KEY_RIGHTSHIFT;
        // A client may have received the modifier-down before focus moved to
        // the desktop. Forward both edges so it cannot retain a stuck key.
        if (modifier) return false;
        const consumed = desktop.onKey(ev.code, ev.value);
        dirty = true;
        return consumed;
      }

      if (!open) return false;
      if (ev.value !== 1 && ev.value !== 2) return true;

      if (ev.code === KEY_UP || ev.code === KEY_DOWN) {
        const list = filterApplications(launcherApps(), query);
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
      if (metaHeld && ev.value === 1) superChord = true;
      const left = ev.button === PANEL_BTN_LEFT;
      const right = ev.button === PANEL_BTN_RIGHT;
      // Middle-click reaches a control's context handler as "middle" (a taskbar chip closes).
      const middle = ev.button === PANEL_BTN_MIDDLE;
      if (!left && !right && !middle) return open || popupOpen() || desktop.capturesInput();
      // A desktop click re-activates desktop keys after this; any other click hands them back.
      if (ev.value === 1) desktop.deactivateKeyboard();
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
      if (ev.value !== 1)
        return open || popupOpen() || desktop.capturesInput() || overlayGrab != null;
      // A second button must not replace an in-flight left-button gesture.
      if (overlayGrab) return true;
      desktop.pressOutsideDesktop(ev.y);
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
            button: middle ? ("middle" as const) : right ? ("right" as const) : ("left" as const),
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
          if (right || middle) hit.onContextMenu?.(args);
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
      return desktop.capturesInput();
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

      return open || popupOpen() || desktop.capturesInput() || next != null;
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
      // A wheel notch moves about one launcher row; the rapid bursts a trackpad sends move in
      // smaller steps, so a gentle swipe glides instead of leaping several rows at a time.
      const now = Date.now();
      const step = now - lastWheelMs < WHEEL_BURST_MS ? WHEEL_BURST_PX : WHEEL_NOTCH_PX;
      lastWheelMs = now;
      const deltaY = -ev.deltaY * step;
      for (let i = hits.length - 1; i >= 0; i--) {
        const hit = hits[i]!;
        if (hit.onWheel && hitRegionContains(hit, ev.x, ev.y)) {
          const consumed = hit.onWheel({
            x: ev.x,
            y: ev.y,
            localX: ev.x - hit.x,
            localY: ev.y - hit.y,
            // evdev REL_WHEEL is a signed notch count; ScrollArea takes logical pixels.
            deltaY,
          });
          if (observeScroll && (observeScroll.active?.() ?? true))
            observeScroll({
              stage: "hit",
              popup,
              view: popup === "notifications" ? notificationView : controlsView,
              x: ev.x,
              y: ev.y,
              deltaY,
              before,
              after: controlsScrollY,
              bounds: { x: hit.x, y: hit.y, width: hit.width, height: hit.height },
              clip: hit.pointerClip ?? null,
            });
          // No shell re-render here: scrollers keep their own state (the launcher) or mark the
          // shell dirty themselves (Quick Settings); a glide is then presentation only.
          // A scroller at its limit chains the wheel to the next one beneath.
          if (consumed === false) continue;
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
          deltaY,
          before,
          after: controlsScrollY,
          bounds: null,
          clip: null,
        });
      return open || popupOpen() || desktop.capturesInput();
    },

    onDesktopPointerButton(ev) {
      dirty = true;
      return desktop.onPointerButton(ev);
    },

    onDesktopPointerMotion(ev) {
      if (showDesktopIcons) desktop.onPointerMotion(ev);
    },

    isLauncherOpen: () => open,
    needsRepaint: () => {
      const now = Date.now();
      const dt = Math.min((now - motionTick) / 1000, 0.1);
      motionTick = now;
      const wasSsdAnimating = ssdAnimationActive;
      const motionsMoving = tickAllMotions(dt);
      if (motionsMoving || wasSsdAnimating) {
        // Motion is presentation only: chromeRaster recomposites the moved layers without a
        // React render. SSD strips still repaint.
        chromeMoving = true;
        // Shell UI motion currently belongs to chrome/menus or SSD controls;
        // the desktop icon root has no animated values. Re-rasterizing its
        // full-screen backing store here only steals frame budget from scroll.
        for (const strip of ssdStripCache.values()) strip.dirty = true;
      }
      ssdAnimationActive = motionsMoving;
      const moving = chromeMoving || chromeCommitted;
      chromeMoving = false;
      return (
        dirty ||
        moving ||
        desktop.needsRepaint() ||
        lockSurface.needsRepaint(motionsMoving) ||
        securePromptSurface.needsRepaint(motionsMoving)
      );
    },
    invalidateChrome: () => {
      dirty = true;
      lockThemeEpoch++;
      chromeDamage = null;
      chromeSoftware.invalidate();
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
      desktopRuns = null;
      const settings = loadSettings();
      showDesktopIcons = settings.showDesktopIcons;
      panelFullWidth = settings.panelFullWidth;
      panelIconsOnly = settings.panelIconsOnly;
      launcherPins = settings.launcherPins;
      setUiScaleFactor(settings.uiScale);
      desktop.invalidate();
      console.log("[shell] chrome invalidated (prefs/theme)");
    },

    paintDesktop(fb, pitchPx, width, height) {
      if (!showDesktopIcons) return;
      const raster = desktop.raster(width, height);
      if (!raster) return;
      if (desktopRuns?.revision !== raster.revision)
        desktopRuns = {
          revision: raster.revision,
          runs: buildAlphaRuns(raster.pixels, width, height),
        };
      blendOverlay(fb, pitchPx, width, height, raster.pixels, desktopRuns.runs);
    },

    desktopRaster(width, height) {
      const raster = desktop.raster(width, height);
      if (!raster) return null;
      return {
        id: "shell:desktop",
        pixels: raster.pixels,
        width,
        height,
        stride: width * 4,
        revision: raster.revision,
        x: 0,
        y: 0,
      };
    },

    acceptDesktopDrop: (uris, x, y) => desktop.acceptDrop(uris, x, y),
    hitDesktop: (x, y) => desktop.hitDesktop(x, y),

    paintDragPreview(fb, pitchPx, width, height, cursorX, cursorY, label) {
      const chip = desktop.dragChip(cursorX, cursorY, label);
      if (chip)
        blitStrip(fb, pitchPx, width, height, chip.x, chip.y, chip.pixels, chip.width, chip.height);
    },

    dragRaster(cursorX, cursorY, label) {
      const chip = desktop.dragChip(cursorX, cursorY, label);
      return chip
        ? {
            id: "shell:drag-preview",
            pixels: chip.pixels,
            width: chip.width,
            height: chip.height,
            stride: chip.width * 4,
            revision: chip.revision,
            x: chip.x,
            y: chip.y,
          }
        : null;
    },

    desktopDragLabel: () => desktop.dragLabel(),
    desktopDragUri: () => desktop.dragUri(),
    finishDesktopDrag: (commit, x, y) => desktop.finishDrag(commit, x, y),
    onDesktopDragHover: (x, y, mimeTypes) => desktop.dragHover(x, y, mimeTypes),
    clearDesktopDragHover: () => desktop.clearDragHover(),
    cancelDesktopDrag: (x, y) => desktop.cancelDrag(x, y),
    checkDesktopDragWatchdog: () => desktop.checkDragWatchdog(),
    whenDesktopIdle: () => desktop.whenIdle(),

    setLocked(locked) {
      if (locked) {
        // Nothing of the desktop survives behind the lock: menus close, drafts go, and modifier
        // state resets (their releases go to the lock, not here). A pending restart is dropped.
        cancelPowerAction();
        if (popup === "controls") cleanupBluetoothFlow();
        open = false;
        query = "";
        selected = 0;
        popup = null;
        taskOverflow = null;
        wifiDraft = null;
        overlayGrab = null;
        metaHeld = ctrlHeld = shiftHeld = altHeld = false;
        forwardedModifiers.clear();
      }
      lockSurface.setLocked(locked);
      dirty = true;
    },
    lockRaster: (view, width, height) => lockSurface.raster(view, width, height),
    onLockPointer: (ev) => lockSurface.pointer(ev),

    setSecurePromptOpen(open) {
      if (open) {
        // Modifier releases and the end of a pointer grab go to the prompt, not here.
        overlayGrab = null;
        metaHeld = ctrlHeld = shiftHeld = altHeld = false;
        forwardedModifiers.clear();
      }
      securePromptSurface.setOpen(open);
      dirty = true;
    },
    securePromptRaster: (view, width, height) => securePromptSurface.raster(view, width, height),
    onSecurePromptPointer: (ev) => securePromptSurface.pointer(ev),
    secureNoticeRaster: (width, height) => securePromptSurface.notice(width, height),
  };
}
