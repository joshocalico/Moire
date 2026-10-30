import React, { useRef, type ReactNode } from "react";
import { Group, Rect, Text, measureText, measureTextBounds } from "@moire/react-host";
import { themePalette, getTheme, panelGeometry, hexToArgb } from "@moire/theme";
import { Icon, Pressable, applicationIcon } from "./widgets";
import type { TaskWindowInfo } from "./ssd";
import type {
  DesktopStatusState,
  DesktopCapabilities,
} from "@moire/system-management/desktop-status";
import {
  BrandMark,
  Entrance,
  Tooltip,
  useAnimatedValue,
  useDampedValue,
  useTween,
  useWidgetTheme,
} from "@moire/ui";
import { networkPresentation, type NetworkPresentation } from "./network-presentation";

import { batteryPresentation } from "./battery-presentation";

/** Windows of one application, shown as one taskbar chip. */
export type TaskGroup = {
  key: string;
  /** The window title for one window, the application's name for several. */
  label: string;
  tasks: TaskWindowInfo[];
  /** The window the chip stands for: the focused one, else the latest shown. */
  lead: TaskWindowInfo;
  focused: boolean;
  minimized: boolean;
};

const appKey = (task: TaskWindowInfo) =>
  task.appId
    ? task.appId.toLowerCase().replace(/\.desktop$/, "")
    : `${task.clientId}:${task.surfaceId}`;

