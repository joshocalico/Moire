/**
 * Shell surfaces as they appear on a 1280×800 desktop, built from fixed fixtures so every render
 * of a scene at a given timecode is pixel-identical. Add a scene here to preview or visreg it.
 */
import React, { type ReactElement } from "react";
import { BLUETOOTH_UNAVAILABLE } from "@moire/system-management/bluetooth-status";
import { BATTERY_UNAVAILABLE } from "@moire/system-management/battery-status";
import { WIFI_UNAVAILABLE } from "@moire/system-management/network-status";
import type { DesktopNotice, DesktopStatusState } from "@moire/system-management/desktop-status";
import type { DesktopEntry } from "@moire/app-discovery";
import { Launcher } from "../Launcher";
import { NotificationsTray } from "../NotificationsTray";
import { Panel, groupTasks, panelStatusGeometry, panelTaskRects } from "../Panel";
import type { TaskWindowInfo } from "../ssd";
import { NotificationBanner, QuickSettings, type QuickSettingsProps } from "../QuickSettings";
import { TaskOverflow } from "../TaskOverflow";
import { LockScreen } from "../lock/LockScreen";
import type { LockScreenView } from "../lock/types";
import { SecurePrompt } from "../secure-prompt/SecurePrompt";
import type { SecurePromptView } from "../secure-prompt/types";
import { Rect } from "@moire/react-host";
import { Wallpaper } from "./wallpaper";

export type PreviewScene = Readonly<{
  name: string;
  description: string;
  width: number;
  height: number;
  render(): ReactElement;
  /** A transition scene: mounted and settled first, then switched to this at t=0. */
  then?(): ReactElement;
  /** A control (by focusId) the pointer rests on once the scene has settled, for hover states. */
  hover?: string;
  /** Strip region, when the interesting part does not move (a static design). */
  crop?: { x: number; y: number; width: number; height: number };
}>;

const WIDTH = 1280;
const HEIGHT = 800;
/** Every age and timestamp is relative to this instant (2026-10-09 14:20 UTC). */
const NOW = Date.UTC(2026, 9, 9, 14, 20);
const CLOCK = "14:20";
const inert = () => {};

function notice(id: number, appName: string, summary: string, body: string, ageMinutes: number) {
  return {
    id,
    revision: 1,
    appName,
    summary,
    body,
    createdAt: NOW - ageMinutes * 60_000,
    closedAt: null,
    closed: false,
    actions: [],
  } satisfies DesktopNotice;
}

const STATUS: DesktopStatusState = {
  kind: "ready",
  owner: ":1.4",
  snapshot: {
    revision: 1,
    updating: false,
    audio: {
      kind: "ready",
      volume: 0.62,
      muted: false,
      name: "Built-in speakers",
    },
    network: [{ name: "eth0", transport: "wired", addresses: ["192.0.2.3"] }],
    wifi: WIFI_UNAVAILABLE,
    bluetooth: BLUETOOTH_UNAVAILABLE,
    battery: BATTERY_UNAVAILABLE,
    capabilities: {
      audio: true,
      brightness: false,
      battery: false,
      bluetooth: false,
      power: false,
      notifications: true,
    },
    notificationsAvailable: true,
    doNotDisturb: false,
    notices: [
      notice(
        1,
        "Screenshot",
        "Screenshot saved",
        "Saved to Pictures/Screenshots as Screenshot 2026-10-09 at 14.19.png.",
        1,
      ),
      notice(2, "Calendar", "Design review", "Starts in 10 minutes in Room 3.", 12),
      notice(3, "Files", "Copy complete", "4 items copied to Documents/Archive.", 95),
    ],
  },
};

const APPS: DesktopEntry[] = [
  "Settings",
  "Files",
  "Terminal",
  "Editor",
  "Calculator",
  "Calendar",
  "Clock",
  "Music",
  "Notes",
  "Weather",
].map((name) => ({
  id: `org.moire.${name}.desktop`,
  name,
  exec: "true",
  terminal: false,
  categories: name === "Files" ? ["FileManager"] : [],
}));

const TASK_APPS = [
  "Files",
  "Terminal",
  "Editor",
  "Calculator",
  "Notes",
  "Music",
  "Clock",
  "Calendar",
  "Weather",
  "Settings",
  "Characters",
  "Dictionary",
  "Colors",
  "Help",
];
/** More windows than a 1280px panel shows, so the overflow popup has hidden ones to list. */
const TASKS: TaskWindowInfo[] = Array.from({ length: 32 }, (_, index) => {
  const name = TASK_APPS[index % TASK_APPS.length]!;
  const copy = Math.floor(index / TASK_APPS.length);
  return {
    clientId: index + 1,
    surfaceId: 10,
    title: copy ? `${name} ${copy + 1}` : name,
    appId: `org.moire.${name}`,
    focused: index === 0,
    minimized: index % 5 === 4,
  };
});

const anchors = (taskCount = 0) =>
  panelStatusGeometry({
    tasks: TASKS.slice(0, taskCount),
    screenW: WIDTH,
    screenH: HEIGHT,
    clock: CLOCK,
    onControlsClick: inert,
    onNotificationsClick: inert,
    notificationCount: STATUS.kind === "ready" ? STATUS.snapshot.notices.length : 0,
    status: STATUS,
    taskCount,
    onTaskOverflowClick: inert,
  });

/** A flat desktop ground and the panel, so popups are judged in place. */
function Desktop(props: {
  tasks?: TaskWindowInfo[];
  fullWidth?: boolean;
  iconsOnly?: boolean;
  children?: ReactElement | null;
}) {
  return (
    <>
      <Wallpaper width={WIDTH} height={HEIGHT} />
      <Panel
        fullWidth={props.fullWidth}
        iconsOnly={props.iconsOnly}
        screenW={WIDTH}
        screenH={HEIGHT}
        clock={CLOCK}
        tasks={props.tasks ?? []}
        status={STATUS}
        notificationCount={STATUS.kind === "ready" ? STATUS.snapshot.notices.length : 0}
        onControlsClick={inert}
        onNotificationsClick={inert}
        onTaskOverflowClick={inert}
      />
      {props.children ?? null}
    </>
  );
}

function quickSettings(
  view: QuickSettingsProps["view"],
  power?: Pick<QuickSettingsProps, "powerConfirm">,
): ReactElement {
  return (
    <Desktop>
      <QuickSettings
        open
        screenW={WIDTH}
        screenH={HEIGHT}
        anchor={anchors().controls!}
        state={STATUS}
        busy={false}
        error=""
        view={view}
        onViewChange={inert}
        scrollY={0}
        onScroll={inert}
        onDismiss={inert}
        onVolumeChange={inert}
        onVolumeStart={inert}
        onVolumeCommit={inert}
        onMuteChange={inert}
        onDoNotDisturbChange={inert}
        onSettings={inert}
        onLogout={inert}
        onLock={inert}
        sessionPower={{ suspend: true, reboot: true, powerOff: true }}
        onPowerAction={inert}
        powerConfirm={power?.powerConfirm}
        onPowerCancel={inert}
        onPowerConfirm={inert}
      />
    </Desktop>
  );
}

const taskbarTasks = (count: number, focused: number) =>
  TASKS.slice(0, count).map((task, index) => ({
    ...task,
    focused: index === focused,
    minimized: false,
  }));

/** Three Terminal windows and Files: Terminal groups into one chip. */
const groupedTasks: TaskWindowInfo[] = [
  {
    clientId: 1,
    surfaceId: 1,
    title: "~/projects",
    appId: "org.moire.Terminal",
    focused: false,
    minimized: false,
  },
  {
    clientId: 2,
    surfaceId: 2,
    title: "Documents",
    appId: "org.moire.Files",
    focused: true,
    minimized: false,
  },
  {
    clientId: 3,
    surfaceId: 3,
    title: "htop",
    appId: "org.moire.Terminal",
    focused: false,
    minimized: false,
  },
  {
    clientId: 4,
    surfaceId: 4,
    title: "vim notes.md",
    appId: "org.moire.Terminal",
    focused: false,
    minimized: true,
  },
];
const PANEL_CROP = { x: 0, y: HEIGHT - 96, width: WIDTH, height: 96 };
/** Five windows: Files focused, Music minimized. */
const panelTasks = TASKS.slice(0, 5).map((task, index) => ({
  ...task,
  focused: index === 0,
  minimized: index === 4,
}));