/** "org.moire.TextEditor" → "Text Editor". */
function applicationName(appId: string, fallback: string): string {
  const last = appId
    .replace(/\.desktop$/i, "")
    .split(/[./]/)
    .filter(Boolean)
    .at(-1);
  if (!last) return fallback;
  const words = last.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Group windows by application, keeping the order each application first appeared in. */
export function groupTasks(tasks: readonly TaskWindowInfo[]): TaskGroup[] {
  const groups = new Map<string, TaskWindowInfo[]>();
  for (const task of tasks) {
    const key = appKey(task);
    const members = groups.get(key);
    if (members) members.push(task);
    else groups.set(key, [task]);
  }
  return [...groups].map(([key, members]) => {
    const lead =
      members.find((task) => task.focused) ??
      [...members].reverse().find((task) => !task.minimized) ??
      members[0]!;
    return {
      key,
      tasks: members,
      lead,
      label:
        members.length > 1
          ? applicationName(lead.appId, lead.title || "Window")
          : lead.title || lead.appId || "Window",
      focused: members.some((task) => task.focused),
      minimized: members.every((task) => task.minimized),
    };
  });
}

export type PanelProps = {
  screenW: number;
  screenH: number;
  clock?: string;
  onLauncherClick?: () => void;
  tasks?: TaskWindowInfo[];
  onTaskPress?: (task: TaskWindowInfo) => void;
  onControlsClick?: () => void;
  notificationCount?: number;
  onNotificationsClick?: () => void;
  status?: DesktopStatusState;
  cachedCapabilities?: DesktopCapabilities;
  cachedNetworkPresentation?: NetworkPresentation;
  onTaskOverflowClick?: (anchor: PanelAnchorBounds, hiddenTasks: readonly TaskWindowInfo[]) => void;
  /** One continuous bar instead of separate floating islands. */
  fullWidth?: boolean;
  /** Window buttons show only their icon (the title is a tooltip). */
  iconsOnly?: boolean;
  /** An application with several windows was pressed: list them (anchor is the chip). */
  onTaskGroupPress?: (anchor: PanelAnchorBounds, group: TaskGroup) => void;
  /** A chip's menu (right-click): its windows, with close actions. */
  onTaskMenu?: (anchor: PanelAnchorBounds, group: TaskGroup) => void;
  /** Close a window (middle-click on a single-window chip). */
  onTaskClose?: (task: TaskWindowInfo) => void;
  /** Receives the glass shapes (output coordinates) each time they change, for the blur. */
  onGlass?: (shapes: readonly PanelMaterial[]) => void;
};

/** Default metric; live chrome reads themePalette().panelHeight. */
export const PANEL_H = 48;

export type PanelAnchorBounds = { x: number; y: number; width: number; height: number };
/** A glass shape the compositor blurs behind the panel. */
export type PanelMaterial = PanelAnchorBounds & { radius: number };

const ISLAND_PAD = 6;
const CHIP_GAP = 4;
const CHIP_MIN = 40;
const CHIP_MAX = 150;
const ICON_CHIP = 40;

/**
 * One geometry authority for the painted panel, its hit targets and popup anchors (absolute
 * output coordinates). The panel is three islands in the theme's panel band: brand and Apps on
 * the left, the windows centred, status on the right. A full-width bar keeps the same layout
 * under one continuous surface.
 */
export function panelStatusGeometry(
  props: Pick<
    PanelProps,
    | "screenW"
    | "screenH"
    | "clock"
    | "onControlsClick"
    | "onNotificationsClick"
    | "notificationCount"
    | "onTaskOverflowClick"
    | "status"
    | "cachedCapabilities"
    | "fullWidth"
    | "iconsOnly"
    | "tasks"
  > & { taskCount?: number },
) {
  const panel = panelGeometry(props.screenW, props.screenH);
  const floating = panel.radius > 0;
  const compact = panel.width < 560;
  const islandGap = compact ? 6 : 10;
  const pad = ISLAND_PAD;
  // Islands inside a flush (non-floating) band keep a little air above and below.
  const inset = floating || props.fullWidth ? 0 : 4;
  const islandY = panel.y + inset;
  const islandH = panel.height - inset * 2;
  const taskH = Math.min(32, islandH - 8);
  const y = panel.y + Math.floor((panel.height - taskH) / 2);
  const gap = 6;

  // Left island: brand (when there is room) and the Apps button.
  const brandW = compact ? 0 : 84;
  const launcherW = compact ? Math.min(44, panel.width / 5) : 44;
  const launcherX = pad + brandW;
  const leftW = launcherX + launcherW + pad;

  // Right island, laid out from the right edge: clock, notifications, system controls.
  const clockNatural =
    measureTextBounds(props.clock ?? "", { fontSize: 13, fontWeight: "medium" }).width + 16;
  const count =
    props.notificationCount && props.notificationCount > 0 ? String(props.notificationCount) : "";
  const notificationsW = props.onNotificationsClick
    ? Math.min(34 + measureTextBounds(count, { fontSize: 11 }).width, Math.max(0, panel.width / 3))
    : 0;
  const capabilities =
    props.status?.kind === "ready" ? props.status.snapshot.capabilities : props.cachedCapabilities;
  const battery = batteryPresentation(
    props.status?.kind === "ready" ? props.status.snapshot.battery : undefined,
    capabilities?.battery,
  );
  const iconCount = 1 + (capabilities?.audio ? 1 : 0) + (battery.supported ? 1 : 0);
  const controlsNaturalW = 18 + iconCount * 18 + (iconCount - 1) * 8;
  const groups = props.tasks ? groupTasks(props.tasks) : null;
  const taskCount = groups ? groups.length : (props.taskCount ?? 0);
  const overflowW =
    props.onTaskOverflowClick && taskCount > 0
      ? Math.max(32, measureTextBounds(`+${taskCount}`, { fontSize: 11 }).width + 14)
      : 0;
  // The Network control stays readable when a compact panel is crowded; the clock yields first.
  const statusBudget = Math.max(
    0,
    panel.width - leftW - islandGap * 2 - (overflowW ? overflowW + pad * 2 : 0) - pad * 2,
  );
  const fixedStatus =
    notificationsW +
    gap * ((props.onControlsClick ? 1 : 0) + (props.onNotificationsClick ? 1 : 0)) +
    (props.onControlsClick ? 36 : 0);
  const clockW = compact
    ? Math.min(clockNatural, Math.max(0, statusBudget - fixedStatus))
    : clockNatural;
  const controlsW = props.onControlsClick
    ? Math.min(controlsNaturalW, Math.max(0, statusBudget - clockW - notificationsW - gap * 2))
    : 0;
  let right = panel.x + panel.width - pad;
  const clock = { x: right - clockW, y: panel.y, width: clockW, height: panel.height };
  right = clock.x;
  const notifications = props.onNotificationsClick
    ? { x: right - gap - notificationsW, y, width: notificationsW, height: taskH }
    : null;
  if (notifications) right = notifications.x;
  const controls = props.onControlsClick
    ? { x: right - gap - controlsW, y, width: controlsW, height: taskH }
    : null;
  if (controls) right = controls.x;
  const rightIsland = {
    x: right - pad,
    y: islandY,
    width: panel.x + panel.width - (right - pad),
    height: islandH,
  };

  // Centre island: the windows, centred on the output where the side islands allow.
  const regionX = panel.x + leftW + islandGap;
  const regionW = Math.max(0, rightIsland.x - islandGap - regionX);
  const inner = Math.max(0, regionW - pad * 2);
  const capacity = Math.max(0, Math.floor((inner + CHIP_GAP) / (CHIP_MIN + CHIP_GAP)));
  const hidden = !!props.onTaskOverflowClick && taskCount > capacity;
  const visibleTaskCount = hidden
    ? Math.max(0, Math.floor((inner - overflowW) / (CHIP_MIN + CHIP_GAP)))
    : Math.min(taskCount, capacity);
  const overflowSpace = hidden ? overflowW + (visibleTaskCount ? CHIP_GAP : 0) : 0;
  // Labelled chips fit their titles while every window fits; a crowded row shares the space.
  const natural = props.iconsOnly
    ? []
    : (groups ?? []).slice(0, visibleTaskCount).map((group) => chipNaturalWidth(group.label));
  const naturalTotal =
    natural.reduce((sum, width) => sum + width, 0) + CHIP_GAP * Math.max(0, natural.length - 1);
  const fitted =
    natural.length === visibleTaskCount &&
    visibleTaskCount > 0 &&
    naturalTotal + overflowSpace <= inner;
  const shared = visibleTaskCount
    ? Math.max(
        CHIP_MIN,
        Math.min(
          CHIP_MAX,
          Math.floor(
            (inner - overflowSpace - CHIP_GAP * (visibleTaskCount - 1)) / visibleTaskCount,
          ),
        ),
      )
    : 0;
  const taskWidths = Array.from({ length: visibleTaskCount }, (_, index) =>
    props.iconsOnly ? ICON_CHIP : fitted ? natural[index]! : shared,
  );
  const taskAreaW =
    taskWidths.reduce((sum, width) => sum + width, 0) +
    CHIP_GAP * Math.max(0, visibleTaskCount - 1) +
    overflowSpace;
  const centerW = taskAreaW ? taskAreaW + pad * 2 : 0;
  const centerX = Math.max(
    regionX,
    Math.min(regionX + regionW - centerW, Math.round(panel.x + (panel.width - centerW) / 2)),
  );
  const taskX = centerX - panel.x + pad;
  const overflow = hidden
    ? {
        x: panel.x + taskX + taskAreaW - overflowW,
        y,
        width: overflowW,
        height: taskH,
      }
    : null;
  const islandRadius = floating ? islandH / 2 : Math.min(10, islandH / 2);
  const islands = {
    left: { x: panel.x, y: islandY, width: leftW, height: islandH, radius: islandRadius },
    center: centerW
      ? { x: centerX, y: islandY, width: centerW, height: islandH, radius: islandRadius }
      : null,
    right: { ...rightIsland, radius: islandRadius },
  };
  return {
    panel,
    clock,
    controls,
    notifications,
    compact,
    launcherX,
    launcherW,
    taskX,
    taskAreaW,
    taskWidths,
    taskH,
    overflow,
    visibleTaskCount,
    islands,
  };
}

/** The glass shapes behind the panel (absolute output coordinates), for the compositor's blur. */
export function panelMaterials(
  geometry: ReturnType<typeof panelStatusGeometry>,
  fullWidth: boolean | undefined,
): PanelMaterial[] {
  if (fullWidth) return [{ ...geometry.panel }];
  const { left, center, right } = geometry.islands;
  return center ? [left, center, right] : [left, right];
}

/**
 * Each visible task button, relative to the panel's top-left. Shared with the compositor, which
 * minimizes a window into its button and restores it back out.
 */
export function panelTaskRects(
  geometry: ReturnType<typeof panelStatusGeometry>,
  taskCount: number,
): PanelAnchorBounds[] {
  const visible = Math.min(taskCount, geometry.visibleTaskCount);
  const y = Math.floor((geometry.panel.height - geometry.taskH) / 2);
  let x = geometry.taskX;
  return geometry.taskWidths.slice(0, visible).map((width) => {
    const rect = { x, y, width, height: geometry.taskH };
    x += width + CHIP_GAP;
    return rect;
  });
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpRect = <R extends PanelAnchorBounds>(a: R, b: R, t: number): R => ({
  ...b,
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
  width: lerp(a.width, b.width, t),
  height: lerp(a.height, b.height, t),
});

type PanelGeometry = ReturnType<typeof panelStatusGeometry>;

/**
 * The window row part way (`t`) from its icons-only layout to its labelled one. Layouts that
 * show a different number of windows switch halfway instead.
 */
function mixTaskLayout(icons: PanelGeometry, labels: PanelGeometry, t: number): PanelGeometry {
  if (t <= 0) return icons;
  if (t >= 1) return labels;
  if (
    icons.visibleTaskCount !== labels.visibleTaskCount ||
    !!icons.overflow !== !!labels.overflow ||
    !!icons.islands.center !== !!labels.islands.center
  )
    return t < 0.5 ? icons : labels;
  return {
    ...labels,
    taskX: lerp(icons.taskX, labels.taskX, t),
    taskAreaW: lerp(icons.taskAreaW, labels.taskAreaW, t),
    taskWidths: labels.taskWidths.map((width, index) => lerp(icons.taskWidths[index]!, width, t)),
    overflow: labels.overflow && lerpRect(icons.overflow!, labels.overflow, t),
    islands: {
      ...labels.islands,
      center: labels.islands.center && lerpRect(icons.islands.center!, labels.islands.center, t),
    },
  };
}

/**
 * The islands part way (`t`) to merging into one bar: each grows to meet its neighbours halfway
 * across the gap, under a continuous bar that fades in.
 */
function mergedIslands(geometry: PanelGeometry, t: number): PanelMaterial[] {
  const { panel, islands } = geometry;
  const shapes = [islands.left, islands.center, islands.right].filter(
    (shape): shape is PanelMaterial => !!shape,
  );
  return shapes.map((shape, index) => {
    const before = shapes[index - 1];
    const after = shapes[index + 1];
    const left = before ? (before.x + before.width + shape.x) / 2 : panel.x;
    const right = after ? (shape.x + shape.width + after.x) / 2 : panel.x + panel.width;
    const x = lerp(shape.x, left, t);
    return {
      x,
      y: lerp(shape.y, panel.y, t),
      width: lerp(shape.x + shape.width, right, t) - x,
      height: lerp(shape.height, panel.height, t),
      radius: lerp(shape.radius, panel.radius, t),
    };
  });
}

/** Bottom panel — task activation, distinct system controls, notification bell and clock. */
export function Panel(props: PanelProps): ReactNode {
  const pal = themePalette();
  // Switching the panel's style or window labels animates; reduced motion switches at once.
  const motion = useWidgetTheme().foundations.motion;
  const modeMs = motion.normalMs ? motion.slowMs : 0;
  const wide = useTween(props.fullWidth ? 1 : 0, { duration: modeMs, easing: "ease-in-out" });
  const labelled = useTween(props.iconsOnly ? 0 : 1, { duration: modeMs, easing: "ease-in-out" });
  const base = { ...props, taskCount: props.tasks?.length ?? 0 };
  const geometry = mixTaskLayout(
    panelStatusGeometry({ ...base, iconsOnly: true }),
    panelStatusGeometry({ ...base, iconsOnly: false }),
    labelled,
  );
  const islandShapes = mergedIslands(geometry, wide);
  const barShape: PanelMaterial = { ...geometry.panel };
  props.onGlass?.(wide < 0.5 ? islandShapes : [barShape]);
  const { x: panelX, y, width: panelW, height: panelH } = geometry.panel;
  const { taskH } = geometry;
  const clock = props.clock ?? "";
  const groups = groupTasks(props.tasks ?? []);
  const visibleGroups = groups.slice(0, geometry.visibleTaskCount);
  const hiddenTasks = groups.slice(geometry.visibleTaskCount).flatMap((group) => group.tasks);
  const taskRects = panelTaskRects(geometry, groups.length);
  const chipAnchor = (rect: PanelAnchorBounds): PanelAnchorBounds => ({
    ...rect,
    x: panelX + rect.x,
    y: y + rect.y,
  });
  // The compositor supplies a live blurred backdrop; keep these tints translucent.
  const glass = hexToArgb(getTheme().tokens.panel, 0xc0);
  const rim = pal.rimLight;
  const pill = taskH / 2;
  const itemY = Math.floor((panelH - taskH) / 2);
  const local = (rect: PanelAnchorBounds) => ({ x: rect.x - panelX, y: rect.y - y });
  return (
    <Group x={panelX} y={y} width={panelW} height={panelH}>
      {wide < 1 ? (
        <Group opacity={1 - wide} width={panelW} height={panelH}>
          {islandShapes.map((shape, index) => (
            <Rect
              key={index}
              {...local(shape)}
              width={shape.width}
              height={shape.height}
              fill={glass}
              radius={shape.radius}
              stroke={rim}
              strokeWidth={1}
            />
          ))}
        </Group>
      ) : null}
      {wide > 0 ? (
        <Group opacity={wide} width={panelW} height={panelH}>
          <Rect
            width={panelW}
            height={panelH}
            fill={glass}
            radius={barShape.radius}
            stroke={rim}
            strokeWidth={1}
          />
        </Group>
      ) : null}
      {!geometry.compact ? (
        <BrandMark
          x={ISLAND_PAD + 12}
          y={(panelH - 20) / 2}
          width={64}
          height={20}
          color={pal.text}
        />
      ) : null}
      <Tooltip
        x={geometry.launcherX}
        y={itemY}
        width={geometry.launcherW}
        height={taskH}
        label="Applications"
        placement="top"
      >
        <Pressable
          width={geometry.launcherW}
          height={taskH}
          fill={(pal.text & 0x00ffffff) | 0x12000000}
          hoverFill={pal.hover}
          pressedFill={pal.pressed}
          radius={pill}
          focusId="apps:panel"
          onPress={props.onLauncherClick}
        >
          <Icon
            x={(geometry.launcherW - 16) / 2}
            y={(taskH - 16) / 2}
            name="grid"
            size={16}
            color={pal.text}
            symbolic
          />
        </Pressable>
      </Tooltip>
      {visibleGroups.map((group, index) => {
        const rect = taskRects[index]!;
        return (
          <TaskButton
            key={group.key}
            group={group}
            bounds={rect}
            labelled={labelVisibility(rect.width)}
            follow={labelled > 0 && labelled < 1}
            onPress={() =>
              group.tasks.length > 1
                ? props.onTaskGroupPress?.(chipAnchor(rect), group)
                : props.onTaskPress?.(group.lead)
            }
            onMenu={() => props.onTaskMenu?.(chipAnchor(rect), group)}
            onClose={group.tasks.length === 1 ? () => props.onTaskClose?.(group.lead) : undefined}
          />
        );
      })}
      {geometry.overflow ? (
        <Tooltip
          {...local(geometry.overflow)}
          width={geometry.overflow.width}
          height={taskH}
          label={`${hiddenTasks.length} hidden windows`}
          placement="top"
        >
          <Pressable
            width={geometry.overflow.width}
            height={taskH}
            fill={0x00000000}
            hoverFill={pal.hover}
            pressedFill={pal.pressed}
            radius={pill}
            focusId="panel:windows"
            onPress={() => props.onTaskOverflowClick?.(geometry.overflow!, hiddenTasks)}
          >
            <Text
              x={
                (geometry.overflow.width -
                  measureTextBounds(`+${hiddenTasks.length}`, { fontSize: 11 }).width) /
                2
              }
              y={(taskH - measureTextBounds("Mg", { fontSize: 11 }).height) / 2}
              text={`+${hiddenTasks.length}`}
              fontSize={11}
              fontWeight="medium"
              color={pal.text}
            />
          </Pressable>
        </Tooltip>
      ) : null}
      {geometry.controls ? (
        <Pressable
          {...local(geometry.controls)}
          width={geometry.controls.width}
          height={geometry.controls.height}
          fill={0x00000000}
          hoverFill={pal.hover}
          pressedFill={pal.pressed}
          radius={pill}
          focusId="panel:controls"
          onPress={props.onControlsClick}
        >
          <StatusIcons
            width={geometry.controls.width}
            height={geometry.controls.height}
            status={props.status}
            cachedCapabilities={props.cachedCapabilities}
            cachedNetworkPresentation={props.cachedNetworkPresentation}
          />
        </Pressable>
      ) : null}
      {geometry.notifications ? (
        <Pressable
          {...local(geometry.notifications)}
          width={geometry.notifications.width}
          height={geometry.notifications.height}
          fill={0x00000000}
          hoverFill={pal.hover}
          pressedFill={pal.pressed}
          radius={pill}
          focusId="panel:notifications"
          onPress={props.onNotificationsClick}
        >
          <Icon name="bell" x={6} y={(taskH - 18) / 2} size={18} color={pal.text} symbolic />
          {props.notificationCount && props.notificationCount > 0 ? (
            <Text
              x={28}
              y={(taskH - measureTextBounds("Mg", { fontSize: 11 }).height) / 2}
              text={String(props.notificationCount)}
              fontSize={11}
              color={pal.muted}
            />
          ) : null}
        </Pressable>
      ) : null}
      <Text
        x={geometry.clock.x - panelX + 4}
        y={Math.floor((panelH - measureTextBounds("Mg", { fontSize: 13 }).height) / 2)}
        text={fitTitle(clock, Math.max(0, geometry.clock.width - 8), 13)}
        color={pal.text}
        fontSize={13}
        fontWeight="medium"
      />
    </Group>
  );
}

/** Network, volume and battery glyphs inside the system-controls button. */
function StatusIcons(props: {
  width: number;
  height: number;
  status?: DesktopStatusState;
  cachedCapabilities?: DesktopCapabilities;
  cachedNetworkPresentation?: NetworkPresentation;
}): ReactNode {
  const pal = themePalette();
  const snapshot = props.status?.kind === "ready" ? props.status.snapshot : null;
  const audio = snapshot?.audio;
  const capabilities = snapshot?.capabilities ?? props.cachedCapabilities;
  const battery = batteryPresentation(snapshot?.battery, capabilities?.battery);
  const network = snapshot
    ? networkPresentation(snapshot.network, snapshot.wifi)
    : (props.cachedNetworkPresentation ?? networkPresentation([]));
  const names = [
    network.icon,
    ...(capabilities?.audio
      ? [audio?.kind === "ready" && audio.muted ? "volume-muted" : "volume"]
      : []),
    ...(battery.supported ? [battery.icon] : []),
  ].slice(0, Math.max(1, Math.floor((props.width - 12) / 22)));
  const size = Math.min(
    18,
    Math.max(0, names.length === 1 ? props.width - 4 : (props.width - 12) / names.length - 4),
  );
  const step = size + 4;
  const start = (props.width - (names.length * step - 4)) / 2;
  const tone = (name: string) =>
    name === network.icon
      ? snapshot?.network.some((entry) => entry.addresses.length > 0)
        ? pal.accentLine
        : pal.muted
      : name === battery.icon && battery.supported
        ? battery.tone === "warning"
          ? pal.danger
          : battery.tone === "accent"
            ? pal.accentLine
            : battery.available
              ? pal.text
              : pal.muted
        : audio?.kind !== "ready"
          ? pal.muted
          : pal.text;
  return names.map((name, index) => (
    <Icon
      key={`${name}:${index}`}
      name={name}
      x={start + index * step}
      y={(props.height - size) / 2}
      size={size}
      color={tone(name)}
      symbolic
    />
  ));
}

/** How much of a chip's title shows at a width: none when squeezed to its icon, all once it fits. */
function labelVisibility(width: number): number {
  return Math.max(0, Math.min(1, (width - (CHIP_MIN + 8)) / 24));
}

/**
 * One window's chip. It slides when the row reflows, fades in as its window appears, and its
 * accent fill cross-fades as focus moves between windows. Its title fades with its width, so
 * switching to icons only folds titles away rather than dropping them.
 */
function TaskButton(props: {
  group: TaskGroup;
  bounds: PanelAnchorBounds;
  /** 0 (icon only) … 1 (icon and title). */
  labelled: number;
  /** The row is already being interpolated (a mode change): track it exactly, without easing. */
  follow?: boolean;
  onPress(): void;
  /** Right-click: the chip's window list. */
  onMenu(): void;
  /** Middle-click: close the window (single-window chips only). */
  onClose?: () => void;
}): ReactNode {
  const pal = themePalette();
  const motion = useWidgetTheme().foundations.motion;
  const { group, bounds, labelled } = props;
  const task = group.lead;
  const count = group.tasks.length;
  const focus = useAnimatedValue(group.focused ? 1 : 0, {
    duration: motion.normalMs,
    easing: "ease-out",
  });
  const unfocused = useRef({ get: () => 1 - focus.get() }).current;
  const slide = useDampedValue(bounds.x, {
    speed: 20,
    immediate: motion.normalMs === 0 || props.follow,
  });
  const { width, height } = bounds;
  const radius = height / 2;
  const iconSize = 18;
  const textH = measureTextBounds("Mg", { fontSize: 12, fontWeight: "medium" }).height;
  const title = group.label;
  const label = truncate(title, 22);
  const badge = count > 1 ? String(Math.min(count, 9)) : "";
  const iconX = lerp(Math.floor((width - iconSize) / 2), 14, labelled);
  const content = (color: number) => (
    <>
      <Icon
        x={iconX}
        y={Math.floor((height - iconSize) / 2)}
        name={applicationIcon(task.appId || task.title)}
        symbolic={!task.iconPath}
        path={task.iconPath}
        size={iconSize}
        color={color}
      />
      {labelled > 0 ? (
        <Group opacity={labelled} width={width} height={height}>
          <Text
            x={40}
            y={Math.floor((height - textH) / 2)}
            text={fitTitle(label, Math.max(0, width - 54), 12)}
            color={color}
            fontSize={12}
            fontWeight="medium"
          />
        </Group>
      ) : null}
    </>
  );
  return (
    <Group y={bounds.y} translateX={slide} width={width} height={height}>
      <Entrance width={width} height={height} rise={6}>
        <Tooltip
          width={width}
          height={height}
          label={title}
          placement="top"
          disabled={labelled > 0.5}
        >
          <Pressable
            width={width}
            height={height}
            fill={0x00000000}
            hoverFill={pal.hover}
            pressedFill={pal.pressed}
            radius={radius}
            onPress={props.onPress}
            onContextMenu={(event) =>
              event.button === "middle" ? props.onClose?.() : props.onMenu()
            }
          >
            {/* The focused window is a solid accent chip; its contents turn to white with it. */}
            <Group opacity={focus} width={width} height={height}>
              <Rect width={width} height={height} radius={radius} fill={pal.accent} />
              {content(0xffffffff)}
            </Group>
            <Group opacity={unfocused} width={width} height={height}>
              {content(group.minimized ? pal.muted : pal.text)}
            </Group>
            {/* Several windows: a small count on the icon's corner. */}
            {badge ? (
              <Group x={iconX + 11} y={Math.floor((height - 18) / 2) - 5} width={14} height={14}>
                <Rect width={14} height={14} radius={7} fill={pal.text} />
                <Text
                  x={
                    (14 - measureTextBounds(badge, { fontSize: 10, fontWeight: "medium" }).width) /
                    2
                  }
                  y={
                    (14 - measureTextBounds(badge, { fontSize: 10, fontWeight: "medium" }).height) /
                    2
                  }
                  text={badge}
                  fontSize={10}
                  fontWeight="medium"
                  color={pal.bg}
                />
              </Group>
            ) : null}
          </Pressable>
        </Tooltip>
      </Entrance>
    </Group>
  );
}

/** A labelled chip's width: padding, icon, gap, title (as painted), padding. */
function chipNaturalWidth(title: string): number {
  const label = truncate(title || "Window", 22);
  const text = measureTextBounds(label, { fontSize: 12, fontWeight: "medium" }).width;
  return Math.max(CHIP_MIN, Math.min(CHIP_MAX, Math.ceil(40 + text + 16)));
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function fitTitle(title: string, width: number, fontSize = 12): string {
  const scale = fontSize / 14;
  if (measureText(title, scale) <= width) return title;
  let result = title;
  while (result.length && measureText(`${result}…`, scale) > width) result = result.slice(0, -1);
  return result ? `${result}…` : "";
}