const LOCK_VIEW: LockScreenView = {
  revision: 1,
  user: { name: "Joshua Steele", username: "josh" },
  length: 6,
  phase: "entry",
  retryAtMs: null,
  failures: 0,
  capsLock: false,
  layout: { label: "US", name: "English (US)" },
  power: { suspend: true, powerOff: true, reboot: true },
  reducedMotion: false,
};

/** The lock over the compositor's obscured wallpaper (approximated: the wallpaper, darkened). */
function lockScene(view: Partial<LockScreenView> = {}, powerMenuOpen = false): ReactElement {
  return (
    <>
      <Wallpaper width={WIDTH} height={HEIGHT} />
      <Rect width={WIDTH} height={HEIGHT} fill={0x80000000} />
      <LockScreen
        width={WIDTH}
        height={HEIGHT}
        view={{ ...LOCK_VIEW, ...view }}
        clock={CLOCK}
        date="Friday, October 9, 2026"
        battery={{ percentage: 82, charging: false }}
        powerMenuOpen={powerMenuOpen}
        onPowerMenu={inert}
        onAction={inert}
      />
    </>
  );
}

const PROMPT_VIEW: SecurePromptView = {
  revision: 1,
  id: 1,
  kind: "password",
  headline: "Authentication is required to add a user",
  requester: { name: "Settings", pid: 4242, x11: false },
  identities: [{ account: "josh", displayName: "Joshua Steele" }],
  selected: 0,
  needsAdministrator: false,
  details: [{ label: "Action", value: "org.freedesktop.accounts.user-administration" }],
  length: 6,
  phase: "entry",
  failures: 0,
  waiting: 0,
  verifications: 0,
  pulsing: false,
  capsLock: false,
  layout: { label: "US", name: "English (US)" },
  reducedMotion: false,
};

/** The prompt over the compositor's obscured wallpaper (approximated, as for the lock). */
function promptScene(view: Partial<SecurePromptView> = {}): ReactElement {
  return (
    <>
      <Wallpaper width={WIDTH} height={HEIGHT} />
      <Rect width={WIDTH} height={HEIGHT} fill={0x80000000} />
      <SecurePrompt
        width={WIDTH}
        height={HEIGHT}
        view={{ ...PROMPT_VIEW, ...view }}
        chooserOpen={false}
        detailsOpen={false}
        onChooser={inert}
        onDetails={inert}
        onAction={inert}
      />
    </>
  );
}

const scenes: PreviewScene[] = [
  {
    name: "panel",
    description: "Panel islands: brand and Apps, open windows, status",
    width: WIDTH,
    height: HEIGHT,
    crop: PANEL_CROP,
    render: () => <Desktop tasks={panelTasks} />,
  },
  {
    name: "panel-groups",
    description: "Several windows of one app sharing a chip, with a count",
    width: WIDTH,
    height: HEIGHT,
    crop: PANEL_CROP,
    render: () => <Desktop tasks={groupedTasks} />,
  },
  {
    name: "task-group-list",
    description: "An app's windows listed from its chip, each closable",
    width: WIDTH,
    height: HEIGHT,
    render: () => {
      const groups = groupTasks(groupedTasks);
      const geometry = panelStatusGeometry({
        screenW: WIDTH,
        screenH: HEIGHT,
        clock: CLOCK,
        tasks: groupedTasks,
        status: STATUS,
        onControlsClick: inert,
        onNotificationsClick: inert,
        notificationCount: 3,
      });
      const rect = panelTaskRects(geometry, groups.length)[0]!;
      const group = groups[0]!;
      return (
        <Desktop tasks={groupedTasks}>
          <TaskOverflow
            open
            screenW={WIDTH}
            screenH={HEIGHT}
            anchor={{
              ...rect,
              x: geometry.panel.x + rect.x,
              y: geometry.panel.y + rect.y,
            }}
            tasks={group.tasks}
            title={group.label}
            onTaskPress={inert}
            onTaskClose={inert}
            onCloseAll={inert}
            onDismiss={inert}
          />
        </Desktop>
      );
    },
  },
  {
    name: "panel-full-width",
    description: "Panel as one full-width bar (Settings › Full-width panel)",
    width: WIDTH,
    height: HEIGHT,
    crop: PANEL_CROP,
    render: () => <Desktop tasks={panelTasks} fullWidth />,
  },
  {
    name: "panel-icons-only",
    description: "Panel with icon-only window buttons (Settings › Panel icons only)",
    width: WIDTH,
    height: HEIGHT,
    crop: PANEL_CROP,
    render: () => <Desktop tasks={panelTasks} iconsOnly />,
  },
  {
    name: "panel-to-full-width",
    description: "Islands merging into one bar as Full-width panel turns on",
    width: WIDTH,
    height: HEIGHT,
    crop: PANEL_CROP,
    render: () => <Desktop tasks={panelTasks} />,
    then: () => <Desktop tasks={panelTasks} fullWidth />,
  },
  {
    name: "panel-to-icons-only",
    description: "Window titles folding away as Panel icons only turns on",
    width: WIDTH,
    height: HEIGHT,
    crop: PANEL_CROP,
    render: () => <Desktop tasks={panelTasks} />,
    then: () => <Desktop tasks={panelTasks} iconsOnly />,
  },
  {
    name: "taskbar-focus",
    description: "Focus moving from one window's button to another",
    width: WIDTH,
    height: HEIGHT,
    render: () => <Desktop tasks={taskbarTasks(3, 0)} />,
    then: () => <Desktop tasks={taskbarTasks(3, 2)} />,
  },
  {
    name: "taskbar-open",
    description: "A new window's button joining the taskbar",
    width: WIDTH,
    height: HEIGHT,
    render: () => <Desktop tasks={taskbarTasks(3, 0)} />,
    then: () => <Desktop tasks={taskbarTasks(4, 3)} />,
  },
  {
    name: "taskbar-close",
    description: "The taskbar reflowing as a window closes",
    width: WIDTH,
    height: HEIGHT,
    render: () => <Desktop tasks={taskbarTasks(9, 0)} />,
    then: () => <Desktop tasks={taskbarTasks(9, 0).filter((_, index) => index !== 1)} />,
  },
  {
    name: "quick-settings",
    description: "Quick Settings opening from the panel",
    width: WIDTH,
    height: HEIGHT,
    render: () => quickSettings("main"),
  },
  {
    name: "quick-settings-tooltip",
    description: "A Quick Settings tooltip painting above the rows below it",
    width: WIDTH,
    height: HEIGHT,
    render: () => quickSettings("main"),
    hover: "quick:mute",
  },
  {
    name: "quick-settings-power-tooltip",
    description: "The power tooltip flipping above its button at the popup's foot",
    width: WIDTH,
    height: HEIGHT,
    render: () => quickSettings("main"),
    hover: "quick:power",
  },
  {
    name: "quick-settings-audio",
    description: "Quick Settings audio output details",
    width: WIDTH,
    height: HEIGHT,
    render: () => quickSettings("audio"),
  },
  {
    name: "quick-settings-power",
    description: "Quick Settings power: lock, log out, suspend, restart and shut down",
    width: WIDTH,
    height: HEIGHT,
    render: () => quickSettings("power"),
  },
  {
    name: "quick-settings-power-confirm",
    description: "Restart counting down in Quick Settings, with Cancel and Restart",
    width: WIDTH,
    height: HEIGHT,
    render: () => quickSettings("power", { powerConfirm: { action: "reboot", secondsLeft: 9 } }),
  },
  {
    name: "notifications",
    description: "Notifications tray opening from the panel",
    width: WIDTH,
    height: HEIGHT,
    render: () => (
      <Desktop>
        <NotificationsTray
          open
          screenW={WIDTH}
          screenH={HEIGHT}
          anchor={anchors().notifications!}
          state={STATUS}
          now={NOW}
          view="active"
          onViewChange={inert}
          scrollY={0}
          onScroll={inert}
          busy={false}
          error=""
          onClearAll={inert}
          onDismiss={inert}
          onInvokeAction={inert}
          onClose={inert}
        />
      </Desktop>
    ),
  },
  {
    name: "banner",
    description: "A new notification dropping in at the top edge",
    width: WIDTH,
    height: HEIGHT,
    render: () => (
      <Desktop>
        <NotificationBanner screenW={WIDTH} state={STATUS} onDismiss={inert} />
      </Desktop>
    ),
  },
  {
    name: "launcher",
    description: "Application launcher rising from the panel",
    width: WIDTH,
    height: HEIGHT,
    render: () => (
      <Desktop>
        <Launcher
          open
          screenW={WIDTH}
          screenH={HEIGHT}
          apps={APPS}
          query=""
          selected={1}
          onQueryChange={inert}
          onLaunch={inert}
          onDismiss={inert}
          onSelect={inert}
        />
      </Desktop>
    ),
  },
  {
    name: "task-overflow",
    description: "Hidden windows popup from a crowded panel",
    width: WIDTH,
    height: HEIGHT,
    render: () => {
      const geometry = anchors(TASKS.length);
      return (
        <Desktop tasks={TASKS}>
          {geometry.overflow ? (
            <TaskOverflow
              open
              screenW={WIDTH}
              screenH={HEIGHT}
              anchor={geometry.overflow}
              tasks={TASKS.slice(geometry.visibleTaskCount)}
              onTaskPress={inert}
              onDismiss={inert}
            />
          ) : null}
        </Desktop>
      );
    },
  },
];

scenes.push(
  {
    name: "lock-screen",
    description: "Lock screen rising in: clock, user, password field, status and power",
    width: WIDTH,
    height: HEIGHT,
    render: () => lockScene(),
  },
  {
    name: "lock-screen-wrong",
    description: "A wrong password: the field shakes and turns red; Caps Lock is on",
    width: WIDTH,
    height: HEIGHT,
    render: () => lockScene({ capsLock: true }),
    then: () => lockScene({ capsLock: true, phase: "wrong", failures: 1, length: 0, revision: 2 }),
  },
  {
    name: "lock-screen-power",
    description: "The lock screen's power menu (only the actions logind allows)",
    width: WIDTH,
    height: HEIGHT,
    render: () => lockScene({ length: 0 }, true),
  },
  {
    name: "polkit-prompt",
    description: "The secure prompt rising in: badge, request, requester, signer and password",
    width: WIDTH,
    height: HEIGHT,
    render: () => promptScene(),
  },
  {
    name: "polkit-prompt-wrong",
    description: "A rejected password: the field shakes and turns red; the prompt stays",
    width: WIDTH,
    height: HEIGHT,
    render: () => promptScene(),
    then: () => promptScene({ phase: "wrong", failures: 1, length: 0, revision: 2 }),
  },
  {
    name: "polkit-prompt-chooser",
    description: "A standard user's request: the administrators who may sign, by full name",
    width: WIDTH,
    height: HEIGHT,
    render: () =>
      promptScene({
        needsAdministrator: true,
        length: 0,
        selected: 1,
        requester: { name: "systemctl", via: "Terminal", x11: false },
        identities: [
          { account: "ada", displayName: "Ada Lovelace" },
          { account: "grace", displayName: "Grace Hopper" },
          { account: "katherine", displayName: "Katherine Johnson" },
        ],
      }),
  },
);

export const PREVIEW_SCENES: ReadonlyMap<string, PreviewScene> = new Map(
  scenes.map((scene) => [scene.name, scene]),
);
